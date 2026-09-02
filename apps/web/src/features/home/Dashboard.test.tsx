import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Home } from './Home';
import { BackendProvider } from '../../adapters/BackendContext';
import { mockMatchMedia } from '../../test/matchMedia';
import { LocalAuth } from '../../adapters/local/localAuth';
import { LocalSpaceStore } from '../../adapters/local/localSpaceStore';
import { LocalShareStore } from '../../adapters/local/localShareStore';
import { LocalFeedbackStore } from '../../adapters/local/localFeedbackStore';
import { LocalCommentStore } from '../../adapters/local/localCommentStore';
import { LocalNotificationStore } from '../../adapters/local/localNotificationStore';
import { LocalEventStore } from '../../adapters/local/localEventStore';
import { LocalImageStore } from '../../adapters/local/localImageStore';
import type { Backend, DocMeta, DocStore, LoadedDoc, SaveResult } from '../../adapters/ports';
import { clearActiveView } from './storage';
import { addDays, weekLabel, weekStartISO } from './calendar/model';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 대시보드 ①(모델 + LNB + 보기 전용 위젯 + 피커) 통합 테스트 — 홈이 실제로
 * 하는 흐름 그대로: LNB에서 만들고, 피커로 올리고, 우클릭으로 다듬고, 워크스페이스
 * 블롭에 남는지까지.
 */

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

class MockDocStore implements DocStore {
  listEditorNames = vi.fn(async (): Promise<Record<string, string>> => ({}));
  setFavorite = vi.fn(async (): Promise<void> => undefined);
  remove = vi.fn(async (): Promise<void> => undefined);
  restore = vi.fn(async (): Promise<void> => undefined);
  purge = vi.fn(async (): Promise<void> => undefined);
  rename = vi.fn(async (): Promise<void> => undefined);
  save = vi.fn(async (): Promise<SaveResult> => ({ ok: true, version: 1 }));
  load = vi.fn(async (id: string): Promise<LoadedDoc | null> => this.bodies[id] ?? null);
  loadPreview = vi.fn(async (id: string): Promise<string | null> => {
    const b = this.bodies[id];
    return b ? JSON.stringify(b.doc) : null;
  });

  constructor(
    private metas: DocMeta[] = [],
    private bodies: Record<string, LoadedDoc> = {},
  ) {}

  async list(): Promise<DocMeta[]> {
    return this.metas;
  }
}

function renderHome(metas: DocMeta[] = [], bodies: Record<string, LoadedDoc> = {}, override: Partial<Backend> = {}) {
  const docStore = new MockDocStore(metas, bodies);
  const backend: Backend = { auth: new LocalAuth(), docStore, spaceStore: new LocalSpaceStore(), shareStore: new LocalShareStore(), feedbackStore: new LocalFeedbackStore(), imageStore: new LocalImageStore(), commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(), eventStore: new LocalEventStore(), mode: 'local', ...override };
  const utils = render(
    <MemoryRouter initialEntries={['/home']}>
      <BackendProvider backend={backend}>
        <Routes>
          <Route path="/home" element={<Home />} />
          <Route path="/editor" element={<div>EDITOR_PLACEHOLDER</div>} />
          <Route path="/login" element={<div>LOGIN_PAGE</div>} />
        </Routes>
      </BackendProvider>
    </MemoryRouter>,
  );
  return { ...utils, docStore };
}

const META = (id: string, title: string): DocMeta => ({ id, title, version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null });

const MAP_BODY = {
  doc: {
    v: 1,
    nodes: {
      root: { id: 'root', text: '기획맵', emoji: '', parent: null, children: ['a'], collapsed: false, color: null, x: 0, y: 0 },
      a: { id: 'a', text: '가지 A', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 100, y: 0 },
    },
    floats: [],
    lines: [],
    zones: [],
    layoutMode: 'radial',
    themeKey: 'coral',
  } as unknown as LoadedDoc['doc'],
  version: 1,
  title: '기획맵',
};

function seedSpaces(withMap = false) {
  localStorage.setItem(
    'mf_spaces',
    JSON.stringify({
      spaces: [{ id: 's1', name: '일반 공간', home: true, color: '#f0663f', maps: withMap ? [{ title: '기획맵', when: '방금', hue: '#f0663f', docId: 'doc-a' }] : [], folders: [] }],
      mapFolders: {},
    }),
  );
}

/** 워크스페이스 블롭에 남은 dashboards. */
function savedDashboards(): { id: string; name: string; color?: string; items: { id: string; docId: string; size: string }[] }[] {
  const ws = JSON.parse(localStorage.getItem('mf_spaces') || '{}') as { dashboards?: { id: string; name: string; color?: string; items: { id: string; docId: string; size: string }[] }[] };
  return ws.dashboards ?? [];
}

/** LNB `새 대시보드` → 만들기 팝업(첨부 디자인)에서 이름·색을 정해 만든다. */
async function createDashViaDialog(user: ReturnType<typeof userEvent.setup>, aside: HTMLElement, name: string, colorIdx = 0) {
  await user.click(within(aside).getByText('새 대시보드'));
  const dlg = await screen.findByRole('dialog', { name: '새 대시보드 만들기' });
  if (colorIdx > 0) fireEvent.click(dlg.querySelectorAll('[data-dialog-color]')[colorIdx] as HTMLElement);
  await user.type(within(dlg).getByLabelText('대시보드 이름'), name);
  await user.click(within(dlg).getByRole('button', { name: '만들기' }));
  return dlg;
}

async function sidebarOf(container: HTMLElement) {
  const aside = container.querySelector('aside') as HTMLElement;
  await waitFor(() => expect(within(aside).getByText('일반 공간')).toBeTruthy());
  return aside;
}

describe('대시보드 ① — LNB·보기·피커', () => {
  it('LNB에 대시보드 구획이 있고, "새 대시보드"가 만들고 곧바로 연다(블롭에도 남는다)', async () => {
    seedSpaces();
    const user = userEvent.setup();
    const { container } = renderHome();
    const aside = await sidebarOf(container);

    expect(within(aside).getByText('대시보드')).toBeTruthy();

    // "새 대시보드"는 곧바로 만들지 않고 **이름·색을 받는 팝업**을 연다(첨부 디자인)
    await user.click(within(aside).getByText('새 대시보드'));
    const dlg = await screen.findByRole('dialog', { name: '새 대시보드 만들기' });
    expect(within(dlg).getByText('보드를 모아 한눈에 볼 화면을 만들어요')).toBeTruthy();
    expect(dlg.querySelector('[data-dialog-icon]')).toBeTruthy();
    expect(dlg.querySelector('[data-dialog-count]')?.textContent).toBe('0/10');
    // 이름이 비어 있으면 만들 수 없다
    expect((within(dlg).getByRole('button', { name: '만들기' }) as HTMLButtonElement).disabled).toBe(true);
    // 색 여섯, 첫 칸이 선택된 채로 시작
    expect(dlg.querySelectorAll('[data-dialog-color]').length).toBe(6);
    // 라디오 묶음이라 고른 칸은 `aria-checked`로 알린다(`aria-pressed`는 "눌린 버튼").
    expect((dlg.querySelectorAll('[data-dialog-color]')[0] as HTMLElement).getAttribute('aria-checked')).toBe('true');

    fireEvent.click(dlg.querySelectorAll('[data-dialog-color]')[3] as HTMLElement); // 파랑
    await user.type(within(dlg).getByLabelText('대시보드 이름'), '주간 현황');
    expect(dlg.querySelector('[data-dialog-count]')?.textContent).toBe('5/10');
    await user.click(within(dlg).getByRole('button', { name: '만들기' }));

    // 대시보드 화면으로 전환 — 스페이스의 툴바·그리드는 접힌다
    const dashView = container.querySelector('[data-dashboard-view]') as HTMLElement;
    expect(dashView).toBeTruthy();
    expect(within(dashView).getByText('아직 올려둔 보드가 없어요')).toBeTruthy();
    expect(screen.queryByPlaceholderText('모든 스페이스에서 검색')).toBeNull();

    // LNB 행 + 맨 위 = 기본 배지, 그리고 이름·색이 워크스페이스 블롭에 저장
    expect(within(aside).getByText('기본')).toBeTruthy();
    expect(within(aside).getByText('주간 현황')).toBeTruthy();
    await waitFor(() => expect(savedDashboards().map((d) => d.name)).toEqual(['주간 현황']));
    expect(savedDashboards()[0]?.color).toBe('#3f8fd0');
    // 고른 색은 LNB 행 글리프와 히어로 점에 나타난다(고르면 보이는 곳이 있다)
    expect((aside.querySelector('[data-dash-glyph]') as HTMLElement).getAttribute('stroke')).toBe('#3f8fd0');
    expect((dashView.querySelector('[data-dash-hero-dot]') as HTMLElement).style.background).toBe('rgb(63, 143, 208)');

    // 행을 다시 눌러도 그대로, 스페이스를 누르면 스페이스 보기로 복귀
    await user.click(within(aside).getByText('일반 공간'));
    expect(container.querySelector('[data-dashboard-view]')).toBeNull();
    expect(screen.getByPlaceholderText('모든 스페이스에서 검색')).toBeTruthy();
  });

  it('피커: 보드를 골라 크기를 정해 올리면 위젯이 서고, 피커는 열린 채 "올림" 배지가 붙는다', async () => {
    seedSpaces(true);
    const user = userEvent.setup();
    const { container } = renderHome([META('doc-a', '기획맵')], { 'doc-a': MAP_BODY });
    const aside = await sidebarOf(container);

    await createDashViaDialog(user, aside, '내 보드');
    await user.click(screen.getAllByRole('button', { name: '보드 추가' })[0]!);

    const picker = await screen.findByRole('dialog', { name: '보드 올리기' });
    const card = picker.querySelector('[data-dash-pick-card="doc-a"]') as HTMLElement;
    expect(card).toBeTruthy();
    await user.click(card);

    // 발치에 크기 선택지(맵 기본 2×2) — 칸반 전용 크기가 아니라 여덟 전부
    const sizeBtn = within(picker).getByRole('button', { name: '3×2' });
    expect((within(picker).getByRole('button', { name: '2×2' }) as HTMLElement).getAttribute('aria-pressed')).toBe('true');
    await user.click(sizeBtn);
    await user.click(within(picker).getByRole('button', { name: '올리기' }));

    // 피커는 열린 채(여러 개를 이어 올린다) 카드가 "올림"으로 바뀐다
    expect(screen.getByRole('dialog', { name: '보드 올리기' })).toBeTruthy();
    await waitFor(() => expect(picker.querySelector('[data-dash-pick-on]')).toBeTruthy());

    // 닫으면 위젯이 그 크기로 서 있고, 블롭에도 남았다
    await user.click(within(picker).getByRole('button', { name: '닫기' }));
    const widget = container.querySelector('[data-dash-widget]') as HTMLElement;
    expect(widget).toBeTruthy();
    // 제목(머리)과 미니 트리의 루트 알약이 같은 글자를 그린다 — 둘 다 실제 문서에서 왔다
    expect(within(widget).getAllByText('기획맵').length).toBeGreaterThan(0);
    await waitFor(() => expect(savedDashboards()[0]?.items).toEqual([expect.objectContaining({ docId: 'doc-a', size: '3x2' })]));
  });

  it('가득 찬 대시보드에서 "보드 추가"는 피커 대신 안내를 띄운다(CAP 10)', async () => {
    seedSpaces();
    localStorage.setItem(
      'mf_spaces',
      JSON.stringify({
        spaces: [{ id: 's1', name: '일반 공간', home: true, color: '#f0663f', maps: [], folders: [] }],
        mapFolders: {},
        dashboards: [{ id: 'd1', name: '꽉 찬 보드', items: Array.from({ length: 10 }, (_, i) => ({ id: `w${i}`, docId: `doc${i}`, size: '1x1' })) }],
      }),
    );
    const user = userEvent.setup();
    const { container } = renderHome();
    const aside = await sidebarOf(container);

    await user.click(within(aside).getByText('꽉 찬 보드'));
    await user.click(screen.getAllByRole('button', { name: '보드 추가' })[0]!);

    expect(screen.queryByRole('dialog', { name: '보드 올리기' })).toBeNull();
    expect(await screen.findByText('대시보드가 가득 찼어요')).toBeTruthy();
  });

  it('스페이스 정렬: ⠿ 토글 → ↓ 한 칸 이동이 화면과 블롭에 함께 남는다', async () => {
    localStorage.setItem(
      'mf_spaces',
      JSON.stringify({ spaces: [{ id: 'sa', name: '첫 공간', color: '#f0663f', maps: [] }, { id: 'sb', name: '둘째 공간', color: '#3f8fd0', maps: [] }], mapFolders: {} }),
    );
    const user = userEvent.setup();
    const { container } = renderHome();
    const aside = container.querySelector('aside') as HTMLElement;
    await waitFor(() => expect(within(aside).getByText('첫 공간')).toBeTruthy());

    await user.click(within(aside).getByRole('button', { name: '스페이스 순서 바꾸기' }));
    const firstRow = within(aside).getByText('첫 공간').closest('.space-row') as HTMLElement;
    await user.click(within(firstRow).getByRole('button', { name: '아래로' }));

    const rows = Array.from(aside.querySelectorAll('.space-row')).map((r) => r.textContent || '');
    expect(rows.findIndex((t) => t.includes('둘째 공간'))).toBeLessThan(rows.findIndex((t) => t.includes('첫 공간')));
    await waitFor(() => {
      const ws = JSON.parse(localStorage.getItem('mf_spaces') || '{}') as { spaces?: { id: string }[] };
      expect((ws.spaces ?? []).map((s) => s.id)).toEqual(['sb', 'sa']);
    });
  });

  it('행 우클릭 → 이름 변경·삭제(삭제는 배치만 사라진다는 확인창을 거친다)', async () => {
    seedSpaces();
    localStorage.setItem(
      'mf_spaces',
      JSON.stringify({ spaces: [{ id: 's1', name: '일반 공간', home: true, color: '#f0663f', maps: [], folders: [] }], mapFolders: {}, dashboards: [{ id: 'd1', name: '옛 이름', items: [] }] }),
    );
    const user = userEvent.setup();
    const { container } = renderHome();
    const aside = await sidebarOf(container);
    await waitFor(() => expect(within(aside).getByText('옛 이름')).toBeTruthy());

    // 이름 변경
    fireEvent.contextMenu(within(aside).getByText('옛 이름'), { clientX: 80, clientY: 200 });
    const menu = await screen.findByRole('menu');
    expect(menu.getAttribute('data-home-ctx')).toBe('dash');
    fireEvent.click(within(menu).getByRole('menuitem', { name: '이름 변경' }));
    const rename = await screen.findByRole('dialog', { name: '대시보드 이름 변경' });
    const input = within(rename).getByLabelText('대시보드 이름') as HTMLInputElement;
    await user.clear(input);
    await user.type(input, '이번 주');
    await user.click(within(rename).getByRole('button', { name: '변경' }));
    await waitFor(() => expect(within(aside).getByText('이번 주')).toBeTruthy());

    // 삭제 — 확인창 문구가 "배치만 사라진다"를 말한다
    fireEvent.contextMenu(within(aside).getByText('이번 주'), { clientX: 80, clientY: 200 });
    fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: '대시보드 삭제' }));
    const confirm = await screen.findByRole('dialog', { name: '대시보드를 삭제할까요?' });
    expect(confirm.textContent).toContain('배치만 사라지고');
    await user.click(within(confirm).getByRole('button', { name: '삭제' }));
    await waitFor(() => expect(within(aside).queryByText('이번 주')).toBeNull());
    await waitFor(() => expect(savedDashboards()).toEqual([]));
  });

  it('위젯 우클릭 메뉴 — 열기·새로 불러오기·맨 앞으로·크기·내리기(내리면 위젯이 사라진다)', async () => {
    seedSpaces(true);
    localStorage.setItem(
      'mf_spaces',
      JSON.stringify({
        spaces: [{ id: 's1', name: '일반 공간', home: true, color: '#f0663f', maps: [{ title: '기획맵', when: '방금', hue: '#f0663f', docId: 'doc-a' }], folders: [] }],
        mapFolders: {},
        dashboards: [{ id: 'd1', name: '대시보드', items: [{ id: 'w1', docId: 'doc-a', size: '2x2' }] }],
      }),
    );
    const { container } = renderHome([META('doc-a', '기획맵')], { 'doc-a': MAP_BODY });
    const aside = await sidebarOf(container);

    // 행을 눌러 대시보드를 연다(구획 라벨과 이름이 같아 nav-item 행으로 짚는다)
    await waitFor(() => {
      const row = within(aside)
        .getAllByRole('button')
        .find((el) => el.classList.contains('nav-item') && (el.textContent || '').includes('대시보드') && !(el.textContent || '').includes('새 대시보드'));
      expect(row).toBeTruthy();
    });
    const dashRow = within(aside)
      .getAllByRole('button')
      .find((el) => el.classList.contains('nav-item') && (el.textContent || '').includes('대시보드') && !(el.textContent || '').includes('새 대시보드')) as HTMLElement;
    fireEvent.click(dashRow);

    const widget = await waitFor(() => {
      const w = container.querySelector('[data-dash-widget]') as HTMLElement;
      expect(w).toBeTruthy();
      return w;
    });
    fireEvent.contextMenu(widget, { clientX: 300, clientY: 300 });
    const menu = await screen.findByRole('menu');
    expect(menu.getAttribute('data-home-ctx')).toBe('widget');
    for (const label of ['에디터에서 열기', '최신 내용 불러오기', '맨 앞으로 옮기기', '대시보드에서 내리기']) {
      expect(within(menu).getByRole('menuitem', { name: label })).toBeTruthy();
    }
    // 크기 하위 목록 — 맵이라 1×1부터 열려 있다
    expect(within(menu).getByText('크기')).toBeTruthy();

    fireEvent.click(within(menu).getByRole('menuitem', { name: '대시보드에서 내리기' }));
    await waitFor(() => expect(container.querySelector('[data-dash-widget]')).toBeNull());
    await waitFor(() => expect(savedDashboards()[0]?.items).toEqual([]));
  });
});

// ── 대시보드 ② — 배치 편집 모드 + 런치 전환 ────────────────────────────────

/** 위젯 두 개가 올라간 대시보드를 연 상태로 시작한다. */
async function openSeededDash() {
  localStorage.setItem(
    'mf_spaces',
    JSON.stringify({
      spaces: [
        {
          id: 's1',
          name: '일반 공간',
          home: true,
          color: '#f0663f',
          maps: [
            { title: '기획맵', when: '방금', hue: '#f0663f', docId: 'doc-a' },
            { title: '둘째맵', when: '방금', hue: '#3f8fd0', docId: 'doc-b' },
          ],
          folders: [],
        },
      ],
      mapFolders: {},
      dashboards: [{ id: 'd1', name: '대시보드', items: [{ id: 'w1', docId: 'doc-a', size: '2x2' }, { id: 'w2', docId: 'doc-b', size: '2x2' }] }],
    }),
  );
  const utils = renderHome([META('doc-a', '기획맵'), META('doc-b', '둘째맵')], { 'doc-a': MAP_BODY, 'doc-b': { ...MAP_BODY, title: '둘째맵' } });
  const aside = await sidebarOf(utils.container);
  const dashRow = within(aside)
    .getAllByRole('button')
    .find((el) => el.classList.contains('nav-item') && (el.textContent || '').includes('대시보드') && !(el.textContent || '').includes('새 대시보드')) as HTMLElement;
  fireEvent.click(dashRow);
  await waitFor(() => expect(utils.container.querySelectorAll('[data-dash-widget]').length).toBe(2));
  return utils;
}

describe('대시보드 ② — 배치 편집 모드·런치 전환', () => {
  it('편집 토글: 안내 띠·고스트 격자·드래그 가능·인라인 컨트롤이 열리고, 열기 알약은 감춘다', async () => {
    const user = userEvent.setup();
    const { container } = await openSeededDash();

    // 평소: 열기 알약 있음, 편집 장치 없음
    expect(container.querySelector('.mf-dash-open')).toBeTruthy();
    expect(container.querySelector('[data-dash-ghost-cells]')).toBeNull();

    await user.click(screen.getByRole('button', { name: '편집' }));
    expect(screen.getByText(/카드를 끌어 순서를 바꾸고/)).toBeTruthy();
    expect(container.querySelector('[data-dash-ghost-cells]')).toBeTruthy();
    const widget = container.querySelector('[data-dash-widget]') as HTMLElement;
    expect(widget.getAttribute('draggable')).toBe('true');
    expect(container.querySelector('.mf-dash-open')).toBeNull();
    expect(widget.querySelector('[data-dash-resize]')).toBeTruthy();
    expect(widget.querySelector('[data-dash-cycle]')?.textContent).toBe('2×2');
    expect(widget.querySelector('[data-dash-remove]')).toBeTruthy();

    // 끝내면 원상 복귀
    await user.click(screen.getByRole('button', { name: '편집 끝내기' }));
    expect(container.querySelector('[data-dash-ghost-cells]')).toBeNull();
    expect(container.querySelector('.mf-dash-open')).toBeTruthy();
  });

  it('드래그 재배치: 첫 위젯을 둘째 자리에 놓으면 순서가 바뀌어 저장된다', async () => {
    const user = userEvent.setup();
    const { container } = await openSeededDash();
    await user.click(screen.getByRole('button', { name: '편집' }));

    const [w1, w2] = Array.from(container.querySelectorAll('[data-dash-widget]')) as HTMLElement[];
    fireEvent.dragStart(w1!);
    fireEvent.dragOver(w2!);
    fireEvent.drop(w2!);

    await waitFor(() => {
      const order = Array.from(container.querySelectorAll('[data-dash-widget]')).map((el) => el.getAttribute('data-dash-widget'));
      expect(order).toEqual(['w2', 'w1']);
    });
    await waitFor(() => expect(savedDashboards()[0]?.items.map((it) => it.docId)).toEqual(['doc-b', 'doc-a']));
  });

  it('크기 순환·내리기: 인라인 버튼이 다음 크기로 저장하고, ✕는 위젯을 내린다', async () => {
    const user = userEvent.setup();
    const { container } = await openSeededDash();
    await user.click(screen.getByRole('button', { name: '편집' }));

    const widget = container.querySelector('[data-dash-widget="w1"]') as HTMLElement;
    await user.click(widget.querySelector('[data-dash-cycle]') as HTMLElement);
    // 맵의 크기 목록에서 2x2 다음은 3x2
    await waitFor(() => expect(savedDashboards()[0]?.items.find((it) => it.id === 'w1')?.size).toBe('3x2'));

    await user.click(widget.querySelector('[data-dash-remove]') as HTMLElement);
    await waitFor(() => expect(container.querySelectorAll('[data-dash-widget]').length).toBe(1));
    await waitFor(() => expect(savedDashboards()[0]?.items.map((it) => it.id)).toEqual(['w2']));
  });

  it('리사이즈 손잡이: 누르면 라이브 오버레이(크기 라벨)가 뜨고, 그대로 떼면 크기가 바뀌지 않는다', async () => {
    const user = userEvent.setup();
    const { container } = await openSeededDash();
    await user.click(screen.getByRole('button', { name: '편집' }));

    const widget = container.querySelector('[data-dash-widget="w1"]') as HTMLElement;
    fireEvent.mouseDown(widget.querySelector('[data-dash-resize]') as HTMLElement);
    expect(widget.querySelector('[data-dash-resizing]')?.textContent).toBe('2×2');
    fireEvent.mouseUp(window);
    expect(widget.querySelector('[data-dash-resizing]')).toBeNull();
    expect(savedDashboards()[0]?.items.find((it) => it.id === 'w1')?.size).toBe('2x2');
  });

  it('"열기" 버튼만 에디터로 연다 — 카드의 다른 곳·편집 중에는 열리지 않는다(요청)', async () => {
    const user = userEvent.setup();
    const { container } = await openSeededDash();
    const widget = container.querySelector('[data-dash-widget="w1"]') as HTMLElement;
    const loader = () => document.querySelector('[role="status"] [data-loader-spinner]');

    // 편집 중에는 "열기" 버튼 자체가 없다(그 시간의 클릭은 배치 조작이다)
    await user.click(screen.getByRole('button', { name: '편집' }));
    fireEvent.click(widget);
    expect(loader()).toBeNull();
    expect(within(widget).queryByRole('button', { name: '열기' })).toBeNull();
    await user.click(screen.getByRole('button', { name: '편집 끝내기' }));

    // 카드 어디를 눌러도(머리·몸통) 열리지 않는다
    fireEvent.click(widget);
    fireEvent.click(within(widget).getAllByText('기획맵')[0]!);
    expect(loader()).toBeNull();

    // "열기" 버튼만이 연다 — 스페이스의 카드와 **같은 길**(전체 화면 로더 → 이동).
    // 펼침 전환은 과하다는 판단으로 걷어냈다(요청) — 그 자국이 남지 않았는지도 본다.
    fireEvent.click(within(widget).getByRole('button', { name: '열기' }));
    expect(loader()).toBeTruthy();
    expect(screen.getByText('맵을 불러오고 있어요')).toBeTruthy();
    expect(document.querySelector('[data-dash-launch]')).toBeNull();
  });

  it('스켈레톤 → 실제 데이터 전환에 등장 애니메이션이 없다(제보: 깜빡이는 느낌)', async () => {
    seedTwoDashboards();
    sessionStorage.setItem('mf_active_view', JSON.stringify({ activeSpace: 's1', curFolder: null, activeDash: 'd1' }));
    const { container } = renderHome();
    const skel = container.querySelector('[data-dashboard-skeleton]') as HTMLElement;
    expect(skel.style.animation).toBe('');
    await waitFor(() => expect(container.querySelector('[data-dashboard-view]')).toBeTruthy());
    expect((container.querySelector('[data-dashboard-view]') as HTMLElement).style.animation).toBe('');
  });

  it('위젯에 hover 떠오름을 막을 인라인 transition이 없다(CSS 한 곳에서 정한다)', async () => {
    const { container } = await openSeededDash();
    const widget = container.querySelector('[data-dash-widget="w1"]') as HTMLElement;
    // 인라인 transition이 있으면 `.mf-dash-widget`의 transform 전이가 덮인다(홈 카드의 함정)
    expect(widget.style.transition).toBe('');
    expect(widget.className).toContain('mf-dash-widget');
  });

});

// ── 대시보드 ③ — 칸반 위젯 인라인 열 이동 ──────────────────────────────────

const KANBAN_BODY: LoadedDoc = {
  doc: {
    v: 1,
    kind: 'kanban',
    nodes: {},
    floats: [],
    lines: [],
    zones: [],
    layoutMode: 'right',
    // 실제 칸반 문서가 싣는 값 — 템플릿이 BOARD_THEME_KEY('white')를 관성적으로
    // 넣는다. 칸반 에디터는 이 값을 쓰지 않고 항상 UI_THEME으로 그린다.
    themeKey: 'white',
    columns: [
      { id: 'c1', title: '할 일' },
      { id: 'c2', title: '완료' },
    ],
    cards: [
      { id: 'k1', col: 'c1', pos: 1, text: '첫 카드' },
      { id: 'k2', col: 'c2', pos: 1, text: '둘째 카드' },
    ],
  } as unknown as LoadedDoc['doc'],
  version: 3,
  title: '스프린트',
};

/** 칸반 위젯 하나가 올라간 대시보드를 연 상태로 시작한다.
 * `mobile`이면 LNB가 서랍이라 햄버거로 먼저 연다. */
async function openKanbanDash(meta: DocMeta = META('doc-k', '스프린트'), mobile = false) {
  localStorage.setItem(
    'mf_spaces',
    JSON.stringify({
      spaces: [{ id: 's1', name: '일반 공간', home: true, color: '#f0663f', maps: meta.ownedByMe === false ? [] : [{ title: '스프린트', when: '방금', hue: '#8a63d2', docId: 'doc-k' }], folders: [] }],
      mapFolders: {},
      dashboards: [{ id: 'd1', name: '대시보드', items: [{ id: 'w1', docId: 'doc-k', size: '3x2' }] }],
    }),
  );
  const utils = renderHome([meta], { 'doc-k': KANBAN_BODY });
  if (mobile) {
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByRole('button', { name: /메뉴 열기/ })).toBeTruthy());
    await user.click(screen.getByRole('button', { name: /메뉴 열기/ }));
  }
  const aside = await sidebarOf(utils.container);
  const dashRow = within(aside)
    .getAllByRole('button')
    .find((el) => el.classList.contains('nav-item') && (el.textContent || '').includes('대시보드') && !(el.textContent || '').includes('새 대시보드')) as HTMLElement;
  fireEvent.click(dashRow);
  await waitFor(() => expect(utils.container.querySelector('[data-dash-card="k1"]')).toBeTruthy());
  return utils;
}

/** 카드를 다른 열로 끄는 세 이벤트 — 실사용자 드래그의 축약. */
/** jsdom엔 PointerEvent가 없다 — MouseEvent를 pointer 이름으로 던진다(에디터 테스트와 같은 처방). */
function firePointer(target: Element | Window, type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel', init: { clientX?: number; clientY?: number; pointerType?: string } = {}): void {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: init.clientX ?? 0, clientY: init.clientY ?? 0 });
  Object.defineProperty(ev, 'pointerType', { value: init.pointerType ?? 'mouse', configurable: true });
  Object.defineProperty(ev, 'pointerId', { value: 1, configurable: true });
  fireEvent(target as Element, ev);
}

/** jsdom은 레이아웃을 재지 않는다 — 위젯 안 열·카드 사각형을 심어 규칙을 검증한다.
 *  열 0: x 0~300 / 열 1: x 320~620, 카드는 y 50부터 48px 간격. */
function stubWidgetRects(container: HTMLElement): void {
  const put = (el: Element, r: { left: number; top: number; right: number; bottom: number }): void => {
    (el as HTMLElement).getBoundingClientRect = () => ({ ...r, x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top, toJSON: () => r }) as DOMRect;
  };
  const board = container.querySelector('[data-dash-kanban-board]');
  if (board) put(board, { left: 0, top: 0, right: 900, bottom: 600 });
  Array.from(container.querySelectorAll('[data-dash-col]')).forEach((colEl, i) => {
    const left = i * 320;
    put(colEl, { left, top: 0, right: left + 300, bottom: 600 });
    const list = colEl.querySelector('[data-dash-list]');
    if (list) put(list, { left, top: 40, right: left + 300, bottom: 600 });
    Array.from(colEl.querySelectorAll('[data-dash-card]')).forEach((cardEl, j) => {
      const top = 50 + j * 48;
      put(cardEl, { left: left + 10, top, right: left + 290, bottom: top + 40 });
    });
  });
}

/** 카드를 끌어 (x, y)에 놓는다 — 에디터와 같은 포인터 제스처. */
function dragCardToPoint(container: HTMLElement, cardId: string, x: number, y: number) {
  const card = container.querySelector(`[data-dash-card="${cardId}"]`) as HTMLElement;
  stubWidgetRects(container);
  firePointer(card, 'pointerdown', { clientX: 150, clientY: 70 });
  firePointer(window, 'pointermove', { clientX: 160, clientY: 80 }); // 4px 문턱을 넘겨 시작
  firePointer(window, 'pointermove', { clientX: x, clientY: y });
  firePointer(window, 'pointerup', { clientX: x, clientY: y });
}

/** 둘째 열(x 320~620)의 맨 위로 옮긴다. */
function dragCardTo(container: HTMLElement, cardId: string, colIndex = 1) {
  dragCardToPoint(container, cardId, colIndex * 320 + 150, 45);
}

describe('대시보드 ③ — 칸반 카드 이동', () => {
  it('칸반 위젯은 "카드 이동 가능" 배지, 맵 위젯은 "보기 전용" 그대로', async () => {
    const { container } = await openSeededDash(); // 맵 위젯 둘
    expect(container.querySelector('[data-dash-perm="view"]')).toBeTruthy();
    expect(container.querySelector('[data-dash-perm="move"]')).toBeNull();
    cleanup();
    localStorage.clear();

    const { container: c2 } = await openKanbanDash();
    const badge = c2.querySelector('[data-dash-perm="move"]') as HTMLElement;
    expect(badge?.textContent).toContain('카드 이동 가능');
    expect(badge?.getAttribute('title')).toContain('카드를 옮길 수 있어요');
  });

  it('카드를 다른 열에 놓으면 문서가 저장되고 위젯이 그 자리로 다시 그린다', async () => {
    const { container, docStore } = await openKanbanDash();
    stubWidgetRects(container);

    // 에디터와 같은 제스처 — 문턱을 넘으면 고스트가 뜨고, 놓일 자리에 점선 상자가 선다
    const card = container.querySelector('[data-dash-card="k1"]') as HTMLElement;
    firePointer(card, 'pointerdown', { clientX: 150, clientY: 70 });
    firePointer(window, 'pointermove', { clientX: 160, clientY: 80 });
    await waitFor(() => expect(document.querySelector('[data-dash-card-ghost]')).toBeTruthy());
    // 고스트의 **네 변이 모두** 강조색이다 — 예전엔 스프레드 키 순서 탓에 왼쪽만
    // 기본 테두리로 남아 "좌측 경계선이 잘려" 보였다(제보).
    const ghostEl = document.querySelector('[data-dash-card-ghost]') as HTMLElement;
    expect(ghostEl.style.borderTopColor).toBe('rgb(240, 102, 63)');
    expect(ghostEl.style.borderLeftColor).toBe('rgb(240, 102, 63)');
    firePointer(window, 'pointermove', { clientX: 470, clientY: 45 });
    const colB = container.querySelector('[data-dash-col="c2"]') as HTMLElement;
    await waitFor(() => expect(colB.querySelector('[data-dash-drop-slot]')).toBeTruthy());
    expect(colB.getAttribute('data-drop-hot')).toBe('true');
    // 끌고 있는 카드는 원래 목록에서 빠진다(에디터와 같은 모델)
    expect(container.querySelector('[data-dash-col="c1"] [data-dash-card="k1"]')).toBeNull();
    firePointer(window, 'pointerup', { clientX: 470, clientY: 45 });
    // 손을 떼면 고스트·놓일 자리는 사라진다
    await waitFor(() => expect(document.querySelector('[data-dash-card-ghost]')).toBeNull());

    // 낙관 반영 — 카드가 곧바로 완료 열 안에 그려진다
    await waitFor(() => {
      const col = container.querySelector('[data-dash-col="c2"]') as HTMLElement;
      expect(within(col).getByText('첫 카드')).toBeTruthy();
    });
    // 저장 — prevVersion 잠금 + 옮겨진 카드
    await waitFor(() => expect(docStore.save).toHaveBeenCalled());
    const [id, doc, opts] = docStore.save.mock.calls[0] as unknown as [string, { cards: { id: string; col: string }[] }, { prevVersion?: number }];
    expect(id).toBe('doc-k');
    expect(doc.cards.find((c) => c.id === 'k1')?.col).toBe('c2');
    expect(opts.prevVersion).toBe(3);
  });

  it('저장이 실패하면 카드를 되돌리고 안내한다(보기 전용 공유·연결 문제)', async () => {
    const { container, docStore } = await openKanbanDash();
    docStore.save.mockResolvedValueOnce({ ok: false, reason: 'error', message: 'nope' });

    dragCardTo(container, 'k1');

    await waitFor(() => expect(screen.getByText('카드를 옮기지 못했어요')).toBeTruthy());
    // 되돌림 — 카드가 다시 원래 열에
    const colA = container.querySelector('[data-dash-col="c1"]') as HTMLElement;
    expect(within(colA).getByText('첫 카드')).toBeTruthy();
  });

  it('충돌은 최신 판으로 한 번 다시 시도한다', async () => {
    const { container, docStore } = await openKanbanDash();
    docStore.save.mockResolvedValueOnce({ ok: false, reason: 'conflict', currentVersion: 4 });

    dragCardTo(container, 'k1');

    await waitFor(() => expect(docStore.save).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('카드를 옮기지 못했어요')).toBeNull();
  });

  it('터치는 길게 눌러야 잡힌다 — 그 전에 밀면 스크롤 의도(에디터와 같은 제스처)', async () => {
    {
      const { container, docStore } = await openKanbanDash();
      stubWidgetRects(container);
      const card = container.querySelector('[data-dash-card="k1"]') as HTMLElement;

      // ① 길게 누르기 전에 밀면 드래그가 아니다(목록 스크롤)
      firePointer(card, 'pointerdown', { clientX: 150, clientY: 70, pointerType: 'touch' });
      firePointer(window, 'pointermove', { clientX: 150, clientY: 110, pointerType: 'touch' });
      firePointer(window, 'pointerup', { clientX: 150, clientY: 110, pointerType: 'touch' });
      expect(document.querySelector('[data-dash-card-ghost]')).toBeNull();

      // ② 320ms 누르고 있으면 잡힌다 → 다른 열에 놓으면 저장된다
      firePointer(card, 'pointerdown', { clientX: 150, clientY: 70, pointerType: 'touch' });
      await new Promise((r) => setTimeout(r, 380)); // 길게 누르기(320ms)를 실제로 기다린다 — fake timer는 렌더 대기와 얽힌다
      firePointer(window, 'pointermove', { clientX: 470, clientY: 45, pointerType: 'touch' });
      expect(document.querySelector('[data-dash-card-ghost]')).toBeTruthy();
      firePointer(window, 'pointerup', { clientX: 470, clientY: 45, pointerType: 'touch' });
      await waitFor(() => expect(docStore.save).toHaveBeenCalled());
    }
  });

  it('보기 전용으로 공유받은 칸반은 배지도 드래그도 보기 전용', async () => {
    const { container } = await openKanbanDash({ ...META('doc-k', '스프린트'), ownedByMe: false, sharedRole: 'view' });
    expect(container.querySelector('[data-dash-perm="view"]')).toBeTruthy();
    expect(container.querySelector('[data-dash-perm="move"]')).toBeNull();
    dragCardTo(container, 'k1');
    expect(document.querySelector('[data-dash-card-ghost]')).toBeNull(); // 드래그 자체가 시작되지 않는다
  });

  it('배치 편집 모드에서는 카드 드래그가 꺼진다(그 시간의 드래그는 위젯 재배치)', async () => {
    const user = userEvent.setup();
    const { container } = await openKanbanDash();
    await user.click(screen.getByRole('button', { name: /^편집$/ }));
    dragCardTo(container, 'k1');
    expect(document.querySelector('[data-dash-card-ghost]')).toBeNull();
  });

  it('같은 열 안에서도 순서를 바꾼다 — 놓은 자리의 index가 그대로 저장된다(에디터와 같은 규칙)', async () => {
    const { container, docStore } = await openKanbanDash();
    stubWidgetRects(container);
    // 첫 열의 둘째 카드(k2)를 맨 위로
    const card = container.querySelector('[data-dash-card="k2"]') as HTMLElement;
    firePointer(card, 'pointerdown', { clientX: 150, clientY: 110 });
    firePointer(window, 'pointermove', { clientX: 150, clientY: 100 });
    firePointer(window, 'pointermove', { clientX: 150, clientY: 45 });
    firePointer(window, 'pointerup', { clientX: 150, clientY: 45 });

    await waitFor(() => expect(docStore.save).toHaveBeenCalled());
    const [, doc] = docStore.save.mock.calls[0] as unknown as [string, { cards: { id: string; col: string; pos: number }[] }];
    const first = doc.cards.filter((c) => c.col === 'c1').sort((a, b) => a.pos - b.pos);
    expect(first[0]?.id).toBe('k2');
  });

  it('위젯의 열·카드는 에디터 디자인 그대로 — 열 폭 308·CardFace 곁정보(기한·댓글·담당) 자리 유지(제보)', async () => {
    const { container } = await openKanbanDash();

    // 열 = 에디터 Column과 같은 스펙(실제 폭 + 그림자 + 머리의 점·제목·카드 수)
    const col = container.querySelector('[data-dash-col="c1"]') as HTMLElement;
    expect(col.style.width).toBe('308px');
    expect(col.style.boxShadow).toContain('40px'); // COL_SHADOW
    expect(within(col).getByText('할 일')).toBeTruthy();

    // 카드 = 에디터 CardFace 그대로 — 곁정보는 비어 있어도 자리를 지킨다(#448):
    // 기한 없음 → "날짜 없음", 댓글 0, 담당 없음 → 점선 원
    const card = container.querySelector('[data-dash-card="k1"]') as HTMLElement;
    expect(within(card).getByText('날짜 없음')).toBeTruthy();
    expect(card.querySelector('[data-card-comment-count="k1"]')?.textContent).toContain('0');
    expect(card.querySelector('[data-card-no-owner]')).toBeTruthy();

    // 색도 에디터 그대로(제보) — 칸반 에디터는 doc.themeKey('white')를 쓰지 않고
    // 항상 UI_THEME으로 그린다(스타일 메뉴가 없는 이유). 위젯이 themeKey를 읽으면
    // 열 점이 화이트 팔레트의 파랑(#2f7fd6)으로 갈라진다.
    const dot = col.querySelector('header span') as HTMLElement;
    expect(getComputedStyle(dot).backgroundColor).toBe('rgb(240, 102, 63)'); // UI_THEME.palette[0] = #f0663f
  });
});

// ── 대시보드 ④ — 모바일 다듬기 ────────────────────────────────────────────

describe('대시보드 ④ — 모바일 편집', () => {
  it('모바일: 편집은 탭으로 되는 것만 — 크기·내리기 버튼은 열리고 드래그·리사이즈·카드 이동은 없다', async () => {
    const restore = mockMatchMedia(true);
    try {
      const user = userEvent.setup();
      const { container } = await openKanbanDash(META('doc-k', '스프린트'), true);

      // 드래그가 에디터와 같은 포인터 제스처(길게 누르기)로 바뀌어 **터치에서도
      // 카드를 옮길 수 있다** — 그래서 배지도 '카드 이동 가능'이 정직하다.
      expect(container.querySelector('[data-dash-perm="move"]')).toBeTruthy();
      expect(container.querySelector('[data-dash-perm="view"]')).toBeNull();

      await user.click(screen.getByRole('button', { name: /^편집$/ }));
      // 안내 띠도 실제로 되는 조작만 말한다
      expect(screen.getByText(/길게 누르면 맨 앞으로/)).toBeTruthy();
      const widget = container.querySelector('[data-dash-widget="w1"]') as HTMLElement;
      expect(widget.getAttribute('draggable')).toBe('false');
      expect(widget.querySelector('[data-dash-resize]')).toBeNull();
      // 탭 기반 컨트롤은 열린다(30px 터치 타깃)
      expect(widget.querySelector('[data-dash-cycle]')).toBeTruthy();
      expect((widget.querySelector('[data-dash-remove]') as HTMLElement).style.width).toBe('30px');
    } finally {
      restore();
    }
  });
});

// ── 홈의 첫 화면 — 기본 대시보드(요청) ────────────────────────────────────

/** 대시보드 둘이 실린 워크스페이스(첫 번째가 '기본'). */
function seedTwoDashboards() {
  localStorage.setItem(
    'mf_spaces',
    JSON.stringify({
      spaces: [{ id: 's1', name: '일반 공간', home: true, color: '#f0663f', maps: [], folders: [] }],
      mapFolders: {},
      dashboards: [
        { id: 'd1', name: '기본 보드', items: [] },
        { id: 'd2', name: '둘째 보드', items: [] },
      ],
    }),
  );
}

describe('홈의 첫 화면', () => {
  it('첫 진입이면 기본 대시보드(맨 위)가 열린다', async () => {
    seedTwoDashboards();
    const { container } = renderHome();
    await waitFor(() => expect(container.querySelector('[data-dashboard-view]')).toBeTruthy());
    const dashView = container.querySelector('[data-dashboard-view]') as HTMLElement;
    expect(within(dashView).getByText('기본 보드')).toBeTruthy();
    // 스페이스 화면의 툴바(검색창)는 접혀 있다
    expect(screen.queryByPlaceholderText('모든 스페이스에서 검색')).toBeNull();
  });

  it('대시보드가 하나도 없으면 지금처럼 스페이스 그리드가 첫 화면(무회귀)', async () => {
    seedSpaces();
    const { container } = renderHome();
    await waitFor(() => expect(screen.getByPlaceholderText('모든 스페이스에서 검색')).toBeTruthy());
    expect(container.querySelector('[data-dashboard-view]')).toBeNull();
  });

  it('스페이스를 보다 나갔으면 그 스페이스로 돌아온다(대시보드로 가로채지 않는다)', async () => {
    seedTwoDashboards();
    // 이 탭이 기억한 마지막 화면 = 스페이스(대시보드 아님)
    sessionStorage.setItem('mf_active_view', JSON.stringify({ activeSpace: 's1', curFolder: null, activeDash: null }));
    const { container } = renderHome();
    await waitFor(() => expect(screen.getByPlaceholderText('모든 스페이스에서 검색')).toBeTruthy());
    expect(container.querySelector('[data-dashboard-view]')).toBeNull();
  });

  it('대시보드를 보다 나갔으면 **그** 대시보드로 돌아온다', async () => {
    seedTwoDashboards();
    sessionStorage.setItem('mf_active_view', JSON.stringify({ activeSpace: 's1', curFolder: null, activeDash: 'd2' }));
    const { container } = renderHome();
    await waitFor(() => expect(container.querySelector('[data-dashboard-view]')).toBeTruthy());
    expect(within(container.querySelector('[data-dashboard-view]') as HTMLElement).getByText('둘째 보드')).toBeTruthy();
  });

  it('기억한 대시보드가 사라졌으면 기본 대시보드로 물러선다(없는 화면을 열지 않는다)', async () => {
    seedTwoDashboards();
    sessionStorage.setItem('mf_active_view', JSON.stringify({ activeSpace: 's1', curFolder: null, activeDash: 'gone' }));
    const { container } = renderHome();
    await waitFor(() => expect(container.querySelector('[data-dashboard-view]')).toBeTruthy());
    expect(within(container.querySelector('[data-dashboard-view]') as HTMLElement).getByText('기본 보드')).toBeTruthy();
  });

  it('폰: 대시보드 히어로에도 ≡가 있어 서랍을 열 수 있다(첫 화면이 대시보드이므로)', async () => {
    const restore = mockMatchMedia(true);
    try {
      seedTwoDashboards();
      const user = userEvent.setup();
      const { container } = renderHome();
      await waitFor(() => expect(container.querySelector('[data-dashboard-view]')).toBeTruthy());
      const hamburger = screen.getByRole('button', { name: /메뉴 열기/ });
      expect((container.querySelector('[data-dashboard-view]') as HTMLElement).contains(hamburger)).toBe(true);
      await user.click(hamburger);
      const aside = container.querySelector('aside') as HTMLElement;
      await waitFor(() => expect(within(aside).getByText('일반 공간')).toBeTruthy());
    } finally {
      restore();
    }
  });
});

// ── 로그인 직후 첫 진입(제보) ──────────────────────────────────────────────

/** 갓 로그인한 탭 재현 — 마운트 하이드레이션은 인증 토큰 적용 **전에** 돌아
 *  워크스페이스를 못 읽고(null), 인증이 확인된 뒤의 재동기화가 실제 블롭을 준다. */
class RaceSpaceStore extends LocalSpaceStore {
  calls = 0;
  override async load() {
    this.calls += 1;
    if (this.calls === 1) return null; // RLS 스코프 조회가 빈손으로 돌아온 그 순간
    return super.load();
  }
}
/** 마운트 직후 세션을 확인해 주는 인증(재동기화 트리거). */
class SignedInAuth extends LocalAuth {
  override onAuthChange(listener: (session: { user: { id: string; email: string } } | null) => void): () => void {
    const t = setTimeout(() => listener({ user: { id: 'u1', email: 'demo@mindflow.local' } }), 0);
    return () => clearTimeout(t);
  }
}

describe('로그인 직후 홈 첫 진입', () => {
  it('마운트 때 워크스페이스를 못 읽었어도 인증 확인 재동기화에서 기본 대시보드를 연다', async () => {
    seedTwoDashboards();
    const { container } = renderHome([], {}, { spaceStore: new RaceSpaceStore(), auth: new SignedInAuth() as unknown as LocalAuth });

    await waitFor(() => expect(container.querySelector('[data-dashboard-view]')).toBeTruthy(), { timeout: 3000 });
    expect(within(container.querySelector('[data-dashboard-view]') as HTMLElement).getByText('기본 보드')).toBeTruthy();
  });

  it('로그인은 이 탭이 기억한 화면을 잊는다 — 만료 후 재로그인도 기본 대시보드', async () => {
    seedTwoDashboards();
    // 지난 세션에 스페이스를 보고 있었다(만료로 튕겨 나간 탭)
    sessionStorage.setItem('mf_active_view', JSON.stringify({ activeSpace: 's1', curFolder: null, activeDash: null }));
    clearActiveView(); // 로그인 성공 시 컨트롤러가 부르는 그 함수
    expect(sessionStorage.getItem('mf_active_view')).toBeNull();

    const { container } = renderHome();
    await waitFor(() => expect(container.querySelector('[data-dashboard-view]')).toBeTruthy());
    expect(within(container.querySelector('[data-dashboard-view]') as HTMLElement).getByText('기본 보드')).toBeTruthy();
  });
});

// ── 로딩 스켈레톤 모양(제보) ────────────────────────────────────────────────

describe('로딩 스켈레톤', () => {
  it('대시보드로 착지할 진입은 **대시보드 껍데기**로 로딩한다(스페이스 스켈레톤이 아니다)', async () => {
    seedTwoDashboards();
    // 이 탭이 대시보드를 보고 있었다 = 이번에도 대시보드로 착지한다
    sessionStorage.setItem('mf_active_view', JSON.stringify({ activeSpace: 's1', curFolder: null, activeDash: 'd1' }));
    const { container } = renderHome();

    // 첫 프레임 — 대시보드 껍데기, 스페이스의 카드 격자 스켈레톤은 없다
    expect(container.querySelector('[data-dashboard-skeleton]')).toBeTruthy();
    expect(container.querySelector('[data-map-grid-skeleton]')).toBeNull();
    // 로딩이 끝나면 진짜 대시보드로 바뀐다(껍데기는 사라진다)
    await waitFor(() => expect(container.querySelector('[data-dashboard-view]')).toBeTruthy());
    expect(container.querySelector('[data-dashboard-skeleton]')).toBeNull();
  });

  it('스페이스로 착지할 진입은 예전처럼 스페이스 스켈레톤(무회귀)', async () => {
    seedTwoDashboards();
    sessionStorage.setItem('mf_active_view', JSON.stringify({ activeSpace: 's1', curFolder: null, activeDash: null }));
    const { container } = renderHome();
    expect(container.querySelector('[data-dashboard-skeleton]')).toBeNull();
    await waitFor(() => expect(screen.getByPlaceholderText('모든 스페이스에서 검색')).toBeTruthy());
  });

  it('착지하면 이 기기에 힌트를 남긴다 — 다음 진입의 첫 프레임이 맞는 모양으로 시작한다', async () => {
    seedTwoDashboards();
    const { container } = renderHome();
    await waitFor(() => expect(container.querySelector('[data-dashboard-view]')).toBeTruthy());
    expect(localStorage.getItem('mf_home_landing')).toBe('dash');

    // 새 탭(세션 기억 없음)으로 다시 들어오면 힌트만으로 대시보드 껍데기가 뜬다
    cleanup();
    sessionStorage.clear();
    const again = renderHome();
    expect(again.container.querySelector('[data-dashboard-skeleton]')).toBeTruthy();
  });
});

// ── 영역 지정(마퀴)·크기 N×4 (제보·요청) ─────────────────────────────────────

describe('대시보드에서는 영역 지정을 하지 않는다(제보)', () => {
  /** 마퀴가 고르는 것은 맵·폴더 카드다 — 대시보드에는 그런 카드가 없고, 위젯 우측
   *  하단은 편집 모드의 리사이즈 손잡이라 조작이 겹친다. */
  const seedWidget = () => {
    localStorage.setItem(
      'mf_spaces',
      JSON.stringify({
        spaces: [{ id: 's1', name: '일반 공간', home: true, color: '#f0663f', maps: [{ title: '기획맵', when: '방금', hue: '#f0663f', docId: 'doc-a' }], folders: [] }],
        mapFolders: {},
        dashboards: [{ id: 'd1', name: '대시보드', items: [{ id: 'w1', docId: 'doc-a', size: '2x2' }] }],
      }),
    );
  };

  it('보기 상태에서 위젯 위를 끌어도 사각형이 뜨지 않는다', async () => {
    seedWidget();
    const { container } = renderHome([META('doc-a', '기획맵')], { 'doc-a': MAP_BODY });
    await waitFor(() => expect(container.querySelector('[data-dashboard-view]')).toBeTruthy());

    const main = container.querySelector('main') as HTMLElement;
    firePointer(main, 'pointerdown', { clientX: 400, clientY: 400 });
    firePointer(window, 'pointermove', { clientX: 700, clientY: 620 });
    expect(container.querySelector('[data-marquee]')).toBeNull();
    // 글자 선택 잠금도 걸지 않는다(마퀴를 시작하지 않았으므로)
    expect(document.body.classList.contains('mf-noselect')).toBe(false);
    firePointer(window, 'pointerup', {});
  });

  it('편집 모드(리사이즈 손잡이 자리)에서도 뜨지 않는다', async () => {
    seedWidget();
    const user = userEvent.setup();
    const { container } = renderHome([META('doc-a', '기획맵')], { 'doc-a': MAP_BODY });
    await waitFor(() => expect(container.querySelector('[data-dashboard-view]')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: '편집' }));

    const main = container.querySelector('main') as HTMLElement;
    firePointer(main, 'pointerdown', { clientX: 900, clientY: 500 });
    firePointer(window, 'pointermove', { clientX: 1200, clientY: 760 });
    expect(container.querySelector('[data-marquee]')).toBeNull();
    firePointer(window, 'pointerup', {});
  });
});

describe('보드 올리기 팝업 발치(제보: 크기 선택지가 늘며 버튼이 잘렸다)', () => {
  it('크기 칩과 "올리기"가 **다른 행**이라 선택지가 늘어도 넘치지 않는다', async () => {
    const user = userEvent.setup();
    const { container } = await openSeededDash();
    const aside = await sidebarOf(container);
    await createDashViaDialog(user, aside, '빈 보드'); // 아무것도 올리지 않은 대시보드
    await user.click(screen.getAllByRole('button', { name: '보드 추가' })[0]!);
    const dlg = await screen.findByRole('dialog', { name: '보드 올리기' });
    // 카드를 골라야 발치에 크기 칩이 뜬다
    await user.click(dlg.querySelector('[data-dash-pick-card="doc-a"]') as HTMLElement);

    const sizes = dlg.querySelector('[data-pick-sizes]') as HTMLElement;
    const row = dlg.querySelector('[data-pick-confirm-row]') as HTMLElement;
    expect(sizes).toBeTruthy();
    expect(row).toBeTruthy();
    // 칩 줄은 접히고(넘치면 다음 줄로), 버튼은 그 아래 행의 오른쪽 끝에 있다
    expect(sizes.style.flexWrap).toBe('wrap');
    expect(sizes.contains(row)).toBe(false);
    expect(within(row).getByRole('button', { name: '올리기' })).toBeTruthy();
    // 발치 자체가 세로 2행 — 한 줄에 몰면 칩 묶음이 버튼을 밀어낸다
    const footer = sizes.parentElement as HTMLElement;
    expect(footer.style.flexDirection).toBe('column');
    // 마인드맵은 11종이 모두 나온다(4행까지)
    expect(within(sizes).getAllByRole('button').length).toBeGreaterThanOrEqual(11);
    expect(within(sizes).getByRole('button', { name: '4×4' })).toBeTruthy();
  });
});

describe('위젯 hover 떠오름(요청)', () => {
  it('칸반 카드도 에디터와 같은 클래스로 반응한다(인라인 transition으로 덮지 않는다)', async () => {
    localStorage.setItem(
      'mf_spaces',
      JSON.stringify({
        spaces: [{ id: 's1', name: '일반 공간', home: true, color: '#f0663f', maps: [{ title: '칸반', when: '방금', hue: '#f0663f', docId: 'doc-k' }], folders: [] }],
        mapFolders: {},
        dashboards: [{ id: 'd1', name: '대시보드', items: [{ id: 'w1', docId: 'doc-k', size: '3x2' }] }],
      }),
    );
    const { container } = renderHome([META('doc-k', '칸반')], { 'doc-k': KANBAN_BODY });
    await waitFor(() => expect(container.querySelector('[data-dash-widget]')).toBeTruthy());
    const card = await waitFor(() => {
      const el = container.querySelector('[data-dash-widget] .mf-kb-card');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    // 에디터 카드와 같은 클래스 = 같은 규칙(떠오름·누름)이 걸린다
    expect(card.className).toContain('mf-kb-card');
    // 인라인 transition이 있으면 그 규칙의 transform 전이가 덮인다(홈 카드·위젯의 함정)
    expect(card.style.transition).toBe('');
  });

  it('칸반 카드 hover 규칙은 컴포넌트 곁 CSS에 있다 — editor.css에 두면 홈에서 죽는다', () => {
    const css = readFileSync(resolve('src/features/editor/components/kanbanCard.css'), 'utf8');
    const hover = css.slice(css.indexOf('.mf-kb-card:hover {'));
    expect(hover.slice(0, hover.indexOf('}'))).toContain('transform: translateY(-2px)');
    const base = css.slice(css.indexOf('.mf-kb-card {'));
    expect(base.slice(0, base.indexOf('}'))).toContain('transform 0.16s ease');
    // 그 규칙을 데려오는 곳 — 카드를 그리는 화면이면 어디서든 함께 온다
    const board = readFileSync(resolve('src/features/editor/components/KanbanBoard.tsx'), 'utf8');
    expect(board).toContain("import './kanbanCard.css'");
    // editor.css에는 남아 있지 않다(중복은 곧 드리프트)
    const editorCss = readFileSync(resolve('src/features/editor/editor.css'), 'utf8');
    expect(editorCss).not.toContain('.mf-kb-card:hover');
  });

  it('home.css가 홈 카드와 같은 문법으로 3px 떠오름을 정한다', () => {
    const css = readFileSync(resolve('src/features/home/home.css'), 'utf8');
    const hover = css.slice(css.indexOf('.mf-dash-widget:hover {'));
    const rule = hover.slice(0, hover.indexOf('}'));
    expect(rule).toContain('transform: translateY(-3px)');
    expect(rule).toContain('var(--mf-card-shadow-hover)');
    expect(rule).toContain('var(--mf-border-hover)');
    // transition은 규칙 쪽에 있어야 한다(없으면 A→B로 툭 바뀐다)
    const base = css.slice(css.indexOf('.mf-dash-widget {'));
    expect(base.slice(0, base.indexOf('}'))).toContain('transform 0.18s ease');
    // 움직임을 줄인 사용자에게는 떠오르지 않는다
    expect(css).toMatch(/prefers-reduced-motion[\s\S]*\.mf-dash-widget/);
  });
});

describe('위젯 크기 N×4(요청)', () => {
  it('크기 순환·메뉴 선택지에 4행이 있고, 고르면 그대로 저장된다', async () => {
    localStorage.setItem(
      'mf_spaces',
      JSON.stringify({
        spaces: [{ id: 's1', name: '일반 공간', home: true, color: '#f0663f', maps: [{ title: '기획맵', when: '방금', hue: '#f0663f', docId: 'doc-a' }], folders: [] }],
        mapFolders: {},
        dashboards: [{ id: 'd1', name: '대시보드', items: [{ id: 'w1', docId: 'doc-a', size: '2x2' }] }],
      }),
    );
    const { container } = renderHome([META('doc-a', '기획맵')], { 'doc-a': MAP_BODY });
    await waitFor(() => expect(container.querySelector('[data-dashboard-view]')).toBeTruthy());

    // 우클릭 메뉴의 크기 목록에 4행이 있다
    const widget = container.querySelector('[data-dash-widget]') as HTMLElement;
    fireEvent.contextMenu(widget, { clientX: 200, clientY: 200 });
    const menu = await screen.findByRole('menu');
    fireEvent.click(within(menu).getByText('크기'));
    const item = await screen.findByRole('menuitem', { name: '4×4' });
    fireEvent.click(item);

    await waitFor(() => expect(savedDashboards()[0]!.items[0]!.size).toBe('4x4'));
    // 저장값이 그대로 다시 읽힌다(선택지 목록에 없다고 2x2로 되돌아가지 않는다)
    expect(container.querySelector('[data-dash-widget]')).toBeTruthy();
  });
});

describe('대시보드 캘린더 위젯(PR4) — 크기가 보기를 정한다', () => {
  /** 오늘을 기준으로 만든 날짜 — 하드코딩하면 언젠가 과거가 되어 테스트가 흔들린다. */
  const dayLabel = (iso: string): string => {
    const p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)!;
    return `${+p[2]!}월 ${+p[3]!}일`;
  };
  /** 이 달 안에 머무는 날 — 미니 달력·격자는 이웃 달 칸을 누를 수 없다(월말 대비). */
  const shiftInMonth = (n: number): string => {
    const now = new Date();
    const fwd = new Date(now);
    fwd.setDate(fwd.getDate() + n);
    if (fwd.getMonth() === now.getMonth()) return isoOfLocal(fwd);
    const back = new Date(now);
    back.setDate(back.getDate() - n);
    return isoOfLocal(back);
  };
  const isoOfLocal = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const shift = (n: number): string => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const KANBAN = (cards: Record<string, unknown>[]): LoadedDoc => ({
    doc: {
      v: 1,
      kind: 'kanban',
      nodes: {},
      floats: [],
      lines: [],
      zones: [],
      layoutMode: 'right',
      themeKey: 'coral',
      columns: [{ id: 'c1', title: '할 일' }, { id: 'c2', title: '진행 중' }, { id: 'c3', title: '완료' }],
      cards,
    } as unknown as LoadedDoc['doc'],
    version: 1,
    title: '스프린트',
  });

  function seedWithCalWidget(size: string) {
    localStorage.setItem(
      'mf_spaces',
      JSON.stringify({
        spaces: [{ id: 's1', name: '일반 공간', home: true, color: '#f0663f', maps: [{ title: '스프린트', when: '방금', hue: '#f0663f', docId: 'doc-k' }], folders: [] }],
        mapFolders: {},
        dashboards: [{ id: 'd1', name: '이번 주', items: [{ id: 'w-cal', kind: 'cal', size }] }],
      }),
    );
  }

  const META = (id: string, title: string): DocMeta => ({ id, title, version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null });

  it('작은 위젯은 이번 주 마감 목록 — 다른 스페이스의 마감도 함께 모은다', async () => {
    seedWithCalWidget('2x1');
    const { container } = renderHome([META('doc-k', '스프린트')], {
      'doc-k': KANBAN([{ id: 'k1', col: 'c2', pos: 1, text: '릴리스 준비', due: shift(0) }]),
    });
    const aside = await sidebarOf(container);
    await userEvent.setup().click(within(aside).getByText('이번 주'));
    const widget = await waitFor(() => container.querySelector('[data-dash-widget]') as HTMLElement);
    // 머리는 '일정'이고 몸통은 목록 보기(작은 크기)
    expect(within(widget).getByText('일정')).toBeTruthy();
    await waitFor(() => expect(widget.querySelector('[data-cal-widget-list]')).toBeTruthy());
    expect(widget.querySelector('[data-cal-widget-week]')).toBeNull();
    await waitFor(() => expect(within(widget).getByText('릴리스 준비')).toBeTruthy());
  });

  it('2×2는 주간, 4×3은 월간 — 같은 위젯이 크기만으로 보기를 바꾼다', async () => {
    seedWithCalWidget('2x2');
    const { container, unmount } = renderHome([META('doc-k', '스프린트')], { 'doc-k': KANBAN([{ id: 'k1', col: 'c2', pos: 1, text: '릴리스 준비', due: shift(1) }]) });
    let aside = await sidebarOf(container);
    await userEvent.setup().click(within(aside).getByText('이번 주'));
    await waitFor(() => expect(container.querySelector('[data-cal-widget-week]')).toBeTruthy());
    unmount();

    seedWithCalWidget('4x3');
    const second = renderHome([META('doc-k', '스프린트')], { 'doc-k': KANBAN([{ id: 'k1', col: 'c2', pos: 1, text: '릴리스 준비', due: shift(1) }]) });
    aside = await sidebarOf(second.container);
    await userEvent.setup().click(within(aside).getByText('이번 주'));
    await waitFor(() => expect(second.container.querySelector('[data-cal-widget-month]')).toBeTruthy());
    // 월간에는 달 이동이 붙는다(보는 사람의 상태 — 문서에 저장하지 않는다)
    expect(second.container.querySelector('[aria-label="다음 달"]')).toBeTruthy();
    // 주간에는 옆 패널 토글이 없다(본문이 이미 날짜별 — 원본 calSideToggles)
    expect(container.querySelector('[data-cal-widget-side-btn="날짜별 보기"]')).toBeNull();
  });

  it('항목을 누르면 상세 팝업 — 대시보드에 머문다', async () => {
    seedWithCalWidget('2x1');
    const { container } = renderHome([META('doc-k', '스프린트')], { 'doc-k': KANBAN([{ id: 'k1', col: 'c2', pos: 1, text: '릴리스 준비', due: shift(0) }]) });
    const user = userEvent.setup();
    const aside = await sidebarOf(container);
    await user.click(within(aside).getByText('이번 주'));
    const widget = await waitFor(() => container.querySelector('[data-dash-widget]') as HTMLElement);
    await waitFor(() => expect(within(widget).getByText('릴리스 준비')).toBeTruthy());

    await user.click(widget.querySelector('[data-cal-widget-row]') as HTMLElement);
    // 일정 화면과 **같은 상세 팝업**이 뜨고, 화면은 대시보드 그대로다.
    await screen.findByRole('dialog', { name: '일정 상세' });
    expect(container.querySelector('[data-calendar-view]')).toBeNull();
    expect(container.querySelector('[data-dashboard-view]')).toBeTruthy();
  });

  it('날짜 칸을 눌러도 화면이 바뀌지 않는다 — 옆 패널이 그 날로 바뀐다(제보)', async () => {
    seedWithCalWidget('4x3');
    const { container } = renderHome([META('doc-k', '스프린트')], { 'doc-k': KANBAN([{ id: 'k1', col: 'c2', pos: 1, text: '릴리스 준비', due: shift(0) }]) });
    const user = userEvent.setup();
    const aside = await sidebarOf(container);
    await user.click(within(aside).getByText('이번 주'));
    const widget = await waitFor(() => container.querySelector('[data-cal-widget-month]') as HTMLElement);
    // 처음에는 다가오는 마감
    expect(widget.querySelector('[data-cal-widget-side="dl"]')).toBeTruthy();

    const iso = shift(0);
    await user.click(widget.querySelector(`[data-cal-widget-cell="${iso}"]`) as HTMLElement);
    // 옆 패널이 그 날로 — 일정 화면으로 떠나지 않는다
    await waitFor(() => expect(container.querySelector('[data-cal-widget-side="day"]')).toBeTruthy());
    expect(container.querySelector('[data-calendar-view]')).toBeNull();
    const p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)!;
    expect(within(container.querySelector('[data-cal-widget-side="day"]') as HTMLElement).getByText(`${+p[2]!}월 ${+p[3]!}일`)).toBeTruthy();
  });

  it('머리의 조작 묶음 — 새 일정·달 이동·옆 패널 토글(원본 calNav)', async () => {
    seedWithCalWidget('4x3');
    const { container } = renderHome([META('doc-k', '스프린트')], { 'doc-k': KANBAN([]) });
    const user = userEvent.setup();
    const aside = await sidebarOf(container);
    await user.click(within(aside).getByText('이번 주'));
    const widget = await waitFor(() => container.querySelector('[data-dash-widget]') as HTMLElement);
    expect(widget.querySelector('[data-cal-widget-new]')).toBeTruthy();
    expect(widget.querySelector('[aria-label="다음 달"]')).toBeTruthy();
    // 주간은 본문이 이미 날짜별이라 토글이 없다 — 월간에는 둘 다 있다
    expect(widget.querySelector('[data-cal-widget-side-btn="마감 목록"]')).toBeTruthy();

    await user.click(widget.querySelector('[data-cal-widget-side-btn="날짜별 보기"]') as HTMLElement);
    await waitFor(() => expect(container.querySelector('[data-cal-widget-side="day"]')).toBeTruthy());
    // 새 일정은 일정 화면과 같은 팝업
    await user.click(widget.querySelector('[data-cal-widget-new]') as HTMLElement);
    await screen.findByRole('dialog', { name: '새 일정' });
  });

  it('3열은 달력만 — 옆 패널도 토글도 없다(요청)', async () => {
    seedWithCalWidget('3x4');
    const { container } = renderHome([META('doc-k', '스프린트')], { 'doc-k': KANBAN([{ id: 'k1', col: 'c2', pos: 1, text: '릴리스 준비', due: shift(0) }]) });
    const user = userEvent.setup();
    const aside = await sidebarOf(container);
    await user.click(within(aside).getByText('이번 주'));
    const widget = await waitFor(() => container.querySelector('[data-cal-widget-month]') as HTMLElement);
    expect(widget.querySelector('[data-cal-widget-side]')).toBeNull();
    expect(container.querySelector('[data-cal-widget-side-btn="날짜별 보기"]')).toBeNull();
    // 보여 줄 자리가 없으므로 날짜 칸은 누를 대상이 아니다(죽은 어포던스 방지)
    expect(widget.querySelector(`button[data-cal-widget-cell="${shift(0)}"]`)).toBeNull();
    expect(widget.querySelector(`[data-cal-widget-cell="${shift(0)}"]`)).toBeTruthy();
  });

  it('1×4는 이번 주 마감 + 미니 달력 — 미니 달력이 목록의 날을 고른다(요청)', async () => {
    seedWithCalWidget('1x4');
    const { container } = renderHome([META('doc-k', '스프린트')], { 'doc-k': KANBAN([{ id: 'k1', col: 'c2', pos: 1, text: '릴리스 준비', due: shift(0) }]) });
    const user = userEvent.setup();
    const aside = await sidebarOf(container);
    await user.click(within(aside).getByText('이번 주'));
    const widget = await waitFor(() => container.querySelector('[data-cal-widget-listmini]') as HTMLElement);
    // 위는 마감 목록, 아래는 일정 화면과 **같은** 미니 달력
    await waitFor(() => expect(within(widget).getByText('릴리스 준비')).toBeTruthy());
    expect(widget.querySelector('[data-mini-cal]')).toBeTruthy();

    // 미니 달력에서 다른 날을 고르면 위 목록이 그 날로 바뀐다
    const other = shiftInMonth(2);
    await user.click(widget.querySelector(`[data-mini-day="${other}"]`) as HTMLElement);
    await waitFor(() => expect(within(widget).getByText(dayLabel(other))).toBeTruthy());
    expect(container.querySelector('[data-calendar-view]')).toBeNull();
  });

  it('날짜 칸에 테두리가 있고, 고른 날은 배경만 바뀐다(제보)', async () => {
    seedWithCalWidget('4x3');
    const { container } = renderHome([META('doc-k', '스프린트')], { 'doc-k': KANBAN([]) });
    const user = userEvent.setup();
    const aside = await sidebarOf(container);
    await user.click(within(aside).getByText('이번 주'));
    const widget = await waitFor(() => container.querySelector('[data-cal-widget-month]') as HTMLElement);
    // 이 달의 칸은 격자선을 가진다(예전엔 투명이라 격자가 사라져 보였다)
    const iso = shift(0);
    const cell = widget.querySelector(`[data-cal-widget-cell="${iso}"]`) as HTMLElement;
    const anyCell = [...widget.querySelectorAll('[data-cal-widget-cell]')].find((el) => (el as HTMLElement).style.border.includes('--mf-cal-grid'));
    expect(anyCell).toBeTruthy();
    // 고른 날은 **숫자 링**이 진다(큰 달력과 같은 규칙) — 칸 배경은 그대로다.
    const before = cell.style.background;
    await user.click(cell);
    await waitFor(() => expect(cell.getAttribute('data-on')).toBe('1'));
    expect(cell.style.background).toBe(before);
    const num = cell.querySelector('[data-cal-widget-num]') as HTMLElement;
    expect(num.dataset.selected).toBe('1');
    // 오늘은 채운 원이라 바깥 후광, 그 밖은 안쪽 링.
    expect(num.style.boxShadow).toContain('var(--mf-cal-ring)');
  });

  it('빈 날에는 안내만 — `일정 추가` 버튼을 두지 않는다(요청)', async () => {
    seedWithCalWidget('4x3');
    const { container } = renderHome([META('doc-k', '스프린트')], { 'doc-k': KANBAN([]) });
    const user = userEvent.setup();
    const aside = await sidebarOf(container);
    await user.click(within(aside).getByText('이번 주'));
    const widget = await waitFor(() => container.querySelector('[data-cal-widget-month]') as HTMLElement);
    await user.click(widget.querySelector(`[data-cal-widget-cell="${shift(0)}"]`) as HTMLElement);
    await waitFor(() => expect(container.querySelector('[data-cal-widget-side="day"]')).toBeTruthy());
    expect(within(container.querySelector('[data-cal-widget-side="day"]') as HTMLElement).getByText('이 날에는 일정이 없어요')).toBeTruthy();
    expect(container.querySelector('[data-cal-widget-daynew]')).toBeNull();
  });

  it('머리 버튼이 28px — 20px은 누르기 힘들다(제보)', async () => {
    seedWithCalWidget('4x3');
    const { container } = renderHome([META('doc-k', '스프린트')], { 'doc-k': KANBAN([]) });
    const user = userEvent.setup();
    const aside = await sidebarOf(container);
    await user.click(within(aside).getByText('이번 주'));
    const widget = await waitFor(() => container.querySelector('[data-dash-widget]') as HTMLElement);
    const add = widget.querySelector('[data-cal-widget-new]') as HTMLElement;
    expect(add.style.width).toBe('28px');
    expect((widget.querySelector('[aria-label="다음 달"]') as HTMLElement).style.height).toBe('28px');
  });

  it('날짜별 보기의 글자도 목록 줄과 같은 13px(제보: 일관되지 못하다)', async () => {
    seedWithCalWidget('4x4');
    const { container } = renderHome([META('doc-k', '스프린트')], {
      'doc-k': KANBAN([{ id: 'k1', col: 'c2', pos: 1, text: '릴리스 준비', due: shift(0) }]),
    });
    const user = userEvent.setup();
    const aside = await sidebarOf(container);
    await user.click(within(aside).getByText('이번 주'));
    await waitFor(() => expect(container.querySelector('[data-cal-widget-month]')).toBeTruthy());
    await user.click(container.querySelector('[data-cal-widget-side-btn="날짜별 보기"]') as HTMLElement);
    const row = await waitFor(() => container.querySelector('[data-cal-widget-allday]') as HTMLElement);
    const title = row.querySelector('[data-cal-widget-allday-title]') as HTMLElement;
    expect(title.style.fontSize).toBe('13px');
  });

  it('스크롤 썸은 네 곳 모두 늘 그려진다 — 호버 노출은 크롬에서 다시 칠해지지 않는다(제보)', () => {
    const css = readFileSync(resolve('src/features/home/home.css'), 'utf8');
    const thumb = css.slice(css.indexOf('.lnb-scroll::-webkit-scrollbar-thumb,'));
    const rule = thumb.slice(0, thumb.indexOf('}'));
    for (const cls of ['.notif-scroll', '.mf-recent-scroll', '.mf-cal-scroll']) expect(rule).toContain(`${cls}::-webkit-scrollbar-thumb`);
    expect(rule).toContain('background: var(--mf-scroll)');
    // 호버로 드러내는 규칙은 두지 않는다 — 동작하지 않는 약속을 남기면 다음 사람이 그걸 믿는다
    expect(css).not.toContain(':hover::-webkit-scrollbar-thumb');
    // 표준 속성은 Firefox 전용 블록 안에만(크롬 121+는 그게 있으면 웹킷 커스텀을 무시한다)
    expect(css).not.toMatch(/^\s{0,2}scrollbar-width:/m);
    const supports = css.slice(css.indexOf('@supports not selector(::-webkit-scrollbar) {'));
    expect(supports.slice(0, supports.indexOf('\n}'))).toContain('scrollbar-color: var(--mf-scroll) transparent');
  });

  it('날짜별 보기의 글자도 목록 줄과 같은 13px(제보: 일관되지 못하다)', async () => {
    seedWithCalWidget('4x4');
    const { container } = renderHome([META('doc-k', '스프린트')], {
      'doc-k': KANBAN([{ id: 'k1', col: 'c2', pos: 1, text: '릴리스 준비', due: shift(0) }]),
    });
    const user = userEvent.setup();
    const aside = await sidebarOf(container);
    await user.click(within(aside).getByText('이번 주'));
    await waitFor(() => expect(container.querySelector('[data-cal-widget-month]')).toBeTruthy());
    await user.click(container.querySelector('[data-cal-widget-side-btn="날짜별 보기"]') as HTMLElement);
    const row = await waitFor(() => container.querySelector('[data-cal-widget-allday]') as HTMLElement);
    const title = row.querySelector('[data-cal-widget-allday-title]') as HTMLElement;
    expect(title.style.fontSize).toBe('13px');
  });

  it('날짜별 시간표의 스크롤 썸은 늘 그려진다 — 호버 노출은 크롬에서 다시 칠해지지 않는다(제보)', () => {
    const css = readFileSync(resolve('src/features/home/home.css'), 'utf8');
    const thumb = css.slice(css.indexOf('.mf-cal-scroll::-webkit-scrollbar-thumb {'));
    expect(thumb.slice(0, thumb.indexOf('}'))).toContain('background: var(--mf-scroll)');
    // 호버로 드러내는 규칙은 두지 않는다 — 동작하지 않는 약속을 남기면 다음 사람이 그걸 믿는다
    expect(css).not.toContain('.mf-cal-scroll:hover::-webkit-scrollbar-thumb');
    // 표준 속성은 Firefox 전용 블록 안에만(크롬 121+는 그게 있으면 웹킷 커스텀을 무시한다)
    const std = css.indexOf('.mf-cal-scroll {\n    scrollbar-width');
    expect(std).toBeGreaterThan(css.indexOf('@supports not selector(::-webkit-scrollbar) {\n  .mf-cal-scroll'));
  });

  it('N×1로 줄이면 날짜별이 풀린다 — 고른 날에 갇히지 않는다(제보)', async () => {
    seedWithCalWidget('4x3');
    const { container } = renderHome([META('doc-k', '스프린트')], { 'doc-k': KANBAN([{ id: 'k1', col: 'c2', pos: 1, text: '릴리스 준비', due: shift(0) }]) });
    const user = userEvent.setup();
    const aside = await sidebarOf(container);
    await user.click(within(aside).getByText('이번 주'));
    const widget = await waitFor(() => container.querySelector('[data-cal-widget-month]') as HTMLElement);

    // 다른 날을 고른 뒤
    const other = shiftInMonth(2);
    await user.click(widget.querySelector(`[data-cal-widget-cell="${other}"]`) as HTMLElement);
    await waitFor(() => expect(container.querySelector('[data-cal-widget-side="day"]')).toBeTruthy());

    // 크기를 2×1로 줄이면 — 달력이 사라지므로 날짜별도 풀린다
    await user.click(container.querySelector('[data-dash-edit-toggle]') as HTMLElement);
    const cycle = () => container.querySelector('[data-dash-cycle]') as HTMLElement;
    for (let i = 0; i < 12 && !/2×1/.test(cycle().textContent ?? ''); i += 1) await user.click(cycle());
    await waitFor(() => expect(container.querySelector('[data-cal-widget-list]')).toBeTruthy());
    expect(within(container.querySelector('[data-cal-widget-list]') as HTMLElement).getByText('이번 주 마감')).toBeTruthy();
  });

  it('고른 날이 오늘이 아니면 `오늘`로 돌아갈 수 있다(제보)', async () => {
    seedWithCalWidget('4x3');
    const { container } = renderHome([META('doc-k', '스프린트')], { 'doc-k': KANBAN([]) });
    const user = userEvent.setup();
    const aside = await sidebarOf(container);
    await user.click(within(aside).getByText('이번 주'));
    const widget = await waitFor(() => container.querySelector('[data-cal-widget-month]') as HTMLElement);
    const other = shiftInMonth(2);
    await user.click(widget.querySelector(`[data-cal-widget-cell="${other}"]`) as HTMLElement);
    await waitFor(() => expect(within(container.querySelector('[data-cal-widget-side="day"]') as HTMLElement).getByText(dayLabel(other))).toBeTruthy());

    // 달은 그대로여도 `오늘` 버튼이 뜨고, 누르면 오늘로 돌아온다
    const today = container.querySelector('[data-cal-widget-today]') as HTMLElement;
    expect(today).toBeTruthy();
    await user.click(today);
    await waitFor(() => expect(within(container.querySelector('[data-cal-widget-side="day"]') as HTMLElement).getByText(dayLabel(shift(0)))).toBeTruthy());
  });

  it('1×1에서도 주를 넘기면 `오늘`이 뜬다 — 돌아올 길을 남긴다(제보)', async () => {
    seedWithCalWidget('1x1');
    const { container } = renderHome([META('doc-k', '스프린트')], { 'doc-k': KANBAN([]) });
    const user = userEvent.setup();
    const aside = await sidebarOf(container);
    await user.click(within(aside).getByText('이번 주'));
    await waitFor(() => expect(container.querySelector('[data-cal-widget-list]')).toBeTruthy());
    // 지금은 이번 주라 `오늘`이 없다
    expect(container.querySelector('[data-cal-widget-today]')).toBeNull();

    // 주를 넘기면 뜬다 — 예전엔 2열 미만이면 통째로 감춰 돌아올 길이 없었다
    await user.click(container.querySelector('[aria-label="다음 주"]') as HTMLElement);
    const today = await waitFor(() => container.querySelector('[data-cal-widget-today]') as HTMLElement);
    expect(today.textContent).toBe('오늘');
    await user.click(today);
    await waitFor(() => expect(container.querySelector('[data-cal-widget-today]')).toBeNull());
  });

  it('다른 주 목록은 `M월 N주 마감`으로 이름이 붙는다(요청)', async () => {
    seedWithCalWidget('2x1');
    const { container } = renderHome([META('doc-k', '스프린트')], { 'doc-k': KANBAN([]) });
    const user = userEvent.setup();
    const aside = await sidebarOf(container);
    await user.click(within(aside).getByText('이번 주'));
    const list = await waitFor(() => container.querySelector('[data-cal-widget-list]') as HTMLElement);
    expect(within(list).getByText('이번 주 마감')).toBeTruthy();

    // 다음 주로 넘기면 그 주의 이름 — `weekLabel`이 한 곳에서 만든다
    await user.click(container.querySelector('[aria-label="다음 주"]') as HTMLElement);
    const next = addDays(weekStartISO(shift(0)), 7);
    await waitFor(() => expect(within(container.querySelector('[data-cal-widget-list]') as HTMLElement).getByText(`${weekLabel(next)} 마감`)).toBeTruthy());
  });

  it('3×2·4×2에는 미니 달력 옆 패널이 붙고, 날을 고르면 그 주로 옮긴다(요청)', async () => {
    seedWithCalWidget('4x2');
    const { container } = renderHome([META('doc-k', '스프린트')], { 'doc-k': KANBAN([]) });
    const user = userEvent.setup();
    const aside = await sidebarOf(container);
    await user.click(within(aside).getByText('이번 주'));
    await waitFor(() => expect(container.querySelector('[data-cal-widget-week]')).toBeTruthy());
    const side = container.querySelector('[data-cal-widget-side="mini"]') as HTMLElement;
    expect(side).toBeTruthy();
    const mini = side.querySelector('[data-mini-cal]') as HTMLElement;
    expect(mini).toBeTruthy();
    // 옆 패널을 **꽉 채운다**(제보: 아래에 빈 여백이 남는다) — 여섯 줄이 남은 높이를
    // 나눠 갖고(1fr), 달력은 가로도 늘어난다.
    expect(mini.style.height).toBe('100%');
    expect(mini.style.flex).toContain('1');
    const grid = mini.querySelector('[data-mini-day]')!.parentElement as HTMLElement;
    expect(grid.style.gridTemplateRows).toContain('repeat(6, 1fr)');
    // 칸이 정사각에 가깝도록 배경(칸)이 아니라 **안쪽 원**이 오늘·고른 날을 진다
    expect(mini.querySelector('[data-mini-num]')).toBeTruthy();

    // 다음 주의 어느 날을 고르면 주간 본문이 그 주로 옮겨 간다
    const target = addDays(weekStartISO(shift(0)), 8);
    const btn = side.querySelector(`[data-mini-day="${target}"]`) as HTMLElement | null;
    if (btn) {
      await user.click(btn);
      await waitFor(() => expect(within(container.querySelector('[data-cal-widget-week]') as HTMLElement).getByText(new RegExp(weekLabel(target)))).toBeTruthy());
    }
  });

  it('피커 첫 칸이 일정 — 올리면 블롭에 `kind: cal`로 남고, 다시 누르면 내려간다', async () => {
    seedSpaces();
    localStorage.setItem(
      'mf_spaces',
      JSON.stringify({
        spaces: [{ id: 's1', name: '일반 공간', home: true, color: '#f0663f', maps: [], folders: [] }],
        mapFolders: {},
        dashboards: [{ id: 'd1', name: '이번 주', items: [] }],
      }),
    );
    const user = userEvent.setup();
    const { container } = renderHome();
    const aside = await sidebarOf(container);
    await user.click(within(aside).getByText('이번 주'));
    await user.click(screen.getAllByRole('button', { name: '보드 추가' })[0]!);
    const picker = await screen.findByRole('dialog', { name: '보드 올리기' });

    const calCard = picker.querySelector('[data-dash-pick-cal]') as HTMLElement;
    expect(calCard).toBeTruthy();
    await user.click(calCard);
    await user.click(within(picker).getByRole('button', { name: '올리기' }));
    await waitFor(() => expect(savedDashboards()[0]?.items).toEqual([expect.objectContaining({ kind: 'cal', size: '2x2' })]));
    // 올라간 뒤에는 "올림" 배지가 뜨고, 다시 누르면 내려간다(문서 카드와 같은 규칙)
    expect(calCard.querySelector('[data-dash-pick-on]')).toBeTruthy();
    await user.click(calCard);
    await waitFor(() => expect(savedDashboards()[0]?.items).toEqual([]));
  });
});

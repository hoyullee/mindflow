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
import { LocalImageStore } from '../../adapters/local/localImageStore';
import type { Backend, DocMeta, DocStore, LoadedDoc, SaveResult } from '../../adapters/ports';

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

function renderHome(metas: DocMeta[] = [], bodies: Record<string, LoadedDoc> = {}) {
  const docStore = new MockDocStore(metas, bodies);
  const backend: Backend = { auth: new LocalAuth(), docStore, spaceStore: new LocalSpaceStore(), shareStore: new LocalShareStore(), feedbackStore: new LocalFeedbackStore(), imageStore: new LocalImageStore(), commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(), mode: 'local' };
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
function savedDashboards(): { id: string; name: string; items: { id: string; docId: string; size: string }[] }[] {
  const ws = JSON.parse(localStorage.getItem('mf_spaces') || '{}') as { dashboards?: { id: string; name: string; items: { id: string; docId: string; size: string }[] }[] };
  return ws.dashboards ?? [];
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
    await user.click(within(aside).getByText('새 대시보드'));

    // 대시보드 화면으로 전환 — 스페이스의 툴바·그리드는 접힌다
    const dashView = container.querySelector('[data-dashboard-view]') as HTMLElement;
    expect(dashView).toBeTruthy();
    expect(within(dashView).getByText('아직 올려둔 보드가 없어요')).toBeTruthy();
    expect(screen.queryByPlaceholderText('모든 스페이스에서 검색')).toBeNull();

    // LNB 행 + 맨 위 = 기본 배지, 그리고 워크스페이스 블롭에 저장
    expect(within(aside).getByText('기본')).toBeTruthy();
    await waitFor(() => expect(savedDashboards().map((d) => d.name)).toEqual(['대시보드']));

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

    await user.click(within(aside).getByText('새 대시보드'));
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

  it('위젯 클릭 = 런치 전환(이름·"여는 중") — 편집 중에는 열리지 않는다', async () => {
    const user = userEvent.setup();
    const { container } = await openSeededDash();

    // 편집 중 클릭은 열지 않는다
    await user.click(screen.getByRole('button', { name: '편집' }));
    fireEvent.click(container.querySelector('[data-dash-widget="w1"]') as HTMLElement);
    // 포털(body)로 그려지므로 document에서 찾는다
    expect(document.querySelector('[data-dash-launch]')).toBeNull();
    await user.click(screen.getByRole('button', { name: '편집 끝내기' }));

    fireEvent.click(container.querySelector('[data-dash-widget="w1"]') as HTMLElement);
    const overlay = document.querySelector('[data-dash-launch]') as HTMLElement;
    expect(overlay).toBeTruthy();
    expect(overlay.textContent).toContain('기획맵');
    expect(overlay.textContent).toContain('여는 중');
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
function dragCardTo(container: HTMLElement, cardId: string, colId: string) {
  fireEvent.dragStart(container.querySelector(`[data-dash-card="${cardId}"]`) as HTMLElement);
  const col = container.querySelector(`[data-dash-col="${colId}"]`) as HTMLElement;
  fireEvent.dragOver(col);
  fireEvent.drop(col);
}

describe('대시보드 ③ — 칸반 카드 열 이동', () => {
  it('칸반 위젯은 "열 이동 가능" 배지, 맵 위젯은 "보기 전용" 그대로', async () => {
    const { container } = await openSeededDash(); // 맵 위젯 둘
    expect(container.querySelector('[data-dash-perm="view"]')).toBeTruthy();
    expect(container.querySelector('[data-dash-perm="move"]')).toBeNull();
    cleanup();
    localStorage.clear();

    const { container: c2 } = await openKanbanDash();
    const badge = c2.querySelector('[data-dash-perm="move"]') as HTMLElement;
    expect(badge?.textContent).toContain('열 이동 가능');
    expect(badge?.getAttribute('title')).toContain('카드의 열만 옮길 수 있어요');
  });

  it('카드를 다른 열에 놓으면 문서가 저장되고 위젯이 그 자리로 다시 그린다', async () => {
    const { container, docStore } = await openKanbanDash();

    // 드롭 대상 열 하이라이트
    fireEvent.dragStart(container.querySelector('[data-dash-card="k1"]') as HTMLElement);
    const colB = container.querySelector('[data-dash-col="c2"]') as HTMLElement;
    fireEvent.dragOver(colB);
    expect(colB.getAttribute('data-drop-hot')).toBe('true');
    fireEvent.drop(colB);

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

    dragCardTo(container, 'k1', 'c2');

    await waitFor(() => expect(screen.getByText('카드를 옮기지 못했어요')).toBeTruthy());
    // 되돌림 — 카드가 다시 원래 열에
    const colA = container.querySelector('[data-dash-col="c1"]') as HTMLElement;
    expect(within(colA).getByText('첫 카드')).toBeTruthy();
  });

  it('충돌은 최신 판으로 한 번 다시 시도한다', async () => {
    const { container, docStore } = await openKanbanDash();
    docStore.save.mockResolvedValueOnce({ ok: false, reason: 'conflict', currentVersion: 4 });

    dragCardTo(container, 'k1', 'c2');

    await waitFor(() => expect(docStore.save).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('카드를 옮기지 못했어요')).toBeNull();
  });

  it('보기 전용으로 공유받은 칸반은 배지도 드래그도 보기 전용', async () => {
    const { container } = await openKanbanDash({ ...META('doc-k', '스프린트'), ownedByMe: false, sharedRole: 'view' });
    expect(container.querySelector('[data-dash-perm="view"]')).toBeTruthy();
    expect(container.querySelector('[data-dash-perm="move"]')).toBeNull();
    expect((container.querySelector('[data-dash-card="k1"]') as HTMLElement).getAttribute('draggable')).toBe('false');
  });

  it('배치 편집 모드에서는 카드 드래그가 꺼진다(그 시간의 드래그는 위젯 재배치)', async () => {
    const user = userEvent.setup();
    const { container } = await openKanbanDash();
    await user.click(screen.getByRole('button', { name: /^편집$/ }));
    expect((container.querySelector('[data-dash-card="k1"]') as HTMLElement).getAttribute('draggable')).toBe('false');
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

      // 칸반이어도 모바일은 보기 전용 배지 — HTML5 드래그가 터치에서 발화하지
      // 않으므로 '열 이동 가능'은 거짓 약속이 된다
      expect(container.querySelector('[data-dash-perm="move"]')).toBeNull();
      expect(container.querySelector('[data-dash-perm="view"]')).toBeTruthy();
      expect((container.querySelector('[data-dash-card="k1"]') as HTMLElement).getAttribute('draggable')).toBe('false');

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

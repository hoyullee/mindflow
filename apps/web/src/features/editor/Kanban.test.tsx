// 칸반 — 세 번째 문서 종류(`kind: 'kanban'`). 캔버스가 아니라 열·카드 화면이고,
// 저장·공유·협업은 문서 기반이라 기존 경로를 그대로 탄다.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Editor } from './Editor';
import { mockMatchMedia } from '../../test/matchMedia';
import { UI_THEME, mixHex } from './theme';

/** 내려받은 파일 내용을 가로챈다 — jsdom에는 createObjectURL이 없다(다른 내보내기 테스트와 같은 처방). */
const dl = vi.hoisted(() => ({ files: [] as { name: string; data: string }[] }));
vi.mock('./download', () => ({
  downloadFile: (name: string, data: unknown) => {
    dl.files.push({ name, data: String(data) });
  },
}));

const KANBAN = {
  v: 1,
  nodes: {},
  floats: [],
  lines: [],
  zones: [],
  layoutMode: 'right',
  themeKey: 'white',
  kind: 'kanban',
  columns: [
    { id: 'c1', title: '할 일' },
    { id: 'c2', title: '진행 중' },
  ],
  cards: [
    { id: 'k1', col: 'c1', pos: 0, text: '첫 카드' },
    { id: 'k2', col: 'c1', pos: 1024, text: '둘째 카드' },
  ],
};

function renderEditor(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/editor" element={<Editor />} />
        <Route path="/home" element={<div>HOME_PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const saved = (id: string) => JSON.parse(localStorage.getItem(`mindflow_doc_${id}`) || 'null');

/** jsdom은 레이아웃을 재지 않는다 — 드래그가 읽는 사각형을 우리가 심어 준다.
 * 열은 가로로 나란히, 카드는 열 안에 세로로 쌓인 모양(실제 화면과 같은 배치). */
function stubRects(container: HTMLElement): void {
  const put = (el: Element, r: { left: number; top: number; right: number; bottom: number }): void => {
    (el as HTMLElement).getBoundingClientRect = () => ({ ...r, x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top, toJSON: () => r }) as DOMRect;
  };
  put(container.querySelector('[data-kanban-board]')!, { left: 0, top: 0, right: 900, bottom: 800 });
  Array.from(container.querySelectorAll('[data-kanban-column]')).forEach((colEl, i) => {
    const left = i * 320;
    put(colEl, { left, top: 0, right: left + 300, bottom: 800 });
    const list = colEl.querySelector('[data-kanban-list]');
    if (list) put(list, { left, top: 40, right: left + 300, bottom: 800 });
    Array.from(colEl.querySelectorAll('[data-kanban-card]')).forEach((cardEl, j) => {
      const top = 50 + j * 48;
      put(cardEl, { left: left + 10, top, right: left + 290, bottom: top + 40 });
    });
  });
}

/** jsdom엔 PointerEvent가 없다 — MouseEvent를 pointer 이름으로 던진다(다른 테스트와 같은 처방). */
function firePointer(target: Element | Window, type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel', init: { clientX?: number; clientY?: number; pointerType?: string } = {}): void {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: init.clientX ?? 0, clientY: init.clientY ?? 0 });
  Object.defineProperty(ev, 'pointerType', { value: init.pointerType ?? 'mouse', configurable: true });
  Object.defineProperty(ev, 'pointerId', { value: 1, configurable: true });
  fireEvent(target as Element, ev);
}

describe('칸반 에디터', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  it('열과 카드가 그려지고, 캔버스 UI(팬 레이어)는 없다', async () => {
    localStorage.setItem('mindflow_doc_kb1', JSON.stringify(KANBAN));
    const { container } = renderEditor('/editor?map=kb1&title=x');

    await waitFor(() => expect(container.querySelectorAll('[data-kanban-column]')).toHaveLength(2));
    expect(container.querySelectorAll('[data-kanban-card]')).toHaveLength(2);
    // 열 안 순서는 pos — 첫 카드가 위.
    // 곁정보(기한·댓글)는 비어 있어도 자리를 지킨다 — 제목만 떼어 본다.
    const texts = Array.from(container.querySelectorAll('[data-kanban-card] p')).map((e) => e.textContent);
    expect(texts).toEqual(['첫 카드', '둘째 카드']);
    // 카드 수 배지.
    expect(container.querySelector('[data-column-count="c1"]')?.textContent).toBe('2');
    expect(container.querySelector('[data-column-count="c2"]')?.textContent).toBe('0');
    // 캔버스가 아니다 — 팬 레이어·미니맵·그리기 도구가 없다.
    expect(container.querySelector('[data-pan-layer]')).toBeNull();
    expect(container.querySelector('[data-zoom-cluster]')).toBeNull();
    // 캔버스 전용 메뉴도 뜨지 않는다.
    expect(screen.queryByRole('button', { name: '삽입' })).toBeNull();
    expect(screen.queryByRole('button', { name: '스타일' })).toBeNull();
  });

  it('카드를 추가하고 글을 써서 확정하면 저장된다', async () => {
    localStorage.setItem('mindflow_doc_kb2', JSON.stringify(KANBAN));
    const { container } = renderEditor('/editor?map=kb2&title=x');
    await waitFor(() => expect(container.querySelector('[data-add-card="c2"]')).toBeTruthy());

    fireEvent.click(container.querySelector('[data-add-card="c2"]')!);
    // ＋를 누르면 열 안에 입력칸이 열린다(디자인 원본의 composer).
    const edit = await waitFor(() => {
      const el = container.querySelector('[data-card-composer-input]') as HTMLTextAreaElement;
      expect(el).toBeTruthy();
      return el;
    });
    fireEvent.change(edit, { target: { value: '새 할 일' } });
    fireEvent.keyDown(edit, { key: 'Enter' });
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });

    await waitFor(() => {
      const d = saved('kb2');
      expect(d.kind).toBe('kanban');
      const inC2 = d.cards.filter((c: { col: string }) => c.col === 'c2');
      expect(inC2).toHaveLength(1);
      expect(inC2[0].text).toBe('새 할 일');
    });
  });

  it('빈 입력은 카드를 만들지 않는다 — 실수로 연 컴포저가 빈 카드를 남기지 않는다', async () => {
    localStorage.setItem('mindflow_doc_kb3', JSON.stringify(KANBAN));
    const { container } = renderEditor('/editor?map=kb3&title=x');
    await waitFor(() => expect(container.querySelector('[data-add-card="c1"]')).toBeTruthy());

    fireEvent.click(container.querySelector('[data-add-card="c1"]')!);
    const edit = await waitFor(() => container.querySelector('[data-card-composer-input]') as HTMLTextAreaElement);
    fireEvent.keyDown(edit, { key: 'Enter' });
    await waitFor(() => expect(container.querySelector('[data-card-composer]')).toBeNull());
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });

    await waitFor(() => expect(saved('kb3').cards).toHaveLength(2));
  });

  it('카드를 두 번 눌러 상세에서 글을 고치고, 열 제목도 두 번 눌러 바꾼다', async () => {
    localStorage.setItem('mindflow_doc_kb4', JSON.stringify(KANBAN));
    const { container } = renderEditor('/editor?map=kb4&title=x');
    const card = await waitFor(() => container.querySelector('[data-kanban-card="k1"]') as HTMLElement);

    fireEvent.doubleClick(card);
    const edit = await waitFor(() => container.querySelector('[data-detail-title]') as HTMLTextAreaElement);
    fireEvent.change(edit, { target: { value: '고친 카드' } });
    fireEvent.keyDown(edit, { key: 'Enter' }); // 저장하고 닫힌다
    await waitFor(() => expect(container.querySelector('[data-card-detail]')).toBeNull());

    fireEvent.doubleClick(container.querySelector('[data-column-title="c1"]')!);
    const titleEdit = await waitFor(() => container.querySelector('[data-column-title-edit]') as HTMLInputElement);
    fireEvent.change(titleEdit, { target: { value: '백로그' } });
    fireEvent.keyDown(titleEdit, { key: 'Enter' });
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });

    await waitFor(() => {
      const d = saved('kb4');
      expect(d.cards.find((c: { id: string }) => c.id === 'k1').text).toBe('고친 카드');
      expect(d.columns[0].title).toBe('백로그');
    });
  });

  it('열을 추가·삭제한다 — 열을 지우면 그 안의 카드도 함께(undo 한 번으로 복구)', async () => {
    localStorage.setItem('mindflow_doc_kb5', JSON.stringify(KANBAN));
    const { container } = renderEditor('/editor?map=kb5&title=x');
    await waitFor(() => expect(container.querySelector('[data-add-column]')).toBeTruthy());

    fireEvent.click(container.querySelector('[data-add-column]')!);
    await waitFor(() => expect(container.querySelectorAll('[data-kanban-column]')).toHaveLength(3));

    fireEvent.click(container.querySelector('[data-column-menu="c1"]')!);
    fireEvent.click(await waitFor(() => container.querySelector('[data-delete-column="c1"]') as HTMLElement));
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => {
      const d = saved('kb5');
      expect(d.columns.map((c: { id: string }) => c.id)).not.toContain('c1');
      expect(d.cards).toHaveLength(0); // c1의 카드 둘이 함께 사라졌다
    });

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => {
      const d = saved('kb5');
      expect(d.columns.map((c: { id: string }) => c.id)).toContain('c1');
      expect(d.cards).toHaveLength(2);
    });
  });

  it('카드를 다른 열로 끌어다 놓으면 그 자리에 들어간다(M2)', async () => {
    localStorage.setItem('mindflow_doc_kb7', JSON.stringify(KANBAN));
    const { container } = renderEditor('/editor?map=kb7&title=x');
    await waitFor(() => expect(container.querySelectorAll('[data-kanban-card]')).toHaveLength(2));
    stubRects(container);

    const card = container.querySelector('[data-kanban-card="k1"]')!;
    firePointer(card, 'pointerdown', { clientX: 150, clientY: 70 });
    // 문턱을 넘어야 드래그가 시작된다.
    firePointer(window, 'pointermove', { clientX: 160, clientY: 80 });
    await waitFor(() => expect(container.querySelector('[data-kanban-ghost]')).toBeTruthy());
    // 두 번째 열(320~620)의 위쪽으로.
    firePointer(window, 'pointermove', { clientX: 470, clientY: 60 });
    await waitFor(() => expect(container.querySelector('[data-kanban-column="c2"] [data-kanban-drop-slot]')).toBeTruthy());
    firePointer(window, 'pointerup', { clientX: 470, clientY: 60 });

    // 고스트·놓일 자리는 손을 떼면 사라진다.
    await waitFor(() => expect(container.querySelector('[data-kanban-ghost]')).toBeNull());
    expect(container.querySelector('[data-kanban-drop-slot]')).toBeNull();

    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => {
      const d = saved('kb7');
      expect(d.cards.find((c: { id: string }) => c.id === 'k1').col).toBe('c2');
      expect(d.cards.find((c: { id: string }) => c.id === 'k2').col).toBe('c1');
    });
  });

  it('같은 열 안에서 순서를 바꾼다 — 끌던 카드는 자기 자리 때문에 밀리지 않는다', async () => {
    localStorage.setItem('mindflow_doc_kb8', JSON.stringify(KANBAN));
    const { container } = renderEditor('/editor?map=kb8&title=x');
    await waitFor(() => expect(container.querySelectorAll('[data-kanban-card]')).toHaveLength(2));
    stubRects(container);

    // 둘째 카드를 첫째 위로.
    const card = container.querySelector('[data-kanban-card="k2"]')!;
    firePointer(card, 'pointerdown', { clientX: 150, clientY: 118 });
    firePointer(window, 'pointermove', { clientX: 150, clientY: 108 });
    firePointer(window, 'pointermove', { clientX: 150, clientY: 55 });
    firePointer(window, 'pointerup', { clientX: 150, clientY: 55 });
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });

    await waitFor(() => {
      const d = saved('kb8');
      const inC1 = d.cards.filter((c: { col: string }) => c.col === 'c1').sort((a: { pos: number }, b: { pos: number }) => a.pos - b.pos);
      expect(inC1.map((c: { id: string }) => c.id)).toEqual(['k2', 'k1']);
    });
  });

  it('문턱을 넘지 않은 클릭은 드래그가 아니다(선택만) — 순서도 그대로', async () => {
    localStorage.setItem('mindflow_doc_kb9', JSON.stringify(KANBAN));
    const { container } = renderEditor('/editor?map=kb9&title=x');
    await waitFor(() => expect(container.querySelectorAll('[data-kanban-card]')).toHaveLength(2));
    stubRects(container);

    const card = container.querySelector('[data-kanban-card="k1"]')!;
    firePointer(card, 'pointerdown', { clientX: 150, clientY: 70 });
    firePointer(window, 'pointermove', { clientX: 151, clientY: 71 }); // 1px — 문턱 아래
    expect(container.querySelector('[data-kanban-ghost]')).toBeNull();
    firePointer(window, 'pointerup', { clientX: 151, clientY: 71 });

    expect(container.querySelector('[data-kanban-card="k1"]')?.getAttribute('data-selected')).toBe('1');
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => {
      const d = saved('kb9');
      expect(d.cards.map((c: { id: string }) => c.id)).toEqual(['k1', 'k2']);
      expect(d.cards.every((c: { col: string }) => c.col === 'c1')).toBe(true);
    });
  });

  it('tpl=kanban으로 열면 열 셋짜리 새 보드가 시드된다', async () => {
    const { container } = renderEditor('/editor?map=kb6&title=%EC%B9%B8%EB%B0%98&tpl=kanban&new=1');
    await waitFor(() => expect(container.querySelectorAll('[data-kanban-column]')).toHaveLength(3));
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => {
      const d = saved('kb6');
      expect(d.kind).toBe('kanban');
      expect(d.columns.map((c: { title: string }) => c.title)).toEqual(['할 일', '진행 중', '완료']);
      expect(d.nodes).toEqual({});
    });
  });
});

describe('칸반 — 카드 삭제(제보: 지울 방법이 없다)', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  it('상세의 삭제로 그 카드만 사라진다 — 카드 위에는 버튼을 두지 않는다(요청)', async () => {
    localStorage.setItem('mindflow_doc_kd1', JSON.stringify(KANBAN));
    const { container } = renderEditor('/editor?map=kd1&title=x');
    await waitFor(() => expect(container.querySelectorAll('[data-kanban-card]')).toHaveLength(2));

    // 카드 위 빠른 동작(‹ › ✕)은 없앴다 — 고른 뒤에도 뜨지 않는다.
    firePointer(container.querySelector('[data-kanban-card="k1"]')!, 'pointerdown', { clientX: 20, clientY: 60 });
    firePointer(window, 'pointerup', { clientX: 20, clientY: 60 });
    expect(container.querySelectorAll('[data-delete-card]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-card-prev]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-card-next]')).toHaveLength(0);

    fireEvent.doubleClick(container.querySelector('[data-kanban-card="k1"]')!);
    const detail = await waitFor(() => container.querySelector('[data-card-detail="k1"]') as HTMLElement);
    fireEvent.click(detail.querySelector('[data-detail-delete]')!);

    await waitFor(() => expect(container.querySelectorAll('[data-kanban-card]')).toHaveLength(1));
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => expect(saved('kd1').cards.map((c: { id: string }) => c.id)).toEqual(['k2']));
  });

  it('Delete 키로도 지운다 — undo 한 번에 돌아온다', async () => {
    localStorage.setItem('mindflow_doc_kd2', JSON.stringify(KANBAN));
    const { container } = renderEditor('/editor?map=kd2&title=x');
    await waitFor(() => expect(container.querySelectorAll('[data-kanban-card]')).toHaveLength(2));

    firePointer(container.querySelector('[data-kanban-card="k2"]')!, 'pointerdown', { clientX: 20, clientY: 100 });
    firePointer(window, 'pointerup', { clientX: 20, clientY: 100 });
    fireEvent.keyDown(window, { key: 'Delete' });
    await waitFor(() => expect(container.querySelectorAll('[data-kanban-card]')).toHaveLength(1));

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await waitFor(() => expect(container.querySelectorAll('[data-kanban-card]')).toHaveLength(2));
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => expect(saved('kd2').cards).toHaveLength(2));
  });

  it('보기 전용에서는 ✕도 Delete도 없다', async () => {
    localStorage.setItem('mindflow_doc_kd3', JSON.stringify(KANBAN));
    // 다른 사람의 문서 = 보기 전용(로컬 어댑터도 같은 판별 경로를 탄다).
    localStorage.setItem('mf_doc_shares', JSON.stringify([{ documentId: 'kd3', email: 'me@example.com', role: 'view', createdAt: '2026-01-01T00:00:00.000Z' }]));
    const { container } = renderEditor('/editor?map=kd3&title=x');
    await waitFor(() => expect(container.querySelectorAll('[data-kanban-card]')).toHaveLength(2));
    await waitFor(() => expect(screen.getAllByText('보기 전용').length).toBeGreaterThan(0));

    firePointer(container.querySelector('[data-kanban-card="k1"]')!, 'pointerdown', { clientX: 20, clientY: 60 });
    firePointer(window, 'pointerup', { clientX: 20, clientY: 60 });
    expect(container.querySelectorAll('[data-delete-card]')).toHaveLength(0);
    fireEvent.keyDown(window, { key: 'Delete' });
    await waitFor(() => expect(container.querySelectorAll('[data-kanban-card]')).toHaveLength(2));
  });
});

describe('칸반 — 내보내기(M3)', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
    dl.files.length = 0;
  });
  afterEach(cleanup);

  it('내보내기 메뉴에 그림 형식은 없고, Markdown이 열·카드 목록으로 나온다', async () => {
    localStorage.setItem('mindflow_doc_ke1', JSON.stringify(KANBAN));
    renderEditor('/editor?map=ke1&title=내 보드');
    await waitFor(() => expect(screen.getAllByText('첫 카드').length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole('button', { name: '내보내기' }));
    // 칸반에는 그릴 캔버스가 없다 — 그림 형식 셋은 내주지 않는다.
    await waitFor(() => expect(screen.queryByText('Markdown 개요 (.md)')).toBeTruthy());
    expect(screen.queryByText('PNG 이미지')).toBeNull();
    expect(screen.queryByText('SVG 이미지 (.svg)')).toBeNull();
    expect(screen.queryByText('PDF 문서 (.pdf)')).toBeNull();
    expect(screen.queryByText('JSON 파일 (.json)')).toBeTruthy();

    fireEvent.click(screen.getByText('Markdown 개요 (.md)'));
    await waitFor(() => expect(dl.files.length).toBe(1));
    const md = dl.files[0]!.data;
    expect(md).toContain('# 내 보드');
    expect(md).toContain('## 할 일');
    expect(md).toContain('- 첫 카드');
    expect(md).toContain('- 둘째 카드');
    expect(md).toContain('## 진행 중');
  });
});

describe('칸반 — 카드 댓글(M3)', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  /** 보드 전체 댓글 — 보드 머리의 아이콘 자리를 필터에 내줘서(요청) 보기 메뉴로 연다. */
  const openViaMenu = async (): Promise<HTMLElement> => {
    fireEvent.click(screen.getByRole('button', { name: '보기' }));
    const menu = await waitFor(() => document.querySelector('[data-anchored-menu]') as HTMLElement);
    fireEvent.click(within(menu).getByRole('button', { name: '보드 전체 댓글' }));
    return await screen.findByLabelText('댓글');
  };

  it('고른 카드가 대상이 되고, 남긴 댓글이 그 카드에 저장된다', async () => {
    localStorage.setItem('mindflow_doc_kc1', JSON.stringify(KANBAN));
    const { container } = renderEditor('/editor?map=kc1&title=x');
    await waitFor(() => expect(container.querySelectorAll('[data-kanban-card]')).toHaveLength(2));

    // 아무 카드도 고르지 않았으면 문서 전체(칸반에는 루트 주제가 없다).
    let panel = await openViaMenu();
    expect(within(panel).getByText('보드 전체')).toBeTruthy();

    // 카드를 고르면 패널이 따라간다.
    firePointer(container.querySelector('[data-kanban-card="k1"]')!, 'pointerdown', { clientX: 20, clientY: 60 });
    firePointer(window, 'pointerup', { clientX: 20, clientY: 60 });
    panel = await screen.findByLabelText('댓글');
    await waitFor(() => expect(within(panel).getByText('카드 · 첫 카드')).toBeTruthy());

    fireEvent.change(within(panel).getByLabelText('댓글 입력'), { target: { value: '이건 다음 스프린트로' } });
    fireEvent.click(within(panel).getByRole('button', { name: '남기기' }));
    await waitFor(() => expect(within(panel).getByText('이건 다음 스프린트로')).toBeTruthy());

    const stored = JSON.parse(localStorage.getItem('mf_comments') || '[]') as { documentId: string; nodeId: string }[];
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ documentId: 'kc1', nodeId: 'k1' });
  });

  it('카드마다 댓글 수가 보이고(없으면 0), 상세에서 그 카드의 논의가 열린다', async () => {
    localStorage.setItem('mindflow_doc_kc2', JSON.stringify(KANBAN));
    localStorage.setItem(
      'mf_comments',
      JSON.stringify([{ id: 'x1', documentId: 'kc2', nodeId: 'k2', authorName: '나', body: '이 문구 확인 부탁', createdAt: '2026-01-01T00:00:00.000Z' }]),
    );
    const { container } = renderEditor('/editor?map=kc2&title=x');
    // 곁정보는 비어 있어도 자리를 지킨다(요청) — 댓글이 없으면 0.
    await waitFor(() => expect(container.querySelector('[data-card-comment-count="k2"]')?.textContent).toContain('1'));
    expect(container.querySelector('[data-card-comment-count="k1"]')?.textContent).toContain('0');

    // 댓글은 **상세 안에서** 읽고 쓴다(요청) — 패널로 넘기지 않는다.
    fireEvent.doubleClick(container.querySelector('[data-kanban-card="k2"]')!);
    const detail = await waitFor(() => container.querySelector('[data-card-detail="k2"]') as HTMLElement);
    expect(within(detail).getByText('이 문구 확인 부탁')).toBeTruthy();
  });
});

describe('칸반 — 폰에서 잡은 카드의 세로 드래그(제보)', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  /** 길게 눌러 카드를 잡는다(터치 관례 — 320ms). */
  const hold = async (container: HTMLElement, id: string, x = 20, y = 60): Promise<void> => {
    stubRects(container);
    firePointer(container.querySelector(`[data-kanban-card="${id}"]`)!, 'pointerdown', { clientX: x, clientY: y, pointerType: 'touch' });
    await new Promise((r) => setTimeout(r, 400));
  };

  it('브라우저가 제스처를 취소하면 카드는 **제자리에 머문다** — 취소는 이동이 아니다', async () => {
    localStorage.setItem('mindflow_doc_kt1', JSON.stringify(KANBAN));
    const { container } = renderEditor('/editor?map=kt1&title=x');
    await waitFor(() => expect(container.querySelectorAll('[data-kanban-card]')).toHaveLength(2));

    await hold(container, 'k1');
    await waitFor(() => expect(container.querySelector('[data-kanban-ghost]')).toBeTruthy());
    // 아래로 끌다가 브라우저가 스크롤을 가져가 취소한다.
    firePointer(window, 'pointermove', { clientX: 20, clientY: 130, pointerType: 'touch' });
    firePointer(window, 'pointercancel', { clientX: 20, clientY: 130, pointerType: 'touch' });
    await waitFor(() => expect(container.querySelector('[data-kanban-ghost]')).toBeNull());

    // 화면 순서로 단정한다 — 저장을 기다리면 아직 안 쓰인 초기 본문이 그대로
    // 통과해 버려(둘 다 k1,k2) 가드가 되지 않는다.
    expect(Array.from(container.querySelectorAll('[data-kanban-card]')).map((e) => e.getAttribute('data-kanban-card'))).toEqual(['k1', 'k2']);
  });

  it('잡은 뒤의 touchmove를 막는다 — 그래야 브라우저가 세로 스크롤을 가져가지 않는다', async () => {
    localStorage.setItem('mindflow_doc_kt2', JSON.stringify(KANBAN));
    const { container } = renderEditor('/editor?map=kt2&title=x');
    await waitFor(() => expect(container.querySelectorAll('[data-kanban-card]')).toHaveLength(2));

    // 잡기 **전**의 세로 이동은 스크롤 의도다 — 막지 않는다.
    stubRects(container);
    firePointer(container.querySelector('[data-kanban-card="k1"]')!, 'pointerdown', { clientX: 20, clientY: 60, pointerType: 'touch' });
    const before = new Event('touchmove', { bubbles: true, cancelable: true });
    window.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(false);

    // 320ms 뒤 잡히면 그때부터 막는다.
    await new Promise((r) => setTimeout(r, 400));
    await waitFor(() => expect(container.querySelector('[data-kanban-ghost]')).toBeTruthy());
    const after = new Event('touchmove', { bubbles: true, cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(true);

    firePointer(window, 'pointerup', { clientX: 20, clientY: 60, pointerType: 'touch' });
  });
});

describe('칸반 — 드롭 위치 표시(점선 사각형)', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  it('선이 아니라 **점선 사각형**으로 자리를 가리킨다(요청)', async () => {
    localStorage.setItem('mindflow_doc_kg1', JSON.stringify(KANBAN));
    const { container } = renderEditor('/editor?map=kg1&title=x');
    await waitFor(() => expect(container.querySelectorAll('[data-kanban-card]')).toHaveLength(2));

    stubRects(container);
    firePointer(container.querySelector('[data-kanban-card="k1"]')!, 'pointerdown', { clientX: 20, clientY: 60 });
    firePointer(window, 'pointermove', { clientX: 20, clientY: 130 });
    const slot = await waitFor(() => {
      const el = container.querySelector('[data-kanban-drop-slot]') as HTMLElement;
      expect(el).toBeTruthy();
      return el;
    });

    // 카드 한 장이 들어갈 자리가 보이도록 **열 안**에 점선 상자를 끼운다(요청).
    expect(slot.closest('[data-kanban-list]')).toBeTruthy();
    expect(slot.style.border).toContain('dashed');
    expect(parseFloat(slot.style.borderRadius)).toBeGreaterThan(0);
    // 끌고 있는 카드는 자리를 비운다 — 그래야 열 크기가 놓일 자리에 맞게 재배열된다.
    expect(container.querySelector('[data-kanban-card="k1"]')).toBeNull();
  });
});

describe('칸반 — 열 순서 바꾸기', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  it('열 머리를 끌어 순서를 바꾸면 저장된다 — undo 한 번으로 되돌아온다', async () => {
    localStorage.setItem('mindflow_doc_kc1', JSON.stringify(KANBAN));
    const { container } = renderEditor('/editor?map=kc1&title=x');
    await waitFor(() => expect(container.querySelectorAll('[data-kanban-column]')).toHaveLength(2));

    stubRects(container);
    // c1의 머리를 잡아 c2의 중심(470) 오른쪽으로 끈다.
    firePointer(container.querySelector('[data-column-head="c1"]')!, 'pointerdown', { clientX: 40, clientY: 20 });
    firePointer(window, 'pointermove', { clientX: 500, clientY: 20 });
    await waitFor(() => expect(container.querySelector('[data-kanban-col-ghost]')).toBeTruthy());
    // 카드와 같은 규칙 — 원본은 목록에서 빠지고 그 자리에 점선 상자가 선다.
    expect(container.querySelector('[data-kanban-col-slot]')).toBeTruthy();
    expect(container.querySelector('[data-kanban-column="c1"]')).toBeNull();
    firePointer(window, 'pointerup', { clientX: 500, clientY: 20 });

    await waitFor(() => expect(Array.from(container.querySelectorAll('[data-kanban-column]')).map((e) => e.getAttribute('data-kanban-column'))).toEqual(['c2', 'c1']));
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => expect(saved('kc1').columns.map((c: { id: string }) => c.id)).toEqual(['c2', 'c1']));

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await waitFor(() => expect(Array.from(container.querySelectorAll('[data-kanban-column]')).map((e) => e.getAttribute('data-kanban-column'))).toEqual(['c1', 'c2']));
  });

  it('머리의 버튼에서 끌어도 열 드래그가 아니고, 제목 더블클릭 편집도 그대로다', async () => {
    localStorage.setItem('mindflow_doc_kc2', JSON.stringify(KANBAN));
    const { container } = renderEditor('/editor?map=kc2&title=x');
    await waitFor(() => expect(container.querySelectorAll('[data-kanban-column]')).toHaveLength(2));
    stubRects(container);

    firePointer(container.querySelector('[data-column-menu="c1"]')!, 'pointerdown', { clientX: 260, clientY: 20 });
    firePointer(window, 'pointermove', { clientX: 500, clientY: 20 });
    expect(container.querySelector('[data-kanban-col-ghost]')).toBeNull();
    firePointer(window, 'pointerup', { clientX: 500, clientY: 20 });

    fireEvent.doubleClick(container.querySelector('[data-column-title="c1"]')!);
    await waitFor(() => expect(container.querySelector('[data-column-title-edit]')).toBeTruthy());
  });
});

describe('칸반 — 카드 색 라벨', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  it('상세에서 색을 골라 칠하고, 다시 없앨 수 있다', async () => {
    localStorage.setItem('mindflow_doc_kl1', JSON.stringify(KANBAN));
    const { container } = renderEditor('/editor?map=kl1&title=x');
    await waitFor(() => expect(container.querySelectorAll('[data-kanban-card]')).toHaveLength(2));

    // 색은 카드 위가 아니라 **상세**에 있다(카드 위 빠른 동작은 ‹ › ✕ 셋뿐).
    expect(container.querySelector('[data-card-label="k1"]')).toBeNull();
    fireEvent.doubleClick(container.querySelector('[data-kanban-card="k1"]')!);
    const detail = await waitFor(() => container.querySelector('[data-card-detail="k1"]') as HTMLElement);

    fireEvent.click(within(detail).getByRole('button', { name: '색 파랑' }));
    await waitFor(() => expect((container.querySelector('[data-kanban-card="k1"]') as HTMLElement).style.background).toBeTruthy());
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => expect(saved('kl1').cards.find((c: { id: string }) => c.id === 'k1').bg).toBe('#edf4fc'));
    // 다른 카드는 그대로.
    expect(saved('kl1').cards.find((c: { id: string }) => c.id === 'k2').bg).toBeUndefined();

    // 없애면 **키가 사라진다**(빈 필드를 CRDT로 계속 흘리지 않게).
    fireEvent.click(within(detail).getByRole('button', { name: '색 없음' }));
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => expect('bg' in saved('kl1').cards.find((c: { id: string }) => c.id === 'k1')).toBe(false));
  });
});

describe('칸반 — 카드 서식(마크다운 단축·자동 링크)', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  const editCard = async (container: HTMLElement, id: string, value: string): Promise<void> => {
    fireEvent.doubleClick(container.querySelector(`[data-kanban-card="${id}"]`)!);
    const box = await waitFor(() => container.querySelector('[data-detail-title]') as HTMLTextAreaElement);
    fireEvent.change(box, { target: { value } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(container.querySelector('[data-card-detail]')).toBeNull());
  };

  it('확정하면 마커가 서식이 되고, URL은 링크가 된다', async () => {
    localStorage.setItem('mindflow_doc_kf1', JSON.stringify(KANBAN));
    const { container } = renderEditor('/editor?map=kf1&title=x');
    await waitFor(() => expect(container.querySelectorAll('[data-kanban-card]')).toHaveLength(2));

    await editCard(container, 'k1', '**중요** 확인 https://ex.com/a');
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => {
      const c = saved('kf1').cards.find((x: { id: string }) => x.id === 'k1');
      // 마커는 사라지고 서식만 남는다.
      expect(c.text).toBe('중요 확인 https://ex.com/a');
      expect(c.rich.some((r: { b?: boolean }) => r.b)).toBe(true);
      expect(c.rich.some((r: { href?: string }) => r.href === 'https://ex.com/a')).toBe(true);
    });
    // 화면도 서식대로 — 굵은 조각과 링크 조각이 있다.
    const card = container.querySelector('[data-kanban-card="k1"]') as HTMLElement;
    expect(Array.from(card.querySelectorAll('span')).some((el) => el.style.fontWeight === '800')).toBe(true);
    expect(card.querySelector('[data-href="https://ex.com/a"]')).toBeTruthy();
  });

  it('다시 열면 마크다운 원문으로 보이고, 그대로 확정하면 서식이 유지된다', async () => {
    localStorage.setItem('mindflow_doc_kf2', JSON.stringify(KANBAN));
    const { container } = renderEditor('/editor?map=kf2&title=x');
    await waitFor(() => expect(container.querySelectorAll('[data-kanban-card]')).toHaveLength(2));

    await editCard(container, 'k1', '~~취소~~ 그리고 *기울임*');

    fireEvent.doubleClick(container.querySelector('[data-kanban-card="k1"]')!);
    const box = await waitFor(() => container.querySelector('[data-detail-title]') as HTMLTextAreaElement);
    expect(box.value).toBe('~~취소~~ 그리고 *기울임*');
    fireEvent.keyDown(box, { key: 'Enter' });

    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => {
      const c = saved('kf2').cards.find((x: { id: string }) => x.id === 'k1');
      expect(c.rich.some((r: { s?: boolean }) => r.s)).toBe(true);
      expect(c.rich.some((r: { i?: boolean }) => r.i)).toBe(true);
    });
  });

  it('평문으로 고치면 rich 키가 사라진다', async () => {
    localStorage.setItem('mindflow_doc_kf3', JSON.stringify(KANBAN));
    const { container } = renderEditor('/editor?map=kf3&title=x');
    await waitFor(() => expect(container.querySelectorAll('[data-kanban-card]')).toHaveLength(2));

    await editCard(container, 'k1', '**굵게**');
    await editCard(container, 'k1', '그냥 글자');
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => expect('rich' in saved('kf3').cards.find((x: { id: string }) => x.id === 'k1')).toBe(false));
  });
});

describe('칸반 — 템플릿', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  it('tpl=kanban-sprint로 열면 그 열·카드로 시작한다', async () => {
    const { container } = renderEditor('/editor?map=kt1&title=스프린트&tpl=kanban-sprint&new=1');
    await waitFor(() => expect(container.querySelectorAll('[data-kanban-column]').length).toBeGreaterThan(3));
    const titles = Array.from(container.querySelectorAll('[data-column-title]')).map((e) => e.textContent);
    expect(titles).toEqual(['백로그', '이번 스프린트', '진행 중', '리뷰', '완료']);
    // 색 라벨이 걸린 카드가 실제로 칠해져 있다.
    const painted = Array.from(container.querySelectorAll('[data-kanban-card]')).filter((e) => (e as HTMLElement).style.background);
    expect(painted.length).toBeGreaterThan(0);

    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => {
      const d = saved('kt1');
      expect(d.kind).toBe('kanban');
      expect(d.columns).toHaveLength(5);
      expect(d.cards.length).toBeGreaterThan(0);
    });
  });

  it('저장된 본문이 있으면 템플릿을 무시한다 — 쓴 내용이 덮이지 않는다', async () => {
    localStorage.setItem('mindflow_doc_kt2', JSON.stringify(KANBAN));
    const { container } = renderEditor('/editor?map=kt2&title=x&tpl=kanban-sprint&new=1');
    await waitFor(() => expect(container.querySelectorAll('[data-kanban-column]')).toHaveLength(2));
    expect(Array.from(container.querySelectorAll('[data-column-title]')).map((e) => e.textContent)).toEqual(['할 일', '진행 중']);
  });
});

/**
 * 카드 곁정보와 보드 머리 — 디자인 원본(`Geurio 칸반보드.dc.html`) 이식분.
 */
describe('칸반 — 카드 상세(분류·기한·담당·긴급)', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  it('상세에서 분류·기한·긴급을 정하면 카드 앞면과 저장본에 반영된다', async () => {
    localStorage.setItem('mindflow_doc_km1', JSON.stringify(KANBAN));
    const { container } = renderEditor('/editor?map=km1&title=x');
    await waitFor(() => expect(container.querySelectorAll('[data-kanban-card]')).toHaveLength(2));

    fireEvent.doubleClick(container.querySelector('[data-kanban-card="k1"]')!);
    const detail = await waitFor(() => container.querySelector('[data-card-detail="k1"]') as HTMLElement);

    fireEvent.change(detail.querySelector('[data-detail-tag-input]')!, { target: { value: '개발' } });
    fireEvent.keyDown(detail.querySelector('[data-detail-tag-input]')!, { key: 'Enter' });
    fireEvent.change(detail.querySelector('[data-detail-due]')!, { target: { value: '2026-08-20' } });
    fireEvent.click(detail.querySelector('[data-detail-flag]')!);
    fireEvent.click(detail.querySelector('[data-detail-close]')!);

    // 카드 앞면 — 분류 배지·긴급 배지·기한
    const card = await waitFor(() => container.querySelector('[data-kanban-card="k1"]') as HTMLElement);
    expect(card.querySelector('[data-card-tag="개발"]')).toBeTruthy();
    expect(card.querySelector('[data-card-urgent="k1"]')).toBeTruthy();
    expect(card.querySelector('[data-card-due="k1"]')?.textContent).toContain('8월 20일');

    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => {
      const c = saved('km1').cards.find((x: { id: string }) => x.id === 'k1');
      expect(c).toMatchObject({ tag: '개발', due: '2026-08-20', flagged: true });
    });

    // 없애면 **키가 사라진다**(빈 필드를 CRDT로 흘리지 않게).
    fireEvent.doubleClick(container.querySelector('[data-kanban-card="k1"]')!);
    const again = await waitFor(() => container.querySelector('[data-card-detail="k1"]') as HTMLElement);
    fireEvent.click(again.querySelector('[data-detail-tag="none"]')!);
    fireEvent.click(again.querySelector('[data-detail-due-clear]')!);
    fireEvent.click(again.querySelector('[data-detail-flag]')!);
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => {
      const c = saved('km1').cards.find((x: { id: string }) => x.id === 'k1');
      expect('tag' in c).toBe(false);
      expect('due' in c).toBe(false);
      expect('flagged' in c).toBe(false);
    });
  });

  it('상태 칩으로 열을 옮기면 그 열의 맨 위로 간다', async () => {
    localStorage.setItem('mindflow_doc_km2', JSON.stringify(KANBAN));
    const { container } = renderEditor('/editor?map=km2&title=x');
    await waitFor(() => expect(container.querySelectorAll('[data-kanban-card]')).toHaveLength(2));

    fireEvent.doubleClick(container.querySelector('[data-kanban-card="k2"]')!);
    const detail = await waitFor(() => container.querySelector('[data-card-detail="k2"]') as HTMLElement);
    fireEvent.click(detail.querySelector('[data-detail-status="c2"]')!);
    fireEvent.click(detail.querySelector('[data-detail-close]')!);

    await waitFor(() => {
      const c2 = container.querySelector('[data-kanban-column="c2"]') as HTMLElement;
      expect(c2.querySelector('[data-kanban-card="k2"]')).toBeTruthy();
    });
    expect(container.querySelector('[data-column-count="c2"]')?.textContent).toBe('1');
  });

});

describe('칸반 — 보드 머리(검색·진행률)', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  it('검색은 화면에서만 거른다 — 문서는 그대로', async () => {
    localStorage.setItem('mindflow_doc_kq1', JSON.stringify(KANBAN));
    const { container } = renderEditor('/editor?map=kq1&title=x');
    await waitFor(() => expect(container.querySelectorAll('[data-kanban-card]')).toHaveLength(2));

    fireEvent.change(container.querySelector('[data-kanban-search]')!, { target: { value: '둘째' } });
    await waitFor(() => expect(container.querySelectorAll('[data-kanban-card]')).toHaveLength(1));
    // 걸리지 않은 열은 "검색 결과가 없어요"
    expect(container.querySelector('[data-column-empty="c2"]')?.textContent).toContain('조건에 맞는 카드가 없어요');
    // 열 머리의 수는 **문서의 수** 그대로(거른 결과가 아니다).
    expect(container.querySelector('[data-column-count="c1"]')?.textContent).toBe('2');

    fireEvent.change(container.querySelector('[data-kanban-search]')!, { target: { value: '' } });
    await waitFor(() => expect(container.querySelectorAll('[data-kanban-card]')).toHaveLength(2));
  });

  it('진행률 — 마지막 열이 완료다', async () => {
    localStorage.setItem('mindflow_doc_kq2', JSON.stringify(KANBAN));
    const { container } = renderEditor('/editor?map=kq2&title=x');
    await waitFor(() => expect(container.querySelector('[data-kanban-progress]')).toBeTruthy());
    expect(container.querySelector('[data-kanban-bar]')?.textContent).toContain('완료 0/2');

    // k1을 마지막 열(c2)로 옮기면 완료가 하나 는다.
    fireEvent.doubleClick(container.querySelector('[data-kanban-card="k1"]')!);
    const detail = await waitFor(() => container.querySelector('[data-card-detail="k1"]') as HTMLElement);
    fireEvent.click(detail.querySelector('[data-detail-status="c2"]')!);
    fireEvent.click(detail.querySelector('[data-detail-close]')!);
    await waitFor(() => expect(container.querySelector('[data-kanban-bar]')?.textContent).toContain('완료 1/2'));
    // 바는 **완료부터 왼쪽에서** 그린다(제보) — 첫 열(c1)은 아직 시작하지 않은
    // 일이라 빈 트랙으로 남는다. 색은 그 열의 머리 색(요청).
    const segs = Array.from(container.querySelectorAll('[data-progress-seg]')).map((e) => ({ col: e.getAttribute('data-progress-seg'), w: (e as HTMLElement).style.width }));
    expect(segs).toEqual([{ col: 'c2', w: '50%' }]);
    const dot = (container.querySelector('[data-column-dot="c2"]') as HTMLElement).style.background;
    expect((container.querySelector('[data-progress-seg="c2"]') as HTMLElement).style.background).toBe(dot);
  });

  it('열 메뉴에서 색을 고르면 머리 점이 그 색이 된다', async () => {
    localStorage.setItem('mindflow_doc_kq3', JSON.stringify(KANBAN));
    const { container } = renderEditor('/editor?map=kq3&title=x');
    await waitFor(() => expect(container.querySelector('[data-column-menu="c1"]')).toBeTruthy());

    fireEvent.click(container.querySelector('[data-column-menu="c1"]')!);
    const menu = await screen.findByRole('menu', { name: /열 메뉴/ });
    const swatch = within(menu).getAllByRole('menuitem').find((el) => (el.getAttribute('data-column-color') || '').startsWith('#')) as HTMLElement;
    const color = swatch.getAttribute('data-column-color') as string;
    fireEvent.click(swatch);

    await waitFor(() => expect((container.querySelector('[data-column-dot="c1"]') as HTMLElement).style.background).toBeTruthy());
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => expect(saved('kq3').columns.find((c: { id: string }) => c.id === 'c1').color).toBe(color));
  });
});

describe('칸반 — 리스트·타임라인 보기', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  /** 기한이 붙은 카드가 있는 보드 — 오늘 기준 상대 날짜로 심는다. */
  const withDue = () => {
    const iso = (d: number): string => {
      const t = new Date();
      const x = new Date(t.getFullYear(), t.getMonth(), t.getDate() + d);
      return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    };
    return {
      ...KANBAN,
      cards: [
        { id: 'k1', col: 'c1', pos: 0, text: '첫 카드', tag: '개발', due: iso(2), owner: 'a@ex.com', ownerName: '지수' },
        { id: 'k2', col: 'c1', pos: 1024, text: '둘째 카드' },
        { id: 'k3', col: 'c2', pos: 0, text: '늦은 카드', due: iso(-2) },
      ],
    };
  };

  it('리스트 보기 — 열별로 묶어 한 줄씩, 누르면 상세가 열린다', async () => {
    localStorage.setItem('mindflow_doc_kv1', JSON.stringify(withDue()));
    const { container } = renderEditor('/editor?map=kv1&title=x');
    await waitFor(() => expect(container.querySelector('[data-kanban-tab="list"]')).toBeTruthy());

    fireEvent.click(container.querySelector('[data-kanban-tab="list"]')!);
    const list = await waitFor(() => container.querySelector('[data-kanban-list-view]') as HTMLElement);
    // 보드는 감춰지고(열 자체는 남아 있어도 화면에 없다) 리스트가 뜬다.
    expect((container.querySelector('[data-kanban-board]') as HTMLElement).style.display).toBe('none');
    expect(list.querySelectorAll('[data-list-row]')).toHaveLength(3);
    expect(list.querySelector('[data-list-group="c1"]')?.textContent).toContain('할 일');
    expect(list.querySelector('[data-list-row="k1"]')?.textContent).toContain('첫 카드');

    fireEvent.click(list.querySelector('[data-list-row="k1"]')!);
    await waitFor(() => expect(container.querySelector('[data-card-detail="k1"]')).toBeTruthy());
  });

  it('타임라인 보기 — 기한이 있는 카드만 막대로, 없는 카드 수는 밝힌다', async () => {
    localStorage.setItem('mindflow_doc_kv2', JSON.stringify(withDue()));
    const { container } = renderEditor('/editor?map=kv2&title=x');
    await waitFor(() => expect(container.querySelector('[data-kanban-tab="timeline"]')).toBeTruthy());

    fireEvent.click(container.querySelector('[data-kanban-tab="timeline"]')!);
    const tl = await waitFor(() => container.querySelector('[data-kanban-timeline]') as HTMLElement);
    expect(tl.querySelectorAll('[data-timeline-day]')).toHaveLength(14);
    expect(tl.querySelectorAll('[data-timeline-row]')).toHaveLength(2); // 기한 있는 둘
    expect(tl.querySelector('[data-timeline-nodue]')?.textContent).toContain('1장');

    // 막대는 오늘부터 기한까지 — 늦은 카드는 오늘 왼쪽에서 시작한다.
    const bar = tl.querySelector('[data-timeline-bar="k3"]') as HTMLElement;
    expect(parseFloat(bar.style.left)).toBeLessThan((3 / 14) * 100 + 0.01);
    expect(parseFloat(bar.style.width)).toBeGreaterThan(0);
    // k3은 **마지막 열**의 카드다 — 기한이 지났어도 붉게 칠하지 않는다(끝난 일).
    expect(bar.style.border).toContain('rgba'); // 색이 실제로 인라인에 실렸다
    expect(bar.style.border).not.toContain('217, 83, 79');

    fireEvent.click(tl.querySelector('[data-timeline-row="k1"]')!);
    await waitFor(() => expect(container.querySelector('[data-card-detail="k1"]')).toBeTruthy());
  });

  it('검색은 세 보기에 함께 걸린다', async () => {
    localStorage.setItem('mindflow_doc_kv3', JSON.stringify(withDue()));
    const { container } = renderEditor('/editor?map=kv3&title=x');
    await waitFor(() => expect(container.querySelector('[data-kanban-search]')).toBeTruthy());

    fireEvent.change(container.querySelector('[data-kanban-search]')!, { target: { value: '늦은' } });
    fireEvent.click(container.querySelector('[data-kanban-tab="list"]')!);
    await waitFor(() => expect(container.querySelectorAll('[data-list-row]')).toHaveLength(1));
    expect(container.querySelector('[data-list-empty="c1"]')?.textContent).toContain('조건에 맞는 카드가 없어요');

    fireEvent.click(container.querySelector('[data-kanban-tab="timeline"]')!);
    await waitFor(() => expect(container.querySelectorAll('[data-timeline-row]')).toHaveLength(1));
  });

  it('보기 모드는 문서에 저장되지 않는다 — 보는 사람의 상태다', async () => {
    localStorage.setItem('mindflow_doc_kv4', JSON.stringify(withDue()));
    const { container } = renderEditor('/editor?map=kv4&title=x');
    await waitFor(() => expect(container.querySelector('[data-kanban-tab="list"]')).toBeTruthy());
    const before = localStorage.getItem('mindflow_doc_kv4');

    fireEvent.click(container.querySelector('[data-kanban-tab="list"]')!);
    await waitFor(() => expect(container.querySelector('[data-kanban-list-view]')).toBeTruthy());
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await new Promise((r) => setTimeout(r, 60));
    expect(localStorage.getItem('mindflow_doc_kv4')).toBe(before);
  });
});

/** 디자인 이식 후속(요청 12건) — 열 높이·기본 담당·분류 목록·GNB. */
describe('칸반 — 후속 요청', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  it('열은 내용만큼만 높다 — 화면 끝까지 늘어나지 않는다', async () => {
    localStorage.setItem('mindflow_doc_kr1', JSON.stringify(KANBAN));
    const { container } = renderEditor('/editor?map=kr1&title=x');
    const col = await waitFor(() => container.querySelector('[data-kanban-column="c1"]') as HTMLElement);
    expect(col.style.alignSelf).toBe('flex-start');
    // 카드 목록은 남는 공간을 채우지 않는다(넘칠 때만 스크롤).
    expect((col.querySelector('[data-kanban-list]') as HTMLElement).style.flex).toBe('0 1 auto');
  });

  it('새 카드의 담당은 나 자신이다 — 카드 앞면에도 아바타가 뜬다', async () => {
    localStorage.setItem('mindflow_doc_kr2', JSON.stringify(KANBAN));
    const { container } = renderEditor('/editor?map=kr2&title=x');
    await waitFor(() => expect(container.querySelector('[data-add-card="c2"]')).toBeTruthy());

    fireEvent.click(container.querySelector('[data-add-card="c2"]')!);
    const box = await waitFor(() => container.querySelector('[data-card-composer-input]') as HTMLTextAreaElement);
    fireEvent.change(box, { target: { value: '내가 맡을 일' } });
    fireEvent.keyDown(box, { key: 'Enter' });

    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => {
      const c = saved('kr2').cards.find((x: { col: string }) => x.col === 'c2');
      expect(c.owner).toBe('me@example.com');
      expect(c.ownerName).toBeTruthy();
    });
    expect(container.querySelector('[data-avatar="me@example.com"]')).toBeTruthy();
  });

  it('곁정보는 비어 있어도 자리를 지킨다 — 날짜 없음·댓글 0·담당 없음 아이콘', async () => {
    localStorage.setItem('mindflow_doc_kr3', JSON.stringify(KANBAN));
    const { container } = renderEditor('/editor?map=kr3&title=x');
    const card = await waitFor(() => container.querySelector('[data-kanban-card="k1"]') as HTMLElement);
    expect(card.querySelector('[data-card-due="k1"]')?.textContent).toContain('날짜 없음');
    expect(card.querySelector('[data-card-comment-count="k1"]')?.textContent).toContain('0');
    expect(card.querySelector('[data-card-no-owner]')).toBeTruthy();
  });

  it('분류는 없음뿐 — 직접 만들면 목록에 남고, 색을 고르거나 지울 수 있다', async () => {
    localStorage.setItem('mindflow_doc_kr4', JSON.stringify(KANBAN));
    const { container } = renderEditor('/editor?map=kr4&title=x');
    await waitFor(() => expect(container.querySelectorAll('[data-kanban-card]')).toHaveLength(2));

    fireEvent.doubleClick(container.querySelector('[data-kanban-card="k1"]')!);
    const detail = await waitFor(() => container.querySelector('[data-card-detail="k1"]') as HTMLElement);
    // 기본 분류는 없다(요청) — '없음'과 직접 입력뿐.
    expect(detail.querySelectorAll('[data-detail-tag-wrap]')).toHaveLength(0);

    fireEvent.change(detail.querySelector('[data-detail-tag-input]')!, { target: { value: '리서치' } });
    fireEvent.keyDown(detail.querySelector('[data-detail-tag-input]')!, { key: 'Enter' });
    await waitFor(() => expect(detail.querySelector('[data-detail-tag="리서치"]')).toBeTruthy());

    // 색을 고르면 문서의 분류 목록에 저장된다.
    const swatch = await waitFor(() => detail.querySelector('[data-tag-color^="#"]') as HTMLElement);
    const color = swatch.getAttribute('data-tag-color') as string;
    fireEvent.click(swatch);
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => {
      const d = saved('kr4');
      expect(d.tags[0]).toMatchObject({ name: '리서치', color });
      expect(d.cards.find((c: { id: string }) => c.id === 'k1').tag).toBe('리서치');
    });

    // 분류를 지우면 그 분류를 쓰던 카드의 tag도 함께 떨어진다(유령 방지).
    fireEvent.click(detail.querySelector('[data-detail-tag-remove="리서치"]')!);
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => {
      const d = saved('kr4');
      expect(d.tags).toHaveLength(0);
      expect('tag' in d.cards.find((c: { id: string }) => c.id === 'k1')).toBe(false);
    });
  });

  it('GNB — 보기 메뉴는 세 보기뿐이고, 도움말 메뉴가 단축키 도움말을 연다', async () => {
    localStorage.setItem('mindflow_doc_kr5', JSON.stringify(KANBAN));
    const { container } = renderEditor('/editor?map=kr5&title=x');
    await waitFor(() => expect(container.querySelectorAll('[data-kanban-card]')).toHaveLength(2));

    fireEvent.click(screen.getByRole('button', { name: '보기' }));
    // 캔버스의 항목(맵·아웃라인·격자)은 칸반에서 뜻이 없다 — 세 보기만 남는다.
    // (보드 머리의 탭에도 같은 이름의 버튼이 있으므로 드롭다운 안에서 찾는다.)
    const menu = await waitFor(() => document.querySelector('[data-anchored-menu]') as HTMLElement);
    const labels = Array.from(menu.querySelectorAll('button')).map((el) => (el.textContent || '').trim());
    // 보기 **모드**는 셋뿐이고, 보드 전체 댓글은 구분선 뒤에 따로 선다.
    expect(labels).toEqual(['보드', '리스트', '타임라인', '보드 전체 댓글']);

    // 탭과 같은 상태를 쓴다 — 메뉴로 고르면 화면도 바뀐다.
    fireEvent.click(within(menu).getByRole('button', { name: '리스트' }));
    await waitFor(() => expect(container.querySelector('[data-kanban-list-view]')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '도움말' }));
    fireEvent.click(await screen.findByRole('button', { name: /단축키 도움말/ }));
    expect(await screen.findByLabelText('키보드 단축키')).toBeTruthy();
  });
});

/** 배포 후 제보 7건 — 상세 안 댓글·기한 자리·드롭 자리·열 그림자·진행률 색. */
describe('칸반 — 후속 7건', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  it('상세 안에서 댓글을 읽고 남긴다 — 패널로 넘기지 않는다', async () => {
    localStorage.setItem('mindflow_doc_kn1', JSON.stringify(KANBAN));
    const { container } = renderEditor('/editor?map=kn1&title=x');
    await waitFor(() => expect(container.querySelectorAll('[data-kanban-card]')).toHaveLength(2));

    fireEvent.doubleClick(container.querySelector('[data-kanban-card="k1"]')!);
    const detail = await waitFor(() => container.querySelector('[data-card-detail="k1"]') as HTMLElement);
    const box = within(detail).getByPlaceholderText('댓글 남기기 (@로 멘션)');
    fireEvent.change(box, { target: { value: '여기서 바로 남긴다' } });
    fireEvent.click(within(detail).getByRole('button', { name: '남기기' }));

    await waitFor(() => expect(within(detail).getByText('여기서 바로 남긴다')).toBeTruthy());
    // 저장은 댓글 저장소로 — 카드 앞면의 개수도 함께 는다.
    await waitFor(() => {
      const rows = JSON.parse(localStorage.getItem('mf_comments') || '[]') as { nodeId: string; body: string }[];
      expect(rows.some((r) => r.nodeId === 'k1' && r.body === '여기서 바로 남긴다')).toBe(true);
    });
    fireEvent.click(detail.querySelector('[data-detail-close]')!);
    await waitFor(() => expect(container.querySelector('[data-card-comment-count="k1"]')?.textContent).toContain('1'));
  });

  it('기한 지우기는 항상 보이되 기한이 없으면 비활성이다', async () => {
    localStorage.setItem('mindflow_doc_kn2', JSON.stringify(KANBAN));
    const { container } = renderEditor('/editor?map=kn2&title=x');
    await waitFor(() => expect(container.querySelectorAll('[data-kanban-card]')).toHaveLength(2));

    fireEvent.doubleClick(container.querySelector('[data-kanban-card="k1"]')!);
    const detail = await waitFor(() => container.querySelector('[data-card-detail="k1"]') as HTMLElement);
    const clear = detail.querySelector('[data-detail-due-clear]') as HTMLButtonElement;
    expect(clear).toBeTruthy();
    expect(clear.disabled).toBe(true);

    fireEvent.change(detail.querySelector('[data-detail-due]')!, { target: { value: '2026-09-01' } });
    await waitFor(() => expect((detail.querySelector('[data-detail-due-clear]') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(detail.querySelector('[data-detail-due-clear]')!);
    await waitFor(() => expect((detail.querySelector('[data-detail-due-clear]') as HTMLButtonElement).disabled).toBe(true));
  });

  it('빈 열로 끌면 머리 아래(카드 목록 안)에 자리가 생긴다', async () => {
    localStorage.setItem('mindflow_doc_kn3', JSON.stringify(KANBAN));
    const { container } = renderEditor('/editor?map=kn3&title=x');
    await waitFor(() => expect(container.querySelectorAll('[data-kanban-card]')).toHaveLength(2));
    stubRects(container);

    firePointer(container.querySelector('[data-kanban-card="k1"]')!, 'pointerdown', { clientX: 150, clientY: 70 });
    firePointer(window, 'pointermove', { clientX: 470, clientY: 200 }); // 빈 열(c2)
    const slot = await waitFor(() => container.querySelector('[data-kanban-column="c2"] [data-kanban-drop-slot]') as HTMLElement);
    // 머리(header)가 아니라 **카드 목록 안**에 있다 — 제목 위에 뜨지 않는다.
    expect(slot.closest('[data-kanban-list]')).toBeTruthy();
    expect(slot.closest('[data-column-head]')).toBeNull();
    // 크기는 끌고 있는 카드와 같다(stubRects가 심은 40px).
    expect(slot.style.height).toBe('40px');
    firePointer(window, 'pointerup', { clientX: 470, clientY: 200 });
  });

  it('열은 그림자로 배경과 갈리고, 진행 바는 열 색으로 그려진다', async () => {
    localStorage.setItem('mindflow_doc_kn4', JSON.stringify(KANBAN));
    const { container } = renderEditor('/editor?map=kn4&title=x');
    const col = await waitFor(() => container.querySelector('[data-kanban-column="c1"]') as HTMLElement);
    expect(col.style.boxShadow).toContain('rgba');

    // 카드가 첫 열에만 있으면 **채워진 구간이 없다**(아직 시작하지 않은 일).
    expect(container.querySelectorAll('[data-progress-seg]')).toHaveLength(0);

    // 마지막 열로 옮기면 그 열의 색으로 왼쪽부터 찬다.
    fireEvent.doubleClick(container.querySelector('[data-kanban-card="k1"]')!);
    const detail = await waitFor(() => container.querySelector('[data-card-detail="k1"]') as HTMLElement);
    fireEvent.click(detail.querySelector('[data-detail-status="c2"]')!);
    fireEvent.click(detail.querySelector('[data-detail-close]')!);
    const segs = await waitFor(() => {
      const list = Array.from(container.querySelectorAll('[data-progress-seg]'));
      expect(list).toHaveLength(1);
      return list;
    });
    expect((segs[0] as HTMLElement).getAttribute('data-progress-seg')).toBe('c2');
    expect((segs[0] as HTMLElement).style.background).toBe((container.querySelector('[data-column-dot="c2"]') as HTMLElement).style.background);
  });
});

describe('칸반 — 후속 6건', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  /** 세 열 · 담당과 분류가 섞인 보드 — 진행 바 순서와 필터를 함께 본다. */
  const BOARD = {
    ...KANBAN,
    columns: [
      { id: 'c1', title: '할 일' },
      { id: 'c2', title: '진행 중' },
      { id: 'c3', title: '완료' },
    ],
    tags: [
      { id: 't1', name: '개발' },
      { id: 't2', name: '기획' },
    ],
    cards: [
      { id: 'k1', col: 'c1', pos: 0, text: '첫 카드', owner: 'a@x.com', ownerName: '지수', tag: '개발' },
      { id: 'k2', col: 'c1', pos: 1024, text: '둘째 카드', owner: 'b@x.com', ownerName: '민호', tag: '기획', flagged: true },
      { id: 'k3', col: 'c2', pos: 0, text: '셋째 카드', owner: 'a@x.com', ownerName: '지수' },
      { id: 'k4', col: 'c3', pos: 0, text: '넷째 카드' },
    ],
  };

  it('진행 바는 완료부터 **왼쪽**에서 차고, 첫 열은 빈 트랙으로 남는다', async () => {
    localStorage.setItem('mindflow_doc_kf1', JSON.stringify(BOARD));
    const { container } = renderEditor('/editor?map=kf1&title=x');
    await waitFor(() => expect(container.querySelector('[data-kanban-progress]')).toBeTruthy());

    // 왼쪽부터 c3(완료) → c2(진행). 시작하지 않은 c1은 그리지 않는다.
    const segs = Array.from(container.querySelectorAll('[data-progress-seg]')).map((e) => e.getAttribute('data-progress-seg'));
    expect(segs).toEqual(['c3', 'c2']);
    // 채워진 폭의 합이 100%보다 작다 = 남은 자리가 빈 트랙이다.
    const widths = Array.from(container.querySelectorAll('[data-progress-seg]')).map((e) => parseFloat((e as HTMLElement).style.width));
    expect(widths.reduce((a, b) => a + b, 0)).toBeLessThan(100);
  });

  it('열 추가 타일도 열과 같은 그림자를 쓴다', async () => {
    localStorage.setItem('mindflow_doc_kf2', JSON.stringify(BOARD));
    const { container } = renderEditor('/editor?map=kf2&title=x');
    const add = await waitFor(() => container.querySelector('[data-add-column]') as HTMLElement);
    const col = container.querySelector('[data-kanban-column="c1"]') as HTMLElement;
    expect(add.style.boxShadow).toBe(col.style.boxShadow);
    expect(add.style.boxShadow).toContain('rgba');
  });

  it('바닥은 열(패널)보다 옅다 — 앱 배경을 그대로 쓰지 않는다', async () => {
    localStorage.setItem('mindflow_doc_kf3', JSON.stringify(BOARD));
    const { container } = renderEditor('/editor?map=kf3&title=x');
    const root = await waitFor(() => container.querySelector('[data-kanban-root]') as HTMLElement);
    // 칸반 화면은 캔버스가 아니라 크롬이라 UI 테마(고정 팔레트)를 쓴다.
    // jsdom은 색을 `rgb(...)`로 정규화하므로 비교도 같은 꼴로 맞춘다.
    const rgb = (hex: string): string => {
      const c = hex.replace('#', '');
      return `rgb(${parseInt(c.slice(0, 2), 16)}, ${parseInt(c.slice(2, 4), 16)}, ${parseInt(c.slice(4, 6), 16)})`;
    };
    expect(root.style.background).toBe(rgb(mixHex(UI_THEME.appBg, UI_THEME.panel, 0.55)));
    expect(root.style.background).not.toBe(rgb(UI_THEME.appBg));
  });

  it('검색·탭·필터는 문서 칩과 같은 선에 선다(데스크톱)', async () => {
    localStorage.setItem('mindflow_doc_kf4', JSON.stringify(BOARD));
    const { container } = renderEditor('/editor?map=kf4&title=x');
    const row = await waitFor(() => container.querySelector('[data-kanban-actions]') as HTMLElement);
    // 칩은 떠 있는 오버레이라 자리를 차지하지 않는다 — 그 폭만큼 왼쪽을 비운다.
    expect(parseFloat(row.style.paddingLeft)).toBeGreaterThan(200);
    expect(parseFloat(row.style.minHeight)).toBeGreaterThan(40);
  });

  it('열 고스트는 카드까지 담고, 원본 자리에는 점선 상자가 선다', async () => {
    localStorage.setItem('mindflow_doc_kf5', JSON.stringify(BOARD));
    const { container } = renderEditor('/editor?map=kf5&title=x');
    await waitFor(() => expect(container.querySelectorAll('[data-kanban-column]')).toHaveLength(3));
    stubRects(container);

    firePointer(container.querySelector('[data-column-head="c1"]')!, 'pointerdown', { clientX: 40, clientY: 20 });
    firePointer(window, 'pointermove', { clientX: 500, clientY: 20 });

    const ghost = await waitFor(() => container.querySelector('[data-kanban-col-ghost="c1"]') as HTMLElement);
    // 카드 고스트와 같은 규칙 — 열의 **얼굴**(제목 + 카드)이 따라온다.
    expect(ghost.textContent).toContain('할 일');
    expect(ghost.textContent).toContain('첫 카드');
    const slot = container.querySelector('[data-kanban-col-slot]') as HTMLElement;
    expect(slot).toBeTruthy();
    expect(slot.style.height).toBe('800px'); // stubRects가 심은 열 높이
    firePointer(window, 'pointerup', { clientX: 40, clientY: 20 });
  });

  it('필터 — 담당·분류·긴급으로 좁히고, 초기화로 되돌린다', async () => {
    localStorage.setItem('mindflow_doc_kf6', JSON.stringify(BOARD));
    const { container } = renderEditor('/editor?map=kf6&title=x');
    await waitFor(() => expect(container.querySelectorAll('[data-kanban-card]')).toHaveLength(4));
    // 아이콘 자리는 필터가 가져갔다 — 보드 머리에 댓글 버튼은 없다.
    expect(container.querySelector('[data-kanban-comments]')).toBeNull();

    fireEvent.click(container.querySelector('[data-kanban-filter]')!);
    const panel = await waitFor(() => container.querySelector('[data-kanban-filter-panel]') as HTMLElement);
    expect(panel.textContent).toContain('4 / 4개 카드 표시 중');

    // 담당 — 지수의 카드 둘만.
    fireEvent.click(panel.querySelector('[data-filter-owner="a@x.com"]')!);
    await waitFor(() => expect(container.querySelectorAll('[data-kanban-card]')).toHaveLength(2));
    expect(container.querySelector('[data-filter-count]')?.textContent).toContain('2 / 4');

    // 분류를 함께 걸면 교집합(지수 + 개발) 하나.
    fireEvent.click(panel.querySelector('[data-filter-tag="개발"]')!);
    await waitFor(() => expect(container.querySelectorAll('[data-kanban-card]')).toHaveLength(1));

    // 초기화 — 전부 돌아온다.
    fireEvent.click(panel.querySelector('[data-filter-reset]')!);
    await waitFor(() => expect(container.querySelectorAll('[data-kanban-card]')).toHaveLength(4));

    // 긴급만 보기 — flagged 하나.
    fireEvent.click(panel.querySelector('[data-filter-urgent]')!);
    await waitFor(() => expect(container.querySelectorAll('[data-kanban-card]')).toHaveLength(1));
    expect(container.querySelector('[data-kanban-card="k2"]')).toBeTruthy();

    // 문서는 그대로 — 필터는 화면에서만 거른다.
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => expect(saved('kf6').cards).toHaveLength(4));
  });

  it('필터는 리스트·타임라인 보기에도 함께 걸린다', async () => {
    localStorage.setItem('mindflow_doc_kf7', JSON.stringify(BOARD));
    const { container } = renderEditor('/editor?map=kf7&title=x');
    await waitFor(() => expect(container.querySelectorAll('[data-kanban-card]')).toHaveLength(4));

    fireEvent.click(container.querySelector('[data-kanban-filter]')!);
    const panel = await waitFor(() => container.querySelector('[data-kanban-filter-panel]') as HTMLElement);
    fireEvent.click(panel.querySelector('[data-filter-owner="b@x.com"]')!);

    fireEvent.click(container.querySelector('[data-kanban-tab="list"]')!);
    await waitFor(() => expect(container.querySelectorAll('[data-list-row]')).toHaveLength(1));
  });
});

describe('칸반 — 후속(열 색·열 추가 길이·호버·시작일)', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  it('열 배경은 패널2보다 옅고, 바닥보다는 진하다', async () => {
    localStorage.setItem('mindflow_doc_kh1', JSON.stringify(KANBAN));
    const { container } = renderEditor('/editor?map=kh1&title=x');
    const col = await waitFor(() => container.querySelector('[data-kanban-column="c1"]') as HTMLElement);
    const rgb = (hex: string): string => {
      const c = hex.replace('#', '');
      return `rgb(${parseInt(c.slice(0, 2), 16)}, ${parseInt(c.slice(2, 4), 16)}, ${parseInt(c.slice(4, 6), 16)})`;
    };
    expect(col.style.background).toBe(rgb(mixHex(UI_THEME.panel2, UI_THEME.panel, 0.25)));
    // 바닥 → 열 → 카드 순으로 진해진다(디자인 원본의 층).
    expect(col.style.background).not.toBe((container.querySelector('[data-kanban-root]') as HTMLElement).style.background);
  });

  it('열 추가 타일은 띠 전체 높이로 늘어난다', async () => {
    localStorage.setItem('mindflow_doc_kh2', JSON.stringify(KANBAN));
    const { container } = renderEditor('/editor?map=kh2&title=x');
    const add = await waitFor(() => container.querySelector('[data-add-column]') as HTMLElement);
    expect(add.style.alignSelf).toBe('stretch');
  });

  /** 호버는 CSS라 jsdom이 그리지 않는다 — **어디에 붙어 있는지**를 계약으로 고정한다
   *  (인라인 배경을 이기는 `.mf-ed-btn::after` 덧칠은 실브라우저에서 실측). */
  it('호버가 붙어야 할 곳에 클래스가 있다 — GNB·열·카드·행', async () => {
    localStorage.setItem('mindflow_doc_kh3', JSON.stringify(KANBAN));
    const { container } = renderEditor('/editor?map=kh3&title=x');
    await waitFor(() => expect(container.querySelectorAll('[data-kanban-card]')).toHaveLength(2));

    const hoverable = (sel: string): boolean => (container.querySelector(sel) as HTMLElement | null)?.classList.contains('mf-ed-btn') ?? false;
    expect(screen.getByRole('button', { name: '보기' }).classList.contains('mf-ed-btn')).toBe(true);
    expect(screen.getByRole('button', { name: '공유' }).classList.contains('mf-ed-btn')).toBe(true);
    expect(hoverable('[data-add-card="c1"]')).toBe(true);
    expect(hoverable('[data-column-menu="c1"]')).toBe(true);
    expect(hoverable('[data-add-card-foot="c1"]')).toBe(true);
    expect(hoverable('[data-add-column]')).toBe(true);
    expect((container.querySelector('[data-kanban-card="k1"]') as HTMLElement).classList.contains('mf-kb-card')).toBe(true);

    // 상세 팝업의 삭제·닫기
    fireEvent.doubleClick(container.querySelector('[data-kanban-card="k1"]')!);
    const detail = await waitFor(() => container.querySelector('[data-card-detail="k1"]') as HTMLElement);
    expect((detail.querySelector('[data-detail-delete]') as HTMLElement).classList.contains('mf-ed-danger')).toBe(true);
    expect((detail.querySelector('[data-detail-close]') as HTMLElement).classList.contains('mf-ed-btn')).toBe(true);
    fireEvent.click(detail.querySelector('[data-detail-close]')!);

    // 리스트·타임라인의 행
    fireEvent.click(container.querySelector('[data-kanban-tab="list"]')!);
    await waitFor(() => expect((container.querySelector('[data-list-row]') as HTMLElement).classList.contains('mf-kb-row')).toBe(true));
  });

  it('상세에서 시작일을 정하면 저장되고, 지우기로 키가 사라진다', async () => {
    localStorage.setItem('mindflow_doc_kh4', JSON.stringify(KANBAN));
    const { container } = renderEditor('/editor?map=kh4&title=x');
    await waitFor(() => expect(container.querySelectorAll('[data-kanban-card]')).toHaveLength(2));

    fireEvent.doubleClick(container.querySelector('[data-kanban-card="k1"]')!);
    const detail = await waitFor(() => container.querySelector('[data-card-detail="k1"]') as HTMLElement);
    const start = detail.querySelector('[data-detail-start]') as HTMLInputElement;
    expect((detail.querySelector('[data-detail-start-clear]') as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(start, { target: { value: '2026-08-10' } });
    fireEvent.change(detail.querySelector('[data-detail-due]')!, { target: { value: '2026-08-20' } });
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => {
      const c = saved('kh4').cards.find((x: { id: string }) => x.id === 'k1');
      expect(c.start).toBe('2026-08-10');
      expect(c.due).toBe('2026-08-20');
    });

    fireEvent.click(detail.querySelector('[data-detail-start-clear]')!);
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => {
      const c = saved('kh4').cards.find((x: { id: string }) => x.id === 'k1');
      expect('start' in c).toBe(false);
      expect(c.due).toBe('2026-08-20');
    });
  });
});

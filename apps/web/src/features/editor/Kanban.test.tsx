// 칸반 — 세 번째 문서 종류(`kind: 'kanban'`). 캔버스가 아니라 열·카드 화면이고,
// 저장·공유·협업은 문서 기반이라 기존 경로를 그대로 탄다.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Editor } from './Editor';
import { mockMatchMedia } from '../../test/matchMedia';

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
    const texts = Array.from(container.querySelectorAll('[data-kanban-card]')).map((e) => e.textContent);
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
    // 만들자마자 편집이 열린다.
    const edit = await waitFor(() => {
      const el = container.querySelector('[data-kanban-card-edit]') as HTMLTextAreaElement;
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

  it('빈 카드는 확정할 때 사라진다 — 실수로 만든 카드가 남지 않는다', async () => {
    localStorage.setItem('mindflow_doc_kb3', JSON.stringify(KANBAN));
    const { container } = renderEditor('/editor?map=kb3&title=x');
    await waitFor(() => expect(container.querySelector('[data-add-card="c1"]')).toBeTruthy());

    fireEvent.click(container.querySelector('[data-add-card="c1"]')!);
    const edit = await waitFor(() => container.querySelector('[data-kanban-card-edit]') as HTMLTextAreaElement);
    fireEvent.blur(edit);
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });

    await waitFor(() => expect(saved('kb3').cards).toHaveLength(2));
  });

  it('카드를 두 번 눌러 글을 고치고, 열 제목도 두 번 눌러 바꾼다', async () => {
    localStorage.setItem('mindflow_doc_kb4', JSON.stringify(KANBAN));
    const { container } = renderEditor('/editor?map=kb4&title=x');
    const card = await waitFor(() => container.querySelector('[data-kanban-card="k1"]') as HTMLElement);

    fireEvent.doubleClick(card);
    const edit = await waitFor(() => container.querySelector('[data-kanban-card-edit="k1"]') as HTMLTextAreaElement);
    fireEvent.change(edit, { target: { value: '고친 카드' } });
    fireEvent.keyDown(edit, { key: 'Enter' });

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

    fireEvent.click(container.querySelector('[data-delete-column="c1"]')!);
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
    await waitFor(() => expect(container.querySelector('[data-kanban-drop-line]')).toBeTruthy());
    firePointer(window, 'pointerup', { clientX: 470, clientY: 60 });

    // 고스트·선은 손을 떼면 사라진다.
    await waitFor(() => expect(container.querySelector('[data-kanban-ghost]')).toBeNull());
    expect(container.querySelector('[data-kanban-drop-line]')).toBeNull();

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

  it('고른 카드에 ✕가 뜨고, 누르면 그 카드만 사라진다', async () => {
    localStorage.setItem('mindflow_doc_kd1', JSON.stringify(KANBAN));
    const { container } = renderEditor('/editor?map=kd1&title=x');
    await waitFor(() => expect(container.querySelectorAll('[data-kanban-card]')).toHaveLength(2));

    // 아무것도 고르지 않았으면 ✕는 없다(카드마다 늘 떠 있으면 목록이 시끄럽다).
    expect(container.querySelectorAll('[data-delete-card]')).toHaveLength(0);

    firePointer(container.querySelector('[data-kanban-card="k1"]')!, 'pointerdown', { clientX: 20, clientY: 60 });
    firePointer(window, 'pointerup', { clientX: 20, clientY: 60 });
    const del = await waitFor(() => {
      const el = container.querySelector('[data-delete-card="k1"]');
      expect(el).toBeTruthy();
      return el!;
    });
    fireEvent.click(del);

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

  const openViaMenu = async (): Promise<HTMLElement> => {
    fireEvent.click(screen.getByRole('button', { name: '보기' }));
    fireEvent.click(await screen.findByRole('button', { name: '댓글' }));
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

  it('댓글이 있는 카드에 개수 배지가 뜨고, 누르면 그 카드의 논의가 열린다', async () => {
    localStorage.setItem('mindflow_doc_kc2', JSON.stringify(KANBAN));
    localStorage.setItem(
      'mf_comments',
      JSON.stringify([{ id: 'x1', documentId: 'kc2', nodeId: 'k2', authorName: '나', body: '이 문구 확인 부탁', createdAt: '2026-01-01T00:00:00.000Z' }]),
    );
    const { container } = renderEditor('/editor?map=kc2&title=x');
    await waitFor(() => expect(container.querySelector('[data-card-comments="k2"]')).toBeTruthy());
    // 댓글 없는 카드에는 배지가 없다.
    expect(container.querySelector('[data-card-comments="k1"]')).toBeNull();

    fireEvent.click(container.querySelector('[data-card-comments="k2"]')!);
    const panel = await screen.findByLabelText('댓글');
    expect(within(panel).getByText('카드 · 둘째 카드')).toBeTruthy();
    expect(within(panel).getByText('이 문구 확인 부탁')).toBeTruthy();
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

describe('칸반 — 드롭 위치 가이드 선(제보: 너무 진하다)', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  it('강조색 원본이 아니라 옅게·양끝이 스며드는 얇은 선이다', async () => {
    localStorage.setItem('mindflow_doc_kg1', JSON.stringify(KANBAN));
    const { container } = renderEditor('/editor?map=kg1&title=x');
    await waitFor(() => expect(container.querySelectorAll('[data-kanban-card]')).toHaveLength(2));

    stubRects(container);
    firePointer(container.querySelector('[data-kanban-card="k1"]')!, 'pointerdown', { clientX: 20, clientY: 60 });
    firePointer(window, 'pointermove', { clientX: 20, clientY: 130 });
    const line = await waitFor(() => {
      const el = container.querySelector('[data-kanban-drop-line]') as HTMLElement;
      expect(el).toBeTruthy();
      return el;
    });

    // 이 선은 자리를 가리키는 눈금이지 강조 대상이 아니다.
    expect(parseFloat(line.style.height)).toBeLessThanOrEqual(2);
    // 딱 잘린 진한 막대가 아니라 양끝이 배경으로 스며드는 그라디언트.
    expect(line.style.background).toContain('linear-gradient');
    expect(line.style.background).toContain('rgba');
    // 어느 정지점도 불투명한 강조색이 아니다(alpha < 1).
    const alphas = [...line.style.background.matchAll(/rgba\([^)]*?,\s*([\d.]+)\)/g)].map((m) => parseFloat(m[1]!));
    expect(alphas.length).toBeGreaterThan(0);
    expect(Math.max(...alphas)).toBeLessThan(1);

    firePointer(window, 'pointerup', { clientX: 20, clientY: 130 });
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
    expect(container.querySelector('[data-kanban-col-drop-line]')).toBeTruthy();
    firePointer(window, 'pointerup', { clientX: 500, clientY: 20 });

    await waitFor(() => expect(Array.from(container.querySelectorAll('[data-kanban-column]')).map((e) => e.getAttribute('data-kanban-column'))).toEqual(['c2', 'c1']));
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => expect(saved('kc1').columns.map((c: { id: string }) => c.id)).toEqual(['c2', 'c1']));

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await waitFor(() => expect(Array.from(container.querySelectorAll('[data-kanban-column]')).map((e) => e.getAttribute('data-kanban-column'))).toEqual(['c1', 'c2']));
  });

  it('✕에서 끌어도 열 드래그가 아니고, 제목 더블클릭 편집도 그대로다', async () => {
    localStorage.setItem('mindflow_doc_kc2', JSON.stringify(KANBAN));
    const { container } = renderEditor('/editor?map=kc2&title=x');
    await waitFor(() => expect(container.querySelectorAll('[data-kanban-column]')).toHaveLength(2));
    stubRects(container);

    firePointer(container.querySelector('[data-delete-column="c1"]')!, 'pointerdown', { clientX: 260, clientY: 20 });
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

  it('고른 카드에서 색을 골라 칠하고, 다시 없앨 수 있다', async () => {
    localStorage.setItem('mindflow_doc_kl1', JSON.stringify(KANBAN));
    const { container } = renderEditor('/editor?map=kl1&title=x');
    await waitFor(() => expect(container.querySelectorAll('[data-kanban-card]')).toHaveLength(2));

    // 아무것도 고르지 않았으면 라벨 버튼도 없다(✕과 같은 규칙).
    expect(container.querySelector('[data-card-label="k1"]')).toBeNull();

    firePointer(container.querySelector('[data-kanban-card="k1"]')!, 'pointerdown', { clientX: 20, clientY: 60 });
    firePointer(window, 'pointerup', { clientX: 20, clientY: 60 });
    const btn = await waitFor(() => {
      const el = container.querySelector('[data-card-label="k1"]') as HTMLElement;
      expect(el).toBeTruthy();
      return el;
    });
    fireEvent.click(btn);
    const picker = await screen.findByRole('menu', { name: '색 라벨' });
    fireEvent.click(within(picker).getByRole('menuitem', { name: '파랑' }));

    await waitFor(() => expect((container.querySelector('[data-kanban-card="k1"]') as HTMLElement).style.background).toBeTruthy());
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => expect(saved('kl1').cards.find((c: { id: string }) => c.id === 'k1').bg).toBe('#d9e8f8'));
    // 다른 카드는 그대로.
    expect(saved('kl1').cards.find((c: { id: string }) => c.id === 'k2').bg).toBeUndefined();

    // 없애면 **키가 사라진다**(빈 필드를 CRDT로 계속 흘리지 않게).
    fireEvent.click(container.querySelector('[data-card-label="k1"]')!);
    const picker2 = await screen.findByRole('menu', { name: '색 라벨' });
    fireEvent.click(within(picker2).getByRole('menuitem', { name: '없음' }));
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => expect('bg' in saved('kl1').cards.find((c: { id: string }) => c.id === 'k1')).toBe(false));
  });

  it('라벨 버튼에서 끌어도 카드 드래그가 아니다', async () => {
    localStorage.setItem('mindflow_doc_kl2', JSON.stringify(KANBAN));
    const { container } = renderEditor('/editor?map=kl2&title=x');
    await waitFor(() => expect(container.querySelectorAll('[data-kanban-card]')).toHaveLength(2));
    stubRects(container);

    firePointer(container.querySelector('[data-kanban-card="k1"]')!, 'pointerdown', { clientX: 20, clientY: 60 });
    firePointer(window, 'pointerup', { clientX: 20, clientY: 60 });
    const btn = await waitFor(() => container.querySelector('[data-card-label="k1"]') as HTMLElement);
    firePointer(btn, 'pointerdown', { clientX: 250, clientY: 55 });
    firePointer(window, 'pointermove', { clientX: 250, clientY: 140 });
    expect(container.querySelector('[data-kanban-ghost]')).toBeNull();
    firePointer(window, 'pointerup', { clientX: 250, clientY: 140 });
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
    const box = await waitFor(() => container.querySelector(`[data-kanban-card-edit="${id}"]`) as HTMLTextAreaElement);
    fireEvent.change(box, { target: { value } });
    fireEvent.keyDown(box, { key: 'Enter' });
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
    await waitFor(() => expect(container.querySelector('[data-kanban-card-edit]')).toBeNull());

    fireEvent.doubleClick(container.querySelector('[data-kanban-card="k1"]')!);
    const box = await waitFor(() => container.querySelector('[data-kanban-card-edit="k1"]') as HTMLTextAreaElement);
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
    await waitFor(() => expect(container.querySelector('[data-kanban-card-edit]')).toBeNull());
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

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Doc } from '@mindflow/mindmap-core';
import { layout, parseDoc } from '@mindflow/mindmap-core';
import { Editor } from './Editor';
import { CanvasTextMeasurer, computeMetrics } from './metrics';

// 에디터 복사/잘라내기/붙여넣기 — 키보드(Windows Ctrl / macOS Cmd)와, 키보드가 없는
// 모바일의 진입점인 컨텍스트 메뉴(길게 누르기 = 우클릭)를 함께 검증한다.
// 순수 로직(무엇이 담기고 어떻게 복제되는지)은 clipboard.test.ts가 덮는다.

const DOC = {
  v: 1,
  nodes: {
    root: { id: 'root', text: '루트', emoji: '', parent: null, children: ['c1', 'c2'], collapsed: false, color: null, x: 0, y: 0 },
    c1: { id: 'c1', text: '노드A', emoji: '', parent: 'root', children: ['c1a'], collapsed: false, color: null, x: 0, y: 0 },
    c1a: { id: 'c1a', text: 'A의자식', emoji: '', parent: 'c1', children: [], collapsed: false, color: null, x: 0, y: 0 },
    c2: { id: 'c2', text: '노드B', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0 },
  },
  floats: [],
  lines: [],
  zones: [],
  layoutMode: 'right',
  themeKey: 'coral',
};

function renderEditor(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/editor" element={<Editor />} />
        <Route path="/home" element={<div>HOME_PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function getViewport(container: HTMLElement): HTMLElement {
  const el = container.querySelector('.mf-ed-vp');
  if (!el) throw new Error('viewport not found');
  return el as HTMLElement;
}

function nodeBoxFor(container: HTMLElement, text: string): HTMLElement {
  const el = within(getViewport(container)).getAllByText(text)[0]?.closest('[data-node-id]');
  if (!el) throw new Error(`node box for "${text}" not found`);
  return el as HTMLElement;
}

/** 선택은 click이 아니라 pointerdown(→ beginNodeDrag)에서 일어난다. */
function selectNodeBox(el: HTMLElement): void {
  fireEvent.pointerDown(el, { pointerId: 1, clientX: 100, clientY: 100, button: 0 });
  fireEvent.pointerUp(window, { pointerId: 1, clientX: 100, clientY: 100 });
}

function countText(container: HTMLElement, text: string): number {
  return within(getViewport(container)).queryAllByText(text).length;
}

function countNodeBoxes(container: HTMLElement): number {
  return getViewport(container).querySelectorAll('[data-node-id]').length;
}

/** jsdom은 실제 레이아웃이 없어 getBoundingClientRect가 전부 0이다. 우클릭 히트
 * 테스트를 하려면 캔버스 좌표 → 클라이언트 좌표를 직접 계산해야 한다
 * (ContextMenu.interactions.test.tsx와 동일한 방식·상수). */
function computeViewport(doc: Doc): { pan: { x: number; y: number }; zoom: number; geom: Record<string, { x: number; y: number; w: number; h: number }> } {
  const measurer = new CanvasTextMeasurer();
  const sizeOf = (node: Parameters<typeof computeMetrics>[0], depth: number) => {
    const m = computeMetrics(node, depth, measurer);
    return { w: m.w, h: m.h };
  };
  const laidOut = layout(doc, doc.layoutMode, sizeOf, { rootAnchor: { x: 0, y: 0 } });
  const geom: Record<string, { x: number; y: number; w: number; h: number }> = {};
  for (const id of Object.keys(doc.nodes)) {
    const n = laidOut[id];
    if (!n) continue;
    const depth = id === 'root' ? 0 : id === 'c1a' ? 2 : 1;
    const m = computeMetrics(n, depth, measurer);
    geom[id] = { x: n.x, y: n.y, w: m.w, h: m.h };
  }
  const FIT_PADDING = 90;
  const MIN_ZOOM = 0.25;
  const vw = 1200;
  const vh = 700;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const g of Object.values(geom)) {
    minX = Math.min(minX, g.x - g.w / 2);
    maxX = Math.max(maxX, g.x + g.w / 2);
    minY = Math.min(minY, g.y - g.h / 2);
    maxY = Math.max(maxY, g.y + g.h / 2);
  }
  const cx = geom.root ? geom.root.x : (minX + maxX) / 2;
  const cy = geom.root ? geom.root.y : (minY + maxY) / 2;
  const halfW = Math.max(cx - minX, maxX - cx, 1);
  const halfH = Math.max(cy - minY, maxY - cy, 1);
  let z = Math.min((vw - FIT_PADDING) / (2 * halfW), (vh - FIT_PADDING) / (2 * halfH), 1.25);
  z = Math.max(MIN_ZOOM, z);
  return { pan: { x: vw / 2 - cx * z, y: vh / 2 - cy * z }, zoom: z, geom };
}

function rightClickNode(container: HTMLElement, id: string): void {
  const { pan, zoom, geom } = computeViewport(parseDoc(DOC)!);
  const g = geom[id]!;
  fireEvent.contextMenu(getViewport(container), { clientX: g.x * zoom + pan.x, clientY: g.y * zoom + pan.y, button: 2 });
}

/** 메뉴 항목의 실제 클릭 시퀀스 — 메뉴는 `.mf-ed-vp`의 자식이라 pointerdown 누수가
 * 배경 마퀴를 띄우면 선택이 풀린다(ContextMenu가 막고 있는 지점). */
function clickMenuItem(el: Element): void {
  fireEvent.pointerDown(el, { pointerId: 1, button: 0 });
  fireEvent.mouseDown(el);
  fireEvent.mouseUp(el);
  fireEvent.pointerUp(el, { pointerId: 1, button: 0 });
  fireEvent.click(el);
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
});

describe('에디터 복사/붙여넣기 — 키보드', () => {
  it('제보 시나리오: A 선택 → Ctrl+C → B 선택 → Ctrl+V 시 A가 B의 자식으로 복제된다', async () => {
    localStorage.setItem('mindflow_doc_cb1', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=cb1&title=x');
    await waitFor(() => expect(countText(container, '노드A')).toBe(1));

    selectNodeBox(nodeBoxFor(container, '노드A'));
    fireEvent.keyDown(window, { key: 'c', ctrlKey: true });
    selectNodeBox(nodeBoxFor(container, '노드B'));
    fireEvent.keyDown(window, { key: 'v', ctrlKey: true });

    // 사본이 생겼다: '노드A'가 둘, 'A의자식'도 둘(서브트리째 복제)
    await waitFor(() => expect(countText(container, '노드A')).toBe(2));
    expect(countText(container, 'A의자식')).toBe(2);
  });

  it('macOS: Cmd(metaKey)로도 동일하게 동작한다', async () => {
    localStorage.setItem('mindflow_doc_cb2', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=cb2&title=x');
    await waitFor(() => expect(countText(container, '노드A')).toBe(1));

    selectNodeBox(nodeBoxFor(container, '노드A'));
    fireEvent.keyDown(window, { key: 'c', metaKey: true });
    selectNodeBox(nodeBoxFor(container, '노드B'));
    fireEvent.keyDown(window, { key: 'v', metaKey: true });

    await waitFor(() => expect(countText(container, '노드A')).toBe(2));
  });

  it('한글 IME가 켜져 있어 e.key가 자모로 와도 물리 키(e.code)로 동작한다', async () => {
    localStorage.setItem('mindflow_doc_cb3', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=cb3&title=x');
    await waitFor(() => expect(countText(container, '노드A')).toBe(1));

    selectNodeBox(nodeBoxFor(container, '노드A'));
    fireEvent.keyDown(window, { key: 'ㅊ', code: 'KeyC', ctrlKey: true });
    selectNodeBox(nodeBoxFor(container, '노드B'));
    fireEvent.keyDown(window, { key: 'ㅍ', code: 'KeyV', ctrlKey: true });

    await waitFor(() => expect(countText(container, '노드A')).toBe(2));
  });

  it('Ctrl+X는 원본을 즉시 지우고, 붙여넣으면 대상 아래로 옮겨진다(복제가 아니라 이동)', async () => {
    localStorage.setItem('mindflow_doc_cb4', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=cb4&title=x');
    await waitFor(() => expect(countText(container, '노드A')).toBe(1));

    selectNodeBox(nodeBoxFor(container, '노드A'));
    fireEvent.keyDown(window, { key: 'x', ctrlKey: true });
    // 잘라내는 즉시 원본이 사라진다
    await waitFor(() => expect(countText(container, '노드A')).toBe(0));

    selectNodeBox(nodeBoxFor(container, '노드B'));
    fireEvent.keyDown(window, { key: 'v', ctrlKey: true });
    // 붙여넣으면 다시 하나 — 총합은 이동이므로 1개
    await waitFor(() => expect(countText(container, '노드A')).toBe(1));
    expect(countText(container, 'A의자식')).toBe(1);
  });

  it('루트는 복사되지 않는다(클립보드가 비어 붙여넣기도 일어나지 않음)', async () => {
    localStorage.setItem('mindflow_doc_cb5', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=cb5&title=x');
    await waitFor(() => expect(countText(container, '노드A')).toBe(1));
    const before = countNodeBoxes(container);

    selectNodeBox(nodeBoxFor(container, '루트'));
    fireEvent.keyDown(window, { key: 'c', ctrlKey: true });
    selectNodeBox(nodeBoxFor(container, '노드B'));
    fireEvent.keyDown(window, { key: 'v', ctrlKey: true });

    expect(countNodeBoxes(container)).toBe(before); // 아무 일도 없다
  });

  it('붙여넣기는 undo 한 번으로 되돌아간다', async () => {
    localStorage.setItem('mindflow_doc_cb6', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=cb6&title=x');
    await waitFor(() => expect(countText(container, '노드A')).toBe(1));
    const before = countNodeBoxes(container);

    selectNodeBox(nodeBoxFor(container, '노드A'));
    fireEvent.keyDown(window, { key: 'c', ctrlKey: true });
    selectNodeBox(nodeBoxFor(container, '노드B'));
    fireEvent.keyDown(window, { key: 'v', ctrlKey: true });
    await waitFor(() => expect(countNodeBoxes(container)).toBeGreaterThan(before));

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await waitFor(() => expect(countNodeBoxes(container)).toBe(before));
  });

  it('텍스트 편집 중에는 가로채지 않는다(네이티브 복사/붙여넣기 유지)', async () => {
    localStorage.setItem('mindflow_doc_cb7', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=cb7&title=x');
    await waitFor(() => expect(countText(container, '노드A')).toBe(1));

    selectNodeBox(nodeBoxFor(container, '노드A'));
    fireEvent.keyDown(window, { key: 'c', ctrlKey: true }); // 클립보드에 A를 담아 두고
    fireEvent.doubleClick(nodeBoxFor(container, '노드B')); // B를 편집 모드로

    const editable = getViewport(container).querySelector('[contenteditable="true"]');
    expect(editable).toBeTruthy();
    const before = countNodeBoxes(container);
    fireEvent.keyDown(editable!, { key: 'v', ctrlKey: true, bubbles: true });
    expect(countNodeBoxes(container)).toBe(before); // 편집 중이므로 노드가 붙지 않는다
  });
});

// 붙여넣기는 **`paste` 이벤트 하나**가 가른다: 클립보드에 이미지가 있으면 이미지
// 플로트, 없으면 앱 안 클립보드(복사한 객체). 예전엔 Ctrl+V의 keydown에서
// preventDefault를 해 브라우저가 paste 이벤트를 아예 발생시키지 않았고, 그래서
// 이미지 붙여넣기가 조용히 죽어 있었다(실브라우저 실측: paste 이벤트 0회).
describe('에디터 붙여넣기 — 이미지 / 객체 갈림', () => {
  /** jsdom엔 실 클립보드가 없다 — `paste` 이벤트에 clipboardData만 심어 던진다. */
  function firePaste(target: EventTarget, files: File[]): Event {
    const e = new Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
    Object.defineProperty(e, 'clipboardData', {
      value: { items: files.map((f) => ({ kind: 'file', type: f.type, getAsFile: () => f })), files, getData: () => '' },
      configurable: true,
    });
    target.dispatchEvent(e);
    return e;
  }

  it('클립보드에 이미지가 있으면 이미지 경로로 간다 — 객체 붙여넣기는 하지 않는다(요청)', async () => {
    // 실제 삽입까지는 이미지 디코드(canvas)가 필요해 jsdom에서 확인할 수 없다 —
    // 여기서는 **갈림**만 본다(삽입 자체는 실브라우저 프로브로 검증했다):
    // 이미지가 있으면 이벤트를 가로채고(preventDefault) 복사해 둔 객체는 붙지 않는다.
    localStorage.setItem('mindflow_doc_cpi1', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=cpi1&title=x');
    await waitFor(() => expect(countText(container, '노드A')).toBe(1));

    selectNodeBox(nodeBoxFor(container, '노드A'));
    fireEvent.keyDown(window, { key: 'c', ctrlKey: true }); // 앱 안 클립보드에 담아 둔다
    selectNodeBox(nodeBoxFor(container, '노드B'));

    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'shot.png', { type: 'image/png' });
    const e = firePaste(document, [png]);
    expect(e.defaultPrevented).toBe(true);

    await new Promise((r) => setTimeout(r, 300));
    expect(countText(container, '노드A')).toBe(1); // 이미지가 이겼다 — 객체는 안 붙는다
  });

  it('이미지가 없으면 복사해 둔 객체를 붙여넣는다 — Ctrl+V가 이벤트를 막지 않는다(무회귀)', async () => {
    localStorage.setItem('mindflow_doc_cpi2', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=cpi2&title=x');
    await waitFor(() => expect(countText(container, '노드A')).toBe(1));

    selectNodeBox(nodeBoxFor(container, '노드A'));
    fireEvent.keyDown(window, { key: 'c', ctrlKey: true });
    selectNodeBox(nodeBoxFor(container, '노드B'));
    // 실제 브라우저의 순서: keydown(막지 않음) → paste 이벤트
    fireEvent.keyDown(window, { key: 'v', ctrlKey: true });
    firePaste(document, []);

    await waitFor(() => expect(countText(container, '노드A')).toBe(2));
    // 폴백 타이머(120ms)가 뒤늦게 한 번 더 붙여넣지 않는다
    await new Promise((r) => setTimeout(r, 250));
    expect(countText(container, '노드A')).toBe(2);
  });

  it('텍스트 입력 중에는 손대지 않는다 — 이미지가 있어도 삽입하지 않는다', async () => {
    localStorage.setItem('mindflow_doc_cpi3', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=cpi3&title=x');
    await waitFor(() => expect(countText(container, '노드A')).toBe(1));

    fireEvent.doubleClick(nodeBoxFor(container, '노드A'));
    const editable = await waitFor(() => {
      const el = container.querySelector('.mf-richedit');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'shot.png', { type: 'image/png' });
    firePaste(editable, [png]);

    await new Promise((r) => setTimeout(r, 300));
    expect(container.querySelectorAll('[data-float-id]')).toHaveLength(0);
  });
});

describe('에디터 복사/붙여넣기 — 컨텍스트 메뉴(모바일 길게 누르기 = 우클릭)', () => {
  it('노드 메뉴의 복사 → 다른 노드 메뉴의 붙여넣기로 키보드 없이 복제할 수 있다', async () => {
    localStorage.setItem('mindflow_doc_cb8', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=cb8&title=x');
    await waitFor(() => expect(countText(container, '노드A')).toBe(1));

    rightClickNode(container, 'c1');
    await waitFor(() => expect(screen.getByText('복사')).toBeTruthy());
    clickMenuItem(screen.getByText('복사'));

    // 클립보드가 찼으므로 이제 다른 노드 메뉴에 '붙여넣기'가 나타난다
    rightClickNode(container, 'c2');
    await waitFor(() => expect(screen.getByText('붙여넣기')).toBeTruthy());
    clickMenuItem(screen.getByText('붙여넣기'));

    await waitFor(() => expect(countText(container, '노드A')).toBe(2));
  });

  it('클립보드가 비어 있으면 붙여넣기 항목이 아예 보이지 않는다', async () => {
    localStorage.setItem('mindflow_doc_cb9', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=cb9&title=x');
    await waitFor(() => expect(countText(container, '노드A')).toBe(1));

    rightClickNode(container, 'c1');
    await waitFor(() => expect(screen.getByText('복사')).toBeTruthy());
    expect(screen.queryByText('붙여넣기')).toBeNull();
  });

  it('루트 메뉴에는 복사/잘라내기가 없다(맵 전체 복제 방지)', async () => {
    localStorage.setItem('mindflow_doc_cb10', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=cb10&title=x');
    await waitFor(() => expect(countText(container, '노드A')).toBe(1));

    rightClickNode(container, 'root');
    await waitFor(() => expect(screen.getByText('하위 주제 추가')).toBeTruthy());
    expect(screen.queryByText('복사')).toBeNull();
    expect(screen.queryByText('잘라내기')).toBeNull();
  });

  it('잘라내기 후 빈 캔버스에 붙여넣으면 그 지점에 자유 도형으로 놓인다', async () => {
    localStorage.setItem('mindflow_doc_cb11', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=cb11&title=x');
    await waitFor(() => expect(countText(container, '노드A')).toBe(1));

    rightClickNode(container, 'c1');
    await waitFor(() => expect(screen.getByText('잘라내기')).toBeTruthy());
    clickMenuItem(screen.getByText('잘라내기'));
    await waitFor(() => expect(countText(container, '노드A')).toBe(0));

    // 아무 것도 없는 먼 지점을 우클릭 → 배경 메뉴
    fireEvent.contextMenu(getViewport(container), { clientX: 5, clientY: 690, button: 2 });
    await waitFor(() => expect(screen.getByText('붙여넣기')).toBeTruthy());
    clickMenuItem(screen.getByText('붙여넣기'));

    await waitFor(() => expect(countText(container, '노드A')).toBe(1));
  });
});

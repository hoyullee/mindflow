import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Doc } from '@mindflow/mindmap-core';
import { layout, parseDoc } from '@mindflow/mindmap-core';
import { Editor } from './Editor';
import { CanvasTextMeasurer, computeMetrics } from './metrics';

// Right-click context menu tests (`ContextMenu.tsx` + `useEditorState`'s `ctxMenu`/`ctxSub`/
// `onContextMenu`/`hitTestAll`/`openCtxAt`, port of MindFlow.dc.html:2775-2837, 3087-3170).
// Complements Editor.test.tsx (Editor-a) / Editor.interactions.test.tsx (Editor-b) /
// EditorC.interactions.test.tsx (Editor-c).

const DOC = {
  v: 1,
  nodes: {
    root: { id: 'root', text: '루트', emoji: '', parent: null, children: ['c1'], collapsed: false, color: null, x: 0, y: 0 },
    c1: { id: 'c1', text: '노드A', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0 },
  },
  floats: [{ id: 'flt1', x: -260, y: 160, w: 200, text: '주간 메모' }],
  lines: [{ id: 'ln1', x1: -120, y1: 40, x2: 120, y2: 40, startArrow: false, endArrow: true, dashed: true, c1: 0, c2: 0, label: '' }],
  zones: [{ id: 'zn1', x: -320, y: -220, w: 300, h: 180, label: '1분기', color: null }],
  layoutMode: 'right',
  themeKey: 'coral',
};

// A nodes-ONLY doc (no floats/lines/zones) for the multi-selection test below — a marquee
// that also catches a float/line renders NO property panel at all (`PropertyPanel.tsx`'s
// `nodesOnly`/`linesOnly`/`floatsOnly` mutual-exclusivity, matching the original's own
// behavior), so "다중 선택" wouldn't be a reliable signal with the mixed `DOC` above.
const NODES_ONLY_DOC = {
  v: 1,
  nodes: {
    root: { id: 'root', text: '루트', emoji: '', parent: null, children: ['c1'], collapsed: false, color: null, x: 0, y: 0 },
    c1: { id: 'c1', text: '노드A', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0 },
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

/** jsdom has no native `PointerEvent` (`'PointerEvent' in window` is `false`), so
 * `fireEvent.pointerDown(...)` silently drops `clientX`/`clientY`/`button`/`pointerId` — see
 * `EditorC.interactions.test.tsx`'s identical helper's doc comment for the full explanation. */
function firePointer(target: Element | Window, type: 'pointerdown' | 'pointermove' | 'pointerup', init: { pointerId?: number; clientX?: number; clientY?: number; button?: number } = {}): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: init.clientX ?? 0, clientY: init.clientY ?? 0, button: init.button ?? 0 });
  Object.defineProperty(event, 'pointerId', { value: init.pointerId ?? 1, configurable: true });
  fireEvent(target, event);
}

/** Replicates `useEditorState`'s `layout()` + `computeMetrics`-driven geometry and its
 * `fitView` formula (same constants) so a test can compute the exact CLIENT point a given
 * CANVAS point lands on — jsdom never lays out real pixels, so there's no DOM measurement
 * to read instead (same approach as `EditorC.interactions.test.tsx`'s reparent test). */
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
    const depth = id === 'root' ? 0 : 1;
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
  // Mirrors `useEditorState`'s `centerOnRoot`: center the ROOT node at a zoom
  // that keeps the farthest content on either side visible (half the viewport
  // covers the larger half-span from the root), capped at 1.25×.
  const cx = geom.root ? geom.root.x : (minX + maxX) / 2;
  const cy = geom.root ? geom.root.y : (minY + maxY) / 2;
  const halfW = Math.max(cx - minX, maxX - cx, 1);
  const halfH = Math.max(cy - minY, maxY - cy, 1);
  let z = Math.min((vw - FIT_PADDING) / (2 * halfW), (vh - FIT_PADDING) / (2 * halfH), 1.25);
  z = Math.max(MIN_ZOOM, z);
  const pan = { x: vw / 2 - cx * z, y: vh / 2 - cy * z };
  return { pan, zoom: z, geom };
}

function toClient(pan: { x: number; y: number }, zoom: number, x: number, y: number): { clientX: number; clientY: number } {
  return { clientX: x * zoom + pan.x, clientY: y * zoom + pan.y };
}

function rightClickAt(vp: HTMLElement, clientX: number, clientY: number): void {
  fireEvent.contextMenu(vp, { clientX, clientY, button: 2 });
}

/** A realistic left-click on a menu item: the FULL pointer+mouse sequence a browser fires,
 * not just `mousedown`. This matters because the menu is a child of `.mf-ed-vp` (which owns
 * `onBackgroundPointerDown`): a real `pointerdown` would bubble to the viewport and start a
 * background (marquee) drag whose no-move `pointerup` CLEARS the selection. The buttons act on
 * `mousedown`, so a single-button action is unaffected, but the "텍스트 정렬 ▸" flyout is two
 * clicks — if the first click's `pointerup` wipes the selection, the alignment (second click)
 * targets nothing. `ContextMenu` guards this by stopping `pointerdown` at its root; firing only
 * `mousedown` (as the old test did) would never exercise that leak and would false-pass. */
function clickMenuItem(el: Element): void {
  firePointer(el, 'pointerdown', { button: 0 });
  fireEvent.mouseDown(el);
  fireEvent.mouseUp(el);
  firePointer(el, 'pointerup', { button: 0 });
  fireEvent.click(el);
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('Context menu — node', () => {
  it('shows 자식 주제/형제 주제/텍스트 정렬/삭제 for a non-root node', async () => {
    localStorage.setItem('mindflow_doc_cm1', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=cm1&title=x');
    const vp = getViewport(container);
    const { pan, zoom, geom } = computeViewport(DOC as Doc);
    const c1 = geom.c1!;
    const { clientX, clientY } = toClient(pan, zoom, c1.x, c1.y);

    rightClickAt(vp, clientX, clientY);

    await waitFor(() => expect(screen.getByText('자식 주제')).toBeTruthy());
    expect(screen.getByText('형제 주제')).toBeTruthy();
    expect(screen.getByText('텍스트 정렬')).toBeTruthy();
    expect(screen.getByText('삭제')).toBeTruthy();
  });

  it('omits 형제 주제/삭제 for the root node', async () => {
    localStorage.setItem('mindflow_doc_cm2', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=cm2&title=x');
    const vp = getViewport(container);
    const { pan, zoom, geom } = computeViewport(DOC as Doc);
    const root = geom.root!;
    const { clientX, clientY } = toClient(pan, zoom, root.x, root.y);

    rightClickAt(vp, clientX, clientY);

    await waitFor(() => expect(screen.getByText('자식 주제')).toBeTruthy());
    expect(screen.getByText('텍스트 정렬')).toBeTruthy();
    expect(screen.queryByText('형제 주제')).toBeNull();
    expect(screen.queryByText('삭제')).toBeNull();
  });

  it('the 텍스트 정렬 flyout sets the node\'s align (우측 정렬)', async () => {
    localStorage.setItem('mindflow_doc_cm3', JSON.stringify(DOC));
    renderEditor('/editor?map=cm3&title=x');
    const vp = getViewport(document.body);
    const { pan, zoom, geom } = computeViewport(DOC as Doc);
    const c1 = geom.c1!;
    const { clientX, clientY } = toClient(pan, zoom, c1.x, c1.y);

    rightClickAt(vp, clientX, clientY);
    await waitFor(() => expect(screen.getByText('텍스트 정렬')).toBeTruthy());
    // Full realistic click (pointerdown+mousedown+mouseup+pointerup+click), NOT just mousedown —
    // the first click's pointerup must not wipe the node selection or the alignment below fails
    // (regression guard for the pointerdown-leak fix in ContextMenu.tsx).
    clickMenuItem(screen.getByText('텍스트 정렬'));

    await waitFor(() => expect(screen.getByText('우측 정렬')).toBeTruthy());
    clickMenuItem(screen.getByText('우측 정렬'));

    // menu auto-closes after the item runs
    await waitFor(() => expect(screen.queryByText('우측 정렬')).toBeNull());

    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => {
      const raw = localStorage.getItem('mindflow_doc_cm3');
      expect(raw).toBeTruthy();
      const parsed = parseDoc(JSON.parse(raw as string));
      expect(parsed!.nodes.c1?.align).toBe('right');
    });
  });
});

describe('Context menu — float / line / zone', () => {
  it('float right-click shows only 삭제, and deletes it', async () => {
    localStorage.setItem('mindflow_doc_cm4', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=cm4&title=x');
    const vp = getViewport(container);
    const { pan, zoom } = computeViewport(DOC as Doc);
    const f = DOC.floats[0]!;
    const { clientX, clientY } = toClient(pan, zoom, f.x + f.w / 2, f.y + 20);

    expect(screen.getByText('주간 메모')).toBeTruthy();
    rightClickAt(vp, clientX, clientY);

    await waitFor(() => expect(screen.getByText('삭제')).toBeTruthy());
    expect(screen.queryByText('자식 주제')).toBeNull();
    fireEvent.mouseDown(screen.getByText('삭제'));

    await waitFor(() => expect(screen.queryByText('주간 메모')).toBeNull());
  });

  it('line right-click shows 삭제, and deletes it', async () => {
    localStorage.setItem('mindflow_doc_cm5', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=cm5&title=x');
    const vp = getViewport(container);
    const { pan, zoom } = computeViewport(DOC as Doc);
    // the line is straight (c1=c2=0), so its midpoint is exactly the geometric midpoint
    const l = DOC.lines[0]!;
    const midX = (l.x1 + l.x2) / 2;
    const midY = (l.y1 + l.y2) / 2;
    const { clientX, clientY } = toClient(pan, zoom, midX, midY);

    rightClickAt(vp, clientX, clientY);
    await waitFor(() => expect(screen.getByText('삭제')).toBeTruthy());
    fireEvent.mouseDown(screen.getByText('삭제'));

    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => {
      const raw = localStorage.getItem('mindflow_doc_cm5');
      const parsed = parseDoc(JSON.parse(raw as string));
      expect(parsed!.lines.length).toBe(0);
    });
  });

  it('zone right-click shows 이름 편집/삭제; 이름 편집 enters inline editing', async () => {
    localStorage.setItem('mindflow_doc_cm6', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=cm6&title=x');
    const vp = getViewport(container);
    const { pan, zoom } = computeViewport(DOC as Doc);
    const z = DOC.zones[0]!;
    const { clientX, clientY } = toClient(pan, zoom, z.x + z.w / 2, z.y + z.h / 2);

    rightClickAt(vp, clientX, clientY);
    // the property panel's OWN rename button also reads "이름 편집" (`ZonePanel.tsx`'s
    // `RenameButton`) — scope to the context menu itself (`.mf-ctx`) to disambiguate.
    const menu = await waitFor(() => {
      const el = container.querySelector('.mf-ctx');
      if (!el) throw new Error('context menu not open yet');
      return el as HTMLElement;
    });
    const scoped = within(menu);
    expect(scoped.getByText('이름 편집')).toBeTruthy();
    expect(scoped.getByText('삭제')).toBeTruthy();
    fireEvent.mouseDown(scoped.getByText('이름 편집'));

    await waitFor(() => expect(within(container).getByDisplayValue('1분기')).toBeTruthy());
  });
});

describe('Context menu — multi-selection', () => {
  it('right-clicking a multi-selected node shows 삭제 (N개)', async () => {
    localStorage.setItem('mindflow_doc_cm7', JSON.stringify(NODES_ONLY_DOC));
    const { container } = renderEditor('/editor?map=cm7&title=x');
    const vp = getViewport(container);

    // marquee-select everything (root + c1), same technique as EditorC.interactions.test.tsx
    firePointer(vp, 'pointerdown', { pointerId: 9, clientX: -100000, clientY: -100000, button: 0 });
    firePointer(window, 'pointermove', { pointerId: 9, clientX: 100000, clientY: 100000 });
    firePointer(window, 'pointerup', { pointerId: 9, clientX: 100000, clientY: 100000 });
    await waitFor(() => expect(screen.getByText('다중 선택')).toBeTruthy());

    const { pan, zoom, geom } = computeViewport(NODES_ONLY_DOC as Doc);
    const c1 = geom.c1!;
    const { clientX, clientY } = toClient(pan, zoom, c1.x, c1.y);
    rightClickAt(vp, clientX, clientY);

    await waitFor(() => expect(screen.getByText('삭제 (2개)')).toBeTruthy());
  });
});

describe('Context menu — background', () => {
  it('shows 4 add items; 메모 추가 creates a float near the right-clicked spot', async () => {
    localStorage.setItem('mindflow_doc_cm8', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=cm8&title=x');
    const vp = getViewport(container);
    const { pan, zoom } = computeViewport(DOC as Doc);
    // far from every existing object, so hitTestAll finds nothing
    const spotX = 5000;
    const spotY = 5000;
    const { clientX, clientY } = toClient(pan, zoom, spotX, spotY);

    rightClickAt(vp, clientX, clientY);
    await waitFor(() => expect(screen.getByText('도형 추가')).toBeTruthy());
    expect(screen.getByText('메모 추가')).toBeTruthy();
    expect(screen.getByText('선 추가')).toBeTruthy();
    expect(screen.getByText('영역 추가')).toBeTruthy();

    fireEvent.mouseDown(screen.getByText('메모 추가'));
    // menu closes after the item runs
    await waitFor(() => expect(screen.queryByText('메모 추가')).toBeNull());

    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => {
      const raw = localStorage.getItem('mindflow_doc_cm8');
      const parsed = parseDoc(JSON.parse(raw as string));
      expect(parsed!.floats.length).toBe(DOC.floats.length + 1);
      const created = parsed!.floats.find((f) => !DOC.floats.some((orig) => orig.id === f.id));
      expect(created).toBeTruthy();
      expect(Math.abs(created!.x - spotX)).toBeLessThan(5);
      expect(Math.abs(created!.y - spotY)).toBeLessThan(5);
    });
  });
});

describe('Context menu — closing', () => {
  it('Escape closes it', async () => {
    localStorage.setItem('mindflow_doc_cm9', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=cm9&title=x');
    const vp = getViewport(container);
    const { pan, zoom } = computeViewport(DOC as Doc);
    const { clientX, clientY } = toClient(pan, zoom, 5000, 5000);

    rightClickAt(vp, clientX, clientY);
    await waitFor(() => expect(screen.getByText('도형 추가')).toBeTruthy());

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText('도형 추가')).toBeNull());
  });

  it('an outside click closes it', async () => {
    localStorage.setItem('mindflow_doc_cm10', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=cm10&title=x');
    const vp = getViewport(container);
    const { pan, zoom } = computeViewport(DOC as Doc);
    const { clientX, clientY } = toClient(pan, zoom, 5000, 5000);

    rightClickAt(vp, clientX, clientY);
    await waitFor(() => expect(screen.getByText('도형 추가')).toBeTruthy());

    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByText('도형 추가')).toBeNull());
  });

  it('a right-click-drag (pan) does not open the menu', async () => {
    localStorage.setItem('mindflow_doc_cm11', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=cm11&title=x');
    const vp = getViewport(container);

    // right-button drag = pan (MindFlow.dc.html:1651-1654) — moved > 3px
    firePointer(vp, 'pointerdown', { pointerId: 3, clientX: 50, clientY: 50, button: 2 });
    firePointer(window, 'pointermove', { pointerId: 3, clientX: 90, clientY: 90 });
    firePointer(window, 'pointerup', { pointerId: 3, clientX: 90, clientY: 90 });
    // the browser's own `contextmenu` event follows the same right-button gesture
    fireEvent.contextMenu(vp, { clientX: 90, clientY: 90, button: 2 });

    // give any (incorrect) async menu-open a tick to appear, then assert it never did
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByText('도형 추가')).toBeNull();
    expect(screen.queryByText('삭제')).toBeNull();
  });
});

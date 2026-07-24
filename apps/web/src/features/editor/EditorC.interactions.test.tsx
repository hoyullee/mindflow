import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Doc } from '@mindflow/mindmap-core';
import { ROOT_ID, layout, parseDoc } from '@mindflow/mindmap-core';
import { Editor } from './Editor';
import { CanvasTextMeasurer, computeMetrics } from './metrics';

// M3-Editor-c interaction tests: marquee multi-select + its bulk property panel,
// multi-delete, the minimap, outline-view editing (Tab), and drag-to-reparent.
// Complements Editor.test.tsx (Editor-a) / Editor.interactions.test.tsx (Editor-b).
//
// jsdom in this project's test environment has no native `PointerEvent`
// (`'PointerEvent' in window` is `false`), so `@testing-library/dom`'s
// `fireEvent.pointerDown(el, { clientX, ... })` silently falls back to a bare
// `Event` that drops clientX/clientY/button/pointerId entirely (see
// `@testing-library/dom/dist/events.js`'s `window[EventType] || window.Event`).
// `firePointer` below works around that gap by dispatching a real `MouseEvent`
// (natively supported by jsdom, carries clientX/clientY/button) under the
// `pointerdown`/`pointermove`/`pointerup` event NAME React listens for, with a
// `pointerId` property attached manually.
function firePointer(target: Element | Window, type: 'pointerdown' | 'pointermove' | 'pointerup', init: { pointerId?: number; clientX?: number; clientY?: number; button?: number } = {}): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: init.clientX ?? 0, clientY: init.clientY ?? 0, button: init.button ?? 0 });
  Object.defineProperty(event, 'pointerId', { value: init.pointerId ?? 1, configurable: true });
  fireEvent(target, event);
}

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

function countNodeBoxes(container: HTMLElement): number {
  return getViewport(container).querySelectorAll('[data-node-id]').length;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

const SIMPLE_DOC = {
  v: 1,
  nodes: {
    root: { id: 'root', text: '루트', emoji: '', parent: null, children: ['c1', 'c2'], collapsed: false, color: null, x: 0, y: 0 },
    c1: { id: 'c1', text: '노드A', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0 },
    c2: { id: 'c2', text: '노드B', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0 },
  },
  floats: [],
  lines: [],
  zones: [],
  layoutMode: 'right',
  themeKey: 'coral',
};

describe('Editor multi-select (M3-Editor-c: marquee)', () => {
  it('marquee-dragging over the background selects multiple nodes and shows the multi-select panel', async () => {
    localStorage.setItem('mindflow_doc_mc1', JSON.stringify(SIMPLE_DOC));
    const { container } = renderEditor('/editor?map=mc1&title=x');
    const vp = getViewport(container);

    // a huge client-space rectangle always maps (after the pan/zoom-aware canvas
    // conversion) to a canvas rectangle far larger than any laid-out node extent,
    // regardless of the exact pan/zoom fitView happened to settle on.
    firePointer(vp, 'pointerdown', { pointerId: 9, clientX: -100000, clientY: -100000, button: 0 });
    firePointer(window, 'pointermove', { pointerId: 9, clientX: 100000, clientY: 100000 });
    firePointer(window, 'pointerup', { pointerId: 9, clientX: 100000, clientY: 100000 });

    await waitFor(() => expect(screen.getByText('다중 선택')).toBeTruthy());
    expect(screen.getByText('도형 3개 선택됨')).toBeTruthy(); // root + c1 + c2
  });

  it('Delete with a multi-selection removes every targeted node (except the root) in one action', async () => {
    localStorage.setItem('mindflow_doc_mc2', JSON.stringify(SIMPLE_DOC));
    const { container } = renderEditor('/editor?map=mc2&title=x');
    const vp = getViewport(container);
    const before = countNodeBoxes(container);
    expect(before).toBe(3);

    firePointer(vp, 'pointerdown', { pointerId: 9, clientX: -100000, clientY: -100000, button: 0 });
    firePointer(window, 'pointermove', { pointerId: 9, clientX: 100000, clientY: 100000 });
    firePointer(window, 'pointerup', { pointerId: 9, clientX: 100000, clientY: 100000 });
    await waitFor(() => expect(screen.getByText('다중 선택')).toBeTruthy());

    fireEvent.keyDown(window, { key: 'Delete' });

    // the root can never be deleted (`deleteNodesMulti` skips it) — only c1/c2 go
    await waitFor(() => expect(countNodeBoxes(container)).toBe(1));
    expect(within(getViewport(container)).getByText('루트')).toBeTruthy();
    expect(screen.queryByText('다중 선택')).toBeNull();
  });

  it('Escape with a multi-selection clears it', async () => {
    localStorage.setItem('mindflow_doc_mc3', JSON.stringify(SIMPLE_DOC));
    const { container } = renderEditor('/editor?map=mc3&title=x');
    const vp = getViewport(container);

    firePointer(vp, 'pointerdown', { pointerId: 9, clientX: -100000, clientY: -100000, button: 0 });
    firePointer(window, 'pointermove', { pointerId: 9, clientX: 100000, clientY: 100000 });
    firePointer(window, 'pointerup', { pointerId: 9, clientX: 100000, clientY: 100000 });
    await waitFor(() => expect(screen.getByText('다중 선택')).toBeTruthy());

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText('다중 선택')).toBeNull());
    expect(countNodeBoxes(container)).toBe(3); // nothing was deleted
  });
});

describe('Editor minimap (M3-Editor-c)', () => {
  it('renders a minimap with a viewport rectangle', () => {
    localStorage.setItem('mindflow_doc_mm1', JSON.stringify(SIMPLE_DOC));
    renderEditor('/editor?map=mm1&title=x');
    expect(screen.getByTestId('minimap')).toBeTruthy();
    expect(screen.getByTestId('minimap-viewport')).toBeTruthy();
  });

  // Regression: the minimap must set `touch-action: none`, or a touch device
  // claims a drag on it as a scroll/zoom gesture and stops delivering
  // pointermove after the first move — the drag dies and drag-to-pan is dead
  // on mobile.
  it('sets touch-action: none so touch drag-to-pan is not stolen by the browser', () => {
    localStorage.setItem('mindflow_doc_mmt', JSON.stringify(SIMPLE_DOC));
    renderEditor('/editor?map=mmt&title=x');
    const mm = screen.getByTestId('minimap') as unknown as SVGSVGElement;
    expect(mm.style.touchAction).toBe('none');
  });

  // Regression: the viewport rectangle must be clamped to the minimap box — it
  // used to spill outside (and balloon into a distorted band) when the visible
  // area extended past the node cluster.
  it('clamps the viewport rectangle within the minimap box', () => {
    localStorage.setItem('mindflow_doc_mmc', JSON.stringify(SIMPLE_DOC));
    renderEditor('/editor?map=mmc&title=x');
    const box = screen.getByTestId('minimap') as unknown as SVGSVGElement;
    const rect = screen.getByTestId('minimap-viewport') as unknown as SVGRectElement;
    const W = Number(box.getAttribute('width'));
    const H = Number(box.getAttribute('height'));
    const x = Number(rect.getAttribute('x'));
    const y = Number(rect.getAttribute('y'));
    const w = Number(rect.getAttribute('width'));
    const h = Number(rect.getAttribute('height'));
    expect(x).toBeGreaterThanOrEqual(0);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(x + w).toBeLessThanOrEqual(W + 0.01);
    expect(y + h).toBeLessThanOrEqual(H + 0.01);
  });

  // Regression: 주황 뷰포트 사각형은 줌 배율에 따라 커지고 작아져야 한다.
  // 예전엔 매핑 영역이 (뷰포트 크기 ÷ 현재 줌)을 접어 넣어 축척이 줌에
  // 비례했고, 사각형 크기에서 줌이 정확히 소거되어 항상 같은 크기로 보였다.
  it('the viewport rectangle shrinks when zooming IN and grows back when zooming OUT', () => {
    localStorage.setItem('mindflow_doc_mmz', JSON.stringify(SIMPLE_DOC));
    renderEditor('/editor?map=mmz&title=x');
    const rectW = () => Number((screen.getByTestId('minimap-viewport') as unknown as SVGRectElement).getAttribute('width'));
    const w0 = rectW();
    expect(w0).toBeGreaterThan(0);

    fireEvent.click(screen.getByTitle('확대')); // zoom ×1.2
    const wIn = rectW();
    expect(wIn).toBeLessThan(w0 - 0.5);
    // 배율에 반비례 (매핑 자체는 줌과 무관하게 고정이므로 정확히 1/1.2)
    expect(wIn).toBeCloseTo(w0 / 1.2, 1);

    fireEvent.click(screen.getByTitle('축소')); // back to the original zoom
    expect(rectW()).toBeCloseTo(w0, 1);
  });

  it('the minimap toggle button hides and re-shows it', async () => {
    localStorage.setItem('mindflow_doc_mm2', JSON.stringify(SIMPLE_DOC));
    renderEditor('/editor?map=mm2&title=x');
    expect(screen.getByTestId('minimap')).toBeTruthy();

    fireEvent.click(screen.getByTitle('미니맵 표시/숨기기'));
    expect(screen.queryByTestId('minimap')).toBeNull();

    fireEvent.click(screen.getByTitle('미니맵 표시/숨기기'));
    expect(screen.getByTestId('minimap')).toBeTruthy();
  });

  // Regression: dragging the minimap horizontally must pan horizontally only —
  // no vertical drift. The bounds were recomputed from content ∪ viewport every
  // frame, so panning shifted the minimap's own coordinate system under the
  // pointer (a feedback loop) and a straight drag jumped around on both axes.
  // The fix freezes the bounds for the duration of the drag.
  it('a horizontal minimap drag pans horizontally with no vertical drift', () => {
    localStorage.setItem('mindflow_doc_mm3', JSON.stringify(SIMPLE_DOC));
    const { container } = renderEditor('/editor?map=mm3&title=x');
    const layer = container.querySelector('.mf-ed-vp div[style*="translate"]') as HTMLElement;
    const panY = (): number => {
      const m = /translate\([^,]+,\s*([-\d.]+)px\)/.exec(layer.style.transform);
      return m ? Number(m[1]) : NaN;
    };
    const panX = (): number => {
      const m = /translate\(\s*([-\d.]+)px/.exec(layer.style.transform);
      return m ? Number(m[1]) : NaN;
    };

    const mm = screen.getByTestId('minimap');
    // start the drag, then move straight right in equal steps (clientY fixed)
    firePointer(mm, 'pointerdown', { pointerId: 3, clientX: 30, clientY: 40, button: 0 });
    firePointer(mm, 'pointermove', { pointerId: 3, clientX: 45, clientY: 40 });
    const x1 = panX();
    const y1 = panY();
    firePointer(mm, 'pointermove', { pointerId: 3, clientX: 60, clientY: 40 });
    const x2 = panX();
    const y2 = panY();
    firePointer(mm, 'pointermove', { pointerId: 3, clientX: 75, clientY: 40 });
    const x3 = panX();
    const y3 = panY();
    firePointer(window, 'pointerup', { pointerId: 3, clientX: 75, clientY: 40 });

    // vertical pan stays put across the horizontal drag (the freeze fix)…
    expect(y2).toBeCloseTo(y1, 3);
    expect(y3).toBeCloseTo(y1, 3);
    // …and horizontal pan moves by a constant step (smooth, linear tracking)
    expect(x2 - x1).toBeCloseTo(x3 - x2, 3);
    expect(Math.abs(x2 - x1)).toBeGreaterThan(0);
  });
});

describe('Editor initial view', () => {
  // The default view on entry must center the ROOT node in the viewport, so the
  // top-level shape is front-and-center (not shoved to an edge by a one-sided
  // layout's bounding-box centering).
  it('centers the root node horizontally on load', () => {
    localStorage.setItem('mindflow_doc_iv1', JSON.stringify(SIMPLE_DOC));
    const { container } = renderEditor('/editor?map=iv1&title=x');

    // root's laid-out canvas x (same layout the hook runs)
    const measurer = new CanvasTextMeasurer();
    const sizeOf = (node: Parameters<typeof computeMetrics>[0], depth: number) => {
      const m = computeMetrics(node, depth, measurer);
      return { w: m.w, h: m.h };
    };
    const laidOut = layout(SIMPLE_DOC as Doc, SIMPLE_DOC.layoutMode as Doc['layoutMode'], sizeOf, { rootAnchor: { x: 0, y: 0 } });
    const rootX = laidOut[ROOT_ID]!.x;

    const layer = container.querySelector('.mf-ed-vp div[style*="translate"]') as HTMLElement;
    const t = /translate\(\s*([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([-\d.]+)\)/.exec(layer.style.transform)!;
    const panX = Number(t[1]);
    const zoom = Number(t[3]);
    const vw = 1200; // jsdom default (no ResizeObserver) — matches INITIAL_VIEWPORT
    const rootScreenX = rootX * zoom + panX;
    expect(rootScreenX).toBeCloseTo(vw / 2, 0);
  });
});

describe('Editor outline editing (M3-Editor-c)', () => {
  it('Tab on a selected outline row adds a child node that reflects back into the map view', async () => {
    localStorage.setItem('mindflow_doc_oc1', JSON.stringify(SIMPLE_DOC));
    const { container } = renderEditor('/editor?map=oc1&title=x');
    const before = countNodeBoxes(container);

    fireEvent.click(screen.getByRole('button', { name: /보기/ })); // open the 보기 menu
    fireEvent.click(screen.getByRole('button', { name: /아웃라인/ }));
    const outline = container.querySelector('.mf-ed-outline') as HTMLElement;
    expect(outline).toBeTruthy();

    fireEvent.mouseDown(within(outline).getByText('노드A'));
    fireEvent.keyDown(window, { key: 'Tab' });

    // the new node starts in outline edit mode (an <input>, not a <div>, holding it)
    await waitFor(() => expect(within(outline).getByDisplayValue('새 주제')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /보기/ })); // reopen the 보기 menu
    fireEvent.click(screen.getByRole('button', { name: '맵' }));
    await waitFor(() => expect(countNodeBoxes(container)).toBe(before + 1));
  });

  it('F2 on a selected outline row starts renaming it, and Escape commits (not cancels)', async () => {
    localStorage.setItem('mindflow_doc_oc2', JSON.stringify(SIMPLE_DOC));
    const { container } = renderEditor('/editor?map=oc2&title=x');
    fireEvent.click(screen.getByRole('button', { name: /보기/ })); // open the 보기 menu
    fireEvent.click(screen.getByRole('button', { name: /아웃라인/ }));
    const outline = container.querySelector('.mf-ed-outline') as HTMLElement;

    fireEvent.mouseDown(within(outline).getByText('노드A'));
    fireEvent.keyDown(window, { key: 'F2' });
    const input = within(outline).getByDisplayValue('노드A') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '새 이름' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    await waitFor(() => expect(within(outline).getByText('새 이름')).toBeTruthy());
  });
});

describe('free-shape drag keeps the grab offset (regression: 중심이 커서로 스냅)', () => {
  it('moves a free shape by exactly the pointer delta, even when grabbed off-centre', async () => {
    // 자유 도형 하나 — 레이아웃이 저장 좌표를 그대로 앵커한다.
    const FREE_DOC = {
      v: 1,
      nodes: {
        root: { id: 'root', text: '루트', emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 },
        f1: { id: 'f1', text: '자유도형', emoji: '', parent: null, children: [], collapsed: false, color: null, x: 320, y: 40, free: true },
      },
      floats: [],
      lines: [],
      zones: [],
      layoutMode: 'right',
      themeKey: 'coral',
    };
    localStorage.setItem('mindflow_doc_grab1', JSON.stringify(FREE_DOC));
    const { container } = renderEditor('/editor?map=grab1&title=x');

    // 훅과 동일한 지오메트리/핏 재현 (reparent 테스트와 같은 방식)
    const measurer = new CanvasTextMeasurer();
    const sizeOf = (node: Parameters<typeof computeMetrics>[0], depth: number) => {
      const m = computeMetrics(node, depth, measurer);
      return { w: m.w, h: m.h };
    };
    const laidOut = layout(FREE_DOC as Doc, 'right', sizeOf, { rootAnchor: { x: 0, y: 0 } });
    const geom: Record<string, { x: number; y: number; w: number; h: number }> = {};
    for (const id of ['root', 'f1']) {
      const n = laidOut[id]!;
      const m = computeMetrics(n, 0, measurer);
      geom[id] = { x: n.x, y: n.y, w: m.w, h: m.h };
    }
    const FIT_PADDING = 90;
    const vw = 1200;
    const vh = 700;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const id of ['root', 'f1']) {
      const g = geom[id]!;
      minX = Math.min(minX, g.x - g.w / 2);
      maxX = Math.max(maxX, g.x + g.w / 2);
      minY = Math.min(minY, g.y - g.h / 2);
      maxY = Math.max(maxY, g.y + g.h / 2);
    }
    const cx = geom.root!.x;
    const cy = geom.root!.y;
    const halfW = Math.max(cx - minX, maxX - cx, 1);
    const halfH = Math.max(cy - minY, maxY - cy, 1);
    const zoom = Math.max(0.25, Math.min((vw - FIT_PADDING) / (2 * halfW), (vh - FIT_PADDING) / (2 * halfH), 1.25));
    const pan = { x: vw / 2 - cx * zoom, y: vh / 2 - cy * zoom };

    const f1 = geom.f1!;
    // 중심이 아니라 오른쪽-아래로 치우친 지점을 잡는다 (그랩 오프셋 존재)
    const grabX = (f1.x + f1.w * 0.4) * zoom + pan.x;
    const grabY = (f1.y + f1.h * 0.3) * zoom + pan.y;
    const CANVAS_DX = 60;
    const CANVAS_DY = 20;

    const el = container.querySelector('[data-node-id="f1"]') as HTMLElement;
    expect(el).toBeTruthy();
    firePointer(el, 'pointerdown', { pointerId: 9, clientX: grabX, clientY: grabY, button: 0 });
    firePointer(window, 'pointermove', { pointerId: 9, clientX: grabX + CANVAS_DX * zoom, clientY: grabY + CANVAS_DY * zoom });
    firePointer(window, 'pointerup', { pointerId: 9, clientX: grabX + CANVAS_DX * zoom, clientY: grabY + CANVAS_DY * zoom });

    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(
      () => {
        const parsed = parseDoc(JSON.parse(localStorage.getItem('mindflow_doc_grab1') as string));
        // 포인터 이동량만큼만 이동해야 한다 — 중심 스냅 버그였다면
        // 그랩 오프셋(w*0.4, h*0.3)이 추가로 더해져 크게 어긋난다.
        expect(parsed!.nodes.f1!.x).toBeCloseTo(320 + CANVAS_DX, 0);
        expect(parsed!.nodes.f1!.y).toBeCloseTo(40 + CANVAS_DY, 0);
      },
      { timeout: 2000 },
    );
  });
});

describe('Editor drag-to-reparent (M3-Editor-c)', () => {
  it('dropping a node onto another node reparents it (and re-runs layout)', async () => {
    localStorage.setItem('mindflow_doc_rp1', JSON.stringify(SIMPLE_DOC));
    const { container } = renderEditor('/editor?map=rp1&title=x');

    // Replicate the SAME `layout()` + `computeMetrics`-driven geometry, and the SAME
    // `fitView` formula (constants copied from `useEditorState.ts`), that the hook itself
    // computes on mount, so we can compute a client point that lands exactly on node c2's
    // box — jsdom never lays out real pixels, so there's no DOM measurement to read instead.
    const measurer = new CanvasTextMeasurer();
    const sizeOf = (node: Parameters<typeof computeMetrics>[0], depth: number) => {
      const m = computeMetrics(node, depth, measurer);
      return { w: m.w, h: m.h };
    };
    const laidOut = layout(SIMPLE_DOC as Doc, SIMPLE_DOC.layoutMode as Doc['layoutMode'], sizeOf, { rootAnchor: { x: 0, y: 0 } });
    const depthOf: Record<string, number> = { root: 0, c1: 1, c2: 1 };
    const geom: Record<string, { x: number; y: number; w: number; h: number }> = {};
    for (const id of ['root', 'c1', 'c2']) {
      const n = laidOut[id]!;
      const m = computeMetrics(n, depthOf[id]!, measurer);
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
    for (const id of ['root', 'c1', 'c2']) {
      const g = geom[id]!;
      minX = Math.min(minX, g.x - g.w / 2);
      maxX = Math.max(maxX, g.x + g.w / 2);
      minY = Math.min(minY, g.y - g.h / 2);
      maxY = Math.max(maxY, g.y + g.h / 2);
    }
    // Mirrors `useEditorState`'s `centerOnRoot`: center the ROOT node at a zoom
    // that keeps the farthest content on either side visible, capped at 1.25×.
    const cx = geom.root ? geom.root.x : (minX + maxX) / 2;
    const cy = geom.root ? geom.root.y : (minY + maxY) / 2;
    const halfW = Math.max(cx - minX, maxX - cx, 1);
    const halfH = Math.max(cy - minY, maxY - cy, 1);
    let z = Math.min((vw - FIT_PADDING) / (2 * halfW), (vh - FIT_PADDING) / (2 * halfH), 1.25);
    z = Math.max(MIN_ZOOM, z);
    const pan = { x: vw / 2 - cx * z, y: vh / 2 - cy * z };
    const zoom = z;

    const target = geom.c2!;
    const targetClientX = target.x * zoom + pan.x;
    const targetClientY = target.y * zoom + pan.y;

    const nodeA = container.querySelector('[data-node-id="c1"]') as HTMLElement;
    expect(nodeA).toBeTruthy();

    firePointer(nodeA, 'pointerdown', { pointerId: 7, clientX: 0, clientY: 0, button: 0 });
    firePointer(window, 'pointermove', { pointerId: 7, clientX: targetClientX, clientY: targetClientY });
    // While hovering c2's center, the target shows the attach-zone hint badge
    // (dropping here makes c1 a CHILD of c2).
    expect(screen.getByText('자식으로 연결')).toBeTruthy();
    firePointer(window, 'pointerup', { pointerId: 7, clientX: targetClientX, clientY: targetClientY });
    // …and the badge is gone once the drag ends.
    expect(screen.queryByText('자식으로 연결')).toBeNull();

    fireEvent.keyDown(window, { key: 's', ctrlKey: true }); // force a save so we can inspect the result

    await waitFor(
      () => {
        const raw = localStorage.getItem('mindflow_doc_rp1');
        expect(raw).toBeTruthy();
        const parsed = parseDoc(JSON.parse(raw as string));
        expect(parsed).toBeTruthy();
        expect(parsed!.nodes.c1?.parent).toBe('c2');
        expect(parsed!.nodes.c2?.children).toEqual(['c1']);
        expect(parsed!.nodes[ROOT_ID]?.children).toEqual(['c2']);
      },
      { timeout: 2000 },
    );
  });

  it('reparenting nudges an overlapping free shape clear of the re-laid-out tree', async () => {
    // Tree geometry is independent of free shapes, so lay out the tree first to
    // find c2's box, then drop a free shape 'f' right on top of it (small text so
    // it stays inside c2's box → doesn't change the fit-view bounds).
    const measurer = new CanvasTextMeasurer();
    const sizeOf = (node: Parameters<typeof computeMetrics>[0], depth: number) => {
      const m = computeMetrics(node, depth, measurer);
      return { w: m.w, h: m.h };
    };
    const laidOut = layout(SIMPLE_DOC as Doc, SIMPLE_DOC.layoutMode as Doc['layoutMode'], sizeOf, { rootAnchor: { x: 0, y: 0 } });
    const depthOf: Record<string, number> = { root: 0, c1: 1, c2: 1 };
    const geom: Record<string, { x: number; y: number; w: number; h: number }> = {};
    for (const id of ['root', 'c1', 'c2']) {
      const n = laidOut[id]!;
      const m = computeMetrics(n, depthOf[id]!, measurer);
      geom[id] = { x: n.x, y: n.y, w: m.w, h: m.h };
    }
    const c2 = geom.c2!;

    const doc = {
      ...SIMPLE_DOC,
      nodes: {
        ...structuredClone(SIMPLE_DOC.nodes),
        f: { id: 'f', text: 'F', emoji: '', parent: null, children: [], collapsed: false, color: null, free: true, x: c2.x, y: c2.y },
      },
    };
    localStorage.setItem('mindflow_doc_rpn', JSON.stringify(doc));
    const { container } = renderEditor('/editor?map=rpn&title=x');

    // fit-view (same constants/formula as useEditorState) → client point on c2
    const FIT_PADDING = 90;
    const MIN_ZOOM = 0.25;
    const vw = 1200;
    const vh = 700;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const id of ['root', 'c1', 'c2']) {
      const g = geom[id]!;
      minX = Math.min(minX, g.x - g.w / 2);
      maxX = Math.max(maxX, g.x + g.w / 2);
      minY = Math.min(minY, g.y - g.h / 2);
      maxY = Math.max(maxY, g.y + g.h / 2);
    }
    const cx = geom.root!.x;
    const cy = geom.root!.y;
    const halfW = Math.max(cx - minX, maxX - cx, 1);
    const halfH = Math.max(cy - minY, maxY - cy, 1);
    const zoom = Math.max(MIN_ZOOM, Math.min((vw - FIT_PADDING) / (2 * halfW), (vh - FIT_PADDING) / (2 * halfH), 1.25));
    const pan = { x: vw / 2 - cx * zoom, y: vh / 2 - cy * zoom };
    const tx = c2.x * zoom + pan.x;
    const ty = c2.y * zoom + pan.y;

    const nodeA = container.querySelector('[data-node-id="c1"]') as HTMLElement;
    firePointer(nodeA, 'pointerdown', { pointerId: 7, clientX: 0, clientY: 0, button: 0 });
    firePointer(window, 'pointermove', { pointerId: 7, clientX: tx, clientY: ty });
    expect(screen.getByText('자식으로 연결')).toBeTruthy(); // confirms the drop lands on c2
    firePointer(window, 'pointerup', { pointerId: 7, clientX: tx, clientY: ty });

    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(
      () => {
        const parsed = parseDoc(JSON.parse(localStorage.getItem('mindflow_doc_rpn') as string));
        expect(parsed!.nodes.c1?.parent).toBe('c2'); // reparent happened
        expect(parsed!.nodes.f?.parent ?? null).toBeNull(); // f stays a free shape
        // …and f was pushed off c2's centre so it no longer overlaps the tree
        const f = parsed!.nodes.f!;
        expect(f.x !== c2.x || f.y !== c2.y).toBe(true);
      },
      { timeout: 2000 },
    );
  });

  it('clicking a node off-centre (no drag) never detaches it from the tree', async () => {
    // A wide child so its right edge is >40px (the detach gate) from its centre.
    const WIDE_DOC = {
      v: 1,
      nodes: {
        root: { id: 'root', text: '루트', emoji: '', parent: null, children: ['c1'], collapsed: false, color: null, x: 0, y: 0 },
        c1: { id: 'c1', text: '아주 아주 긴 자식 노드 이름 텍스트', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0 },
      },
      floats: [],
      lines: [],
      zones: [],
      layoutMode: 'right',
      themeKey: 'coral',
    };
    localStorage.setItem('mindflow_doc_oc1', JSON.stringify(WIDE_DOC));
    const { container } = renderEditor('/editor?map=oc1&title=x');

    // Replicate the hook's mount geometry + fitView to land a client point on c1's RIGHT EDGE.
    const measurer = new CanvasTextMeasurer();
    const sizeOf = (node: Parameters<typeof computeMetrics>[0], depth: number) => {
      const m = computeMetrics(node, depth, measurer);
      return { w: m.w, h: m.h };
    };
    const laidOut = layout(WIDE_DOC as Doc, WIDE_DOC.layoutMode as Doc['layoutMode'], sizeOf, { rootAnchor: { x: 0, y: 0 } });
    const depthOf: Record<string, number> = { root: 0, c1: 1 };
    const geom: Record<string, { x: number; y: number; w: number; h: number }> = {};
    for (const id of ['root', 'c1']) {
      const n = laidOut[id]!;
      const m = computeMetrics(n, depthOf[id]!, measurer);
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
    for (const id of ['root', 'c1']) {
      const g = geom[id]!;
      minX = Math.min(minX, g.x - g.w / 2);
      maxX = Math.max(maxX, g.x + g.w / 2);
      minY = Math.min(minY, g.y - g.h / 2);
      maxY = Math.max(maxY, g.y + g.h / 2);
    }
    const cx = geom.root!.x;
    const cy = geom.root!.y;
    const halfW = Math.max(cx - minX, maxX - cx, 1);
    const halfH = Math.max(cy - minY, maxY - cy, 1);
    let z = Math.min((vw - FIT_PADDING) / (2 * halfW), (vh - FIT_PADDING) / (2 * halfH), 1.25);
    z = Math.max(MIN_ZOOM, z);
    const pan = { x: vw / 2 - cx * z, y: vh / 2 - cy * z };

    // sanity: the grabbed point really is >40 canvas px off-centre (would trip the old gate)
    expect(geom.c1!.w / 2).toBeGreaterThan(40);
    const edgeClientX = (geom.c1!.x + geom.c1!.w / 2 - 6) * z + pan.x;
    const edgeClientY = geom.c1!.y * z + pan.y;

    const nodeC1 = container.querySelector('[data-node-id="c1"]') as HTMLElement;
    expect(nodeC1).toBeTruthy();

    // press + release at the SAME point (a click, no pointermove)
    firePointer(nodeC1, 'pointerdown', { pointerId: 5, clientX: edgeClientX, clientY: edgeClientY, button: 0 });
    firePointer(window, 'pointerup', { pointerId: 5, clientX: edgeClientX, clientY: edgeClientY });

    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    // give the debounced save a beat, then assert c1 is STILL a child of root (not detached)
    await new Promise((r) => setTimeout(r, 50));
    const raw = localStorage.getItem('mindflow_doc_oc1');
    const parsed = parseDoc(JSON.parse(raw as string));
    expect(parsed!.nodes.c1?.parent).toBe('root');
    expect(parsed!.nodes.c1?.free).toBeFalsy();
    expect(parsed!.nodes[ROOT_ID]?.children).toEqual(['c1']);
  });
});

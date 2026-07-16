import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Doc } from '@mindflow/mindmap-core';
import { layout } from '@mindflow/mindmap-core';
import { Editor } from './Editor';
import { CanvasTextMeasurer, computeMetrics } from './metrics';

// Line endpoint anchor magnet tests (`a1`/`a2`, port of MindFlow.dc.html:1728-1734,
// 2377-2454): dragging a line's endpoint handle near a node/float port snaps + anchors
// it (magnet dot appears); the anchored endpoint then tracks that node's box on every
// render (so moving the node drags the line along); dropping far from any port detaches
// it back to a plain raw-coordinate endpoint. Complements Editor.interactions.test.tsx's
// (Editor-b) plain line-end drag coverage (pre-anchor) and `geometry.test.ts`'s core-level
// `findLineSnap`/`resolveLineEndpoints` unit tests.
//
// jsdom has no native `PointerEvent` — see `EditorC.interactions.test.tsx`'s `firePointer`
// doc comment for the full explanation; this file uses the identical helper.
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

/** A single free-standing root (no children) + one free line whose endpoints start well
 * clear of the root's box, so the initial render has NO anchor on either end. */
const DOC = {
  v: 1,
  nodes: {
    root: { id: 'root', text: '루트', emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 },
  },
  floats: [],
  lines: [{ id: 'ln1', x1: -300, y1: -260, x2: -260, y2: -260, startArrow: false, endArrow: true, dashed: false, c1: 0, c2: 0, label: '' }],
  zones: [],
  layoutMode: 'right',
  themeKey: 'coral',
};

/** Replicates `useEditorState`'s `layout()` + `computeMetrics`-driven geometry and its
 * `fitView` formula (same constants), so a test can compute the exact CLIENT point a given
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
  const bw = Math.max(1, maxX - minX);
  const bh = Math.max(1, maxY - minY);
  let z = Math.min((vw - FIT_PADDING) / bw, (vh - FIT_PADDING) / bh, 1.25);
  z = Math.max(MIN_ZOOM, z);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const pan = { x: vw / 2 - cx * z, y: vh / 2 - cy * z };
  return { pan, zoom: z, geom };
}

function toClient(pan: { x: number; y: number }, zoom: number, x: number, y: number): { clientX: number; clientY: number } {
  return { clientX: x * zoom + pan.x, clientY: y * zoom + pan.y };
}

/** Every magnet-dot `<circle r="4">` currently rendered (anchored-endpoint indicator,
 * port of MindFlow.dc.html:1360-1362) — used to assert anchor presence/absence without
 * reaching into controller/doc internals. */
function magnetDots(container: HTMLElement): SVGCircleElement[] {
  return Array.from(getViewport(container).querySelectorAll('circle[r="4"]'));
}

function selectLine(container: HTMLElement, lineId: string): void {
  const hitPath = getViewport(container).querySelector(`path[stroke="transparent"]`) as SVGPathElement;
  expect(hitPath).toBeTruthy();
  firePointer(hitPath, 'pointerdown', { pointerId: 3, clientX: 0, clientY: 0, button: 0 });
  firePointer(window, 'pointerup', { pointerId: 3, clientX: 0, clientY: 0 });
  void lineId;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('line endpoint anchor magnet (M3-Editor: line anchors)', () => {
  it('dragging an endpoint near a node port snaps + anchors it (magnet dot appears)', () => {
    localStorage.setItem('mindflow_doc_la1', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=la1&title=x');

    const { pan, zoom, geom } = computeViewport(DOC as Doc);
    const root = geom.root!;
    const portX = root.x + root.w / 2;
    const portY = root.y;

    expect(magnetDots(container)).toHaveLength(0);

    selectLine(container, 'ln1');

    const handle = Array.from(getViewport(container).querySelectorAll('circle')).find((c) => c.querySelector('title')?.textContent === '끝점') as SVGCircleElement;
    expect(handle).toBeTruthy();
    const start = toClient(pan, zoom, -260, -260); // DOC's ln1.x2/y2 (unanchored raw start)
    const target = toClient(pan, zoom, portX, portY);

    firePointer(handle, 'pointerdown', { pointerId: 5, clientX: start.clientX, clientY: start.clientY, button: 0 });
    firePointer(window, 'pointermove', { pointerId: 5, clientX: target.clientX, clientY: target.clientY });

    // mid-drag: the snap-target box's 4 ports light up (port of `_snapHi`'s port-indicator
    // dots, MindFlow.dc.html:1388-1402) — 4 round divs, one per side, the hovered one bigger.
    expect(getViewport(container).querySelectorAll('div[style*="border-radius: 50%"]')).toHaveLength(4);

    firePointer(window, 'pointerup', { pointerId: 5, clientX: target.clientX, clientY: target.clientY });

    // the drag ended — port indicators clear (port of `Component#onUp`'s `_snapHi = null`)
    expect(getViewport(container).querySelectorAll('div[style*="border-radius: 50%"]')).toHaveLength(0);

    const dots = magnetDots(container);
    expect(dots).toHaveLength(1);
    expect(Number(dots[0]!.getAttribute('cx'))).toBeCloseTo(portX, 1);
    expect(Number(dots[0]!.getAttribute('cy'))).toBeCloseTo(portY, 1);
  });

  it('an anchored endpoint follows the node when it moves', () => {
    localStorage.setItem('mindflow_doc_la2', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=la2&title=x');

    const { pan, zoom, geom } = computeViewport(DOC as Doc);
    const root = geom.root!;
    const portX = root.x + root.w / 2;
    const portY = root.y;

    selectLine(container, 'ln1');
    const handle = Array.from(getViewport(container).querySelectorAll('circle')).find((c) => c.querySelector('title')?.textContent === '끝점') as SVGCircleElement;
    const start = toClient(pan, zoom, -260, -260);
    const target = toClient(pan, zoom, portX, portY);
    firePointer(handle, 'pointerdown', { pointerId: 5, clientX: start.clientX, clientY: start.clientY, button: 0 });
    firePointer(window, 'pointermove', { pointerId: 5, clientX: target.clientX, clientY: target.clientY });
    firePointer(window, 'pointerup', { pointerId: 5, clientX: target.clientX, clientY: target.clientY });
    expect(magnetDots(container)).toHaveLength(1);

    // now drag the ROOT node itself by a canvas-space delta (50, 30) — port of the 'root' drag
    // kind (MindFlow.dc.html:1816-1819): dx/dy are delta-based (not absolute), so an arbitrary
    // start client point works as long as the target is offset by delta*zoom from it.
    const nodeEl = container.querySelector('[data-node-id="root"]') as HTMLElement;
    expect(nodeEl).toBeTruthy();
    const dxCanvas = 50;
    const dyCanvas = 30;
    firePointer(nodeEl, 'pointerdown', { pointerId: 9, clientX: 100, clientY: 100, button: 0 });
    firePointer(window, 'pointermove', { pointerId: 9, clientX: 100 + dxCanvas * zoom, clientY: 100 + dyCanvas * zoom });
    firePointer(window, 'pointerup', { pointerId: 9, clientX: 100 + dxCanvas * zoom, clientY: 100 + dyCanvas * zoom });

    const dots = magnetDots(container);
    expect(dots).toHaveLength(1);
    expect(Number(dots[0]!.getAttribute('cx'))).toBeCloseTo(portX + dxCanvas, 0);
    expect(Number(dots[0]!.getAttribute('cy'))).toBeCloseTo(portY + dyCanvas, 0);
  });

  it('dropping an endpoint far from any port leaves it unanchored (no magnet dot)', () => {
    localStorage.setItem('mindflow_doc_la3', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=la3&title=x');
    const { pan, zoom } = computeViewport(DOC as Doc);

    selectLine(container, 'ln1');
    const handle = Array.from(getViewport(container).querySelectorAll('circle')).find((c) => c.querySelector('title')?.textContent === '끝점') as SVGCircleElement;
    const start = toClient(pan, zoom, -260, -260);
    const farAway = toClient(pan, zoom, 5000, 5000);
    firePointer(handle, 'pointerdown', { pointerId: 5, clientX: start.clientX, clientY: start.clientY, button: 0 });
    firePointer(window, 'pointermove', { pointerId: 5, clientX: farAway.clientX, clientY: farAway.clientY });
    firePointer(window, 'pointerup', { pointerId: 5, clientX: farAway.clientX, clientY: farAway.clientY });

    expect(magnetDots(container)).toHaveLength(0);
  });

  it('re-dragging an already-anchored endpoint away from every port detaches it', () => {
    localStorage.setItem('mindflow_doc_la4', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=la4&title=x');
    const { pan, zoom, geom } = computeViewport(DOC as Doc);
    const root = geom.root!;
    const portX = root.x + root.w / 2;
    const portY = root.y;

    selectLine(container, 'ln1');
    const handle = Array.from(getViewport(container).querySelectorAll('circle')).find((c) => c.querySelector('title')?.textContent === '끝점') as SVGCircleElement;
    const start = toClient(pan, zoom, -260, -260);
    const port = toClient(pan, zoom, portX, portY);
    firePointer(handle, 'pointerdown', { pointerId: 5, clientX: start.clientX, clientY: start.clientY, button: 0 });
    firePointer(window, 'pointermove', { pointerId: 5, clientX: port.clientX, clientY: port.clientY });
    firePointer(window, 'pointerup', { pointerId: 5, clientX: port.clientX, clientY: port.clientY });
    expect(magnetDots(container)).toHaveLength(1);

    // re-grab the SAME handle (now rendered at the port point) and drop it far away
    const handle2 = Array.from(getViewport(container).querySelectorAll('circle')).find((c) => c.querySelector('title')?.textContent === '끝점') as SVGCircleElement;
    const farAway = toClient(pan, zoom, 5000, 5000);
    firePointer(handle2, 'pointerdown', { pointerId: 6, clientX: port.clientX, clientY: port.clientY, button: 0 });
    firePointer(window, 'pointermove', { pointerId: 6, clientX: farAway.clientX, clientY: farAway.clientY });
    firePointer(window, 'pointerup', { pointerId: 6, clientX: farAway.clientX, clientY: farAway.clientY });

    expect(magnetDots(container)).toHaveLength(0);
  });
});

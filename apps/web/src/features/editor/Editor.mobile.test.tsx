import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Editor } from './Editor';
import { mockMatchMedia } from '../../test/matchMedia';

// M6: the property panel (NodePanel/LinePanel/FloatPanel/ZonePanel, all via
// `panelWrapStyle`) switches from a floating left side panel to a bottom
// sheet on mobile. This only asserts the mobile-prop/state-driven rendering
// doesn't crash and keeps behaving like the desktop panel (same selection ->
// panel content), not exact pixel geometry (covered by the design/CLAUDE.md
// mobile spec, verified visually, not via jsdom layout).

const DOC = {
  v: 1,
  nodes: {
    root: { id: 'root', text: '제품 로드맵', emoji: '🎯', parent: null, children: ['c1'], collapsed: false, color: null, x: 0, y: 0 },
    c1: { id: 'c1', text: '리서치', emoji: '', parent: 'root', children: [], collapsed: false, color: '#3f8fd0', x: 0, y: 0 },
  },
  floats: [],
  lines: [],
  zones: [],
  layoutMode: 'radial',
  themeKey: 'coral',
};

function renderEditor(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/editor" element={<Editor />} />
      </Routes>
    </MemoryRouter>,
  );
}

function getViewport(container: HTMLElement): HTMLElement {
  const el = container.querySelector('.mf-ed-vp');
  if (!el) throw new Error('viewport not found');
  return el as HTMLElement;
}

function selectNodeBox(el: HTMLElement): void {
  fireEvent.pointerDown(el, { pointerId: 1, clientX: 100, clientY: 100, button: 0 });
  fireEvent.pointerUp(window, { pointerId: 1, clientX: 100, clientY: 100 });
}

/** Mobile: open the property bottom sheet via the selection bar's 속성 button
 * (selection alone no longer auto-opens it). */
function openMobileProps(): void {
  fireEvent.click(screen.getByText('속성'));
}

/**
 * Dispatch a native PointerEvent with `pointerType: 'touch'`. jsdom's
 * `fireEvent` drops `pointerType`, so we build the event ourselves and force
 * the field (React's synthetic layer reads it off the native event), wrapped in
 * `act` so the resulting state updates flush.
 */
function touchEvent(target: EventTarget, type: string, init: { pointerId: number; clientX: number; clientY: number }): void {
  // jsdom has no `PointerEvent` global; a MouseEvent carries clientX/Y/button,
  // and React's synthetic pointer layer reads pointerId/pointerType straight
  // off the native event, so we add them as own properties.
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: init.clientX, clientY: init.clientY });
  Object.defineProperty(ev, 'pointerId', { value: init.pointerId });
  Object.defineProperty(ev, 'pointerType', { value: 'touch' });
  act(() => {
    target.dispatchEvent(ev);
  });
}

/** The pan/zoom transform layer inside `.mf-ed-vp` (see Viewport.tsx). */
function getTransformLayer(container: HTMLElement): HTMLElement {
  const vp = getViewport(container);
  const el = vp.querySelector('div[style*="translate"]');
  if (!el) throw new Error('transform layer not found');
  return el as HTMLElement;
}

/** Walk up from a node inside the zoom cluster to its absolutely-positioned root. */
function getZoomCluster(container: HTMLElement): HTMLElement {
  const fit = within(container).getByTitle('화면 맞춤');
  let el: HTMLElement | null = fit;
  while (el && el.style.position !== 'absolute') el = el.parentElement;
  if (!el) throw new Error('zoom cluster not found');
  return el;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('Editor (mobile, M6)', () => {
  it('renders the toolbar, canvas, and zoom controls crash-free with no selection', () => {
    const restore = mockMatchMedia(true);
    try {
      localStorage.setItem('mindflow_doc_m1', JSON.stringify(DOC));
      renderEditor('/editor?map=m1&title=x');

      // undo/redo now live inside the 편집 menu; the menu-bar trigger is present
      expect(screen.getByRole('button', { name: '편집' })).toBeTruthy();
      expect(screen.getByTitle('화면 맞춤')).toBeTruthy();
      // the desktop-only mouse-gesture legend is dropped on mobile
      expect(screen.queryByText(/좌드래그/)).toBeNull();
      // the −/배율/＋ zoom buttons are dropped on mobile (pinch to zoom instead),
      // leaving just the minimap toggle + 화면 맞춤 so the cluster stays compact
      expect(screen.queryByTitle('축소')).toBeNull();
      expect(screen.queryByTitle('확대')).toBeNull();
      expect(screen.queryByText(/%$/)).toBeNull();
    } finally {
      restore();
    }
  });

  it('keeps the −/배율/＋ zoom buttons on desktop', () => {
    const restore = mockMatchMedia(false);
    try {
      localStorage.setItem('mindflow_doc_m1d', JSON.stringify(DOC));
      renderEditor('/editor?map=m1d&title=x');
      expect(screen.getByTitle('축소')).toBeTruthy();
      expect(screen.getByTitle('확대')).toBeTruthy();
    } finally {
      restore();
    }
  });

  it('does NOT auto-open the property sheet on mobile selection (opens via the 속성 bar)', () => {
    const restore = mockMatchMedia(true);
    try {
      localStorage.setItem('mindflow_doc_m2b', JSON.stringify(DOC));
      const { container } = renderEditor('/editor?map=m2b&title=x');
      const vp = within(getViewport(container));
      const nodeBox = vp.getByText('리서치').closest('[data-node-id]') as HTMLElement;
      selectNodeBox(nodeBox);

      // selected, but the bottom sheet stays closed — only the selection bar shows
      expect(screen.queryByText('선택한 주제')).toBeNull();
      expect(screen.getByText('속성')).toBeTruthy();

      // opening it via the bar reveals the panel; closing keeps the selection
      openMobileProps();
      expect(screen.getByText('선택한 주제')).toBeTruthy();
      fireEvent.click(screen.getByLabelText('속성 닫기'));
      expect(screen.queryByText('선택한 주제')).toBeNull();
      expect(screen.getByText('속성')).toBeTruthy(); // still selected → bar back
    } finally {
      restore();
    }
  });

  it('selection bar offers 하위/형제 for a node — touch has no Tab/Enter, so this grows the tree', () => {
    const restore = mockMatchMedia(true);
    try {
      localStorage.setItem('mindflow_doc_mab1', JSON.stringify(DOC));
      const { container } = renderEditor('/editor?map=mab1&title=x');
      const vp = getViewport(container);
      const boxes = () => vp.querySelectorAll('[data-node-id]').length;
      const before = boxes();

      const c1 = within(vp).getByText('리서치').closest('[data-node-id]') as HTMLElement;
      selectNodeBox(c1);
      const bar = screen.getByRole('toolbar', { name: '선택 동작' });
      expect(within(bar).getByText('하위')).toBeTruthy();
      expect(within(bar).getByText('형제')).toBeTruthy();

      // 하위 → a child is added under 리서치 and opens for inline editing
      fireEvent.click(within(bar).getByText('하위'));
      expect(boxes()).toBe(before + 1);
      expect(vp.querySelector('.mf-richedit')).toBeTruthy();
    } finally {
      restore();
    }
  });

  it('selection bar hides 형제 for the root (like the context menu), keeps 하위', () => {
    const restore = mockMatchMedia(true);
    try {
      localStorage.setItem('mindflow_doc_mab2', JSON.stringify(DOC));
      const { container } = renderEditor('/editor?map=mab2&title=x');
      const vp = getViewport(container);
      const rootBox = vp.querySelector('[data-node-id="root"]') as HTMLElement;
      selectNodeBox(rootBox);
      const bar = screen.getByRole('toolbar', { name: '선택 동작' });
      expect(within(bar).getByText('하위')).toBeTruthy();
      expect(within(bar).queryByText('형제')).toBeNull();
      // float 선택에는 노드 전용 버튼이 없어야 하지만 여기선 노드 케이스만 —
      // 편집/속성/삭제 기본 3종은 그대로 남아 있다.
      expect(within(bar).getByText('편집')).toBeTruthy();
      expect(within(bar).getByText('삭제')).toBeTruthy();
    } finally {
      restore();
    }
  });

  it('shows the property panel as a bottom sheet (fixed to the viewport bottom) once opened', () => {
    const restore = mockMatchMedia(true);
    try {
      localStorage.setItem('mindflow_doc_m2', JSON.stringify(DOC));
      const { container } = renderEditor('/editor?map=m2&title=x');

      const vp = within(getViewport(container));
      const nodeBox = vp.getByText('리서치').closest('[data-node-id]') as HTMLElement;
      selectNodeBox(nodeBox);
      openMobileProps();

      const heading = screen.getByText('선택한 주제');
      expect(heading).toBeTruthy();

      // walk up to the panel wrapper (the `panelWrapStyle` div) and check it
      // switched to the mobile bottom-sheet positioning.
      let el: HTMLElement | null = heading;
      while (el && el.style.position !== 'fixed') el = el.parentElement;
      expect(el).not.toBeNull();
      expect(el?.style.bottom).toBe('0px');
      // fixed (not max-) height, so expanding an accordion section scrolls
      // inside the sheet instead of resizing it
      expect(el?.style.height).toBe('55dvh');
      expect(el?.style.maxHeight).toBe('');
    } finally {
      restore();
    }
  });

  it('pans the canvas on a one-finger touch drag (not rubber-band selection)', () => {
    const restore = mockMatchMedia(true);
    try {
      localStorage.setItem('mindflow_doc_m3', JSON.stringify(DOC));
      const { container } = renderEditor('/editor?map=m3&title=x');
      const vp = getViewport(container);
      const before = getTransformLayer(container).style.transform;

      // one-finger touch drag on the background
      touchEvent(vp, 'pointerdown', { pointerId: 5, clientX: 120, clientY: 120 });
      touchEvent(window, 'pointermove', { pointerId: 5, clientX: 200, clientY: 180 });
      touchEvent(window, 'pointerup', { pointerId: 5, clientX: 200, clientY: 180 });

      const after = getTransformLayer(container).style.transform;
      expect(after).not.toBe(before); // the pan moved
      // and it did NOT open a marquee multi-selection panel
      expect(screen.queryByText(/개 선택됨/)).toBeNull();
    } finally {
      restore();
    }
  });

  it('touch: a press-drag starting on a node pans instead of selecting it', () => {
    const restore = mockMatchMedia(true);
    try {
      localStorage.setItem('mindflow_doc_m6', JSON.stringify(DOC));
      const { container } = renderEditor('/editor?map=m6&title=x');
      const vp = getViewport(container);
      const node = within(vp).getByText('리서치').closest('[data-node-id]') as HTMLElement;
      const before = getTransformLayer(container).style.transform;

      // one-finger touch press ON the node, then drag: should pan the canvas,
      // NOT select/move the node (the press bubbles to the background pan)
      touchEvent(node, 'pointerdown', { pointerId: 8, clientX: 140, clientY: 140 });
      touchEvent(window, 'pointermove', { pointerId: 8, clientX: 230, clientY: 200 });
      touchEvent(window, 'pointerup', { pointerId: 8, clientX: 230, clientY: 200 });

      expect(getTransformLayer(container).style.transform).not.toBe(before); // panned
      expect(screen.queryByText('선택한 주제')).toBeNull(); // node NOT selected
    } finally {
      restore();
    }
  });

  it('touch: a stationary long-press opens the context menu (right-click equivalent)', () => {
    const restore = mockMatchMedia(true);
    vi.useFakeTimers();
    try {
      localStorage.setItem('mindflow_doc_m8', JSON.stringify(DOC));
      const { container } = renderEditor('/editor?map=m8&title=x');
      const vp = getViewport(container);

      // press on empty background and hold still
      touchEvent(vp, 'pointerdown', { pointerId: 11, clientX: 12, clientY: 12 });
      // before the hold elapses → no menu
      act(() => vi.advanceTimersByTime(300));
      expect(screen.queryByText('도형 추가')).toBeNull();
      // after the full hold → the (background) context menu opens
      act(() => vi.advanceTimersByTime(300));
      expect(screen.getByText('도형 추가')).toBeTruthy();
    } finally {
      vi.useRealTimers();
      restore();
    }
  });

  it('touch: a press that moves before the hold elapses pans and opens no menu', () => {
    const restore = mockMatchMedia(true);
    vi.useFakeTimers();
    try {
      localStorage.setItem('mindflow_doc_m9', JSON.stringify(DOC));
      const { container } = renderEditor('/editor?map=m9&title=x');
      const vp = getViewport(container);

      touchEvent(vp, 'pointerdown', { pointerId: 12, clientX: 12, clientY: 12 });
      touchEvent(window, 'pointermove', { pointerId: 12, clientX: 90, clientY: 80 }); // moves > tol
      act(() => vi.advanceTimersByTime(600));
      expect(screen.queryByText('도형 추가')).toBeNull(); // long-press was cancelled
    } finally {
      vi.useRealTimers();
      restore();
    }
  });

  it('touch: a no-move tap on a node selects it on release (not on press)', () => {
    const restore = mockMatchMedia(true);
    try {
      localStorage.setItem('mindflow_doc_m7', JSON.stringify(DOC));
      const { container } = renderEditor('/editor?map=m7&title=x');
      const vp = getViewport(container);
      const node = within(vp).getByText('리서치').closest('[data-node-id]') as HTMLElement;

      // press alone must NOT select (that's the whole point — no grabbing on
      // touch-down while the user is starting a pan/zoom)
      touchEvent(node, 'pointerdown', { pointerId: 9, clientX: 150, clientY: 150 });
      expect(screen.queryByText('속성')).toBeNull();

      // releasing without moving (a tap) selects it → the mobile selection bar
      // appears (the property sheet no longer auto-opens)
      touchEvent(window, 'pointerup', { pointerId: 9, clientX: 150, clientY: 150 });
      expect(screen.getByText('속성')).toBeTruthy();
      expect(screen.queryByText('선택한 주제')).toBeNull();
    } finally {
      restore();
    }
  });

  it('deselects on a no-move background touch tap (touch equivalent of empty-click deselect)', () => {
    const restore = mockMatchMedia(true);
    try {
      localStorage.setItem('mindflow_doc_m4', JSON.stringify(DOC));
      const { container } = renderEditor('/editor?map=m4&title=x');
      const vp = getViewport(container);
      const nodeBox = within(vp).getByText('리서치').closest('[data-node-id]') as HTMLElement;
      selectNodeBox(nodeBox);
      expect(screen.getByText('속성')).toBeTruthy(); // selected → selection bar shows

      // a no-move touch tap on the empty background clears the selection
      touchEvent(vp, 'pointerdown', { pointerId: 6, clientX: 40, clientY: 300 });
      touchEvent(window, 'pointerup', { pointerId: 6, clientX: 40, clientY: 300 });
      expect(screen.queryByText('속성')).toBeNull();
    } finally {
      restore();
    }
  });

  it('hides the zoom/minimap cluster while a selection panel is open (mobile)', () => {
    const restore = mockMatchMedia(true);
    try {
      localStorage.setItem('mindflow_doc_m5', JSON.stringify(DOC));
      const { container } = renderEditor('/editor?map=m5&title=x');

      // no selection → cluster is pinned bottom-right
      expect(getZoomCluster(container).style.bottom).toBe('16px');

      const vp = getViewport(container);
      const nodeBox = within(vp).getByText('리서치').closest('[data-node-id]') as HTMLElement;
      selectNodeBox(nodeBox);
      // selection alone keeps the cluster (the sheet isn't open yet)
      expect(within(container).queryByTitle('화면 맞춤')).toBeTruthy();

      openMobileProps();
      // panel open → the whole minimap/zoom cluster is gone
      expect(within(container).queryByTitle('화면 맞춤')).toBeNull();
    } finally {
      restore();
    }
  });

  it('centers a selected object into the area above the bottom sheet (mobile)', () => {
    const restore = mockMatchMedia(true);
    try {
      localStorage.setItem('mindflow_doc_m10', JSON.stringify(DOC));
      const { container } = renderEditor('/editor?map=m10&title=x');
      const vp = getViewport(container);

      const nodeBox = within(vp).getByText('리서치').closest('[data-node-id]') as HTMLElement;
      selectNodeBox(nodeBox); // selects c1
      openMobileProps(); // opening the sheet runs the mobile centering effect

      // c1's ACTUAL rendered canvas center (read from its box style, so this is
      // consistent with the geom the centering used — not a re-derived layout).
      const c1Y = parseFloat(nodeBox.style.top) + parseFloat(nodeBox.style.height) / 2;

      const layer = getTransformLayer(container);
      const t = /translate\(\s*[-\d.]+px,\s*([-\d.]+)px\)\s*scale\(([-\d.]+)\)/.exec(layer.style.transform)!;
      const panY = Number(t[1]);
      const zoom = Number(t[2]);
      const screenY = c1Y * zoom + panY;
      const vh = 700; // INITIAL_VIEWPORT vh in jsdom (no ResizeObserver)
      // the object sits in the upper region — clear of a bottom sheet that can
      // cover up to ~55% of the viewport
      expect(screenY).toBeGreaterThan(0);
      expect(screenY).toBeLessThan(vh * 0.45);
    } finally {
      restore();
    }
  });

  it('shows a move grip on the selected object (mobile only)', () => {
    const restore = mockMatchMedia(true);
    try {
      localStorage.setItem('mindflow_doc_m11', JSON.stringify(DOC));
      const { container } = renderEditor('/editor?map=m11&title=x');
      const vp = getViewport(container);
      expect(screen.queryByLabelText('이동')).toBeNull(); // nothing selected → no grip

      const nodeBox = within(vp).getByText('리서치').closest('[data-node-id]') as HTMLElement;
      selectNodeBox(nodeBox);
      expect(screen.getByLabelText('이동')).toBeTruthy(); // selected → move grip appears
    } finally {
      restore();
    }
  });

  it('does NOT show the move grip on desktop', () => {
    const restore = mockMatchMedia(false);
    try {
      localStorage.setItem('mindflow_doc_m11d', JSON.stringify(DOC));
      const { container } = renderEditor('/editor?map=m11d&title=x');
      const vp = getViewport(container);
      const nodeBox = within(vp).getByText('리서치').closest('[data-node-id]') as HTMLElement;
      selectNodeBox(nodeBox);
      expect(screen.queryByLabelText('이동')).toBeNull();
    } finally {
      restore();
    }
  });

  it('touch: dragging the ALREADY-selected node moves it instead of panning the canvas', () => {
    const restore = mockMatchMedia(true);
    try {
      localStorage.setItem('mindflow_doc_m12', JSON.stringify(DOC));
      const { container } = renderEditor('/editor?map=m12&title=x');
      const vp = getViewport(container);
      const node = within(vp).getByText('리서치').closest('[data-node-id]') as HTMLElement;

      // select first (tap), then a touch press-drag ON it must move it — the
      // canvas pan transform stays put (unlike an unselected node, which pans).
      selectNodeBox(node);
      const before = getTransformLayer(container).style.transform;
      touchEvent(node, 'pointerdown', { pointerId: 20, clientX: 150, clientY: 150 });
      touchEvent(window, 'pointermove', { pointerId: 20, clientX: 260, clientY: 240 });
      touchEvent(window, 'pointerup', { pointerId: 20, clientX: 260, clientY: 240 });

      expect(getTransformLayer(container).style.transform).toBe(before); // did NOT pan
    } finally {
      restore();
    }
  });
});

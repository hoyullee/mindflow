import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

      expect(screen.getByTitle('실행 취소 (Ctrl+Z)')).toBeTruthy();
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

  it('shows the property panel as a bottom sheet (fixed to the viewport bottom) on node selection', () => {
    const restore = mockMatchMedia(true);
    try {
      localStorage.setItem('mindflow_doc_m2', JSON.stringify(DOC));
      const { container } = renderEditor('/editor?map=m2&title=x');

      const vp = within(getViewport(container));
      const nodeBox = vp.getByText('리서치').closest('[data-node-id]') as HTMLElement;
      selectNodeBox(nodeBox);

      const heading = screen.getByText('선택한 주제');
      expect(heading).toBeTruthy();

      // walk up to the panel wrapper (the `panelWrapStyle` div) and check it
      // switched to the mobile bottom-sheet positioning.
      let el: HTMLElement | null = heading;
      while (el && el.style.position !== 'fixed') el = el.parentElement;
      expect(el).not.toBeNull();
      expect(el?.style.bottom).toBe('0px');
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

  it('deselects on a no-move background touch tap (touch equivalent of empty-click deselect)', () => {
    const restore = mockMatchMedia(true);
    try {
      localStorage.setItem('mindflow_doc_m4', JSON.stringify(DOC));
      const { container } = renderEditor('/editor?map=m4&title=x');
      const vp = getViewport(container);
      const nodeBox = within(vp).getByText('리서치').closest('[data-node-id]') as HTMLElement;
      selectNodeBox(nodeBox);
      expect(screen.getByText('선택한 주제')).toBeTruthy();

      // a no-move touch tap on the empty background clears the selection
      touchEvent(vp, 'pointerdown', { pointerId: 6, clientX: 40, clientY: 300 });
      touchEvent(window, 'pointerup', { pointerId: 6, clientX: 40, clientY: 300 });
      expect(screen.queryByText('선택한 주제')).toBeNull();
    } finally {
      restore();
    }
  });

  it('lifts the zoom/minimap cluster above the bottom-sheet panel when a selection is open', () => {
    const restore = mockMatchMedia(true);
    try {
      localStorage.setItem('mindflow_doc_m5', JSON.stringify(DOC));
      const { container } = renderEditor('/editor?map=m5&title=x');

      // no selection → cluster pinned to the bottom
      expect(getZoomCluster(container).style.bottom).toBe('16px');

      const vp = getViewport(container);
      const nodeBox = within(vp).getByText('리서치').closest('[data-node-id]') as HTMLElement;
      selectNodeBox(nodeBox);

      // panel open → cluster lifts above the 55dvh sheet
      expect(getZoomCluster(container).style.bottom).toContain('55dvh');
    } finally {
      restore();
    }
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
});

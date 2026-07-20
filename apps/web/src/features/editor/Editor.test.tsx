import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Editor } from './Editor';

const GOLDEN_DOC = {
  v: 1,
  nodes: {
    root: { id: 'root', text: '제품 로드맵', emoji: '🎯', parent: null, children: ['c1', 'c2', 'c3'], collapsed: false, color: null, x: 0, y: 0 },
    c1: { id: 'c1', text: '리서치', emoji: '', parent: 'root', children: ['g1', 'g2'], collapsed: false, color: '#3f8fd0', x: 0, y: 0 },
    c2: { id: 'c2', text: '디자인', emoji: '', parent: 'root', children: ['g3'], collapsed: false, color: null, x: 0, y: 0 },
    c3: { id: 'c3', text: '개발', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0 },
    g1: { id: 'g1', text: '사용자 인터뷰', emoji: '🗣️', parent: 'c1', children: [], collapsed: false, color: null, x: 0, y: 0 },
    g2: { id: 'g2', text: '경쟁 분석', emoji: '', parent: 'c1', children: [], collapsed: false, color: null, x: 0, y: 0 },
    g3: { id: 'g3', text: '와이어프레임', emoji: '', parent: 'c2', children: [], collapsed: false, color: null, x: 0, y: 0, bold: true },
  },
  floats: [{ id: 'flt1', x: -260, y: 160, w: 200, text: '주간 회고 메모' }],
  lines: [{ id: 'ln1', x1: -120, y1: 40, x2: 120, y2: 40, startArrow: false, endArrow: true, dashed: true, c1: 0, c2: 0, label: '흐름' }],
  zones: [{ id: 'zn1', x: -320, y: -220, w: 300, h: 180, label: '1분기', color: null }],
  layoutMode: 'radial',
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

/** Scopes queries to the canvas viewport, since the doc-chip title also
 * echoes the root node's text (a legitimate duplicate — not a test bug). */
function getViewport(container: HTMLElement): HTMLElement {
  const el = container.querySelector('.mf-ed-vp');
  if (!el) throw new Error('viewport not found');
  return el as HTMLElement;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('Editor', () => {
  it('renders every node text from a saved doc (mindflow_doc_golden)', () => {
    localStorage.setItem('mindflow_doc_golden', JSON.stringify(GOLDEN_DOC));

    const { container } = renderEditor('/editor?map=golden&title=%EC%A0%9C%ED%92%88%20%EB%A1%9C%EB%93%9C%EB%A7%B5');
    const vp = within(getViewport(container));

    expect(vp.getByText('제품 로드맵')).toBeTruthy();
    expect(vp.getByText('리서치')).toBeTruthy();
    expect(vp.getByText('디자인')).toBeTruthy();
    expect(vp.getByText('개발')).toBeTruthy();
    expect(vp.getByText('사용자 인터뷰')).toBeTruthy();
    expect(vp.getByText('경쟁 분석')).toBeTruthy();
    expect(vp.getByText('와이어프레임')).toBeTruthy();
    // floats / lines render too
    expect(vp.getByText('주간 회고 메모')).toBeTruthy();
    expect(vp.getByText('흐름')).toBeTruthy();
  });

  it('re-renders without crashing when the layout mode / edge style / theme is switched', async () => {
    localStorage.setItem('mindflow_doc_golden', JSON.stringify(GOLDEN_DOC));
    const user = userEvent.setup();
    const { container } = renderEditor('/editor?map=golden&title=x');
    const vp = within(getViewport(container));

    expect(vp.getByText('제품 로드맵')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '스타일' })); // open the 스타일 menu
    await user.click(screen.getByRole('button', { name: '조직도' }));

    // still renders the same document after the layout switch
    expect(vp.getByText('제품 로드맵')).toBeTruthy();
    expect(vp.getByText('와이어프레임')).toBeTruthy();
    expect(screen.getByRole('button', { name: '조직도' }).getAttribute('aria-pressed')).toBe('true');

    // edge-style + theme switches also re-render without crashing
    await user.click(screen.getByRole('button', { name: '꺾은선' }));
    await user.click(screen.getByTitle('오션'));
    expect(vp.getByText('제품 로드맵')).toBeTruthy();
  });

  it('renders a fresh single-root document for a new map', () => {
    const { container } = renderEditor('/editor?map=new-abc123&new=1&title=%EC%83%88%20%EB%A7%88%EC%9D%B8%EB%93%9C%EB%A7%B5');
    const vp = within(getViewport(container));

    expect(vp.getByText('새 마인드맵')).toBeTruthy();
  });

  it('switches to the outline view', async () => {
    localStorage.setItem('mindflow_doc_golden', JSON.stringify(GOLDEN_DOC));
    const user = userEvent.setup();
    const { container } = renderEditor('/editor?map=golden&title=x');

    await user.click(screen.getByRole('button', { name: /보기/ })); // open the 보기 menu
    await user.click(screen.getByRole('button', { name: /아웃라인/ }));

    const outline = container.querySelector('.mf-ed-outline') as HTMLElement;
    expect(outline).toBeTruthy();
    expect(within(outline).getByText('제품 로드맵')).toBeTruthy();
    expect(within(outline).getByText('사용자 인터뷰')).toBeTruthy();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Editor } from './Editor';
import { toMarkdown, parseDoc } from '@mindflow/mindmap-core';

// M3-Editor-b interaction tests: selection, text editing, structural add/
// delete, property-panel setters, save (manual + autosave), undo/redo, and
// export. Complements `Editor.test.tsx` (Editor-a: rendering/pan/zoom/view).

const DOC = {
  v: 1,
  nodes: {
    root: { id: 'root', text: '제품 로드맵', emoji: '🎯', parent: null, children: ['c1', 'c2'], collapsed: false, color: null, x: 0, y: 0 },
    c1: { id: 'c1', text: '리서치', emoji: '', parent: 'root', children: [], collapsed: false, color: '#3f8fd0', x: 0, y: 0 },
    c2: { id: 'c2', text: '디자인', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0 },
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

/** Reads a `Blob`'s text via `FileReader` — jsdom's `Blob`/`Response` don't
 * interoperate cleanly across realms, but `FileReader` (part of jsdom's own
 * File API) reads a jsdom `Blob` correctly. */
function readBlobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

function getViewport(container: HTMLElement): HTMLElement {
  const el = container.querySelector('.mf-ed-vp');
  if (!el) throw new Error('viewport not found');
  return el as HTMLElement;
}

function nodeBoxFor(container: HTMLElement, text: string): HTMLElement {
  const vp = within(getViewport(container));
  const el = vp.getByText(text).closest('[data-node-id]');
  if (!el) throw new Error(`node box for "${text}" not found`);
  return el as HTMLElement;
}

function selectNodeBox(el: HTMLElement): void {
  fireEvent.pointerDown(el, { pointerId: 1, clientX: 100, clientY: 100, button: 0 });
  fireEvent.pointerUp(window, { pointerId: 1, clientX: 100, clientY: 100 });
}

function countNodeBoxes(container: HTMLElement): number {
  return getViewport(container).querySelectorAll('[data-node-id]').length;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Editor interactions (M3-Editor-b)', () => {
  it('selecting a node shows the property panel', () => {
    localStorage.setItem('mindflow_doc_t1', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=t1&title=x');

    expect(screen.queryByText('선택한 주제')).toBeNull();
    selectNodeBox(nodeBoxFor(container, '리서치'));
    expect(screen.getByText('선택한 주제')).toBeTruthy();
    // the panel echoes the selected node's own text
    expect(within(screen.getByText('선택한 주제').parentElement as HTMLElement).getByText('리서치')).toBeTruthy();
  });

  it('property panel sections are a collapsed-by-default one-open accordion', async () => {
    const user = userEvent.setup();
    localStorage.setItem('mindflow_doc_t1acc', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=t1acc&title=x');
    selectNodeBox(nodeBoxFor(container, '리서치'));

    const shapeHdr = screen.getByRole('button', { name: /도형 스타일/ });
    const textHdr = screen.getByRole('button', { name: /텍스트 스타일/ });
    const iconHdr = screen.getByRole('button', { name: /아이콘/ });
    // all collapsed initially
    expect(shapeHdr.getAttribute('aria-expanded')).toBe('false');
    expect(textHdr.getAttribute('aria-expanded')).toBe('false');
    expect(iconHdr.getAttribute('aria-expanded')).toBe('false');

    await user.click(shapeHdr);
    expect(shapeHdr.getAttribute('aria-expanded')).toBe('true');

    // opening another collapses the first (accordion — one open at a time)
    await user.click(textHdr);
    expect(textHdr.getAttribute('aria-expanded')).toBe('true');
    expect(shapeHdr.getAttribute('aria-expanded')).toBe('false');

    // clicking an open header collapses it
    await user.click(textHdr);
    expect(textHdr.getAttribute('aria-expanded')).toBe('false');
  });

  it('property panel accordion resets to collapsed when the selection changes', async () => {
    const user = userEvent.setup();
    localStorage.setItem('mindflow_doc_t1acc2', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=t1acc2&title=x');

    selectNodeBox(nodeBoxFor(container, '리서치'));
    await user.click(screen.getByRole('button', { name: /도형 스타일/ }));
    expect(screen.getByRole('button', { name: /도형 스타일/ }).getAttribute('aria-expanded')).toBe('true');

    // select a different node → panel remounts, sections back to collapsed
    selectNodeBox(nodeBoxFor(container, '디자인'));
    expect(screen.getByRole('button', { name: /도형 스타일/ }).getAttribute('aria-expanded')).toBe('false');
  });

  it('clicking anywhere in a zone body (not just its label) selects the zone', () => {
    localStorage.setItem('mindflow_doc_zsel', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=zsel&title=x');

    expect(screen.queryByText('선택한 영역')).toBeNull();
    // click the zone's body rectangle, away from its label pill
    const zoneBody = container.querySelector('[data-zone-id="zn1"]') as HTMLElement;
    expect(zoneBody).toBeTruthy();
    fireEvent.pointerDown(zoneBody, { pointerId: 3, clientX: 400, clientY: 400, button: 0 });
    fireEvent.pointerUp(window, { pointerId: 3, clientX: 400, clientY: 400 });

    // the zone property panel is shown (zone got selected from a body click)
    expect(screen.getByText('선택한 영역')).toBeTruthy();
  });

  it('clicking the background clears the selection', () => {
    localStorage.setItem('mindflow_doc_t1b', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=t1b&title=x');
    selectNodeBox(nodeBoxFor(container, '리서치'));
    expect(screen.getByText('선택한 주제')).toBeTruthy();

    fireEvent.pointerDown(getViewport(container), { pointerId: 2, clientX: 5, clientY: 5, button: 0 });
    fireEvent.pointerUp(window, { pointerId: 2, clientX: 5, clientY: 5 });
    expect(screen.queryByText('선택한 주제')).toBeNull();
  });

  it('Tab on a selected node adds a child and re-lays-out the tree', async () => {
    localStorage.setItem('mindflow_doc_t2', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=t2&title=x');
    const before = countNodeBoxes(container);

    selectNodeBox(nodeBoxFor(container, '리서치'));
    fireEvent.keyDown(window, { key: 'Tab' });

    await waitFor(() => expect(countNodeBoxes(container)).toBe(before + 1));
    // the new child starts in edit mode with the default placeholder text
    expect(getViewport(container).querySelector('.mf-richedit')).toBeTruthy();
  });

  it('arrow keys move the node selection to the horizontal neighbour', () => {
    // A single-child chain (A → B → C) in `right` layout: the core places the nodes
    // on a strictly increasing horizontal line (root 0 · b +168 · c +336, same y), so
    // a child always sits to the RIGHT of its parent. (jsdom's canvas-less text
    // measurement shifts the absolute coordinates, but the parent→child left/right
    // adjacency the arrows walk is preserved, so Left/Right traversal is stable.)
    const chain = {
      v: 1,
      nodes: {
        root: { id: 'root', text: 'A', emoji: '', parent: null, children: ['b'], collapsed: false, color: null, x: 0, y: 0 },
        b: { id: 'b', text: 'B', emoji: '', parent: 'root', children: ['c'], collapsed: false, color: null, x: 0, y: 0 },
        c: { id: 'c', text: 'C', emoji: '', parent: 'b', children: [], collapsed: false, color: null, x: 0, y: 0 },
      },
      floats: [],
      lines: [],
      zones: [],
      layoutMode: 'right',
      themeKey: 'coral',
    };
    localStorage.setItem('mindflow_doc_nav', JSON.stringify(chain));
    const { container } = renderEditor('/editor?map=nav&title=x');
    const selectedName = () => (screen.getByText('선택한 주제').nextElementSibling as HTMLElement).textContent;

    selectNodeBox(nodeBoxFor(container, 'B'));
    expect(selectedName()).toBe('B');

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(selectedName()).toBe('C'); // B → child on the right

    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(selectedName()).toBe('B'); // C → back to its parent on the left
  });

  it('arrow keys with nothing selected land on the root node', () => {
    localStorage.setItem('mindflow_doc_navroot', JSON.stringify(DOC));
    renderEditor('/editor?map=navroot&title=x');

    expect(screen.queryByText('선택한 주제')).toBeNull(); // nothing selected
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect((screen.getByText('선택한 주제').nextElementSibling as HTMLElement).textContent).toBe('제품 로드맵');
  });

  it('committing a text edit updates the node in the doc', async () => {
    localStorage.setItem('mindflow_doc_t3', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=t3&title=x');

    const box = nodeBoxFor(container, '디자인');
    fireEvent.doubleClick(box);
    // The node text box is a real `contentEditable` div now (port of MindFlow.dc.html:1200-1224,
    // `NodeLayer.tsx`'s `NodeEditBox`) — jsdom's `Selection`/`Range` support is too limited for
    // `userEvent.type()` to reliably simulate keystroke-by-keystroke replacement of a pre-selected
    // contentEditable's content, so this drives the DOM directly (matching CLAUDE.md's guidance to
    // keep DOM-heavy contentEditable tests to what's actually feasible in jsdom) and fires the same
    // `Enter` keydown the browser would.
    const editor = getViewport(container).querySelector('.mf-richedit') as HTMLDivElement;
    expect(editor).toBeTruthy();
    editor.textContent = '새로운 이름';
    fireEvent.input(editor);
    fireEvent.keyDown(editor, { key: 'Enter' });

    await waitFor(() => expect(within(getViewport(container)).getByText('새로운 이름')).toBeTruthy());
  });

  it('changing shape/color in the property panel updates the node', async () => {
    localStorage.setItem('mindflow_doc_t4', JSON.stringify(DOC));
    const user = userEvent.setup();
    const { container } = renderEditor('/editor?map=t4&title=x');

    selectNodeBox(nodeBoxFor(container, '리서치'));
    await user.click(screen.getByTitle('사각형'));

    await waitFor(() => {
      const box = nodeBoxFor(container, '리서치');
      expect(box.style.borderRadius).toBe('3px');
    });
  });

  it('Ctrl+S (manual save) writes a parseable doc to localStorage', async () => {
    localStorage.setItem('mindflow_doc_t5', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=t5&title=x');
    selectNodeBox(nodeBoxFor(container, '리서치'));
    fireEvent.keyDown(window, { key: 'Tab' }); // dirty the doc first

    fireEvent.keyDown(window, { key: 's', ctrlKey: true });

    await waitFor(
      () => {
        const raw = localStorage.getItem('mindflow_doc_t5');
        expect(raw).toBeTruthy();
        const parsed = parseDoc(JSON.parse(raw as string));
        expect(parsed).toBeTruthy();
        expect(Object.keys(parsed!.nodes).length).toBe(4); // root + c1 + c2 + the new child
      },
      { timeout: 2000 },
    );
  });

  it('persists a connector (edgeStyle) change from the Style menu to the saved doc', async () => {
    const user = userEvent.setup();
    localStorage.setItem('mindflow_doc_edge', JSON.stringify(DOC));
    renderEditor('/editor?map=edge&title=x');

    // open the Style menu and pick 꺾은선 (elbow) under 연결선
    await user.click(screen.getByTitle(/맵 스타일/));
    await user.click(screen.getByRole('button', { name: '꺾은선' }));
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });

    await waitFor(
      () => {
        const raw = localStorage.getItem('mindflow_doc_edge');
        expect(raw).toBeTruthy();
        expect(parseDoc(JSON.parse(raw as string))?.edgeStyle).toBe('elbow');
      },
      { timeout: 2000 },
    );
  });

  it('autosaves after a debounce without pressing Ctrl+S', async () => {
    localStorage.setItem('mindflow_doc_t5b', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=t5b&title=x');
    selectNodeBox(nodeBoxFor(container, '리서치'));
    fireEvent.keyDown(window, { key: 'Tab' });

    await waitFor(
      () => {
        const raw = localStorage.getItem('mindflow_doc_t5b');
        expect(raw).toBeTruthy();
        const parsed = parseDoc(JSON.parse(raw as string));
        expect(Object.keys(parsed!.nodes).length).toBe(4);
      },
      { timeout: 2500 },
    );
  });

  it('undo/redo round-trips a structural change', async () => {
    localStorage.setItem('mindflow_doc_t6', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=t6&title=x');
    const before = countNodeBoxes(container);

    selectNodeBox(nodeBoxFor(container, '리서치'));
    fireEvent.keyDown(window, { key: 'Tab' });
    await waitFor(() => expect(countNodeBoxes(container)).toBe(before + 1));

    // leave text-edit mode (undo/redo is a no-op while a node editor has focus)
    const editor = getViewport(container).querySelector('.mf-richedit') as HTMLDivElement;
    fireEvent.keyDown(editor, { key: 'Escape' });
    await waitFor(() => expect(getViewport(container).querySelector('.mf-richedit')).toBeNull());

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await waitFor(() => expect(countNodeBoxes(container)).toBe(before));

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(countNodeBoxes(container)).toBe(before + 1));
  });

  it('exports Markdown and JSON with the expected content', async () => {
    localStorage.setItem('mindflow_doc_t7', JSON.stringify(DOC));
    const created: Blob[] = [];
    // jsdom doesn't define `URL.createObjectURL`/`revokeObjectURL` at all (not just
    // "not implemented"), so `vi.spyOn` has nothing to wrap — assign directly.
    URL.createObjectURL = vi.fn((b: Blob | MediaSource) => {
      created.push(b as Blob);
      return 'blob:mock';
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn() as typeof URL.revokeObjectURL;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const user = userEvent.setup();
    renderEditor('/editor?map=t7&title=x');

    await user.click(screen.getByTitle('내보내기'));
    await user.click(screen.getByText('텍스트 개요 (.md)'));
    await user.click(screen.getByTitle('내보내기'));
    await user.click(screen.getByText('MindFlow 파일 (.json)'));

    expect(created.length).toBe(2);
    const md = await readBlobText(created[0]!);
    expect(md).toBe(toMarkdown(DOC as never));
    expect(md).toContain('# 🎯 제품 로드맵');
    expect(md).toContain('- 리서치');

    const json = await readBlobText(created[1]!);
    const parsed = JSON.parse(json);
    expect(parsed.nodes.root.text).toBe('제품 로드맵');
    expect(Object.keys(parsed.nodes).length).toBe(3);

    clickSpy.mockRestore();
  });

  it('opens the 스타일 dropdown in a fixed body portal (escapes the top bar clip/stacking)', async () => {
    const user = userEvent.setup();
    localStorage.setItem('mindflow_doc_ts1', JSON.stringify(DOC));
    renderEditor('/editor?map=ts1&title=x');

    await user.click(screen.getByTitle(/맵 스타일/));

    const menu = document.querySelector('.mf-ed-stylemenu') as HTMLElement;
    expect(menu).toBeTruthy();
    // Portaled out of the (overflow-clipping, low-stacked) top bar...
    expect(menu.closest('.mf-ed-topbar')).toBeNull();
    // ...into a fixed-position wrapper stacked above the canvas nodes (z 40/70/80).
    const wrap = menu.parentElement as HTMLElement;
    expect(wrap.style.position).toBe('fixed');
    expect(Number(wrap.style.zIndex)).toBeGreaterThan(80);
    // Controls still render/work.
    expect(screen.getByText('레이아웃')).toBeTruthy();
    expect(screen.getByText('테마')).toBeTruthy();
  });

  describe('duplicate filename guard (rename)', () => {
    // The title chip's non-editing title element (`div[title=...]`), excluding
    // the on-canvas root node box which also shows the title text.
    const chip = (container: HTMLElement, title: string) =>
      Array.from(container.querySelectorAll('div[title]')).find(
        (el) => (el.getAttribute('title') || '') === title && !el.closest('[data-node-id]'),
      ) as HTMLElement | undefined;

    function seedExistingMap() {
      localStorage.setItem('mindflow_doc_existing', JSON.stringify(DOC));
      localStorage.setItem(
        'mindflow_doc_meta_existing',
        JSON.stringify({ version: 1, updatedAt: new Date(0).toISOString(), title: '기존 맵', isFavorite: false, deletedAt: null }),
      );
    }

    it('rejects renaming this map to a name another map already uses', async () => {
      const user = userEvent.setup();
      seedExistingMap();
      const { container } = renderEditor('/editor?map=new-abc123&title=' + encodeURIComponent('내 문서'));

      await waitFor(() => expect(chip(container, '내 문서')).toBeTruthy());
      await user.dblClick(chip(container, '내 문서')!);
      const input = container.querySelector('input.mf-edit') as HTMLInputElement;
      expect(input).toBeTruthy();
      await user.clear(input);
      await user.type(input, '기존 맵{Enter}');

      // Rejected: a warning appears and the title stays "내 문서".
      await waitFor(() => expect((screen.getByRole('alert').textContent || '')).toContain('이미'));
      expect(chip(container, '내 문서')).toBeTruthy();
      expect(chip(container, '기존 맵')).toBeFalsy();
    });

    it('allows renaming this map to a unique title', async () => {
      const user = userEvent.setup();
      seedExistingMap();
      const { container } = renderEditor('/editor?map=new-def456&title=' + encodeURIComponent('내 문서'));

      await waitFor(() => expect(chip(container, '내 문서')).toBeTruthy());
      await user.dblClick(chip(container, '내 문서')!);
      const input = container.querySelector('input.mf-edit') as HTMLInputElement;
      await user.clear(input);
      await user.type(input, '완전히 새로운 이름{Enter}');

      await waitFor(() => expect(chip(container, '완전히 새로운 이름')).toBeTruthy());
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('rejects renaming the map by editing the ROOT node on the canvas', async () => {
      seedExistingMap(); // another map titled "기존 맵"
      // This map's root title is "제품 로드맵" (DOC). list() excludes self by id.
      localStorage.setItem('mindflow_doc_mine', JSON.stringify(DOC));
      const { container } = renderEditor('/editor?map=mine&title=x');

      // Give the mount `docStore.list()` a tick to populate the taken-title set.
      await waitFor(() => expect(within(getViewport(container)).getByText('제품 로드맵')).toBeTruthy());
      await waitFor(() => expect(true).toBe(true));

      const rootBox = nodeBoxFor(container, '제품 로드맵');
      fireEvent.doubleClick(rootBox);
      const editor = getViewport(container).querySelector('.mf-richedit') as HTMLDivElement;
      expect(editor).toBeTruthy();
      editor.textContent = '기존 맵';
      fireEvent.input(editor);
      fireEvent.keyDown(editor, { key: 'Enter' });

      // Blocked: warning shown and the root/title stays "제품 로드맵".
      await waitFor(() => expect(screen.getByRole('alert').textContent || '').toContain('이미'));
      expect(within(getViewport(container)).getByText('제품 로드맵')).toBeTruthy();
      expect(within(getViewport(container)).queryByText('기존 맵')).toBeNull();
    });
  });
});

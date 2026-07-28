import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { parseDoc } from '@mindflow/mindmap-core';
import { Editor } from './Editor';
import { setLinearSelection } from './richtextDom';

// Partial rich-text run styling: `NodeEditBox`'s `contentEditable` node text box
// (`NodeLayer.tsx`, port of MindFlow.dc.html:1200-1224) + the floating "B / color /
// 지우기" toolbar (`TextToolbar.tsx`, port of `tctxBold`/`tctxColor`/`tctxClear`,
// MindFlow.dc.html:3088-3100) driving `@mindflow/mindmap-core`'s `applyPartialStyle`.
// Complements `Editor.interactions.test.tsx` (Editor-b's plain node text editing).

const DOC = {
  v: 1,
  nodes: {
    root: { id: 'root', text: '루트', emoji: '', parent: null, children: ['c1'], collapsed: false, color: null, x: 0, y: 0 },
    c1: { id: 'c1', text: 'hello world', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0 },
  },
  floats: [],
  lines: [],
  zones: [],
  layoutMode: 'right',
  themeKey: 'coral',
};

// Same starting node, but ALREADY carrying a partial bold+color run on "world" —
// used by the "지우기"/"re-bold"/"plain retype" tests below. Rendered (non-editing)
// this shows as two sibling `<span>`s, not one plain text node, so tests that need
// to find the box locate it by `data-node-id` rather than by its visible text.
const RICH_DOC = {
  v: 1,
  nodes: {
    root: { id: 'root', text: '루트', emoji: '', parent: null, children: ['c1'], collapsed: false, color: null, x: 0, y: 0 },
    c1: {
      id: 'c1',
      text: 'hello world',
      emoji: '',
      parent: 'root',
      children: [],
      collapsed: false,
      color: null,
      x: 0,
      y: 0,
      rich: [
        { t: 'hello ', b: false, c: null },
        { t: 'world', b: true, c: '#f0663f' },
      ],
    },
  },
  floats: [],
  lines: [],
  zones: [],
  layoutMode: 'right',
  themeKey: 'coral',
};

/** jsdom has no native `PointerEvent` — see `EditorC.interactions.test.tsx`'s identical
 * helper's doc comment for the full explanation of why this dispatches a `MouseEvent`
 * under the `pointerdown`/`pointerup` event name instead of using `fireEvent.pointerDown`. */
function firePointer(target: Element, type: 'pointerdown' | 'pointerup', init: { pointerId?: number; button?: number } = {}): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: init.button ?? 0 });
  Object.defineProperty(event, 'pointerId', { value: init.pointerId ?? 1, configurable: true });
  fireEvent(target, event);
}

/** A realistic left-click on a toolbar button: the FULL pointer+mouse sequence a browser
 * fires, not just `mousedown`. `TextToolbar.tsx` is a child of `.mf-ed-vp` (which owns
 * `onBackgroundPointerDown`): an unstopped `pointerdown` would bubble to the viewport and
 * start a background marquee drag whose no-move `pointerup` clears the node's text selection
 * (and, via the global outside-mousedown listener, the toolbar itself) out from under the
 * button that's about to act on it — the same class of bug the context-menu's alignment
 * flyout hit (see `ContextMenu.interactions.test.tsx`'s identical helper's doc comment).
 * Firing only `mousedown` would never exercise that leak and would false-pass. */
function clickToolbarButton(el: Element): void {
  firePointer(el, 'pointerdown', { button: 0 });
  fireEvent.mouseDown(el);
  fireEvent.mouseUp(el);
  firePointer(el, 'pointerup', { button: 0 });
  fireEvent.click(el);
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

/** Starts editing the node `id` and returns its live `contentEditable` box — located by
 * `data-node-id` (not visible text: a node with existing `rich` runs renders as several
 * sibling `<span>`s, which `@testing-library`'s text matcher won't join back together). */
function startEditingNode(container: HTMLElement, id: string): HTMLDivElement {
  const box = getViewport(container).querySelector(`[data-node-id="${id}"]`);
  if (!box) throw new Error(`node box "${id}" not found`);
  fireEvent.doubleClick(box);
  const editor = getViewport(container).querySelector('.mf-richedit') as HTMLDivElement;
  expect(editor).toBeTruthy();
  return editor;
}

/** Selects `[s0, s1)` (plain-text offsets) inside the editor and opens the toolbar,
 * exactly as a real drag-selection would (`NodeEditBox`'s `onMouseUp` → `openTextCtx`). */
function selectAndOpenToolbar(editor: HTMLDivElement, s0: number, s1: number): void {
  setLinearSelection(editor, s0, s1);
  fireEvent.mouseUp(editor);
}

/** Commits the node box (Enter, fired on the box itself — its own `onKeyDown` handles it,
 * not a window-level listener) and forces a synchronous save. Does NOT itself wait for the
 * write to land: `Ctrl+S`'s actual `DocStore.save()` is debounced behind a `setTimeout`, and
 * (unlike every OTHER field this codebase's tests assert after a save) `rich` is entirely
 * ABSENT from a never-styled node's serialized JSON rather than merely holding a stale value
 * — so a `waitFor` that only checks "a doc exists" resolves immediately against the STALE
 * doc this test itself seeded into `localStorage` before any edit ever happened, never
 * actually waiting for the real write. Callers must assert the doc's SPECIFIC expected shape
 * inside their own `waitFor` (via `readSavedDoc`) so the retry condition is real. */
function commitAndSave(editor: HTMLDivElement): void {
  fireEvent.keyDown(editor, { key: 'Enter' });
  fireEvent.keyDown(window, { key: 's', ctrlKey: true });
}

/** Parses whatever is currently in `localStorage` for `mapId` — throws (so `waitFor` retries)
 * if nothing's been written yet. Call from inside a `waitFor(() => { ...; expect(...) })` that
 * also asserts the specific field the test cares about, so the retry loop actually waits for
 * the debounced save (see `commitAndSave`'s doc comment). */
function readSavedDoc(mapId: string) {
  const raw = localStorage.getItem(`mindflow_doc_${mapId}`);
  if (!raw) throw new Error('not saved yet');
  const parsed = parseDoc(JSON.parse(raw));
  if (!parsed) throw new Error('unparseable doc');
  return parsed;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('partial rich-text styling — toolbar', () => {
  it('selecting "world" and clicking B applies a partial bold run', async () => {
    localStorage.setItem('mindflow_doc_rt1', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=rt1&title=x');

    const editor = startEditingNode(container, 'c1');
    selectAndOpenToolbar(editor, 6, 11); // "world"
    const boldBtn = within(getViewport(container)).getByTitle('선택 영역 굵게');

    clickToolbarButton(boldBtn);

    // applied directly to the live DOM (no doc commit yet) — port of `applyPartial`
    // rewriting the contentEditable's innerHTML in place (MindFlow.dc.html:2724).
    expect(editor.innerHTML).toContain('font-weight:800');
    expect(editor.textContent).toBe('hello world');
    // the toolbar's own re-selection (`setLinearSelection`) must have kept "world" selected —
    // proof the click didn't blow away the selection (the interaction trap this test guards).
    expect(window.getSelection()?.toString()).toBe('world');
    // the edit box itself must still be open (a leaked pointerdown would have cleared the
    // selection/edit state via the background's no-move-drag pointerup, same bug class as
    // ContextMenu.tsx's alignment-flyout fix).
    expect(getViewport(container).querySelector('.mf-richedit')).toBe(editor);

    commitAndSave(editor);
    await waitFor(() => {
      const doc = readSavedDoc('rt1');
      expect(doc.nodes.c1?.text).toBe('hello world');
      expect(doc.nodes.c1?.rich).toEqual([
        { t: 'hello ', b: false, c: null },
        { t: 'world', b: true, c: null },
      ]);
    });
  });

  it('a color swatch applies a partial color run', async () => {
    localStorage.setItem('mindflow_doc_rt2', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=rt2&title=x');

    const editor = startEditingNode(container, 'c1');
    selectAndOpenToolbar(editor, 0, 5); // "hello"
    const swatchBtn = within(getViewport(container)).getByTitle('#f0663f'); // coral theme's palette[0]

    clickToolbarButton(swatchBtn);
    expect(editor.innerHTML).toContain('color:#f0663f');

    commitAndSave(editor);
    await waitFor(() => {
      const doc = readSavedDoc('rt2');
      expect(doc.nodes.c1?.rich).toEqual([
        { t: 'hello', b: false, c: '#f0663f' },
        { t: ' world', b: false, c: null },
      ]);
    });
  });

  it('two sequential toolbar clicks on the SAME selection both apply (regression: a leaked pointerdown would wipe the selection after the first click)', async () => {
    localStorage.setItem('mindflow_doc_rt3', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=rt3&title=x');

    const editor = startEditingNode(container, 'c1');
    selectAndOpenToolbar(editor, 6, 11); // "world"
    const vp = within(getViewport(container));

    clickToolbarButton(vp.getByTitle('선택 영역 굵게'));
    expect(window.getSelection()?.toString()).toBe('world'); // survived the first click

    // no re-selection call here — if the first click's pointerdown had leaked to the
    // background and cleared the selection, this second click would land on nothing.
    clickToolbarButton(vp.getByTitle('#f0663f'));

    commitAndSave(editor);
    await waitFor(() => {
      const doc = readSavedDoc('rt3');
      expect(doc.nodes.c1?.rich).toEqual([
        { t: 'hello ', b: false, c: null },
        { t: 'world', b: true, c: '#f0663f' },
      ]);
    });
  });

  it('지우기 clears partial bold+color from the selection back to plain', async () => {
    localStorage.setItem('mindflow_doc_rt4', JSON.stringify(RICH_DOC));
    const { container } = renderEditor('/editor?map=rt4&title=x');

    const editor = startEditingNode(container, 'c1');
    selectAndOpenToolbar(editor, 0, 11); // the whole text
    clickToolbarButton(within(getViewport(container)).getByTitle('부분 스타일 지우기'));

    expect(editor.innerHTML).not.toContain('font-weight');
    expect(editor.innerHTML).not.toContain('color:');
    expect(editor.textContent).toBe('hello world');

    commitAndSave(editor);
    await waitFor(() => {
      const doc = readSavedDoc('rt4');
      expect(doc.nodes.c1?.rich).toBeNull();
    });
  });

  it('re-bolding an already-fully-bold selection toggles it back off', async () => {
    localStorage.setItem('mindflow_doc_rt5', JSON.stringify(RICH_DOC));
    const { container } = renderEditor('/editor?map=rt5&title=x');

    const editor = startEditingNode(container, 'c1');
    selectAndOpenToolbar(editor, 6, 11); // "world" — already bold in RICH_DOC
    clickToolbarButton(within(getViewport(container)).getByTitle('선택 영역 굵게'));

    commitAndSave(editor);
    await waitFor(() => {
      const doc = readSavedDoc('rt5');
      // "world" un-bolds, but its color (#f0663f) survives — bold and color toggle independently.
      expect(doc.nodes.c1?.rich).toEqual([
        { t: 'hello ', b: false, c: null },
        { t: 'world', b: false, c: '#f0663f' },
      ]);
    });
  });
});

describe('partial rich-text styling — plain commit', () => {
  it('replacing the whole text with a plain retype clears any stale rich runs', async () => {
    localStorage.setItem('mindflow_doc_rt6', JSON.stringify(RICH_DOC));
    const { container } = renderEditor('/editor?map=rt6&title=x');

    const editor = startEditingNode(container, 'c1');
    editor.textContent = '새 텍스트';
    fireEvent.input(editor);

    commitAndSave(editor);
    await waitFor(() => {
      const doc = readSavedDoc('rt6');
      expect(doc.nodes.c1?.text).toBe('새 텍스트');
      expect(doc.nodes.c1?.rich).toBeNull();
    });
  });

  it('a blank retype resets to the placeholder text with no rich runs', async () => {
    localStorage.setItem('mindflow_doc_rt7', JSON.stringify(RICH_DOC));
    const { container } = renderEditor('/editor?map=rt7&title=x');

    const editor = startEditingNode(container, 'c1');
    editor.textContent = '   ';
    fireEvent.input(editor);

    commitAndSave(editor);
    await waitFor(() => {
      const doc = readSavedDoc('rt7');
      expect(doc.nodes.c1?.text).toBe('주제');
      expect(doc.nodes.c1?.rich).toBeNull();
    });
  });

  // Regression: while editing, the node box must grow WITH the text (WYSIWYG)
  // instead of the text overflowing a fixed box that only resizes on commit.
  it('grows the node box to fit the text as it is typed (not only on commit)', () => {
    localStorage.setItem('mindflow_doc_rt8', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=rt8&title=x');

    const editor = startEditingNode(container, 'c1');
    const boxBefore = getViewport(container).querySelector('[data-node-id="c1"]') as HTMLElement;
    const wBefore = parseFloat(boxBefore.style.width);
    const hBefore = parseFloat(boxBefore.style.height);

    // type a much longer, multi-line-forcing text
    editor.textContent = 'hello world this is a very long shape label '.repeat(4).trim();
    fireEvent.input(editor);

    const boxAfter = getViewport(container).querySelector('[data-node-id="c1"]') as HTMLElement;
    expect(parseFloat(boxAfter.style.width)).toBeGreaterThan(wBefore);
    expect(parseFloat(boxAfter.style.height)).toBeGreaterThan(hBefore);
  });
});

// 제보: 텍스트 서식 툴바의 **노출 조건이 꼬였다**. 원인은 `checkSelectionToolbar`가
// 선택이 없어졌을 때 툴바를 닫지 않고 그냥 return한 것 — 마우스로 캐럿을 옮기는 경우는
// `TextToolbar`의 window mousedown 리스너가 닫아 주지만 **키보드에는 그 경로가 없어서**,
// 화살표로 선택을 풀거나 선택 위에 그대로 타이핑하면 아무것도 선택되지 않은 채 툴바가
// 계속 떠 있었다.
describe('텍스트 서식 툴바 노출 조건', () => {
  const toolbar = (container: HTMLElement) => within(getViewport(container)).queryByTitle('선택 영역 굵게');

  it('선택이 있으면 뜬다', () => {
    localStorage.setItem('mindflow_doc_tb1', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=tb1&title=x');
    const editor = startEditingNode(container, 'c1');

    expect(toolbar(container)).toBeNull();
    selectAndOpenToolbar(editor, 6, 11);
    expect(toolbar(container)).toBeTruthy();
  });

  it('키보드로 선택을 풀면 닫힌다 (화살표)', () => {
    localStorage.setItem('mindflow_doc_tb2', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=tb2&title=x');
    const editor = startEditingNode(container, 'c1');

    selectAndOpenToolbar(editor, 6, 11);
    expect(toolbar(container)).toBeTruthy();

    // 화살표로 캐럿만 옮긴 상태 = 선택 없음
    setLinearSelection(editor, 11, 11);
    fireEvent.keyUp(editor, { key: 'ArrowRight' });
    expect(toolbar(container)).toBeNull();
  });

  it('선택 위에 타이핑하면 닫힌다', () => {
    localStorage.setItem('mindflow_doc_tb3', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=tb3&title=x');
    const editor = startEditingNode(container, 'c1');

    selectAndOpenToolbar(editor, 6, 11);
    expect(toolbar(container)).toBeTruthy();

    // 입력이 선택을 대체하면 캐럿만 남는다
    setLinearSelection(editor, 7, 7);
    fireEvent.keyUp(editor, { key: 'a' });
    expect(toolbar(container)).toBeNull();
  });

  it('마우스로 캐럿만 옮겨도 닫힌다', () => {
    localStorage.setItem('mindflow_doc_tb4', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=tb4&title=x');
    const editor = startEditingNode(container, 'c1');

    selectAndOpenToolbar(editor, 6, 11);
    expect(toolbar(container)).toBeTruthy();

    setLinearSelection(editor, 3, 3);
    fireEvent.mouseUp(editor);
    expect(toolbar(container)).toBeNull();
  });
});

// 제보 1: 스타일의 테마를 바꾸면 서식 팝업의 색까지 따라 변한다 — 기본 색으로 고정해 달라.
// 이 코드베이스의 관례대로 고쳤다: 메뉴·패널 같은 **시스템 크롬은 고정 `uiTheme`**,
// 문서 테마는 편집 영역과 **색 스와치 값**에만 쓴다(`useEditorState`의 `uiTheme` 주석,
// `panel/NodePanel.tsx` 참고).
describe('서식 툴바 색은 문서 테마를 따라가지 않는다', () => {
  const DARK_DOC = { ...DOC, themeKey: 'dark' };
  const toolbarOf = (container: HTMLElement) =>
    within(getViewport(container)).getByTitle('선택 영역 굵게').closest('div') as HTMLElement;

  it('밝은 테마와 다크 테마에서 팝업 크롬이 동일하다', () => {
    localStorage.setItem('mindflow_doc_thL', JSON.stringify(DOC));
    const light = renderEditor('/editor?map=thL&title=x');
    selectAndOpenToolbar(startEditingNode(light.container, 'c1'), 6, 11);
    const lightChrome = { bg: toolbarOf(light.container).style.background, border: toolbarOf(light.container).style.border };
    cleanup();

    localStorage.setItem('mindflow_doc_thD', JSON.stringify(DARK_DOC));
    const dark = renderEditor('/editor?map=thD&title=x');
    selectAndOpenToolbar(startEditingNode(dark.container, 'c1'), 6, 11);
    const darkChrome = { bg: toolbarOf(dark.container).style.background, border: toolbarOf(dark.container).style.border };

    expect(darkChrome).toEqual(lightChrome);
    expect(lightChrome.bg).toBeTruthy(); // 실제로 값을 읽었다(빈 비교가 아니다)
  });

  it('스와치 색 목록도 테마와 무관하게 같다', () => {
    const swatchesOf = (container: HTMLElement) =>
      Array.from(toolbarOf(container).querySelectorAll('button[title^="#"]')).map((b) => b.getAttribute('title'));

    localStorage.setItem('mindflow_doc_swL', JSON.stringify(DOC));
    const light = renderEditor('/editor?map=swL&title=x');
    selectAndOpenToolbar(startEditingNode(light.container, 'c1'), 6, 11);
    const lightSwatches = swatchesOf(light.container);
    cleanup();

    localStorage.setItem('mindflow_doc_swD', JSON.stringify(DARK_DOC));
    const dark = renderEditor('/editor?map=swD&title=x');
    selectAndOpenToolbar(startEditingNode(dark.container, 'c1'), 6, 11);

    expect(swatchesOf(dark.container)).toEqual(lightSwatches);
    expect(lightSwatches.length).toBeGreaterThan(3); // 실제로 목록을 읽었다
  });

  it('다크 테마여도 팝업이 어두워지지 않는다 (기본 밝은 패널 유지)', () => {
    localStorage.setItem('mindflow_doc_thD2', JSON.stringify(DARK_DOC));
    const { container } = renderEditor('/editor?map=thD2&title=x');
    selectAndOpenToolbar(startEditingNode(container, 'c1'), 6, 11);
    // 다크 테마의 panel은 '#262019' — 그 색이 팝업에 쓰이면 안 된다.
    expect(toolbarOf(container).style.background).not.toContain('38, 32, 25');
  });
});

// 제보 2: 편집 중 **더블클릭**으로 단어를 선택하면 팝업이 뜨지 않는다.
// 원인: 편집 박스의 `dblclick`이 노드 박스로 올라가 `startEditNode`를 다시 호출하고,
// 그 안의 `setTextCtx(null)`이 방금 뜬 툴바를 즉시 닫았다(mouseup에서 열림 → dblclick에서 닫힘).
describe('더블클릭으로 단어를 선택해도 서식 툴바가 뜬다', () => {
  const toolbar = (container: HTMLElement) => within(getViewport(container)).queryByTitle('선택 영역 굵게');

  it('더블클릭(단어 선택) 후에도 툴바가 남아 있다', () => {
    localStorage.setItem('mindflow_doc_dbl', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=dbl&title=x');
    const editor = startEditingNode(container, 'c1');

    // 브라우저의 더블클릭 = 단어가 선택된 뒤 mouseup, 그리고 dblclick이 따라온다.
    setLinearSelection(editor, 6, 11); // "world" (브라우저가 고른 단어에 해당)
    fireEvent.mouseUp(editor);
    expect(toolbar(container)).toBeTruthy(); // mouseup 시점엔 예전에도 떴다

    fireEvent.doubleClick(editor); // ← 예전엔 여기서 닫혀 버렸다
    expect(toolbar(container)).toBeTruthy();
    // 선택도 살아 있어야 서식을 적용할 수 있다
    expect(window.getSelection()?.toString()).toBe('world');
  });

  it('더블클릭으로 선택한 뒤 굵게가 실제로 적용된다', () => {
    localStorage.setItem('mindflow_doc_dbl2', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=dbl2&title=x');
    const editor = startEditingNode(container, 'c1');

    setLinearSelection(editor, 6, 11);
    fireEvent.mouseUp(editor);
    fireEvent.doubleClick(editor);

    clickToolbarButton(within(getViewport(container)).getByTitle('선택 영역 굵게'));
    expect(editor.innerHTML).toContain('font-weight:800');
    expect(editor.textContent).toBe('hello world');
  });
});

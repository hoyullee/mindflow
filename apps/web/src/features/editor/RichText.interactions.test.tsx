import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    const boldBtn = within(getViewport(container)).getByTitle(/선택 영역 굵게/);

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

    clickToolbarButton(vp.getByTitle(/선택 영역 굵게/));
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
    clickToolbarButton(within(getViewport(container)).getByTitle(/부분 스타일 지우기/));

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
    clickToolbarButton(within(getViewport(container)).getByTitle(/선택 영역 굵게/));

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

// 노출 규칙 개정(사용자 결정): 선택이 있을 때만 떴다 사라지는 방식은 "선택을
// 풀면 서식 기능이 없는 것처럼" 보였다. 이제 **편집 세션 동안 상시 노출** —
// 편집을 시작하면 뜨고, 닫히는 건 편집 종료(커밋/취소)와 다른 메뉴(우클릭)가
// 열릴 때뿐이다. 선택 없이 버튼을 누르면 전체 텍스트에 적용된다.
describe('텍스트 서식 툴바 노출 조건 — 편집 중 상시 노출', () => {
  const toolbar = (container: HTMLElement) => within(getViewport(container)).queryByTitle(/선택 영역 굵게/);

  it('편집을 시작하면 선택이 없어도 바로 뜬다', () => {
    localStorage.setItem('mindflow_doc_tb1', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=tb1&title=x');
    startEditingNode(container, 'c1');
    expect(toolbar(container)).toBeTruthy();
  });

  it('캐럿만 옮기거나 타이핑해도 계속 떠 있다', () => {
    localStorage.setItem('mindflow_doc_tb2', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=tb2&title=x');
    const editor = startEditingNode(container, 'c1');

    setLinearSelection(editor, 11, 11); // 캐럿만 (선택 없음)
    fireEvent.keyUp(editor, { key: 'ArrowRight' });
    expect(toolbar(container)).toBeTruthy();

    fireEvent.mouseDown(editor); // 편집 박스 안 클릭도 닫지 않는다
    fireEvent.mouseUp(editor);
    expect(toolbar(container)).toBeTruthy();
  });

  it('편집을 마치면(커밋) 닫힌다', async () => {
    localStorage.setItem('mindflow_doc_tb3', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=tb3&title=x');
    const editor = startEditingNode(container, 'c1');
    fireEvent.keyDown(editor, { key: 'Enter' });
    await waitFor(() => expect(toolbar(container)).toBeNull());
  });

  it('우클릭(컨텍스트) 메뉴가 열리면 닫힌다 — 팝업 두 개가 겹치지 않게', () => {
    localStorage.setItem('mindflow_doc_tb4', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=tb4&title=x');
    startEditingNode(container, 'c1');
    expect(toolbar(container)).toBeTruthy();

    fireEvent.contextMenu(getViewport(container), { clientX: 40, clientY: 40 });
    expect(toolbar(container)).toBeNull();
  });

  it('열린 우클릭 메뉴는 편집 박스 안에서 선택을 시작(mousedown)해도 닫힌다', () => {
    // 제보: 편집 중 우클릭으로 메뉴를 연 뒤 편집 중인 텍스트를 선택해도 메뉴가
    // 남아 있었다 — 편집 박스의 mousedown stopPropagation이 메뉴의 버블 단계
    // 바깥클릭 리스너까지 끊었기 때문. 캡처 단계 리스너로 고쳤다(ContextMenu).
    localStorage.setItem('mindflow_doc_tb6', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=tb6&title=x');
    const editor = startEditingNode(container, 'c1');

    fireEvent.contextMenu(getViewport(container), { clientX: 40, clientY: 40 });
    expect(within(getViewport(container)).queryByText('도형 추가')).toBeTruthy(); // bg 메뉴가 떴다

    fireEvent.mouseDown(editor); // 편집 박스 안에서 텍스트 선택 시작
    expect(within(getViewport(container)).queryByText('도형 추가')).toBeNull();
    // 후속 제보: 메뉴가 닫히면(편집은 계속) 상시 노출 계약대로 툴바가 되살아나야 한다
    expect(toolbar(container)).toBeTruthy();
  });

  it('우클릭 메뉴를 Escape로 닫아도(편집 유지) 툴바가 되살아난다', () => {
    localStorage.setItem('mindflow_doc_tb7', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=tb7&title=x');
    startEditingNode(container, 'c1');

    fireEvent.contextMenu(getViewport(container), { clientX: 40, clientY: 40 });
    expect(toolbar(container)).toBeNull(); // 메뉴가 뜨며 툴바는 내려갔다

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(within(getViewport(container)).queryByText('도형 추가')).toBeNull(); // 메뉴 닫힘
    expect(toolbar(container)).toBeTruthy(); // 편집은 계속 → 툴바 복귀
  });

  it('선택 없이 B를 누르면 전체 텍스트가 굵어진다', () => {
    localStorage.setItem('mindflow_doc_tb5', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=tb5&title=x');
    const editor = startEditingNode(container, 'c1');

    setLinearSelection(editor, 4, 4); // 캐럿만
    clickToolbarButton(within(getViewport(container)).getByTitle(/선택 영역 굵게/));
    expect(editor.innerHTML).toContain('font-weight:800');
    expect(editor.textContent).toBe('hello world');
    // 적용 뒤 전체가 선택돼 있어 한 번 더 누르면 토글 해제된다
    clickToolbarButton(within(getViewport(container)).getByTitle(/선택 영역 굵게/));
    expect(editor.innerHTML).not.toContain('font-weight:800');
  });
});

// 제보: 루트(fontWeight 700)·1단계(600) 노드에서 편집 중 Ctrl/Cmd+B를 누르면 굵어지지
// 않고 오히려 얇아 보이다가, 커밋하면 되돌아간다. 원인: NodeEditBox가 단축키를 가로채지
// 않아 브라우저 기본 bold 토글(execCommand)이 발동 — 박스가 이미 굵게 렌더되는 노드에선
// "이미 굵다"로 판단해 `font-weight: normal`(400) 스팬을 심고(=얇아짐), 커밋 시
// `domToRuns`가 400을 b:false(무서식)로 읽어 조용히 복원됐다. 수정: Ctrl/Cmd+B·I를
// `preventDefault` 후 툴바와 같은 `applyPartial` 경로(800 고정)로 라우팅.
describe('키보드 단축키 Ctrl/Cmd+B·I — 브라우저 기본 토글 대신 applyPartial', () => {
  it('선택 없이 Ctrl+B → 전체 텍스트가 800으로 굵어진다 (기본 동작은 preventDefault)', async () => {
    localStorage.setItem('mindflow_doc_kb1', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=kb1&title=x');
    const editor = startEditingNode(container, 'c1');

    setLinearSelection(editor, 4, 4); // 캐럿만 — 선택 없음
    // fireEvent는 핸들러가 preventDefault를 불렀으면 false를 돌려준다 — 이게 곧
    // "브라우저 기본 bold(얇아지는 토글)가 막혔다"는 검증이다(jsdom엔 execCommand가
    // 없어 기본 동작 자체는 재현 불가).
    expect(fireEvent.keyDown(editor, { key: 'b', ctrlKey: true })).toBe(false);
    expect(editor.innerHTML).toContain('font-weight:800');
    expect(editor.textContent).toBe('hello world');

    commitAndSave(editor);
    await waitFor(() => {
      const saved = readSavedDoc('kb1');
      expect(saved.nodes.c1?.rich).toEqual([{ t: 'hello world', b: true, c: null }]);
    });
  });

  it('macOS Cmd+B(metaKey)도 동일하게 동작한다', () => {
    localStorage.setItem('mindflow_doc_kb2', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=kb2&title=x');
    const editor = startEditingNode(container, 'c1');

    setLinearSelection(editor, 2, 2);
    expect(fireEvent.keyDown(editor, { key: 'b', metaKey: true })).toBe(false);
    expect(editor.innerHTML).toContain('font-weight:800');
  });

  it('제보 시나리오 그대로: 루트(depth 0, 박스 자체가 굵은) 노드에서 Ctrl+B가 굵힌다', () => {
    localStorage.setItem('mindflow_doc_kb3', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=kb3&title=x');
    const editor = startEditingNode(container, 'root');

    expect(fireEvent.keyDown(editor, { key: 'b', ctrlKey: true })).toBe(false);
    expect(editor.innerHTML).toContain('font-weight:800');
    expect(editor.textContent).toBe('루트');
  });

  it('드래그 선택이 있으면 그 부분에만 적용된다', () => {
    localStorage.setItem('mindflow_doc_kb4', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=kb4&title=x');
    const editor = startEditingNode(container, 'c1');

    setLinearSelection(editor, 6, 11); // "world"
    expect(fireEvent.keyDown(editor, { key: 'b', ctrlKey: true })).toBe(false);
    expect(editor.innerHTML).toContain('font-weight:800');
    expect(editor.innerHTML).toMatch(/hello /); // 앞부분은 평문 유지
    // 선택이 유지되므로 한 번 더 누르면 토글 해제(applyPartialStyle의 규칙)
    expect(fireEvent.keyDown(editor, { key: 'b', ctrlKey: true })).toBe(false);
    expect(editor.innerHTML).not.toContain('font-weight:800');
  });

  it('Ctrl+I는 기울임을 적용한다', () => {
    localStorage.setItem('mindflow_doc_kb5', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=kb5&title=x');
    const editor = startEditingNode(container, 'c1');

    setLinearSelection(editor, 6, 11);
    expect(fireEvent.keyDown(editor, { key: 'i', ctrlKey: true })).toBe(false);
    expect(editor.innerHTML).toContain('font-style:italic');
  });

  it('Ctrl+U(밑줄 — 미지원 서식)는 막기만 하고 아무것도 심지 않는다', () => {
    localStorage.setItem('mindflow_doc_kb6', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=kb6&title=x');
    const editor = startEditingNode(container, 'c1');

    const before = editor.innerHTML;
    // 막지 않으면 편집 중엔 밑줄이 보이다가 커밋 때 소리 없이 사라진다(domToRuns가 무시).
    expect(fireEvent.keyDown(editor, { key: 'u', ctrlKey: true })).toBe(false);
    expect(editor.innerHTML).toBe(before);
  });

  it('일반 타이핑(수식키 없는 b)은 그대로 통과한다', () => {
    localStorage.setItem('mindflow_doc_kb7', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=kb7&title=x');
    const editor = startEditingNode(container, 'c1');

    const before = editor.innerHTML;
    expect(fireEvent.keyDown(editor, { key: 'b' })).toBe(true); // preventDefault 안 함
    expect(editor.innerHTML).toBe(before); // applyPartial이 불리지 않았다
  });
});

// 제보 1: 스타일의 테마를 바꾸면 서식 팝업의 색까지 따라 변한다 — 기본 색으로 고정해 달라.
// 이 코드베이스의 관례대로 고쳤다: 메뉴·패널 같은 **시스템 크롬은 고정 `uiTheme`**,
// 문서 테마는 편집 영역과 **색 스와치 값**에만 쓴다(`useEditorState`의 `uiTheme` 주석,
// `panel/NodePanel.tsx` 참고).
describe('서식 툴바 색은 문서 테마를 따라가지 않는다', () => {
  const DARK_DOC = { ...DOC, themeKey: 'dark' };
  const toolbarOf = (container: HTMLElement) =>
    within(getViewport(container)).getByTitle(/선택 영역 굵게/).closest('.mf-tctx') as HTMLElement;

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
  const toolbar = (container: HTMLElement) => within(getViewport(container)).queryByTitle(/선택 영역 굵게/);

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

    clickToolbarButton(within(getViewport(container)).getByTitle(/선택 영역 굵게/));
    expect(editor.innerHTML).toContain('font-weight:800');
    expect(editor.textContent).toBe('hello world');
  });
});

// ── 마크다운 서식 확장(post-dc): 기울임(I)·취소선(S) 버튼 + 커밋 시 단축 문법 ──
describe('마크다운 서식 확장 — I/S 버튼과 단축 문법', () => {
  it('I 버튼이 부분 기울임 런을 만들고 저장까지 살아남는다', async () => {
    localStorage.setItem('mindflow_doc_rtmd1', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=rtmd1&title=x');
    const editor = startEditingNode(container, 'c1');
    selectAndOpenToolbar(editor, 6, 11); // "world"
    clickToolbarButton(within(getViewport(container)).getByTitle(/선택 영역 기울임/));
    expect(editor.innerHTML).toContain('font-style:italic');
    commitAndSave(editor);
    await waitFor(() => {
      const doc = readSavedDoc('rtmd1');
      expect(doc.nodes.c1?.rich).toEqual([
        { t: 'hello ', b: false, c: null },
        { t: 'world', b: false, c: null, i: true },
      ]);
    });
  });

  it('S 버튼이 부분 취소선 런을 만든다', async () => {
    localStorage.setItem('mindflow_doc_rtmd2', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=rtmd2&title=x');
    const editor = startEditingNode(container, 'c1');
    selectAndOpenToolbar(editor, 0, 5); // "hello"
    clickToolbarButton(within(getViewport(container)).getByTitle(/선택 영역 취소선/));
    expect(editor.innerHTML).toContain('text-decoration:line-through');
    commitAndSave(editor);
    await waitFor(() => {
      const doc = readSavedDoc('rtmd2');
      expect(doc.nodes.c1?.rich).toEqual([
        { t: 'hello', b: false, c: null, s: true },
        { t: ' world', b: false, c: null },
      ]);
    });
  });

  it('커밋 시 **굵게**·*기울임*·~~취소선~~ 마커가 서식으로 변환된다', async () => {
    localStorage.setItem('mindflow_doc_rtmd3', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=rtmd3&title=x');
    const editor = startEditingNode(container, 'c1');
    editor.innerHTML = '이건 **굵게** 그리고 *기울임* 또 ~~취소~~';
    commitAndSave(editor);
    await waitFor(() => {
      const doc = readSavedDoc('rtmd3');
      expect(doc.nodes.c1?.text).toBe('이건 굵게 그리고 기울임 또 취소');
      expect(doc.nodes.c1?.rich).toEqual([
        { t: '이건 ', b: false, c: null },
        { t: '굵게', b: true, c: null },
        { t: ' 그리고 ', b: false, c: null },
        { t: '기울임', b: false, c: null, i: true },
        { t: ' 또 ', b: false, c: null },
        { t: '취소', b: false, c: null, s: true },
      ]);
    });
  });

  it('마크다운이 없는 평문 커밋은 그대로 (rich=null, 마커 오탐 없음)', async () => {
    localStorage.setItem('mindflow_doc_rtmd4', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=rtmd4&title=x');
    const editor = startEditingNode(container, 'c1');
    editor.innerHTML = '수식 2*3=6 이야기';
    commitAndSave(editor);
    await waitFor(() => {
      const doc = readSavedDoc('rtmd4');
      expect(doc.nodes.c1?.text).toBe('수식 2*3=6 이야기');
      expect(doc.nodes.c1?.rich ?? null).toBeNull();
    });
  });
});

// 사용자 요청: 굵게·기울임·취소선을 편집 중이 아니라 **도형을 선택했을 때**도 적용할 수
// 있게 속성 패널에 추가. I·S는 노드에 전용 필드가 없어(굵게의 `bold`와 달리) rich 런을
// 전체 텍스트에 적용하는 방식(`mutations.toggleNodesRichStyle`) — 직렬화/렌더/측정이
// 이미 지원하는 경로라 모델 변경이 없다.
describe('속성 패널 텍스트 스타일 — I(기울임)·S(취소선) 토글', () => {
  function selectNodeBox(el: HTMLElement): void {
    fireEvent.pointerDown(el, { pointerId: 9, clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerUp(window, { pointerId: 9, clientX: 100, clientY: 100 });
  }

  /** 노드를 선택하고 '텍스트 스타일' 구획을 열어 패널을 준비한다. */
  function openTextStyleSection(container: HTMLElement, id: string): void {
    const box = getViewport(container).querySelector(`[data-node-id="${id}"]`) as HTMLElement;
    expect(box).toBeTruthy();
    selectNodeBox(box);
    fireEvent.click(screen.getByRole('button', { name: /텍스트 스타일/ }));
  }

  it('I 버튼이 전체 텍스트를 기울임으로 토글하고, 렌더·저장·활성 표시가 따라온다', async () => {
    localStorage.setItem('mindflow_doc_pn1', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=pn1&title=x');
    openTextStyleSection(container, 'c1');

    const italicBtn = screen.getByTitle('기울임');
    expect(italicBtn.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(italicBtn);

    // 캔버스 렌더: rich 스팬이 fontStyle italic으로 그려진다
    const box = getViewport(container).querySelector('[data-node-id="c1"]') as HTMLElement;
    const span = box.querySelector('span[style*="italic"]');
    expect(span?.textContent).toBe('hello world');
    // 버튼 활성 표시
    expect(screen.getByTitle('기울임').getAttribute('aria-pressed')).toBe('true');

    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => {
      const saved = readSavedDoc('pn1');
      expect(saved.nodes.c1?.rich).toEqual([{ t: 'hello world', b: false, c: null, i: true }]);
    });

    // 다시 누르면 해제 → rich=null로 복귀
    fireEvent.click(screen.getByTitle('기울임'));
    expect(screen.getByTitle('기울임').getAttribute('aria-pressed')).toBe('false');
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => {
      expect(readSavedDoc('pn1').nodes.c1?.rich ?? null).toBeNull();
    });
  });

  it('S 버튼이 전체 텍스트 취소선을 토글한다', () => {
    localStorage.setItem('mindflow_doc_pn2', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=pn2&title=x');
    openTextStyleSection(container, 'c1');

    fireEvent.click(screen.getByTitle('취소선'));
    const box = getViewport(container).querySelector('[data-node-id="c1"]') as HTMLElement;
    expect(box.querySelector('span[style*="line-through"]')?.textContent).toBe('hello world');
    expect(screen.getByTitle('취소선').getAttribute('aria-pressed')).toBe('true');
  });

  it('부분 색상 런이 있는 노드도 색을 보존한 채 전체 기울임이 적용된다', () => {
    localStorage.setItem('mindflow_doc_pn3', JSON.stringify(RICH_DOC));
    const { container } = renderEditor('/editor?map=pn3&title=x');
    openTextStyleSection(container, 'c1');

    fireEvent.click(screen.getByTitle('기울임'));
    const box = getViewport(container).querySelector('[data-node-id="c1"]') as HTMLElement;
    const italicSpans = box.querySelectorAll('span[style*="italic"]');
    expect(Array.from(italicSpans).map((s) => s.textContent).join('')).toBe('hello world');
    // 기존 부분 색상("world")은 그대로
    const colored = box.querySelector('span[style*="rgb(240, 102, 63)"], span[style*="#f0663f"]');
    expect(colored?.textContent).toBe('world');
  });

  it('마퀴 다중 선택에도 일괄 적용된다 (첫 대상 기준 규칙)', () => {
    localStorage.setItem('mindflow_doc_pn4', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=pn4&title=x');
    // 모든 노드를 덮는 배경 마퀴 드래그 — EditorC.interactions.test.tsx의 마퀴 헬퍼와
    // 동일한 패턴(jsdom엔 PointerEvent가 없어 MouseEvent를 pointer 이벤트 이름으로
    // 디스패치, 초대형 클라이언트 좌표로 pan/zoom과 무관하게 전 노드 포함).
    const vp = getViewport(container);
    const pev = (type: string, x: number, y: number) => {
      const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
      Object.defineProperty(e, 'pointerId', { value: 11, configurable: true });
      return e;
    };
    fireEvent(vp, pev('pointerdown', -100000, -100000));
    fireEvent(window, pev('pointermove', 100000, 100000));
    fireEvent(window, pev('pointerup', 100000, 100000));
    expect(screen.getByText(/도형 \d+개 선택됨/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /텍스트 스타일/ }));
    fireEvent.click(screen.getByTitle('취소선'));

    const struck = getViewport(container).querySelectorAll('[data-node-id] span[style*="line-through"]');
    expect(struck.length).toBeGreaterThanOrEqual(2); // 루트+자식 모두
  });
});

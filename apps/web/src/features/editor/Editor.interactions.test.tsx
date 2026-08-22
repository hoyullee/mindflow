import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Editor } from './Editor';
import { dotGrid } from './canvasGrid';
import { parseDoc } from '@mindflow/mindmap-core';
import { BackendProvider } from '../../adapters/BackendContext';
import { LocalAuth } from '../../adapters/local/localAuth';
import { LocalDocStore } from '../../adapters/local/localDocStore';
import { LocalSpaceStore } from '../../adapters/local/localSpaceStore';
import { LocalCommentStore } from '../../adapters/local/localCommentStore';
import { LocalNotificationStore } from '../../adapters/local/localNotificationStore';
import type { Backend } from '../../adapters/ports';

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

// jsdom엔 PointerEvent가 없다 — MouseEvent를 pointer* 이름으로 던지고 `pointerId`만
// 붙여 준다(EditorC.interactions.test.tsx와 같은 방식).
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

function nodeBoxFor(container: HTMLElement, text: string | RegExp): HTMLElement {
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

  it('property panel opens with its FIRST section expanded, then behaves as a one-open accordion', async () => {
    // 마인드맵 리디자인(요청): 패널이 열릴 때마다 첫 구획(주제 스타일)은 펼친 채
    // 시작한다 — 전부 접힌 패널은 "여기서 무엇을 할 수 있는가"를 말하지 않는다.
    const user = userEvent.setup();
    localStorage.setItem('mindflow_doc_t1acc', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=t1acc&title=x');
    selectNodeBox(nodeBoxFor(container, '리서치'));

    const shapeHdr = screen.getByRole('button', { name: /주제 스타일/ });
    const textHdr = screen.getByRole('button', { name: /텍스트 스타일/ });
    const iconHdr = screen.getByRole('button', { name: /아이콘/ });
    // first section open, the rest collapsed
    expect(shapeHdr.getAttribute('aria-expanded')).toBe('true');
    expect(textHdr.getAttribute('aria-expanded')).toBe('false');
    expect(iconHdr.getAttribute('aria-expanded')).toBe('false');

    // opening another collapses the first (accordion — one open at a time)
    await user.click(textHdr);
    expect(textHdr.getAttribute('aria-expanded')).toBe('true');
    expect(shapeHdr.getAttribute('aria-expanded')).toBe('false');

    // clicking an open header collapses it
    await user.click(textHdr);
    expect(textHdr.getAttribute('aria-expanded')).toBe('false');
  });

  it('property panel accordion resets to first-section-open when the selection changes', async () => {
    const user = userEvent.setup();
    localStorage.setItem('mindflow_doc_t1acc2', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=t1acc2&title=x');

    selectNodeBox(nodeBoxFor(container, '리서치'));
    await user.click(screen.getByRole('button', { name: /텍스트 스타일/ }));
    expect(screen.getByRole('button', { name: /텍스트 스타일/ }).getAttribute('aria-expanded')).toBe('true');

    // select a different node → panel remounts, back to the default (first open)
    selectNodeBox(nodeBoxFor(container, '디자인'));
    expect(screen.getByRole('button', { name: /주제 스타일/ }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: /텍스트 스타일/ }).getAttribute('aria-expanded')).toBe('false');
  });

  it('첫 구획은 펼침 애니메이션 없이 열린 채 보이고, 첫 토글부터 전이가 켜진다(요청)', async () => {
    const user = userEvent.setup();
    localStorage.setItem('mindflow_doc_t1na', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=t1na&title=x');
    selectNodeBox(nodeBoxFor(container, '리서치'));

    const shapeHdr = screen.getByRole('button', { name: /주제 스타일/ });
    const bodyOf = (hdr: HTMLElement) => hdr.nextElementSibling as HTMLElement;
    // 마운트 직후: 열린 상태 그대로, 전이 없음 — "지금 열렸다"가 아니라 "열려 있다".
    expect(shapeHdr.getAttribute('aria-expanded')).toBe('true');
    expect(bodyOf(shapeHdr).style.transition).toBe('none');

    // 사용자가 토글하는 순간부터 전이가 켜진다(아코디언 동작은 그대로).
    await user.click(screen.getByRole('button', { name: /텍스트 스타일/ }));
    expect(bodyOf(shapeHdr).style.transition).toContain('max-height');
  });

  it('작게/보통/크게는 디자인 원본의 세그 트랙 — panel2 트랙 위에서 활성 칸만 카드 면(요청)', () => {
    localStorage.setItem('mindflow_doc_t1sz', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=t1sz&title=x');
    selectNodeBox(nodeBoxFor(container, '리서치'));
    fireEvent.click(screen.getByRole('button', { name: /텍스트 스타일/ }));

    const seg = container.querySelector('[data-size-seg]') as HTMLElement;
    expect(seg).toBeTruthy();
    expect(seg.style.background).toBe('rgb(250, 243, 238)'); // uiTheme panel2 #faf3ee
    const btns = Array.from(seg.querySelectorAll('button')) as HTMLButtonElement[];
    expect(btns.map((b) => b.textContent)).toEqual(['작게', '보통', '크게']);
    const active = btns.find((b) => b.getAttribute('aria-pressed') === 'true')!;
    expect(active.textContent).toBe('보통'); // 기본 크기
    expect(active.style.background).toBe('rgb(255, 255, 255)'); // 활성 = 카드 면(panel)
    expect(active.style.boxShadow).toContain('0 2px 5px');
    const idle = btns.find((b) => b.textContent === '작게')!;
    expect(idle.style.background).toBe('transparent');
    expect(idle.style.border).toBe('0px'); // 예전 테두리 상자(SegButton)가 아니다
  });

  // 마인드맵 리디자인 3건의 나머지 계약 — 패널 폭/머리/닫기, 캔버스 그라데이션.
  it('property panel: 296px, accent header with kicker+name, and a ✕ that clears the selection', () => {
    localStorage.setItem('mindflow_doc_t1rd', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=t1rd&title=x');
    selectNodeBox(nodeBoxFor(container, '리서치'));

    const panel = container.querySelector('[data-props-panel]') as HTMLElement;
    expect(panel.style.width).toBe('296px');
    // 머리 = 옅은 강조 면(디자인 원본 #FBEDE6 — 강조색 틴트) + [무엇을 고르고 있는가 / 이름]
    const head = screen.getByText('선택한 주제').parentElement!.parentElement as HTMLElement;
    expect(head.style.background).toContain('rgba(240, 102, 63'); // hexA(accent, …)
    expect((container.querySelector('[data-panel-name]') as HTMLElement).textContent).toBe('리서치');
    // ✕ = 선택 해제(패널은 선택을 따라 닫힌다)
    fireEvent.click(screen.getByLabelText('속성 닫기'));
    expect(screen.queryByText('선택한 주제')).toBeNull();
  });

  it('캔버스 배경은 두 층 — 워시는 정적, 도트는 배율·팬을 따른다 (Figma식)', () => {
    localStorage.setItem('mindflow_doc_bgw', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=bgw&title=x');

    // 워시 층: 방사형 그라데이션 하나뿐 — 팬/줌에 흔들리지 않아 **한 번만 래스터**된다
    // (#368의 분리 효과. 도트를 여기 함께 두면 매 프레임 비싼 그라데이션까지 다시 칠한다.)
    const bg = container.querySelector('[data-canvas-bg]') as HTMLElement;
    expect(bg.style.backgroundImage).toContain('1200px 700px at 62% 46%');
    expect(bg.style.backgroundImage).not.toContain('26px');
    expect(bg.style.backgroundSize).toBe('');

    // 도트 층: 간격·반지름이 배율을 따르고 자리가 팬을 따른다.
    const dots = container.querySelector('[data-canvas-dots]') as HTMLElement;
    const pan = container.querySelector('[data-pan-layer]') as HTMLElement;
    const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)\s*scale\(([\d.]+)\)/.exec(pan.style.transform)!;
    const [px, py, zoom] = [Number(m[1]), Number(m[2]), Number(m[3])];
    expect(zoom).toBeGreaterThan(0);
    // jsdom은 '600.00px'을 '600px'로 정규화하므로 문자열이 아니라 **값**으로 견준다.
    // 값의 규칙은 `dotGrid`(순수) 한 곳에 있고 여기서는 **그 규칙을 쓰는지**만 본다.
    const g = dotGrid(zoom);
    const nums = (v: string) => v.split(' ').map((t) => Number(t.replace('px', '')));
    expect(nums(dots.style.backgroundSize)).toEqual([Number(g.cell.toFixed(2)), Number(g.cell.toFixed(2))]);
    expect(nums(dots.style.backgroundPosition)).toEqual([px, py]);
    expect(dots.style.backgroundImage).toContain(`${g.radius.toFixed(2)}px`);
    // 도트는 팬 레이어 **밖**에 있다 — 안에 넣으면 합성기가 래스터를 늘려 뭉개진다(#379).
    expect(pan.contains(dots)).toBe(false);
  });

  it('clicking anywhere in a zone body (not just its label) selects the zone', () => {
    localStorage.setItem('mindflow_doc_zsel', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=zsel&title=x');

    expect(screen.queryByText('선택한 영역')).toBeNull();
    // click the zone's body rectangle, away from its label pill.
    // 영역은 **시각 판**(`data-zone-id`, 맨 위)과 **히트 판**(`data-zone-hit`, 맨 아래)이
    // 나뉜다 — 위에서 포인터까지 받으면 영역 안의 객체 클릭을 통째로 삼키기 때문.
    const zoneBody = container.querySelector('[data-zone-hit="zn1"]') as HTMLElement;
    expect(zoneBody).toBeTruthy();
    fireEvent.pointerDown(zoneBody, { pointerId: 3, clientX: 400, clientY: 400, button: 0 });
    fireEvent.pointerUp(window, { pointerId: 3, clientX: 400, clientY: 400 });

    // the zone property panel is shown (zone got selected from a body click)
    expect(screen.getByText('선택한 영역')).toBeTruthy();
  });

  // 제보: 여러 줄 도형을 고르면 패널 제목이 내용 전체를 한 줄로 나열했다
  // (제목 줄은 nowrap이라 줄바꿈이 공백으로 접힌다). 제목은 이름이므로 첫 줄만.
  it('패널 제목은 도형 텍스트의 **첫 줄만** 보여 준다 (전체 나열 금지)', () => {
    const multi = JSON.parse(JSON.stringify(DOC)) as typeof DOC;
    (multi.nodes as Record<string, { text: string }>)['c1']!.text = '첫 줄 제목\n둘째 줄 내용\n셋째 줄';
    localStorage.setItem('mindflow_doc_t1ml', JSON.stringify(multi));
    const { container } = renderEditor('/editor?map=t1ml&title=x');

    selectNodeBox(nodeBoxFor(container, /첫 줄 제목/));
    const panel = within(screen.getByText('선택한 주제').parentElement as HTMLElement);
    expect(panel.getByText('첫 줄 제목')).toBeTruthy();
    expect(panel.queryByText(/둘째 줄 내용/)).toBeNull();
    // 전체 텍스트는 툴팁에 남는다.
    expect((panel.getByText('첫 줄 제목') as HTMLElement).title).toContain('둘째 줄 내용');
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
    await user.click(screen.getByRole('button', { name: '스타일' })); // open the 스타일 menu
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

  it('exports JSON with the full node tree', async () => {
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

    await user.click(screen.getByRole('button', { name: /내보내기/ })); // open the 내보내기 menu
    await user.click(screen.getByText('JSON 파일 (.json)'));

    expect(created.length).toBe(1);
    const json = await readBlobText(created[0]!);
    const parsed = JSON.parse(json);
    expect(parsed.nodes.root.text).toBe('제품 로드맵');
    expect(Object.keys(parsed.nodes).length).toBe(3);

    clickSpy.mockRestore();
  });

  it('마크다운 개요(.md)로 내보낸다 — 트리·노트·메모가 개요 형식으로', async () => {
    localStorage.setItem('mindflow_doc_t7md', JSON.stringify(DOC));
    const created: Blob[] = [];
    URL.createObjectURL = vi.fn((b: Blob | MediaSource) => {
      created.push(b as Blob);
      return 'blob:mock';
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn() as typeof URL.revokeObjectURL;
    const names: string[] = [];
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });

    const user = userEvent.setup();
    renderEditor('/editor?map=t7md&title=x');

    await user.click(screen.getByRole('button', { name: /내보내기/ }));
    await user.click(screen.getByText('Markdown 개요 (.md)'));

    expect(created.length).toBe(1);
    expect(names[0]?.endsWith('.md')).toBe(true);
    const md = await readBlobText(created[0]!);
    // 루트는 H1(이모지 포함), 자식은 불릿, 메모는 `## 메모` 섹션 — 코어 `toMarkdown`의 형식
    expect(md.startsWith('# 🎯 제품 로드맵')).toBe(true);
    expect(md).toMatch(/^- 리서치$/m);
    expect(md).toMatch(/^## 메모$/m);
    expect(md).toMatch(/^- 주간 회고 메모$/m);

    clickSpy.mockRestore();
  });

  it('SVG(.svg)로 내보낸다 — 벡터 문서에 노드 텍스트가 담긴다', async () => {
    localStorage.setItem('mindflow_doc_t7svg', JSON.stringify(DOC));
    const created: Blob[] = [];
    URL.createObjectURL = vi.fn((b: Blob | MediaSource) => {
      created.push(b as Blob);
      return 'blob:mock';
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn() as typeof URL.revokeObjectURL;
    const names: string[] = [];
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });

    const user = userEvent.setup();
    renderEditor('/editor?map=t7svg&title=x');

    await user.click(screen.getByRole('button', { name: /내보내기/ }));
    await user.click(screen.getByText('SVG 이미지 (.svg)'));

    // 이미지 인라인 단계가 비동기라 다운로드도 한 틱 뒤에 온다
    await waitFor(() => expect(created.length).toBe(1));
    expect(names[0]?.endsWith('.svg')).toBe(true);
    const svg = await readBlobText(created[0]!);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain('제품 로드맵');
    expect(svg).toContain('리서치');
    expect(svg).toContain('주간 회고 메모');

    clickSpy.mockRestore();
  });

  it('PDF 항목이 내보내기 메뉴에 있고, 캔버스 없는 환경에서는 조용히 no-op', async () => {
    localStorage.setItem('mindflow_doc_t7pdf', JSON.stringify(DOC));
    const user = userEvent.setup();
    renderEditor('/editor?map=t7pdf&title=x');

    await user.click(screen.getByRole('button', { name: /내보내기/ }));
    // jsdom엔 canvas 2D가 없어 렌더가 no-op — 클릭이 예외 없이 지나가는 것까지 확인
    await user.click(screen.getByText('PDF 문서 (.pdf)'));
    expect(screen.queryByText('PDF 문서 (.pdf)')).toBeNull(); // 메뉴는 닫힌다
  });

  // 공유 — 이메일 초대. 실제 접근 제어는 DB의 RLS이고(0009), 여기서는 UI가 포트를
  // 제대로 부르는지와 목록/취소가 도는지를 본다.
  describe('공유', () => {
    function shareBackend() {
      const shares: { documentId: string; email: string; role: 'edit' | 'view'; createdAt: string }[] = [];
      let linkRole: 'edit' | 'view' | null = null;
      const shareStore = {
        list: vi.fn(async (id: string) => shares.filter((s) => s.documentId === id)),
        add: vi.fn(async (id: string, email: string, role: 'edit' | 'view' = 'edit') => {
          shares.push({ documentId: id, email: email.trim().toLowerCase(), role, createdAt: '2026-01-01T00:00:00.000Z' });
          return {};
        }),
        remove: vi.fn(async (id: string, email: string) => {
          const at = shares.findIndex((s) => s.documentId === id && s.email === email);
          if (at >= 0) shares.splice(at, 1);
          return {};
        }),
        listSharedWithMe: vi.fn(async () => []),
        markSharedSeen: vi.fn(async () => {}),
        // 초대 메일(②) — 처음 초대에만 불린다. 실제 발송은 Edge Function이 한다.
        notifyInvite: vi.fn(async () => {}),
        // 기본값 null = 참가자 정보 없음(0010 RPC 미적용 서버) — 팝업은 이메일만
        // 보여주는 폴백 렌더를 탄다. 참가자 UI는 아래 별도 테스트에서 값을 준다.
        listParticipants: vi.fn(async (): Promise<import('../../adapters/ports').ShareParticipant[] | null> => null),
        // 링크 공유(0017) — 이 더블은 메모리 한 칸으로 켜고 끈다.
        getLink: vi.fn(async () => linkRole),
        setLink: vi.fn(async (_id: string, role: 'edit' | 'view' | null) => {
          linkRole = role === 'view' ? 'view' : null;
          return {};
        }),
      };
      return { shareStore, shares };
    }

    // `docId`는 테스트가 실제로 씨딩한 키와 맞춰야 한다 — 본문이 없는 맵은 이제
    // 에디터가 아니라 전용 안내 화면(`MapUnavailable`)이 뜨므로 툴바조차 없다.
    function renderWithShare(shareStore: unknown, mode: Backend['mode'] = 'supabase', docId = 'share1') {
      const backend = { auth: new LocalAuth(), docStore: new LocalDocStore(), spaceStore: new LocalSpaceStore(), shareStore, commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(), mode } as unknown as Backend;
      return render(
        <MemoryRouter initialEntries={[`/editor?map=${docId}&title=x`]}>
          <BackendProvider backend={backend}>
            <Routes>
              <Route path="/editor" element={<Editor />} />
              <Route path="/home" element={<div>HOME_PAGE</div>} />
            </Routes>
          </BackendProvider>
        </MemoryRouter>,
      );
    }

    it('툴바의 공유 버튼이 모달을 열고, 이메일로 초대하면 목록에 뜬다', async () => {
      localStorage.setItem('mindflow_doc_share1', JSON.stringify(DOC));
      const user = userEvent.setup();
      const { shareStore } = shareBackend();
      renderWithShare(shareStore);

      await user.click(screen.getByRole('button', { name: '공유' }));
      expect(await screen.findByRole('dialog', { name: '공유' })).toBeTruthy();
      await waitFor(() => expect(screen.getByText('아직 아무도 초대하지 않았어요.')).toBeTruthy());

      await user.type(screen.getByLabelText('초대할 이메일'), 'friend@example.com');
      await user.click(screen.getByRole('button', { name: '초대' }));

      // 포트를 이 문서 id로 부른다 — 권한 셀렉트의 기본값은 edit(#22 이후에도 유지)
      await waitFor(() => expect(shareStore.add).toHaveBeenCalledWith('share1', 'friend@example.com', 'edit'));
      await waitFor(() => expect(screen.getByText('friend@example.com')).toBeTruthy());
      expect((screen.getByLabelText('friend@example.com 권한') as HTMLSelectElement).value).toBe('edit');
    });

    it('dim 배경은 제자리 페이드(mf-dim-in)로만 뜨고, 권한 안내는 "?"를 눌러야 나온다', async () => {
      localStorage.setItem('mindflow_doc_shdim', JSON.stringify(DOC));
      const user = userEvent.setup();
      const { shareStore } = shareBackend();
      renderWithShare(shareStore, 'supabase', 'shdim');

      await user.click(screen.getByRole('button', { name: '공유' }));
      const dialog = await screen.findByRole('dialog', { name: '공유' });

      // 배경(fixed inset:0)에 translateY가 있는 mf-fade를 걸면 레이어가 통째로
      // 슬라이드해 화면 상단에 dim 안 된 띠가 차오르는 게 보인다(제보) — 배경은
      // 순수 페이드(mf-dim-in)여야 한다.
      const backdrop = dialog.parentElement as HTMLElement;
      expect(backdrop.style.animation).toContain('mf-dim-in');
      expect(backdrop.style.animation).not.toContain('mf-fade');

      // 권한 안내는 상시 문단이 아니라 제목 옆 "?"에 들어간다(요청) — 평소엔 없다가
      // 누르면 툴팁으로 나온다. 팝업을 여는 사람 대부분은 이미 알고 있고, 두 줄이
      // 매번 자리를 차지했다.
      expect(dialog.textContent).not.toContain('편집 가능 권한은 서로의 커서와 편집이 실시간으로 보여요.');
      expect(screen.queryByRole('tooltip')).toBeNull();

      await user.click(within(dialog).getByRole('button', { name: '권한 안내' }));
      const tip = await screen.findByRole('tooltip');
      expect(tip.textContent).toContain('편집 가능 권한은 서로의 커서와 편집이 실시간으로 보여요.');
      expect(tip.textContent).toContain('보기 전용 권한은 저장된 최신 맵을 열람만 할 수 있습니다.');

      // 문장이 중간에서 접히면 굵게 강조한 권한 이름과 설명이 갈라져 읽기 힘들다(제보)
      // — 폭은 가장 긴 문장에 맞추고(max-content), 툴팁은 "?" 버튼이 아니라 **제목
      // 행**(모달 본문 왼쪽 끝)에 걸어 그 폭을 확보한다.
      expect(tip.style.width).toBe('max-content');
      expect(tip.style.left).toBe('0px');
      const anchor = within(dialog).getByRole('button', { name: '권한 안내' }).parentElement as HTMLElement;
      expect(anchor.style.position).not.toBe('relative');

      // 다시 누르면 닫힌다.
      await user.click(within(dialog).getByRole('button', { name: '권한 안내' }));
      expect(screen.queryByRole('tooltip')).toBeNull();
    });

    // 링크 공유(0017) — 이메일을 모르는 상대에게 "이거 봐 줘" 하는 가장 짧은 길.
    // 보기 전용만 연다: 링크는 유출되면 끄기 전까지 회수할 수 없다.
    it('링크 공유를 켜면 주소가 나오고, 끄면 사라진다 (보기 전용)', async () => {
      localStorage.setItem('mindflow_doc_shlink', JSON.stringify(DOC));
      const user = userEvent.setup();
      const { shareStore } = shareBackend();
      renderWithShare(shareStore, 'supabase', 'shlink');

      await user.click(screen.getByRole('button', { name: '공유' }));
      const dialog = await screen.findByRole('dialog', { name: '공유' });

      const toggle = within(dialog).getByLabelText('링크가 있는 사람은 열람') as HTMLInputElement;
      expect(toggle.checked).toBe(false);
      expect(within(dialog).queryByLabelText('공유 링크')).toBeNull();

      await user.click(toggle);
      await waitFor(() => expect(shareStore.setLink).toHaveBeenCalledWith('shlink', 'view'));
      const url = (await within(dialog).findByLabelText('공유 링크')) as HTMLInputElement;
      expect(url.value).toContain('/editor?map=shlink');

      await user.click(within(dialog).getByLabelText('링크가 있는 사람은 열람'));
      await waitFor(() => expect(shareStore.setLink).toHaveBeenCalledWith('shlink', null));
      await waitFor(() => expect(within(dialog).queryByLabelText('공유 링크')).toBeNull());
    });

    it('링크 복사 버튼은 그 주소를 클립보드에 넣는다', async () => {
      localStorage.setItem('mindflow_doc_shcopy', JSON.stringify(DOC));
      const user = userEvent.setup();
      const writeText = vi.fn(async () => undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      const { shareStore } = shareBackend();
      renderWithShare(shareStore, 'supabase', 'shcopy');

      await user.click(screen.getByRole('button', { name: '공유' }));
      const dialog = await screen.findByRole('dialog', { name: '공유' });
      await user.click(within(dialog).getByLabelText('링크가 있는 사람은 열람'));
      await user.click(await within(dialog).findByRole('button', { name: '링크 복사' }));

      expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/editor?map=shcopy'));
      expect(await within(dialog).findByRole('button', { name: '복사됨' })).toBeTruthy();
    });

    it('이메일 형식이 아니면 서버를 부르지 않고 알려 준다', async () => {
      localStorage.setItem('mindflow_doc_share2', JSON.stringify(DOC));
      const user = userEvent.setup();
      const { shareStore } = shareBackend();
      renderWithShare(shareStore, 'supabase', 'share2');

      await user.click(screen.getByRole('button', { name: '공유' }));
      await user.type(screen.getByLabelText('초대할 이메일'), '이건이메일이아님');
      await user.click(screen.getByRole('button', { name: '초대' }));

      expect(await screen.findByRole('alert')).toBeTruthy();
      expect(shareStore.add).not.toHaveBeenCalled();
    });

    it('초대를 취소하면 목록에서 사라진다', async () => {
      localStorage.setItem('mindflow_doc_share3', JSON.stringify(DOC));
      const user = userEvent.setup();
      const { shareStore } = shareBackend();
      await shareStore.add('share3', 'gone@example.com');
      renderWithShare(shareStore, 'supabase', 'share3');

      await user.click(screen.getByRole('button', { name: '공유' }));
      await waitFor(() => expect(screen.getByText('gone@example.com')).toBeTruthy());

      await user.click(screen.getByRole('button', { name: 'gone@example.com 초대 취소' }));
      await waitFor(() => expect(shareStore.remove).toHaveBeenCalledWith('share3', 'gone@example.com'));
      await waitFor(() => expect(screen.queryByText('gone@example.com')).toBeNull());
    });

    it('서버가 거부하면 그 메시지를 그대로 보여 준다 (조용히 성공하지 않는다)', async () => {
      localStorage.setItem('mindflow_doc_share4', JSON.stringify(DOC));
      const user = userEvent.setup();
      const { shareStore } = shareBackend();
      shareStore.add = vi.fn(async () => ({ error: 'new row violates row-level security policy' }));
      renderWithShare(shareStore, 'supabase', 'share4');

      await user.click(screen.getByRole('button', { name: '공유' }));
      await user.type(screen.getByLabelText('초대할 이메일'), 'x@example.com');
      await user.click(screen.getByRole('button', { name: '초대' }));

      expect((await screen.findByRole('alert')).textContent).toMatch(/row-level security/);
    });

    // 초대 알림 ②: 처음 초대에만 메일을 보낸다. `add`는 upsert라 권한 변경과
    // 구분되지 않으므로, 목록을 들고 있는 모달이 판단한다 — 같은 사람에게 같은
    // 알림을 반복하면 스팸으로 읽힌다.
    it('처음 초대에만 메일 알림을 부른다 (권한 변경·재초대는 보내지 않는다)', async () => {
      localStorage.setItem('mindflow_doc_shmail', JSON.stringify(DOC));
      const user = userEvent.setup();
      const { shareStore } = shareBackend();
      renderWithShare(shareStore, 'supabase', 'shmail');

      await user.click(screen.getByRole('button', { name: '공유' }));
      const dialog = await screen.findByRole('dialog', { name: '공유' });

      await user.type(within(dialog).getByLabelText('초대할 이메일'), 'friend@example.com');
      await user.click(within(dialog).getByRole('button', { name: '초대' }));
      await waitFor(() => expect(shareStore.notifyInvite).toHaveBeenCalledWith('shmail', 'friend@example.com'));
      expect(shareStore.notifyInvite).toHaveBeenCalledTimes(1);

      // 같은 사람을 다시 넣는다(= 권한 변경) — 메일은 더 나가지 않는다.
      await waitFor(() => expect(within(dialog).getByText('friend@example.com')).toBeTruthy());
      await user.type(within(dialog).getByLabelText('초대할 이메일'), 'friend@example.com');
      await user.click(within(dialog).getByRole('button', { name: '초대' }));
      await waitFor(() => expect(shareStore.add).toHaveBeenCalledTimes(2));
      expect(shareStore.notifyInvite).toHaveBeenCalledTimes(1);
    });

    it('보기 전용을 골라 초대하면 포트에 view 권한이 전달된다 (#22)', async () => {
      localStorage.setItem('mindflow_doc_share7', JSON.stringify(DOC));
      const user = userEvent.setup();
      const { shareStore } = shareBackend();
      renderWithShare(shareStore, 'supabase', 'share7');

      await user.click(screen.getByRole('button', { name: '공유' }));
      await user.type(screen.getByLabelText('초대할 이메일'), 'reader@example.com');
      await user.selectOptions(screen.getByLabelText('초대 권한'), 'view');
      await user.click(screen.getByRole('button', { name: '초대' }));

      await waitFor(() => expect(shareStore.add).toHaveBeenCalledWith('share7', 'reader@example.com', 'view'));
      // 소유자에겐 행마다 권한 셀렉트가 뜨고 현재 값이 보기 전용이다
      await waitFor(() => expect((screen.getByLabelText('reader@example.com 권한') as HTMLSelectElement).value).toBe('view'));
    });

    it('소유자는 이미 초대한 사람의 권한을 행에서 바로 바꾼다 (upsert)', async () => {
      localStorage.setItem('mindflow_doc_share8', JSON.stringify(DOC));
      const user = userEvent.setup();
      const { shareStore, shares } = shareBackend();
      await shareStore.add('share8', 'friend@example.com', 'edit');
      // upsert 흉내 — 실제 어댑터(Local/Supabase)는 onConflict로 권한만 갱신한다.
      shareStore.add = vi.fn(async (id: string, email: string, role: 'edit' | 'view' = 'edit') => {
        const at = shares.findIndex((s) => s.documentId === id && s.email === email);
        if (at >= 0) shares[at] = { ...shares[at]!, role };
        return {};
      });
      renderWithShare(shareStore, 'supabase', 'share8');

      await user.click(screen.getByRole('button', { name: '공유' }));
      await waitFor(() => expect(screen.getByLabelText('friend@example.com 권한')).toBeTruthy());
      await user.selectOptions(screen.getByLabelText('friend@example.com 권한'), 'view');

      await waitFor(() => expect(shareStore.add).toHaveBeenCalledWith('share8', 'friend@example.com', 'view'));
      await waitFor(() => expect((screen.getByLabelText('friend@example.com 권한') as HTMLSelectElement).value).toBe('view'));
    });

    it('자기 자신은 초대할 수 없다 — 소유자 행이 생겨 스스로를 잠그는 것 방지', async () => {
      localStorage.setItem('mindflow_doc_share9', JSON.stringify(DOC));
      localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u-me', email: 'me@example.com' } }));
      const user = userEvent.setup();
      const { shareStore } = shareBackend();
      renderWithShare(shareStore, 'supabase', 'share9');

      await user.click(screen.getByRole('button', { name: '공유' }));
      await user.type(screen.getByLabelText('초대할 이메일'), 'ME@example.com');
      await user.click(screen.getByRole('button', { name: '초대' }));

      expect((await screen.findByRole('alert')).textContent).toContain('자기 자신');
      expect(shareStore.add).not.toHaveBeenCalled();
    });

    it('소유자와 초대받은 사람의 프로필명·가입 대기 상태를 보여 준다 (참가자 정보가 있을 때)', async () => {
      localStorage.setItem('mindflow_doc_share6', JSON.stringify(DOC));
      const user = userEvent.setup();
      const { shareStore } = shareBackend();
      await shareStore.add('share6', 'friend@example.com');
      await shareStore.add('share6', 'newbie@example.com');
      shareStore.listParticipants = vi.fn(async () => [
        { kind: 'owner' as const, email: 'me@example.com', displayName: '호율', joined: true, role: 'edit' as const },
        { kind: 'invitee' as const, email: 'friend@example.com', displayName: '디자인 리드', joined: true, role: 'edit' as const },
        { kind: 'invitee' as const, email: 'newbie@example.com', displayName: null, joined: false, role: 'edit' as const },
      ]);
      // 소유자 본인으로 로그인한 상태(LocalAuth는 mf_demo_session을 읽는다)
      localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u-me', email: 'me@example.com' } }));
      renderWithShare(shareStore, 'supabase', 'share6');

      await user.click(screen.getByRole('button', { name: '공유' }));
      const dialog = await screen.findByRole('dialog', { name: '공유' });

      // 소유자 구획 — 누가 초대했는지(제보 ①)
      const ownerBox = within(dialog).getByLabelText('소유자');
      expect(ownerBox.textContent).toContain('호율');
      expect(ownerBox.textContent).toContain('me@example.com');
      // 가입된 초대는 프로필명 + 이메일(제보 ②)
      await waitFor(() => expect(within(dialog).getByText('디자인 리드')).toBeTruthy());
      expect(within(dialog).getByText('friend@example.com')).toBeTruthy();
      // 미가입 초대는 이메일 그대로 + 가입 대기 배지
      expect(within(dialog).getByText('newbie@example.com')).toBeTruthy();
      expect(within(dialog).getByText('가입 대기')).toBeTruthy();
    });

    it('소유자가 아니면 초대 입력이 없고, 남의 행에 취소도 없다 — 내 행은 나가기 (서버 정책과 같은 모양)', async () => {
      localStorage.setItem('mindflow_doc_share8', JSON.stringify(DOC));
      const user = userEvent.setup();
      const { shareStore } = shareBackend();
      await shareStore.add('share8', 'me-too@example.com');
      shareStore.listParticipants = vi.fn(async () => [
        { kind: 'owner' as const, email: 'boss@example.com', displayName: '소유자님', joined: true, role: 'edit' as const },
        { kind: 'invitee' as const, email: 'me-too@example.com', displayName: '나야', joined: true, role: 'edit' as const },
        { kind: 'invitee' as const, email: 'other@example.com', displayName: '남이야', joined: true, role: 'edit' as const },
      ]);
      // 나는 초대받은 사람(비소유자)
      localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u-guest', email: 'me-too@example.com' } }));
      renderWithShare(shareStore, 'supabase', 'share8');

      await user.click(screen.getByRole('button', { name: '공유' }));
      const dialog = await screen.findByRole('dialog', { name: '공유' });

      // 제보 ①: 초대받은 사람도 전체 명단을 본다 (참가자 명단이 정본)
      await waitFor(() => expect(within(dialog).getByText('남이야')).toBeTruthy());
      expect(within(dialog).getByText('나야')).toBeTruthy();
      // 제보 ②: 비소유자에게는 초대 어포던스가 없다
      await waitFor(() => expect(within(dialog).queryByLabelText('초대할 이메일')).toBeNull());
      expect(within(dialog).queryByRole('button', { name: '초대' })).toBeNull();
      expect(within(dialog).getByText(/소유자만 할 수 있어요/)).toBeTruthy();
      // 남의 행에는 버튼이 없고, 내 행에는 '나가기'만 있다
      expect(within(dialog).queryByRole('button', { name: 'other@example.com 초대 취소' })).toBeNull();
      expect(within(dialog).queryByRole('button', { name: 'me-too@example.com 초대 취소' })).toBeNull();
      expect(within(dialog).getByRole('button', { name: '공유 나가기' })).toBeTruthy();
    });

    it('나가기를 누르면 자기 행을 지우고 홈으로 나간다', async () => {
      localStorage.setItem('mindflow_doc_share9', JSON.stringify(DOC));
      const user = userEvent.setup();
      const { shareStore } = shareBackend();
      await shareStore.add('share9', 'me-too@example.com');
      shareStore.listParticipants = vi.fn(async () => [
        { kind: 'owner' as const, email: 'boss@example.com', displayName: '소유자님', joined: true, role: 'edit' as const },
        { kind: 'invitee' as const, email: 'me-too@example.com', displayName: '나야', joined: true, role: 'edit' as const },
      ]);
      localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u-guest', email: 'me-too@example.com' } }));
      renderWithShare(shareStore, 'supabase', 'share9');

      await user.click(screen.getByRole('button', { name: '공유' }));
      await screen.findByRole('dialog', { name: '공유' });
      await user.click(await screen.findByRole('button', { name: '공유 나가기' }));

      await waitFor(() => expect(shareStore.remove).toHaveBeenCalledWith('share9', 'me-too@example.com'));
      await waitFor(() => expect(screen.getByText('HOME_PAGE')).toBeTruthy()); // 접근이 사라진 맵에 남겨 두지 않는다
    });

    it('참가자 정보를 못 얻으면(null) 이메일만 보여주는 기존 렌더로 폴백한다', async () => {
      localStorage.setItem('mindflow_doc_share7', JSON.stringify(DOC));
      const user = userEvent.setup();
      const { shareStore } = shareBackend();
      await shareStore.add('share7', 'plain@example.com');
      renderWithShare(shareStore, 'supabase', 'share7');

      await user.click(screen.getByRole('button', { name: '공유' }));
      const dialog = await screen.findByRole('dialog', { name: '공유' });
      await waitFor(() => expect(within(dialog).getByText('plain@example.com')).toBeTruthy());
      expect(within(dialog).queryByLabelText('소유자')).toBeNull(); // 모르는 정보는 그리지 않는다
      expect(within(dialog).queryByText('가입 대기')).toBeNull();
    });

    it('데모 모드에서는 실제로 공유되지 않는다고 밝힌다', async () => {
      localStorage.setItem('mindflow_doc_share5', JSON.stringify(DOC));
      const user = userEvent.setup();
      const { shareStore } = shareBackend();
      renderWithShare(shareStore, 'local', 'share5');

      await user.click(screen.getByRole('button', { name: '공유' }));
      expect(await screen.findByText(/실제로 공유되지는 않습니다/)).toBeTruthy();
    });
  });

  it('opens the 스타일 dropdown in a fixed body portal (escapes the top bar clip/stacking)', async () => {
    const user = userEvent.setup();
    localStorage.setItem('mindflow_doc_ts1', JSON.stringify(DOC));
    renderEditor('/editor?map=ts1&title=x');

    await user.click(screen.getByRole('button', { name: '스타일' })); // open the 스타일 menu

    const menu = document.querySelector('.mf-ed-stylemenu') as HTMLElement;
    expect(menu).toBeTruthy();
    // Portaled out of the (overflow-clipping, low-stacked) top bar...
    expect(menu.closest('.mf-ed-topbar')).toBeNull();
    // ...into the menu panel(Radix Content): 위치는 Radix가 잡고(fixed), z는 우리가
    // 준다. 예전에는 우리가 만든 `AnchoredMenu` div가 그 둘을 다 들고 있었다.
    const panel = menu.closest('[data-anchored-menu]') as HTMLElement;
    expect(panel).toBeTruthy();
    expect(Number(panel.style.zIndex)).toBeGreaterThan(80);
    // Radix는 위치를 감싼 래퍼에 준다 — 그 래퍼가 fixed다.
    expect((panel.parentElement as HTMLElement).style.position).toBe('fixed');
    // Controls still render/work.
    expect(screen.getByText('레이아웃')).toBeTruthy();
    expect(screen.getByText('테마')).toBeTruthy();
  });

  it('theme switch recolors ONLY the editing canvas — the GNB/chrome keeps the fixed UI theme', async () => {
    // 문서 테마는 편집 영역(캔버스 배경·노드 색)만 칠하고, 시스템 크롬(GNB·
    // 독칩·패널)은 항상 고정 uiTheme(코랄)로 남아야 한다.
    const user = userEvent.setup();
    localStorage.setItem('mindflow_doc_th1', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=th1&title=x');

    const topbar = container.querySelector('.mf-ed-topbar') as HTMLElement;
    // 캔버스 배경은 `.mf-ed-vp` 자신이 아니라 전용 배경 레이어에 있다(팬 중
    // 그라디언트가 매 프레임 다시 래스터되지 않도록 분리 — Viewport.tsx 주석).
    const vp = container.querySelector('[data-canvas-bg]') as HTMLElement;
    const chromeBgBefore = topbar.style.background;
    expect(vp.style.backgroundColor).toBe('rgb(245, 236, 229)'); // coral canvasBg #f5ece5

    await user.click(screen.getByRole('button', { name: '스타일' }));
    await user.click(screen.getByRole('button', { name: '다크' }));

    // canvas follows the doc theme…
    await waitFor(() => expect(vp.style.backgroundColor).toBe('rgb(32, 27, 22)')); // dark canvasBg #201b16
    // …but the GNB (and the style menu itself) hasn't budged
    expect(topbar.style.background).toBe(chromeBgBefore);
    // 패널 면은 `Menu`(Radix Content)가 그린다 — 그 면이 고정 uiTheme이어야 한다.
    const menu = (document.querySelector('.mf-ed-stylemenu') as HTMLElement).closest('[data-anchored-menu]') as HTMLElement;
    expect(menu.style.background).toBe('rgb(255, 255, 255)'); // fixed uiTheme panel
  });

  // 제보: 화면을 이동하거나(팬) 노드 추가로 화면이 따라 움직일 때 캔버스 배경이
  // 깨져 보인다. 원인은 배경 그라디언트가 팬/줌 레이어와 **같은 레이어**에 있어
  // 매 프레임 뷰포트 전체가 다시 래스터된 것(CDP LayerTree 실측: 20스텝 팬에
  // 8.4M px → 3.6M px). 구조 계약을 테스트로 고정한다.
  it('캔버스 배경은 팬/줌 레이어와 분리된 자기 레이어에 있다 (팬 중 재래스터 방지)', () => {
    localStorage.setItem('mindflow_doc_bg1', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=bg1&title=x');

    const vp = container.querySelector('.mf-ed-vp') as HTMLElement;
    const bg = container.querySelector('[data-canvas-bg]') as HTMLElement;
    const pan = container.querySelector('[data-pan-layer]') as HTMLElement;
    expect(bg).toBeTruthy();
    expect(pan).toBeTruthy();

    // 배경은 팬 레이어 안에 있으면 안 된다(안에 있으면 같이 움직이며 다시 칠해진다).
    expect(pan.contains(bg)).toBe(false);
    // 드래그 표면(.mf-ed-vp) 자신에는 더 이상 배경이 없다 — 있으면 그 레이어가
    // 자식 변환 때문에 통째로 무효화된다.
    expect(vp.style.backgroundColor).toBe('');
    expect(vp.style.backgroundImage).toBe('');
    // 배경 레이어는 스스로 합성되고(translateZ) 클릭을 가로채지 않는다.
    expect(bg.style.transform).toBe('translateZ(0)');
    expect(bg.style.pointerEvents).toBe('none');
  });

  // 제보: 에디터에 들어가면 텍스트·객체가 전부 흐릿하고, 객체를 편집하면 그
  // 객체만 선명해진다. 원인은 팬 레이어의 `will-change: transform` — 브라우저가
  // 승격된 레이어의 래스터 배율을 첫 프레임(scale 1)에 고정하는데, 에디터는 한
  // 프레임 뒤 중앙 정렬 배율(1.25)로 바뀌므로 화면 전체가 늘어난 텍스처가 된다.
  // 배경 재래스터는 위 배경 레이어 분리만으로 이미 해결되므로 힌트는 필요 없다.
  it('팬 레이어에 will-change를 걸지 않는다 (진입 시 흐릿함 방지)', () => {
    localStorage.setItem('mindflow_doc_bg2', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=bg2&title=x');
    const vp = container.querySelector('.mf-ed-vp') as HTMLElement;
    const pan = () => container.querySelector('[data-pan-layer]') as HTMLElement;

    expect(pan().style.willChange).toBe('');
    // 팬 드래그 중에도 켜지 않는다 — 배율이 바뀌는 순간(줌·핀치)마다 흐려질 여지를 남기지 않는다.
    firePointer(vp, 'pointerdown', { pointerId: 4, clientX: 300, clientY: 300, button: 2 });
    firePointer(window, 'pointermove', { pointerId: 4, clientX: 380, clientY: 340 });
    expect(pan().style.willChange).toBe('');
    firePointer(window, 'pointerup', { pointerId: 4, clientX: 380, clientY: 340, button: 2 });
    expect(pan().style.willChange).toBe('');
  });

  // 요청: GNB 로고를 눌러도 홈으로(독칩 홈 버튼과 같은 기능).
  describe('GNB 브랜드 로고 = 홈으로', () => {
    it('로고를 누르면 홈으로 나간다', async () => {
      const user = userEvent.setup();
      localStorage.setItem('mindflow_doc_lg1', JSON.stringify(DOC));
      renderEditor('/editor?map=lg1&title=x');

      await user.click(screen.getByRole('button', { name: 'Geurio 홈으로' }));
      await waitFor(() => expect(screen.getByText('HOME_PAGE')).toBeTruthy());
    });

    it('독칩 홈 버튼과 같은 핸들러를 쓴다 (저장 후 이동)', async () => {
      const user = userEvent.setup();
      localStorage.setItem('mindflow_doc_lg2', JSON.stringify(DOC));
      const { container } = renderEditor('/editor?map=lg2&title=x');

      // 편집해서 미저장 상태로 만든 뒤 로고로 나가면, 독칩 홈 버튼과 마찬가지로
      // 나가기 직전에 저장이 남아 있어야 한다(`goHome`이 persist 후 navigate).
      selectNodeBox(nodeBoxFor(container, '리서치'));
      fireEvent.keyDown(window, { key: 'Tab' }); // 하위 도형 추가 → 문서 변경
      await user.click(screen.getByRole('button', { name: 'Geurio 홈으로' }));

      await waitFor(() => expect(screen.getByText('HOME_PAGE')).toBeTruthy());
      await waitFor(
        () => {
          const parsed = parseDoc(JSON.parse(localStorage.getItem('mindflow_doc_lg2') as string));
          expect(Object.keys(parsed!.nodes).length).toBe(4); // root + c1 + c2 + 새 하위
        },
        { timeout: 2000 },
      );
    });
  });

  describe('duplicate map names are allowed (XMind-style)', () => {
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

    it('renames this map to a name another map already uses — no rejection, no warning', async () => {
      // Identity is the doc id; titles are display labels, so taking another
      // map's name commits like any other rename (the old guard rejected it).
      const user = userEvent.setup();
      seedExistingMap();
      const { container } = renderEditor('/editor?map=new-abc123&new=1&title=' + encodeURIComponent('내 문서'));

      await waitFor(() => expect(chip(container, '내 문서')).toBeTruthy());
      await user.dblClick(chip(container, '내 문서')!);
      const input = container.querySelector('input.mf-edit') as HTMLInputElement;
      expect(input).toBeTruthy();
      await user.clear(input);
      await user.type(input, '기존 맵{Enter}');

      await waitFor(() => expect(chip(container, '기존 맵')).toBeTruthy());
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('allows renaming this map to a unique title', async () => {
      const user = userEvent.setup();
      seedExistingMap();
      const { container } = renderEditor('/editor?map=new-def456&new=1&title=' + encodeURIComponent('내 문서'));

      await waitFor(() => expect(chip(container, '내 문서')).toBeTruthy());
      await user.dblClick(chip(container, '내 문서')!);
      const input = container.querySelector('input.mf-edit') as HTMLInputElement;
      await user.clear(input);
      await user.type(input, '완전히 새로운 이름{Enter}');

      await waitFor(() => expect(chip(container, '완전히 새로운 이름')).toBeTruthy());
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('renames the map to a taken name by editing the ROOT node on the canvas', async () => {
      seedExistingMap(); // another map titled "기존 맵"
      // This map's root title is "제품 로드맵" (DOC).
      localStorage.setItem('mindflow_doc_mine', JSON.stringify(DOC));
      const { container } = renderEditor('/editor?map=mine&title=x');

      await waitFor(() => expect(within(getViewport(container)).getByText('제품 로드맵')).toBeTruthy());

      const rootBox = nodeBoxFor(container, '제품 로드맵');
      fireEvent.doubleClick(rootBox);
      const editor = getViewport(container).querySelector('.mf-richedit') as HTMLDivElement;
      expect(editor).toBeTruthy();
      editor.textContent = '기존 맵';
      fireEvent.input(editor);
      fireEvent.keyDown(editor, { key: 'Enter' });

      // Committed: the root now carries the duplicate name, no warning.
      await waitFor(() => expect(within(getViewport(container)).getByText('기존 맵')).toBeTruthy());
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });
});

// 제보: 스타일의 테마를 바꾸면 속성 패널이 제안하는 색까지 따라 변한다 — 기본 색으로
// 고정해 달라. (서식 팝업은 #215·#216에서 먼저 고정했고, 같은 규칙을 패널에도 적용.)
// 패널의 크롬은 원래부터 고정 `uiTheme`이었고 **스와치 팔레트만** 문서 테마를 따랐다.
describe('속성 패널의 색 스와치는 문서 테마를 따라가지 않는다', () => {
  const themedDoc = (themeKey: string) => ({ ...DOC, themeKey });
  /** 패널에 그려진 스와치 원의 배경색 목록. */
  const swatchColorsOf = (): string[] => {
    // 패널 머리의 DOM 모양은 디자인 개편으로 바뀔 수 있으므로 **표식**으로 잡는다.
    const panel = document.querySelector('[data-props-panel]') as HTMLElement;
    return Array.from(panel.querySelectorAll<HTMLButtonElement>('button'))
      .map((b) => b.style.background)
      .filter((bg) => bg.startsWith('rgb') || bg.startsWith('#'));
  };

  async function openShapeSection(container: HTMLElement) {
    const user = userEvent.setup();
    selectNodeBox(nodeBoxFor(container, '리서치'));
    await user.click(screen.getByRole('button', { name: /주제 스타일/ }));
    return swatchColorsOf();
  }

  it('밝은 테마와 다크 테마에서 스와치 색 목록이 같다', async () => {
    localStorage.setItem('mindflow_doc_pnL', JSON.stringify(themedDoc('coral')));
    const light = renderEditor('/editor?map=pnL&title=x');
    const lightColors = await openShapeSection(light.container);
    expect(lightColors.length).toBeGreaterThan(3); // 실제로 목록을 읽었다
    cleanup();

    localStorage.setItem('mindflow_doc_pnD', JSON.stringify(themedDoc('dark')));
    const dark = renderEditor('/editor?map=pnD&title=x');
    const darkColors = await openShapeSection(dark.container);

    expect(darkColors).toEqual(lightColors);
  });

  it('모노 테마에서도 회색 팔레트로 바뀌지 않는다', async () => {
    localStorage.setItem('mindflow_doc_pnM', JSON.stringify(themedDoc('mono')));
    const { container } = renderEditor('/editor?map=pnM&title=x');
    const colors = await openShapeSection(container);
    // 기본(coral) 팔레트의 첫 색 #f0663f = rgb(240, 102, 63)
    expect(colors.some((c) => c.replace(/\s/g, '') === 'rgb(240,102,63)')).toBe(true);
  });
});

// 방향키로 **메모 사이를** 오간다(요청) — 주제(트리)의 이웃 이동과 같은 채점.
describe('방향키 메모 이동', () => {
  const MEMO_DOC = {
    v: 1,
    kind: 'board',
    nodes: {},
    // 2×2 배치: 좌상(a) 우상(b) / 좌하(c) 우하(d)
    floats: [
      { id: 'a', x: -300, y: -200, w: 200, h: 90, text: '왼쪽 위' },
      { id: 'b', x: 100, y: -200, w: 200, h: 90, text: '오른쪽 위' },
      { id: 'c', x: -300, y: 100, w: 200, h: 90, text: '왼쪽 아래' },
      { id: 'd', x: 100, y: 100, w: 200, h: 90, text: '오른쪽 아래' },
    ],
    lines: [],
    zones: [],
    layoutMode: 'right',
    themeKey: 'white',
  };
  const selectedText = () => document.querySelector('[data-panel-name]')?.textContent?.trim() ?? '';
  const clickFloat = (container: HTMLElement, id: string) => {
    const el = container.querySelector(`[data-float-id="${id}"]`) as HTMLElement;
    firePointer(el, 'pointerdown', { pointerId: 21, clientX: 5, clientY: 5, button: 0 });
    firePointer(window, 'pointerup', { pointerId: 21, clientX: 5, clientY: 5, button: 0 });
  };

  it('메모를 고르고 방향키를 누르면 그 방향의 이웃 메모가 선택된다', async () => {
    localStorage.setItem('mindflow_doc_fnav1', JSON.stringify(MEMO_DOC));
    const { container } = renderEditor('/editor?map=fnav1&title=x');
    await waitFor(() => expect(container.querySelector('[data-float-id="a"]')).toBeTruthy());
    clickFloat(container, 'a');
    await screen.findByText('선택한 메모');
    expect(selectedText()).toBe('왼쪽 위');

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await waitFor(() => expect(selectedText()).toBe('오른쪽 위'));
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    await waitFor(() => expect(selectedText()).toBe('오른쪽 아래'));
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    await waitFor(() => expect(selectedText()).toBe('왼쪽 아래'));
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    await waitFor(() => expect(selectedText()).toBe('왼쪽 위'));
  });

  it('이동만 할 뿐 메모의 좌표는 그대로다(문서가 바뀌지 않는다)', async () => {
    localStorage.setItem('mindflow_doc_fnav2', JSON.stringify(MEMO_DOC));
    const { container } = renderEditor('/editor?map=fnav2&title=x');
    await waitFor(() => expect(container.querySelector('[data-float-id="a"]')).toBeTruthy());
    clickFloat(container, 'a');
    await screen.findByText('선택한 메모');

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    await waitFor(() => expect(selectedText()).toBe('오른쪽 아래'));

    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('mindflow_doc_fnav2') || 'null');
      expect(saved.floats.map((f: { id: string; x: number; y: number }) => [f.id, f.x, f.y])).toEqual(MEMO_DOC.floats.map((f) => [f.id, f.x, f.y]));
    });
  });

  it('그 방향에 메모가 없으면 선택이 그대로 남는다', async () => {
    localStorage.setItem('mindflow_doc_fnav3', JSON.stringify(MEMO_DOC));
    const { container } = renderEditor('/editor?map=fnav3&title=x');
    await waitFor(() => expect(container.querySelector('[data-float-id="a"]')).toBeTruthy());
    clickFloat(container, 'a');
    await screen.findByText('선택한 메모');

    fireEvent.keyDown(window, { key: 'ArrowUp' });
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    await waitFor(() => expect(selectedText()).toBe('왼쪽 위'));
  });

  it('보드에서 아무것도 안 고른 채 방향키를 누르면 화면 가운데 메모부터 잡는다', async () => {
    localStorage.setItem('mindflow_doc_fnav4', JSON.stringify(MEMO_DOC));
    const { container } = renderEditor('/editor?map=fnav4&title=x');
    await waitFor(() => expect(container.querySelector('[data-float-id="a"]')).toBeTruthy());
    expect(screen.queryByText('선택한 메모')).toBeNull();

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await screen.findByText('선택한 메모');
    expect(selectedText().length).toBeGreaterThan(0);
  });

  it('맵(무회귀): 주제를 고른 방향키는 그대로 이웃 주제로 간다', async () => {
    localStorage.setItem('mindflow_doc_fnav5', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=fnav5&title=x');
    const c1 = await waitFor(() => {
      const el = container.querySelector('[data-node-id="c1"]') as HTMLElement;
      expect(el).toBeTruthy();
      return el;
    });
    firePointer(c1, 'pointerdown', { pointerId: 22, clientX: 5, clientY: 5, button: 0 });
    firePointer(window, 'pointerup', { pointerId: 22, clientX: 5, clientY: 5, button: 0 });
    await screen.findByText('선택한 주제');

    const nodeName = () => document.querySelector('[data-panel-name]')?.textContent?.trim() ?? '';
    // 어느 방향이 이웃인지는 레이아웃(radial)이 정한다 — 여기서 고정하는 계약은
    // "주제에서 방향키를 누르면 **다른 주제**로 가고, 메모로 새지 않는다"이다.
    const seen = new Set([nodeName()]);
    for (const key of ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight']) {
      fireEvent.keyDown(window, { key });
      await waitFor(() => expect(screen.queryByText('선택한 메모')).toBeNull());
      seen.add(nodeName());
    }
    expect(seen.size).toBeGreaterThan(1); // 실제로 옮겨 다녔다
  });
});

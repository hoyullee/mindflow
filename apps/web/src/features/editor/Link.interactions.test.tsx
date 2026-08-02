import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { parseDoc } from '@mindflow/mindmap-core';
import { Editor } from './Editor';
import { setLinearSelection } from './richtextDom';
import { LINK_INK_ON_DARK, LINK_INK_ON_LIGHT, linkInk } from './richSpans';

// 하이퍼링크 — 선택한 글자에만 링크를 건다(`RichRun.href`). 캔버스에서는
// Ctrl/⌘+클릭으로만 열린다(단일 클릭=선택, 더블클릭=편집과 충돌하지 않게).
// 주소는 저장 **전에** 코어 `normalizeUrl`을 통과하므로 `javascript:` 같은
// 스킴은 문서에 아예 들어가지 않는다.

const DOC = {
  v: 1,
  nodes: {
    root: { id: 'root', text: '루트', emoji: '', parent: null, children: ['c1'], collapsed: false, color: null, x: 0, y: 0 },
    c1: { id: 'c1', text: '공식 문서', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0 },
  },
  floats: [],
  lines: [],
  zones: [],
  layoutMode: 'right',
  themeKey: 'coral',
};

const LINKED_DOC = {
  ...DOC,
  nodes: {
    ...DOC.nodes,
    c1: {
      ...DOC.nodes.c1,
      rich: [
        { t: '공식', b: false, c: null, href: 'https://example.com/' },
        { t: ' 문서', b: false, c: null },
      ],
    },
  },
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

function getViewport(container: HTMLElement): HTMLElement {
  const el = container.querySelector('.mf-ed-vp');
  if (!el) throw new Error('viewport not found');
  return el as HTMLElement;
}

function nodeBox(container: HTMLElement, id: string): HTMLElement {
  const box = getViewport(container).querySelector(`[data-node-id="${id}"]`);
  if (!box) throw new Error(`node box "${id}" not found`);
  return box as HTMLElement;
}

function startEditingNode(container: HTMLElement, id: string): HTMLDivElement {
  fireEvent.doubleClick(nodeBox(container, id));
  const editor = getViewport(container).querySelector('.mf-richedit') as HTMLDivElement;
  expect(editor).toBeTruthy();
  return editor;
}

/** 선택 → 툴바 링크 버튼 → 주소 입력 → 적용. 실제 사용자 흐름 그대로. */
function applyLink(container: HTMLElement, editor: HTMLDivElement, s0: number, s1: number, url: string): void {
  setLinearSelection(editor, s0, s1);
  fireEvent.mouseUp(editor);
  const btn = within(getViewport(container)).getByLabelText('하이퍼링크');
  fireEvent.mouseDown(btn);
  const input = within(getViewport(container)).getByLabelText('링크 주소') as HTMLInputElement;
  fireEvent.change(input, { target: { value: url } });
  fireEvent.click(within(getViewport(container)).getByTitle('링크 적용'));
}

function readSavedDoc(mapId: string) {
  const raw = localStorage.getItem(`mindflow_doc_${mapId}`);
  if (!raw) throw new Error('not saved yet');
  const parsed = parseDoc(JSON.parse(raw));
  if (!parsed) throw new Error('unparseable doc');
  return parsed;
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
});
afterEach(() => cleanup());

describe('하이퍼링크 — 텍스트 일부에 걸기', () => {
  it('선택한 글자에만 링크가 걸리고 저장된다', async () => {
    localStorage.setItem('mindflow_doc_lk1', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=lk1&title=x');
    const editor = startEditingNode(container, 'c1');
    applyLink(container, editor, 0, 2, 'example.com/docs');

    fireEvent.keyDown(editor, { key: 'Enter' });
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => {
      const rich = readSavedDoc('lk1').nodes.c1?.rich;
      expect(rich).toEqual([
        { t: '공식', b: false, c: null, href: 'https://example.com/docs' },
        { t: ' 문서', b: false, c: null },
      ]);
    });
  });

  it('스킴을 안 써도 https가 붙는다', () => {
    localStorage.setItem('mindflow_doc_lk2', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=lk2&title=x');
    const editor = startEditingNode(container, 'c1');
    applyLink(container, editor, 0, 2, 'example.com');
    expect(editor.querySelector('[data-href]')?.getAttribute('data-href')).toBe('https://example.com/');
  });

  it('위험한 스킴은 적용 버튼 자체가 잠긴다', () => {
    localStorage.setItem('mindflow_doc_lk3', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=lk3&title=x');
    const editor = startEditingNode(container, 'c1');
    setLinearSelection(editor, 0, 2);
    fireEvent.mouseUp(editor);
    fireEvent.mouseDown(within(getViewport(container)).getByLabelText('하이퍼링크'));
    const input = within(getViewport(container)).getByLabelText('링크 주소') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'javascript:alert(1)' } });
    const apply = within(getViewport(container)).getByTitle('링크 적용') as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    fireEvent.click(apply);
    expect(editor.querySelector('[data-href]')).toBeNull(); // 문서에 들어가지 않는다
  });

  it('링크 입력창이 열려 있는 동안엔 편집이 끊기지 않는다', () => {
    // 입력창으로 포커스가 넘어가면 편집 박스가 blur → 커밋되어 편집이 끝나 버린다.
    localStorage.setItem('mindflow_doc_lk4', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=lk4&title=x');
    const editor = startEditingNode(container, 'c1');
    setLinearSelection(editor, 0, 2);
    fireEvent.mouseUp(editor);
    fireEvent.mouseDown(within(getViewport(container)).getByLabelText('하이퍼링크'));
    fireEvent.blur(editor); // 입력창으로 포커스가 넘어간 상황
    expect(getViewport(container).querySelector('.mf-richedit')).toBeTruthy(); // 아직 편집 중
  });

  it('이미 링크가 걸린 선택에서는 주소가 채워지고 제거 버튼이 뜬다', () => {
    localStorage.setItem('mindflow_doc_lk5', JSON.stringify(LINKED_DOC));
    const { container } = renderEditor('/editor?map=lk5&title=x');
    const editor = startEditingNode(container, 'c1');
    setLinearSelection(editor, 0, 2);
    fireEvent.mouseUp(editor);
    fireEvent.mouseDown(within(getViewport(container)).getByLabelText('하이퍼링크'));
    expect((within(getViewport(container)).getByLabelText('링크 주소') as HTMLInputElement).value).toBe('https://example.com/');
    fireEvent.click(within(getViewport(container)).getByTitle('링크 제거'));
    expect(editor.querySelector('[data-href]')).toBeNull();
  });
});

describe('하이퍼링크 — 자동 인식(타이핑한 URL)', () => {
  it('커밋하면 URL 구간이 링크가 된다', async () => {
    localStorage.setItem('mindflow_doc_al1', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=al1&title=x');
    const editor = startEditingNode(container, 'c1');
    editor.textContent = '문서 https://example.com/a 참고';
    fireEvent.input(editor);
    fireEvent.keyDown(editor, { key: 'Enter' });
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => {
      const rich = readSavedDoc('al1').nodes.c1?.rich;
      expect(rich).toEqual([
        { t: '문서 ', b: false, c: null },
        { t: 'https://example.com/a', b: false, c: null, href: 'https://example.com/a' },
        { t: ' 참고', b: false, c: null },
      ]);
    });
  });

  it('평범한 텍스트는 링크가 되지 않는다', async () => {
    localStorage.setItem('mindflow_doc_al2', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=al2&title=x');
    const editor = startEditingNode(container, 'c1');
    editor.textContent = '버전 1.5 / report.pdf';
    fireEvent.input(editor);
    fireEvent.keyDown(editor, { key: 'Enter' });
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => {
      const node = readSavedDoc('al2').nodes.c1;
      expect(node?.text).toBe('버전 1.5 / report.pdf');
      expect(node?.rich ?? null).toBeNull();
    });
  });
});

describe('하이퍼링크 — 툴바 입력창 동작', () => {
  it('다른 텍스트를 선택하면 링크 입력창이 닫힌다', () => {
    localStorage.setItem('mindflow_doc_lc1', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=lc1&title=x');
    const editor = startEditingNode(container, 'c1');
    setLinearSelection(editor, 0, 2);
    fireEvent.mouseUp(editor);
    fireEvent.mouseDown(within(getViewport(container)).getByLabelText('하이퍼링크'));
    expect(within(getViewport(container)).queryByLabelText('링크 주소')).toBeTruthy();

    setLinearSelection(editor, 3, 5); // 다른 구간을 선택
    fireEvent(document, new Event('selectionchange'));
    expect(within(getViewport(container)).queryByLabelText('링크 주소')).toBeNull();
  });

  it('제거·지우기 버튼이 본문색이다 (비활성처럼 보이지 않게)', () => {
    localStorage.setItem('mindflow_doc_lc2', JSON.stringify(LINKED_DOC));
    const { container } = renderEditor('/editor?map=lc2&title=x');
    const editor = startEditingNode(container, 'c1');
    setLinearSelection(editor, 0, 2);
    fireEvent.mouseUp(editor);
    const clear = within(getViewport(container)).getByTitle('부분 스타일 지우기') as HTMLElement;
    fireEvent.mouseDown(within(getViewport(container)).getByLabelText('하이퍼링크'));
    const remove = within(getViewport(container)).getByTitle('링크 제거') as HTMLElement;
    const apply = within(getViewport(container)).getByTitle('링크 적용') as HTMLElement;
    expect(remove.style.color).toBe(apply.style.color); // 적용과 같은 색
    expect(remove.style.color).not.toBe('');
    expect(clear.style.color).toBe(remove.style.color); // '지우기'도 같은 색
  });
});

describe('하이퍼링크 — 캔버스에서 열기', () => {
  it('Ctrl/⌘+클릭이면 새 탭으로 연다', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    localStorage.setItem('mindflow_doc_lk6', JSON.stringify(LINKED_DOC));
    const { container } = renderEditor('/editor?map=lk6&title=x');
    const link = nodeBox(container, 'c1').querySelector('[data-href]') as HTMLElement;
    expect(link).toBeTruthy();

    fireEvent.click(link); // 그냥 클릭 = 도형 선택, 열지 않는다
    expect(open).not.toHaveBeenCalled();

    fireEvent.click(link, { metaKey: true });
    expect(open).toHaveBeenCalledWith('https://example.com/', '_blank', 'noopener,noreferrer');
    open.mockRestore();
  });

  it('링크 스팬만 포인터 이벤트를 되살린다 (본문은 클릭이 도형으로 통과한다)', () => {
    // 노드 본문은 평소 `pointer-events: none`이라 클릭이 도형 선택/드래그로 간다.
    // 링크에 이걸 되살리지 않으면 Ctrl+클릭이 링크에 **닿지도 못한다**(실브라우저에서 재현).
    localStorage.setItem('mindflow_doc_lk8', JSON.stringify(LINKED_DOC));
    const { container } = renderEditor('/editor?map=lk8&title=x');
    const link = nodeBox(container, 'c1').querySelector('[data-href]') as HTMLElement;
    expect(link.style.pointerEvents).toBe('auto');
  });

  it('편집 중에도 Ctrl/⌘+클릭으로 연다', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    localStorage.setItem('mindflow_doc_lk9', JSON.stringify(LINKED_DOC));
    const { container } = renderEditor('/editor?map=lk9&title=x');
    const editor = startEditingNode(container, 'c1');
    const link = editor.querySelector('[data-href]') as HTMLElement;
    expect(link).toBeTruthy();

    fireEvent.click(link); // 그냥 클릭 = 캐럿 이동, 열지 않는다
    expect(open).not.toHaveBeenCalled();

    fireEvent.click(link, { ctrlKey: true });
    expect(open).toHaveBeenCalledWith('https://example.com/', '_blank', 'noopener,noreferrer');
    open.mockRestore();
  });

  it('밑줄로 링크임을 표시한다', () => {
    localStorage.setItem('mindflow_doc_lk7', JSON.stringify(LINKED_DOC));
    const { container } = renderEditor('/editor?map=lk7&title=x');
    const link = nodeBox(container, 'c1').querySelector('[data-href]') as HTMLElement;
    expect(link.style.textDecoration).toBe('underline');
    expect(link.getAttribute('title')).toContain('example.com');
  });
});

describe('하이퍼링크 — 파란 글자로 표시(요청)', () => {
  it('밝은 도형은 진한 파랑, 어두운 도형은 밝은 파랑을 쓴다', () => {
    // 배경이 아니라 **글자색**의 밝기를 본다: 글자색은 이미 그 배경에서 읽히도록
    // 정해진 값이라(테마 text/accentInk, 또는 사용자의 textColor) 그걸 따라가면
    // 다크 테마·진한 루트 도형에서도 파랑이 묻히지 않는다.
    expect(linkInk('#33281f')).toBe(LINK_INK_ON_LIGHT);
    expect(linkInk('#f3ece4')).toBe(LINK_INK_ON_DARK);
    expect(linkInk('#ffffff')).toBe(LINK_INK_ON_DARK);
    expect(linkInk(null)).toBe(LINK_INK_ON_LIGHT); // 못 읽으면 밝은 배경 기준
  });

  it('커밋된 렌더에서 링크가 파란 글자다', () => {
    localStorage.setItem('mindflow_doc_lkb1', JSON.stringify(LINKED_DOC));
    const { container } = renderEditor('/editor?map=lkb1&title=x');
    const box = nodeBox(container, 'c1');
    const link = box.querySelector('[data-href]') as HTMLElement;
    expect(link.className).toContain('mf-link');
    // 색 자체는 도형이 내려 주는 CSS 변수 — 코랄 테마의 어두운 글자색 → 진한 파랑.
    expect(box.style.getPropertyValue('--mf-link')).toBe(LINK_INK_ON_LIGHT);
  });

  it('편집 박스에서도 파랗게 보인다', () => {
    localStorage.setItem('mindflow_doc_lkb2', JSON.stringify(LINKED_DOC));
    const { container } = renderEditor('/editor?map=lkb2&title=x');
    const editor = startEditingNode(container, 'c1');
    const link = editor.querySelector('[data-href]') as HTMLElement;
    expect(link.className).toContain('mf-link');
  });

  it('파란색이 모델에 굳지 않는다 — 이미 링크가 걸린 글을 다시 커밋해도 색이 비어 있다', async () => {
    // 인라인 `color`로 심으면 `domToRuns`가 그걸 런의 `c`로 저장한다 — 그러면
    // 나중에 링크를 떼도 파란 글자만 남는다. 그래서 색은 클래스로만 준다.
    localStorage.setItem('mindflow_doc_lkb3', JSON.stringify(LINKED_DOC));
    const { container } = renderEditor('/editor?map=lkb3&title=x');
    const editor = startEditingNode(container, 'c1');
    // 실제로 한 글자 고쳐야 저장이 돈다(무변경이면 원본이 그대로 남아 통과해 버린다).
    editor.appendChild(document.createTextNode('!'));
    fireEvent.keyDown(editor, { key: 'Enter' });
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => {
      const rich = readSavedDoc('lkb3').nodes.c1?.rich;
      expect(readSavedDoc('lkb3').nodes.c1?.text).toContain('!'); // 저장이 실제로 돌았는지
      expect(rich?.[0]?.t).toBe('공식');
      expect(rich?.[0]?.href).toBe('https://example.com/');
      expect(rich?.[0]?.c ?? null).toBeNull();
    });
  });

  it('사용자가 고른 글자색이 있으면 그 색이 이긴다', () => {
    localStorage.setItem(
      'mindflow_doc_lkb4',
      JSON.stringify({
        ...DOC,
        nodes: { ...DOC.nodes, c1: { ...DOC.nodes.c1, rich: [{ t: '공식', b: false, c: '#d92626', href: 'https://example.com/' }, { t: ' 문서', b: false, c: null }] } },
      }),
    );
    const { container } = renderEditor('/editor?map=lkb4&title=x');
    const link = nodeBox(container, 'c1').querySelector('[data-href]') as HTMLElement;
    const inner = link.querySelector('span') as HTMLElement;
    expect(inner.style.color).toBe('rgb(217, 38, 38)');
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { parseDoc } from '@mindflow/mindmap-core';
import { Editor } from './Editor';
import { domToRuns, setLinearSelection } from './richtextDom';

// 글머리 기호·번호 매기기(줄 단위 리스트) — 텍스트 마커가 곧 데이터인 설계
// (코어 `list.ts` 참고): 렌더는 `- `→`• ` 글리프 치환 + [마커|내용] 행잉 인덴트
// (`listLines.tsx`의 `ListTextBlock`), 편집은 Shift+Enter(노드)/Enter(메모)
// 자동 이어쓰기.
//
// **편집 중에도 같은 모습**으로 그린다(`listEditHtml`) — 이때 글머리 마커는 표시
// 글리프 `• `로 정규화되어 텍스트에 들어간다(입력 규칙: `- `를 치면 곧바로 `• `).
// 글자 수가 같아 캐럿·오프셋이 그대로이고 `• ` 자체가 유효한 마커라 왕복이 안전하다.

function docWith(nodes: Record<string, object>, floats: object[] = []) {
  return {
    v: 1,
    nodes: {
      root: { id: 'root', text: '루트', emoji: '', parent: null, children: ['c1'], collapsed: false, color: null, x: 0, y: 0 },
      ...nodes,
    },
    floats,
    lines: [],
    zones: [],
    layoutMode: 'right',
    themeKey: 'coral',
  };
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

describe('리스트 렌더링 — 노드', () => {
  it('글머리 줄은 • 글리프 + 마커/내용 분리 행으로 그려진다', () => {
    localStorage.setItem('mindflow_doc_ls1', JSON.stringify(docWith({ c1: { id: 'c1', text: '- 하나\n- 둘', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0 } })));
    const { container } = renderEditor('/editor?map=ls1&title=x');
    const box = nodeBox(container, 'c1');
    expect(box.textContent).toContain('• 하나');
    expect(box.textContent).toContain('• 둘');
    expect(box.textContent).not.toContain('- 하나'); // 원문 하이픈은 표시되지 않는다
    // 마커가 자기 열(스팬)에 있다 — 행잉 인덴트의 기반
    const markers = Array.from(box.querySelectorAll('span')).filter((s) => s.textContent === '• ');
    expect(markers.length).toBe(2);
  });

  it('번호 줄은 입력한 번호 그대로, 평문 줄과 섞여도 각자 렌더된다', () => {
    localStorage.setItem('mindflow_doc_ls2', JSON.stringify(docWith({ c1: { id: 'c1', text: '제목 줄\n1. 첫째\n2) 둘째', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0 } })));
    const { container } = renderEditor('/editor?map=ls2&title=x');
    const box = nodeBox(container, 'c1');
    expect(box.textContent).toContain('제목 줄');
    expect(box.textContent).toContain('1. 첫째');
    expect(box.textContent).toContain('2) 둘째');
  });

  it('리스트 줄의 rich 부분 서식(굵게·색)이 마커를 뺀 내용에 유지된다', () => {
    localStorage.setItem(
      'mindflow_doc_ls3',
      JSON.stringify(
        docWith({
          c1: {
            id: 'c1', text: '- 강조 항목', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0,
            rich: [
              { t: '- ', b: false, c: null },
              { t: '강조', b: true, c: '#f0663f' },
              { t: ' 항목', b: false, c: null },
            ],
          },
        }),
      ),
    );
    const { container } = renderEditor('/editor?map=ls3&title=x');
    const box = nodeBox(container, 'c1');
    const bold = Array.from(box.querySelectorAll('span')).find((s) => s.style.fontWeight === '800');
    expect(bold?.textContent).toBe('강조');
    expect(box.textContent).toContain('• 강조 항목');
  });

  it('리스트가 없는 노드는 기존 단일 스팬 렌더 그대로 (무회귀)', () => {
    localStorage.setItem('mindflow_doc_ls4', JSON.stringify(docWith({ c1: { id: 'c1', text: '평범한 텍스트', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0 } })));
    const { container } = renderEditor('/editor?map=ls4&title=x');
    const box = nodeBox(container, 'c1');
    expect(box.textContent).toContain('평범한 텍스트');
    expect(Array.from(box.querySelectorAll('span')).filter((s) => s.textContent === '• ').length).toBe(0);
  });
});

describe('리스트 자동 이어쓰기 — 노드 편집(Shift+Enter)', () => {
  it('글머리 줄에서 Shift+Enter → 다음 줄에 같은 마커가 이어진다', () => {
    localStorage.setItem('mindflow_doc_lc1', JSON.stringify(docWith({ c1: { id: 'c1', text: '- 하나', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0 } })));
    const { container } = renderEditor('/editor?map=lc1&title=x');
    const editor = startEditingNode(container, 'c1');
    setLinearSelection(editor, 4, 4); // '- 하나' 끝
    fireEvent.keyDown(editor, { key: 'Enter', shiftKey: true });
    // DOM은 줄마다 <div>라 textContent가 아니라 domToRuns로 읽는다.
    // 편집 중 글머리는 `• `로 정규화된다(입력 규칙 — 위 파일 주석 참고).
    expect(domToRuns(editor).text).toBe('• 하나\n• ');
  });

  it('번호 줄에서 Shift+Enter → 번호가 +1 된다', () => {
    localStorage.setItem('mindflow_doc_lc2', JSON.stringify(docWith({ c1: { id: 'c1', text: '3. 셋째', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0 } })));
    const { container } = renderEditor('/editor?map=lc2&title=x');
    const editor = startEditingNode(container, 'c1');
    setLinearSelection(editor, 5, 5);
    fireEvent.keyDown(editor, { key: 'Enter', shiftKey: true });
    expect(domToRuns(editor).text).toBe('3. 셋째\n4. ');
  });

  it('마커만 남은 빈 줄에서 Shift+Enter → 마커가 지워지고 리스트가 끝난다', () => {
    localStorage.setItem('mindflow_doc_lc3', JSON.stringify(docWith({ c1: { id: 'c1', text: '- 하나\n- ', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0 } })));
    const { container } = renderEditor('/editor?map=lc3&title=x');
    const editor = startEditingNode(container, 'c1');
    setLinearSelection(editor, 7, 7); // 둘째 줄 '- ' 끝
    fireEvent.keyDown(editor, { key: 'Enter', shiftKey: true });
    // 둘째 줄의 마커가 사라져 리스트 행이 하나만 남는다(빈 줄은 캐럿용).
    expect(editor.querySelectorAll('div[style*="flex"]').length).toBe(1);
    expect(domToRuns(editor).text).toBe('• 하나');
  });

  it('리스트가 아닌 줄의 Shift+Enter는 개입하지 않는다 (preventDefault 없음)', () => {
    localStorage.setItem('mindflow_doc_lc4', JSON.stringify(docWith({ c1: { id: 'c1', text: '평문', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0 } })));
    const { container } = renderEditor('/editor?map=lc4&title=x');
    const editor = startEditingNode(container, 'c1');
    setLinearSelection(editor, 2, 2);
    // fireEvent는 preventDefault가 불리지 않았으면 true를 돌려준다
    expect(fireEvent.keyDown(editor, { key: 'Enter', shiftKey: true })).toBe(true);
  });

  it('이어쓴 리스트는 커밋 후에도 마커가 텍스트에 남는다 (재파싱 왕복)', async () => {
    localStorage.setItem('mindflow_doc_lc5', JSON.stringify(docWith({ c1: { id: 'c1', text: '- 하나', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0 } })));
    const { container } = renderEditor('/editor?map=lc5&title=x');
    const editor = startEditingNode(container, 'c1');
    setLinearSelection(editor, 4, 4);
    fireEvent.keyDown(editor, { key: 'Enter', shiftKey: true });
    // 이어진 마커 뒤에 내용 입력을 흉내: innerHTML 직접 갱신 대신 커밋만 검증
    fireEvent.keyDown(editor, { key: 'Enter' }); // 커밋
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => {
      const saved = readSavedDoc('lc5');
      expect(saved.nodes.c1?.text).toBe('• 하나\n•'); // 빈 마커 줄의 후행 공백은 커밋 트림
    });
  });
});

describe('리스트 — 메모(플로트)', () => {
  const FLOAT = { id: 'f1', text: '- 할 일\n- 두 번째', x: 100, y: 100, w: 160 };

  it('메모의 글머리 줄이 • 로 렌더된다', () => {
    localStorage.setItem('mindflow_doc_lf1', JSON.stringify(docWith({}, [FLOAT])));
    const { container } = renderEditor('/editor?map=lf1&title=x');
    const card = container.querySelector('[data-float-id="f1"]') as HTMLElement;
    expect(card.textContent).toContain('• 할 일');
    expect(card.textContent).toContain('• 두 번째');
    expect(card.textContent).not.toContain('- 할 일');
  });

  it('접힌 메모의 첫 줄도 • 글리프로 보인다', () => {
    localStorage.setItem('mindflow_doc_lf2', JSON.stringify(docWith({}, [{ ...FLOAT, collapsed: true }])));
    const { container } = renderEditor('/editor?map=lf2&title=x');
    const card = container.querySelector('[data-float-id="f1"]') as HTMLElement;
    expect(card.textContent).toContain('• 할 일');
    expect(card.textContent).not.toContain('두 번째'); // 접힘: 첫 줄만
  });

  it('메모 편집 중 Enter가 리스트를 이어쓴다 (번호 +1)', () => {
    localStorage.setItem('mindflow_doc_lf3', JSON.stringify(docWith({}, [{ ...FLOAT, text: '1. 항목' }])));
    const { container } = renderEditor('/editor?map=lf3&title=x');
    const card = container.querySelector('[data-float-id="f1"]') as HTMLElement;
    fireEvent.doubleClick(card);
    const ta = card.querySelector('textarea') as HTMLTextAreaElement;
    expect(ta).toBeTruthy();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    fireEvent.keyDown(ta, { key: 'Enter' });
    expect(ta.value).toBe('1. 항목\n2. ');
  });

  it('메모 편집 중 빈 마커 줄의 Enter는 마커를 지운다', () => {
    localStorage.setItem('mindflow_doc_lf4', JSON.stringify(docWith({}, [{ ...FLOAT, text: '- 항목\n- ' }])));
    const { container } = renderEditor('/editor?map=lf4&title=x');
    const card = container.querySelector('[data-float-id="f1"]') as HTMLElement;
    fireEvent.doubleClick(card);
    const ta = card.querySelector('textarea') as HTMLTextAreaElement;
    ta.setSelectionRange(ta.value.length, ta.value.length);
    fireEvent.keyDown(ta, { key: 'Enter' });
    expect(ta.value).toBe('- 항목\n');
  });

  it('리스트 없는 메모의 Enter는 개입하지 않는다', () => {
    localStorage.setItem('mindflow_doc_lf5', JSON.stringify(docWith({}, [{ ...FLOAT, text: '그냥 메모' }])));
    const { container } = renderEditor('/editor?map=lf5&title=x');
    const card = container.querySelector('[data-float-id="f1"]') as HTMLElement;
    fireEvent.doubleClick(card);
    const ta = card.querySelector('textarea') as HTMLTextAreaElement;
    ta.setSelectionRange(ta.value.length, ta.value.length);
    expect(fireEvent.keyDown(ta, { key: 'Enter' })).toBe(true);
  });
});

// 제보 ①: 편집하는 동안에는 `- 항목` 원문이 보이고, 확정해야 리스트로 바뀐다.
// 수리: 편집 박스도 커밋 후와 같은 [마커|내용] 구조로 그린다(`listEditHtml`) —
// 마커는 실제 텍스트라 캐럿/오프셋이 그대로다.
describe('편집 중 즉시 리스트 렌더', () => {
  it('편집을 시작하면 곧바로 • 글리프와 마커/내용 행으로 보인다', () => {
    localStorage.setItem('mindflow_doc_le1', JSON.stringify(docWith({ c1: { id: 'c1', text: '- 하나\n- 둘', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0 } })));
    const { container } = renderEditor('/editor?map=le1&title=x');
    const editor = startEditingNode(container, 'c1');
    expect(editor.querySelectorAll('div[style*="flex"]').length).toBe(2);
    expect(Array.from(editor.querySelectorAll('span')).filter((s) => s.textContent === '• ').length).toBe(2);
    expect(editor.textContent).not.toContain('- 하나');
  });

  it('편집 중 마커를 새로 입력하면 그 자리에서 리스트로 바뀐다', () => {
    localStorage.setItem('mindflow_doc_le2', JSON.stringify(docWith({ c1: { id: 'c1', text: '항목', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0 } })));
    const { container } = renderEditor('/editor?map=le2&title=x');
    const editor = startEditingNode(container, 'c1');
    // 리스트가 아닌 동안엔 평문 렌더(기존 경로)
    expect(editor.querySelectorAll('div[style*="flex"]').length).toBe(0);
    // 사용자가 줄 앞에 '- '를 친 상태를 흉내: DOM을 그렇게 만들고 input 발생
    editor.innerHTML = '- 항목';
    fireEvent.input(editor);
    expect(editor.querySelectorAll('div[style*="flex"]').length).toBe(1);
    expect(editor.querySelector('span')?.textContent).toBe('• ');
    expect(domToRuns(editor).text).toBe('• 항목');
  });

  it('마커를 지우면 다시 평문 렌더로 돌아온다', () => {
    localStorage.setItem('mindflow_doc_le3', JSON.stringify(docWith({ c1: { id: 'c1', text: '- 항목', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0 } })));
    const { container } = renderEditor('/editor?map=le3&title=x');
    const editor = startEditingNode(container, 'c1');
    expect(editor.querySelectorAll('div[style*="flex"]').length).toBe(1);
    editor.innerHTML = '항목'; // 마커 삭제를 흉내
    fireEvent.input(editor);
    expect(editor.querySelectorAll('div[style*="flex"]').length).toBe(0);
    expect(domToRuns(editor).text).toBe('항목');
  });

  it('IME 조합 중에는 DOM을 재구성하지 않는다 (조합 보호)', () => {
    localStorage.setItem('mindflow_doc_le4', JSON.stringify(docWith({ c1: { id: 'c1', text: '항목', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0 } })));
    const { container } = renderEditor('/editor?map=le4&title=x');
    const editor = startEditingNode(container, 'c1');
    editor.innerHTML = '- 항목';
    fireEvent.input(editor, { isComposing: true });
    expect(editor.querySelectorAll('div[style*="flex"]').length).toBe(0); // 아직 그대로
    fireEvent.compositionEnd(editor); // 조합이 끝나면 그때 반영
    expect(editor.querySelectorAll('div[style*="flex"]').length).toBe(1);
  });
});

// 제보 ②: 리스트가 적용된 텍스트는 정렬 설정과 무관하게 늘 좌측에 붙었다.
// 수리: 항목([마커|내용]) 블록 전체를 사용자 정렬대로 놓는다(justifyContent).
describe('리스트 정렬 — 사용자 설정(좌/중앙/우) 반영', () => {
  const listNode = (align?: string) => ({
    c1: { id: 'c1', text: '- 하나\n- 둘', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0, ...(align ? { align } : {}) },
  });
  const rowJustify = (container: HTMLElement, id = 'c1') =>
    Array.from(nodeBox(container, id).querySelectorAll('span'))
      .filter((s) => s.style.display === 'flex')
      .map((s) => s.style.justifyContent);

  it('기본(가운데) 정렬이면 리스트 블록도 가운데', () => {
    localStorage.setItem('mindflow_doc_la1', JSON.stringify(docWith(listNode())));
    const { container } = renderEditor('/editor?map=la1&title=x');
    expect(rowJustify(container)).toEqual(['center', 'center']);
  });

  it('좌측 정렬', () => {
    localStorage.setItem('mindflow_doc_la2', JSON.stringify(docWith(listNode('left'))));
    const { container } = renderEditor('/editor?map=la2&title=x');
    expect(rowJustify(container)).toEqual(['flex-start', 'flex-start']);
  });

  it('우측 정렬', () => {
    localStorage.setItem('mindflow_doc_la3', JSON.stringify(docWith(listNode('right'))));
    const { container } = renderEditor('/editor?map=la3&title=x');
    expect(rowJustify(container)).toEqual(['flex-end', 'flex-end']);
  });

  it('편집 박스의 리스트 행도 같은 정렬을 따른다', () => {
    localStorage.setItem('mindflow_doc_la4', JSON.stringify(docWith(listNode('right'))));
    const { container } = renderEditor('/editor?map=la4&title=x');
    const editor = startEditingNode(container, 'c1');
    const rows = Array.from(editor.querySelectorAll('div')).filter((d) => d.style.display === 'flex');
    expect(rows.map((r) => r.style.justifyContent)).toEqual(['flex-end', 'flex-end']);
  });

  it('내용 스팬은 flex 0 1 auto — 짧은 항목이 행을 꽉 채우지 않아야 정렬이 산다', () => {
    localStorage.setItem('mindflow_doc_la5', JSON.stringify(docWith(listNode('center'))));
    const { container } = renderEditor('/editor?map=la5&title=x');
    const row = Array.from(nodeBox(container, 'c1').querySelectorAll('span')).find((s) => s.style.display === 'flex')!;
    const content = row.children[1] as HTMLElement;
    expect(content.style.flex).toBe('0 1 auto');
  });
});

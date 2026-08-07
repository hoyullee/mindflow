// 소프트 키보드의 Enter = 줄바꿈(제보).
//
// 폰에는 Shift가 사실상 없다 — "Enter=확정 / Shift+Enter=줄바꿈" 규칙을 그대로 두면
// 모바일에서는 **줄바꿈을 넣을 방법 자체가 없고**, 줄을 바꾸려다 편집이 끝나 버린다.
// 터치 기기에서는 Enter를 줄바꿈으로 두고, 편집은 바깥을 탭하면 끝난다.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Editor } from './Editor';

const DOC = {
  v: 1,
  nodes: {
    root: { id: 'root', text: '루트', emoji: '', parent: null, children: ['c1'], collapsed: false, color: null, x: 0, y: 0 },
    c1: { id: 'c1', text: '리서치', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0 },
  },
  floats: [{ id: 'f1', x: 40, y: 260, w: 200, text: '메모' }],
  lines: [],
  zones: [],
  layoutMode: 'radial',
  themeKey: 'coral',
};

/** 입력 방식(hover/pointer)까지 답하는 matchMedia 스텁 — 폰은 hover:none·coarse. */
function mockDevice({ touch, mobile = touch }: { touch: boolean; mobile?: boolean }): () => void {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => {
    const matches = query.includes('hover: none') || query.includes('pointer: coarse') ? touch : query.includes('max-width') ? mobile : false;
    return {
      matches,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}

/** 소프트 키보드가 화면 아래를 `inset`px 가리고 있는 상태(visualViewport 축소). */
function mockSoftKeyboard(inset: number): () => void {
  const had = Object.prototype.hasOwnProperty.call(window, 'visualViewport');
  const original = (window as { visualViewport?: unknown }).visualViewport;
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    writable: true,
    value: { height: window.innerHeight - inset, offsetTop: 0, scale: 1, addEventListener: () => {}, removeEventListener: () => {} },
  });
  return () => {
    if (had) Object.defineProperty(window, 'visualViewport', { configurable: true, writable: true, value: original });
    else delete (window as { visualViewport?: unknown }).visualViewport;
  };
}

function renderEditor(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
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

function editBox(container: HTMLElement): HTMLElement {
  const el = getViewport(container).querySelector('.mf-richedit');
  if (!el) throw new Error('edit box not found');
  return el as HTMLElement;
}

/** 노드를 더블클릭해 편집을 연다(데스크톱·터치 공통 경로). 리스트 노드는 본문이
 * [마커|내용]으로 쪼개져 텍스트 조회가 안 되므로 id로 집는다. */
function openNodeEdit(container: HTMLElement, nodeId: string): HTMLElement {
  const box = getViewport(container).querySelector(`[data-node-id="${nodeId}"]`) as HTMLElement;
  fireEvent.doubleClick(box);
  return editBox(container);
}

/** 편집을 열면 전체가 선택된다(타이핑이 곧 교체) — 실제 사용처럼 캐럿을 끝으로. */
function caretToEnd(ed: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(ed);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
});

describe('소프트 키보드의 줄바꿈 키', () => {
  it('터치 기기: 도형 편집 중 Enter는 줄을 바꾸고 편집을 유지한다', () => {
    const restore = mockDevice({ touch: true });
    try {
      localStorage.setItem('mindflow_doc_sk1', JSON.stringify(DOC));
      const { container } = renderEditor('/editor?map=sk1&title=x');
      const ed = openNodeEdit(container, 'c1');
      caretToEnd(ed);

      fireEvent.keyDown(ed, { key: 'Enter' });

      expect(getViewport(container).querySelector('.mf-richedit')).toBeTruthy(); // 편집 유지
      expect(editBox(container).textContent).toContain('리서치'); // 내용은 그대로, 줄만 늘었다
    } finally {
      restore();
    }
  });

  it('터치 기기: 메모 편집도 같은 규칙', () => {
    const restore = mockDevice({ touch: true });
    try {
      localStorage.setItem('mindflow_doc_sk2', JSON.stringify(DOC));
      const { container } = renderEditor('/editor?map=sk2&title=x');
      const card = getViewport(container).querySelector('[data-float-id]') as HTMLElement;
      fireEvent.doubleClick(card);
      const ed = editBox(container);

      fireEvent.keyDown(ed, { key: 'Enter' });

      expect(getViewport(container).querySelector('.mf-richedit')).toBeTruthy();
    } finally {
      restore();
    }
  });

  it('데스크톱: Enter는 그대로 편집을 확정한다(무회귀)', () => {
    const restore = mockDevice({ touch: false, mobile: false });
    try {
      localStorage.setItem('mindflow_doc_sk3', JSON.stringify(DOC));
      const { container } = renderEditor('/editor?map=sk3&title=x');
      const ed = openNodeEdit(container, 'c1');

      fireEvent.keyDown(ed, { key: 'Enter' });

      expect(getViewport(container).querySelector('.mf-richedit')).toBeNull(); // 편집 종료
    } finally {
      restore();
    }
  });

  it('터치 기기에서도 Escape는 편집을 취소한다(빠져나올 길)', () => {
    const restore = mockDevice({ touch: true });
    try {
      localStorage.setItem('mindflow_doc_sk4', JSON.stringify(DOC));
      const { container } = renderEditor('/editor?map=sk4&title=x');
      const ed = openNodeEdit(container, 'c1');

      fireEvent.keyDown(ed, { key: 'Escape' });

      expect(getViewport(container).querySelector('.mf-richedit')).toBeNull();
    } finally {
      restore();
    }
  });

  it('터치 기기: 리스트 줄에서 Enter는 마커를 이어 준다', () => {
    const restore = mockDevice({ touch: true });
    try {
      const doc = { ...DOC, nodes: { ...DOC.nodes, c1: { ...DOC.nodes.c1, text: '1. 첫 항목' } } };
      localStorage.setItem('mindflow_doc_sk5', JSON.stringify(doc));
      const { container } = renderEditor('/editor?map=sk5&title=x');
      const ed = openNodeEdit(container, 'c1');
      caretToEnd(ed);

      fireEvent.keyDown(ed, { key: 'Enter' });

      // 편집은 유지되고, 다음 줄에 다음 번호 마커가 생긴다
      expect(getViewport(container).querySelector('.mf-richedit')).toBeTruthy();
      expect(editBox(container).textContent).toContain('2.');
    } finally {
      restore();
    }
  });

  // 제보(모바일 웹): 폰에서 도형을 편집하다 키패드의 줄바꿈 키를 누르면 편집이
  // 끝나 버린다. 위 테스트들이 통과하는데도 실기기에서 그런 이유는 **판정이 기기
  // 종류에만 걸려 있었기** 때문이다 — 미디어 질의가 "데스크톱"이라고 답하는 환경이
  // 실제로 있다(데스크톱 사이트 모드, 마우스를 붙인 태블릿, 일부 인앱 브라우저).
  // 그 화면에서도 키보드는 소프트 키보드고, Shift가 없다.
  it('미디어 질의가 데스크톱이라 답해도 소프트 키보드가 떠 있으면 Enter는 줄바꿈이다', () => {
    const restore = mockDevice({ touch: false, mobile: false });
    const restoreVv = mockSoftKeyboard(300);
    try {
      localStorage.setItem('mindflow_doc_sk7', JSON.stringify(DOC));
      const { container } = renderEditor('/editor?map=sk7&title=x');
      const ed = openNodeEdit(container, 'c1');
      caretToEnd(ed);

      fireEvent.keyDown(ed, { key: 'Enter' });

      expect(getViewport(container).querySelector('.mf-richedit')).toBeTruthy(); // 편집 유지
      expect(editBox(container).textContent).toContain('리서치');
    } finally {
      restoreVv();
      restore();
    }
  });

  it('메모도 같은 규칙 — 키보드가 떠 있으면 Enter는 줄바꿈', () => {
    const restore = mockDevice({ touch: false, mobile: false });
    const restoreVv = mockSoftKeyboard(300);
    try {
      localStorage.setItem('mindflow_doc_sk8', JSON.stringify(DOC));
      const { container } = renderEditor('/editor?map=sk8&title=x');
      const card = getViewport(container).querySelector('[data-float-id]') as HTMLElement;
      fireEvent.doubleClick(card);
      fireEvent.keyDown(editBox(container), { key: 'Enter' });

      expect(getViewport(container).querySelector('.mf-richedit')).toBeTruthy();
    } finally {
      restoreVv();
      restore();
    }
  });

  // 키패드의 액션 키가 "완료/이동"이면 그 키는 **키보드를 내린다** → 편집 박스가
  // blur → blur 커밋이 편집을 끝낸다. 어느 키를 그릴지는 `enterkeyhint`로 못박는다.
  it('편집 박스는 소프트 키보드에 줄바꿈 키를 요청한다 (enterkeyhint)', () => {
    const restore = mockDevice({ touch: true });
    try {
      localStorage.setItem('mindflow_doc_sk9', JSON.stringify(DOC));
      const { container } = renderEditor('/editor?map=sk9&title=x');
      expect(openNodeEdit(container, 'c1').getAttribute('enterkeyhint')).toBe('enter');

      fireEvent.keyDown(editBox(container), { key: 'Escape' });
      const card = getViewport(container).querySelector('[data-float-id]') as HTMLElement;
      fireEvent.doubleClick(card);
      expect(editBox(container).getAttribute('enterkeyhint')).toBe('enter');
    } finally {
      restore();
    }
  });

  it('편집을 끝내는 길은 남아 있다 — 바깥 탭(blur)이 확정한다', () => {
    const restore = mockDevice({ touch: true });
    try {
      localStorage.setItem('mindflow_doc_sk6', JSON.stringify(DOC));
      const { container } = renderEditor('/editor?map=sk6&title=x');
      const ed = openNodeEdit(container, 'c1');

      fireEvent.blur(ed);

      expect(getViewport(container).querySelector('.mf-richedit')).toBeNull();
      expect(screen.queryByText('리서치')).toBeTruthy();
    } finally {
      restore();
    }
  });
});

// 가로로 돌린 폰(모바일웹 ⑥) — 낮은 화면에서는 속성 시트가 바텀에서 **사이드**로.
//
// 세로 기준으로 만든 55dvh 바텀시트를 가로(높이 350~430px)에 그대로 두면 캔버스가
// 거의 남지 않는다. 남는 축(가로)으로 돌린다.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Editor } from './Editor';
import { MOBILE_SIDE_PANEL_W } from './components/panel/panelPrimitives';

const DOC = {
  v: 1,
  nodes: {
    root: { id: 'root', text: '제품 로드맵', emoji: '', parent: null, children: ['c1'], collapsed: false, color: null, x: 0, y: 0 },
    c1: { id: 'c1', text: '리서치', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0 },
  },
  floats: [],
  lines: [],
  zones: [],
  layoutMode: 'radial',
  themeKey: 'coral',
};

/** 폭·높이 조건을 각각 다르게 답하는 matchMedia 스텁(가로 폰 = 좁고 낮다). */
function mockViewport({ mobile, short }: { mobile: boolean; short: boolean }): () => void {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => {
    const matches = query.includes('max-height') ? short : query.includes('max-width') ? mobile : false;
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

function openProps(container: HTMLElement): void {
  const vp = getViewport(container);
  const box = within(vp).getByText('리서치').closest('[data-node-id]') as HTMLElement;
  fireEvent.pointerDown(box, { pointerId: 1, clientX: 100, clientY: 100, button: 0 });
  fireEvent.pointerUp(window, { pointerId: 1, clientX: 100, clientY: 100 });
  fireEvent.click(within(screen.getByRole('toolbar', { name: '선택 동작' })).getByText('속성'));
}

/** 시트 래퍼(fixed 박스)를 찾는다 — 제목에서 위로 올라간다. */
function sheetOf(): HTMLElement {
  let el: HTMLElement | null = screen.getByText('선택한 주제');
  while (el && el.style.position !== 'fixed') el = el.parentElement;
  if (!el) throw new Error('sheet not found');
  return el;
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
});

describe('가로로 돌린 폰(낮은 화면)', () => {
  it('속성 시트가 오른쪽 사이드로 붙고 화면 높이를 가득 쓴다', () => {
    const restore = mockViewport({ mobile: true, short: true });
    try {
      localStorage.setItem('mindflow_doc_ls1', JSON.stringify(DOC));
      const { container } = renderEditor('/editor?map=ls1&title=x');
      openProps(container);

      const sheet = sheetOf();
      expect(sheet.style.right).toBe('0px');
      expect(sheet.style.top).toBe('0px');
      expect(sheet.style.bottom).toBe('0px');
      expect(sheet.style.width).toBe(`${MOBILE_SIDE_PANEL_W}px`);
      expect(sheet.style.height).toBe(''); // 55dvh가 아니다
    } finally {
      restore();
    }
  });

  it('세로 폰에서는 기존 바텀시트 그대로(무회귀)', () => {
    const restore = mockViewport({ mobile: true, short: false });
    try {
      localStorage.setItem('mindflow_doc_ls2', JSON.stringify(DOC));
      const { container } = renderEditor('/editor?map=ls2&title=x');
      openProps(container);

      const sheet = sheetOf();
      expect(sheet.style.height).toBe('55dvh');
      expect(sheet.style.left).toBe('0px');
      expect(sheet.style.right).toBe('0px');
    } finally {
      restore();
    }
  });

  it('닫기 손잡이는 없다 — 시트 밖(캔버스)을 누르면 닫힌다(요청)', () => {
    const restore = mockViewport({ mobile: true, short: true });
    try {
      localStorage.setItem('mindflow_doc_ls3', JSON.stringify(DOC));
      const { container } = renderEditor('/editor?map=ls3&title=x');
      openProps(container);

      expect(screen.getByText('선택한 주제')).toBeTruthy();
      // 옛 '닫기' 손잡이 줄은 없고, 패널 머리의 ✕(속성 닫기)만 있다(마인드맵 리디자인).
      expect(screen.getByLabelText('속성 닫기')).toBeTruthy();
    } finally {
      restore();
    }
  });

  it('낮은 화면의 드롭다운은 넘치면 스크롤한다(잘려 나가지 않게)', () => {
    const restore = mockViewport({ mobile: true, short: true });
    try {
      localStorage.setItem('mindflow_doc_ls4', JSON.stringify(DOC));
      renderEditor('/editor?map=ls4&title=x');
      fireEvent.click(screen.getByRole('button', { name: '더보기' }));
      const menu = screen.getByText('PNG 이미지').closest('div[style*="max-height"]') as HTMLElement;
      expect(menu).toBeTruthy();
      expect(menu.style.overflowY).toBe('auto');
    } finally {
      restore();
    }
  });
});

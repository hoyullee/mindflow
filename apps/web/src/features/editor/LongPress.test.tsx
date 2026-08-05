// 길게 누르기 감각(모바일웹 ⑦) — 손가락 흔들림 허용치와 진동 신호.
//
// 예전 규칙은 |dx|+|dy| ≤ 10(맨해튼)이라 대각선 흔들림에 1.4배로 엄했다.
// (6,6)은 실제로 8.5px인데 취소됐다 — 걷거나 차 안에서 누르면 예사인 정도다.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Editor } from './Editor';
import { mockMatchMedia } from '../../test/matchMedia';

const DOC = {
  v: 1,
  nodes: { root: { id: 'root', text: '루트', emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 } },
  floats: [],
  lines: [],
  zones: [],
  layoutMode: 'radial',
  themeKey: 'coral',
};

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

/** 터치 포인터 이벤트(jsdom엔 PointerEvent가 없어 MouseEvent에 필드를 심는다). */
function touch(target: EventTarget, type: string, x: number, y: number): void {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
  Object.defineProperty(ev, 'pointerId', { value: 7 });
  Object.defineProperty(ev, 'pointerType', { value: 'touch' });
  act(() => {
    target.dispatchEvent(ev);
  });
}

function hold(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('길게 누르기', () => {
  it('대각선으로 살짝 흔들려도(직선 8.5px) 메뉴가 뜬다', () => {
    const restore = mockMatchMedia(true);
    try {
      localStorage.setItem('mindflow_doc_lp1', JSON.stringify(DOC));
      const { container } = renderEditor('/editor?map=lp1&title=x');
      const vp = getViewport(container);

      touch(vp, 'pointerdown', 200, 300);
      touch(window, 'pointermove', 206, 306); // 맨해튼 12(옛 규칙은 취소), 직선 8.5
      hold(600);

      expect(container.querySelector('.mf-ctx')).toBeTruthy();
    } finally {
      restore();
    }
  });

  it('진짜로 끌면(직선 28px) 화면 이동으로 보고 메뉴를 열지 않는다', () => {
    const restore = mockMatchMedia(true);
    try {
      localStorage.setItem('mindflow_doc_lp2', JSON.stringify(DOC));
      const { container } = renderEditor('/editor?map=lp2&title=x');
      const vp = getViewport(container);

      touch(vp, 'pointerdown', 200, 300);
      touch(window, 'pointermove', 220, 320);
      hold(600);

      expect(container.querySelector('.mf-ctx')).toBeNull();
    } finally {
      restore();
    }
  });

  it('메뉴가 열릴 때 짧게 진동한다(지원 기기에서만)', () => {
    const restore = mockMatchMedia(true);
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    try {
      localStorage.setItem('mindflow_doc_lp3', JSON.stringify(DOC));
      const { container } = renderEditor('/editor?map=lp3&title=x');
      const vp = getViewport(container);

      touch(vp, 'pointerdown', 150, 250);
      hold(600);

      expect(container.querySelector('.mf-ctx')).toBeTruthy();
      expect(vibrate).toHaveBeenCalledTimes(1);
    } finally {
      Reflect.deleteProperty(navigator, 'vibrate');
      restore();
    }
  });

  it('진동을 지원하지 않는 기기(iOS)에서도 메뉴는 그대로 열린다', () => {
    const restore = mockMatchMedia(true);
    try {
      Reflect.deleteProperty(navigator, 'vibrate');
      localStorage.setItem('mindflow_doc_lp4', JSON.stringify(DOC));
      const { container } = renderEditor('/editor?map=lp4&title=x');
      const vp = getViewport(container);

      touch(vp, 'pointerdown', 150, 250);
      hold(600);

      expect(container.querySelector('.mf-ctx')).toBeTruthy();
    } finally {
      restore();
    }
  });

  it('손을 떼면(탭) 메뉴가 아니다 — 기존 규칙 무회귀', () => {
    const restore = mockMatchMedia(true);
    try {
      localStorage.setItem('mindflow_doc_lp5', JSON.stringify(DOC));
      const { container } = renderEditor('/editor?map=lp5&title=x');
      const vp = getViewport(container);

      touch(vp, 'pointerdown', 150, 250);
      hold(200);
      touch(window, 'pointerup', 150, 250);
      hold(600);

      expect(container.querySelector('.mf-ctx')).toBeNull();
    } finally {
      restore();
    }
  });
});

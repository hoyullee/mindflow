import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Editor } from './Editor';
import { mockMatchMedia } from '../../test/matchMedia';

/**
 * 모바일 소프트 키보드 회피(모바일웹 ①).
 *
 * 키보드가 올라와도 레이아웃 뷰포트는 그대로라, 화면 아래쪽 도형을 편집하면 캐럿이
 * 키보드 뒤로 숨었다. `visualViewport`로 가려진 높이를 읽어 편집 대상을 그 위로
 * 옮긴다(속성 시트를 피할 때 쓰던 `centerObjectAboveSheet` 재사용).
 */

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

function panLayer(container: HTMLElement): HTMLElement {
  const el = getViewport(container).querySelector('[data-pan-layer]');
  if (!el) throw new Error('pan layer not found');
  return el as HTMLElement;
}

/** 팬 레이어의 translate(x, y) + scale(z)에서 화면 좌표를 되짚는다. */
function panOf(container: HTMLElement): { x: number; y: number; zoom: number } {
  const t = panLayer(container).style.transform;
  const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([\d.]+)\)/.exec(t);
  if (!m) throw new Error(`unexpected transform: ${t}`);
  return { x: Number(m[1]), y: Number(m[2]), zoom: Number(m[3]) };
}

/** 노드 박스의 화면상 세로 중심(px) — 박스는 캔버스 좌표를 인라인 스타일로 갖는다. */
function screenCenterY(container: HTMLElement, text: string): number {
  const box = within(getViewport(container)).getByText(text).closest('[data-node-id]') as HTMLElement;
  const top = parseFloat(box.style.top);
  const h = parseFloat(box.style.height);
  const p = panOf(container);
  return p.y + p.zoom * (top + h / 2);
}

function selectNodeBox(el: HTMLElement): void {
  fireEvent.pointerDown(el, { pointerId: 1, clientX: 100, clientY: 100, button: 0 });
  fireEvent.pointerUp(window, { pointerId: 1, clientX: 100, clientY: 100 });
}

/** jsdom에는 `visualViewport`가 없다 — 키보드를 흉내 낼 수 있는 최소 스텁을 심는다. */
function installVisualViewport(): { keyboard: (px: number) => void; restore: () => void } {
  const bus = new EventTarget();
  const vv = {
    height: window.innerHeight,
    offsetTop: 0,
    addEventListener: bus.addEventListener.bind(bus),
    removeEventListener: bus.removeEventListener.bind(bus),
  };
  Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true, writable: true });
  return {
    keyboard(px: number) {
      vv.height = window.innerHeight - px;
      act(() => {
        bus.dispatchEvent(new Event('resize'));
      });
    },
    restore() {
      Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true, writable: true });
    },
  };
}

/** 터치 포인터 이벤트(jsdom은 `PointerEvent`가 없어 MouseEvent에 필드를 심는다). */
function touchEvent(target: EventTarget, type: string, init: { pointerId: number; clientX: number; clientY: number }): void {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: init.clientX, clientY: init.clientY });
  Object.defineProperty(ev, 'pointerId', { value: init.pointerId });
  Object.defineProperty(ev, 'pointerType', { value: 'touch' });
  act(() => {
    target.dispatchEvent(ev);
  });
}

/** 빈 캔버스를 손가락으로 끌어 맵을 아래로 내린다 — 편집 대상이 화면 아래(키보드
 * 자리)에 오게 만들어야 회피가 실제로 필요한 상황이 된다. */
function panDown(container: HTMLElement, dy: number): void {
  const vp = getViewport(container);
  touchEvent(vp, 'pointerdown', { pointerId: 9, clientX: 40, clientY: 40 });
  touchEvent(window, 'pointermove', { pointerId: 9, clientX: 40, clientY: 40 + dy });
  touchEvent(window, 'pointerup', { pointerId: 9, clientX: 40, clientY: 40 + dy });
}

function startEditing(container: HTMLElement): void {
  selectNodeBox(within(getViewport(container)).getByText('리서치').closest('[data-node-id]') as HTMLElement);
  fireEvent.click(within(screen.getByRole('toolbar', { name: '선택 동작' })).getByText('편집'));
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
});

describe('모바일 소프트 키보드 회피', () => {
  it('키보드가 올라오면 편집 중인 도형을 키보드 위로 옮긴다', () => {
    const restore = mockMatchMedia(true);
    const vv = installVisualViewport();
    try {
      localStorage.setItem('mindflow_doc_kb1', JSON.stringify(DOC));
      const { container } = renderEditor('/editor?map=kb1&title=x');
      panDown(container, 500); // 편집 대상을 화면 아래(키보드가 덮을 자리)로
      startEditing(container);

      const KB = 360;
      const visibleBottom = window.innerHeight - KB;
      // 전제: 지금 이 도형은 키보드가 덮을 자리에 있다(회피가 필요한 상황)
      expect(screenCenterY(container, '리서치')).toBeGreaterThan(visibleBottom);

      vv.keyboard(KB);

      expect(screenCenterY(container, '리서치')).toBeLessThanOrEqual(visibleBottom);
      // 편집 세션과 서식 툴바는 그대로 유지된다(팬은 문서 변경이 아니다)
      expect(getViewport(container).querySelector('.mf-richedit')).toBeTruthy();
      expect(container.querySelector('.mf-tctx')).toBeTruthy();
    } finally {
      vv.restore();
      restore();
    }
  });

  it('임계값 아래의 잔변동은 화면을 건드리지 않는다', () => {
    const restore = mockMatchMedia(true);
    const vv = installVisualViewport();
    try {
      localStorage.setItem('mindflow_doc_kb2', JSON.stringify(DOC));
      const { container } = renderEditor('/editor?map=kb2&title=x');
      startEditing(container);
      const before = panOf(container);

      vv.keyboard(60); // 액세서리 바 정도

      expect(panOf(container)).toEqual(before);
    } finally {
      vv.restore();
      restore();
    }
  });

  it('편집 중이 아니면 키보드가 떠도 화면을 옮기지 않는다', () => {
    const restore = mockMatchMedia(true);
    const vv = installVisualViewport();
    try {
      localStorage.setItem('mindflow_doc_kb3', JSON.stringify(DOC));
      const { container } = renderEditor('/editor?map=kb3&title=x');
      selectNodeBox(within(getViewport(container)).getByText('리서치').closest('[data-node-id]') as HTMLElement);
      const before = panOf(container);

      vv.keyboard(360);

      expect(panOf(container)).toEqual(before);
    } finally {
      vv.restore();
      restore();
    }
  });

  it('데스크톱에서는 개입하지 않는다(무회귀)', () => {
    const restore = mockMatchMedia(false);
    const vv = installVisualViewport();
    try {
      localStorage.setItem('mindflow_doc_kb4', JSON.stringify(DOC));
      const { container } = renderEditor('/editor?map=kb4&title=x');
      const box = within(getViewport(container)).getByText('리서치').closest('[data-node-id]') as HTMLElement;
      fireEvent.doubleClick(box);
      const before = panOf(container);

      vv.keyboard(360);

      expect(panOf(container)).toEqual(before);
    } finally {
      vv.restore();
      restore();
    }
  });
});

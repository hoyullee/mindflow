// 손가락에서 우클릭 메뉴가 열리는 자리는 **길게 누르기** 하나다(제보: 두 번 터치에 떴다).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LONG_PRESS_MS, installTouchMenuGate } from './noteTouchMenu';

/** jsdom에는 `PointerEvent`가 없다(프로브 함정 F12) — mouse 이벤트에 종류만 얹는다. */
function pointer(type: string, kind: 'touch' | 'mouse', at = { x: 10, y: 10 }): MouseEvent {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y });
  Object.defineProperty(e, 'pointerType', { value: kind });
  return e;
}
const ctx = (): MouseEvent => {
  const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  document.body.dispatchEvent(e);
  return e;
};

describe('손가락의 우클릭 메뉴는 길게 누르기에서만', () => {
  let gate: { stop: () => void; isTouch: () => boolean };
  beforeEach(() => {
    vi.useFakeTimers();
    gate = installTouchMenuGate();
  });
  afterEach(() => {
    gate.stop();
    vi.useRealTimers();
  });

  it('**두 번 터치로 온 메뉴는 버린다** — 길게 누른 적이 없다(제보)', () => {
    document.body.dispatchEvent(pointer('pointerdown', 'touch'));
    document.body.dispatchEvent(pointer('pointerup', 'touch'));
    document.body.dispatchEvent(pointer('pointerdown', 'touch'));
    // 두 번째 탭 직후에 오는 `contextmenu` — 아직 길게 누른 시간이 되지 않았다.
    expect(ctx().defaultPrevented).toBe(true);
  });

  it('길게 누른 뒤에 온 메뉴는 그대로 연다', () => {
    document.body.dispatchEvent(pointer('pointerdown', 'touch'));
    vi.advanceTimersByTime(LONG_PRESS_MS + 20);
    expect(ctx().defaultPrevented).toBe(false);
  });

  it('누른 채 **움직이면** 길게 누르기가 아니다 — 스크롤이거나 글자를 고르는 중이다', () => {
    document.body.dispatchEvent(pointer('pointerdown', 'touch', { x: 10, y: 10 }));
    document.body.dispatchEvent(pointer('pointermove', 'touch', { x: 10, y: 60 }));
    vi.advanceTimersByTime(LONG_PRESS_MS + 20);
    expect(ctx().defaultPrevented).toBe(true);
  });

  it('마우스는 건드리지 않는다 — 우클릭은 언제나 그대로다', () => {
    document.body.dispatchEvent(pointer('pointerdown', 'mouse'));
    expect(ctx().defaultPrevented).toBe(false);
    expect(gate.isTouch()).toBe(false);
  });

  it('걷어 내면 다시 아무것도 막지 않는다', () => {
    document.body.dispatchEvent(pointer('pointerdown', 'touch'));
    gate.stop();
    expect(ctx().defaultPrevented).toBe(false);
  });
});

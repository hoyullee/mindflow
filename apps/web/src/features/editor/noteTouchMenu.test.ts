// 손가락에서 우클릭 메뉴가 열리는 자리는 **길게 누르기** 하나다(제보: 두 번 터치에 떴다).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LONG_PRESS_MS, cancelTouchMenu, installTouchMenuGate, isTouchPointer, registerTouchMenuCloser } from './noteTouchMenu';

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

  it('길게 누르기로 메뉴가 열리면 **고른 글을 접는다** — OS 툴바와 겹치지 않게(제보)', () => {
    document.body.innerHTML = '<p id="t">가나다라</p>';
    const node = document.querySelector('#t')?.firstChild as Text;
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, 3);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    expect(window.getSelection()?.isCollapsed).toBe(false);

    document.body.dispatchEvent(pointer('pointerdown', 'touch'));
    vi.advanceTimersByTime(LONG_PRESS_MS + 20);
    expect(ctx().defaultPrevented).toBe(false);
    // 접는 일은 이벤트가 지나간 **뒤에** 한다(메뉴가 자리를 잡고 나서).
    vi.advanceTimersByTime(1);
    expect(window.getSelection()?.isCollapsed).toBe(true);
  });

  it('막힌 메뉴(두 번 터치)에서는 고른 글을 건드리지 않는다', () => {
    document.body.innerHTML = '<p id="t2">가나다라</p>';
    const node = document.querySelector('#t2')?.firstChild as Text;
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, 3);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    document.body.dispatchEvent(pointer('pointerdown', 'touch'));
    expect(ctx().defaultPrevented).toBe(true);
    vi.advanceTimersByTime(5);
    expect(window.getSelection()?.isCollapsed).toBe(false);
  });

  it('**끌기가 시작되면** 열린 메뉴를 닫고 뒤늦은 메뉴도 막는다(요청)', () => {
    let open = true;
    const off = registerTouchMenuCloser(() => {
      open = false;
    });
    document.body.dispatchEvent(pointer('pointerdown', 'touch'));
    vi.advanceTimersByTime(LONG_PRESS_MS + 20);
    expect(ctx().defaultPrevented).toBe(false);

    cancelTouchMenu();
    expect(open).toBe(false);
    // 브라우저가 늦게 보낸 `contextmenu`도 이제 우리 것이 아니다.
    expect(ctx().defaultPrevented).toBe(true);
    off();
  });

  it('마지막 누름의 종류를 알려 준다 — 미디어 질의가 거짓말하는 기기가 있다(제보)', () => {
    document.body.dispatchEvent(pointer('pointerdown', 'touch'));
    expect(isTouchPointer()).toBe(true);
    document.body.dispatchEvent(pointer('pointerdown', 'mouse'));
    expect(isTouchPointer()).toBe(false);
  });

  it('걷어 내면 다시 아무것도 막지 않는다', () => {
    document.body.dispatchEvent(pointer('pointerdown', 'touch'));
    gate.stop();
    expect(ctx().defaultPrevented).toBe(false);
  });
});

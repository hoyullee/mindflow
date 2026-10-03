import { afterEach, describe, expect, it, vi } from 'vitest';
import { openAfterPointerMoves, pointerHidesWhileTyping } from './pickerPointer';

function move(dx: number, dy: number, pointerType = 'mouse'): Event {
  const e = new Event('pointermove');
  Object.assign(e, { movementX: dx, movementY: dy, pointerType });
  return e;
}

describe('pointerHidesWhileTyping', () => {
  it('Windows만 걸린다', () => {
    expect(pointerHidesWhileTyping({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0' })).toBe(true);
    expect(pointerHidesWhileTyping({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Chrome/140.0' })).toBe(false);
    expect(pointerHidesWhileTyping(undefined)).toBe(false);
  });
});

describe('openAfterPointerMoves', () => {
  afterEach(() => vi.useRealTimers());
  const real = (): boolean => true;

  it('진짜 마우스 이동에서 한 번만 연다 — 제자리 이동·손가락은 거른다', () => {
    const open = vi.fn();
    const giveUp = vi.fn();
    openAfterPointerMoves(open, giveUp, { real });
    window.dispatchEvent(move(0, 0));
    window.dispatchEvent(move(4, 0, 'touch'));
    expect(open).not.toHaveBeenCalled();
    window.dispatchEvent(move(3, -1));
    window.dispatchEvent(move(3, -1));
    expect(open).toHaveBeenCalledTimes(1);
    expect(giveUp).not.toHaveBeenCalled();
  });

  it('흉내 낸(isTrusted가 아닌) 이동은 세지 않는다', () => {
    const open = vi.fn();
    const stop = openAfterPointerMoves(open, vi.fn());
    window.dispatchEvent(move(5, 5));
    expect(open).not.toHaveBeenCalled();
    stop();
  });

  it('마우스 누름·Enter는 연다 · Esc·다른 키·시간 초과는 그만둔다', () => {
    vi.useFakeTimers();
    const cases: Array<[() => void, 'open' | 'giveUp']> = [
      [() => window.dispatchEvent(Object.assign(new Event('pointerdown'), { pointerType: 'mouse' })), 'open'],
      [() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })), 'open'],
      [() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })), 'giveUp'],
      [() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' })), 'giveUp'],
      [() => vi.advanceTimersByTime(3000), 'giveUp'],
    ];
    for (const [act, want] of cases) {
      const open = vi.fn();
      const giveUp = vi.fn();
      openAfterPointerMoves(open, giveUp, { real });
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }));
      act();
      expect(want === 'open' ? open : giveUp).toHaveBeenCalledTimes(1);
      expect(want === 'open' ? giveUp : open).not.toHaveBeenCalled();
      // 끝난 뒤에는 아무것도 듣지 않는다.
      vi.advanceTimersByTime(5000);
      window.dispatchEvent(move(5, 5));
      expect(open.mock.calls.length + giveUp.mock.calls.length).toBe(1);
    }
  });
});

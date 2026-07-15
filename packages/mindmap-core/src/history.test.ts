import { describe, expect, it } from 'vitest';
import { HistoryStack } from './history';
import type { Clock } from './ports';

class FakeClock implements Clock {
  private t = 0;
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    this.t += ms;
  }
  set(ms: number): void {
    this.t = ms;
  }
}

describe('HistoryStack', () => {
  it('the first record() after reset only seeds the baseline (recordHistory: `if (!this._snapCur) { ...; return; }`, MindFlow.dc.html:552)', () => {
    const clock = new FakeClock();
    const hs = new HistoryStack<string>(clock);
    hs.reset('s0');
    expect(hs.current).toBe('s0');
    expect(hs.canUndo()).toBe(false);
    expect(hs.canRedo()).toBe(false);
  });

  it('discrete changes always get their own undo step', () => {
    const clock = new FakeClock();
    const hs = new HistoryStack<string>(clock);
    hs.reset('s0');
    hs.record('s1', false);
    hs.record('s2', false);
    expect(hs.current).toBe('s2');
    expect(hs.undoDepth).toBe(2);
  });

  it('undo/redo round-trip identity', () => {
    const clock = new FakeClock();
    const hs = new HistoryStack<string>(clock);
    hs.reset('s0');
    hs.record('s1', false);
    hs.record('s2', false);

    expect(hs.undo()).toBe('s1');
    expect(hs.current).toBe('s1');
    expect(hs.undo()).toBe('s0');
    expect(hs.current).toBe('s0');
    expect(hs.undo()).toBeUndefined(); // stack exhausted (MindFlow.dc.html:584)
    expect(hs.current).toBe('s0');

    expect(hs.redo()).toBe('s1');
    expect(hs.redo()).toBe('s2');
    expect(hs.redo()).toBeUndefined(); // stack exhausted (MindFlow.dc.html:592)
    expect(hs.current).toBe('s2');
  });

  it('a new discrete record after undoing clears the redo stack (MindFlow.dc.html:562: `this._redoStk = []`)', () => {
    const clock = new FakeClock();
    const hs = new HistoryStack<string>(clock);
    hs.reset('s0');
    hs.record('s1', false);
    hs.record('s2', false);
    hs.undo();
    expect(hs.canRedo()).toBe(true);
    hs.record('s1b', false);
    expect(hs.canRedo()).toBe(false);
    expect(hs.redo()).toBeUndefined();
  });

  it('continuous bursts within the coalesce window merge into one undo step, but the first burst change and a gap past the window each start a new step', () => {
    const clock = new FakeClock();
    const hs = new HistoryStack<string>(clock, { coalesceWindowMs: 1200 });
    hs.reset('s0');

    clock.set(100);
    hs.record('s1', true); // first continuous change: not coalesced with anything -> pushes s0
    clock.set(300);
    hs.record('s2', true); // 200ms later, still continuous -> coalesces (no push)
    clock.set(1600);
    hs.record('s3', true); // 1300ms since last record (>= window) -> new step, pushes s2
    clock.set(1700);
    hs.record('s4', false); // discrete -> always its own step, pushes s3

    expect(hs.current).toBe('s4');
    expect(hs.undoDepth).toBe(3); // [s0, s2, s3]

    expect(hs.undo()).toBe('s3');
    expect(hs.undo()).toBe('s2');
    expect(hs.undo()).toBe('s0');
    expect(hs.undo()).toBeUndefined();
  });

  it('two separate continuous bursts (e.g. two distinct drags) do not coalesce with each other', () => {
    const clock = new FakeClock();
    const hs = new HistoryStack<string>(clock, { coalesceWindowMs: 1200 });
    hs.reset('s0');

    clock.set(0);
    hs.record('drag1-a', true); // pushes s0
    clock.set(50);
    hs.record('drag1-b', true); // coalesces

    // A discrete action ends the burst.
    clock.set(60);
    hs.record('discrete', false); // pushes drag1-b

    clock.set(70);
    hs.record('drag2-a', true); // first change of a *new* burst -> not coalesced, pushes 'discrete'
    clock.set(90);
    hs.record('drag2-b', true); // coalesces with drag2-a

    expect(hs.current).toBe('drag2-b');
    expect(hs.undoDepth).toBe(3); // [s0, drag1-b, discrete]
    expect(hs.undo()).toBe('discrete');
    expect(hs.undo()).toBe('drag1-b');
    expect(hs.undo()).toBe('s0');
  });

  it('caps the undo stack at maxEntries, dropping the oldest (MindFlow.dc.html:561: `if (this._undoStk.length > 60) this._undoStk.shift()`)', () => {
    const clock = new FakeClock();
    const hs = new HistoryStack<number>(clock, { maxEntries: 3 });
    hs.reset(0);
    for (let i = 1; i <= 6; i++) {
      clock.advance(10000); // well past any coalesce window, always discrete anyway
      hs.record(i, false);
    }
    // undo stack held [0,1,2,3,4,5] but capped to the last 3: [3,4,5]; current is 6.
    expect(hs.current).toBe(6);
    expect(hs.undoDepth).toBe(3);
    expect(hs.undo()).toBe(5);
    expect(hs.undo()).toBe(4);
    expect(hs.undo()).toBe(3);
    expect(hs.undo()).toBeUndefined();
  });
});

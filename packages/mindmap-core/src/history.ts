// Undo/redo snapshot history — pure port of the "undo / redo (snapshot
// history, bursts within ... coalesce into one entry)" logic in
// `MindFlow.dc.html:547-597` (`takeSnap`/`recordHistory`/`applySnap`/`undo`/`redo`).
//
// The original keeps this state on the component instance (`_snapCur`,
// `_undoStk`, `_redoStk`, `_lastCont`, `_histBurst`) and drives it from
// `componentDidUpdate` (MindFlow.dc.html:861-869) after every state change
// that isn't itself an undo/redo application. `HistoryStack<T>` reproduces
// the exact same push/pop/coalesce arithmetic as a generic, framework-free
// class parameterized over the snapshot type `T` (e.g. the subset of `Doc`
// the original snapshots: `{ nodes, floats, lines, zones, layoutMode, edgeStyle }`,
// see `takeSnap`, MindFlow.dc.html:549 — note `edgeStyle` is tracked but
// `themeKey` is NOT, an asymmetry the original also has).
//
// Time is injected via the `Clock` port (`ports.ts`) instead of `Date.now()`
// so coalescing is deterministic in tests.

import type { Clock } from './ports';

export interface HistoryStackOptions {
  /**
   * Coalescing window in milliseconds: a continuous change coalesces with
   * the previous one if it arrives before this much time has passed.
   * MindFlow.dc.html:557 hardcodes `1200`.
   *
   * Note: the comment above `recordHistory` (MindFlow.dc.html:547) says
   * "bursts within 600ms coalesce", but the code it documents actually
   * checks `now - this._histBurst < 1200`. The code (1200ms) is treated as
   * the source of truth here; the comment appears stale. See the M1a report.
   */
  coalesceWindowMs?: number;
  /** Max retained undo entries; oldest is dropped past this. MindFlow.dc.html:561 hardcodes `60`. */
  maxEntries?: number;
}

/**
 * Generic snapshot-based undo/redo stack, parameterized over the snapshot
 * type `T` (the host decides what a "snapshot" is — see module doc above).
 */
export class HistoryStack<T> {
  private snapCur: T | undefined;
  private undoStack: T[] = [];
  private redoStack: T[] = [];
  private lastContinuous = false;
  private lastRecordAt = 0;
  private readonly coalesceWindowMs: number;
  private readonly maxEntries: number;

  constructor(
    private readonly clock: Clock,
    options: HistoryStackOptions = {},
  ) {
    this.coalesceWindowMs = options.coalesceWindowMs ?? 1200;
    this.maxEntries = options.maxEntries ?? 60;
  }

  /** The most recently recorded (or restored) snapshot, if any. */
  get current(): T | undefined {
    return this.snapCur;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Number of entries available to undo into (for tests/inspection). */
  get undoDepth(): number {
    return this.undoStack.length;
  }

  /** Number of entries available to redo into (for tests/inspection). */
  get redoDepth(): number {
    return this.redoStack.length;
  }

  /**
   * Establishes (or re-establishes) the current baseline snapshot and clears
   * both stacks, without recording an undo step. Port of the bootstrapping
   * done on load (MindFlow.dc.html:832: `this._snapCur = this.takeSnap();
   * this._undoStk = []; this._redoStk = [];`) and after a doc load finishes
   * (MindFlow.dc.html:862, the `_loadingDoc` branch).
   */
  reset(snapshot: T): void {
    this.snapCur = snapshot;
    this.undoStack = [];
    this.redoStack = [];
    this.lastContinuous = false;
    this.lastRecordAt = 0;
  }

  /**
   * Records a committed state transition. Port of `Component#recordHistory`
   * (MindFlow.dc.html:551-568):
   *
   * ```js
   * recordHistory() {
   *   if (!this._snapCur) { this._snapCur = this.takeSnap(); return; }
   *   const now = Date.now();
   *   const cont = this._contChange;
   *   const coalesce = cont && this._lastCont && (now - this._histBurst < 1200);
   *   if (!coalesce) {
   *     this._undoStk.push(this._snapCur);
   *     if (this._undoStk.length > 60) this._undoStk.shift();
   *     this._redoStk = [];
   *   }
   *   this._lastCont = cont;
   *   this._contChange = false;
   *   this._histBurst = now;
   *   this._snapCur = this.takeSnap();
   * }
   * ```
   *
   * Call this after every committed change with the NEW snapshot (`next`)
   * and whether the change is part of a continuous interaction — the
   * original sets `this._contChange = true` for drags/typing/slider input
   * (MindFlow.dc.html:1667, 2493, 2550-2551, 2617, 2630) and leaves it
   * `false` (the default) for discrete actions, so every discrete action
   * gets its own undo step while same-kind continuous bursts merge.
   *
   * The very first call after construction/`reset` only seeds the baseline
   * (mirrors `if (!this._snapCur) { ...; return; }`) and pushes nothing.
   */
  record(next: T, continuous: boolean): void {
    if (this.snapCur === undefined) {
      this.snapCur = next;
      return;
    }
    const now = this.clock.now();
    const coalesce = continuous && this.lastContinuous && now - this.lastRecordAt < this.coalesceWindowMs;
    if (!coalesce) {
      this.undoStack.push(this.snapCur);
      if (this.undoStack.length > this.maxEntries) this.undoStack.shift();
      this.redoStack = [];
    }
    this.lastContinuous = continuous;
    this.lastRecordAt = now;
    this.snapCur = next;
  }

  /**
   * Port of `Component#undo` (MindFlow.dc.html:582-588), minus the
   * `this.state.editingId || this.state.editingFloat` guard (a UI-focus
   * concern — "native undo inside editors" — that callers should check
   * before invoking this). Returns the snapshot to restore the host state
   * to, or `undefined` if the undo stack is empty.
   */
  undo(): T | undefined {
    if (this.undoStack.length === 0) return undefined;
    const snap = this.undoStack.pop() as T;
    // Invariant: undoStack only ever receives entries after snapCur has been
    // set (see `record`), so snapCur is always defined here.
    this.redoStack.push(this.snapCur as T);
    this.snapCur = snap;
    return snap;
  }

  /** Port of `Component#redo` (MindFlow.dc.html:590-597). */
  redo(): T | undefined {
    if (this.redoStack.length === 0) return undefined;
    const snap = this.redoStack.pop() as T;
    this.undoStack.push(this.snapCur as T);
    this.snapCur = snap;
    return snap;
  }
}

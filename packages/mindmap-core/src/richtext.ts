// Partial (per-character-range) rich-text styling — pure port of
// `Component#applyPartial`'s char-model (MindFlow.dc.html:2700-2727) plus its
// `stripRich` helper (MindFlow.dc.html:2727). The original does this
// execCommand-free: it explodes the node's `rich` runs (or its plain `text`,
// treated as one unstyled run) into one entry per CHARACTER, mutates the
// bold/color of just the `[s0, s1)` slice, then re-merges adjacent
// same-style characters back into runs. This module is the DOM-free half of
// that pipeline — everything except the Selection/Range ↔ text-offset
// plumbing (`linearize`/`setLinearSelection`), which is inherently a browser
// concern and lives in `apps/web` instead (see that package's `richtextDom.ts`).
//
// Kept intentionally decoupled from `Node`: callers pass just the
// `{ text, rich }` slice they care about (a node's own fields, or any other
// rich-text-bearing source) rather than a whole `Node`.

import type { RichRun } from './model';

/** The `{ text, rich }` shape `applyPartialStyle` reads/writes — a structural
 * subset of `Node` (and anything else that carries a rich-text body). */
export interface RichSource {
  text: string;
  rich?: RichRun[] | null;
}

/** One character with its resolved style — the exploded form `applyPartial`
 * operates on before re-merging (MindFlow.dc.html:2710-2711). */
export interface RichChar {
  ch: string;
  b: boolean;
  c: string | null;
}

/** Explodes `src.rich` (or, absent that, `src.text` as one unstyled run) into
 * one `RichChar` per character — port of `applyPartial`'s `chars` build
 * (MindFlow.dc.html:2709-2711). */
export function runsToChars(src: RichSource): RichChar[] {
  const runs: RichRun[] = src.rich && src.rich.length ? src.rich : [{ t: src.text, b: false, c: null }];
  const chars: RichChar[] = [];
  runs.forEach((r) => {
    const t = r.t || '';
    for (let i = 0; i < t.length; i++) chars.push({ ch: t[i]!, b: !!r.b, c: r.c || null });
  });
  return chars;
}

/** Re-merges adjacent same-style characters back into runs — port of
 * `applyPartial`'s `nruns` build (MindFlow.dc.html:2721-2722). Does NOT
 * decide `null`-vs-array (a caller normally follows up with the
 * `.some(r => r.b || r.c)` "styled?" check, same as the original). */
export function charsToRuns(chars: RichChar[]): RichRun[] {
  const runs: RichRun[] = [];
  chars.forEach((x) => {
    const last = runs[runs.length - 1];
    if (last && !!last.b === x.b && (last.c || null) === x.c) last.t += x.ch;
    else runs.push({ t: x.ch, b: x.b, c: x.c });
  });
  return runs;
}

/**
 * Applies a partial style to the `[s0, s1)` character range (order-agnostic —
 * a reversed selection is normalized just like the original) — pure port of
 * `Component#applyPartial` (MindFlow.dc.html:2701-2725), minus the
 * Selection/DOM plumbing (the caller resolves `s0`/`s1` via `linearize`
 * first, and re-applies the DOM selection via `setLinearSelection` after).
 *
 * - `kind: 'b'`: toggles bold across the WHOLE selected range at once — bold
 *   only if the selection wasn't already all-bold (mirrors `!seg.every(x =>
 *   x.b)`, MindFlow.dc.html:2715), so a mixed selection first turns fully
 *   bold, and only a fully-bold selection un-bolds.
 * - `kind: 'c'`: sets every selected character's color to `val`.
 * - `kind: 'clear'`: strips both bold and color from the selected range.
 *
 * `s0 === s1` (a collapsed/empty selection, or a selection clamped down to
 * nothing past the end of the text) is a no-op — returns `src`'s own
 * text/rich unchanged (normalized: an empty `rich` array collapses to
 * `null`), matching the original's early `if (s0 === s1) return;`.
 */
export function applyPartialStyle(src: RichSource, s0In: number, s1In: number, kind: 'b' | 'c' | 'clear', val?: string | null): { text: string; rich: RichRun[] | null } {
  let s0 = s0In;
  let s1 = s1In;
  if (s1 < s0) {
    const t = s0;
    s0 = s1;
    s1 = t;
  }
  const chars = runsToChars(src);
  s1 = Math.min(s1, chars.length);
  s0 = Math.min(s0, s1);
  if (s0 === s1) {
    return { text: src.text, rich: src.rich && src.rich.length ? src.rich : null };
  }
  const seg = chars.slice(s0, s1);
  const target = kind === 'b' ? !seg.every((x) => x.b) : null;
  for (let i = s0; i < s1; i++) {
    const c = chars[i]!;
    if (kind === 'b') c.b = target as boolean;
    else if (kind === 'c') c.c = val ?? null;
    else {
      c.b = false;
      c.c = null;
    }
  }
  const nruns = charsToRuns(chars).filter((r) => r.t);
  const styled = nruns.some((r) => r.b || r.c);
  return { text: chars.map((x) => x.ch).join(''), rich: styled ? nruns : null };
}

/** Removes one style key from every run, dropping back to plain (`null`)
 * `rich` if nothing else is styled afterward — pure port of `Component#stripRich`
 * (MindFlow.dc.html:2727), used when a WHOLE-node style toggle (e.g. the
 * bold-everything button) should override any conflicting partial run. */
export function stripRichStyle(rich: RichRun[] | null | undefined, key: 'b' | 'c'): RichRun[] | null {
  if (!rich || !rich.length) return null;
  const next = rich.map((r) => {
    const o = { ...r };
    delete o[key];
    return o;
  });
  return next.some((r) => r.b || r.c) ? next : null;
}

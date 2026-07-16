import { describe, expect, it } from 'vitest';
import { applyPartialStyle, charsToRuns, runsToChars, stripRichStyle } from './richtext';
import type { RichRun } from './model';

describe('runsToChars / charsToRuns', () => {
  it('explodes a plain (no rich) source into one unstyled char per character', () => {
    const chars = runsToChars({ text: 'abc' });
    expect(chars).toEqual([
      { ch: 'a', b: false, c: null },
      { ch: 'b', b: false, c: null },
      { ch: 'c', b: false, c: null },
    ]);
  });

  it('explodes existing rich runs, carrying each run\'s style onto its own characters', () => {
    const rich: RichRun[] = [
      { t: 'ab', b: true, c: null },
      { t: 'cd', b: false, c: '#ff0000' },
    ];
    const chars = runsToChars({ text: 'abcd', rich });
    expect(chars).toEqual([
      { ch: 'a', b: true, c: null },
      { ch: 'b', b: true, c: null },
      { ch: 'c', b: false, c: '#ff0000' },
      { ch: 'd', b: false, c: '#ff0000' },
    ]);
  });

  it('an empty `rich` array is treated as absent (falls back to plain text)', () => {
    const chars = runsToChars({ text: 'x', rich: [] });
    expect(chars).toEqual([{ ch: 'x', b: false, c: null }]);
  });

  it('re-merges adjacent same-style characters back into runs', () => {
    const runs = charsToRuns([
      { ch: 'a', b: true, c: null },
      { ch: 'b', b: true, c: null },
      { ch: 'c', b: false, c: null },
    ]);
    expect(runs).toEqual([
      { t: 'ab', b: true, c: null },
      { t: 'c', b: false, c: null },
    ]);
  });

  it('does NOT merge characters whose color differs even when bold matches', () => {
    const runs = charsToRuns([
      { ch: 'a', b: false, c: '#111111' },
      { ch: 'b', b: false, c: '#222222' },
    ]);
    expect(runs).toEqual([
      { t: 'a', b: false, c: '#111111' },
      { t: 'b', b: false, c: '#222222' },
    ]);
  });
});

describe('applyPartialStyle', () => {
  it('bolds a plain-text partial selection, producing 3 runs (before/selected/after)', () => {
    const out = applyPartialStyle({ text: 'hello world' }, 6, 11, 'b');
    expect(out.text).toBe('hello world');
    expect(out.rich).toEqual([
      { t: 'hello ', b: false, c: null },
      { t: 'world', b: true, c: null },
    ]);
  });

  it('bolding the WHOLE text collapses to a single bold run', () => {
    const out = applyPartialStyle({ text: 'hi' }, 0, 2, 'b');
    expect(out.rich).toEqual([{ t: 'hi', b: true, c: null }]);
  });

  it('re-bolding an already-fully-bold selection toggles it back OFF (un-bolds), matching `!seg.every(b)`', () => {
    const bolded = applyPartialStyle({ text: 'hello world' }, 6, 11, 'b');
    const unbolded = applyPartialStyle({ text: bolded.text, rich: bolded.rich }, 6, 11, 'b');
    // back to plain — no styled runs left at all
    expect(unbolded.rich).toBeNull();
  });

  it('a MIXED bold/non-bold selection first turns fully bold (not toggled off)', () => {
    // "AB" bold, "CD" not — selecting all 4 chars and toggling bold should make
    // everything bold (mixed selections always turn ON first), not turn AB off.
    const rich: RichRun[] = [
      { t: 'AB', b: true, c: null },
      { t: 'CD', b: false, c: null },
    ];
    const out = applyPartialStyle({ text: 'ABCD', rich }, 0, 4, 'b');
    expect(out.rich).toEqual([{ t: 'ABCD', b: true, c: null }]);
  });

  it('applies a color to a partial selection', () => {
    const out = applyPartialStyle({ text: 'hello world' }, 0, 5, 'c', '#3f8fd0');
    expect(out.rich).toEqual([
      { t: 'hello', b: false, c: '#3f8fd0' },
      { t: ' world', b: false, c: null },
    ]);
  });

  it('clear removes bold+color from the selected range only', () => {
    const rich: RichRun[] = [{ t: 'hello world', b: true, c: '#3f8fd0' }];
    const out = applyPartialStyle({ text: 'hello world', rich }, 0, 5, 'clear');
    expect(out.rich).toEqual([
      { t: 'hello', b: false, c: null },
      { t: ' world', b: true, c: '#3f8fd0' },
    ]);
  });

  it('clearing every styled character drops back to plain (rich: null)', () => {
    const rich: RichRun[] = [{ t: 'hi', b: true, c: null }];
    const out = applyPartialStyle({ text: 'hi', rich }, 0, 2, 'clear');
    expect(out.rich).toBeNull();
    expect(out.text).toBe('hi');
  });

  it('a collapsed selection (s0 === s1) is a no-op', () => {
    const rich: RichRun[] = [{ t: 'hi', b: true, c: null }];
    const out = applyPartialStyle({ text: 'hi', rich }, 1, 1, 'b');
    expect(out).toEqual({ text: 'hi', rich });
  });

  it('a reversed range (s1 < s0) is normalized before applying', () => {
    const out = applyPartialStyle({ text: 'hello world' }, 5, 0, 'c', '#000000');
    expect(out.rich).toEqual([
      { t: 'hello', b: false, c: '#000000' },
      { t: ' world', b: false, c: null },
    ]);
  });

  it('clamps an out-of-range end offset to the text length', () => {
    const out = applyPartialStyle({ text: 'hi' }, 0, 999, 'b');
    expect(out.rich).toEqual([{ t: 'hi', b: true, c: null }]);
  });

  it('an empty `rich` array on the source normalizes to null when the result is unstyled', () => {
    // clear on a plain source with rich: [] (edge case) should still just no-op cleanly
    const out = applyPartialStyle({ text: 'hi', rich: [] }, 0, 0, 'clear');
    expect(out).toEqual({ text: 'hi', rich: null });
  });
});

describe('stripRichStyle', () => {
  it('removes bold from every run, dropping to null if nothing else is styled', () => {
    const rich: RichRun[] = [{ t: 'hi', b: true, c: null }];
    expect(stripRichStyle(rich, 'b')).toBeNull();
  });

  it('removes bold from every run (even non-bold ones), keeping color-only runs styled', () => {
    const rich: RichRun[] = [
      { t: 'a', b: true, c: '#111111' },
      { t: 'b', b: false, c: null },
    ];
    expect(stripRichStyle(rich, 'b')).toEqual([{ t: 'a', c: '#111111' }, { t: 'b', c: null }]);
  });

  it('is a no-op on a null/undefined rich', () => {
    expect(stripRichStyle(null, 'b')).toBeNull();
    expect(stripRichStyle(undefined, 'c')).toBeNull();
  });
});

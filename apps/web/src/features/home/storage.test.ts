import { beforeEach, describe, expect, it } from 'vitest';
import { RECENT_CAP, loadRecent, mergeRecent, pushRecentTitle } from './storage';

describe('pushRecentTitle', () => {
  beforeEach(() => localStorage.clear());

  it('prepends the opened map to the persisted recent list (most-recent first)', () => {
    pushRecentTitle('맵 A');
    pushRecentTitle('맵 B');
    expect(loadRecent()).toEqual(['맵 B', '맵 A']);
  });

  it('de-duplicates: re-opening a map moves it to the front, no duplicate', () => {
    pushRecentTitle('맵 A');
    pushRecentTitle('맵 B');
    pushRecentTitle('맵 A');
    expect(loadRecent()).toEqual(['맵 A', '맵 B']);
  });

  it(`caps the stored history at ${RECENT_CAP}`, () => {
    for (let i = 0; i < RECENT_CAP + 5; i++) pushRecentTitle('맵 ' + i);
    const list = loadRecent();
    expect(list.length).toBe(RECENT_CAP);
    expect(list[0]).toBe('맵 ' + (RECENT_CAP + 4)); // newest first
  });

  it('ignores blank titles', () => {
    pushRecentTitle('맵 A');
    pushRecentTitle('   ');
    expect(loadRecent()).toEqual(['맵 A']);
  });
});

describe('mergeRecent', () => {
  it('keeps this-device recents first, then fills in synced history', () => {
    // local (primary) reflects what was just opened HERE; synced (secondary) is
    // the cross-device history from the backend workspace blob.
    expect(mergeRecent(['맵 A'], ['맵 A', '맵 B', '맵 C'])).toEqual(['맵 A', '맵 B', '맵 C']);
  });

  it('surfaces synced recents on a fresh device (empty local list)', () => {
    expect(mergeRecent([], ['맵 1', '맵 2'])).toEqual(['맵 1', '맵 2']);
  });

  it('de-duplicates by title (a map opened on both devices appears once)', () => {
    expect(mergeRecent(['맵 2', '맵 1'], ['맵 1', '맵 3'])).toEqual(['맵 2', '맵 1', '맵 3']);
  });

  it(`keeps both devices' full history under the retention cap (${RECENT_CAP})`, () => {
    // Retention is deliberately generous (display exposes far fewer — the tray
    // decides from the viewport) so cross-device history isn't truncated.
    const primary = Array.from({ length: 8 }, (_, i) => `p${i}`);
    const secondary = Array.from({ length: 8 }, (_, i) => `s${i}`);
    const merged = mergeRecent(primary, secondary);
    expect(merged.length).toBe(16); // nothing dropped below the cap
    expect(merged.slice(0, 8)).toEqual(primary); // primary (this device) keeps priority
    expect(merged[8]).toBe('s0');
  });

  it(`caps the merged list at RECENT_CAP (${RECENT_CAP}) when history exceeds it`, () => {
    const primary = Array.from({ length: RECENT_CAP }, (_, i) => `p${i}`);
    const secondary = ['overflow'];
    const merged = mergeRecent(primary, secondary);
    expect(merged.length).toBe(RECENT_CAP);
    expect(merged).not.toContain('overflow');
  });

  it('honours an explicit cap argument', () => {
    expect(mergeRecent(['a', 'b'], ['c', 'd', 'e', 'f'], 4)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('tolerates a missing synced list and non-string junk', () => {
    expect(mergeRecent(['맵 1'], undefined)).toEqual(['맵 1']);
    expect(mergeRecent(['맵 1', '', '맵 1'], ['맵 2'])).toEqual(['맵 1', '맵 2']);
  });
});

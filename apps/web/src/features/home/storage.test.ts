import { describe, expect, it } from 'vitest';
import { mergeRecent } from './storage';

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

  it('caps the merged list (default 4)', () => {
    expect(mergeRecent(['a', 'b'], ['c', 'd', 'e', 'f'])).toEqual(['a', 'b', 'c', 'd']);
  });

  it('tolerates a missing synced list and non-string junk', () => {
    expect(mergeRecent(['맵 1'], undefined)).toEqual(['맵 1']);
    expect(mergeRecent(['맵 1', '', '맵 1'], ['맵 2'])).toEqual(['맵 1', '맵 2']);
  });
});

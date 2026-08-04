import { describe, expect, it } from 'vitest';
import { nearestInDirection, type NavPoint } from './navigation';

// Map-space centres. In a right-layout tree, sibling box centres differ by their
// own widths, so a narrower sibling's centre sits slightly to the left of a wider
// one even though they share a column — the exact situation that used to make
// Left/Right jump diagonally.
const RIGHT: Record<string, NavPoint> = {
  root: { x: 0, y: 45 },
  a: { x: 206, y: -27 }, // narrower sibling → centre 8px left of b, and well above
  b: { x: 214, y: 45 }, // selected
  c: { x: 214, y: 117 },
};

describe('nearestInDirection', () => {
  it('Left from a node moves to the node directly left (parent), not a barely-left sibling above', () => {
    // The regression: `a` is only 8px left of `b` but 72px above it. dc's loose
    // cone let it win on proximity; the tight cone rejects it so `root` (directly
    // left, the real "left" neighbour) is chosen.
    expect(nearestInDirection(RIGHT, 'b', 'left')).toBe('root');
  });

  it('Up/Down move between vertically-stacked siblings relative to the selected node', () => {
    expect(nearestInDirection(RIGHT, 'b', 'up')).toBe('a');
    expect(nearestInDirection(RIGHT, 'b', 'down')).toBe('c');
    expect(nearestInDirection(RIGHT, 'a', 'down')).toBe('b');
  });

  it('Right picks the most axis-aligned child of the several to the right', () => {
    const t: Record<string, NavPoint> = {
      root: { x: 0, y: 45 },
      up: { x: 210, y: -30 },
      mid: { x: 214, y: 40 }, // closest to root's row
      dn: { x: 214, y: 120 },
    };
    expect(nearestInDirection(t, 'root', 'right')).toBe('mid');
  });

  it('falls back to a looser cone when nothing is within 45°, so the arrow still moves', () => {
    // `a` (org-chart child) sits below-left of root; pressing Up is steeply off-axis
    // (dx 165, dy -179 → perp > along), so only the fallback cone finds root.
    const down: Record<string, NavPoint> = {
      root: { x: 600, y: 428 },
      a: { x: 435, y: 607 },
      b: { x: 595, y: 607 },
      c: { x: 765, y: 607 },
    };
    expect(nearestInDirection(down, 'a', 'up')).toBe('root');
    // sibling row: Left/Right stay on the row
    expect(nearestInDirection(down, 'b', 'right')).toBe('c');
    expect(nearestInDirection(down, 'b', 'left')).toBe('a');
    // Down from root lands on the most-centred child
    expect(nearestInDirection(down, 'root', 'down')).toBe('b');
  });

  it('Down does not skip a directly-below WIDE node in a left-aligned column (boxes provided)', () => {
    // The reported bug: children are left-edge-aligned, so a wide node's CENTRE
    // sits far right of a narrow sibling's. Centre-based perp made the
    // directly-below wide node look diagonal (perp 80 > along 56 → rejected by
    // the tight cone) while the narrower node two rows down passed and won —
    // ArrowDown skipped a node. Edge-based gaps see the shared x-range (perp 0).
    const col: Record<string, NavPoint> = {
      a: { x: 300, y: 0, w: 100, h: 40 }, // "이히히히"
      b: { x: 380, y: 56, w: 260, h: 40 }, // "우왘ㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋ" — wide, left edge aligned with a
      c: { x: 310, y: 112, w: 120, h: 40 }, // "이ㅏㅓㅣㅏㅇ" — two rows down, centre near a's
    };
    expect(nearestInDirection(col, 'a', 'down')).toBe('b');
    // and the reverse hop stays symmetric (this direction already worked)
    expect(nearestInDirection(col, 'c', 'up')).toBe('b');
    expect(nearestInDirection(col, 'b', 'up')).toBe('a');
    expect(nearestInDirection(col, 'b', 'down')).toBe('c');
  });

  it('Left/Right with boxes measure facing-edge gaps, so a wide sibling row does not distort the pick', () => {
    // Parent directly left of a tall child column; the child boxes overlap the
    // parent's y-range so perp is 0 regardless of their heights.
    const t: Record<string, NavPoint> = {
      parent: { x: 100, y: 50, w: 120, h: 44 },
      child: { x: 320, y: 60, w: 200, h: 44 }, // slightly off-centre but overlapping rows
      far: { x: 330, y: 220, w: 80, h: 44 },
    };
    expect(nearestInDirection(t, 'parent', 'right')).toBe('child');
    expect(nearestInDirection(t, 'child', 'left')).toBe('parent');
  });

  it('boxes overlapping in the pressed direction clamp along to 1 instead of going negative', () => {
    // b's box starts above a's bottom edge (overlap in y) but its centre is
    // clearly below — the arrow must still reach it.
    const t: Record<string, NavPoint> = {
      a: { x: 0, y: 0, w: 100, h: 60 },
      b: { x: 10, y: 40, w: 100, h: 60 },
    };
    expect(nearestInDirection(t, 'a', 'down')).toBe('b');
    expect(nearestInDirection(t, 'b', 'up')).toBe('a');
  });

  it('returns null when there is no node in the pressed direction', () => {
    expect(nearestInDirection(RIGHT, 'b', 'right')).toBeNull(); // b/c are the rightmost column
    expect(nearestInDirection({ only: { x: 0, y: 0 } }, 'only', 'up')).toBeNull();
    expect(nearestInDirection(RIGHT, 'missing', 'up')).toBeNull(); // unknown fromId
  });
});

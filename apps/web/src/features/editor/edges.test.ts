import { describe, expect, it } from 'vitest';
import { buildEdgePath } from './edges';
import type { EdgeBox } from './edges';

// Regression guard for the 조직도(down) connector fix: a curved edge to a child
// must keep its control points HIGH in the row gap (just under the parent),
// not at the vertical midpoint — otherwise the curve dips into the shared child
// row and passes behind a tall/wide sibling whose box extends up toward the
// parent (the reported "도형 뒤로 그어지는" bug).

/** Pull the two cubic control-point Y values out of an `M .. C c1x c1y c2x c2y ex ey` path. */
function cubicControlYs(d: string): [number, number] {
  const m = /C\s+[-\d.]+\s+([-\d.]+)\s+[-\d.]+\s+([-\d.]+)\s+[-\d.]+\s+[-\d.]+/.exec(d);
  if (!m) throw new Error('not a cubic path: ' + d);
  return [Number(m[1]), Number(m[2])];
}

describe('buildEdgePath — down (조직도) curve routing', () => {
  const parent: EdgeBox = { x: 0, y: 0, w: 120, h: 52 };
  const py = parent.y + parent.h / 2; // parent bottom = 26

  it('keeps both control points within ~40px of the parent bottom, regardless of child depth', () => {
    // a child far below (deep row) — the old midpoint control point would sit
    // ~hundreds of px down; the fix clamps it into the gap band.
    const child: EdgeBox = { x: 400, y: 600, w: 120, h: 40 };
    const [c1y, c2y] = cubicControlYs(buildEdgePath('down', 'curve', parent, child));
    expect(c1y).toBeLessThanOrEqual(py + 41);
    expect(c2y).toBeLessThanOrEqual(py + 41);
    expect(c1y).toBeGreaterThan(py); // still below the parent (a downward bend)
  });

  it('drops vertically into the child (second control point shares the child column)', () => {
    const child: EdgeBox = { x: 400, y: 600, w: 120, h: 40 };
    const d = buildEdgePath('down', 'curve', parent, child);
    // second control x == child.x → the curve enters the child straight down
    const m = /C\s+[-\d.]+\s+[-\d.]+\s+([-\d.]+)\s+[-\d.]+\s+([-\d.]+)\s+[-\d.]+/.exec(d)!;
    expect(Number(m[1])).toBe(child.x);
    expect(Number(m[2])).toBe(child.x);
  });
});

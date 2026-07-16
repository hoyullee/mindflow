import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cubicAt, findLineSnap, portPoint, resolveLineEndpoints, resolveLineGeometry, borderPoint } from './geometry';
import type { Box, LineLike, SnapCandidate } from './geometry';
import type { Line, LineAnchor } from './model';

const golden = JSON.parse(
  readFileSync(fileURLToPath(new URL('../test/fixtures/golden/line-geometry.json', import.meta.url)), 'utf8'),
) as { cases: (LineLike & { id: string })[]; expected: Record<string, { C1: { x: number; y: number }; C2: { x: number; y: number }; nx: number; ny: number; c1: number; c2: number; mid: { x: number; y: number } }> };

describe('geometry — resolveLineGeometry parity vs dc lineCPs', () => {
  for (const c of golden.cases) {
    it(`matches golden control points + midpoint for "${c.id}"`, () => {
      const g = resolveLineGeometry(c);
      const e = golden.expected[c.id]!;
      expect(g.c1).toBe(e.c1);
      expect(g.c2).toBe(e.c2);
      expect(g.nx).toBeCloseTo(e.nx, 10);
      expect(g.ny).toBeCloseTo(e.ny, 10);
      expect(g.C1.x).toBeCloseTo(e.C1.x, 10);
      expect(g.C1.y).toBeCloseTo(e.C1.y, 10);
      expect(g.C2.x).toBeCloseTo(e.C2.x, 10);
      expect(g.C2.y).toBeCloseTo(e.C2.y, 10);
      const mid = cubicAt(g, 0.5);
      expect(mid.x).toBeCloseTo(e.mid.x, 10);
      expect(mid.y).toBeCloseTo(e.mid.y, 10);
    });
  }
});

describe('geometry — cubicAt invariants', () => {
  const g = resolveLineGeometry({ x1: -120, y1: 40, x2: 120, y2: 40, c1: 0, c2: 0 });
  it('t=0 is P0 and t=1 is P3', () => {
    expect(cubicAt(g, 0)).toEqual(g.P0);
    expect(cubicAt(g, 1)).toEqual(g.P3);
  });
  it('a straight (c1=c2=0) line has its midpoint at the segment midpoint', () => {
    const mid = cubicAt(g, 0.5);
    expect(mid.x).toBeCloseTo(0, 10);
    expect(mid.y).toBeCloseTo(40, 10);
  });
  it('legacy `curve` fills both control offsets when c1/c2 are absent', () => {
    const g2 = resolveLineGeometry({ x1: 0, y1: 0, x2: 0, y2: 100, curve: 25 });
    expect(g2.c1).toBe(25);
    expect(g2.c2).toBe(25);
  });
});

describe('geometry — portPoint', () => {
  const box = { cx: 10, cy: 20, hw: 40, hh: 15 };
  it('returns the middle of each edge', () => {
    expect(portPoint(box, 'top')).toEqual({ x: 10, y: 5 });
    expect(portPoint(box, 'bottom')).toEqual({ x: 10, y: 35 });
    expect(portPoint(box, 'left')).toEqual({ x: -30, y: 20 });
    expect(portPoint(box, 'right')).toEqual({ x: 50, y: 20 });
  });
});

// Type-level: a full Line is assignable to LineLike (compile-time compatibility).
const _line: Line = {
  id: 'x', x1: 0, y1: 0, x2: 1, y2: 1, startArrow: false, endArrow: true, dashed: false, c1: 0, c2: 0, label: '',
};
const _lineIsLineLike: LineLike = _line;
void _lineIsLineLike;

describe('geometry — borderPoint', () => {
  const box: Box = { cx: 0, cy: 0, hw: 40, hh: 20 };
  it('projects toward the target on the box border', () => {
    expect(borderPoint(box, 200, 0)).toEqual({ x: 40, y: 0 });
    expect(borderPoint(box, 0, 200)).toEqual({ x: 0, y: 20 });
  });
  it('defaults to the top point when the target coincides with the center', () => {
    expect(borderPoint(box, 0, 0)).toEqual({ x: 0, y: -20 });
  });
});

describe('geometry — findLineSnap (port of Component#findSnap)', () => {
  const nodeBox: Box = { cx: 100, cy: 100, hw: 40, hh: 20 };
  const floatBox: Box = { cx: 300, cy: 300, hw: 60, hh: 22 };
  const candidates: SnapCandidate[] = [
    { kind: 'node', id: 'n1', box: nodeBox },
    { kind: 'float', id: 'f1', box: floatBox },
  ];

  it('snaps to the nearest port within the threshold (34px)', () => {
    // just above the node's top port (100,80): within 34px
    expect(findLineSnap(102, 60, candidates)).toEqual({ kind: 'node', id: 'n1', side: 'top' });
  });
  it('snaps to a float port', () => {
    // right of the float's right port (360,300)
    expect(findLineSnap(370, 302, candidates)).toEqual({ kind: 'float', id: 'f1', side: 'right' });
  });
  it('returns null when nothing is within the threshold', () => {
    expect(findLineSnap(1000, 1000, candidates)).toBeNull();
  });
  it('respects a custom snap distance', () => {
    expect(findLineSnap(102, 100, candidates, 5)).toBeNull(); // right port at (140,100) is 38px away > 5
    expect(findLineSnap(139, 100, candidates, 5)).toEqual({ kind: 'node', id: 'n1', side: 'right' });
  });
});

describe('geometry — resolveLineEndpoints (port of Component#resolveEnd/resolveLine)', () => {
  const nodeBox: Box = { cx: 100, cy: 100, hw: 40, hh: 20 };
  const floatBox: Box = { cx: 300, cy: 300, hw: 60, hh: 22 };
  const boxOf = (a: LineAnchor): Box | null => (a.kind === 'node' ? (a.id === 'n1' ? nodeBox : null) : a.id === 'f1' ? floatBox : null);

  it('uses raw x/y when there is no anchor', () => {
    const out = resolveLineEndpoints({ x1: 1, y1: 2, x2: 3, y2: 4 }, boxOf);
    expect(out).toEqual({ x1: 1, y1: 2, x2: 3, y2: 4 });
  });
  it('resolves an anchored endpoint with a side to the exact port point', () => {
    const out = resolveLineEndpoints({ x1: 999, y1: 999, x2: 500, y2: 500, a1: { kind: 'node', id: 'n1', side: 'right' } }, boxOf);
    expect(out.x1).toBe(140);
    expect(out.y1).toBe(100);
  });
  it('falls back to a border point toward the other end for a legacy anchor without a side', () => {
    const out = resolveLineEndpoints({ x1: 999, y1: 999, x2: 300, y2: 300, a1: { kind: 'node', id: 'n1' } }, boxOf);
    // aimed at (300,300) from the node box's center (100,100) — bottom-right diagonal, clamped to the box edge
    const expected = borderPoint(nodeBox, 300, 300);
    expect(out.x1).toBeCloseTo(expected.x, 10);
    expect(out.y1).toBeCloseTo(expected.y, 10);
  });
  it('falls back to raw x/y when the anchor target box is not found (e.g. deleted node)', () => {
    const out = resolveLineEndpoints({ x1: 7, y1: 8, x2: 3, y2: 4, a1: { kind: 'node', id: 'missing', side: 'top' } }, boxOf);
    expect(out.x1).toBe(7);
    expect(out.y1).toBe(8);
  });
  it('an explicit null anchor behaves the same as no anchor (detached)', () => {
    const out = resolveLineEndpoints({ x1: 5, y1: 6, x2: 7, y2: 8, a1: null, a2: null }, boxOf);
    expect(out).toEqual({ x1: 5, y1: 6, x2: 7, y2: 8 });
  });
  it('both endpoints anchored resolve independently', () => {
    const out = resolveLineEndpoints(
      { x1: 0, y1: 0, x2: 0, y2: 0, a1: { kind: 'node', id: 'n1', side: 'left' }, a2: { kind: 'float', id: 'f1', side: 'top' } },
      boxOf,
    );
    expect(out).toEqual({ x1: 60, y1: 100, x2: 300, y2: 278 });
  });
});

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cubicAt, portPoint, resolveLineGeometry } from './geometry';
import type { LineLike } from './geometry';
import type { Line } from './model';

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

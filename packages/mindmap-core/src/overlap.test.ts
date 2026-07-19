import { describe, expect, it } from 'vitest';
import { computeFreeNudge } from './overlap';
import type { NodeMap } from './model';

function node(id: string, x: number, y: number, extra: Partial<NodeMap[string]> = {}): NodeMap[string] {
  return { id, text: id, emoji: '', parent: null, children: [], collapsed: false, color: null, x, y, ...extra };
}

// box lookup that reads the node's own x/y as the on-screen center (100×100 box)
const box100 = (nodes: NodeMap) => (id: string) => {
  const n = nodes[id];
  return n ? { x: n.x, y: n.y, w: 100, h: 100 } : null;
};

describe('computeFreeNudge', () => {
  it('returns null when the shapes do not overlap', () => {
    const nodes: NodeMap = { a: node('a', 0, 0, { free: true }), b: node('b', 300, 0, { free: true }) };
    expect(computeFreeNudge('a', nodes, box100(nodes))).toBeNull();
  });

  it('pushes an overlapping shape clear along the shorter axis', () => {
    // b sits mostly on top of a, offset right by 20 → least overlap is horizontal
    const nodes: NodeMap = { a: node('a', 0, 0, { free: true }), b: node('b', 20, 0, { free: true }) };
    const v = computeFreeNudge('b', nodes, box100(nodes), { margin: 0 });
    expect(v).not.toBeNull();
    // after applying, b must no longer overlap a
    const bx = 20 + v!.dx;
    const by = 0 + v!.dy;
    const overlapX = Math.min(bx + 50, 50) - Math.max(bx - 50, -50);
    const overlapY = Math.min(by + 50, 50) - Math.max(by - 50, -50);
    expect(overlapX <= 0.5 || overlapY <= 0.5).toBe(true);
    // moved horizontally (shorter axis), not vertically
    expect(Math.abs(v!.dx)).toBeGreaterThan(0);
    expect(v!.ids).toEqual(['b']);
  });

  it('keeps the injected clearance margin between boxes', () => {
    const nodes: NodeMap = { a: node('a', 0, 0, { free: true }), b: node('b', 30, 0, { free: true }) };
    const v = computeFreeNudge('b', nodes, box100(nodes), { margin: 12 });
    expect(v).not.toBeNull();
    const bx = 30 + v!.dx;
    // edges (±50) plus 12px clearance ⇒ centers at least 100 + 12 apart
    expect(Math.abs(bx - 0)).toBeGreaterThanOrEqual(100 + 12 - 0.6);
  });

  it('moves the whole subtree together (ids include descendants)', () => {
    const nodes: NodeMap = {
      a: node('a', 0, 0, { free: true }),
      b: node('b', 15, 0, { free: true, children: ['c'] }),
      c: node('c', 15, 60, { parent: 'b' }),
    };
    const v = computeFreeNudge('b', nodes, box100(nodes), { margin: 0 });
    expect(v).not.toBeNull();
    expect(v!.ids.sort()).toEqual(['b', 'c']);
  });

  it('pushes a free shape off a TREE node using the injected (laid-out) position', () => {
    // A tree node whose doc x/y is 0,0 (this port never writes layout back into
    // the doc) but whose ON-SCREEN box is at (40, 0). The free shape overlaps that
    // on-screen box — the nudge must use the injected position, not the doc's 0,0.
    const nodes: NodeMap = {
      root: node('root', 0, 0),
      tn: node('tn', 0, 0, { parent: 'root' }), // doc position 0,0 …
      s: node('s', 60, 0, { free: true }),
    };
    const boxOf = (id: string) => {
      if (id === 'tn') return { x: 40, y: 0, w: 100, h: 100 }; // … but rendered at 40,0
      const n = nodes[id];
      return n ? { x: n.x, y: n.y, w: 100, h: 100 } : null;
    };
    const v = computeFreeNudge('s', nodes, boxOf, { margin: 0 });
    expect(v).not.toBeNull();
    const sx = 60 + v!.dx;
    const overlap = Math.min(sx + 50, 40 + 50) - Math.max(sx - 50, 40 - 50);
    expect(overlap).toBeLessThanOrEqual(0.5);
  });

  it('ignores obstacles with no box (e.g. collapsed / off-screen)', () => {
    const nodes: NodeMap = { a: node('a', 0, 0, { free: true }), b: node('b', 20, 0, { free: true }) };
    // 'a' has no measurable box → not an obstacle → nothing to push against
    const boxOf = (id: string) => (id === 'a' ? null : { x: nodes[id]!.x, y: nodes[id]!.y, w: 100, h: 100 });
    expect(computeFreeNudge('b', nodes, boxOf)).toBeNull();
  });

  it('spiral-searches a clear spot when a shape is boxed in on all sides', () => {
    // a is fully surrounded; the iterative push oscillates, so the fallback runs
    const nodes: NodeMap = {
      a: node('a', 0, 0, { free: true }),
      up: node('up', 0, -80, { free: true }),
      down: node('down', 0, 80, { free: true }),
      left: node('left', -80, 0, { free: true }),
      right: node('right', 80, 0, { free: true }),
    };
    const v = computeFreeNudge('a', nodes, box100(nodes), { margin: 4 });
    expect(v).not.toBeNull();
    // after nudging, a must clear every neighbour
    const ax = 0 + v!.dx;
    const ay = 0 + v!.dy;
    for (const o of [
      { x: 0, y: -80 },
      { x: 0, y: 80 },
      { x: -80, y: 0 },
      { x: 80, y: 0 },
    ]) {
      const ox = Math.min(ax + 50, o.x + 50) - Math.max(ax - 50, o.x - 50);
      const oy = Math.min(ay + 50, o.y + 50) - Math.max(ay - 50, o.y - 50);
      expect(ox <= 0.5 || oy <= 0.5).toBe(true);
    }
  });
});

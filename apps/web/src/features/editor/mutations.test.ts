import { describe, expect, it } from 'vitest';
import type { NodeMap } from '@mindflow/mindmap-core';
import { nudgeFreeNode } from './mutations';

function node(id: string, x: number, y: number, extra: Partial<NodeMap[string]> = {}): NodeMap[string] {
  return { id, text: id, emoji: '', parent: null, children: [], collapsed: false, color: null, x, y, ...extra };
}

// on-screen box lookup: reads each node's own x/y as its center (100×100 box)
const boxes = (nodes: NodeMap) => (id: string) => {
  const n = nodes[id];
  return n ? { x: n.x, y: n.y, w: 100, h: 100 } : null;
};

describe('nudgeFreeNode', () => {
  it('returns the SAME reference when nothing overlaps (no spurious commit)', () => {
    const nodes: NodeMap = { a: node('a', 0, 0, { free: true }), b: node('b', 400, 0, { free: true }) };
    expect(nudgeFreeNode(nodes, 'b', boxes(nodes))).toBe(nodes);
  });

  it('shifts an overlapping free shape clear of its neighbour (immutably)', () => {
    const nodes: NodeMap = { a: node('a', 0, 0, { free: true }), b: node('b', 20, 10, { free: true }) };
    const out = nudgeFreeNode(nodes, 'b', boxes(nodes));
    expect(out).not.toBe(nodes);
    // 'a' untouched, 'b' moved out of overlap
    expect(out.a!.x).toBe(0);
    const bx = out.b!.x;
    const by = out.b!.y;
    const ox = Math.min(bx + 50, 50) - Math.max(bx - 50, -50);
    const oy = Math.min(by + 50, 50) - Math.max(by - 50, -50);
    expect(ox <= 0.5 || oy <= 0.5).toBe(true);
  });

  it('moves a free shape and its whole subtree by the same delta', () => {
    const nodes: NodeMap = {
      a: node('a', 0, 0, { free: true }),
      b: node('b', 15, 0, { free: true, children: ['c'] }),
      c: node('c', 15, 70, { parent: 'b' }),
    };
    const out = nudgeFreeNode(nodes, 'b', boxes(nodes));
    expect(out).not.toBe(nodes);
    // b and c shift by the same (dx, dy) — their relative offset is preserved
    expect(out.c!.x - out.b!.x).toBe(nodes.c!.x - nodes.b!.x);
    expect(out.c!.y - out.b!.y).toBe(nodes.c!.y - nodes.b!.y);
  });

  it('moves ONLY the targeted shape, never the one it overlaps', () => {
    // a is stationary; b was just moved on top of it. Nudging b must leave a put.
    const nodes: NodeMap = { a: node('a', 0, 0, { free: true }), b: node('b', 25, 10, { free: true }) };
    const out = nudgeFreeNode(nodes, 'b', boxes(nodes));
    expect(out).not.toBe(nodes);
    // the stationary shape 'a' keeps its exact position; only 'b' moved
    expect(out.a!.x).toBe(0);
    expect(out.a!.y).toBe(0);
    expect(out.b!.x === 25 && out.b!.y === 10).toBe(false);
  });
});

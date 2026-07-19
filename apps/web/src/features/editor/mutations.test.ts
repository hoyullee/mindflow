import { describe, expect, it } from 'vitest';
import type { NodeMap } from '@mindflow/mindmap-core';
import { nudgeAllFreeNodes, nudgeFreeNode } from './mutations';

function node(id: string, x: number, y: number, extra: Partial<NodeMap[string]> = {}): NodeMap[string] {
  return { id, text: id, emoji: '', parent: null, children: [], collapsed: false, color: null, x, y, ...extra };
}

const size = () => ({ w: 100, h: 100 });

describe('nudgeFreeNode', () => {
  it('returns the SAME reference when nothing overlaps (no spurious commit)', () => {
    const nodes: NodeMap = { a: node('a', 0, 0, { free: true }), b: node('b', 400, 0, { free: true }) };
    expect(nudgeFreeNode(nodes, 'b', size)).toBe(nodes);
  });

  it('shifts an overlapping free shape clear of its neighbour (immutably)', () => {
    const nodes: NodeMap = { a: node('a', 0, 0, { free: true }), b: node('b', 20, 10, { free: true }) };
    const out = nudgeFreeNode(nodes, 'b', size);
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
    const out = nudgeFreeNode(nodes, 'b', size);
    expect(out).not.toBe(nodes);
    // b and c shift by the same (dx, dy) — their relative offset is preserved
    expect(out.c!.x - out.b!.x).toBe(nodes.c!.x - nodes.b!.x);
    expect(out.c!.y - out.b!.y).toBe(nodes.c!.y - nodes.b!.y);
  });
});

describe('nudgeAllFreeNodes', () => {
  it('returns the SAME reference when no shapes overlap', () => {
    const nodes: NodeMap = { root: node('root', 0, 0), a: node('a', 0, 200, { free: true }), b: node('b', 400, 200, { free: true }) };
    expect(nudgeAllFreeNodes(nodes, size)).toBe(nodes);
  });

  it('separates a pile of overlapping shapes (none overlap afterwards)', () => {
    // three free shapes stacked nearly on top of each other (creation-stagger pile)
    const nodes: NodeMap = {
      root: node('root', 0, 0),
      a: node('a', 200, 0, { free: true }),
      b: node('b', 220, 15, { free: true }),
      c: node('c', 240, 30, { free: true }),
    };
    const out = nudgeAllFreeNodes(nodes, size);
    expect(out).not.toBe(nodes);
    const ids = ['a', 'b', 'c'];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const p = out[ids[i]!]!;
        const q = out[ids[j]!]!;
        const ox = Math.min(p.x + 50, q.x + 50) - Math.max(p.x - 50, q.x - 50);
        const oy = Math.min(p.y + 50, q.y + 50) - Math.max(p.y - 50, q.y - 50);
        expect(ox <= 0.5 || oy <= 0.5).toBe(true);
      }
    }
  });
});

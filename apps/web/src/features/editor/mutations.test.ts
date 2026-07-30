import { describe, expect, it } from 'vitest';
import type { NodeMap } from '@mindflow/mindmap-core';
import { nodeFullyRich, nudgeFreeNode, toggleNodesRichStyle } from './mutations';

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

// 속성 패널 I·S 버튼(도형 선택 시 전체 텍스트 기울임/취소선) — 새 모델 필드 없이
// rich 런을 전체 범위에 적용하는 whole-node 토글. 규칙은 굵게(toggleNodesBold)와
// 동일: FIRST 대상의 현재 상태 기준으로 전원 켜거나 전원 끈다.
describe('toggleNodesRichStyle / nodeFullyRich', () => {
  it('평문 노드에 기울임을 켜면 전체가 한 런으로 덮인다', () => {
    const nodes: NodeMap = { a: node('a', 0, 0, { text: 'hello' }) };
    const out = toggleNodesRichStyle(nodes, ['a'], 'i');
    expect(out).not.toBe(nodes);
    expect(out.a!.rich).toEqual([{ t: 'hello', b: false, c: null, i: true }]);
    expect(nodeFullyRich(out.a, 'i')).toBe(true);
  });

  it('전부 켜진 노드에 다시 누르면 꺼지고, 다른 스타일이 없으면 rich=null로 돌아간다', () => {
    const nodes: NodeMap = { a: node('a', 0, 0, { text: 'hello', rich: [{ t: 'hello', b: false, c: null, i: true }] }) };
    const out = toggleNodesRichStyle(nodes, ['a'], 'i');
    expect(out.a!.rich).toBeNull();
    expect(nodeFullyRich(out.a, 'i')).toBe(false);
  });

  it('부분 색상은 보존한 채 기울임만 덮는다 (끌 때도 색은 남는다)', () => {
    const nodes: NodeMap = {
      a: node('a', 0, 0, { text: 'hello world', rich: [{ t: 'hello ', b: false, c: null }, { t: 'world', b: false, c: '#f0663f' }] }),
    };
    const on = toggleNodesRichStyle(nodes, ['a'], 'i');
    expect(on.a!.rich).toEqual([
      { t: 'hello ', b: false, c: null, i: true },
      { t: 'world', b: false, c: '#f0663f', i: true },
    ]);
    const off = toggleNodesRichStyle(on, ['a'], 'i');
    expect(off.a!.rich).toEqual([
      { t: 'hello ', b: false, c: null },
      { t: 'world', b: false, c: '#f0663f' },
    ]);
  });

  it('부분 기울임(혼합)은 먼저 전체 켜짐으로 정규화된다', () => {
    const nodes: NodeMap = {
      a: node('a', 0, 0, { text: 'ab', rich: [{ t: 'a', b: false, c: null, i: true }, { t: 'b', b: false, c: null }] }),
    };
    expect(nodeFullyRich(nodes.a, 'i')).toBe(false); // 혼합은 "켜짐"이 아니다
    const out = toggleNodesRichStyle(nodes, ['a'], 'i');
    expect(out.a!.rich).toEqual([{ t: 'ab', b: false, c: null, i: true }]);
  });

  it('다중 선택은 첫 대상 기준으로 전원 같은 방향으로 토글된다', () => {
    const nodes: NodeMap = {
      a: node('a', 0, 0, { text: 'aa', rich: [{ t: 'aa', b: false, c: null, s: true }] }), // 이미 켜짐
      b: node('b', 0, 0, { text: 'bb' }), // 꺼짐
    };
    // 첫 대상(a)이 켜져 있으므로 → 전원 끔 (b는 원래 꺼져 있었으니 그대로)
    const out = toggleNodesRichStyle(nodes, ['a', 'b'], 's');
    expect(out.a!.rich).toBeNull();
    expect(out.b!.rich ?? null).toBeNull();
    // 이제 첫 대상이 꺼져 있으므로 → 전원 켬
    const out2 = toggleNodesRichStyle(out, ['a', 'b'], 's');
    expect(out2.a!.rich).toEqual([{ t: 'aa', b: false, c: null, s: true }]);
    expect(out2.b!.rich).toEqual([{ t: 'bb', b: false, c: null, s: true }]);
  });

  it('빈 텍스트/없는 id는 안전한 no-op', () => {
    const nodes: NodeMap = { a: node('a', 0, 0, { text: '' }) };
    expect(toggleNodesRichStyle(nodes, ['ghost'], 'i')).toBe(nodes);
    const out = toggleNodesRichStyle(nodes, ['a'], 'i');
    expect(out.a!.rich ?? null).toBeNull(); // 켤 글자가 없다
    expect(nodeFullyRich(nodes.a, 'i')).toBe(false);
    expect(nodeFullyRich(undefined, 'i')).toBe(false);
  });
});

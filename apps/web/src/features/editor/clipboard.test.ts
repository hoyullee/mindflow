import { describe, expect, it } from 'vitest';
import type { Doc, Float, Line, NodeMap, Zone } from '@mindflow/mindmap-core';
import { ROOT_ID } from '@mindflow/mindmap-core';
import { clipboardCount, collectClipboard, isClipboardEmpty, pasteClipboard } from './clipboard';

function node(id: string, x: number, y: number, extra: Partial<NodeMap[string]> = {}): NodeMap[string] {
  return { id, text: id, emoji: '', parent: null, children: [], collapsed: false, color: null, x, y, ...extra };
}

function float(id: string, x: number, y: number, extra: Partial<Float> = {}): Float {
  return { id, x, y, w: 160, text: id, ...extra };
}

function line(id: string, extra: Partial<Line> = {}): Line {
  return { id, x1: 0, y1: 0, x2: 100, y2: 100, startArrow: false, endArrow: true, dashed: false, c1: 0.3, c2: 0.7, label: '', ...extra };
}

function zone(id: string, x: number, y: number): Zone {
  return { id, x, y, w: 200, h: 120, label: id } as Zone;
}

/** root ─ A(─A1) ─ B, plus a memo/line/zone. */
function baseDoc(): Doc {
  const nodes: NodeMap = {
    [ROOT_ID]: node(ROOT_ID, 0, 0, { text: '루트', children: ['A', 'B'] }),
    A: node('A', 100, -50, { text: 'A', parent: ROOT_ID, children: ['A1'] }),
    A1: node('A1', 220, -50, { text: 'A1', parent: 'A' }),
    B: node('B', 100, 50, { text: 'B', parent: ROOT_ID }),
  };
  return { nodes, floats: [float('f1', 10, 10)], lines: [line('l1')], zones: [zone('z1', 300, 300)], layoutMode: 'radial', themeKey: 'light' } as unknown as Doc;
}

/** Deterministic id factory so assertions can name the pasted objects. */
function ids(): (prefix?: string) => string {
  let n = 0;
  return (p = 'x') => `${p}${++n}`;
}

describe('collectClipboard', () => {
  it('노드를 고르면 그 서브트리 전체가 담긴다(루트는 직접 지정된 노드만)', () => {
    const doc = baseDoc();
    const clip = collectClipboard(doc, { kind: 'node', id: 'A' }, null)!;
    expect(clip.nodeRoots).toEqual(['A']);
    expect(clip.nodes.map((n) => n.id).sort()).toEqual(['A', 'A1']); // 자손까지
  });

  it('맵 루트는 복사 대상이 아니다(삭제와 동일한 규칙)', () => {
    const doc = baseDoc();
    expect(collectClipboard(doc, { kind: 'node', id: ROOT_ID }, null)).toBeNull();
  });

  it('조상과 자손이 함께 선택되면 조상만 남긴다(같은 노드 두 번 복사 방지)', () => {
    const doc = baseDoc();
    const clip = collectClipboard(doc, null, { nodes: ['A', 'A1'], floats: ['f1'], lines: [] })!;
    expect(clip.nodeRoots).toEqual(['A']); // A1은 A의 서브트리로 따라온다
    expect(clip.nodes.map((n) => n.id).sort()).toEqual(['A', 'A1']);
    expect(clip.floats.map((f) => f.id)).toEqual(['f1']);
  });

  it('메모·선·영역도 각각 담긴다', () => {
    const doc = baseDoc();
    expect(collectClipboard(doc, { kind: 'float', id: 'f1' }, null)!.floats).toHaveLength(1);
    expect(collectClipboard(doc, { kind: 'line', id: 'l1' }, null)!.lines).toHaveLength(1);
    expect(collectClipboard(doc, { kind: 'zone', id: 'z1' }, null)!.zones).toHaveLength(1);
  });

  it('선택이 없으면 null', () => {
    expect(collectClipboard(baseDoc(), null, null)).toBeNull();
    expect(isClipboardEmpty(null)).toBe(true);
  });
});

describe('pasteClipboard — 노드에 붙여넣기', () => {
  it('제보 시나리오: A를 복사해 B에 붙이면 A의 서브트리가 B의 자식으로 복제된다', () => {
    const doc = baseDoc();
    const clip = collectClipboard(doc, { kind: 'node', id: 'A' }, null)!;
    const out = pasteClipboard(doc, clip, { kind: 'node', id: 'B' }, ids())!;

    // B가 새 자식을 하나 얻었다
    const bKids = out.doc.nodes.B!.children;
    expect(bKids).toHaveLength(1);
    const copyId = bKids[0]!;
    expect(copyId).not.toBe('A'); // 새 id

    // 내용은 동일하고, 자손까지 함께 복제됐다
    const copy = out.doc.nodes[copyId]!;
    expect(copy.text).toBe('A');
    expect(copy.parent).toBe('B');
    expect(copy.children).toHaveLength(1);
    expect(out.doc.nodes[copy.children[0]!]!.text).toBe('A1');

    // 원본은 그대로(복사이므로)
    expect(out.doc.nodes.A!.text).toBe('A');
    expect(out.doc.nodes.ROOT ?? out.doc.nodes[ROOT_ID]).toBeTruthy();
    // 붙여넣은 결과가 선택된다
    expect(out.selection).toEqual({ kind: 'node', id: copyId });
  });

  it('자유 도형을 노드에 붙이면 연결된 자식이 된다(free/side 해제)', () => {
    const doc = baseDoc();
    doc.nodes.S = node('S', 500, 500, { text: 'S', free: true, side: 'R' });
    const clip = collectClipboard(doc, { kind: 'node', id: 'S' }, null)!;
    const out = pasteClipboard(doc, clip, { kind: 'node', id: 'B' }, ids())!;
    const copy = out.doc.nodes[out.doc.nodes.B!.children[0]!]!;
    expect(copy.parent).toBe('B');
    expect(copy.free).toBeUndefined();
    expect(copy.side).toBeUndefined();
  });

  it('접혀 있는 노드에 붙여넣으면 펴서 보이게 한다', () => {
    const doc = baseDoc();
    doc.nodes.B!.collapsed = true;
    const clip = collectClipboard(doc, { kind: 'node', id: 'A' }, null)!;
    const out = pasteClipboard(doc, clip, { kind: 'node', id: 'B' }, ids())!;
    expect(out.doc.nodes.B!.collapsed).toBe(false);
  });

  it('잘라내기로 대상 노드가 사라졌으면 좌표 붙여넣기로 내려앉는다(자유 도형)', () => {
    const doc = baseDoc();
    const clip = collectClipboard(doc, { kind: 'node', id: 'A' }, null)!;
    const out = pasteClipboard(doc, clip, { kind: 'node', id: '없는노드' }, ids())!;
    const pasted = Object.values(out.doc.nodes).find((n) => n.text === 'A' && n.id !== 'A')!;
    expect(pasted.free).toBe(true);
    expect(pasted.parent).toBeNull();
  });
});

describe('pasteClipboard — 좌표에 붙여넣기', () => {
  it('여러 객체의 상대 위치를 유지한 채 지정 지점에 배치된다', () => {
    const doc = baseDoc();
    doc.floats.push(float('f2', 60, 30)); // f1(10,10)에서 (+50,+20)
    const clip = collectClipboard(doc, null, { nodes: [], floats: ['f1', 'f2'], lines: [] })!;
    const out = pasteClipboard(doc, clip, { kind: 'point', x: 1000, y: 2000 }, ids())!;

    const added = out.doc.floats.slice(doc.floats.length);
    expect(added).toHaveLength(2);
    // 좌상단 기준점이 지정 지점으로 오고, 둘 사이 간격은 그대로
    expect([added[0]!.x, added[0]!.y]).toEqual([1000, 2000]);
    expect([added[1]!.x, added[1]!.y]).toEqual([1050, 2020]);
  });

  it('여럿을 붙이면 다중 선택으로 잡힌다', () => {
    const doc = baseDoc();
    doc.floats.push(float('f2', 60, 30));
    const clip = collectClipboard(doc, null, { nodes: [], floats: ['f1', 'f2'], lines: [] })!;
    const out = pasteClipboard(doc, clip, { kind: 'point', x: 0, y: 0 }, ids())!;
    expect(out.selection).toBeNull();
    expect(out.multi!.floats).toHaveLength(2);
  });

  it('노드에 붙일 때 메모는 원본에서 어긋나게 둔다(정확히 겹치지 않도록)', () => {
    const doc = baseDoc();
    const clip = collectClipboard(doc, { kind: 'float', id: 'f1' }, null)!;
    const out = pasteClipboard(doc, clip, { kind: 'node', id: 'B' }, ids())!;
    const added = out.doc.floats[out.doc.floats.length - 1]!;
    expect(added.x).toBeGreaterThan(10);
    expect(added.y).toBeGreaterThan(10);
  });
});

describe('pasteClipboard — 선 앵커', () => {
  it('함께 복사된 노드를 가리키던 앵커는 새 사본으로 다시 연결된다', () => {
    const doc = baseDoc();
    doc.lines = [line('l1', { a1: { kind: 'node', id: 'A' }, a2: { kind: 'node', id: 'B' } })];
    const clip = collectClipboard(doc, null, { nodes: ['A', 'B'], floats: [], lines: ['l1'] })!;
    const out = pasteClipboard(doc, clip, { kind: 'point', x: 0, y: 0 }, ids())!;

    const added = out.doc.lines[out.doc.lines.length - 1]!;
    // 원본 A/B가 아니라, 같이 복사된 사본들을 가리켜야 한다
    expect(added.a1!.id).not.toBe('A');
    expect(added.a2!.id).not.toBe('B');
    expect(out.doc.nodes[added.a1!.id]!.text).toBe('A');
    expect(out.doc.nodes[added.a2!.id]!.text).toBe('B');
  });

  it('밖을 가리키던 앵커는 떼어낸다 — 그대로 두면 사본이 원본에 겹쳐 붙여넣기가 안 보인다', () => {
    const doc = baseDoc();
    doc.lines = [line('l1', { a1: { kind: 'node', id: 'A' } })];
    const clip = collectClipboard(doc, { kind: 'line', id: 'l1' }, null)!; // 선만 복사
    const out = pasteClipboard(doc, clip, { kind: 'point', x: 700, y: 800 }, ids())!;

    const added = out.doc.lines[out.doc.lines.length - 1]!;
    expect(added.a1).toBeUndefined();
    expect(added.x1).toBe(700); // 좌표로 자리를 잡는다
  });
});

describe('pasteClipboard — 방어', () => {
  it('빈 클립보드는 아무것도 하지 않는다', () => {
    expect(pasteClipboard(baseDoc(), null, { kind: 'point', x: 0, y: 0 }, ids())).toBeNull();
  });

  it('원본 문서를 변형하지 않는다(불변)', () => {
    const doc = baseDoc();
    const before = JSON.stringify(doc);
    const clip = collectClipboard(doc, { kind: 'node', id: 'A' }, null)!;
    pasteClipboard(doc, clip, { kind: 'node', id: 'B' }, ids());
    expect(JSON.stringify(doc)).toBe(before);
  });

  it('여러 번 붙여넣으면 매번 새 id로 쌓인다', () => {
    const doc = baseDoc();
    const clip = collectClipboard(doc, { kind: 'node', id: 'A' }, null)!;
    const factory = ids();
    const once = pasteClipboard(doc, clip, { kind: 'node', id: 'B' }, factory)!;
    const twice = pasteClipboard(once.doc, clip, { kind: 'node', id: 'B' }, factory)!;
    expect(twice.doc.nodes.B!.children).toHaveLength(2);
    expect(new Set(twice.doc.nodes.B!.children).size).toBe(2); // 서로 다른 id
  });

  it('clipboardCount는 서브트리가 아니라 복사 대상 개수를 센다', () => {
    const doc = baseDoc();
    const clip = collectClipboard(doc, { kind: 'node', id: 'A' }, null)!;
    expect(clip.nodes).toHaveLength(2); // A + A1
    expect(clipboardCount(clip)).toBe(1); // 사용자가 고른 건 A 하나
  });
});

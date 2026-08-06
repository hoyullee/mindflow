// **끊긴 동안 양쪽이 편집했다가 다시 붙었을 때 무엇이 남는가.**
//
// 재연결하면 두 Y.Doc은 반드시 **수렴한다**(양쪽 화면이 같아진다) — 그건 CRDT가
// 보장한다. 하지만 "수렴 = 둘 다 보존"이 아니다. 우리 바인딩은 노드마다 중첩
// Y.Map이고 각 필드는 **키 단위 last-writer-wins**라, 같은 대상을 동시에 건드리면
// 한쪽 값이 조용히 진다. 어디까지 안전하고 어디부터 지는지를 이 테스트가 고정한다
// (에디터가 "끊기면 편집을 멈추는" 근거 — apps/web `collabBlocked`).

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { addNode, applyUpdate, docToYDoc, encodeStateAsUpdate, removeNode, setNodeField, yDocToDoc } from './binding';
import type { Doc, Node } from '../model';

const BASE: Doc = {
  v: 1,
  nodes: {
    root: { id: 'root', text: '루트', emoji: '', parent: null, children: ['a'], collapsed: false, color: null, x: 0, y: 0 },
    a: { id: 'a', text: '원래 a', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0 },
  },
  floats: [],
  lines: [],
  zones: [],
  layoutMode: 'radial',
  themeKey: 'coral',
};

/** 같은 세션에서 이력을 공유하는 두 피어(합류 시 상태 교환) — 끊기기 직전 상태. */
function joinedPair(): { A: Y.Doc; B: Y.Doc } {
  const A = docToYDoc(BASE);
  const B = new Y.Doc();
  applyUpdate(B, encodeStateAsUpdate(A));
  applyUpdate(A, encodeStateAsUpdate(B));
  return { A, B };
}

/** 재연결 — 서로 빠진 연산만 주고받는다(provider의 상태 벡터 diff와 같은 결과). */
function reconnect(A: Y.Doc, B: Y.Doc): void {
  const svA = Y.encodeStateVector(A);
  const svB = Y.encodeStateVector(B);
  applyUpdate(A, Y.encodeStateAsUpdate(B, svA));
  applyUpdate(B, Y.encodeStateAsUpdate(A, svB));
}

const kid = (id: string, text: string): Node => ({ id, text, emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0 });

describe('끊긴 동안의 동시 편집 — 재연결 후 병합 결과', () => {
  it('언제나 수렴한다: 두 피어의 문서가 완전히 같아진다', () => {
    const { A, B } = joinedPair();
    setNodeField(A, 'a', 'text', 'A가 쓴 내용');
    setNodeField(B, 'a', 'text', 'B가 쓴 내용');
    reconnect(A, B);
    expect(yDocToDoc(A)).toEqual(yDocToDoc(B));
  });

  it('안전: 서로 **다른 노드**를 고치면 둘 다 남는다', () => {
    const { A, B } = joinedPair();
    setNodeField(A, 'a', 'text', 'A가 고친 a');
    setNodeField(B, 'root', 'text', 'B가 고친 루트');
    reconnect(A, B);
    const d = yDocToDoc(A);
    expect(d.nodes.a?.text).toBe('A가 고친 a');
    expect(d.nodes.root?.text).toBe('B가 고친 루트');
  });

  it('안전: 같은 노드라도 **다른 필드**면 둘 다 남는다(중첩 Y.Map의 이유)', () => {
    const { A, B } = joinedPair();
    setNodeField(A, 'a', 'text', 'A가 쓴 내용');
    setNodeField(B, 'a', 'color', '#3f8fd0');
    reconnect(A, B);
    const d = yDocToDoc(A);
    expect(d.nodes.a?.text).toBe('A가 쓴 내용');
    expect(d.nodes.a?.color).toBe('#3f8fd0');
  });

  it('위험 ①: 같은 노드의 **같은 필드**는 한쪽만 남는다(다른 쪽 편집은 사라진다)', () => {
    const { A, B } = joinedPair();
    setNodeField(A, 'a', 'text', 'A가 쓴 내용');
    setNodeField(B, 'a', 'text', 'B가 쓴 내용');
    reconnect(A, B);
    const text = yDocToDoc(A).nodes.a?.text;
    // 어느 쪽이 이길지는 Yjs의 결정적 규칙(클라이언트 id)에 달렸다 — 시간순이 아니다.
    expect(['A가 쓴 내용', 'B가 쓴 내용']).toContain(text);
    expect(text === 'A가 쓴 내용' && text === 'B가 쓴 내용').toBe(false); // 둘 다일 수는 없다
  });

  it('위험 ②: 각자 **자식을 추가**하면 노드는 남지만 한쪽은 트리에서 떨어진다', () => {
    const { A, B } = joinedPair();
    addNode(A, 'x', kid('x', 'A의 자식'));
    setNodeField(A, 'root', 'children', ['a', 'x']);
    addNode(B, 'y', kid('y', 'B의 자식'));
    setNodeField(B, 'root', 'children', ['a', 'y']);
    reconnect(A, B);

    const d = yDocToDoc(A);
    // 노드 자체는 둘 다 살아 있지만…
    expect(Object.keys(d.nodes).sort()).toEqual(['a', 'root', 'x', 'y']);
    // …부모의 `children`은 배열 **필드**(LWW)라 한쪽 목록만 남는다 → 다른 자식은
    // 화면에서 사라진다(부모가 가리키지 않는다).
    expect(d.nodes.root?.children).toHaveLength(2);
    const orphan = d.nodes.root?.children?.includes('x') ? 'y' : 'x';
    expect(d.nodes.root?.children).not.toContain(orphan);
  });

  it('위험 ③: 한쪽이 지우고 한쪽이 고치면 **삭제가 이긴다**', () => {
    const { A, B } = joinedPair();
    setNodeField(A, 'a', 'text', 'A가 쓴 내용');
    removeNode(B, 'a');
    setNodeField(B, 'root', 'children', []);
    reconnect(A, B);
    expect(yDocToDoc(A).nodes.a).toBeUndefined();
  });
});

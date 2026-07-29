import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { Doc } from '../model';
import { ROOT_ID } from '../model';
import { addNode, applyDocToYDoc, applyUpdate, docToYDoc, encodeStateAsUpdate, removeNode, setNodeField, yDocToDoc } from './binding';

function baseDoc(): Doc {
  return {
    v: 1,
    nodes: {
      [ROOT_ID]: { id: ROOT_ID, text: 'Root', emoji: '', parent: null, children: ['a'], collapsed: false, color: null, x: 0, y: 0 },
      a: { id: 'a', text: 'Child A', emoji: '', parent: ROOT_ID, children: [], collapsed: false, color: null, x: 100, y: 0 },
    },
    floats: [{ id: 'f1', x: 10, y: 20, w: 120, text: 'memo' }],
    lines: [{ id: 'l1', x1: 0, y1: 0, x2: 10, y2: 10, startArrow: false, endArrow: true, dashed: false, c1: 0, c2: 0, label: '' }],
    zones: [{ id: 'z1', x: 0, y: 0, w: 50, h: 50, label: 'zone', color: null }],
    layoutMode: 'radial',
    themeKey: 'coral',
  };
}

/** Exchanges the two Y.Docs' updates bidirectionally so both converge. */
function syncBothWays(a: Y.Doc, b: Y.Doc): void {
  const updateFromA = Y.encodeStateAsUpdate(a);
  const updateFromB = Y.encodeStateAsUpdate(b);
  Y.applyUpdate(b, updateFromA);
  Y.applyUpdate(a, updateFromB);
}

describe('docToYDoc / yDocToDoc round-trip', () => {
  it('preserves nodes/floats/lines/zones/layoutMode/themeKey', () => {
    const doc = baseDoc();
    const ydoc = docToYDoc(doc);
    const back = yDocToDoc(ydoc);
    expect(back).toEqual(doc);
  });

  it('round-trips an image float (Float.img data URL — collab sync of attached images)', () => {
    const doc = baseDoc();
    doc.floats = [{ id: 'f1', x: 10, y: 20, w: 260, h: 195, text: '', img: 'data:image/jpeg;base64,QUJDREVG' }];
    const back = yDocToDoc(docToYDoc(doc));
    expect(back.floats).toEqual(doc.floats);
  });

  it('round-trips an empty-ish doc (no floats/lines/zones)', () => {
    const doc: Doc = { v: 1, nodes: { [ROOT_ID]: { id: ROOT_ID, text: 'Root', emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 } }, floats: [], lines: [], zones: [], layoutMode: 'right', themeKey: 'mono' };
    const ydoc = docToYDoc(doc);
    expect(yDocToDoc(ydoc)).toEqual(doc);
  });

  it('applyDocToYDoc(ydoc, next, prev) only touches the diff (unrelated node references are left alone)', () => {
    const doc = baseDoc();
    const ydoc = docToYDoc(doc);
    const next: Doc = { ...doc, nodes: { ...doc.nodes, a: { ...doc.nodes.a!, text: 'Child A renamed' } } };
    applyDocToYDoc(ydoc, next, doc);
    const back = yDocToDoc(ydoc);
    expect(back.nodes.a?.text).toBe('Child A renamed');
    expect(back.nodes[ROOT_ID]).toEqual(doc.nodes[ROOT_ID]);
    expect(back.floats).toEqual(doc.floats);
  });
});

describe('convergence: two Y.Docs, concurrent edits, update exchange', () => {
  it('converges after each peer adds a different node', () => {
    const doc = baseDoc();
    const ydocA = docToYDoc(doc);
    const ydocB = new Y.Doc();
    applyUpdate(ydocB, encodeStateAsUpdate(ydocA)); // B starts from the same base state as A

    addNode(ydocA, 'x1', { id: 'x1', text: 'From A', emoji: '', parent: ROOT_ID, children: [], collapsed: false, color: null, x: 200, y: 0 });
    addNode(ydocB, 'x2', { id: 'x2', text: 'From B', emoji: '', parent: ROOT_ID, children: [], collapsed: false, color: null, x: -200, y: 0 });

    syncBothWays(ydocA, ydocB);

    const resultA = yDocToDoc(ydocA);
    const resultB = yDocToDoc(ydocB);
    expect(resultA).toEqual(resultB);
    expect(resultA.nodes.x1?.text).toBe('From A');
    expect(resultA.nodes.x2?.text).toBe('From B');
  });

  it('converges when both peers edit DIFFERENT fields of the SAME node concurrently (both changes survive)', () => {
    const doc = baseDoc();
    const ydocA = docToYDoc(doc);
    const ydocB = new Y.Doc();
    applyUpdate(ydocB, encodeStateAsUpdate(ydocA));

    setNodeField(ydocA, 'a', 'text', 'Renamed by A');
    setNodeField(ydocB, 'a', 'color', '#ff0000');

    syncBothWays(ydocA, ydocB);

    const resultA = yDocToDoc(ydocA);
    const resultB = yDocToDoc(ydocB);
    expect(resultA).toEqual(resultB);
    expect(resultA.nodes.a?.text).toBe('Renamed by A');
    expect(resultA.nodes.a?.color).toBe('#ff0000');
  });

  it('converges to the SAME (deterministic) value when both peers edit the SAME field of the SAME node concurrently', () => {
    const doc = baseDoc();
    const ydocA = docToYDoc(doc);
    const ydocB = new Y.Doc();
    applyUpdate(ydocB, encodeStateAsUpdate(ydocA));

    setNodeField(ydocA, 'a', 'text', 'A wins?');
    setNodeField(ydocB, 'a', 'text', 'B wins?');

    syncBothWays(ydocA, ydocB);

    const resultA = yDocToDoc(ydocA);
    const resultB = yDocToDoc(ydocB);
    // Convergence, not "A always wins": both peers must agree on ONE value,
    // whichever Yjs's internal (deterministic) tie-break picked.
    expect(resultA).toEqual(resultB);
    expect(['A wins?', 'B wins?']).toContain(resultA.nodes.a?.text);
  });

  it('converges when one peer deletes a node concurrently edited (by field) on the other peer', () => {
    const doc = baseDoc();
    const ydocA = docToYDoc(doc);
    const ydocB = new Y.Doc();
    applyUpdate(ydocB, encodeStateAsUpdate(ydocA));

    removeNode(ydocA, 'a');
    setNodeField(ydocB, 'a', 'text', 'edited concurrently with delete');

    syncBothWays(ydocA, ydocB);

    const resultA = yDocToDoc(ydocA);
    const resultB = yDocToDoc(ydocB);
    expect(resultA).toEqual(resultB);
    // Deterministic either way (deleted or resurrected-with-edit) — the
    // important assertion is that both peers agree.
  });

  it('converges via applyDocToYDoc-driven whole-doc diffs (the editor integration path), not just the low-level per-field helpers', () => {
    const doc = baseDoc();
    const ydocA = docToYDoc(doc);
    const ydocB = new Y.Doc();
    applyUpdate(ydocB, encodeStateAsUpdate(ydocA));

    const nextA: Doc = { ...doc, nodes: { ...doc.nodes, a: { ...doc.nodes.a!, x: 999 } } };
    applyDocToYDoc(ydocA, nextA, doc);

    const nextB: Doc = { ...doc, floats: [...doc.floats, { id: 'f2', x: 5, y: 5, w: 80, text: 'from B' }] };
    applyDocToYDoc(ydocB, nextB, doc);

    syncBothWays(ydocA, ydocB);

    const resultA = yDocToDoc(ydocA);
    const resultB = yDocToDoc(ydocB);
    expect(resultA).toEqual(resultB);
    expect(resultA.nodes.a?.x).toBe(999);
    expect(resultA.floats.some((f) => f.id === 'f2')).toBe(true);
  });
});

// 실제 다중 사용자에서 나온 두 가지 — 둘 다 화면이 눈에 보이게 망가졌다.
describe('부분 병합 상태를 읽어도 그릴 수 있는 문서가 나온다', () => {
  it('필드가 비어 있는 노드도 유효한 Node로 읽는다 (children이 배열이 아니면 레이아웃이 터졌다)', () => {
    const ydoc = docToYDoc(baseDoc());
    // 의존 연산이 아직 도착하지 않아 "타입은 생겼지만 필드는 없는" 노드 — Yjs가 보류
    // 상태일 때 실제로 이런 항목이 관찰된다.
    ydoc.getMap<Y.Map<unknown>>('nodes').set('half', new Y.Map<unknown>());

    const back = yDocToDoc(ydoc);

    expect(Array.isArray(back.nodes.half?.children)).toBe(true);
    expect(back.nodes.half?.id).toBe('half'); // 키에서 복구
    expect(back.nodes.half?.parent).toBeNull();
    expect(back.nodes.half?.text).toBe('');
  });

  it('존재하지 않는 자식 id는 부모의 children에서 떨어낸다', () => {
    const ydoc = docToYDoc(baseDoc());
    setNodeField(ydoc, ROOT_ID, 'children', ['a', '아직-도착하지-않은-노드']);

    expect(yDocToDoc(ydoc).nodes[ROOT_ID]?.children).toEqual(['a']);
  });

  it('두 피어가 같은 메모를 각자 심어도 하나로 읽는다 (Y.Array는 삽입을 병합하지 않는다)', () => {
    const doc = baseDoc();
    const ydocA = docToYDoc(doc);
    const ydocB = docToYDoc(doc); // 같은 문서를 각자 심었다 = 실제 두 기기의 상황
    syncBothWays(ydocA, ydocB);

    expect(ydocA.getArray('floatsOrder').length).toBe(2); // 순서 배열에는 두 번 들어간다
    expect(yDocToDoc(ydocA).floats.map((f) => f.id)).toEqual(['f1']); // 읽으면 하나
    expect(yDocToDoc(ydocB).floats.map((f) => f.id)).toEqual(['f1']);
    expect(yDocToDoc(ydocA)).toEqual(yDocToDoc(ydocB));
  });

  it('각자 심은 두 피어가 이후 편집을 주고받아도 서로 수렴한다', () => {
    const doc = baseDoc();
    const ydocA = docToYDoc(doc);
    const ydocB = docToYDoc(doc);
    syncBothWays(ydocA, ydocB); // 합류 시 전체 상태 교환(전송 계층이 하는 일)

    addNode(ydocA, 'fromA', { id: 'fromA', text: 'A', emoji: '', parent: ROOT_ID, children: [], collapsed: false, color: null, x: 1, y: 1 });
    addNode(ydocB, 'fromB', { id: 'fromB', text: 'B', emoji: '', parent: ROOT_ID, children: [], collapsed: false, color: null, x: 2, y: 2 });
    syncBothWays(ydocA, ydocB);

    expect(Object.keys(yDocToDoc(ydocA).nodes).sort()).toEqual([ROOT_ID, 'a', 'fromA', 'fromB'].sort());
    expect(yDocToDoc(ydocA)).toEqual(yDocToDoc(ydocB));
  });
});

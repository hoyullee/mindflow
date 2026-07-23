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

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { layout } from './layout';
import { parseDoc } from './serialize';
import type { Doc, LayoutMode, Node, NodeMap } from './model';
import type { SizeOf } from './layout';

const fixture = (relPath: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL('../test/fixtures/' + relPath, import.meta.url)), 'utf8')) as unknown;

interface SizeFixtureEntry {
  depth: number;
  w: number;
  h: number;
}

const rawDocMixed = fixture('input/doc-mixed.json');
const sizes = fixture('golden/node-sizes.json') as Record<string, SizeFixtureEntry>;
const goldenRadial = fixture('golden/layout-radial.json') as { nodes: NodeMap };
const goldenRight = fixture('golden/layout-right.json') as { nodes: NodeMap };
const goldenDown = fixture('golden/layout-down.json') as { nodes: NodeMap };

// Reproduces `Component#metrics(node, depth) -> {w,h}` for the fixture nodes
// (test/fixtures/golden/node-sizes.json — captured from the live controller).
// The task's suggested minimal form: `(node) => ({ w: sizes[node.id].w, h: sizes[node.id].h })`.
const sizeOf: SizeOf = (node: Node) => {
  const entry = sizes[node.id];
  if (!entry) throw new Error(`no fixture size for node "${node.id}"`);
  return { w: entry.w, h: entry.h };
};

function loadDocMixed(): Doc {
  const doc = parseDoc(rawDocMixed);
  if (!doc) throw new Error('failed to parse doc-mixed fixture');
  return doc;
}

function deepCloneNodes(nodes: NodeMap): NodeMap {
  return JSON.parse(JSON.stringify(nodes)) as NodeMap;
}

function expectCoordsMatch(actual: NodeMap, golden: NodeMap, ids: string[]): void {
  for (const id of ids) {
    const a = actual[id];
    const g = golden[id];
    expect(a, `expected actual node "${id}" to exist`).toBeDefined();
    expect(g, `expected golden node "${id}" to exist`).toBeDefined();
    expect(a!.x).toBeCloseTo(g!.x, 6);
    expect(a!.y).toBeCloseTo(g!.y, 6);
  }
}

const ALL_IDS = ['root', 'c1', 'c2', 'c3', 'g1', 'g2', 'g3', 'free1'];

describe('layout — coordinate parity against the dc-prototype goldens', () => {
  // NOTE on provenance (see tools/capture-golden.mjs:85-96): the golden
  // layout-{right,down}.json fixtures were captured by clicking through
  // setLayout('radial') → setLayout('right') → setLayout('down') on the SAME
  // live component state, in that order. `_layout` never clears a node's
  // `side` field (mode 'right' doesn't touch it at all; mode 'down' doesn't
  // reference it either) — it only gets written by the non-'right' branch of
  // the radial/right code path (MindFlow.dc.html:1037-1042). So the `side`
  // values baked into layout-right.json / layout-down.json are LEFTOVERS
  // from that prior radial pass, not something 'right'/'down' compute
  // themselves. To reproduce the goldens' `side` values exactly (not just
  // x/y), this suite chains the calls the same way the capture script did.
  const doc = loadDocMixed();

  const radialNodes = layout(doc, 'radial', sizeOf);
  const docAfterRadial: Doc = { ...doc, nodes: radialNodes, layoutMode: 'radial' };
  const rightNodes = layout(docAfterRadial, 'right', sizeOf);
  const docAfterRight: Doc = { ...docAfterRadial, nodes: rightNodes, layoutMode: 'right' };
  const downNodes = layout(docAfterRight, 'down', sizeOf);

  it('radial: matches golden/layout-radial.json x/y for every node', () => {
    expectCoordsMatch(radialNodes, goldenRadial.nodes, ALL_IDS);
  });

  it('radial: matches golden side assignment (fresh balance: c1 R, c2 L, c3 L)', () => {
    expect(radialNodes.c1?.side).toBe(goldenRadial.nodes.c1?.side);
    expect(radialNodes.c2?.side).toBe(goldenRadial.nodes.c2?.side);
    expect(radialNodes.c3?.side).toBe(goldenRadial.nodes.c3?.side);
    expect(radialNodes.c1?.side).toBe('R');
    expect(radialNodes.c2?.side).toBe('L');
    expect(radialNodes.c3?.side).toBe('L');
  });

  it("right (chained after radial): matches golden/layout-right.json x/y for every node", () => {
    expectCoordsMatch(rightNodes, goldenRight.nodes, ALL_IDS);
  });

  it("right (chained after radial): matches golden's leftover side field", () => {
    expect(rightNodes.c1?.side).toBe(goldenRight.nodes.c1?.side);
    expect(rightNodes.c2?.side).toBe(goldenRight.nodes.c2?.side);
    expect(rightNodes.c3?.side).toBe(goldenRight.nodes.c3?.side);
  });

  it("down (chained after radial+right): matches golden/layout-down.json x/y for every node", () => {
    expectCoordsMatch(downNodes, goldenDown.nodes, ALL_IDS);
  });

  it("down (chained after radial+right): matches golden's leftover side field", () => {
    expect(downNodes.c1?.side).toBe(goldenDown.nodes.c1?.side);
    expect(downNodes.c2?.side).toBe(goldenDown.nodes.c2?.side);
    expect(downNodes.c3?.side).toBe(goldenDown.nodes.c3?.side);
  });
});

describe('layout — a fresh (non-chained) call per mode', () => {
  // Coordinates are fully re-derived from tree shape + sizeOf on every call
  // (they never consult a node's pre-existing x/y), so x/y parity holds even
  // starting from the untouched fixture doc, independent of any prior mode.
  it.each<[LayoutMode, { nodes: NodeMap }]>([
    ['radial', goldenRadial],
    ['right', goldenRight],
    ['down', goldenDown],
  ])('%s: x/y matches the golden regardless of side history', (mode, golden) => {
    const fresh = loadDocMixed();
    const out = layout(fresh, mode, sizeOf);
    expectCoordsMatch(out, golden.nodes, ALL_IDS);
  });

  it("right on a fresh doc (no prior side) leaves side unset — 'right' mode never assigns it (MindFlow.dc.html:1034-1035)", () => {
    const fresh = loadDocMixed();
    const out = layout(fresh, 'right', sizeOf);
    expect(out.c1?.side).toBeUndefined();
    expect(out.c2?.side).toBeUndefined();
    expect(out.c3?.side).toBeUndefined();
  });

  it("down on a fresh doc (no prior side) leaves side unset — 'down' mode never reads/writes it (MindFlow.dc.html:984-1003)", () => {
    const fresh = loadDocMixed();
    const out = layout(fresh, 'down', sizeOf);
    expect(out.c1?.side).toBeUndefined();
    expect(out.c2?.side).toBeUndefined();
    expect(out.c3?.side).toBeUndefined();
  });
});

describe('layout — free-node passthrough', () => {
  it.each<LayoutMode>(['radial', 'right', 'down'])(
    'free1 (a free shape with no children) keeps its input coordinates (260,-160) unchanged in %s mode',
    (mode) => {
      const fresh = loadDocMixed();
      const out = layout(fresh, mode, sizeOf);
      expect(out.free1?.x).toBe(260);
      expect(out.free1?.y).toBe(-160);
      expect(out.free1?.free).toBe(true);
    },
  );
});

describe('layout — immutability', () => {
  it.each<LayoutMode>(['radial', 'right', 'down'])('does not mutate the input doc in %s mode', (mode) => {
    const fresh = loadDocMixed();
    const before = deepCloneNodes(fresh.nodes);

    const out = layout(fresh, mode, sizeOf);

    // input untouched
    expect(fresh.nodes).toEqual(before);
    // and the returned map is a distinct object graph, not the same references
    expect(out).not.toBe(fresh.nodes);
    for (const id of ALL_IDS) {
      expect(out[id]).not.toBe(fresh.nodes[id]);
    }
  });

  it('never throws when the input nodes are frozen (proves no direct mutation is even attempted)', () => {
    const fresh = loadDocMixed();
    for (const id of Object.keys(fresh.nodes)) {
      Object.freeze(fresh.nodes[id]);
    }
    Object.freeze(fresh.nodes);
    expect(() => layout(fresh, 'radial', sizeOf)).not.toThrow();
  });
});

describe('layout — root anchor (opts.rootAnchor, promoted from the hidden `this._rootAnchor`)', () => {
  it('defaults to {x:0,y:0} — root lands at the origin when no anchor is given (MindFlow.dc.html:1049)', () => {
    const fresh = loadDocMixed();
    const out = layout(fresh, 'radial', sizeOf);
    expect(out.root?.x).toBe(0);
    expect(out.root?.y).toBe(0);
  });

  it('pins the root to the given anchor and translates every non-free node by the same delta (MindFlow.dc.html:1048-1052)', () => {
    const fresh = loadDocMixed();
    const anchor = { x: 40, y: -25 };
    const out = layout(fresh, 'radial', sizeOf, { rootAnchor: anchor });
    const baseline = layout(fresh, 'radial', sizeOf);

    expect(out.root?.x).toBe(anchor.x);
    expect(out.root?.y).toBe(anchor.y);
    for (const id of ['c1', 'c2', 'c3', 'g1', 'g2', 'g3']) {
      expect(out[id]?.x).toBeCloseTo((baseline[id]?.x ?? 0) + anchor.x, 6);
      expect(out[id]?.y).toBeCloseTo((baseline[id]?.y ?? 0) + anchor.y, 6);
    }
  });

  it('does NOT translate free-standing shapes (they are excluded from the root-pin shift, MindFlow.dc.html:1050-1052)', () => {
    const fresh = loadDocMixed();
    const out = layout(fresh, 'radial', sizeOf, { rootAnchor: { x: 500, y: 500 } });
    expect(out.free1?.x).toBe(260);
    expect(out.free1?.y).toBe(-160);
  });
});

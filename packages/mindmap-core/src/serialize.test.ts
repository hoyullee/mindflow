import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cloneNodes, parseDoc, serializeDoc } from './serialize';
import type { NodeMap } from './model';

const fixture = (relPath: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL('../test/fixtures/' + relPath, import.meta.url)), 'utf8')) as unknown;

describe('parseDoc', () => {
  it('parses the mixed fixture into a Doc', () => {
    const raw = fixture('input/doc-mixed.json');
    const doc = parseDoc(raw);
    expect(doc).not.toBeNull();
    expect(doc?.v).toBe(1);
    expect(Object.keys(doc?.nodes ?? {})).toEqual(['root', 'c1', 'c2', 'c3', 'g1', 'g2', 'g3', 'free1']);
    expect(doc?.floats).toHaveLength(1);
    expect(doc?.lines).toHaveLength(1);
    expect(doc?.zones).toHaveLength(1);
    expect(doc?.layoutMode).toBe('radial');
    expect(doc?.themeKey).toBe('coral');
  });

  it('round-trips through serializeDoc into the golden serialize-roundtrip.json (structural parity)', () => {
    const raw = fixture('input/doc-mixed.json');
    const golden = fixture('golden/serialize-roundtrip.json');
    const doc = parseDoc(raw);
    expect(doc).not.toBeNull();
    const out = serializeDoc(doc!);
    expect(out).toEqual(golden);
  });

  it('returns null for input with no nodes field (loadDoc: `if (!d || !d.nodes) return false`, MindFlow.dc.html:795)', () => {
    expect(parseDoc({})).toBeNull();
    expect(parseDoc({ floats: [] })).toBeNull();
    expect(parseDoc(null)).toBeNull();
    expect(parseDoc('not an object')).toBeNull();
    expect(parseDoc(42)).toBeNull();
  });

  it('defaults missing floats/lines/zones to [] and layoutMode/themeKey to buildInitial defaults (MindFlow.dc.html:495-496, 522-523, 797-801)', () => {
    const doc = parseDoc({ nodes: { root: { id: 'root', text: 'x', emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 } } });
    expect(doc).not.toBeNull();
    expect(doc?.floats).toEqual([]);
    expect(doc?.lines).toEqual([]);
    expect(doc?.zones).toEqual([]);
    expect(doc?.layoutMode).toBe('radial');
    expect(doc?.themeKey).toBe('coral');
    expect(doc?.edgeStyle).toBe('curve');
  });

  it('keeps a provided edgeStyle and round-trips it (MindFlow.dc.html:549, 576)', () => {
    const doc = parseDoc({ nodes: { root: { id: 'root', text: 'x', emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 } }, edgeStyle: 'elbow' });
    expect(doc?.edgeStyle).toBe('elbow');
    expect(serializeDoc(doc!).edgeStyle).toBe('elbow');
  });

  it('keeps provided floats/lines/zones/layoutMode/themeKey as-is when present', () => {
    const doc = parseDoc({
      nodes: { root: { id: 'root', text: 'x', emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 } },
      floats: [{ id: 'f1', x: 0, y: 0, w: 10, text: 't' }],
      lines: [],
      zones: [],
      layoutMode: 'down',
      themeKey: 'grape',
    });
    expect(doc?.layoutMode).toBe('down');
    expect(doc?.themeKey).toBe('grape');
    expect(doc?.floats).toHaveLength(1);
  });
});

describe('parseDoc/serializeDoc — line anchors (a1/a2)', () => {
  it('round-trips a1/a2 through parseDoc → serializeDoc unchanged', () => {
    const raw = {
      nodes: { root: { id: 'root', text: 'x', emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 } },
      floats: [],
      lines: [
        {
          id: 'l1',
          x1: 0,
          y1: 0,
          x2: 100,
          y2: 100,
          startArrow: false,
          endArrow: true,
          dashed: false,
          c1: 0,
          c2: 0,
          label: '',
          a1: { kind: 'node', id: 'root', side: 'right' },
          a2: null,
        },
      ],
      zones: [],
      layoutMode: 'radial',
      themeKey: 'coral',
    };
    const doc = parseDoc(raw);
    expect(doc).not.toBeNull();
    expect(doc?.lines[0]?.a1).toEqual({ kind: 'node', id: 'root', side: 'right' });
    expect(doc?.lines[0]?.a2).toBeNull();
    const out = serializeDoc(doc!);
    expect(out.lines[0]?.a1).toEqual({ kind: 'node', id: 'root', side: 'right' });
    expect(out.lines[0]?.a2).toBeNull();
  });

  it('leaves lines without a1/a2 unchanged (no field introduced) — golden fixture stays parity-safe', () => {
    const raw = {
      nodes: { root: { id: 'root', text: 'x', emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 } },
      lines: [{ id: 'l1', x1: 0, y1: 0, x2: 1, y2: 1, startArrow: false, endArrow: true, dashed: false, c1: 0, c2: 0, label: '' }],
    };
    const doc = parseDoc(raw);
    expect(doc?.lines[0]).not.toHaveProperty('a1');
    expect(doc?.lines[0]).not.toHaveProperty('a2');
    const out = serializeDoc(doc!);
    expect(out.lines[0]).toEqual(raw.lines[0]);
  });
});

describe('serializeDoc', () => {
  it('does not deep-clone — returns the same references it was given (MindFlow.dc.html:534-536)', () => {
    const nodes: NodeMap = { root: { id: 'root', text: 't', emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 } };
    const floats = [{ id: 'f1', x: 0, y: 0, w: 10, text: '' }];
    const lines = [{ id: 'l1', x1: 0, y1: 0, x2: 1, y2: 1, startArrow: false, endArrow: true, dashed: false, c1: 0, c2: 0, label: '' }];
    const out = serializeDoc({ nodes, floats, lines, zones: null, layoutMode: 'radial', themeKey: 'coral' });
    expect(out.nodes).toBe(nodes);
    expect(out.floats).toBe(floats);
    expect(out.lines).toBe(lines);
    expect(out.zones).toEqual([]);
  });
});

describe('cloneNodes', () => {
  it('shallow-clones each node and its children array (MindFlow.dc.html:884)', () => {
    const nodes: NodeMap = {
      root: { id: 'root', text: 't', emoji: '', parent: null, children: ['a'], collapsed: false, color: null, x: 0, y: 0 },
      a: { id: 'a', text: 'a', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0, rich: [{ t: 'a' }] },
    };
    const clone = cloneNodes(nodes);

    expect(clone).toEqual(nodes);
    expect(clone).not.toBe(nodes);
    expect(clone.root).not.toBe(nodes.root);
    expect(clone.root?.children).not.toBe(nodes.root?.children);

    // top-level mutation on the clone must not affect the original
    clone.root!.text = 'mutated';
    expect(nodes.root?.text).toBe('t');
    clone.root!.children.push('b');
    expect(nodes.root?.children).toEqual(['a']);

    // nested structures (e.g. `rich`) are NOT deep-cloned — shared reference
    expect(clone.a?.rich).toBe(nodes.a?.rich);
  });

  it('returns an empty object for an empty node map', () => {
    expect(cloneNodes({})).toEqual({});
  });
});

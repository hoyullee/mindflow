// Extra parity/coverage tests closing the gaps flagged by the M1a QA audit:
//  1. persisted style fields (Node.tsize; Float bg/bold/collapsed/textColor/tsize/h;
//     Line color/curve/ltextColor/lbold/lsize) survive serialize→parse→clone.
//  2. toMarkdown walks a collapsed node's children (parity with exportOutline,
//     which uses raw n.children, not the collapse-filtered visKids).
//  3. toMarkdown on an empty / root-less tree returns '' without throwing.
//  4. HistoryStack coalesce boundary: exactly coalesceWindowMs does NOT coalesce
//     (original uses strict `< 1200`, MindFlow.dc.html:557).
import { describe, expect, it } from 'vitest';
import { cloneNodes, parseDoc, serializeDoc } from './serialize';
import { toMarkdown } from './markdown';
import { HistoryStack } from './history';
import type { Clock } from './ports';
import type { Doc } from './model';

describe('M1a parity — persisted style fields survive round-trip', () => {
  const styled: Doc = {
    v: 1,
    nodes: {
      root: { id: 'root', text: 'R', emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0, bold: true, tsize: 'l' },
    },
    floats: [{ id: 'f1', x: 0, y: 0, w: 180, h: 90, text: '메모', collapsed: true, bg: '#fff0e8', bold: true, textColor: '#33281f', tsize: 's' }],
    lines: [{ id: 'l1', x1: 0, y1: 0, x2: 10, y2: 10, startArrow: true, endArrow: false, dashed: false, c1: 0, c2: 0, label: 'x', color: '#3f8fd0', curve: 40, ltextColor: '#d9542f', lbold: true, lsize: 'l' }],
    zones: [{ id: 'z1', x: 0, y: 0, w: 100, h: 100, label: 'Z', color: '#eee' }],
    layoutMode: 'radial',
    themeKey: 'coral',
    edgeStyle: 'elbow',
  };

  it('parseDoc(serializeDoc(...)) preserves every style field through JSON', () => {
    const round = parseDoc(JSON.parse(JSON.stringify(serializeDoc(styled))));
    expect(round).toEqual(styled);
  });

  it('cloneNodes preserves node style fields (tsize/bold)', () => {
    const clone = cloneNodes(styled.nodes);
    expect(clone.root?.tsize).toBe('l');
    expect(clone.root?.bold).toBe(true);
  });
});

describe('M1a parity — toMarkdown edge cases', () => {
  it('includes children of a collapsed node (raw children walk, not visKids)', () => {
    const doc = parseDoc({
      nodes: {
        root: { id: 'root', text: 'R', emoji: '', parent: null, children: ['a'], collapsed: true, color: null, x: 0, y: 0 },
        a: { id: 'a', text: 'child', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0 },
      },
    });
    expect(doc).not.toBeNull();
    expect(toMarkdown(doc!)).toBe('# R\n- child');
  });

  it('returns empty string for a root-less / empty tree without throwing', () => {
    const doc = parseDoc({ nodes: {} });
    expect(doc).not.toBeNull();
    expect(toMarkdown(doc!)).toBe('');
  });
});

class FakeClock implements Clock {
  private t = 0;
  now(): number {
    return this.t;
  }
  set(ms: number): void {
    this.t = ms;
  }
}

describe('HistoryStack — coalesce boundary', () => {
  it('does NOT coalesce when the gap equals coalesceWindowMs exactly (strict `<`)', () => {
    const clock = new FakeClock();
    const hs = new HistoryStack<string>(clock, { coalesceWindowMs: 1200 });
    clock.set(0);
    hs.reset('s0');
    clock.set(100);
    hs.record('s1', true); // seeds a continuous edit at t=100
    clock.set(1300); // gap from t=100 is exactly 1200 == window → must NOT coalesce
    hs.record('s2', true);
    // Two distinct undo steps must exist: s2 -> s1 -> s0
    expect(hs.undo()).toBe('s1');
    expect(hs.undo()).toBe('s0');
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { realPreview } from './mapPreview';

afterEach(cleanup);

// Saved docs persist layout-derived node x/y as 0 (the React editor keeps layout
// pure/derived and never writes positions back). `realPreview` must re-run the
// core layout so the thumbnail reflects the real node arrangement instead of
// piling every node at the origin — the bug that made every card look identical.
describe('realPreview', () => {
  const doc = {
    v: 1,
    nodes: {
      root: { id: 'root', text: '루트', emoji: '', parent: null, children: ['a', 'b', 'c'], collapsed: false, color: null, x: 0, y: 0 },
      a: { id: 'a', text: '가지A', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0 },
      b: { id: 'b', text: '가지B', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0 },
      c: { id: 'c', text: '가지C', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0 },
    },
    floats: [],
    lines: [],
    zones: [],
    layoutMode: 'right',
    themeKey: 'coral',
  };

  it('re-lays out nodes so they are spread apart, not stacked at the origin', () => {
    const el = realPreview(JSON.stringify(doc), '#f0663f');
    expect(el).not.toBeNull();
    const { container } = render(el!);

    // every node label rendered
    const texts = Array.from(container.querySelectorAll('svg text')) as SVGTextElement[];
    const labels = texts.map((t) => t.textContent);
    expect(labels).toEqual(expect.arrayContaining(['루트', '가지A', '가지B', '가지C']));

    // node rects must occupy distinct coordinates — if layout hadn't run they'd
    // all sit at x/y 0 (identical). `right` layout puts children to the right of
    // (and vertically spread from) the root, so both x and y vary.
    const rects = Array.from(container.querySelectorAll('svg rect')) as SVGRectElement[];
    const xs = new Set(rects.map((r) => r.getAttribute('x')));
    const ys = new Set(rects.map((r) => r.getAttribute('y')));
    expect(xs.size).toBeGreaterThan(1);
    expect(ys.size).toBeGreaterThan(1);
  });

  it('uses theme-aware default text colors (dark theme: accentInk root, light body)', () => {
    const dark = {
      v: 1,
      themeKey: 'dark',
      layoutMode: 'right',
      nodes: {
        root: { id: 'root', text: '루트', emoji: '', parent: null, children: ['a'], collapsed: false, color: null, x: 0, y: 0 },
        a: { id: 'a', text: '노드', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0 },
      },
      floats: [],
      lines: [],
      zones: [],
    };
    const { container } = render(realPreview(JSON.stringify(dark), '#f0663f')!);
    const byLabel = Object.fromEntries(Array.from(container.querySelectorAll('svg text')).map((t) => [t.textContent, t.getAttribute('fill')]));
    // dark theme: root text = accentInk (#1b1712), body text = theme text (#f3ece4)
    // — previously hardcoded to #fff / #33281f (wrong on a dark-theme map).
    expect(byLabel['루트']).toBe('#1b1712');
    expect(byLabel['노드']).toBe('#f3ece4');
  });

  it('renders partial rich-text runs (per-span bold/color)', () => {
    const doc = {
      v: 1,
      themeKey: 'coral',
      layoutMode: 'right',
      nodes: {
        root: { id: 'root', text: '중심', emoji: '', parent: null, children: ['b'], collapsed: false, color: null, x: 0, y: 0 },
        b: {
          id: 'b',
          text: '리치텍스트',
          emoji: '',
          parent: 'root',
          children: [],
          collapsed: false,
          color: null,
          rich: [
            { t: '리치', b: true, c: '#d0568f' },
            { t: '텍스트' },
          ],
          x: 0,
          y: 0,
        },
      },
      floats: [],
      lines: [],
      zones: [],
    };
    const { container } = render(realPreview(JSON.stringify(doc), '#f0663f')!);
    const tspans = Array.from(container.querySelectorAll('svg tspan')).map((s) => ({ t: s.textContent, fill: s.getAttribute('fill'), fw: s.getAttribute('font-weight') }));
    expect(tspans).toEqual([
      { t: '리치', fill: '#d0568f', fw: '800' },
      { t: '텍스트', fill: null, fw: null },
    ]);
  });

  it('reflects the connector style (edgeStyle) in the drawn edge path', () => {
    // Two children so at least one lands off the parent's y — an elbow only bends
    // (drawing a rounded `Q` corner) when there's a vertical offset to turn through.
    const mk = (edgeStyle: string) => ({
      v: 1,
      themeKey: 'coral',
      layoutMode: 'right',
      edgeStyle,
      nodes: {
        root: { id: 'root', text: '중심', emoji: '', parent: null, children: ['a', 'b'], collapsed: false, color: null, x: 0, y: 0 },
        a: { id: 'a', text: '가지A', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0 },
        b: { id: 'b', text: '가지B', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0 },
      },
      floats: [],
      lines: [],
      zones: [],
    });
    const edgeDs = (edgeStyle: string): string[] => {
      const { container } = render(realPreview(JSON.stringify(mk(edgeStyle)), '#f0663f')!);
      // parent→child connectors are the paths drawn with fill="none"
      return Array.from(container.querySelectorAll('svg path'))
        .filter((el) => el.getAttribute('fill') === 'none')
        .map((el) => el.getAttribute('d') ?? '');
    };
    // straight = line segments (no C/Q); elbow = right-angle with a rounded (Q)
    // corner; curve = cubic bezier (C). Previously every style drew a cubic curve.
    const straight = edgeDs('straight');
    expect(straight.length).toBeGreaterThan(0);
    expect(straight.every((d) => d.includes(' L ') && !d.includes('C') && !d.includes('Q'))).toBe(true);
    expect(edgeDs('elbow').some((d) => d.includes('Q'))).toBe(true);
    expect(edgeDs('curve').every((d) => d.includes('C'))).toBe(true);
  });

  it('returns null for a doc with no nodes so the caller falls back to miniPreview', () => {
    expect(realPreview(JSON.stringify({ v: 1, nodes: {}, floats: [], lines: [], zones: [], layoutMode: 'radial', themeKey: 'coral' }), '#f0663f')).toBeNull();
    expect(realPreview(null, '#f0663f')).toBeNull();
    expect(realPreview('not json', '#f0663f')).toBeNull();
  });
});

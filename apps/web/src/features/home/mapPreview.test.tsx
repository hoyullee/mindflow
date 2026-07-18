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

  it('returns null for a doc with no nodes so the caller falls back to miniPreview', () => {
    expect(realPreview(JSON.stringify({ v: 1, nodes: {}, floats: [], lines: [], zones: [], layoutMode: 'radial', themeKey: 'coral' }), '#f0663f')).toBeNull();
    expect(realPreview(null, '#f0663f')).toBeNull();
    expect(realPreview('not json', '#f0663f')).toBeNull();
  });
});

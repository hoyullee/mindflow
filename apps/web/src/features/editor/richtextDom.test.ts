import { describe, expect, it } from 'vitest';
import { domToRuns, escHtml, linearize, rgbToHex, runsToHtml } from './richtextDom';

// DOM-facing rich-text helpers (`richtextDom.ts`, port of MindFlow.dc.html:2558-2698).
// Per CLAUDE.md's task brief: jsdom's `Selection`/`Range` support is limited, so
// `setLinearSelection` (which drives a real DOM Selection) isn't unit-tested here —
// it's exercised indirectly by the contentEditable interaction tests in
// `Editor.interactions.test.tsx` instead. `domToRuns`/`runsToHtml`/`linearize` only
// need `childNodes`/`nodeType`/inline styles, which jsdom supports fully.

describe('escHtml / rgbToHex', () => {
  it('escapes &, <, > only', () => {
    expect(escHtml('a & b <c> "d"')).toBe('a &amp; b &lt;c&gt; "d"');
  });

  it('rgbToHex passes an already-hex color through unchanged', () => {
    expect(rgbToHex('#3f8fd0')).toBe('#3f8fd0');
  });

  it('rgbToHex converts rgb(...) to #rrggbb', () => {
    expect(rgbToHex('rgb(63, 143, 208)')).toBe('#3f8fd0');
  });

  it('rgbToHex converts rgba(...) (ignoring alpha) to #rrggbb', () => {
    expect(rgbToHex('rgba(0, 0, 0, 0.5)')).toBe('#000000');
  });

  it('rgbToHex returns null for an unparseable/empty color', () => {
    expect(rgbToHex('')).toBeNull();
    expect(rgbToHex('transparent')).toBeNull();
  });
});

describe('runsToHtml', () => {
  it('renders plain text (no rich) with newlines as <br>, HTML-escaped', () => {
    expect(runsToHtml({ text: 'a & b\nc' })).toBe('a &amp; b<br>c');
  });

  it('renders bold+color runs as styled spans', () => {
    const html = runsToHtml({ text: 'hi', rich: [{ t: 'hi', b: true, c: '#f0663f' }] });
    expect(html).toBe('<span style="font-weight:800;color:#f0663f;">hi</span>');
  });

  it('renders an unstyled run (no b/c) with no wrapping span', () => {
    const html = runsToHtml({ text: 'ab', rich: [{ t: 'ab', b: false, c: null }] });
    expect(html).toBe('ab');
  });

  it('an empty rich array falls back to plain text', () => {
    expect(runsToHtml({ text: 'x', rich: [] })).toBe('x');
  });
});

describe('domToRuns', () => {
  function el(html: string): HTMLElement {
    const div = document.createElement('div');
    div.innerHTML = html;
    return div;
  }

  it('reads plain text with no styling as an unstyled result (rich: null)', () => {
    const out = domToRuns(el('hello world'));
    expect(out).toEqual({ text: 'hello world', rich: null });
  });

  it('reads a <span style="font-weight:800"> as a bold run', () => {
    const out = domToRuns(el('hello <span style="font-weight:800">world</span>'));
    expect(out.text).toBe('hello world');
    expect(out.rich).toEqual([
      { t: 'hello ', b: false, c: null },
      { t: 'world', b: true, c: null },
    ]);
  });

  it('reads <b>/<strong> as bold', () => {
    const out = domToRuns(el('<b>hi</b> <strong>there</strong>'));
    expect(out.rich).toEqual([
      { t: 'hi', b: true, c: null },
      { t: ' ', b: false, c: null },
      { t: 'there', b: true, c: null },
    ]);
  });

  it('reads style.color as a hex color run', () => {
    const out = domToRuns(el('<span style="color:#3f8fd0">blue</span>'));
    expect(out.rich).toEqual([{ t: 'blue', b: false, c: '#3f8fd0' }]);
  });

  it('treats <br> as a newline', () => {
    const out = domToRuns(el('a<br>b'));
    expect(out.text).toBe('a\nb');
    expect(out.rich).toBeNull();
  });

  it('treats a DIV/P boundary as an implicit newline', () => {
    const out = domToRuns(el('<div>a</div><div>b</div>'));
    expect(out.text).toBe('a\nb');
  });

  it('trims trailing newlines by default (keepTrailing=false)', () => {
    const out = domToRuns(el('a<br><br>'));
    expect(out.text).toBe('a');
  });

  it('keepTrailing collapses exactly one trailing newline (contentEditable\'s placeholder <br>)', () => {
    const out = domToRuns(el('a<br>'), true);
    expect(out.text).toBe('a');
  });

  it('merges adjacent same-style text nodes/spans into one run', () => {
    const out = domToRuns(el('<span style="font-weight:800">ab</span><span style="font-weight:800">cd</span>'));
    expect(out.rich).toEqual([{ t: 'abcd', b: true, c: null }]);
  });
});

describe('linearize', () => {
  it('resolves a text-node offset to its position in the reconstructed text', () => {
    const div = document.createElement('div');
    div.innerHTML = 'hello world';
    const textNode = div.firstChild!;
    const { text, pos } = linearize(div, [{ container: textNode, offset: 6 }]);
    expect(text).toBe('hello world');
    expect(pos).toEqual([6]);
  });

  it('resolves an offset inside a styled span, accounting for text before it', () => {
    const div = document.createElement('div');
    div.innerHTML = 'hello <span style="font-weight:800">world</span>';
    const span = div.querySelector('span')!;
    const spanText = span.firstChild!;
    const { text, pos } = linearize(div, [{ container: spanText, offset: 2 }]);
    expect(text).toBe('hello world');
    expect(pos).toEqual([8]); // "hello " (6) + 2 into "world"
  });

  it('a mark past the end of its container resolves to the total text length', () => {
    const div = document.createElement('div');
    div.innerHTML = 'hi';
    const { pos } = linearize(div, [{ container: div, offset: 99 }]);
    expect(pos).toEqual([2]);
  });
});

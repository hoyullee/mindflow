import { describe, expect, it } from 'vitest';
import { domToRuns, escHtml, linearize, rgbToHex, runsToHtml, setLinearSelection } from './richtextDom';

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

// ── 마크다운 서식 확장(post-dc): 기울임(i)·취소선(s) 라운드트립 ─────────────
describe('runsToHtml / domToRuns — 기울임·취소선', () => {
  it('runsToHtml이 i/s 런을 스타일 span으로 렌더한다', () => {
    const html = runsToHtml({ text: 'ab', rich: [{ t: 'a', b: false, c: null, i: true }, { t: 'b', b: false, c: null, s: true }] });
    expect(html).toBe('<span style="font-style:italic;">a</span><span style="text-decoration:line-through;">b</span>');
  });

  it('domToRuns가 EM/I·S/DEL 태그와 인라인 스타일을 i/s로 읽는다', () => {
    const div = document.createElement('div');
    div.innerHTML = '평문 <em>기울임</em> <s>취소</s> <span style="font-style:italic">스타일</span>';
    const out = domToRuns(div);
    expect(out.rich).toEqual([
      { t: '평문 ', b: false, c: null },
      { t: '기울임', b: false, c: null, i: true },
      { t: ' ', b: false, c: null },
      { t: '취소', b: false, c: null, s: true },
      { t: ' ', b: false, c: null },
      { t: '스타일', b: false, c: null, i: true },
    ]);
  });

  it('runsToHtml → domToRuns 라운드트립이 i/s를 보존한다', () => {
    const rich = [
      { t: '굵고기울임', b: true, c: null, i: true },
      { t: ' 취소색', b: false, c: '#d92626', s: true },
    ];
    const div = document.createElement('div');
    div.innerHTML = runsToHtml({ text: '굵고기울임 취소색', rich });
    expect(domToRuns(div).rich).toEqual(rich);
  });
});


describe('링크 파랑은 모델로 새지 않는다', () => {
  it('크롬이 타이핑 자리에 굳혀 넣은 링크색을 무시한다 (span·font 양쪽)', () => {
    // 링크 글자를 통째로 지우고 새로 타이핑하면 크롬이 그 자리의 계산된 색을
    // 굳혀 넣는다(typing style) — 실브라우저에서 `<font color="#1a63d8"><u>X</u></font>`
    // 형태로 재현. 그대로 읽으면 링크를 떼도 파란 글자만 남는다.
    const el = document.createElement('div');
    el.innerHTML = `<span style="color: rgb(26, 99, 216)">타이핑</span>`;
    expect(domToRuns(el).rich).toBeNull();

    const el2 = document.createElement('div');
    el2.innerHTML = `<font color="#1a63d8"><u>X</u></font>`;
    expect(domToRuns(el2).rich).toBeNull();
  });

  it('사용자가 고른 스와치 색은 그대로 저장한다', () => {
    const el = document.createElement('div');
    el.innerHTML = `<span style="color: rgb(217, 38, 38)">빨강</span>`;
    expect(domToRuns(el).rich).toEqual([{ t: '빨강', b: false, c: '#d92626' }]);
  });
});


describe('setLinearSelection — 블록 줄바꿈 계산이 linearize와 같아야 한다', () => {
  // 빈 줄(`<div><br></div>`)이 있으면 예전엔 오프셋이 1씩 밀렸다: 블록마다 무조건
  // 줄바꿈 1을 더했기 때문(앞이 이미 줄바꿈이면 더하지 않는 linearize·domToRuns와 불일치).
  // 그래서 빈 줄 뒤에 새 리스트를 만들면 캐럿이 마커 **안**에 떨어져 다음 글자가 마커를 부쉈다.
  it('빈 줄 뒤 블록의 오프셋이 linearize와 일치한다', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    el.innerHTML = `<div>가나</div><div><br></div><div>다라</div>`;
    // 값 기준 텍스트: "가나\n\n다라" — '다' 앞은 4, '라' 앞은 5
    expect(domToRuns(el, true).text).toBe('가나\n\n다라');
    setLinearSelection(el, 5, 5);
    const sel = window.getSelection()!;
    const r = sel.getRangeAt(0);
    const back = linearize(el, [{ container: r.startContainer, offset: r.startOffset }]);
    expect(back.pos[0]).toBe(5);
    el.remove();
  });

  it('빈 줄이 여러 개여도 어긋나지 않는다', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    el.innerHTML = `<div>가</div><div><br></div><div><br></div><div>나다</div>`;
    expect(domToRuns(el, true).text).toBe('가\n\n\n나다');
    setLinearSelection(el, 5, 5); // '다' 앞
    const r = window.getSelection()!.getRangeAt(0);
    expect(linearize(el, [{ container: r.startContainer, offset: r.startOffset }]).pos[0]).toBe(5);
    el.remove();
  });
});

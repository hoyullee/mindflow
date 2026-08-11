import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { realPreview } from './mapPreview';
import { LINK_INK_ON_LIGHT } from '../editor/richSpans';

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
    // Text now wraps into per-line wrapper <tspan>s that hold the styled segment
    // <tspan>s. Scope to the rich node's <text> (the one carrying a colored span),
    // then read its LEAF segment tspans (no child tspan).
    const richText = Array.from(container.querySelectorAll('svg text')).find((t) => t.querySelector('tspan[fill]'))!;
    const tspans = Array.from(richText.querySelectorAll('tspan'))
      .filter((s) => !s.querySelector('tspan'))
      .map((s) => ({ t: s.textContent, fill: s.getAttribute('fill'), fw: s.getAttribute('font-weight') }));
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

  it('sizes node boxes by measured text (editor-identical), not the old char-count cap', () => {
    // The preview used to size boxes with `min(220, len*13+26)` — a guess that
    // diverged from the editor (real `computeMetrics` canvas measurement) and
    // capped long text at 220px, so a long-text node rendered narrower than in
    // the editor. A clearly long label must now produce a box far wider than that
    // old 220 cap (the editor wraps long text up to a ~320px content width).
    const longDoc = {
      v: 1,
      themeKey: 'coral',
      layoutMode: 'right',
      nodes: {
        root: { id: 'root', text: '중심', emoji: '', parent: null, children: ['w'], collapsed: false, color: null, x: 0, y: 0 },
        w: { id: 'w', text: '이것은 아주 길고 긴 텍스트를 가진 노드입니다 정말로 매우 길어요', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0 },
      },
      floats: [],
      lines: [],
      zones: [],
    };
    const { container } = render(realPreview(JSON.stringify(longDoc), '#f0663f')!);
    const widths = Array.from(container.querySelectorAll('svg rect')).map((r) => parseFloat(r.getAttribute('width') || '0'));
    const maxW = Math.max(...widths);
    expect(maxW).toBeGreaterThan(250); // old heuristic hard-capped every box at 220

    // …and the long label WRAPS into multiple lines (per-line wrapper tspans),
    // like the editor — not a single truncated line.
    const texts = Array.from(container.querySelectorAll('svg text'));
    const maxLines = Math.max(...texts.map((t) => t.querySelectorAll(':scope > tspan').length));
    expect(maxLines).toBeGreaterThan(1);
  });

  it('shows a memo card fully — wraps all its text and grows the box (not one truncated line)', () => {
    const memoDoc = {
      v: 1,
      themeKey: 'coral',
      layoutMode: 'right',
      nodes: { root: { id: 'root', text: '중심', emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 } },
      floats: [{ id: 'm1', x: 120, y: -40, w: 200, text: '이 메모는 여러 줄에 걸친 긴 텍스트입니다.\n두 번째 줄도 있고\n세 번째 줄까지 있어요', bold: false }],
      lines: [],
      zones: [],
    };
    const { container } = render(realPreview(JSON.stringify(memoDoc), '#f0663f')!);
    // the memo's <text> holds one wrapper tspan PER line — more than one, and its
    // full text (all three hard lines) is present.
    const memoText = Array.from(container.querySelectorAll('svg text')).find((t) => /이 메모는/.test(t.textContent || ''))!;
    expect(memoText).toBeTruthy();
    expect(memoText.querySelectorAll(':scope > tspan').length).toBeGreaterThan(2);
    expect(memoText.textContent).toContain('세 번째 줄까지');
    // the memo rect grew past the default 44px to fit the wrapped text.
    const memoRect = Array.from(container.querySelectorAll('svg rect')).find((r) => Math.abs(parseFloat(r.getAttribute('width') || '0') - 200) < 1)!;
    expect(parseFloat(memoRect.getAttribute('height') || '0')).toBeGreaterThan(44);
  });

  it('draws an image float as an <image>, not a memo card (regression: 이미지가 노란 메모로 보임)', () => {
    const IMG = 'data:image/png;base64,QUJD';
    const withImgFloat = { ...doc, floats: [{ id: 'f1', x: 100, y: 100, w: 260, h: 195, text: '', img: IMG }] };
    const { container } = render(realPreview(JSON.stringify(withImgFloat), '#f0663f')!);

    const image = container.querySelector('svg image') as SVGImageElement;
    expect(image).toBeTruthy();
    expect(image.getAttribute('href')).toBe(IMG);
    expect(image.getAttribute('width')).toBe('260');
    expect(image.getAttribute('height')).toBe('195');
    // 메모 카드의 노란 배경 rect가 그려지면 안 된다
    const memoRect = Array.from(container.querySelectorAll('svg rect')).find((r) => r.getAttribute('fill') === '#fdf6c9');
    expect(memoRect).toBeUndefined();
  });

  it('draws a node thumbnail above the text and grows the node box (regression: 도형만 노출)', () => {
    const IMG = 'data:image/png;base64,REVG';
    const withNodeImg = {
      ...doc,
      nodes: {
        ...doc.nodes,
        a: { ...doc.nodes.a, img: IMG, imgW: 180, imgH: 135 },
      },
    };
    const { container } = render(realPreview(JSON.stringify(withNodeImg), '#f0663f')!);

    const image = container.querySelector('svg image') as SVGImageElement;
    expect(image).toBeTruthy();
    expect(image.getAttribute('href')).toBe(IMG);
    // 노드 박스가 이미지를 수용해 커졌는지: a 노드의 rect 높이 > 이미지 높이
    const rects = Array.from(container.querySelectorAll('svg rect')) as SVGRectElement[];
    const tall = rects.filter((r) => Number(r.getAttribute('height') || 0) >= 135);
    expect(tall.length).toBeGreaterThan(0);
    // 텍스트는 이미지 아래로 밀림: 텍스트 y > 이미지 y
    const label = (Array.from(container.querySelectorAll('svg text')) as SVGTextElement[]).find((t) => t.textContent?.includes('가지A'));
    expect(label).toBeTruthy();
    expect(Number(label!.getAttribute('y'))).toBeGreaterThan(Number(image.getAttribute('y')));
  });

  it('returns null for a doc with no nodes so the caller falls back to miniPreview', () => {
    expect(realPreview(JSON.stringify({ v: 1, nodes: {}, floats: [], lines: [], zones: [], layoutMode: 'radial', themeKey: 'coral' }), '#f0663f')).toBeNull();
    expect(realPreview(null, '#f0663f')).toBeNull();
    expect(realPreview('not json', '#f0663f')).toBeNull();
  });

  // Supabase 썸네일 본문(preview_doc RPC)은 이미지 데이터를 'stripped'로 바꿔
  // 보낸다 — <image>에 넣으면 깨진 이미지가 되므로 회색 자리표시자를 같은
  // 크기로 그리고, 박스 확장(computeMetrics의 imgH+8)은 그대로 유지돼야 한다.
  it('스트립된 이미지(자리표시 문자열)는 <image> 대신 같은 크기의 자리표시자를 그린다', () => {
    const stripped = {
      ...doc,
      nodes: {
        ...doc.nodes,
        a: { ...doc.nodes.a, img: 'stripped', imgW: 180, imgH: 135 },
      },
      floats: [{ id: 'f1', x: 300, y: 300, w: 260, h: 180, text: '', img: 'stripped' }],
    };
    const { container } = render(realPreview(JSON.stringify(stripped), '#f0663f')!);
    // 이미지 요소는 없어야 한다(노드·플로트 모두)
    expect(container.querySelector('svg image')).toBeNull();
    // 노드 박스는 여전히 이미지 높이를 수용해 커져 있다
    const rects = Array.from(container.querySelectorAll('svg rect')) as SVGRectElement[];
    expect(rects.some((r) => Number(r.getAttribute('height') || 0) >= 135)).toBe(true);
    // 자리표시자(연회색 rect 180×135 / 260×180)가 그려졌다
    expect(rects.some((r) => r.getAttribute('width') === '180' && r.getAttribute('height') === '135')).toBe(true);
    expect(rects.some((r) => r.getAttribute('width') === '260' && r.getAttribute('height') === '180')).toBe(true);
  });

  // 실기기 제보(도형 밖으로 텍스트가 벗어남)의 원인: 자식 없는 자유 도형은
  // 레이아웃이 sizeOf를 호출하지 않아 metricsById에 없고, 폴백 측정이 박스는
  // depth 1(15px 기준), 텍스트는 depth 0(20px)으로 갈라져 텍스트가 박스를
  // 계통적으로 벗어났다. 에디터(buildVisible)는 자유 도형을 depth 1로 그린다 —
  // 미리보기도 동일해야 한다.
  it('childless free shape: 텍스트를 에디터와 같은 depth 1 크기(15px)로 그린다', () => {
    const withFree = {
      ...doc,
      nodes: {
        ...doc.nodes,
        fr: { id: 'fr', text: '자유 도형 노트', emoji: '', parent: null, free: true, children: [], collapsed: false, color: null, x: 500, y: -100 },
      },
    };
    const { container } = render(realPreview(JSON.stringify(withFree), '#f0663f')!);
    const label = (Array.from(container.querySelectorAll('svg text')) as SVGTextElement[]).find((t) => t.textContent?.includes('자유 도형 노트'));
    expect(label).toBeTruthy();
    expect(label!.getAttribute('font-size')).toBe('15'); // depth 0(20px)이면 회귀
  });

  // 하이퍼링크는 에디터와 같은 신호로 — 파란 글자 + 밑줄. 파랑은 도형 글자색의
  // 밝기를 보고 고르므로(`linkInk`) 어두운 도형·다크 테마에서도 묻히지 않는다.
  it('링크 글자는 파랗고 밑줄이 있다 (에디터와 같은 신호)', () => {
    const withLink = {
      ...doc,
      nodes: {
        ...doc.nodes,
        a: { ...doc.nodes.a, text: '문서 보기', rich: [{ t: '문서', b: false, c: null, href: 'https://example.com/' }, { t: ' 보기', b: false, c: null }] },
      },
    };
    const { container } = render(realPreview(JSON.stringify(withLink), '#f0663f')!);
    const linked = (Array.from(container.querySelectorAll('svg tspan')) as SVGTSpanElement[]).find((t) => t.textContent === '문서');
    expect(linked).toBeTruthy();
    expect(linked!.getAttribute('fill')).toBe(LINK_INK_ON_LIGHT);
    // 밑줄은 `text-decoration`이 아니라 rect다 — 크롬이 SVG 장식을 베이스라인 기준으로
    // 그려 글자 **위**에 그어지던 문제(실브라우저 재현) 때문. 링크색으로 칠한다.
    expect(linked!.getAttribute('text-decoration')).toBeNull();
    const rules = Array.from(container.querySelectorAll('svg rect')).filter((r) => r.getAttribute('fill') === LINK_INK_ON_LIGHT);
    expect(rules).toHaveLength(1);
    expect(Number(rules[0]!.getAttribute('height'))).toBeGreaterThanOrEqual(1.8);
  });

  // 취소선도 같은 경로 — 예전엔 `text-decoration="line-through"`가 붙는데도 축척에
  // 눌려 사실상 보이지 않았다(제보).
  it('취소선이 글자 가운데를 지나는 rect로 그려진다', () => {
    const withStrike = {
      ...doc,
      nodes: {
        ...doc.nodes,
        a: { ...doc.nodes.a, text: '취소선 텍스트', rich: [{ t: '취소선', b: false, c: null, s: true }, { t: ' 텍스트', b: false, c: null }] },
      },
    };
    const { container } = render(realPreview(JSON.stringify(withStrike), '#f0663f')!);
    const seg = (Array.from(container.querySelectorAll('svg tspan')) as SVGTSpanElement[]).find((t) => t.textContent === '취소선');
    expect(seg).toBeTruthy();
    const line = seg!.closest('text')!;
    const cy = Number(line.getAttribute('y'));
    const fpx = Number(line.getAttribute('font-size'));
    // 본문 텍스트는 x-height 중앙 정렬(`middle`)이라 줄의 y가 곧 취소선 자리다
    // (한글 음절 블록 때문에 아주 살짝 위로 올린다 — `decoRects` 참고).
    const strikes = Array.from(container.querySelectorAll('svg rect')).filter((r) => {
      const h = Number(r.getAttribute('height'));
      return h >= 1 && h <= 4 && Math.abs(Number(r.getAttribute('y')) + h / 2 - cy) <= fpx * 0.05;
    });
    expect(strikes).toHaveLength(1);
    expect(Number(strikes[0]!.getAttribute('width'))).toBeGreaterThan(0);
    // 축척(0.5~0.7배)을 견딜 두께여야 한다 — 1 user unit면 카드에서 사라진다.
    expect(Number(strikes[0]!.getAttribute('height'))).toBeGreaterThanOrEqual(1.8);
  });

  // 메모(플로트) rich 서식 — 노드와 같은 신호(굵게 tspan·링크 파랑+밑줄 rect).
  it('메모의 rich 런이 굵게/링크로 그려진다', () => {
    const withFloat = {
      ...doc,
      floats: [{ id: 'f1', x: 300, y: 200, w: 200, text: '굵게 문서', rich: [{ t: '굵게', b: true, c: null }, { t: ' 문서', b: false, c: null, href: 'https://example.com/' }] }],
    };
    const { container } = render(realPreview(JSON.stringify(withFloat), '#f0663f')!);
    const tspans = Array.from(container.querySelectorAll('svg tspan')) as SVGTSpanElement[];
    expect(tspans.some((t) => t.textContent === '굵게' && t.getAttribute('font-weight') === '800')).toBe(true);
    const linked = tspans.find((t) => t.textContent === ' 문서');
    expect(linked?.getAttribute('fill')).toBe(LINK_INK_ON_LIGHT);
    // 밑줄 rect가 링크색으로 그려진다(decoRects — 노드와 같은 경로)
    expect(Array.from(container.querySelectorAll('svg rect')).some((r) => r.getAttribute('fill') === LINK_INK_ON_LIGHT)).toBe(true);
  });

  // 텍스트 굵기도 측정에 쓴 fw 그대로(루트 700, depth1 600, depth2+ 500) —
  // 더 굵게 그리면 렌더 폭이 측정 폭을 넘어 미세하게 상자를 벗어난다.
  it('텍스트 굵기가 에디터 메트릭 fw와 일치한다(루트 700 / 본문 600)', () => {
    const { container } = render(realPreview(JSON.stringify(doc), '#f0663f')!);
    const texts = Array.from(container.querySelectorAll('svg text')) as SVGTextElement[];
    const rootT = texts.find((t) => t.textContent === '루트')!;
    const bodyT = texts.find((t) => t.textContent === '가지A')!;
    expect(rootT.getAttribute('font-weight')).toBe('700');
    expect(bodyT.getAttribute('font-weight')).toBe('600');
  });
});

// 화이트보드(kind='board', 트리 없는 문서) — 노드 0개여도 메모가 곧 내용이다.
// 예전엔 `ids.length` 가드가 무조건 null을 돌려줘 모든 보드 카드가 장식용
// miniPreview로 떨어졌다(M3에서 완화).
describe('realPreview — 화이트보드', () => {
  it('메모만 있는 보드도 실제 미리보기를 그린다', () => {
    const board = {
      v: 1,
      kind: 'board',
      nodes: {},
      floats: [
        { id: 'f1', x: 20, y: 30, w: 180, text: '보드 메모' },
        { id: 'f2', x: 260, y: 120, w: 160, text: '둘째 메모' },
      ],
      lines: [],
      zones: [],
      layoutMode: 'right',
      themeKey: 'coral',
    };
    const el = realPreview(JSON.stringify(board), '#f0663f');
    expect(el).not.toBeNull();
    const { container } = render(el!);
    const labels = Array.from(container.querySelectorAll('svg text')).map((t) => t.textContent);
    expect(labels).toEqual(expect.arrayContaining(['보드 메모', '둘째 메모']));
  });

  it('정말 아무것도 없는 빈 보드만 null(미니 스케치 폴백)', () => {
    const empty = { v: 1, kind: 'board', nodes: {}, floats: [], lines: [], zones: [], layoutMode: 'right', themeKey: 'coral' };
    expect(realPreview(JSON.stringify(empty), '#f0663f')).toBeNull();
  });

  it('그리기 획(strokes)만 있는 보드도 미리보기에 획 path를 그린다(M4)', () => {
    const board = {
      v: 1,
      kind: 'board',
      nodes: {},
      floats: [],
      lines: [],
      zones: [],
      layoutMode: 'right',
      themeKey: 'coral',
      strokes: [{ id: 's1', pts: [10, 10, 60, 40, 120, 20], color: '#d92626', w: 4 }],
    };
    const el = realPreview(JSON.stringify(board), '#f0663f');
    expect(el).not.toBeNull();
    const { container } = render(el!);
    const path = Array.from(container.querySelectorAll('svg path')).find((p) => p.getAttribute('stroke') === '#d92626');
    expect(path).toBeTruthy();
    expect(path!.getAttribute('d')).toContain('M 10 10');
    expect(path!.getAttribute('stroke-width')).toBe('4');
    expect(path!.getAttribute('fill')).toBe('none');
  });
});

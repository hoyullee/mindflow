import { ROOT_ID, cardsInColumn, layout, parseListPrefix, strokeBounds, strokePathD } from '@mindflow/mindmap-core';
import type { Doc, EdgeStyle, Float, LayoutMode, Node as CoreNode } from '@mindflow/mindmap-core';
import { buildEdgePath, edgeStrokeWidth } from '../editor/edges';
import { linkInk } from '../editor/richSpans';
import { HL_OPACITY, isHighlighter } from '../editor/boardTools';
import { CanvasTextMeasurer, computeMetrics, floatPadLeft, measureFloatHeight } from '../editor/metrics';
import type { TextMeasurer } from '../editor/metrics';
import { hexA } from './storage';
import { UI_THEME } from '../editor/theme';
import { boardProgress, columnBg, columnColor, tagColor, tagInk } from '../editor/kanbanMeta';

// Match the editor EXACTLY: size preview node boxes with the same canvas text
// measurement (`computeMetrics` + `CanvasTextMeasurer`) the editor uses, instead
// of a character-count guess. A shared measurer (caches its canvas 2d context).
const previewMeasurer = new CanvasTextMeasurer();

/** 그릴 수 있는 이미지 소스인가. Supabase 썸네일 본문(preview_doc RPC, 0012)은
 * egress 절감을 위해 이미지 **데이터**를 자리표시 문자열('stripped')로 바꿔
 * 보낸다 — 크기 필드는 유지되므로 박스는 그대로 두고 이미지 자리만 회색
 * 자리표시자로 그린다. */
function drawableImg(src: string | undefined): string | null {
  return src && /^(data:|https?:|blob:)/.test(src) ? src : null;
}

/** 스트립된 이미지 자리표시자 — 연회색 면 + 작은 산 모양 글리프. */
function imgPlaceholder(key: string, x: number, y: number, w: number, h: number, rx: number): JSX.Element {
  const gs = Math.min(w, h) * 0.34;
  const gx = x + w / 2 - gs / 2;
  const gy = y + h / 2 - gs / 2;
  return (
    <g key={key}>
      <rect x={x} y={y} width={w} height={h} rx={rx} fill={hexA('#8a7365', 0.12)} stroke={hexA('#8a7365', 0.25)} strokeWidth={1.2} />
      <path
        d={`M ${gx} ${gy + gs * 0.85} L ${gx + gs * 0.35} ${gy + gs * 0.4} L ${gx + gs * 0.55} ${gy + gs * 0.62} L ${gx + gs * 0.72} ${gy + gs * 0.45} L ${gx + gs} ${gy + gs * 0.85} Z`}
        fill={hexA('#8a7365', 0.35)}
      />
      <circle cx={gx + gs * 0.78} cy={gy + gs * 0.2} r={gs * 0.1} fill={hexA('#8a7365', 0.35)} />
    </g>
  );
}

/** A styled text segment (plain text is one segment with no bold/color). */
interface WrapSeg {
  t: string;
  b?: boolean;
  c?: string | null;
  i?: boolean;
  s?: boolean;
  /** 하이퍼링크 — 썸네일에서는 파란 글자 + 밑줄로 보인다(클릭 동작 없음). */
  href?: string;
  /** 측정된 폭(user unit). 밑줄·취소선을 직접 그릴 때 x 오프셋을 잡는 데 쓴다. */
  w?: number;
}

/** Merge adjacent same-style tokens on a line back into segments (fewer tspans). */
function mergeToks(line: WrapSeg[]): WrapSeg[] {
  const segs: WrapSeg[] = [];
  line.forEach((tk) => {
    const last = segs[segs.length - 1];
    if (last && !!last.b === !!tk.b && (last.c ?? null) === (tk.c ?? null) && !!last.i === !!tk.i && !!last.s === !!tk.s && (last.href ?? null) === (tk.href ?? null)) {
      last.t += tk.t;
      last.w = (last.w ?? 0) + (tk.w ?? 0);
    } else segs.push({ t: tk.t, b: tk.b, c: tk.c, i: tk.i, s: tk.s, href: tk.href, w: tk.w });
  });
  return segs;
}

/** 감싼 시각 줄 하나 — 리스트 줄은 첫 줄에 마커 세그가 포함되고, 감긴(연속) 줄은
 * 마커 폭만큼 `indent`를 갖는다(에디터의 행잉 인덴트와 동일 모델).
 * `itemW`는 그 항목([마커|내용]) 블록의 폭 — 사용자 정렬(가운데/오른쪽)에서
 * 블록을 통째로 옮길 때 쓴다(`ListTextBlock`의 `justifyContent`와 같은 결과). */
interface WrapLine {
  segs: WrapSeg[];
  indent: number;
  list: boolean;
  itemW: number;
  /** 이 시각 줄의 폭(마커 제외, user unit) — 정렬에 따라 세그 x를 잡는 데 쓴다. */
  w: number;
}

// 리스트 줄의 왼쪽 x는 **항상 텍스트 열 왼쪽**(Notion 방식, 사용자 선정 —
// `listLines.tsx`의 LIST_ROW_JUSTIFY 참고). 정렬 설정은 평문 줄에만 적용된다.

/** 리스트 마커 글자 수만큼 세그 앞부분을 뗀다(런 경계에 걸쳐도 안전). */
function stripLeadSegs(segs: WrapSeg[], nChars: number): WrapSeg[] {
  let left = nChars;
  const out: WrapSeg[] = [];
  segs.forEach((sg) => {
    if (left <= 0) {
      out.push(sg);
      return;
    }
    if (sg.t.length <= left) {
      left -= sg.t.length;
      return;
    }
    out.push({ ...sg, t: sg.t.slice(left) });
    left = 0;
  });
  return out;
}

/**
 * Soft-wrap a node's text into visual lines, the SAME way the editor's
 * `computeMetrics`/`wrapMeasure` does (token model: words / whitespace / single
 * chars, break at `maxW`), so the thumbnail's line breaks match the real map.
 * Preserves per-run bold/color (rich text) so each wrapped line stays styled.
 * 리스트 줄(`parseListPrefix`)은 마커 폭을 뗀 좁은 폭으로 내용을 감싸고
 * (`metrics.wrapMeasure`와 동일), 첫 줄엔 표시 마커(`• `)를 붙인다.
 */
function wrapRuns(runs: WrapSeg[], maxW: number, fpx: number, baseFw: number, measurer: TextMeasurer): WrapLine[] {
  // Hard lines first (split on \n), each a list of styled segments.
  const hard: WrapSeg[][] = [[]];
  runs.forEach((r) => {
    String(r.t ?? '')
      .split('\n')
      .forEach((p, i) => {
        if (i > 0) hard.push([]);
        if (p) hard[hard.length - 1]!.push({ t: p, b: r.b, c: r.c, i: r.i, s: r.s, href: r.href });
      });
  });
  const out: WrapLine[] = [];
  hard.forEach((rawSegs) => {
    const lineText = rawSegs.map((s) => s.t).join('');
    const lp = parseListPrefix(lineText);
    const markerW = lp ? measurer.measure(lp.display, `${baseFw} ${fpx}px Pretendard`) : 0;
    const segs = lp ? stripLeadSegs(rawSegs, lp.raw.length) : rawSegs;
    const lineMaxW = lp ? Math.max(24, maxW - markerW) : maxW;
    const visual: { segs: WrapSeg[]; w: number }[] = [];
    const pushLine = (line: (WrapSeg & { w: number })[], w: number): void => {
      visual.push({ segs: mergeToks(line), w });
    };
    const toks: (WrapSeg & { w: number; sp: boolean })[] = [];
    segs.forEach((sg) => {
      const f = `${sg.i ? 'italic ' : ''}${sg.b ? 800 : baseFw} ${fpx}px Pretendard`;
      (String(sg.t).match(/[A-Za-z0-9]+|\s+|./gu) || []).forEach((p) => toks.push({ t: p, w: measurer.measure(p, f), sp: /^\s+$/.test(p), b: sg.b, c: sg.c, i: sg.i, s: sg.s, href: sg.href }));
    });
    let line: typeof toks = [];
    let cur = 0;
    toks.forEach((tk) => {
      if (cur > 0 && cur + tk.w > lineMaxW && !tk.sp) {
        pushLine(line, cur);
        line = [tk];
        cur = tk.w;
      } else {
        line.push(tk);
        cur += tk.w;
      }
    });
    pushLine(line, cur);
    // 항목 블록 폭 = 마커 + 내용 열. 내용이 감기면 열은 가용 폭을 다 쓴다
    // (CSS `flex: 0 1 auto`의 fit-content = min(max-content, 가용폭)와 동일).
    const contentColW = visual.length > 1 ? lineMaxW : (visual[0]?.w ?? 0);
    const itemW = markerW + contentColW;
    visual.forEach((v, vi) => {
      if (lp) out.push(vi === 0 ? { segs: [{ t: lp.display, w: markerW }, ...v.segs], indent: 0, list: true, itemW, w: markerW + v.w } : { segs: v.segs, indent: markerW, list: true, itemW, w: v.w });
      else out.push({ segs: v.segs, indent: 0, list: false, itemW: v.w, w: v.w });
    });
  });
  // 항목마다 **자기 폭**으로 정렬한다(에디터 `listItemJustify`와 같은 모델).
  return out.length ? out : [{ segs: [], indent: 0, list: false, itemW: 0, w: 0 }];
}

/** 밑줄·취소선을 `<rect>`로 직접 그린다.
 *
 * SVG `text-decoration`을 쓰지 않는 이유: 크롬은 장식을 **베이스라인 기준**으로
 * 그리는데 이 텍스트는 `dominant-baseline`으로 글자를 세로 가운데 맞추므로 장식만
 * 제자리에 남는다 — 링크 밑줄이 글자 **위**에 그어지고(제보), 취소선은 글자 윗부분을
 * 스치며 두께도 축척에 눌려 사실상 보이지 않았다. 직접 그리면 위치·두께를 우리가
 * 정하고(축척이 작아도 최소 1 user unit) 두 장식이 같은 규칙을 따른다.
 *
 * `dominant-baseline="middle"`은 글자를 **x-height 중앙**에 맞추므로 그 줄의 `y`가
 * 곧 취소선 자리다. 밑줄은 거기서 글자 높이의 절반쯤 아래.
 */
function decoRects(key: string, segs: WrapSeg[], lineLeft: number, cy: number, fpx: number, baseColor: string, linkFill: string): JSX.Element[] {
  const out: JSX.Element[] = [];
  // 두께는 축척을 견뎌야 한다 — 카드 안에서 SVG가 0.5~0.7배로 줄어들어, 1 user unit로
  // 그으면 1 CSS px 아래로 내려가 특히 글자 위를 지나는 취소선이 안티에일리어싱에
  // 묻혀 사라진다(제보: "취소선이 안 보인다" — rect로 바꾼 뒤에도 얇아서 그랬다).
  const th = Math.max(1.8, fpx * 0.09);
  let x = lineLeft;
  segs.forEach((sg, si) => {
    const w = sg.w ?? 0;
    if (w > 0) {
      const color = sg.c || (sg.href ? linkFill : baseColor);
      // 한글은 음절 블록이 전체 높이를 채워 x-height 중앙보다 살짝 위가 눈에 가운데로 보인다.
      if (sg.s) out.push(<rect key={`${key}s${si}`} x={x} y={cy - fpx * 0.04 - th / 2} width={w} height={th} fill={color} />);
      if (sg.href) out.push(<rect key={`${key}u${si}`} x={x} y={cy + fpx * 0.32} width={w} height={th} fill={color} />);
    }
    x += w;
  });
  return out;
}

/** 한 시각 줄의 왼쪽 x — `<text>`의 정렬(anchor)과 같은 규칙. */
function lineLeftOf(ln: WrapLine, listLeft: number, tx: number, align: 'left' | 'center' | 'right'): number {
  if (ln.list) return listLeft;
  if (align === 'right') return tx - ln.w;
  if (align === 'center') return tx - ln.w / 2;
  return tx;
}

/** Home.dc.html `realPreview` — mirrors the editor's theme accent/branch palettes so a
 * card's thumbnail matches what the map actually looks like when opened. */
// Full theme surfaces (accent/palette + panel/text/accentInk), mirrored from the
// editor's `THEMES` (apps/web/src/features/editor/theme.ts). The default node fill,
// body text, and root text follow the theme just like the editor — previously
// they were hardcoded (#fff / #33281f), which rendered a dark-theme map's nodes as
// white boxes with dark text instead of the theme's dark panel + light text.
interface ThemePal {
  accent: string;
  palette: string[];
  panel: string;
  text: string;
  accentInk: string;
}
const THEME_PAL: Record<string, ThemePal> = {
  coral: { accent: '#f0663f', panel: '#ffffff', text: '#33281f', accentInk: '#ffffff', palette: ['#f0663f', '#f0913f', '#e0b23c', '#8fb257', '#3fae9e', '#3f8fd0', '#8a6bd1', '#d0568f', '#d92626'] },
  ocean: { accent: '#2f7fd6', panel: '#ffffff', text: '#22303f', accentInk: '#ffffff', palette: ['#2f7fd6', '#37a5c9', '#3fb59a', '#6bb85a', '#e0a53c', '#e07b4a', '#8a6bd1', '#d0568f', '#d92626'] },
  forest: { accent: '#2f9e63', panel: '#ffffff', text: '#24352b', accentInk: '#ffffff', palette: ['#2f9e63', '#5aab45', '#9aae3c', '#c99a3c', '#3fae9e', '#3f8fd0', '#8a6bd1', '#d0568f', '#d92626'] },
  grape: { accent: '#7d5bd0', panel: '#ffffff', text: '#2f2740', accentInk: '#ffffff', palette: ['#7d5bd0', '#a45bd0', '#d05fb0', '#d0568f', '#e07b4a', '#e0b23c', '#3fae9e', '#3f8fd0', '#d92626'] },
  dark: { accent: '#f0663f', panel: '#262019', text: '#f3ece4', accentInk: '#1b1712', palette: ['#f0804f', '#f0b04f', '#e8cf5a', '#9fce6a', '#4fc9b6', '#5fa8e8', '#a98be8', '#e87bb0', '#ff4d4d'] },
  mono: { accent: '#2b2b2b', panel: '#ffffff', text: '#202020', accentInk: '#ffffff', palette: ['#3a3a3a', '#565656', '#727272', '#8e8e8e', '#4a4a4a', '#616161', '#787878', '#909090', '#d92626'] },
  white: { accent: '#2f7fd6', panel: '#ffffff', text: '#1f2328', accentInk: '#ffffff', palette: ['#2f7fd6', '#e0663f', '#3fae9e', '#8a6bd1', '#8fb257', '#e0a53c', '#d0568f', '#4a5568', '#d92626'] },
};

interface DocNode {
  parent?: string | null;
  free?: boolean;
  x?: number;
  y?: number;
  text?: string;
  emoji?: string;
  cw?: number;
  ch?: number;
  color?: string | null;
  fill?: string;
  stroke?: string;
  fillA?: number;
  strokeA?: number;
  shape?: string;
  textColor?: string;
  bold?: boolean;
  tsize?: 's' | 'm' | 'l';
  /** 텍스트 정렬 (에디터 `n.align` — 없으면 center). */
  align?: string;
  /** Partial rich-text runs (bold/color spans); mirrors core `RichRun`. */
  rich?: Array<{ t: string; b?: boolean; c?: string | null; i?: boolean; s?: boolean; href?: string }> | null;
  children?: string[];
  /** 노드 썸네일 이미지 (core `Node.img/imgW/imgH` — 항상 세트). */
  img?: string;
  imgW?: number;
  imgH?: number;
}

interface DocFloat {
  id?: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  collapsed?: boolean;
  text?: string;
  bg?: string;
  textColor?: string;
  bold?: boolean;
  tsize?: 's' | 'm' | 'l';
  /** 이미지 플로트 (core `Float.img`) — 메모 카드 대신 이미지로 그린다. */
  img?: string;
  /** 부분 리치텍스트 런 (core `Float.rich`) — 노드와 같은 모델. */
  rich?: Array<{ t: string; b?: boolean; c?: string | null; i?: boolean; s?: boolean; href?: string }> | null;
}

interface DocZone {
  x: number;
  y: number;
  w: number;
  h: number;
  color?: string;
  label?: string;
}

interface DocLine {
  a1?: { kind: 'node' | 'float'; id: string; side?: 'top' | 'bottom' | 'left' | 'right' };
  a2?: { kind: 'node' | 'float'; id: string; side?: 'top' | 'bottom' | 'left' | 'right' };
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  c1?: number;
  c2?: number;
  curve?: number;
  color?: string;
  dashed?: boolean;
  startArrow?: boolean;
  endArrow?: boolean;
  label?: string;
  ltextColor?: string;
}

/** Home.dc.html `realPreview(title, hue, docId)` — renders the actual saved map (nodes
 * carry x/y from the editor layout). Returns null so the caller falls back to `miniPreview`. */
interface PreviewDoc {
  themeKey?: string;
  layoutMode?: string;
  edgeStyle?: string;
  nodes?: Record<string, DocNode>;
  floats?: DocFloat[];
  lines?: DocLine[];
  zones?: DocZone[];
  strokes?: { id: string; pts: number[]; color: string; w: number; hl?: boolean }[];
  kind?: string;
  columns?: { id: string; title: string; color?: string | null; bg?: string | null }[];
  cards?: { id: string; col: string; pos: number; text: string; bg?: string | null; tag?: string }[];
  tags?: { id: string; name: string; color?: string | null }[];
}

/** Saved docs persist layout-derived node x/y as `0`: the React editor keeps
 * layout pure/derived (`mindmap-core`) and never writes positions back into the
 * doc, unlike the dc original which mutated `node.x/y` in place. Without this the
 * thumbnail would pile every node at the origin — the same blob for every map.
 * Re-run the SAME core `layout` the editor uses (respecting the doc's layoutMode)
 * so the preview matches the real arrangement. Mutates `d.nodes` x/y in place;
 * free shapes and their subtrees keep their stored positions (layout anchors
 * them there), so this is safe for docs that already carry real coordinates.
 *
 * `sizeOf` is the editor-identical `computeMetrics` measurer (see caller). It's
 * also invoked here for EVERY laid-out node, so `sizeOf` doubles as the recorder
 * that populates the caller's box-size map — guaranteeing the drawn box matches
 * the box the layout positioned. */
function applyLayoutPositions(d: PreviewDoc, sizeOf: (node: CoreNode, depth: number) => { w: number; h: number }): void {
  const nodes = d.nodes;
  if (!nodes || !nodes[ROOT_ID]) return; // no canonical root → keep stored coords
  const mode: LayoutMode = d.layoutMode === 'right' || d.layoutMode === 'down' ? d.layoutMode : 'radial';
  try {
    const laid = layout({ nodes } as unknown as Doc, mode, sizeOf);
    for (const id of Object.keys(nodes)) {
      const g = laid[id];
      if (g) {
        nodes[id]!.x = g.x;
        nodes[id]!.y = g.y;
      }
    }
  } catch {
    /* malformed tree → keep stored coordinates */
  }
}

// Memoize the (relatively expensive) preview build. `realPreview` runs for every
// card on EVERY Home render — search typing, opening a menu, etc. — but its output
// depends only on the doc body + hue. Cache by that key and return the SAME element
// reference on a hit, so React skips reconciling the whole SVG subtree and the
// layout/measure work happens once per unique doc. Bounded (LRU) so it can't grow
// without limit as maps/edits accumulate.
const previewCache = new Map<string, JSX.Element | null>();
const PREVIEW_CACHE_MAX = 400;

export function realPreview(rawDoc: string | null, hueFallback: string): JSX.Element | null {
  if (!rawDoc) return null;
  const key = `${hueFallback} ${rawDoc}`;
  const hit = previewCache.get(key);
  if (hit !== undefined) {
    // touch → most-recently-used (Map preserves insertion order)
    previewCache.delete(key);
    previewCache.set(key, hit);
    return hit;
  }
  const el = buildPreview(rawDoc, hueFallback);
  previewCache.set(key, el);
  if (previewCache.size > PREVIEW_CACHE_MAX) {
    const oldest = previewCache.keys().next().value;
    if (oldest !== undefined) previewCache.delete(oldest);
  }
  return el;
}

function buildPreview(rawDoc: string, hueFallback: string): JSX.Element | null {
  let d: PreviewDoc;
  try {
    d = JSON.parse(rawDoc) as PreviewDoc;
  } catch {
    return null;
  }
  if (!d || !d.nodes) return null;
  // 칸반은 트리도 좌표도 없다 — 열·카드를 그리는 전용 렌더로 간다(열이 하나도
  // 없으면 null → 카드가 폴백 삽화 `miniKanbanPreview`로 떨어진다).
  // 칸반 화면은 캔버스가 아니라 크롬이라 에디터도 **UI 테마**(고정 팔레트)로
  // 그린다 — 썸네일도 같은 팔레트를 써야 카드와 화면이 같은 색으로 보인다.
  if (d.kind === 'kanban') return kanbanPreview(d);
  // Editor-identical node box sizing: `computeMetrics` (real canvas text
  // measurement). The layout pass records each node's box into `metricsById` so
  // the DRAWN box is exactly the box the layout positioned (see `dim`).
  const metricsById: Record<string, { w: number; h: number; fpx: number; fw: number; wrapW: number; tw: number; depth: number }> = {};
  const sizeOf = (node: CoreNode, depth: number): { w: number; h: number } => {
    const m = computeMetrics(node, depth, previewMeasurer);
    if (node.id) metricsById[node.id] = { w: m.w, h: m.h, fpx: m.fpx, fw: m.fw, wrapW: m.wrapW, tw: m.tw, depth };
    return { w: m.w, h: m.h };
  };
  applyLayoutPositions(d, sizeOf);

  const TH = (d.themeKey && THEME_PAL[d.themeKey]) || THEME_PAL.coral!;
  const hue = TH.accent;
  const nodes = d.nodes;
  const ids = Object.keys(nodes).filter((k) => typeof nodes[k]?.x === 'number' && typeof nodes[k]?.y === 'number');
  // 화이트보드(트리 없는 문서)는 노드 0개여도 메모·이미지가 곧 내용이다 —
  // 노드도 메모/영역/선도 없을 때만 포기한다(그때는 miniPreview 폴백).
  // 아래 `root`는 ids가 비면 undefined지만, 노드 렌더 루프가 돌지 않아 안전하다.
  const hasLoose = (Array.isArray(d.floats) && d.floats.length > 0) || (Array.isArray(d.zones) && d.zones.length > 0) || (Array.isArray(d.lines) && d.lines.length > 0) || (Array.isArray(d.strokes) && d.strokes.length > 0);
  if (!ids.length && !hasLoose) return null;
  const palette = TH.palette;
  const root = ids.find((k) => !nodes[k]?.parent && !nodes[k]?.free) || ids[0]!;

  const colorOf = (id: string): string => {
    let cur: DocNode | undefined = nodes[id];
    const chain: DocNode[] = [];
    let guard = 0;
    while (cur && cur.parent && guard++ < 60) {
      chain.push(cur);
      cur = nodes[cur.parent];
    }
    if (cur && cur !== nodes[root]) chain.push(cur);
    for (const c of chain) if (c.color) return c.color;
    const d1 = chain[chain.length - 1];
    if (!d1) return palette[0]!;
    const rootChildren = nodes[root]?.children || [];
    const idx = rootChildren.indexOf((d1 as DocNode & { id?: string }).id ?? '');
    return palette[(idx < 0 ? 0 : idx) % palette.length]!;
  };

  /** 에디터(buildVisible)와 동일한 깊이: 루트 트리는 부모 사슬 길이, **자유
   * 도형 서브트리는 +1**(에디터는 free 루트를 depth 1부터 그린다). 이걸 어기면
   * 자식 없는 free 도형(레이아웃이 sizeOf를 안 불러 metricsById에 없음)의
   * 폴백 측정이 박스(depth 1)와 텍스트(depth 0)로 갈라져 20px 텍스트가 15px
   * 기준 박스를 계통적으로 벗어났다(실기기 제보 — 라인으로 이어 둔 노트
   * 도형들의 텍스트가 전부 상자 밖으로 삐져나옴). */
  const depthOf = (id: string): number => {
    let dep = 0;
    let cur: DocNode | undefined = nodes[id];
    let guard = 0;
    while (cur && cur.parent && guard++ < 50) {
      dep++;
      cur = nodes[cur.parent];
    }
    if (cur && cur.free) dep += 1;
    return dep;
  };

  const dim = (id: string): { w: number; h: number } => {
    const rec = metricsById[id];
    if (rec) return { w: rec.w, h: rec.h };
    const m = computeMetrics(nodes[id] as unknown as CoreNode, depthOf(id), previewMeasurer);
    return { w: m.w, h: m.h };
  };
  /** Editor-identical text metrics for a node (fpx/fw/depth): recorded during
   * the layout pass, or freshly measured for any node it didn't visit. */
  const metaOf = (id: string, depth: number): { fpx: number; fw: number; wrapW: number; tw: number } => {
    const rec = metricsById[id];
    if (rec) return { fpx: rec.fpx, fw: rec.fw, wrapW: rec.wrapW, tw: rec.tw };
    const m = computeMetrics(nodes[id] as unknown as CoreNode, depth, previewMeasurer);
    return { fpx: m.fpx, fw: m.fw, wrapW: m.wrapW, tw: m.tw };
  };

  const floats = Array.isArray(d.floats) ? d.floats : [];
  const zones = Array.isArray(d.zones) ? d.zones : [];
  const lines = Array.isArray(d.lines) ? d.lines : [];
  // Memo cards GROW to fit their wrapped text (min-height box) — use the editor's
  // measured height (`measureFloatHeight`) so the preview box, its line-anchor
  // ports and the bounding box all match the real card instead of a fixed 44px.
  const board = d.kind === 'board';
  const floatH = (f: DocFloat) => measureFloatHeight(f as unknown as Float, previewMeasurer);

  let x0 = 1e9;
  let y0 = 1e9;
  let x1 = -1e9;
  let y1 = -1e9;
  const grow = (ax0: number, ay0: number, ax1: number, ay1: number) => {
    x0 = Math.min(x0, ax0);
    y0 = Math.min(y0, ay0);
    x1 = Math.max(x1, ax1);
    y1 = Math.max(y1, ay1);
  };
  ids.forEach((id) => {
    const n = nodes[id]!;
    const m = dim(id);
    grow((n.x ?? 0) - m.w / 2, (n.y ?? 0) - m.h / 2, (n.x ?? 0) + m.w / 2, (n.y ?? 0) + m.h / 2);
  });
  floats.forEach((f) => grow(f.x, f.y, f.x + (f.w || 160), f.y + floatH(f)));
  zones.forEach((z) => grow(z.x, z.y - 14, z.x + z.w, z.y + z.h));
  const strokes = Array.isArray(d.strokes) ? d.strokes : [];
  strokes.forEach((st) => {
    const b = strokeBounds(st);
    if (b) grow(b.x0, b.y0, b.x1, b.y1);
  });

  const nodeBox = (id: string) => {
    const n = nodes[id]!;
    const m = dim(id);
    return { cx: n.x ?? 0, cy: n.y ?? 0, hw: m.w / 2, hh: m.h / 2 };
  };
  const floatBox = (f: DocFloat) => ({ cx: f.x + (f.w || 160) / 2, cy: f.y + floatH(f) / 2, hw: (f.w || 160) / 2, hh: floatH(f) / 2 });
  const resolveEnd = (l: DocLine, w: 1 | 2): { x?: number; y?: number } => {
    const a = w === 1 ? l.a1 : l.a2;
    if (a) {
      let box: { cx: number; cy: number; hw: number; hh: number } | null = null;
      if (a.kind === 'node' && nodes[a.id] && ids.includes(a.id)) box = nodeBox(a.id);
      if (a.kind === 'float') {
        const f = floats.find((x) => x.id === a.id);
        if (f) box = floatBox(f);
      }
      if (box) {
        if (a.side === 'top') return { x: box.cx, y: box.cy - box.hh };
        if (a.side === 'bottom') return { x: box.cx, y: box.cy + box.hh };
        if (a.side === 'left') return { x: box.cx - box.hw, y: box.cy };
        if (a.side === 'right') return { x: box.cx + box.hw, y: box.cy };
        return { x: box.cx, y: box.cy };
      }
    }
    return { x: w === 1 ? l.x1 : l.x2, y: w === 1 ? l.y1 : l.y2 };
  };
  lines.forEach((l) => {
    const p1 = resolveEnd(l, 1);
    const p2 = resolveEnd(l, 2);
    if (typeof p1.x === 'number' && typeof p2.x === 'number' && typeof p1.y === 'number' && typeof p2.y === 'number') {
      grow(Math.min(p1.x, p2.x), Math.min(p1.y, p2.y), Math.max(p1.x, p2.x), Math.max(p1.y, p2.y));
    }
  });
  const pad = 30;
  x0 -= pad;
  y0 -= pad;
  x1 += pad;
  y1 += pad;

  // 면은 맨 아래, 테두리·라벨은 맨 위 — 에디터·내보내기와 같은 순서(요청).
  const zoneFills = zones.map((z, i) => <rect key={`zf${i}`} x={z.x} y={z.y} width={z.w} height={z.h} rx={16} fill={hexA(z.color || hue || hueFallback, 0.07)} />);
  const zoneEls = zones.map((z, i) => {
    const zc = z.color || hue || hueFallback;
    const labelW = Math.min(z.w - 20, (z.label || '영역').length * 13 + 24);
    return (
      <g key={`z${i}`}>
        <rect x={z.x} y={z.y} width={z.w} height={z.h} rx={16} fill="none" stroke={hexA(zc, 0.55)} strokeWidth={2} strokeDasharray="7 5" />
        <rect x={z.x + 10} y={z.y - 13} width={labelW} height={26} rx={13} fill={zc} />
        <text x={z.x + 10 + labelW / 2} y={z.y} textAnchor="middle" dominantBaseline="central" fontSize={12.5} fontWeight={700} fill="#fff" fontFamily="Pretendard, sans-serif">
          {z.label || '영역'}
        </text>
      </g>
    );
  });

  // Connector shape follows the doc's edgeStyle (곡선/꺾은선/직선) and layout
  // mode, via the SAME `buildEdgePath` the editor's EdgeLayer uses — previously
  // the preview always drew a cubic curve, ignoring edgeStyle. `buildEdgePath`
  // only special-cases 'down'; radial/right share the sided branch.
  const mode: LayoutMode = d.layoutMode === 'right' || d.layoutMode === 'down' ? d.layoutMode : 'radial';
  const edgeStyle: EdgeStyle = d.edgeStyle === 'elbow' || d.edgeStyle === 'straight' ? d.edgeStyle : 'curve';
  const edgeInX = (id: string): number => (nodes[id]?.shape === 'parallelogram' ? dim(id).w * 0.08 : 0);
  const edges: JSX.Element[] = [];
  ids.forEach((id) => {
    const n = nodes[id]!;
    if (n.parent && nodes[n.parent] && ids.includes(n.parent)) {
      const p = nodes[n.parent]!;
      const pm = dim(n.parent);
      const cm = dim(id);
      const pathD = buildEdgePath(
        mode,
        edgeStyle,
        { x: p.x ?? 0, y: p.y ?? 0, w: pm.w, h: pm.h },
        { x: n.x ?? 0, y: n.y ?? 0, w: cm.w, h: cm.h },
        edgeInX(n.parent),
        edgeInX(id),
      );
      edges.push(
        <path key={`e${id}`} d={pathD} stroke={colorOf(id)} strokeWidth={edgeStrokeWidth(depthOf(id))} fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={0.85} />,
      );
    }
  });

  const rects: JSX.Element[] = [];
  ids.forEach((id) => {
    const n = nodes[id]!;
    const m = dim(id);
    const col = colorOf(id);
    const isRoot = id === root;
    const depth = depthOf(id);
    const fillA = n.fillA == null ? 1 : n.fillA;
    const strokeA = n.strokeA == null ? (depth >= 2 ? 0.5 : 1) : n.strokeA;
    const dFill = n.fill || (isRoot ? hue || hueFallback : TH.panel);
    const dStroke = n.stroke || (isRoot ? hue || hueFallback : col);
    const fill = hexA(dFill, fillA);
    const stroke = hexA(dStroke, strokeA);
    const sw = depth >= 2 ? 1.6 : 2.4;
    const cx = n.x ?? 0;
    const cy = n.y ?? 0;
    const L = cx - m.w / 2;
    const T = cy - m.h / 2;
    const W = m.w;
    const H = m.h;
    const shape = n.shape || 'round';
    if (shape === 'ellipse') {
      rects.push(<ellipse key={`r${id}`} cx={cx} cy={cy} rx={W / 2} ry={H / 2} fill={fill} stroke={stroke} strokeWidth={sw} />);
    } else if (shape === 'hexagon') {
      const c = Math.min(W * 0.18, H * 0.6);
      rects.push(
        <polygon
          key={`r${id}`}
          points={`${L + c},${T} ${L + W - c},${T} ${L + W},${cy} ${L + W - c},${T + H} ${L + c},${T + H} ${L},${cy}`}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
          strokeLinejoin="round"
        />,
      );
    } else if (shape === 'diamond') {
      rects.push(
        <polygon key={`r${id}`} points={`${cx},${T} ${L + W},${cy} ${cx},${T + H} ${L},${cy}`} fill={fill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />,
      );
    } else if (shape === 'parallelogram') {
      const c = W * 0.16;
      rects.push(
        <polygon key={`r${id}`} points={`${L + c},${T} ${L + W},${T} ${L + W - c},${T + H} ${L},${T + H}`} fill={fill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />,
      );
    } else if (shape === 'underline') {
      // no box — just a bottom rule, matching the editor's underline shape
      rects.push(<line key={`r${id}`} x1={L} y1={T + H} x2={L + W} y2={T + H} stroke={stroke} strokeWidth={3} strokeLinecap="round" />);
    } else {
      rects.push(<rect key={`r${id}`} x={L} y={T} width={W} height={H} rx={shape === 'pill' ? H / 2 : shape === 'rect' ? 3 : 9} fill={fill} stroke={stroke} strokeWidth={sw} />);
    }
    // Text colour follows the theme like the editor: root uses `accentInk`
    // (the plain `text` colour for the box-less underline shape), body nodes
    // use the theme `text` colour — both overridden by an explicit `textColor`.
    const baseTextColor = n.textColor || (isRoot ? (shape === 'underline' ? TH.text : TH.accentInk) : TH.text);
    // 하이퍼링크는 에디터와 같은 신호 — 파란 글자 + 밑줄. 파랑은 도형 글자색의
    // 밝기를 보고 고른다(`linkInk`), 런에 지정색이 있으면 그 색이 이긴다.
    const linkFill = linkInk(baseTextColor);
    // Render the text WRAPPED, at the editor's font size (`fpx`) and its exact
    // line breaks (same measurer + token model + content width `MAXW` that
    // `computeMetrics` sized the box with) — so the thumbnail's text flows like
    // the real map instead of a single truncated line.
    const { fpx, fw, wrapW, tw } = metaOf(id, depth);
    // 줄바꿈 폭은 metrics가 실제 사용한 값(wrapW)을 그대로 — cw 과팽창 되돌림
    // (computeMetrics 참고)까지 포함해 에디터와 동일한 줄바꿈을 보장한다.
    const MAXW = wrapW;
    // 굵기도 측정에 쓴 fw 그대로 — 에디터(g.fw)와 동일. 예전엔 600/800으로
    // 더 굵게 그려(측정은 500/700) 렌더 폭이 측정 폭을 몇 % 넘었다.
    const fontWeight = n.bold ? 800 : fw;
    const runs: WrapSeg[] = Array.isArray(n.rich) && n.rich.length ? (n.rich as WrapSeg[]) : [{ t: n.text || '' }];
    const wrapped = wrapRuns(runs, MAXW, fpx, fw, previewMeasurer);
    const hasText = wrapped.some((ln) => ln.segs.some((s) => s.t.trim()));
    // 노드 썸네일: 에디터와 동일한 세로 스택 — 이미지(위) + 텍스트(아래).
    // computeMetrics가 이미 imgH+8만큼 박스를 키워 두므로 배치만 맞춘다.
    const hasNodeImg = !!(n.img && n.imgW && n.imgH);
    const lineHN = Math.round(fpx * 1.4);
    const textBlockH = wrapped.length * lineHN;
    const imgShift = hasNodeImg ? (n.imgH! + 8) / 2 : 0;
    if (hasNodeImg) {
      const src = drawableImg(n.img);
      const ix = cx - n.imgW! / 2;
      const iy = cy - (textBlockH + 8) / 2 - n.imgH! / 2;
      if (src) rects.push(<image key={`img${id}`} href={src} x={ix} y={iy} width={n.imgW} height={n.imgH} preserveAspectRatio="xMidYMid slice" />);
      else rects.push(imgPlaceholder(`img${id}`, ix, iy, n.imgW!, n.imgH!, 8));
    }
    // 에디터(NodeLayer)의 가로 배치 재현: 패딩 안쪽(도형은 tw 폭의 중앙 스트립)에
    // [이모지(고정폭, 좌측 고정)][gap 7][텍스트 블록(남은 폭, n.align 정렬)].
    // 예전엔 이모지를 fpx 크기로 1행 앞에 붙이고 항상 중앙 정렬만 했다 — 정렬
    // 미반영·이모지 크기 상이·접두 폭만큼 1행이 도형을 벗어나는 세 문제의 원인.
    const padX = depth === 0 ? 24 : depth === 1 ? 15 : 13;
    const boxPadX = shape === 'parallelogram' ? 22 : padX;
    const clipShape = shape === 'hexagon' || shape === 'diamond' || shape === 'parallelogram' || shape === 'ellipse' || shape === 'pill';
    const contentW = Math.max(0, W - boxPadX * 2);
    const stripW = clipShape ? Math.min(tw, contentW) : contentW;
    const stripL = cx - stripW / 2;
    const emojiPx = depth === 0 ? 22 : 17;
    const emojiW = n.emoji ? previewMeasurer.measure(n.emoji, `${emojiPx}px Pretendard`) : 0;
    const textL = stripL + (n.emoji ? emojiW + 7 : 0);
    const textR = stripL + stripW;
    const align = n.align === 'left' || n.align === 'right' ? n.align : 'center';
    const anchor = align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle';
    const tx = align === 'left' ? textL : align === 'right' ? textR : (textL + textR) / 2;
    if (n.emoji) {
      rects.push(
        <text key={`em${id}`} x={stripL} y={cy + imgShift} textAnchor="start" dominantBaseline="central" fontSize={emojiPx} fontFamily="Pretendard, sans-serif">
          {n.emoji}
        </text>,
      );
    }
    if (hasText) {
      const lineH = lineHN;
      const startY = cy + imgShift - ((wrapped.length - 1) * lineH) / 2;
      rects.push(
        // 글자를 세로 가운데 맞추는 기준선. `middle`(x-height 중앙)이라 **이 줄의 y가
        // 곧 취소선 자리**다 — 아래 `decoRects`가 그 관계를 쓴다.
        <text key={`t${id}`} x={tx} y={startY} textAnchor={anchor} dominantBaseline="middle" fontSize={fpx} fontWeight={fontWeight} fill={baseTextColor} fontFamily="Pretendard, sans-serif">
          {wrapped.map((ln, li) => (
            // 리스트 줄: 항목 블록을 사용자 정렬대로 놓고(에디터 `ListTextBlock`의
            // `justifyContent`와 같은 결과) 그 안에서 행잉 인덴트로 그린다.
            // 첫 줄 segs에는 표시 마커(• )가 포함돼 있다.
            <tspan
              key={li}
              x={ln.list ? textL + ln.indent : tx}
              textAnchor={ln.list ? 'start' : undefined}
              dy={li === 0 ? 0 : lineH}
            >
              {ln.segs.map((s, si) => (
                <tspan
                  key={si}
                  fontWeight={s.b ? 800 : undefined}
                  fill={s.c || (s.href ? linkFill : undefined)}
                  fontStyle={s.i ? 'italic' : undefined}
                  // 밑줄·취소선은 `text-decoration`이 아니라 아래 `decoRects`가 직접
                  // 그린다 — 이유는 그쪽 주석 참고.
                >
                  {s.t}
                </tspan>
              ))}
            </tspan>
          ))}
        </text>,
      );
      // 밑줄·취소선(장식)은 글자 위에 겹쳐 그린다 — `text-decoration`을 쓰지 않는
      // 이유는 `decoRects` 주석 참고.
      wrapped.forEach((ln, li) => {
        if (!ln.segs.some((sg) => sg.s || sg.href)) return;
        const listLeft = textL + ln.indent;
        rects.push(...decoRects(`d${id}-${li}`, ln.segs, lineLeftOf(ln, listLeft, tx, align), startY + li * lineH, fpx, baseTextColor, linkFill));
      });
    }
  });

  const lineEls: JSX.Element[] = [];
  lines.forEach((l, i) => {
    const P0 = resolveEnd(l, 1);
    const P3 = resolveEnd(l, 2);
    if (typeof P0.x !== 'number' || typeof P3.x !== 'number' || typeof P0.y !== 'number' || typeof P3.y !== 'number') return;
    const c1 = l.c1 != null ? l.c1 : l.curve || 0;
    const c2 = l.c2 != null ? l.c2 : l.curve || 0;
    const len = Math.hypot(P3.x - P0.x, P3.y - P0.y) || 1;
    const nx = -(P3.y - P0.y) / len;
    const ny = (P3.x - P0.x) / len;
    const C1 = { x: P0.x + (P3.x - P0.x) / 3 + nx * c1, y: P0.y + (P3.y - P0.y) / 3 + ny * c1 };
    const C2 = { x: P0.x + (2 * (P3.x - P0.x)) / 3 + nx * c2, y: P0.y + (2 * (P3.y - P0.y)) / 3 + ny * c2 };
    const lc = l.color || hue || hueFallback;
    lineEls.push(
      <path key={`lp${i}`} d={`M ${P0.x} ${P0.y} C ${C1.x} ${C1.y} ${C2.x} ${C2.y} ${P3.x} ${P3.y}`} stroke={lc} strokeWidth={2.2} fill="none" strokeDasharray={l.dashed === false ? 'none' : '7 7'} />,
    );
    const arrow = (P: { x: number; y: number }, C: { x: number; y: number }, key: string) => {
      const ang = Math.atan2(P.y - C.y, P.x - C.x);
      const s = 9;
      lineEls.push(
        <polygon key={key} points={`${P.x},${P.y} ${P.x - Math.cos(ang - 0.45) * s},${P.y - Math.sin(ang - 0.45) * s} ${P.x - Math.cos(ang + 0.45) * s},${P.y - Math.sin(ang + 0.45) * s}`} fill={lc} />,
      );
    };
    if (l.startArrow) arrow(P0 as { x: number; y: number }, C1, `la${i}`);
    if (l.endArrow) arrow(P3 as { x: number; y: number }, C2, `lb${i}`);
    if (l.label && l.label.trim()) {
      const mid = { x: (P0.x + 3 * C1.x + 3 * C2.x + P3.x) / 8, y: (P0.y + 3 * C1.y + 3 * C2.y + P3.y) / 8 };
      const lw = Math.min(160, l.label.length * 13 + 16);
      lineEls.push(<rect key={`lr${i}`} x={mid.x - lw / 2} y={mid.y - 11} width={lw} height={22} rx={6} fill="#fff" stroke={hexA(lc, 0.5)} strokeWidth={1} />);
      lineEls.push(
        <text key={`lt${i}`} x={mid.x} y={mid.y} textAnchor="middle" dominantBaseline="central" fontSize={11.5} fontWeight={600} fill={l.ltextColor || '#33281f'} fontFamily="Pretendard, sans-serif">
          {l.label}
        </text>,
      );
    }
  });

  // 맵에서 이미지 플로트는 영역보다 **아래**, 메모는 영역 경계보다 **위**다
  // (에디터 z 5 < 영역 8·9 < 메모 10 — 요청). 두 갈래로 모아 종류별로 끼운다.
  const imgEls: JSX.Element[] = [];
  const memoEls: JSX.Element[] = [];
  floats.forEach((f, i) => {
    const floatEls = f.img ? imgEls : memoEls;
    const fw = f.w || 160;
    const fh = floatH(f);
    // 이미지 플로트: 메모 카드가 아니라 이미지 자체 (에디터 FloatLayer와 동일).
    if (f.img) {
      const src = drawableImg(f.img);
      if (src) {
        floatEls.push(<image key={`fi${i}`} href={src} x={f.x} y={f.y} width={fw} height={fh} preserveAspectRatio="xMidYMid slice" />);
        floatEls.push(<rect key={`fr${i}`} x={f.x} y={f.y} width={fw} height={fh} rx={8} fill="none" stroke={hexA('#000000', 0.14)} strokeWidth={1.4} />);
      } else {
        floatEls.push(imgPlaceholder(`fi${i}`, f.x, f.y, fw, fh, 8));
      }
      return;
    }
    const bg = f.bg || '#fdf6c9';
    const bd = f.bg ? hexA('#8a7365', 0.35) : '#e8d982';
    floatEls.push(<rect key={`fr${i}`} x={f.x} y={f.y} width={fw} height={fh} rx={8} fill={bg} stroke={bd} strokeWidth={1.4} />);
    // Full text, WRAPPED like the editor's memo card: same font size, padding
    // (top 9, left 32 for the fold toggle, right 11) and inner wrap width, so
    // every line shows instead of one truncated line.
    const ffpx = f.tsize === 's' ? 11.5 : f.tsize === 'l' ? 15.5 : 13;
    const flh = ffpx * 1.55;
    const bold = !!f.bold;
    const innerW = Math.max(8, fw - floatPadLeft() - 11);
    // 접기는 제거됐다(요청) — 메모는 항상 펼쳐 그린다(에디터 FloatLayer와 동일).
    const floatRuns: WrapSeg[] = Array.isArray(f.rich) && f.rich.length ? (f.rich as WrapSeg[]) : [{ t: f.text || '' }];
    const lines: WrapLine[] = wrapRuns(floatRuns, innerW, ffpx, bold ? 700 : 400, previewMeasurer);
    if (lines.some((ln) => ln.segs.some((s) => s.t.trim()))) {
      const textX = f.x + floatPadLeft();
      const firstY = f.y + 9 + flh / 2; // centre of the first line box (top pad 9)
      const fBase = f.textColor || '#5a4a3a';
      const fLink = linkInk(fBase);
      floatEls.push(
        // 노드 본문과 같은 규칙: `middle` = 장식(rect) 위치의 기준(decoRects 참고).
        <text key={`ft${i}`} x={textX} y={firstY} dominantBaseline="middle" fontSize={ffpx} fontWeight={bold ? 700 : 400} fill={fBase} fontFamily="Pretendard, sans-serif">
          {lines.map((ln, li) => (
            <tspan key={li} x={textX + ln.indent} dy={li === 0 ? 0 : flh}>
              {ln.segs.map((sg, si) => (
                <tspan key={si} fontWeight={sg.b ? 800 : undefined} fill={sg.c || (sg.href ? fLink : undefined)} fontStyle={sg.i ? 'italic' : undefined}>
                  {sg.t}
                </tspan>
              ))}
            </tspan>
          ))}
        </text>,
      );
      // 밑줄·취소선 — 노드와 같은 `decoRects`(메모는 좌측 정렬이라 줄 왼쪽이 곧 textX+indent).
      lines.forEach((ln, li) => {
        if (!ln.segs.some((sg) => sg.s || sg.href)) return;
        floatEls.push(...decoRects(`fd${i}-${li}`, ln.segs, textX + ln.indent, firstY + li * flh, ffpx, fBase, fLink));
      });
    }
  });

  return (
    <svg viewBox={`${x0} ${y0} ${x1 - x0} ${y1 - y0}`} width="88%" height="88%" preserveAspectRatio="xMidYMid meet" style={{ display: 'block' }}>
      {/* 맵: 이미지는 영역 아래, 영역 경계·라벨도 콘텐츠 아래(요청 — 에디터 z와 동일).
          board: 기존 순서 그대로(경계·라벨이 맨 위). */}
      {board ? null : imgEls}
      {zoneFills}
      {board ? null : zoneEls}
      {edges}
      {rects}
      {lineEls}
      {board ? imgEls : null}
      {memoEls}
      {/* 그리기 획은 에디터·내보내기와 같이 잉크가 객체를 덮는다. */}
      {strokes.map((st) => (
        <path
          key={`sk-${st.id}`}
          d={strokePathD(st.pts)}
          fill="none"
          stroke={st.color}
          strokeWidth={st.w}
          strokeLinecap="round"
          strokeLinejoin="round"
          {...(isHighlighter(st) ? { opacity: HL_OPACITY, style: { mixBlendMode: 'multiply' as const } } : {})}
        />
      ))}
      {board ? zoneEls : null}
    </svg>
  );
}

/** Shimmer placeholder shown in a card thumbnail WHILE the map's real body is
 * still being prefetched (`DocStore.load()`), so the card doesn't first flash
 * the generic `miniPreview` and then swap to the real nodes. Fills the fixed
 * `.map-thumb` box. */
export function previewSkeleton(): JSX.Element {
  return <div className="mf-skel" aria-hidden="true" style={{ width: '100%', height: '100%' }} />;
}

/* ── 칸반 썸네일 ─────────────────────────────────────────────────────────────
 * 칸반은 캔버스가 아니라 **열과 카드**다 — 마인드맵의 레이아웃·측정 기계를 태울
 * 것이 없으므로(좌표가 문서에 없다) 에디터의 고정 배치를 축소해 그대로 그린다.
 * 열 폭·간격·카드 높이는 에디터 `KanbanBoard`의 비율을 따르고, 화면에 안 들어가는
 * 카드는 "+N"으로 접는다(카드가 많은 열이 썸네일을 벽으로 만들지 않게). */
const KB_COL_W = 96;
const KB_GAP = 10;
const KB_PAD = 9;
const KB_H = 150;
const KB_CARD_GAP = 5;
/** 카드 높이 — 분류 배지가 있으면 한 줄이 더 붙는다(에디터와 같은 구성). */
const KB_CARD_H = 22;
const KB_CARD_TAG_H = 31;
const KB_CARD_GAP_BOTTOM = 10;
/** 열이 시작되는 높이 — 위쪽은 진행 바와, 카드 우상단의 '칸반 보드' 배지 자리다
 * (그러지 않으면 배지가 마지막 열의 제목을 덮는다). */
const KB_TOP = 24;
const KB_CARDS_TOP = KB_TOP + 22;
/** 진행 바 — 에디터 보드 머리의 그 줄(열 색 구간). 썸네일에서 "칸반"임을 가장
 * 먼저 알리는 표식이라 열보다 위에 그대로 둔다. */
const KB_BAR_Y = 10;
const KB_BAR_H = 4;

/** 한 줄에 들어갈 만큼만 남기고 뒤를 …로 접는다(실측 폭 기준). */
function kbClip(text: string, maxW: number, font: string): string {
  const one = (text || '').split('\n')[0] ?? '';
  if (!one) return '';
  if (previewMeasurer.measure(one, font) <= maxW) return one;
  let lo = 0;
  let hi = one.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (previewMeasurer.measure(`${one.slice(0, mid)}…`, font) <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? `${one.slice(0, lo)}…` : '…';
}

function kanbanPreview(d: PreviewDoc): JSX.Element | null {
  const columns = d.columns ?? [];
  const cards = d.cards ?? [];
  if (!columns.length) return null;
  const th = UI_THEME;
  const W = KB_PAD * 2 + columns.length * KB_COL_W + (columns.length - 1) * KB_GAP;
  const innerW = KB_COL_W - 16;
  const titleFont = '700 11px Pretendard, system-ui, sans-serif';
  const cardFont = '600 10px Pretendard, system-ui, sans-serif';
  const tagFont = '700 8px Pretendard, system-ui, sans-serif';
  const bottom = KB_H - KB_PAD;
  const barW = W - KB_PAD * 2;
  const progress = boardProgress(columns, cards, th.palette);
  let segX = KB_PAD;

  return (
    <svg data-kanban-preview viewBox={`0 0 ${W} ${KB_H}`} width="94%" height="94%" preserveAspectRatio="xMidYMid meet" style={{ display: 'block' }}>
      {/* 진행 바 — 완료부터 왼쪽에서 차고 첫 열은 빈 트랙(에디터와 같은 규칙). */}
      <rect x={KB_PAD} y={KB_BAR_Y} width={barW} height={KB_BAR_H} rx={KB_BAR_H / 2} fill={th.border} />
      {progress.segments.map((seg) => {
        const w = (seg.pct / 100) * barW;
        const el = <rect key={seg.id} x={segX} y={KB_BAR_Y} width={Math.max(0, w)} height={KB_BAR_H} fill={seg.color} />;
        segX += w;
        return el;
      })}

      {columns.map((col, ci) => {
        const x = KB_PAD + ci * (KB_COL_W + KB_GAP);
        const list = cardsInColumn(cards, col.id);
        // 카드 높이가 제각각이라(분류 배지 유무) 들어가는 만큼 쌓고 나머지를 접는다.
        const laid: { card: (typeof list)[number]; y: number; h: number }[] = [];
        let cy = KB_CARDS_TOP;
        for (const c of list) {
          const h = c.tag ? KB_CARD_TAG_H : KB_CARD_H;
          if (cy + h > bottom - KB_CARD_GAP_BOTTOM) break;
          laid.push({ card: c, y: cy, h });
          cy += h + KB_CARD_GAP;
        }
        const hidden = list.length - laid.length;
        return (
          <g key={col.id}>
            {/* 열 — 배경은 사용자가 고른 색(`col.bg`)이 있으면 그것(에디터와 동일). */}
            <rect x={x} y={KB_TOP} width={KB_COL_W} height={bottom - KB_TOP} rx={8} fill={columnBg(col, th)} stroke={th.border} strokeWidth={1} />
            <circle cx={x + 11} cy={KB_TOP + 12} r={3} fill={columnColor(col, ci, th.palette)} />
            <text x={x + 18} y={KB_TOP + 12} fontSize={10.5} fontWeight={700} fill={th.text} dominantBaseline="middle" fontFamily="Pretendard, system-ui, sans-serif">
              {kbClip(col.title, innerW - 12, titleFont)}
            </text>

            {laid.map(({ card: c, y, h }) => {
              const tagCol = c.tag ? tagColor(c.tag, th.palette, d.tags ?? []) : null;
              const tagText = c.tag ? kbClip(c.tag, innerW - 12, tagFont) : '';
              const tagW = tagText ? Math.min(innerW, previewMeasurer.measure(tagText, tagFont) + 9) : 0;
              return (
                <g key={c.id}>
                  <rect x={x + 8} y={y} width={innerW} height={h} rx={5} fill={c.bg || th.panel} stroke={th.border} strokeWidth={1} />
                  {tagCol && (
                    <>
                      <rect x={x + 13} y={y + 5} width={tagW} height={10} rx={3} fill={hexA(tagCol, 0.16)} />
                      <text x={x + 17.5} y={y + 10.5} fontSize={8} fontWeight={700} fill={tagInk(tagCol, th.text)} dominantBaseline="middle" fontFamily="Pretendard, system-ui, sans-serif">
                        {tagText}
                      </text>
                    </>
                  )}
                  <text
                    x={x + 13}
                    y={tagCol ? y + 23 : y + h / 2}
                    fontSize={10}
                    fontWeight={600}
                    fill={th.text}
                    dominantBaseline="middle"
                    fontFamily="Pretendard, system-ui, sans-serif"
                  >
                    {kbClip(c.text, innerW - 10, cardFont)}
                  </text>
                </g>
              );
            })}

            {hidden > 0 && (
              <text x={x + 13} y={bottom - 5} fontSize={9.5} fontWeight={600} fill={th.subtext} fontFamily="Pretendard, system-ui, sans-serif">
                {`+${hidden}`}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * 화이트보드용 폴백 삽화 — 본문을 아직 못 받았거나(백엔드 지연) 내용이 정말
 * 비어 있는 보드 카드에 뜬다. 예전에는 종류와 무관하게 `miniPreview`(가지 뻗은
 * 마인드맵)를 그려서 **화이트보드 배지가 붙은 카드에 마인드맵 그림**이 나왔다(제보).
 *
 * 그림은 갤러리의 '빈 화이트보드' 카드와 같은 어휘(스티커 두 장 + 사진 + 잉크
 * 자국)로 그린다 — 같은 것을 가리키는 자리는 같은 그림이어야 한다. 색은 카드
 * 색조(hue)를 따라 마인드맵 폴백과 톤이 어긋나지 않게.
 */
export function miniBoardPreview(hue: string): JSX.Element {
  return (
    <svg data-board-sketch viewBox="0 0 300 150" width="76%" height="76%" style={{ display: 'block' }}>
      {/* 스티커 두 장 — 메모 카드(노란 종이)의 축소 */}
      <rect x={38} y={30} width={92} height={62} rx={7} fill="#fdf3c7" stroke="#e6d38a" strokeWidth={1.6} />
      <rect x={50} y={48} width={62} height={4} rx={2} fill="#c9b26a" opacity={0.75} />
      <rect x={50} y={60} width={44} height={4} rx={2} fill="#c9b26a" opacity={0.55} />
      <rect x={150} y={62} width={92} height={58} rx={7} fill="#fff" stroke={hexA(hue, 0.5)} strokeWidth={1.6} />
      {/* 사진(이미지 플로트) — 산 능선 한 줄 */}
      <path d={`M 156 112 l 18 -20 l 13 13 l 12 -12 l 26 27 Z`} fill={hexA(hue, 0.22)} />
      <circle cx={170} cy={78} r={5} fill={hexA(hue, 0.35)} />
      {/* 손으로 그은 잉크 한 줄 — 보드의 그리기 */}
      <path d="M 44 116 C 74 104 96 128 124 116 S 168 132 196 126" stroke={hue} strokeWidth={3} fill="none" strokeLinecap="round" opacity={0.85} />
    </svg>
  );
}

/**
 * 칸반 카드의 폴백 삽화 — 열 셋과 그 안의 카드 몇 장.
 *
 * 칸반은 캔버스가 아니라 열·카드 화면이라 `realPreview`(노드·메모 좌표를 그리는
 * 렌더러)가 그릴 것이 없다. 갤러리의 '새 칸반 보드' 카드와 같은 도형을 쓴다.
 */
export function miniKanbanPreview(hue: string): JSX.Element {
  const col = (x: number, cards: number[]): JSX.Element => (
    <g key={x}>
      <rect x={x} y={16} width={72} height={118} rx={7} fill={hexA(hue, 0.06)} stroke={hexA(hue, 0.35)} strokeWidth={1.4} />
      <rect x={x + 10} y={26} width={34} height={5} rx={2.5} fill={hexA(hue, 0.55)} />
      {cards.map((y) => (
        <rect key={y} x={x + 8} y={y} width={56} height={22} rx={4} fill="#fff" stroke={hexA(hue, 0.4)} strokeWidth={1.3} />
      ))}
    </g>
  );
  return (
    <svg data-kanban-sketch viewBox="0 0 300 150" width="80%" height="80%" style={{ display: 'block' }}>
      {col(24, [40, 70, 100])}
      {col(114, [40, 70])}
      {col(204, [40])}
    </svg>
  );
}

/** Home.dc.html `miniPreview(hue, seed)` — deterministic decorative sketch for maps
 * that have never been opened/saved (no real node positions yet). */
export function miniPreview(hue: string, seed: string): JSX.Element {
  let s = 0;
  const key = String(seed || hue);
  for (let i = 0; i < key.length; i++) s = (s * 31 + key.charCodeAt(i)) >>> 0;
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return (s % 1000) / 1000;
  };
  const palette = ['#f0663f', '#f0913f', '#3fae9e', '#3f8fd0', '#8a6bd1', '#d0568f', '#5aab45'];
  const cx = 150;
  const cy = 75;
  const rowsR = [42, 75, 108];
  const rowsL = [50, 100];
  const branches: { x: number; y: number; side: number; w: number; c: string }[] = [];
  rowsR.forEach((y, i) => branches.push({ x: 232, y: y + (rnd() * 10 - 5), side: 1, w: 44 + Math.round(rnd() * 20), c: palette[(i + Math.floor(rnd() * 3)) % palette.length]! }));
  rowsL.forEach((y, i) => branches.push({ x: 40, y: y + (rnd() * 10 - 5), side: -1, w: 40 + Math.round(rnd() * 18), c: palette[(i + 3 + Math.floor(rnd() * 3)) % palette.length]! }));

  const edges = branches.map((b, i) => {
    const sx = cx + (b.side > 0 ? 34 : -34);
    const ex = b.x + (b.side > 0 ? 0 : b.w);
    const mx = (sx + ex) / 2;
    return <path key={`e${i}`} d={`M ${sx} ${cy} C ${mx} ${cy} ${mx} ${b.y + 8} ${ex} ${b.y + 8}`} stroke={b.c} strokeWidth={2} fill="none" opacity={0.75} />;
  });
  const leaves = branches.map((b, i) => <rect key={`r${i}`} x={b.x} y={b.y} width={b.w} height={16} rx={5} fill="#fff" stroke={b.c} strokeWidth={1.6} />);

  return (
    <svg viewBox="0 0 300 150" width="82%" height="82%" style={{ display: 'block' }}>
      {edges}
      {leaves}
      <rect x={cx - 34} y={cy - 13} width={68} height={26} rx={8} fill={hue} />
      <rect x={cx - 22} y={cy - 4} width={44} height={3} rx={1.5} fill="#fff" opacity={0.85} />
    </svg>
  );
}

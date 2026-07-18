import { ROOT_ID, layout } from '@mindflow/mindmap-core';
import type { Doc, EdgeStyle, LayoutMode, Node as CoreNode } from '@mindflow/mindmap-core';
import { buildEdgePath, edgeStrokeWidth } from '../editor/edges';
import { hexA } from './storage';

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
  /** Partial rich-text runs (bold/color spans); mirrors core `RichRun`. */
  rich?: Array<{ t: string; b?: boolean; c?: string | null }> | null;
  children?: string[];
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
}

/** Node sizing for the preview layout — mirrors `dim()` below (and the design's
 * `realPreview`) so a re-laid-out thumbnail lines up with what the editor draws. */
function previewSizeOf(node: CoreNode, depth: number): { w: number; h: number } {
  const len = ((node.text || '') + (node.emoji || '')).length;
  const w = node.cw || Math.min(220, Math.max(50, len * 13 + 26));
  const h = node.ch || (depth === 0 ? 44 : 32);
  return { w, h };
}

/** Saved docs persist layout-derived node x/y as `0`: the React editor keeps
 * layout pure/derived (`mindmap-core`) and never writes positions back into the
 * doc, unlike the dc original which mutated `node.x/y` in place. Without this the
 * thumbnail would pile every node at the origin — the same blob for every map.
 * Re-run the SAME core `layout` the editor uses (respecting the doc's layoutMode)
 * so the preview matches the real arrangement. Mutates `d.nodes` x/y in place;
 * free shapes and their subtrees keep their stored positions (layout anchors
 * them there), so this is safe for docs that already carry real coordinates. */
function applyLayoutPositions(d: PreviewDoc): void {
  const nodes = d.nodes;
  if (!nodes || !nodes[ROOT_ID]) return; // no canonical root → keep stored coords
  const mode: LayoutMode = d.layoutMode === 'right' || d.layoutMode === 'down' ? d.layoutMode : 'radial';
  try {
    const laid = layout({ nodes } as unknown as Doc, mode, previewSizeOf);
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

export function realPreview(rawDoc: string | null, hueFallback: string): JSX.Element | null {
  if (!rawDoc) return null;
  let d: PreviewDoc;
  try {
    d = JSON.parse(rawDoc) as PreviewDoc;
  } catch {
    return null;
  }
  if (!d || !d.nodes) return null;
  applyLayoutPositions(d);

  const TH = (d.themeKey && THEME_PAL[d.themeKey]) || THEME_PAL.coral!;
  const hue = TH.accent;
  const nodes = d.nodes;
  const ids = Object.keys(nodes).filter((k) => typeof nodes[k]?.x === 'number' && typeof nodes[k]?.y === 'number');
  if (!ids.length) return null;
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

  const dim = (id: string): { w: number; h: number } => {
    const n = nodes[id]!;
    const len = ((n.text || '') + (n.emoji || '')).length;
    const w = n.cw || Math.min(220, Math.max(50, len * 13 + 26));
    const h = n.ch || (id === root ? 44 : 32);
    return { w, h };
  };

  const floats = Array.isArray(d.floats) ? d.floats : [];
  const zones = Array.isArray(d.zones) ? d.zones : [];
  const lines = Array.isArray(d.lines) ? d.lines : [];
  const floatH = (f: DocFloat) => (f.collapsed ? 30 : f.h || 44);

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

  const zoneEls = zones.map((z, i) => {
    const zc = z.color || hue || hueFallback;
    const labelW = Math.min(z.w - 20, (z.label || '영역').length * 13 + 24);
    return (
      <g key={`z${i}`}>
        <rect x={z.x} y={z.y} width={z.w} height={z.h} rx={16} fill={hexA(zc, 0.07)} stroke={hexA(zc, 0.55)} strokeWidth={2} strokeDasharray="7 5" />
        <rect x={z.x + 10} y={z.y - 13} width={labelW} height={26} rx={13} fill={zc} />
        <text x={z.x + 10 + labelW / 2} y={z.y} textAnchor="middle" dominantBaseline="central" fontSize={12.5} fontWeight={700} fill="#fff" fontFamily="Pretendard, sans-serif">
          {z.label || '영역'}
        </text>
      </g>
    );
  });

  const depthOf = (id: string): number => {
    let dep = 0;
    let cur: DocNode | undefined = nodes[id];
    let guard = 0;
    while (cur && cur.parent && guard++ < 50) {
      dep++;
      cur = nodes[cur.parent];
    }
    return dep;
  };

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
    const fontSize = (isRoot ? 17 : 14) * (n.tsize === 's' ? 0.85 : n.tsize === 'l' ? 1.2 : 1);
    const fontWeight = n.bold ? 800 : isRoot ? 800 : 600;
    const runs = Array.isArray(n.rich) && n.rich.length ? n.rich : null;
    if (runs) {
      // Partial rich runs (per-span bold/colour) — render as tspans, budgeting
      // ~14 chars total (after the emoji prefix) to match the plain-text clamp.
      const emojiPrefix = n.emoji ? `${n.emoji} ` : '';
      let budget = 14 - emojiPrefix.length;
      const tspans: JSX.Element[] = [];
      for (let ri = 0; ri < runs.length && budget > 0; ri++) {
        const r = runs[ri]!;
        let t = (r.t || '').split('\n')[0] ?? '';
        if (!t) continue;
        if (t.length > budget) t = t.slice(0, Math.max(0, budget - 1)) + '…';
        budget -= t.length;
        tspans.push(
          <tspan key={ri} fontWeight={r.b ? 800 : undefined} fill={r.c || undefined}>
            {t}
          </tspan>,
        );
      }
      rects.push(
        <text key={`t${id}`} x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fontSize={fontSize} fontWeight={fontWeight} fill={baseTextColor} fontFamily="Pretendard, sans-serif">
          {emojiPrefix}
          {tspans}
        </text>,
      );
    } else {
      const rawLabel = `${n.emoji || ''} ${n.text || ''}`.trim().split('\n')[0] ?? '';
      if (rawLabel) {
        rects.push(
          <text key={`t${id}`} x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fontSize={fontSize} fontWeight={fontWeight} fill={baseTextColor} fontFamily="Pretendard, sans-serif">
            {rawLabel.length > 14 ? rawLabel.slice(0, 13) + '…' : rawLabel}
          </text>,
        );
      }
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

  const floatEls: JSX.Element[] = [];
  floats.forEach((f, i) => {
    const fw = f.w || 160;
    const fh = floatH(f);
    const bg = f.bg || '#fdf6c9';
    const bd = f.bg ? hexA('#8a7365', 0.35) : '#e8d982';
    floatEls.push(<rect key={`fr${i}`} x={f.x} y={f.y} width={fw} height={fh} rx={8} fill={bg} stroke={bd} strokeWidth={1.4} />);
    const line1 = ((f.text || '').split('\n')[0] || '').trim();
    if (line1) {
      const fontSize = 12 * (f.tsize === 's' ? 0.9 : f.tsize === 'l' ? 1.15 : 1);
      const maxChars = Math.floor(fw / 11);
      floatEls.push(
        <text key={`ft${i}`} x={f.x + 10} y={f.y + 16} fontSize={fontSize} fontWeight={f.bold ? 800 : 500} fill={f.textColor || '#5a4a3a'} fontFamily="Pretendard, sans-serif">
          {line1.length > maxChars ? line1.slice(0, maxChars - 1) + '…' : line1}
        </text>,
      );
    }
  });

  return (
    <svg viewBox={`${x0} ${y0} ${x1 - x0} ${y1 - y0}`} width="88%" height="88%" preserveAspectRatio="xMidYMid meet" style={{ display: 'block' }}>
      {zoneEls}
      {edges}
      {rects}
      {lineEls}
      {floatEls}
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

// PNG export — simplified web-layer port of `Component#exportSVGString` +
// `#exportPNG` (MindFlow.dc.html:638-771). The original rasterizes an SVG
// string (so it can reuse crisp vector shapes/arrows) and re-draws only the
// `<text>` nodes on top with canvas `fillText` (browser SVG rasterization
// can't access the page's `Pretendard` font). This port skips the
// SVG-round-trip and draws everything directly with the Canvas 2D API — the
// same visual pieces (canvas bg, zones, curved tree edges, node shapes, free
// lines + arrows/labels, memos) but a plainer implementation (soft-wraps node
// labels to the box width like the canvas, but no shadow/gradient touches).
// Canvas is a rendering concern, so this lives in the web layer, not
// `@mindflow/mindmap-core`.
//
// In environments without a real `CanvasRenderingContext2D` (e.g. jsdom in
// unit tests), this is a no-op — matching `metrics.ts`'s `CanvasTextMeasurer`
// fallback philosophy: never throw, just skip the unavailable capability.

import type { Box, Doc, Float, Line, LineAnchor, Node } from '@mindflow/mindmap-core';
import { ROOT_ID, cubicAt, layout, resolveLineEndpoints, resolveLineGeometry } from '@mindflow/mindmap-core';
import { colorOf, buildVisible } from './tree';
import type { EdgeStyle } from './tree';
import { buildEdgePath, edgeStrokeWidth } from './edges';
import { hexA } from './theme';
import type { Theme } from './theme';
import { CanvasTextMeasurer, computeMetrics } from './metrics';
import type { GeomMap, NodeGeom } from './types';
import { downloadFile } from './download';

const PAD = 46;

/** Soft-wrap `text` to `maxW` px with the ctx's CURRENT font, mirroring the
 * editor's `wrapMeasure` token model (whitespace-preserving, breaks between CJK
 * chars) — so a long node label wraps in the PNG exactly as it does on canvas,
 * instead of running off on one line. */
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const hard of String(text).split('\n')) {
    if (!hard) {
      out.push('');
      continue;
    }
    const tokens = hard.match(/[A-Za-z0-9]+|\s+|./gu) || [hard];
    let line = '';
    let lineW = 0;
    for (const tk of tokens) {
      const w = ctx.measureText(tk).width;
      const isSpace = /^\s+$/.test(tk);
      if (line && lineW + w > maxW && !isSpace) {
        out.push(line);
        line = isSpace ? '' : tk;
        lineW = isSpace ? 0 : w;
      } else {
        line += tk;
        lineW += w;
      }
    }
    out.push(line);
  }
  return out.length ? out : [''];
}

/** `ctx.roundRect` isn't in every lib.dom.d.ts version this repo might build against — draw it by hand. */
function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function depthOf(nodes: Doc['nodes'], id: string): number {
  let d = 0;
  let n = nodes[id];
  while (n && n.parent) {
    d++;
    n = nodes[n.parent];
  }
  return d;
}

function drawNodeShape(ctx: CanvasRenderingContext2D, n: Node, x: number, y: number, w: number, h: number): void {
  const shape = n.shape || 'round';
  ctx.beginPath();
  if (shape === 'ellipse') {
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  } else if (shape === 'diamond') {
    ctx.moveTo(x + w / 2, y);
    ctx.lineTo(x + w, y + h / 2);
    ctx.lineTo(x + w / 2, y + h);
    ctx.lineTo(x, y + h / 2);
    ctx.closePath();
  } else if (shape === 'hexagon') {
    const c = Math.min(w * 0.18, h * 0.6);
    ctx.moveTo(x + c, y);
    ctx.lineTo(x + w - c, y);
    ctx.lineTo(x + w, y + h / 2);
    ctx.lineTo(x + w - c, y + h);
    ctx.lineTo(x + c, y + h);
    ctx.lineTo(x, y + h / 2);
    ctx.closePath();
  } else if (shape === 'parallelogram') {
    const c = w * 0.16;
    ctx.moveTo(x + c, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w - c, y + h);
    ctx.lineTo(x, y + h);
    ctx.closePath();
  } else {
    const r = shape === 'pill' ? h / 2 : shape === 'rect' ? 3 : 10;
    const rr = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }
}

/** Best-effort canvas 2D context — returns `null` when unavailable (headless/test env). */
function get2dContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  try {
    const ctx = canvas.getContext('2d');
    return ctx && typeof ctx.fillRect === 'function' ? ctx : null;
  } catch {
    return null;
  }
}

/** Line-anchor box lookup (port of `Component#lineTargetBox`, MindFlow.dc.html:2377-2390),
 * built from the same `doc`/`geom` snapshot the rest of `exportPng` draws from — so an
 * anchored free line renders pinned to its node/float port in the exported PNG too, not
 * its (possibly stale) raw x/y. */
function boxOfAnchor(anchor: LineAnchor, doc: Doc, geom: GeomMap): Box | null {
  if (anchor.kind === 'node') {
    const g = geom[anchor.id];
    return g ? { cx: g.x, cy: g.y, hw: g.w / 2, hh: g.h / 2 } : null;
  }
  const f = doc.floats.find((x) => x.id === anchor.id);
  if (!f) return null;
  const h = f.h || 44;
  return { cx: f.x + f.w / 2, cy: f.y + h / 2, hw: f.w / 2, hh: h / 2 };
}

function lineGeom(l: Line, doc: Doc, geom: GeomMap) {
  const ep = resolveLineEndpoints(l, (a) => boxOfAnchor(a, doc, geom));
  return resolveLineGeometry({ ...l, ...ep });
}

interface FloatBox {
  w: number;
  h: number;
  fpx: number;
  lh: number;
  lines: string[];
  collapsed: boolean;
}

/** Memo card metrics mirroring `FloatLayer`'s CSS box: a `min-height` card that
 * GROWS to fit its wrapped text (padding 9/11/9/32, `line-height:1.55`), so the
 * PNG memo is the same size as the on-screen editor's — not clipped to `f.h`. */
function floatBox(ctx: CanvasRenderingContext2D, f: Float): FloatBox {
  const fpx = f.tsize === 's' ? 11.5 : f.tsize === 'l' ? 15.5 : 13;
  const w = f.w || 160;
  const lh = fpx * 1.55;
  const collapsed = !!f.collapsed;
  ctx.font = `${f.bold ? 700 : 400} ${fpx}px Pretendard, sans-serif`;
  const innerW = Math.max(8, w - 32 - 11); // left 32 (fold toggle), right 11
  const lines = collapsed ? [String(f.text || '').split('\n')[0] || ''] : wrapLines(ctx, f.text || '', innerW);
  const textH = Math.max(18, lines.length * lh); // text block has a min-height of 18
  const grown = 9 + textH + 9; // top + bottom padding
  const h = collapsed ? Math.max(38, grown) : Math.max(f.h || 44, grown);
  return { w, h, fpx, lh, lines, collapsed };
}

export function exportPng(doc: Doc, geom: GeomMap, theme: Theme, filename: string): void {
  const ids = Object.keys(geom).filter((id) => doc.nodes[id]);
  if (!ids.length) return;

  const canvas = document.createElement('canvas');
  const ctx = get2dContext(canvas);
  if (!ctx || typeof canvas.toBlob !== 'function') return; // headless env (e.g. jsdom) — no-op, nothing to rasterize with

  // Pre-measure memos up front so both the export bounds and the draw pass use
  // the same grown-to-fit height (measuring needs the `ctx`, so this must run
  // BEFORE the canvas is resized — that resets ctx state, not the stored numbers).
  const fBoxes = new Map<string, FloatBox>();
  doc.floats.forEach((f) => fBoxes.set(f.id, floatBox(ctx, f)));

  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const grow = (a: number, b: number, c: number, d: number): void => {
    x0 = Math.min(x0, a);
    y0 = Math.min(y0, b);
    x1 = Math.max(x1, c);
    y1 = Math.max(y1, d);
  };
  ids.forEach((id) => {
    const g = geom[id];
    if (g) grow(g.x - g.w / 2, g.y - g.h / 2, g.x + g.w / 2, g.y + g.h / 2);
  });
  doc.floats.forEach((f) => {
    const m = fBoxes.get(f.id)!;
    grow(f.x, f.y, f.x + m.w, f.y + m.h);
  });
  doc.zones.forEach((z) => grow(z.x, z.y - 16, z.x + z.w, z.y + z.h));
  doc.lines.forEach((l) => {
    const c = lineGeom(l, doc, geom);
    grow(Math.min(c.P0.x, c.P3.x) - 12, Math.min(c.P0.y, c.P3.y) - 12, Math.max(c.P0.x, c.P3.x) + 12, Math.max(c.P0.y, c.P3.y) + 12);
  });
  x0 -= PAD;
  y0 -= PAD;
  x1 += PAD;
  y1 += PAD;
  const W = Math.max(1, Math.ceil(x1 - x0));
  const H = Math.max(1, Math.ceil(y1 - y0));

  const scale = Math.min(2, 6000 / Math.max(W, H));
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  ctx.scale(scale, scale);
  ctx.translate(-x0, -y0);

  ctx.fillStyle = theme.canvasBg;
  ctx.fillRect(x0, y0, W, H);

  // Layers in the editor's effective z-order (`Viewport` + per-layer z-index):
  // tree edges → nodes → zones (z-8) → memos (z-10) → free connector lines (z-25).
  // Zones paint above nodes (a grouping box isn't hidden behind its shapes); free
  // lines paint LAST so an arrow landing on a memo/node isn't hidden behind it.

  // tree edges — honor the live layout mode + edge style (curve/elbow/straight),
  // same geometry as `EdgeLayer`/`buildEdgePath`, so 조직도(down)/꺾은선/직선 match.
  const mode = doc.layoutMode;
  const edgeStyle = (doc.edgeStyle as EdgeStyle | undefined) || 'curve';
  const edgeInX = (id: string): number => {
    const n = doc.nodes[id];
    const g = geom[id];
    return n?.shape === 'parallelogram' && g ? g.w * 0.08 : 0;
  };
  ids.forEach((id) => {
    const n = doc.nodes[id];
    const g = geom[id];
    if (!n || !g || !n.parent) return;
    const p = geom[n.parent];
    if (!p) return;
    const d = buildEdgePath(mode, edgeStyle, p, g, edgeInX(n.parent), edgeInX(id));
    ctx.strokeStyle = colorOf(id, doc.nodes, theme);
    ctx.lineWidth = edgeStrokeWidth(g.depth);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = 0.85;
    ctx.stroke(new Path2D(d));
    ctx.globalAlpha = 1;
  });
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';

  // nodes
  ids.forEach((id) => {
    const n = doc.nodes[id];
    const g = geom[id];
    if (!n || !g) return;
    const depth = depthOf(doc.nodes, id);
    const isRoot = id === ROOT_ID;
    const col = colorOf(id, doc.nodes, theme);
    const fillA = n.fillA == null ? 1 : n.fillA;
    const strokeA = n.strokeA == null ? (depth >= 2 && !isRoot ? 0.5 : 1) : n.strokeA;
    const dFill = n.fill || (isRoot ? theme.accent : theme.panel);
    const dStroke = n.stroke || (isRoot ? theme.accent : col);
    const x = g.x - g.w / 2;
    const y = g.y - g.h / 2;
    drawNodeShape(ctx, n, x, y, g.w, g.h);
    ctx.fillStyle = hexA(dFill, fillA);
    ctx.fill();
    ctx.strokeStyle = hexA(dStroke, strokeA);
    ctx.lineWidth = depth >= 2 ? 1.5 : 2;
    ctx.stroke();

    // Use the SAME font size/weight the editor sized the box with (`computeMetrics`
    // → `g.fpx`/`g.fw`), not a separate hardcoded size. The old 17px root font (vs
    // the editor's 20px) rendered text smaller, so more characters fit per line and
    // a long label wrapped LATER than on canvas — the exported text looked
    // misaligned. `g.fpx` already bakes in the node's size (tsize).
    const fpx = g.fpx;
    const tcol = n.textColor || (isRoot && !n.fill ? theme.accentInk : theme.text);
    const fw = g.fw;
    const padX = isRoot ? 24 : depth === 1 ? 15 : 13;
    const emojiPx = depth === 0 ? 22 : 17;
    // The editor lays the emoji out as a SEPARATE flex item to the LEFT of the whole
    // text block (a 7px gap after it), not inline in line 1. `emojiFlex` is the width
    // it occupies; wrap the TEXT in the remaining content width (`g.w - 2·padX -
    // emojiFlex`) — the SAME width the editor's CSS box wraps at — then draw the emoji
    // beside the block. (Wrapping at the editor's content width, not the tighter
    // `computeMetrics` estimate, keeps the line breaks identical.)
    let emojiFlex = 0;
    if (n.emoji) {
      ctx.font = `${emojiPx}px Pretendard, sans-serif`;
      emojiFlex = ctx.measureText(n.emoji).width + 7;
    }
    ctx.font = `${fw} ${fpx}px Pretendard, sans-serif`;
    const lines = wrapLines(ctx, n.text || ' ', Math.max(8, g.w - padX * 2 - emojiFlex));
    const lh = fpx * 1.35;
    const ty0 = g.y - ((lines.length - 1) * lh) / 2;
    // Honor the node's text alignment (left/center/right) — the editor's
    // `NodeBox` justifies the text block per `n.align`; the PNG used to always
    // center it, so left/right-aligned shapes looked wrong. The emoji sits to the
    // left, so the text region (and a centered block) shifts right by `emojiFlex`.
    const align = n.align === 'left' ? 'left' : n.align === 'right' ? 'right' : 'center';
    const tx = align === 'left' ? x + padX + emojiFlex : align === 'right' ? x + g.w - padX : g.x + emojiFlex / 2;
    ctx.fillStyle = tcol;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    lines.forEach((ln, i) => ctx.fillText(ln, tx, ty0 + i * lh));
    if (n.emoji) {
      ctx.font = `${emojiPx}px Pretendard, sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(n.emoji, x + padX, g.y);
    }
  });

  // zones — drawn above nodes (editor z-index 8). Label pill ellipsizes to
  // fit its width, matching `ZoneLayer`'s `text-overflow: ellipsis`.
  doc.zones.forEach((z) => {
    const zc = z.color || theme.accent;
    ctx.fillStyle = hexA(zc, 0.07);
    ctx.strokeStyle = hexA(zc, 0.55);
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 5]);
    ctx.beginPath();
    roundRectPath(ctx, z.x, z.y, z.w, z.h, 16);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = '700 12.5px Pretendard, sans-serif';
    const raw = z.label || '영역';
    const maxPillW = Math.max(20, z.w - 20); // CSS: max-width calc(100% - 20px)
    const innerMax = maxPillW - 26; // horizontal padding 13*2
    let label = raw;
    if (ctx.measureText(label).width > innerMax) {
      while (label.length > 1 && ctx.measureText(label + '…').width > innerMax) label = label.slice(0, -1);
      label += '…';
    }
    const lw = Math.min(maxPillW, ctx.measureText(label).width + 26);
    ctx.fillStyle = zc;
    ctx.beginPath();
    roundRectPath(ctx, z.x + 10, z.y - 14, lw, 27, 13.5);
    ctx.fill();
    ctx.fillStyle = z.color ? '#fff' : theme.accentInk;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, z.x + 10 + lw / 2, z.y - 0.5);
  });

  // memos — grown-to-fit cards (see `floatBox`), matching the editor's memo box.
  doc.floats.forEach((f) => {
    const m = fBoxes.get(f.id)!;
    const dark = theme.appBg === '#191512';
    ctx.fillStyle = f.bg || (dark ? '#3a2f22' : '#fff6cf');
    ctx.strokeStyle = f.bg ? hexA('#000000', 0.14) : dark ? '#5a4a2f' : '#f0e3a0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    roundRectPath(ctx, f.x, f.y, m.w, m.h, 8);
    ctx.fill();
    ctx.stroke();
    // fold toggle badge (accent circle at the card's top-left, like the editor)
    ctx.fillStyle = theme.accent;
    ctx.beginPath();
    ctx.arc(f.x + 16, f.y + 16, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = theme.accentInk;
    ctx.font = '700 12px Pretendard, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(m.collapsed ? '＋' : '−', f.x + 16, f.y + 16.5);
    // text
    if (f.text) {
      ctx.fillStyle = f.textColor || theme.text;
      ctx.font = `${f.bold ? 700 : 400} ${m.fpx}px Pretendard, sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      const firstBaseline = f.y + 9 + m.fpx * 1.15;
      m.lines.forEach((ln, i) => {
        const ly = firstBaseline + i * m.lh;
        if (ly < f.y + m.h - 4) ctx.fillText(ln, f.x + 32, ly);
      });
    }
  });

  // free connector lines — drawn LAST (editor z-index 25) so an arrow landing on
  // a memo/node isn't hidden behind it.
  doc.lines.forEach((l) => {
    const c = lineGeom(l, doc, geom);
    const lc = l.color || theme.accent;
    ctx.strokeStyle = lc;
    ctx.lineWidth = 2.2;
    ctx.setLineDash(l.dashed === false ? [] : [7, 7]);
    ctx.beginPath();
    ctx.moveTo(c.P0.x, c.P0.y);
    ctx.bezierCurveTo(c.C1.x, c.C1.y, c.C2.x, c.C2.y, c.P3.x, c.P3.y);
    ctx.stroke();
    ctx.setLineDash([]);
    const arrow = (px: number, py: number, cx: number, cy: number): void => {
      const ang = Math.atan2(py - cy, px - cx);
      const s = 9;
      ctx.fillStyle = lc;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px - Math.cos(ang - 0.45) * s, py - Math.sin(ang - 0.45) * s);
      ctx.lineTo(px - Math.cos(ang + 0.45) * s, py - Math.sin(ang + 0.45) * s);
      ctx.closePath();
      ctx.fill();
    };
    if (l.startArrow) arrow(c.P0.x, c.P0.y, c.C1.x, c.C1.y);
    if (l.endArrow) arrow(c.P3.x, c.P3.y, c.C2.x, c.C2.y);
    if (l.label && l.label.trim()) {
      const mid = cubicAt(c, 0.5);
      const lw = Math.min(170, l.label.length * 13 + 18);
      ctx.fillStyle = theme.panel;
      ctx.strokeStyle = hexA(lc, 0.5);
      ctx.lineWidth = 1;
      ctx.beginPath();
      roundRectPath(ctx, mid.x - lw / 2, mid.y - 12, lw, 24, 6);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = l.ltextColor || theme.text;
      ctx.font = '600 11.5px Pretendard, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(l.label, mid.x, mid.y + 1);
    }
  });

  canvas.toBlob((blob) => {
    if (blob) downloadFile(`${filename}.png`, blob);
  }, 'image/png');
}

/**
 * Render a full-quality PNG straight from a `Doc` (no live editor state) — lays
 * it out with the same `layout` + `computeMetrics` the editor uses, then draws
 * via `exportPng`. Used by Home so a card download is the real map, not a
 * rasterized thumbnail (which cropped text).
 */
export function exportDocPng(doc: Doc, theme: Theme, filename: string): void {
  const measurer = new CanvasTextMeasurer();
  const sizeOf = (node: Node, depth: number) => {
    const m = computeMetrics(node, depth, measurer);
    return { w: m.w, h: m.h };
  };
  const laid = layout(doc, doc.layoutMode, sizeOf, { rootAnchor: { x: 0, y: 0 } });
  const geom: GeomMap = {};
  buildVisible(laid).forEach(({ id, depth }) => {
    const n = laid[id];
    if (!n) return;
    const m = computeMetrics(n, depth, measurer);
    const g: NodeGeom = { ...m, x: n.x, y: n.y, depth };
    geom[id] = g;
  });
  exportPng({ ...doc, nodes: laid }, geom, theme, filename);
}

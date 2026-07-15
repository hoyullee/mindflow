// PNG export — simplified web-layer port of `Component#exportSVGString` +
// `#exportPNG` (MindFlow.dc.html:638-771). The original rasterizes an SVG
// string (so it can reuse crisp vector shapes/arrows) and re-draws only the
// `<text>` nodes on top with canvas `fillText` (browser SVG rasterization
// can't access the page's `Pretendard` font). This port skips the
// SVG-round-trip and draws everything directly with the Canvas 2D API — the
// same visual pieces (canvas bg, zones, curved tree edges, node shapes, free
// lines + arrows/labels, memos) but a plainer implementation (no multi-line
// soft-wrap measurement, no shadow/gradient touches). Canvas is a rendering
// concern, so this lives in the web layer, not `@mindflow/mindmap-core`.
//
// In environments without a real `CanvasRenderingContext2D` (e.g. jsdom in
// unit tests), this is a no-op — matching `metrics.ts`'s `CanvasTextMeasurer`
// fallback philosophy: never throw, just skip the unavailable capability.

import type { Doc, Node } from '@mindflow/mindmap-core';
import { ROOT_ID, cubicAt, resolveLineGeometry } from '@mindflow/mindmap-core';
import { colorOf } from './tree';
import { hexA } from './theme';
import type { Theme } from './theme';
import type { GeomMap } from './types';
import { downloadFile } from './download';

const PAD = 46;

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

export function exportPng(doc: Doc, geom: GeomMap, theme: Theme, filename: string): void {
  const ids = Object.keys(geom).filter((id) => doc.nodes[id]);
  if (!ids.length) return;

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
  doc.floats.forEach((f) => grow(f.x, f.y, f.x + (f.w || 160), f.y + (f.h || (f.collapsed ? 30 : 44))));
  doc.zones.forEach((z) => grow(z.x, z.y - 16, z.x + z.w, z.y + z.h));
  doc.lines.forEach((l) => {
    const c = resolveLineGeometry(l);
    grow(Math.min(c.P0.x, c.P3.x) - 12, Math.min(c.P0.y, c.P3.y) - 12, Math.max(c.P0.x, c.P3.x) + 12, Math.max(c.P0.y, c.P3.y) + 12);
  });
  x0 -= PAD;
  y0 -= PAD;
  x1 += PAD;
  y1 += PAD;
  const W = Math.max(1, Math.ceil(x1 - x0));
  const H = Math.max(1, Math.ceil(y1 - y0));

  const canvas = document.createElement('canvas');
  const ctx = get2dContext(canvas);
  if (!ctx || typeof canvas.toBlob !== 'function') return; // headless env (e.g. jsdom) — no-op, nothing to rasterize with

  const scale = Math.min(2, 6000 / Math.max(W, H));
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  ctx.scale(scale, scale);
  ctx.translate(-x0, -y0);

  ctx.fillStyle = theme.canvasBg;
  ctx.fillRect(x0, y0, W, H);

  // zones
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
    const label = z.label || '영역';
    const lw = Math.min(z.w - 20, label.length * 13 + 26);
    ctx.fillStyle = zc;
    ctx.beginPath();
    roundRectPath(ctx, z.x + 10, z.y - 13, lw, 26, 13);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '700 12.5px Pretendard, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, z.x + 10 + lw / 2, z.y + 1);
  });

  // tree edges — always a simple curve, matching `exportSVGString` (ignores the live edgeStyle)
  ids.forEach((id) => {
    const n = doc.nodes[id];
    const g = geom[id];
    if (!n || !g || !n.parent) return;
    const p = geom[n.parent];
    if (!p) return;
    const sx = g.x >= p.x ? p.x + p.w / 2 : p.x - p.w / 2;
    const ex = g.x >= p.x ? g.x - g.w / 2 : g.x + g.w / 2;
    const mx = (sx + ex) / 2;
    ctx.strokeStyle = colorOf(id, doc.nodes, theme);
    ctx.lineWidth = 2.4;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(sx, p.y);
    ctx.bezierCurveTo(mx, p.y, mx, g.y, ex, g.y);
    ctx.stroke();
    ctx.globalAlpha = 1;
  });

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

    const fpx = (isRoot ? 17 : depth === 1 ? 15 : 13.5) * (n.tsize === 's' ? 0.85 : n.tsize === 'l' ? 1.2 : 1);
    const tcol = n.textColor || (isRoot && !n.fill ? theme.accentInk : theme.text);
    const fw = n.bold ? 800 : isRoot ? 800 : depth === 1 ? 600 : 500;
    const label = ((n.emoji ? n.emoji + ' ' : '') + (n.text || '')).trim() || ' ';
    const lines = label.split('\n');
    const lh = fpx * 1.35;
    const ty0 = g.y - ((lines.length - 1) * lh) / 2;
    ctx.fillStyle = tcol;
    ctx.font = `${fw} ${fpx}px Pretendard, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    lines.forEach((ln, i) => ctx.fillText(ln, g.x, ty0 + i * lh));
  });

  // free lines
  doc.lines.forEach((l) => {
    const c = resolveLineGeometry(l);
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

  // memos
  doc.floats.forEach((f) => {
    const fw = f.w || 160;
    const fh = f.h || (f.collapsed ? 30 : 44);
    ctx.fillStyle = f.bg || '#fdf6c9';
    ctx.strokeStyle = f.bg ? hexA('#8a7365', 0.35) : '#e8d982';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    roundRectPath(ctx, f.x, f.y, fw, fh, 8);
    ctx.fill();
    ctx.stroke();
    const fpx = 12 * (f.tsize === 's' ? 0.9 : f.tsize === 'l' ? 1.15 : 1);
    const tl = f.collapsed ? [(f.text || '').split('\n')[0] || ''] : (f.text || '').split('\n');
    ctx.fillStyle = f.textColor || '#5a4a3a';
    ctx.font = `${f.bold ? 800 : 500} ${fpx}px Pretendard, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    tl.forEach((ln, i) => {
      const ly = f.y + 16 + i * fpx * 1.45;
      if (ly < f.y + fh - 6) ctx.fillText(ln, f.x + 10, ly);
    });
  });

  canvas.toBlob((blob) => {
    if (blob) downloadFile(`${filename}.png`, blob);
  }, 'image/png');
}

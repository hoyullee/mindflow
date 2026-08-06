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
import { ROOT_ID, cubicAt, layout, listDisplayLine, parseListPrefix, resolveLineEndpoints, resolveLineGeometry } from '@mindflow/mindmap-core';
import { colorOf, buildVisible } from './tree';
import type { EdgeStyle } from './tree';
import { buildEdgePath, edgeStrokeWidth } from './edges';
import { hexA } from './theme';
import type { Theme } from './theme';
import { CanvasTextMeasurer, computeMetrics } from './metrics';
import type { GeomMap, NodeGeom } from './types';
import { downloadFile } from './download';
import { linkInk } from './richSpans';
import { displaySrc, type ImageUrlMap } from './useImageUrls';

const PAD = 46;

/** 스타일 세그먼트 — rich 런(굵게/색/기울임/취소선/링크)이 PNG까지 내려온다.
 * `w`는 이 세그의 측정 폭(px, 세그별 폰트 기준). */
interface PngSeg {
  t: string;
  w: number;
  b?: boolean;
  c?: string | null;
  i?: boolean;
  s?: boolean;
  href?: string;
}

/** 감싼 시각 줄 — 리스트 줄은 첫 줄 segs 앞에 표시 마커(평문 세그)가 포함되고,
 * 연속 줄은 마커 폭만큼 `indent`를 갖는다(에디터 행잉 인덴트와 동일 모델).
 * 리스트 줄의 왼쪽 x는 **항상 텍스트 열 왼쪽**(Notion 방식 — `listLines.tsx`의
 * LIST_ROW_JUSTIFY 참고). 정렬 설정은 평문 줄에만 적용된다. `w`는 줄 전체 폭. */
interface PngLine {
  segs: PngSeg[];
  indent: number;
  list: boolean;
  w: number;
}

/** 세그 하나의 캔버스 폰트 — 굵게(800)/기울임이 폭을 바꾸므로 측정·렌더 모두
 * 이 문자열을 쓴다(에디터 `wrapMeasure`·썸네일 `wrapRuns`와 같은 규칙). */
type SegFont = (seg?: { b?: boolean; i?: boolean }) => string;

/** Soft-wrap rich runs to `maxW` px, mirroring the editor's `wrapMeasure` token
 * model — so the PNG wraps exactly like the canvas. 리스트 줄(`parseListPrefix`)은
 * 마커 폭을 뗀 좁은 폭으로 내용을 감싸고, 마커는 평문 세그로 앞에 붙는다.
 * 평문 텍스트는 무서식 세그 하나로 들어와 기존과 같은 결과를 낸다. */
function wrapRichLines(ctx: CanvasRenderingContext2D, runs: Array<{ t: string; b?: boolean; c?: string | null; i?: boolean; s?: boolean; href?: string }>, maxW: number, fontOf: SegFont): PngLine[] {
  // 하드 줄(\n) 단위로 세그를 나눈다.
  const hard: Array<Array<{ t: string; b?: boolean; c?: string | null; i?: boolean; s?: boolean; href?: string }>> = [[]];
  runs.forEach((r) => {
    String(r.t ?? '')
      .split('\n')
      .forEach((piece, pi) => {
        if (pi > 0) hard.push([]);
        if (piece) hard[hard.length - 1]!.push({ ...r, t: piece });
      });
  });

  const out: PngLine[] = [];
  hard.forEach((rawSegs) => {
    const lineText = rawSegs.map((sg) => sg.t).join('');
    const lp = parseListPrefix(lineText);
    ctx.font = fontOf();
    const markerW = lp ? ctx.measureText(lp.display).width : 0;
    // 마커 글자를 세그에서 뗀다(런 경계에 걸쳐도 안전).
    let strip = lp ? lp.raw.length : 0;
    const segs = rawSegs
      .map((sg) => {
        if (strip <= 0) return sg;
        if (sg.t.length <= strip) {
          strip -= sg.t.length;
          return null;
        }
        const cut = { ...sg, t: sg.t.slice(strip) };
        strip = 0;
        return cut;
      })
      .filter((sg): sg is NonNullable<typeof sg> => !!sg);
    const lineMaxW = lp ? Math.max(24, maxW - markerW) : maxW;

    // 토큰화(세그별 폰트로 측정) → 시각 줄로 감싼다.
    const toks: PngSeg[] = [];
    segs.forEach((sg) => {
      ctx.font = fontOf(sg);
      (String(sg.t).match(/[A-Za-z0-9]+|\s+|./gu) || []).forEach((piece) => {
        toks.push({ t: piece, w: ctx.measureText(piece).width, b: sg.b, c: sg.c, i: sg.i, s: sg.s, href: sg.href });
      });
    });
    const visual: PngSeg[][] = [];
    let line: PngSeg[] = [];
    let lineW = 0;
    toks.forEach((tk) => {
      if (line.length && lineW + tk.w > lineMaxW && !/^\s+$/.test(tk.t)) {
        visual.push(line);
        line = [tk];
        lineW = tk.w;
      } else {
        line.push(tk);
        lineW += tk.w;
      }
    });
    visual.push(line);

    // 같은 스타일의 이웃 토큰을 합쳐 세그 수를 줄인다.
    const merge = (lineToks: PngSeg[]): PngSeg[] => {
      const merged: PngSeg[] = [];
      lineToks.forEach((tk) => {
        const last = merged[merged.length - 1];
        if (last && !!last.b === !!tk.b && (last.c ?? null) === (tk.c ?? null) && !!last.i === !!tk.i && !!last.s === !!tk.s && (last.href ?? null) === (tk.href ?? null)) {
          last.t += tk.t;
          last.w += tk.w;
        } else merged.push({ ...tk });
      });
      return merged;
    };
    visual.forEach((v, vi) => {
      const merged = merge(v);
      const contentW = merged.reduce((acc, sg) => acc + sg.w, 0);
      if (lp) {
        if (vi === 0) out.push({ segs: [{ t: lp.display, w: markerW }, ...merged], indent: 0, list: true, w: markerW + contentW });
        else out.push({ segs: merged, indent: markerW, list: true, w: contentW });
      } else out.push({ segs: merged, indent: 0, list: false, w: contentW });
    });
  });
  return out.length ? out : [{ segs: [], indent: 0, list: false, w: 0 }];
}

/** 한 시각 줄을 세그 단위로 그린다 — 세그별 폰트/색, 취소선·밑줄은 캔버스에
 * `text-decoration`이 없어 **직접 그린다**(썸네일 `decoRects`와 같은 규칙:
 * 취소선은 글자 세로 중앙 살짝 위, 밑줄은 중앙에서 fpx*0.32 아래). `y`는 줄의
 * 세로 중앙(`textBaseline: 'middle'` 기준). */
function drawRichLine(ctx: CanvasRenderingContext2D, ln: PngLine, startX: number, y: number, fpx: number, fontOf: SegFont, baseColor: string, linkColor: string): void {
  const th = Math.max(1.2, fpx * 0.08);
  let cx = startX;
  ctx.textAlign = 'left';
  ln.segs.forEach((sg) => {
    ctx.font = fontOf(sg);
    ctx.fillStyle = sg.c || (sg.href ? linkColor : baseColor);
    if (sg.t) ctx.fillText(sg.t, cx, y);
    if (sg.s) ctx.fillRect(cx, y - fpx * 0.04 - th / 2, sg.w, th);
    if (sg.href) ctx.fillRect(cx, y + fpx * 0.32, sg.w, th);
    cx += sg.w;
  });
}

/** rich가 없으면 무서식 세그 하나 — 평문 경로가 기존과 같은 결과를 내게 한다. */
function runsOf(src: { text?: string; rich?: Array<{ t: string; b?: boolean; c?: string | null; i?: boolean; s?: boolean; href?: string }> | null }, fallback = ' '): Array<{ t: string; b?: boolean; c?: string | null; i?: boolean; s?: boolean; href?: string }> {
  if (src.rich && src.rich.length) return src.rich;
  return [{ t: src.text || fallback }];
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
  lines: PngLine[];
  collapsed: boolean;
}

/** Memo card metrics mirroring `FloatLayer`'s CSS box: a `min-height` card that
 * GROWS to fit its wrapped text (padding 9/11/9/32, `line-height:1.55`), so the
 * PNG memo is the same size as the on-screen editor's — not clipped to `f.h`. */
function floatBox(ctx: CanvasRenderingContext2D, f: Float): FloatBox {
  const fpx = f.tsize === 's' ? 11.5 : f.tsize === 'l' ? 15.5 : 13;
  const w = f.w || 160;
  // 이미지 플로트: 박스 = 명시적 w×h (에디터 FloatLayer/metrics와 동일 규칙)
  if (f.img) return { w, h: Math.max(24, Math.round(f.h ?? w * 0.75)), fpx, lh: 0, lines: [], collapsed: false };
  const lh = fpx * 1.55;
  const collapsed = !!f.collapsed;
  const fw = f.bold ? 700 : 400;
  const fontOf: SegFont = (sg) => `${sg?.i ? 'italic ' : ''}${sg?.b ? 800 : fw} ${fpx}px Pretendard, sans-serif`;
  ctx.font = fontOf();
  const innerW = Math.max(8, w - 32 - 11); // left 32 (fold toggle), right 11
  const lines: PngLine[] = collapsed
    ? [{ segs: [{ t: listDisplayLine(String(f.text || '').split('\n')[0] || ''), w: 0 }], indent: 0, list: false, w: 0 }]
    : wrapRichLines(ctx, runsOf(f, ''), innerW, fontOf);
  const textH = Math.max(18, lines.length * lh); // text block has a min-height of 18
  const grown = 9 + textH + 9; // top + bottom padding
  const h = collapsed ? Math.max(38, grown) : Math.max(f.h || 44, grown);
  return { w, h, fpx, lh, lines, collapsed };
}

/** 데이터 URL을 디코드된 이미지 엘리먼트로 (실패 시 null — 해당 플로트는 자리 박스만 그림). */
function loadImageEl(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    // 별도 저장소의 이미지는 **다른 출처**다. CORS 없이 그리면 캔버스가 오염돼
    // `toBlob`이 통째로 실패한다(내보내기가 아무 파일도 안 만든다) — 그러면 사진
    // 하나 때문에 맵 전체를 못 내보낸다. Supabase Storage는 CORS를 허용한다.
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export async function exportPng(doc: Doc, geom: GeomMap, theme: Theme, filename: string, imageUrls: ImageUrlMap = {}): Promise<void> {
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

  // 이미지 플로트 프리디코드 — canvas 2D `drawImage`는 디코드 완료된
  // 엘리먼트가 필요하므로 그리기 전에 전부 로드해 둔다(데이터 URL이라 즉시).
  const fImages = new Map<string, HTMLImageElement>();
  const nImages = new Map<string, HTMLImageElement>();
  await Promise.all([
    ...doc.floats
      .filter((f) => f.img)
      .map(async (f) => {
        const src = displaySrc(f.img, imageUrls);
        const el = src ? await loadImageEl(src) : null;
        if (el) fImages.set(f.id, el);
      }),
    ...ids
      .filter((id) => doc.nodes[id]?.img)
      .map(async (id) => {
        const src = displaySrc(doc.nodes[id]!.img, imageUrls);
        const el = src ? await loadImageEl(src) : null;
        if (el) nImages.set(id, el);
      }),
  ]);

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
    const fontOf: SegFont = (sg) => `${sg?.i ? 'italic ' : ''}${sg?.b ? 800 : fw} ${fpx}px Pretendard, sans-serif`;
    ctx.font = fontOf();
    const lines = wrapRichLines(ctx, runsOf(n), Math.max(8, g.w - padX * 2 - emojiFlex), fontOf);
    const lh = fpx * 1.35;
    // 노드 썸네일: 에디터의 세로 스택(이미지 → 8px 갭 → 내용)과 동일하게,
    // 텍스트/이모지는 (imgH+8)/2 만큼 내려가고 이미지는 텍스트 블록 위 중앙.
    const hasImg = !!(n.img && n.imgW && n.imgH);
    const textBlockH = lines.length * lh;
    const imgShift = hasImg ? (n.imgH! + 8) / 2 : 0;
    if (hasImg) {
      const el = nImages.get(id);
      const ix = g.x - n.imgW! / 2;
      const iy = g.y - (textBlockH + 8) / 2 - n.imgH! / 2;
      ctx.save();
      ctx.beginPath();
      roundRectPath(ctx, ix, iy, n.imgW!, n.imgH!, 8);
      ctx.clip();
      if (el) ctx.drawImage(el, ix, iy, n.imgW!, n.imgH!);
      ctx.restore();
    }
    const ty0 = g.y + imgShift - ((lines.length - 1) * lh) / 2;
    // Honor the node's text alignment (left/center/right) — the editor's
    // `NodeBox` justifies the text block per `n.align`; the PNG used to always
    // center it, so left/right-aligned shapes looked wrong. The emoji sits to the
    // left, so the text region (and a centered block) shifts right by `emojiFlex`.
    const align = n.align === 'left' ? 'left' : n.align === 'right' ? 'right' : 'center';
    // 리스트 줄: 정렬 설정과 무관하게 텍스트 열 왼쪽 + 행잉 인덴트(에디터·썸네일과 동일).
    const listL = x + padX + emojiFlex;
    const rightL = x + g.w - padX;
    // 링크 파랑은 도형 글자색 밝기로(에디터·썸네일과 같은 규칙 — `linkInk`).
    const linkColor = linkInk(tcol);
    ctx.textBaseline = 'middle';
    lines.forEach((ln, i) => {
      // 세그 단위로 그리므로 정렬은 시작 x를 직접 계산한다(줄 폭 `ln.w`).
      const startX = ln.list ? listL + ln.indent : align === 'left' ? listL : align === 'right' ? rightL - ln.w : g.x + emojiFlex / 2 - ln.w / 2;
      drawRichLine(ctx, ln, startX, ty0 + i * lh, fpx, fontOf, tcol, linkColor);
    });
    if (n.emoji) {
      ctx.font = `${emojiPx}px Pretendard, sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(n.emoji, x + padX, g.y + imgShift);
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
    if (f.img) {
      // 이미지 플로트: 라운드 클립 안에 이미지를 채운다 (비율은 w/h에 이미 반영).
      const el = fImages.get(f.id);
      ctx.save();
      ctx.beginPath();
      roundRectPath(ctx, f.x, f.y, m.w, m.h, 8);
      ctx.clip();
      if (el) {
        ctx.drawImage(el, f.x, f.y, m.w, m.h);
      } else {
        ctx.fillStyle = theme.panel;
        ctx.fillRect(f.x, f.y, m.w, m.h);
      }
      ctx.restore();
      ctx.strokeStyle = hexA('#000000', 0.14);
      ctx.lineWidth = 1;
      ctx.beginPath();
      roundRectPath(ctx, f.x, f.y, m.w, m.h, 8);
      ctx.stroke();
      return;
    }
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
    // text — 세그 단위(굵게/색/기울임/취소선/링크). 세로는 줄 박스 중앙 기준
    // (`middle`) — 이전 alphabetic 기준선과 시각 차이는 1px 미만이고, 장식(취소선·
    // 밑줄) 위치 규칙을 노드와 공유하기 위해서다.
    if (f.text) {
      const fw = f.bold ? 700 : 400;
      const fontOf: SegFont = (sg) => `${sg?.i ? 'italic ' : ''}${sg?.b ? 800 : fw} ${m.fpx}px Pretendard, sans-serif`;
      const base = f.textColor || theme.text;
      const linkColor = linkInk(base);
      ctx.textBaseline = 'middle';
      m.lines.forEach((ln, i) => {
        const cy = f.y + 9 + i * m.lh + m.lh / 2;
        if (cy < f.y + m.h - 4) drawRichLine(ctx, ln, f.x + 32 + ln.indent, cy, m.fpx, fontOf, base, linkColor);
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
export async function exportDocPng(doc: Doc, theme: Theme, filename: string, imageUrls: ImageUrlMap = {}): Promise<void> {
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
  await exportPng({ ...doc, nodes: laid }, geom, theme, filename, imageUrls);
}

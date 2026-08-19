// 내보내기 장면 — PNG(캔버스)·SVG(마크업)·PDF(캔버스 래스터)가 **공유하는 한 번의
// 장면 순회**. 예전에는 `png.ts`가 캔버스에 직접 그렸는데, SVG 내보내기를 더하면서
// 그리기 대상을 `Painter`로 추상해 소비처가 늘어도 순회는 하나만 유지한다(서식
// 기능마다 "소비처 N곳"을 고치던 드리프트를 늘리지 않기 위해 — CLAUDE.md의 리스트/
// 서식 항목들 참고). 도형은 전부 SVG 경로 문자열(`d`)로 만들고 캔버스는 `Path2D`로
// 같은 문자열을 소비한다 — 두 출력의 기하가 구조적으로 같아진다.
//
// 측정은 `Measure`(텍스트+폰트→px) 주입: 브라우저에서는 캔버스 measureText, jsdom
// 에서는 `CanvasTextMeasurer`의 근사 폴백 — SVG 문자열 생성은 캔버스 없이도 돌므로
// 단위 테스트가 실제 출력 구조를 검증할 수 있다.

import type { Box, Doc, Float, Line, LineAnchor, Node } from '@mindflow/mindmap-core';
import { ROOT_ID, cubicAt, parseListPrefix, resolveLineEndpoints, resolveLineGeometry, strokeBounds, strokePathD } from '@mindflow/mindmap-core';
import { colorOf } from './tree';
import type { EdgeStyle } from './tree';
import { buildEdgePath, edgeStrokeWidth } from './edges';
import { hexA } from './theme';
import type { Theme } from './theme';
import { floatPadLeft } from './metrics';
import { HL_OPACITY, isHighlighter } from './boardTools';
import { linkInk } from './richSpans';
import type { GeomMap } from './types';

export const EXPORT_PAD = 46;

/** 텍스트 측정 포트 — (텍스트, CSS 폰트 문자열) → 폭 px. */
export type Measure = (text: string, font: string) => number;

/** 스타일 세그먼트 — rich 런(굵게/색/기울임/취소선/링크)이 내보내기까지 내려온다.
 * `w`는 이 세그의 측정 폭(px, 세그별 폰트 기준). */
export interface SceneSeg {
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
export interface SceneLine {
  segs: SceneSeg[];
  indent: number;
  list: boolean;
  w: number;
}

/** 세그 하나의 폰트 문자열 — 굵게(800)/기울임이 폭을 바꾸므로 측정·렌더 모두
 * 이 문자열을 쓴다(에디터 `wrapMeasure`·썸네일 `wrapRuns`와 같은 규칙). */
export type SegFont = (seg?: { b?: boolean; i?: boolean }) => string;

type RichRunIn = { t: string; b?: boolean; c?: string | null; i?: boolean; s?: boolean; href?: string };

/** Soft-wrap rich runs to `maxW` px, mirroring the editor's `wrapMeasure` token
 * model — so the export wraps exactly like the canvas. 리스트 줄(`parseListPrefix`)은
 * 마커 폭을 뗀 좁은 폭으로 내용을 감싸고, 마커는 평문 세그로 앞에 붙는다.
 * 평문 텍스트는 무서식 세그 하나로 들어와 기존과 같은 결과를 낸다. */
export function wrapRichLines(measure: Measure, runs: RichRunIn[], maxW: number, fontOf: SegFont): SceneLine[] {
  // 하드 줄(\n) 단위로 세그를 나눈다.
  const hard: RichRunIn[][] = [[]];
  runs.forEach((r) => {
    String(r.t ?? '')
      .split('\n')
      .forEach((piece, pi) => {
        if (pi > 0) hard.push([]);
        if (piece) hard[hard.length - 1]!.push({ ...r, t: piece });
      });
  });

  const out: SceneLine[] = [];
  hard.forEach((rawSegs) => {
    const lineText = rawSegs.map((sg) => sg.t).join('');
    const lp = parseListPrefix(lineText);
    const markerW = lp ? measure(lp.display, fontOf()) : 0;
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
    const toks: SceneSeg[] = [];
    segs.forEach((sg) => {
      const font = fontOf(sg);
      (String(sg.t).match(/[A-Za-z0-9]+|\s+|./gu) || []).forEach((piece) => {
        toks.push({ t: piece, w: measure(piece, font), b: sg.b, c: sg.c, i: sg.i, s: sg.s, href: sg.href });
      });
    });
    const visual: SceneSeg[][] = [];
    let line: SceneSeg[] = [];
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
    const merge = (lineToks: SceneSeg[]): SceneSeg[] => {
      const merged: SceneSeg[] = [];
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

/** rich가 없으면 무서식 세그 하나 — 평문 경로가 기존과 같은 결과를 내게 한다. */
export function runsOf(src: { text?: string; rich?: RichRunIn[] | null }, fallback = ' '): RichRunIn[] {
  if (src.rich && src.rich.length) return src.rich;
  return [{ t: src.text || fallback }];
}

// ---- 도형 경로(d) 빌더 — SVG가 그대로 쓰고 캔버스는 Path2D(d)로 소비한다 ----

const fx = (n: number): string => String(Math.round(n * 100) / 100);

export function roundRectD(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  return [
    `M${fx(x + rr)},${fx(y)}`,
    `H${fx(x + w - rr)}`,
    `A${fx(rr)},${fx(rr)} 0 0 1 ${fx(x + w)},${fx(y + rr)}`,
    `V${fx(y + h - rr)}`,
    `A${fx(rr)},${fx(rr)} 0 0 1 ${fx(x + w - rr)},${fx(y + h)}`,
    `H${fx(x + rr)}`,
    `A${fx(rr)},${fx(rr)} 0 0 1 ${fx(x)},${fx(y + h - rr)}`,
    `V${fx(y + rr)}`,
    `A${fx(rr)},${fx(rr)} 0 0 1 ${fx(x + rr)},${fx(y)}`,
    'Z',
  ].join('');
}

export function circleD(cx: number, cy: number, r: number): string {
  return `M${fx(cx - r)},${fx(cy)}A${fx(r)},${fx(r)} 0 1 0 ${fx(cx + r)},${fx(cy)}A${fx(r)},${fx(r)} 0 1 0 ${fx(cx - r)},${fx(cy)}Z`;
}

/** 노드 도형 경로 — `png.ts`의 `drawNodeShape`와 같은 꼭짓점/모서리 규칙. */
export function shapePathD(n: Pick<Node, 'shape'>, x: number, y: number, w: number, h: number): string {
  const shape = n.shape || 'round';
  if (shape === 'ellipse') {
    const rx = w / 2;
    const ry = h / 2;
    const cy = y + h / 2;
    return `M${fx(x)},${fx(cy)}A${fx(rx)},${fx(ry)} 0 1 0 ${fx(x + w)},${fx(cy)}A${fx(rx)},${fx(ry)} 0 1 0 ${fx(x)},${fx(cy)}Z`;
  }
  if (shape === 'diamond') return `M${fx(x + w / 2)},${fx(y)}L${fx(x + w)},${fx(y + h / 2)}L${fx(x + w / 2)},${fx(y + h)}L${fx(x)},${fx(y + h / 2)}Z`;
  if (shape === 'hexagon') {
    const c = Math.min(w * 0.18, h * 0.6);
    return `M${fx(x + c)},${fx(y)}L${fx(x + w - c)},${fx(y)}L${fx(x + w)},${fx(y + h / 2)}L${fx(x + w - c)},${fx(y + h)}L${fx(x + c)},${fx(y + h)}L${fx(x)},${fx(y + h / 2)}Z`;
  }
  if (shape === 'parallelogram') {
    const c = w * 0.16;
    return `M${fx(x + c)},${fx(y)}L${fx(x + w)},${fx(y)}L${fx(x + w - c)},${fx(y + h)}L${fx(x)},${fx(y + h)}Z`;
  }
  const r = shape === 'pill' ? h / 2 : shape === 'rect' ? 3 : 10;
  return roundRectD(x, y, w, h, r);
}

// ---- Painter — 그리기 대상 추상 ----

export interface PathOpts {
  fill?: string;
  stroke?: string;
  width?: number;
  dash?: number[];
  alpha?: number;
  /** round caps/joins (트리 연결선). */
  round?: boolean;
  /** 곱하기 합성(하이라이터) — 밑의 글자를 가리지 않고 걸러 낸다. 캔버스는
   * `globalCompositeOperation`, SVG는 `mix-blend-mode`로 같은 결과를 낸다. */
  blend?: 'multiply';
}

export interface TextOpts {
  px: number;
  weight: number;
  italic?: boolean;
  fill: string;
  /** 측정된 폭(px). SVG는 `textLength`로 이 폭을 강제한다 — Pretendard가 있는
   * 환경에선 측정값과 같아 무변화, 없는 환경에선 폴백 글리프가 자간 조정으로
   * 이 폭에 맞춰져 세그 경계 겹침·열 어긋남이 사라진다(캔버스는 무시). */
  w?: number;
}

export interface Painter {
  path(d: string, o: PathOpts): void;
  /** 장식(취소선·밑줄)·배경 등 단순 사각형 채움. */
  rect(x: number, y: number, w: number, h: number, fill: string): void;
  /** 왼쪽 기준(x), 세로 중앙(y) 텍스트 — 캔버스 textBaseline:'middle'과 같은 기준. */
  text(t: string, x: number, y: number, o: TextOpts): void;
  /** 라운드 클립 안의 이미지. 그렸으면 true, 이미지가 없으면 false(호출부가 폴백). */
  image(key: string, x: number, y: number, w: number, h: number, rx: number): boolean;
}

/** 세그 폰트 문자열 — 측정과 렌더가 같은 문자열을 쓰도록 한 곳에서 만든다. */
export function fontStr(px: number, weight: number, italic?: boolean): string {
  return `${italic ? 'italic ' : ''}${weight} ${px}px Pretendard, sans-serif`;
}

// ---- 캔버스 Painter (PNG·PDF 래스터) ----

export class CanvasPainter implements Painter {
  constructor(
    private ctx: CanvasRenderingContext2D,
    private images: Map<string, HTMLImageElement>,
  ) {}

  path(d: string, o: PathOpts): void {
    const ctx = this.ctx;
    const p2 = new Path2D(d);
    if (o.alpha != null) ctx.globalAlpha = o.alpha;
    if (o.blend) ctx.globalCompositeOperation = o.blend;
    if (o.fill) {
      ctx.fillStyle = o.fill;
      ctx.fill(p2);
    }
    if (o.stroke) {
      ctx.strokeStyle = o.stroke;
      ctx.lineWidth = o.width ?? 1;
      ctx.setLineDash(o.dash ?? []);
      ctx.lineCap = o.round ? 'round' : 'butt';
      ctx.lineJoin = o.round ? 'round' : 'miter';
      ctx.stroke(p2);
      ctx.setLineDash([]);
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'miter';
    }
    if (o.blend) ctx.globalCompositeOperation = 'source-over';
    if (o.alpha != null) ctx.globalAlpha = 1;
  }

  rect(x: number, y: number, w: number, h: number, fill: string): void {
    this.ctx.fillStyle = fill;
    this.ctx.fillRect(x, y, w, h);
  }

  text(t: string, x: number, y: number, o: TextOpts): void {
    const ctx = this.ctx;
    ctx.font = fontStr(o.px, o.weight, o.italic);
    ctx.fillStyle = o.fill;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(t, x, y);
  }

  image(key: string, x: number, y: number, w: number, h: number, rx: number): boolean {
    const ctx = this.ctx;
    const el = this.images.get(key);
    ctx.save();
    ctx.clip(new Path2D(roundRectD(x, y, w, h, rx)));
    if (el) ctx.drawImage(el, x, y, w, h);
    ctx.restore();
    return !!el;
  }
}

// ---- SVG Painter (순수 문자열 — jsdom에서도 동작) ----

function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 내보낸 파일은 앱 밖에서 열린다 — Pretendard가 없는 시스템을 위해 한국어 산세리프
 * 폴백을 넓게 깐다(좌표는 전부 측정 기반 절대값이라 폰트가 달라도 레이아웃이
 * 재계산되지 않고, 글리프 폭 차이만 남는다). */
const SVG_FONT_FAMILY = "Pretendard, 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif";

/** 캔버스 `textBaseline:'middle'`과 시각적으로 같은 세로 기준 — SVG는 뷰어 호환성을
 * 위해 `dominant-baseline` 대신(일러스트레이터 등이 무시한다) 알파벳 기준선으로
 * 직접 내린다. 계수는 실브라우저에서 같은 글자를 두 방식으로 그려 잉크 세로 중심을
 * 비교해 맞춘 값(Pretendard 40px: 캔버스 middle 중심 99.5 vs SVG 기준선 87.5 →
 * 12px/40px = 0.30em). */
export const SVG_BASELINE_SHIFT = 0.3;

export class SvgPainter implements Painter {
  private els: string[] = [];
  private defs: string[] = [];
  private clipN = 0;

  constructor(private images: Map<string, string>) {}

  path(d: string, o: PathOpts): void {
    const at: string[] = [`d="${d}"`, `fill="${o.fill ? escXml(o.fill) : 'none'}"`];
    if (o.stroke) {
      at.push(`stroke="${escXml(o.stroke)}"`, `stroke-width="${fx(o.width ?? 1)}"`);
      if (o.dash && o.dash.length) at.push(`stroke-dasharray="${o.dash.map(fx).join(' ')}"`);
      if (o.round) at.push('stroke-linecap="round"', 'stroke-linejoin="round"');
    }
    if (o.alpha != null && o.alpha !== 1) at.push(`opacity="${fx(o.alpha)}"`);
    if (o.blend) at.push(`style="mix-blend-mode:${o.blend}"`);
    this.els.push(`<path ${at.join(' ')}/>`);
  }

  rect(x: number, y: number, w: number, h: number, fill: string): void {
    this.els.push(`<rect x="${fx(x)}" y="${fx(y)}" width="${fx(w)}" height="${fx(h)}" fill="${escXml(fill)}"/>`);
  }

  text(t: string, x: number, y: number, o: TextOpts): void {
    if (!t) return;
    const at = [
      `x="${fx(x)}"`,
      `y="${fx(y + o.px * SVG_BASELINE_SHIFT)}"`,
      `font-size="${fx(o.px)}"`,
      `font-weight="${o.weight}"`,
      o.italic ? 'font-style="italic"' : '',
      `fill="${escXml(o.fill)}"`,
      o.w && o.w > 0 ? `textLength="${fx(o.w)}" lengthAdjust="spacingAndGlyphs"` : '',
    ].filter(Boolean);
    this.els.push(`<text ${at.join(' ')}>${escXml(t)}</text>`);
  }

  image(key: string, x: number, y: number, w: number, h: number, rx: number): boolean {
    const src = this.images.get(key);
    if (!src) return false;
    const id = `mfclip${this.clipN++}`;
    this.defs.push(`<clipPath id="${id}"><path d="${roundRectD(x, y, w, h, rx)}"/></clipPath>`);
    this.els.push(`<image href="${escXml(src)}" x="${fx(x)}" y="${fx(y)}" width="${fx(w)}" height="${fx(h)}" preserveAspectRatio="none" clip-path="url(#${id})"/>`);
    return true;
  }

  /** 완성된 SVG 문서 문자열. 공백 보존은 **두 겹** — 기본 XML은 `<text>`의
   * 선행/후행 공백을 접어서 rich 세그 경계의 공백(" & " 같은)이 사라진 채
   * 그려진다(실브라우저 픽셀 비교에서 잡은 것). 크롬은 `xml:space`를 무시하고
   * CSS `white-space: pre`만 존중하며(그것도 text 요소 자신의 계산값이어야 —
   * 루트 인라인 스타일 상속은 무효였다, 실측), 옛 뷰어는 반대로 `xml:space`를
   * 본다. `<style>` 블록 + `xml:space` 둘 다 싣는다. */
  svg(x0: number, y0: number, w: number, h: number): string {
    const head = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fx(x0)} ${fx(y0)} ${fx(w)} ${fx(h)}" width="${fx(w)}" height="${fx(h)}" font-family="${escXml(SVG_FONT_FAMILY)}" xml:space="preserve">`;
    const ws = '<style>text{white-space:pre}</style>';
    const defs = this.defs.length ? `<defs>${this.defs.join('')}</defs>` : '';
    return `${head}${ws}${defs}${this.els.join('')}</svg>`;
  }
}

// ---- 장면 기하 (bounds/메모 박스/라인) ----

export interface SceneFloatBox {
  w: number;
  h: number;
  fpx: number;
  lh: number;
  lines: SceneLine[];
}

/** Memo card metrics mirroring `FloatLayer`'s CSS box: a `min-height` card that
 * GROWS to fit its wrapped text (padding 9/11/9/11, `line-height:1.55`), so the
 * export memo is the same size as the on-screen editor's — not clipped to `f.h`.
 * 접기(collapsed)는 더 이상 보지 않는다 — 토글이 제거되어 항상 펼쳐 그린다(요청). */
export function sceneFloatBox(measure: Measure, f: Float): SceneFloatBox {
  const fpx = f.tsize === 's' ? 11.5 : f.tsize === 'l' ? 15.5 : 13;
  const w = f.w || 160;
  // 이미지 플로트: 박스 = 명시적 w×h (에디터 FloatLayer/metrics와 동일 규칙)
  if (f.img) return { w, h: Math.max(24, Math.round(f.h ?? w * 0.75)), fpx, lh: 0, lines: [] };
  const lh = fpx * 1.55;
  const fw = f.bold ? 700 : 400;
  const fontOf: SegFont = (sg) => fontStr(fpx, sg?.b ? 800 : fw, sg?.i);
  const innerW = Math.max(8, w - floatPadLeft() - 11); // 좌우 대칭 패딩(11/11)
  const lines: SceneLine[] = wrapRichLines(measure, runsOf(f, ''), innerW, fontOf);
  const textH = Math.max(18, lines.length * lh); // text block has a min-height of 18
  const grown = 9 + textH + 9; // top + bottom padding
  const h = Math.max(f.h || 44, grown);
  return { w, h, fpx, lh, lines };
}

/** Line-anchor box lookup (port of `Component#lineTargetBox`, MindFlow.dc.html:2377-2390),
 * built from the same `doc`/`geom` snapshot the export draws from — so an anchored
 * free line renders pinned to its node/float port, not its (possibly stale) raw x/y. */
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

export function sceneLineGeom(l: Line, doc: Doc, geom: GeomMap) {
  const ep = resolveLineEndpoints(l, (a) => boxOfAnchor(a, doc, geom));
  return resolveLineGeometry({ ...l, ...ep });
}

export interface SceneBounds {
  x0: number;
  y0: number;
  w: number;
  h: number;
}

/** 내보내기 경계 — 모든 노드·메모·영역·자유 선을 감싸고 EXPORT_PAD 여백. */
export function computeSceneBounds(doc: Doc, geom: GeomMap, fBoxes: Map<string, SceneFloatBox>): SceneBounds | null {
  const ids = Object.keys(geom).filter((id) => doc.nodes[id]);
  // 노드가 없어도 메모·영역·선·그리기 획이 있으면 그릴 것이 있다(화이트보드 —
  // 트리 없는 문서). 정말 아무것도 없을 때만 null(호출부가 내보내기를 건너뛴다).
  if (!ids.length && !doc.floats.length && !doc.zones.length && !doc.lines.length && !(doc.strokes ?? []).length) return null;
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
    const m = fBoxes.get(f.id);
    if (m) grow(f.x, f.y, f.x + m.w, f.y + m.h);
  });
  doc.zones.forEach((z) => grow(z.x, z.y - 16, z.x + z.w, z.y + z.h));
  (doc.strokes ?? []).forEach((s) => {
    const b = strokeBounds(s);
    if (b) grow(b.x0, b.y0, b.x1, b.y1);
  });
  doc.lines.forEach((l) => {
    const c = sceneLineGeom(l, doc, geom);
    grow(Math.min(c.P0.x, c.P3.x) - 12, Math.min(c.P0.y, c.P3.y) - 12, Math.max(c.P0.x, c.P3.x) + 12, Math.max(c.P0.y, c.P3.y) + 12);
  });
  x0 -= EXPORT_PAD;
  y0 -= EXPORT_PAD;
  x1 += EXPORT_PAD;
  y1 += EXPORT_PAD;
  return { x0, y0, w: Math.max(1, Math.ceil(x1 - x0)), h: Math.max(1, Math.ceil(y1 - y0)) };
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

/** 한 시각 줄을 세그 단위로 그린다 — 세그별 폰트/색, 취소선·밑줄은 캔버스에
 * `text-decoration`이 없어 **직접 그린다**(썸네일 `decoRects`와 같은 규칙:
 * 취소선은 글자 세로 중앙 살짝 위, 밑줄은 중앙에서 fpx*0.32 아래). `y`는 줄의
 * 세로 중앙. */
function paintRichLine(p: Painter, ln: SceneLine, startX: number, y: number, fpx: number, baseWeight: number, baseColor: string, linkColor: string): void {
  const th = Math.max(1.2, fpx * 0.08);
  let cx = startX;
  ln.segs.forEach((sg) => {
    const fill = sg.c || (sg.href ? linkColor : baseColor);
    if (sg.t) p.text(sg.t, cx, y, { px: fpx, weight: sg.b ? 800 : baseWeight, italic: sg.i, fill, w: sg.w });
    if (sg.s) p.rect(cx, y - fpx * 0.04 - th / 2, sg.w, th, fill);
    if (sg.href) p.rect(cx, y + fpx * 0.32, sg.w, th, fill);
    cx += sg.w;
  });
}

export interface PaintSceneOpts {
  doc: Doc;
  geom: GeomMap;
  theme: Theme;
  measure: Measure;
  bounds: SceneBounds;
  fBoxes: Map<string, SceneFloatBox>;
}

/**
 * 장면 전체를 Painter에 그린다 — 에디터의 실효 z-순서 그대로:
 * 배경 → 트리 연결선 → 노드 → 영역(z-8) → 메모(z-10) → 자유 연결선(z-25).
 * 영역은 노드 위(묶음 상자가 도형 뒤에 숨지 않게), 자유 선은 맨 마지막(메모/노드에
 * 닿은 화살표가 가려지지 않게).
 */
export function paintScene(p: Painter, o: PaintSceneOpts): void {
  const { doc, geom, theme, measure, bounds, fBoxes } = o;
  const ids = Object.keys(geom).filter((id) => doc.nodes[id]);

  p.rect(bounds.x0, bounds.y0, bounds.w, bounds.h, theme.canvasBg);

  // 영역(프레임)의 **면** — 맨 아래(에디터 z 8). 테두리·라벨은 맨 위에서 따로 그린다.
  doc.zones.forEach((z) => {
    p.path(roundRectD(z.x, z.y, z.w, z.h, 16), { fill: hexA(z.color || theme.accent, 0.07) });
  });

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
    const parent = geom[n.parent];
    if (!parent) return;
    const d = buildEdgePath(mode, edgeStyle, parent, g, edgeInX(n.parent), edgeInX(id));
    p.path(d, { stroke: colorOf(id, doc.nodes, theme), width: edgeStrokeWidth(g.depth), alpha: 0.85, round: true });
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
    p.path(shapePathD(n, x, y, g.w, g.h), { fill: hexA(dFill, fillA), stroke: hexA(dStroke, strokeA), width: depth >= 2 ? 1.5 : 2 });

    // Use the SAME font size/weight the editor sized the box with (`computeMetrics`
    // → `g.fpx`/`g.fw`), not a separate hardcoded size — see png.ts history.
    const fpx = g.fpx;
    const tcol = n.textColor || (isRoot && !n.fill ? theme.accentInk : theme.text);
    const fw = g.fw;
    const padX = isRoot ? 24 : depth === 1 ? 15 : 13;
    const emojiPx = depth === 0 ? 22 : 17;
    // The editor lays the emoji out as a SEPARATE flex item to the LEFT of the whole
    // text block (a 7px gap after it), not inline in line 1 — wrap the TEXT in the
    // remaining content width so line breaks match the editor exactly.
    let emojiFlex = 0;
    if (n.emoji) emojiFlex = measure(n.emoji, fontStr(emojiPx, 400)) + 7;
    const fontOf: SegFont = (sg) => fontStr(fpx, sg?.b ? 800 : fw, sg?.i);
    const lines = wrapRichLines(measure, runsOf(n), Math.max(8, g.w - padX * 2 - emojiFlex), fontOf);
    const lh = fpx * 1.35;
    // 노드 썸네일: 에디터의 세로 스택(이미지 → 8px 갭 → 내용)과 동일하게,
    // 텍스트/이모지는 (imgH+8)/2 만큼 내려가고 이미지는 텍스트 블록 위 중앙.
    const hasImg = !!(n.img && n.imgW && n.imgH);
    const textBlockH = lines.length * lh;
    const imgShift = hasImg ? (n.imgH! + 8) / 2 : 0;
    if (hasImg) {
      const ix = g.x - n.imgW! / 2;
      const iy = g.y - (textBlockH + 8) / 2 - n.imgH! / 2;
      p.image(`n:${id}`, ix, iy, n.imgW!, n.imgH!, 8);
    }
    const ty0 = g.y + imgShift - ((lines.length - 1) * lh) / 2;
    // Honor the node's text alignment (left/center/right); 리스트 줄은 정렬 설정과
    // 무관하게 텍스트 열 왼쪽 + 행잉 인덴트(에디터·썸네일과 동일).
    const align = n.align === 'left' ? 'left' : n.align === 'right' ? 'right' : 'center';
    const listL = x + padX + emojiFlex;
    const rightL = x + g.w - padX;
    // 링크 파랑은 도형 글자색 밝기로(에디터·썸네일과 같은 규칙 — `linkInk`).
    const linkColor = linkInk(tcol);
    lines.forEach((ln, i) => {
      const startX = ln.list ? listL + ln.indent : align === 'left' ? listL : align === 'right' ? rightL - ln.w : g.x + emojiFlex / 2 - ln.w / 2;
      paintRichLine(p, ln, startX, ty0 + i * lh, fpx, fw, tcol, linkColor);
    });
    if (n.emoji) p.text(n.emoji, x + padX, g.y + imgShift, { px: emojiPx, weight: 400, fill: tcol });
  });

  // memos — grown-to-fit cards (see `sceneFloatBox`), matching the editor's memo box.
  doc.floats.forEach((f) => {
    const m = fBoxes.get(f.id);
    if (!m) return;
    if (f.img) {
      // 이미지 플로트: 라운드 클립 안에 이미지를 채운다 (비율은 w/h에 이미 반영).
      // 이미지가 없으면(URL 미해결) 같은 자리에 패널색 자리 박스.
      if (!p.image(`f:${f.id}`, f.x, f.y, m.w, m.h, 8)) p.path(roundRectD(f.x, f.y, m.w, m.h, 8), { fill: theme.panel });
      p.path(roundRectD(f.x, f.y, m.w, m.h, 8), { stroke: hexA('#000000', 0.14), width: 1 });
      return;
    }
    const dark = theme.appBg === '#191512';
    p.path(roundRectD(f.x, f.y, m.w, m.h, 8), {
      fill: f.bg || (dark ? '#3a2f22' : '#fff6cf'),
      stroke: f.bg ? hexA('#000000', 0.14) : dark ? '#5a4a2f' : '#f0e3a0',
      width: 1,
    });
    // 접기 토글 배지는 그리지 않는다 — 접기가 제거되어 화면에도 없다(요청).
    // text — 세그 단위(굵게/색/기울임/취소선/링크). 세로는 줄 박스 중앙 기준.
    if (f.text) {
      const fw = f.bold ? 700 : 400;
      const base = f.textColor || theme.text;
      const linkColor = linkInk(base);
      m.lines.forEach((ln, i) => {
        const cy = f.y + 9 + i * m.lh + m.lh / 2;
        if (cy < f.y + m.h - 4) paintRichLine(p, ln, f.x + floatPadLeft() + ln.indent, cy, m.fpx, fw, base, linkColor);
      });
    }
  });

  // free connector lines — drawn LAST (editor z-index 25) so an arrow landing on
  // a memo/node isn't hidden behind it.
  doc.lines.forEach((l) => {
    const c = sceneLineGeom(l, doc, geom);
    const lc = l.color || theme.accent;
    p.path(`M${fx(c.P0.x)},${fx(c.P0.y)}C${fx(c.C1.x)},${fx(c.C1.y)} ${fx(c.C2.x)},${fx(c.C2.y)} ${fx(c.P3.x)},${fx(c.P3.y)}`, {
      stroke: lc,
      width: 2.2,
      dash: l.dashed === false ? undefined : [7, 7],
    });
    const arrow = (px: number, py: number, cx: number, cy: number): void => {
      const ang = Math.atan2(py - cy, px - cx);
      const s = 9;
      const d = `M${fx(px)},${fx(py)}L${fx(px - Math.cos(ang - 0.45) * s)},${fx(py - Math.sin(ang - 0.45) * s)}L${fx(px - Math.cos(ang + 0.45) * s)},${fx(py - Math.sin(ang + 0.45) * s)}Z`;
      p.path(d, { fill: lc });
    };
    if (l.startArrow) arrow(c.P0.x, c.P0.y, c.C1.x, c.C1.y);
    if (l.endArrow) arrow(c.P3.x, c.P3.y, c.C2.x, c.C2.y);
    if (l.label && l.label.trim()) {
      const mid = cubicAt(c, 0.5);
      const lw = Math.min(170, l.label.length * 13 + 18);
      p.path(roundRectD(mid.x - lw / 2, mid.y - 12, lw, 24, 6), { fill: theme.panel, stroke: hexA(lc, 0.5), width: 1 });
      const labelFont = fontStr(11.5, 600);
      const labelW = measure(l.label, labelFont);
      p.text(l.label, mid.x - labelW / 2, mid.y + 1, { px: 11.5, weight: 600, fill: l.ltextColor || theme.text, w: labelW });
    }
  });
  // 자유 그리기 획(화이트보드 M4) — 에디터 z-순서와 같이 **맨 위**. 손으로 그은
  // 잉크는 객체를 덮는다(제보: 메모 뒤로 숨었다). 획은 path 하나씩이라 세
  // 백엔드(PNG·SVG·PDF)가 같은 문자열을 소비한다.
  (doc.strokes ?? []).forEach((s) => {
    // 하이라이터는 화면과 **같은 값**으로 반투명·곱하기(boardTools의 HL_OPACITY) —
    // 내보낸 파일이 에디터와 달라 보이면 그게 버그다.
    p.path(strokePathD(s.pts), { stroke: s.color, width: s.w, round: true, ...(isHighlighter(s) ? { alpha: HL_OPACITY, blend: 'multiply' as const } : {}) });
  });

  // 영역(프레임)의 **테두리·라벨은 맨 위**(요청) — 화이트보드에서 영역은 "이
  // 구획은 여기까지"를 긋는 표식이라 안의 스티커·잉크에 가려지면 안 된다. 면(7%)은
  // 위에서 이미 그렸다(맨 아래) — 위로 올리면 그 안의 색을 물들인다. 에디터
  // `ZoneLayer`와 같은 순서다(화면과 내보낸 파일이 달라 보이면 그게 버그다).
  doc.zones.forEach((z) => {
    const zc = z.color || theme.accent;
    p.path(roundRectD(z.x, z.y, z.w, z.h, 16), { stroke: hexA(zc, 0.55), width: 2, dash: [7, 5] });
    const labelFont = fontStr(12.5, 700);
    const raw = z.label || '영역';
    const maxPillW = Math.max(20, z.w - 20); // CSS: max-width calc(100% - 20px)
    const innerMax = maxPillW - 26; // horizontal padding 13*2
    let label = raw;
    if (measure(label, labelFont) > innerMax) {
      while (label.length > 1 && measure(label + '…', labelFont) > innerMax) label = label.slice(0, -1);
      label += '…';
    }
    const labelW = measure(label, labelFont);
    const lw = Math.min(maxPillW, labelW + 26);
    p.path(roundRectD(z.x + 10, z.y - 14, lw, 27, 13.5), { fill: zc });
    p.text(label, z.x + 10 + (lw - labelW) / 2, z.y - 0.5, { px: 12.5, weight: 700, fill: z.color ? '#fff' : theme.accentInk, w: labelW });
  });
}

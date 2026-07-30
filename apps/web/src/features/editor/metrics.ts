// Node text metrics — web-layer adapter for `packages/mindmap-core`'s injected
// `SizeOf`. This is a faithful port of `Component#metrics` / `#wrapMeasure` /
// `#richLines` / `#measure` (MindFlow.dc.html:882, 893-915, 917-969, 2644-2650).
//
// Canvas text measurement is a rendering concern (per the core's own doc
// comments on `SizeOf`), so it lives here rather than in `mindmap-core`.

import type { Float, Node, RichRun } from '@mindflow/mindmap-core';
import { parseListPrefix } from '@mindflow/mindmap-core';

/** Injected text-measurement port — real canvas in the browser, a deterministic
 * character-count approximation in environments without `measureText` (jsdom). */
export interface TextMeasurer {
  measure(text: string, font: string): number;
}

/**
 * Browser canvas-based measurer (`Component#measure`, MindFlow.dc.html:882).
 * Falls back to a per-character approximation when `CanvasRenderingContext2D`
 * or `measureText` isn't usable (e.g. jsdom in unit tests) so layout/render
 * never throws — see the M3-Editor-a task's explicit fallback requirement.
 */
export class CanvasTextMeasurer implements TextMeasurer {
  private ctx: CanvasRenderingContext2D | null | undefined;

  private getCtx(): CanvasRenderingContext2D | null {
    if (this.ctx !== undefined) return this.ctx;
    this.ctx = null;
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (ctx && typeof ctx.measureText === 'function') {
        const probe = ctx.measureText('mindflow');
        if (probe && typeof probe.width === 'number' && probe.width > 0) {
          this.ctx = ctx;
        }
      }
    } catch {
      this.ctx = null;
    }
    return this.ctx;
  }

  measure(text: string, font: string): number {
    const ctx = this.getCtx();
    if (ctx) {
      ctx.font = font;
      return ctx.measureText(text || '').width;
    }
    return fallbackMeasure(text || '', font);
  }
}

/** Character-count approximation used when canvas measurement is unavailable. */
function fallbackMeasure(text: string, font: string): number {
  const m = /(\d+(?:\.\d+)?)px/.exec(font);
  const px = m?.[1] ? parseFloat(m[1]) : 14;
  const bold = /\b(700|800|900|bold)\b/i.test(font);
  const perChar = px * (bold ? 0.62 : 0.56);
  let w = 0;
  // CJK glyphs render roughly square (full-width); Latin/space narrower.
  // U+3000-U+9FFF: ideographic space + CJK punctuation/symbols/unified ideographs
  // U+AC00-U+D7A3: Hangul syllables; U+FF00-U+FFEF: fullwidth/halfwidth forms
  const CJK = /[\u3000-\u9fff\uac00-\ud7a3\uff00-\uffef]/u;
  for (const ch of text) {
    w += CJK.test(ch) ? px : perChar;
  }
  return w;
}

export interface NodeMetrics {
  font: string;
  w: number;
  h: number;
  shape: string;
  fpx: number;
  fw: number;
  /** Text-block width + 9 (border/rounding allowance) — used to clip shaped bodies. */
  tw: number;
  /** 이 결과를 만들 때 실제 사용한 줄바꿈 허용 폭 — 렌더러/미리보기가 동일한
   * 폭으로 감싸야 줄바꿈이 일치한다 (아래 과팽창 되돌림 참고). */
  wrapW: number;
}

interface RichLineSeg {
  t: string;
  b?: boolean;
  c?: string | null;
  /** 기울임 — 측정 폭이 달라지므로 폰트 문자열에 반영한다(취소선은 폭 불변이라 불필요). */
  i?: boolean;
}

/** Port of `Component#richLines` (MindFlow.dc.html:2644). */
function richLines(node: Pick<Node, 'rich'>): RichLineSeg[][] {
  const lines: RichLineSeg[][] = [[]];
  (node.rich || []).forEach((r: RichRun) => {
    String(r.t)
      .split('\n')
      .forEach((p, i) => {
        if (i > 0) lines.push([]);
        if (p) {
          const last = lines[lines.length - 1];
          last?.push({ b: r.b, c: r.c, i: r.i, t: p });
        }
      });
  });
  return lines;
}

/** 리스트 마커(`parseListPrefix`)를 떼어낸 앞쪽 `nChars` 글자를 세그먼트 배열에서
 * 제거한다 — 마커가 rich 런 경계에 걸쳐 있어도 안전하게. */
function stripLeadChars(segs: RichLineSeg[], nChars: number): RichLineSeg[] {
  let left = nChars;
  const out: RichLineSeg[] = [];
  segs.forEach((sg) => {
    if (left <= 0) {
      out.push(sg);
      return;
    }
    const t = String(sg.t);
    if (t.length <= left) {
      left -= t.length;
      return;
    }
    out.push({ ...sg, t: t.slice(left) });
    left = 0;
  });
  return out;
}

/** Port of `Component#wrapMeasure` (MindFlow.dc.html:893-915).
 *
 * 리스트 줄(`parseListPrefix`)은 마커를 행잉 인덴트 열로 떼어내 잰다: 마커 폭
 * (`display`, 기본 폰트)만큼 내용의 줄바꿈 허용 폭이 줄고, 각 시각 줄의 폭에는
 * 마커 폭이 더해진다 — `NodeLayer`의 [마커|내용] flex 렌더와 같은 모델. */
function wrapMeasure(
  node: Pick<Node, 'rich' | 'text'>,
  fpx: number,
  fw: number,
  maxW: number,
  measurer: TextMeasurer,
): { maxW: number; count: number } {
  const hardLines: RichLineSeg[][] =
    node.rich && node.rich.length ? richLines(node) : String(node.text || '주제').split('\n').map((l) => [{ t: l, b: false }]);
  let count = 0;
  let widest = 0;
  hardLines.forEach((rawSegs) => {
    const lineText = rawSegs.map((s) => String(s.t)).join('');
    const lp = parseListPrefix(lineText);
    // 마커는 렌더에서 rich 스타일 없이(기본 폰트) 그리므로 측정도 기본 폰트로.
    const markerW = lp ? measurer.measure(lp.display, `${fw} ${fpx}px Pretendard`) : 0;
    const segs = lp ? stripLeadChars(rawSegs, lp.raw.length) : rawSegs;
    const contentMaxW = Math.max(24, maxW - markerW);
    const tokens: { w: number; sp: boolean }[] = [];
    segs.forEach((sg) => {
      const f = `${sg.i ? 'italic ' : ''}${sg.b ? 800 : fw} ${fpx}px Pretendard`;
      const parts = String(sg.t).match(/[A-Za-z0-9]+|\s+|./g) || [];
      parts.forEach((p) => tokens.push({ w: measurer.measure(p, f), sp: /^\s+$/.test(p) }));
    });
    let cur = 0;
    let lines = 1;
    tokens.forEach((tk) => {
      if (cur > 0 && cur + tk.w > contentMaxW && !tk.sp) {
        lines++;
        // 후행 공백은 줄 폭에 넣지 않는다(`Math.min`) — 공백 토큰은 위 조건의
        // `!tk.sp`로 넘치더라도 그대로 더해지므로 `cur`가 maxW를 몇 px 넘을 수
        // 있고, 그 값이 그대로 줄 폭으로 기록되면 자연 폭이 cw를 아슬아슬하게
        // 넘어 아래 과팽창 되돌림이 **엉뚱하게** 발동한다(폭을 드래그하는 동안
        // 랩 폭이 cw↔320을 오가며 줄 수가 바뀌어 높이가 튀던 버그). 마지막 줄
        // 기록(아래)에는 원래부터 있던 클램프인데 이 중간 기록에만 빠져 있었다.
        widest = Math.max(widest, Math.min(markerW + cur, maxW));
        cur = tk.w;
      } else {
        cur += tk.w;
      }
    });
    widest = Math.max(widest, Math.min(markerW + cur, maxW));
    count += lines;
  });
  if (!widest) widest = measurer.measure(' ', `${fw} ${fpx}px Pretendard`);
  return { maxW: widest, count: Math.max(1, count) };
}

/**
 * Port of `Component#metrics(node, depth)` (MindFlow.dc.html:917-969) — the
 * node box sizing used by both `layout()` (as `SizeOf`, w/h only) and the
 * renderer (which additionally needs `font`/`fpx`/`fw`/`tw`/`shape`).
 */
export function computeMetrics(node: Node, depth: number, measurer: TextMeasurer): NodeMetrics {
  const basePx = depth === 0 ? 20 : depth === 1 ? 15 : 14;
  const fpx = node.tsize === 's' ? basePx - 3 : node.tsize === 'l' ? basePx + 5 : basePx;
  const fw = node.bold ? 800 : depth === 0 ? 700 : depth === 1 ? 600 : 500;
  const font = `${fw} ${fpx}px Pretendard`;
  const padX = depth === 0 ? 24 : depth === 1 ? 15 : 13;
  const emW = node.emoji ? Math.ceil(measurer.measure(node.emoji, `${depth === 0 ? 22 : 17}px Pretendard`)) + 7 + 2 : 0;
  const shape = node.shape || 'round';

  /** 주어진 줄바꿈 허용 폭으로 자연 크기(도형 팽창·이미지 포함, cw/ch 클램프 제외)를 계산. */
  const build = (wrapW: number): { w: number; h: number; textW: number } => {
    let h = (depth === 0 ? 52 : depth === 1 ? 42 : 34) + (fpx - basePx) * 1.6;
    const wm = wrapMeasure(node, fpx, fw, wrapW, measurer);
    const lineCount = wm.count;
    const maxLine = wm.maxW;
    let w = Math.ceil(maxLine) + padX * 2 + emW + 7;
    const minW = depth === 0 ? 130 : 58;
    w = Math.max(minW, w);
    if (lineCount > 1) {
      const lineH = Math.round(fpx * 1.4);
      h += (lineCount - 1) * lineH;
    }
    const lineH2 = Math.round(fpx * 1.4);
    const textW = Math.ceil(maxLine) + emW;
    const textH = lineCount * lineH2;
    if (shape === 'diamond') {
      const H = Math.max(h * 1.7, textH * 2.4);
      const room = Math.max(0.18, 0.94 - textH / H);
      w = Math.max(w * 1.45 + 20, textW / room + padX * 2);
      h = H;
    } else if (shape === 'hexagon') {
      w = Math.max(w + h * 0.9, textW / 0.7 + padX * 2);
    } else if (shape === 'parallelogram') {
      w = Math.max(w + 28, textW / 0.66 + padX * 2);
    } else if (shape === 'pill') {
      const r0 = ((depth === 0 ? 52 : depth === 1 ? 42 : 34) + (fpx - basePx) * 1.6 + (lineCount - 1) * lineH2) / 2;
      const yoff = Math.min(r0, textH / 2);
      const inset = r0 - Math.sqrt(Math.max(0, r0 * r0 - yoff * yoff));
      w = Math.max(w, textW + 2 * inset + padX * 2);
    } else if (shape === 'ellipse') {
      w = Math.max(w * 1.22 + 8, textW * 1.42 + padX * 2);
      h = Math.max(h + 8, textH * 1.42 + 10);
    }
    // 노드 이미지: 텍스트 위 썸네일 — 폭은 이미지+패딩을 수용하고 높이가 늘어난다
    // (imgW/imgH는 첨부 시 비율 유지로 고정 계산된 표시 크기, Node.img 참고).
    if (node.img && node.imgW && node.imgH) {
      w = Math.max(w, node.imgW + padX * 2);
      h += node.imgH + 8;
    }
    return { w, h, textW };
  };

  const BASE_WRAP = 320;
  const cwWrap = Math.max(BASE_WRAP, (node.cw || 0) - padX * 2 - emW - 7);
  let wrapW = cwWrap;
  let m = build(cwWrap);
  // 과팽창 되돌림: 사용자가 폭(cw)을 지정하면 줄바꿈 허용 폭도 cw 기준으로
  // 넓어지는데, 텍스트 폭에 배율을 곱하는 도형(타원·육각형·마름모·평행사변형)
  // 은 "긴 줄로 다시 풀린 텍스트 × 배율"이 cw 자체를 넘어버린다 — 리사이즈
  // 핸들을 1px만 끌어도 폭이 폭발하던 버그. 넓힌 랩의 자연 폭이 cw를 넘으면
  // 기본 랩(320)으로 계산해, 최종 폭이 max(자연폭, cw)로 단조 증가하게 한다.
  // (cw가 충분히 커져 풀린 텍스트가 들어맞는 순간부터는 자연히 반영된다.)
  // ⚠️ 초과분이 **반올림 오차 수준**이면 되돌리지 않는다(`ROUNDING_SLACK`).
  // 줄 폭은 `Math.ceil`로 올림되는데 `cw`는 소수일 수 있다 — 리사이즈 드래그의
  // 이동량이 `/zoom`으로 나뉘어 들어오므로 줌이 1이 아니면 항상 소수다. 그러면
  // `ceil(줄 폭) + 여백`이 cw를 **1px 미만** 넘고, 그 미세한 초과가 이 되돌림을
  // 발동시켜 줄바꿈 폭이 320으로 붕괴한다 → 줄 수가 폭증해 높이가 수십 px 뛴다.
  // 다음 1px에서 조건이 꺼지면 되돌아오므로, 폭을 조금씩 줄이는 동안 높이가
  // 오르내리며 요동쳤다(제보: 1px 줄였는데 도형이 세로로 확 커짐 — 그때 텍스트
  // 줄 수는 그대로여서 박스 안에 빈 여백만 생겼다).
  // 배율 도형의 **진짜** 과팽창은 폭의 수십 %(수백 px) 단위라 이 여유로 놓치지 않는다.
  const ROUNDING_SLACK = 2;
  if (node.cw && cwWrap > BASE_WRAP && m.w > node.cw + ROUNDING_SLACK) {
    wrapW = BASE_WRAP;
    m = build(BASE_WRAP);
  }
  let { w, h } = m;
  if (node.cw) w = Math.max(w, node.cw);
  if (node.ch) h = Math.max(h, node.ch);
  return { font, w, h, shape, fpx, fw, tw: m.textW + 9, wrapW };
}

/** Number of wrapped lines `text` occupies at `maxW` px in `font`, using the same
 * whitespace-preserving, CJK-per-char token model as the node/PNG wrappers (so a
 * memo's measured height matches how its text actually flows on screen). */
function countWrappedLines(text: string, maxW: number, font: string, measurer: TextMeasurer): number {
  let total = 0;
  for (const rawHard of String(text).split('\n')) {
    // 리스트 줄: 마커를 행잉 인덴트 열로 떼어내고 내용만 좁아진 폭으로 잰다
    // (`FloatLayer`의 [마커|내용] flex 렌더와 동일 모델 — wrapMeasure 참고).
    const lp = parseListPrefix(rawHard);
    const markerW = lp ? measurer.measure(lp.display, font) : 0;
    const hard = lp ? rawHard.slice(lp.raw.length) : rawHard;
    const lineMaxW = Math.max(8, maxW - markerW);
    if (!hard) {
      total += 1;
      continue;
    }
    const tokens = hard.match(/[A-Za-z0-9]+|\s+|./gu) || [hard];
    let hasContent = false;
    let lineW = 0;
    let lines = 1;
    for (const tk of tokens) {
      const w = measurer.measure(tk, font);
      const isSpace = /^\s+$/.test(tk);
      if (hasContent && lineW + w > lineMaxW && !isSpace) {
        lines++;
        lineW = w;
        hasContent = true;
      } else {
        lineW += w;
        hasContent = hasContent || !isSpace || tk.length > 0;
      }
    }
    total += lines;
  }
  return Math.max(1, total);
}

/**
 * Rendered height of a memo card — the same growing `min-height` box `FloatLayer`
 * draws (padding 9/32/9/11, `line-height: 1.55`, text wrapped to the inner
 * width), so line-anchor snapping/ports and hit-testing use the memo's ACTUAL
 * size instead of a fixed `f.h`. Port of the original's measured `_floatH`
 * (MindFlow.dc.html) — pure, via the injected `measurer` (canvas or fallback).
 */
export function measureFloatHeight(f: Float, measurer: TextMeasurer): number {
  // 이미지 플로트: 높이는 텍스트 측정이 아니라 첨부/리사이즈 때 기록된
  // 명시적 h(비율 유지)가 곧 박스 높이다.
  if (f.img) return Math.max(24, Math.round(f.h ?? (f.w || 160) * 0.75));
  const fpx = f.tsize === 's' ? 11.5 : f.tsize === 'l' ? 15.5 : 13;
  const lh = fpx * 1.55;
  const grownOf = (lineCount: number): number => 9 + Math.max(18, lineCount * lh) + 9;
  if (f.collapsed) return Math.max(38, grownOf(1));
  const font = `${f.bold ? 700 : 400} ${fpx}px Pretendard`;
  const innerW = Math.max(8, (f.w || 160) - 32 - 11); // left pad 32 (fold toggle), right pad 11
  const lines = f.text ? countWrappedLines(f.text, innerW, font, measurer) : 1;
  return Math.max(f.h || 44, grownOf(lines));
}

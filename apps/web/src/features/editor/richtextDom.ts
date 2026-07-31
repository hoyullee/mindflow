// DOM-facing rich-text editing helpers — the browser half of the partial
// (per-character-range) styling pipeline whose char-model core lives in
// `@mindflow/mindmap-core`'s `richtext.ts` (`applyPartialStyle`/`stripRichStyle`).
// These are direct ports of `Component`'s own DOM-touching helpers
// (MindFlow.dc.html:2558-2613, 2657-2698) — kept here (not in the core
// package) specifically because they read/write a live `contentEditable`
// element's DOM/Selection, which the core package's DOM-purity lint forbids.

import type { RichRun } from '@mindflow/mindmap-core';

/** Port of `Component#escHtml` (MindFlow.dc.html:2558). */
export function escHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Port of `Component#rgbToHex` (MindFlow.dc.html:2559-2563) — normalizes a computed
 * `rgb(...)`/`rgba(...)` color (what `node.style.color` reads back as in every browser)
 * to a `#rrggbb` hex string; a value that's already `#...` passes through unchanged. */
export function rgbToHex(c: string | null | undefined): string | null {
  if (!c) return null;
  if (c[0] === '#') return c;
  const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  return (
    '#' +
    [m[1], m[2], m[3]]
      .map((x) => (+(x as string)).toString(16).padStart(2, '0'))
      .join('')
  );
}

/** The `{ text, rich }` shape these helpers read/write — same structural subset of
 * `Node` that `@mindflow/mindmap-core`'s `applyPartialStyle` takes (`RichSource`). */
export interface RichTextValue {
  text: string;
  rich?: RichRun[] | null;
}

/** Port of `Component#runsToHtml` (MindFlow.dc.html:2564-2572) — renders `rich` runs (or
 * plain `text`, absent that) into the innerHTML a `contentEditable` box should show. */
export function runsToHtml(n: RichTextValue): string {
  const conv = (t: string) => escHtml(t).replace(/\n/g, '<br>');
  if (!n.rich || !n.rich.length) return conv(n.text || '');
  return n.rich
    .map((r) => {
      let st = '';
      if (r.b) st += 'font-weight:800;';
      if (r.c) st += 'color:' + r.c + ';';
      if (r.i) st += 'font-style:italic;';
      if (r.s) st += 'text-decoration:line-through;';
      return st ? `<span style="${st}">${conv(r.t)}</span>` : conv(r.t);
    })
    .join('');
}

/** Port of `Component#domToRuns` (MindFlow.dc.html:2574-2613) — walks a `contentEditable`
 * box's live DOM and reconstructs `{ text, rich }` from it (B/STRONG/`font-weight`→bold,
 * `FONT[color]`/`style.color`→hex, DIV/P/BR→`\n`).
 *
 * `keepTrailing` (default `false`) matches the original's two call sites: the final commit
 * (`commitRichEdit`) trims ALL trailing newlines, while a live in-progress read (this port's
 * `applyPartial` reads the box mid-edit) keeps a single trailing newline collapsed to nothing
 * so `contentEditable`'s own placeholder-`<br>`-for-an-empty-last-line quirk doesn't leak an
 * extra blank line into the parsed text. */
export function domToRuns(el: HTMLElement, keepTrailing = false): { text: string; rich: RichRun[] | null } {
  const runs: RichRun[] = [];
  interface St {
    b: boolean;
    c: string | null;
    i: boolean;
    s: boolean;
  }
  const push = (t: string, st: St): void => {
    if (!t) return;
    const last = runs[runs.length - 1];
    if (last && !!last.b === st.b && (last.c || null) === (st.c || null) && !!last.i === st.i && !!last.s === st.s) last.t += t;
    else {
      const r: RichRun = { t, b: st.b, c: st.c || null };
      if (st.i) r.i = true;
      if (st.s) r.s = true;
      runs.push(r);
    }
  };
  const walk = (node: ChildNode, st: St): void => {
    if (node.nodeType === 3) {
      push(node.nodeValue || '', st);
      return;
    }
    if (node.nodeType !== 1) return;
    const el2 = node as HTMLElement;
    const tag = el2.nodeName;
    if (tag === 'BR') {
      push('\n', st);
      return;
    }
    const next: St = { ...st };
    if (tag === 'B' || tag === 'STRONG') next.b = true;
    if (tag === 'I' || tag === 'EM') next.i = true;
    if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') next.s = true;
    if (tag === 'FONT' && el2.getAttribute('color')) next.c = el2.getAttribute('color');
    if (el2.style) {
      const fw = el2.style.fontWeight;
      if (fw) {
        const w = parseInt(fw, 10);
        next.b = fw === 'bold' || (!!w && w >= 600) ? true : fw === 'normal' || (!!w && w < 600) ? false : next.b;
      }
      if (el2.style.color) next.c = rgbToHex(el2.style.color) || next.c;
      const fs = el2.style.fontStyle;
      if (fs === 'italic' || fs === 'oblique') next.i = true;
      else if (fs === 'normal') next.i = false;
      // textDecoration은 shorthand라 브라우저마다 'line-through'/'line-through solid …'로
      // 읽힌다 — 포함 여부로 본다. 'none'은 해제.
      const td = el2.style.textDecoration || el2.style.textDecorationLine || '';
      if (/line-through/.test(td)) next.s = true;
      else if (td === 'none') next.s = false;
    }
    const isBlock = tag === 'DIV' || tag === 'P';
    if (isBlock && runs.length && runs[runs.length - 1]!.t.slice(-1) !== '\n') push('\n', st);
    el2.childNodes.forEach((child) => walk(child, next));
  };
  el.childNodes.forEach((child) => walk(child, { b: false, c: null, i: false, s: false }));
  if (!keepTrailing) {
    while (runs.length && /^\n+$/.test(runs[runs.length - 1]!.t)) runs.pop();
    if (runs.length) runs[runs.length - 1]!.t = runs[runs.length - 1]!.t.replace(/\n+$/, '');
  } else if (runs.length) {
    const last = runs[runs.length - 1]!;
    if (/\n$/.test(last.t)) {
      last.t = last.t.replace(/\n$/, '');
      if (!last.t) runs.pop();
    }
  }
  // 리스트 들여쓰기는 화면에서 EN SPACE(U+2002)로 그려진다(코어 `list.ts` —
  // 일반 공백은 단계가 안 보일 만큼 좁다). 저장본은 **일반 공백**으로 되돌린다:
  // 마크다운 중첩·외부 복사·diff에서 보이지 않는 문자가 남지 않게. 1:1 치환이라
  // 길이가 그대로여서 선택 오프셋 계약도 흔들리지 않는다.
  runs.forEach((r) => {
    r.t = r.t.replace(/\u2002/g, ' ');
  });
  const text = runs.map((r) => r.t).join('');
  const styled = runs.some((r) => r.b || r.c || r.i || r.s);
  return { text, rich: styled ? runs.filter((r) => r.t) : null };
}

/** One DOM position to resolve into a linear text offset — the `{ container, offset }`
 * shape a `Range`'s `startContainer`/`startOffset` (or `endContainer`/`endOffset`) already
 * has, so callers typically pass those straight through. */
export interface DomMark {
  container: Node;
  offset: number;
}

/** Port of `Component#linearize` (MindFlow.dc.html:2657-2675): resolves DOM position(s)
 * inside the editor into plain-text offsets, using the SAME text-reconstruction rules as
 * `domToRuns` (block elements insert an implicit `\n`, `<br>` counts as one `\n`) so an
 * offset computed here lines up exactly with `domToRuns(el).text`. */
export function linearize(el: HTMLElement, marks: DomMark[]): { text: string; pos: number[] } {
  let text = '';
  const res = new Array<number>(marks.length).fill(-1);
  const walk = (node: Node): void => {
    marks.forEach((m, i) => {
      if (res[i]! < 0 && m.container === node && node.nodeType === 3) res[i] = text.length + m.offset;
    });
    if (node.nodeType === 3) {
      text += node.nodeValue || '';
      return;
    }
    if (node.nodeType !== 1) return;
    if (node.nodeName === 'BR') {
      text += '\n';
      return;
    }
    const isBlock = (node.nodeName === 'DIV' || node.nodeName === 'P') && node !== el;
    if (isBlock && text && text.slice(-1) !== '\n') text += '\n';
    for (let i = 0; i < node.childNodes.length; i++) {
      marks.forEach((m, ii) => {
        if (res[ii]! < 0 && m.container === node && m.offset === i) res[ii] = text.length;
      });
      walk(node.childNodes[i]!);
    }
    marks.forEach((m, ii) => {
      if (res[ii]! < 0 && m.container === node && m.offset >= node.childNodes.length) res[ii] = text.length;
    });
  };
  walk(el);
  marks.forEach((m, i) => {
    if (res[i]! < 0) res[i] = text.length;
  });
  return { text, pos: res };
}

/** Port of `Component#setLinearSelection` (MindFlow.dc.html:2677-2698): the inverse of
 * `linearize` — re-applies a `[s0, s1)` plain-text offset range as the live DOM Selection,
 * used after `applyPartial` rewrites the editor's innerHTML (which otherwise drops the
 * user's selection) to restore it so a follow-up style click still targets the same run. */
export function setLinearSelection(el: HTMLElement, s0: number, s1: number): void {
  let acc = 0;
  let sC: Node | null = null;
  let sO = 0;
  let eC: Node | null = null;
  let eO = 0;
  const walk = (node: Node): void => {
    if (sC && eC) return;
    if (node.nodeType === 3) {
      const len = (node.nodeValue || '').length;
      if (!sC && s0 <= acc + len) {
        sC = node;
        sO = Math.max(0, s0 - acc);
      }
      if (!eC && s1 <= acc + len) {
        eC = node;
        eO = Math.max(0, s1 - acc);
      }
      acc += len;
      return;
    }
    if (node.nodeType !== 1) return;
    if (node.nodeName === 'BR') {
      acc += 1;
      return;
    }
    const isBlock = (node.nodeName === 'DIV' || node.nodeName === 'P') && node !== el;
    if (isBlock && acc > 0) acc += 1;
    for (let i = 0; i < node.childNodes.length; i++) {
      walk(node.childNodes[i]!);
      if (sC && eC) return;
    }
  };
  walk(el);
  try {
    const ws = window.getSelection();
    if (!ws) return;
    const r = document.createRange();
    r.setStart(sC || el, sC ? sO : 0);
    r.setEnd(eC || el, eC ? eO : el.childNodes.length);
    ws.removeAllRanges();
    ws.addRange(r);
    el.focus();
  } catch {
    /* a stale/detached range (element unmounted mid-operation) — nothing to restore */
  }
}

// DOM-facing rich-text editing helpers — the browser half of the partial
// (per-character-range) styling pipeline whose char-model core lives in
// `@mindflow/mindmap-core`'s `richtext.ts` (`applyPartialStyle`/`stripRichStyle`).
// These are direct ports of `Component`'s own DOM-touching helpers
// (MindFlow.dc.html:2558-2613, 2657-2698) — kept here (not in the core
// package) specifically because they read/write a live `contentEditable`
// element's DOM/Selection, which the core package's DOM-purity lint forbids.

import type { RichRun } from '@mindflow/mindmap-core';
import { isStyledRuns, normalizeUrl } from '@mindflow/mindmap-core';
import { LINK_CLASS, isLinkInk } from './richSpans';

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
      const inner = st ? `<span style="${st}">${conv(r.t)}</span>` : conv(r.t);
      // 링크는 `data-href`를 가진 span으로 — 편집 박스(contentEditable) 안에서는
      // 실제 `<a href>`가 브라우저 기본 동작(드래그로 링크 끌기 등)을 끌어들이고,
      // 무엇보다 저장된 주소를 그대로 DOM 속성에 싣지 않아도 왕복이 된다.
      // 클릭해서 여는 건 커밋된 렌더(`NodeLayer`)가 담당한다.
      // 색은 `.mf-link` 클래스(→ `--mf-link`)가 준다 — 인라인 `color`로 심으면
      // 커밋 때 `domToRuns`가 그걸 런의 `c`로 저장해 링크를 떼도 파란색이 남는다.
      return r.href ? `<span class="${LINK_CLASS}" data-href="${escHtml(r.href)}" style="text-decoration:underline">${inner}</span>` : inner;
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
    href: string | null;
  }
  const push = (t: string, st: St): void => {
    if (!t) return;
    const last = runs[runs.length - 1];
    if (last && !!last.b === st.b && (last.c || null) === (st.c || null) && !!last.i === st.i && !!last.s === st.s && (last.href || null) === (st.href || null)) last.t += t;
    else {
      const r: RichRun = { t, b: st.b, c: st.c || null };
      if (st.i) r.i = true;
      if (st.s) r.s = true;
      if (st.href) r.href = st.href;
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
    if (tag === 'FONT' && el2.getAttribute('color') && !isLinkInk(el2.getAttribute('color') || '')) next.c = el2.getAttribute('color');
    // 링크: 우리가 심은 `data-href`, 그리고 붙여넣기로 들어온 진짜 `<a href>`도 받는다.
    const linkAttr = el2.getAttribute('data-href') || (tag === 'A' ? el2.getAttribute('href') : null);
    if (linkAttr) next.href = normalizeUrl(linkAttr);
    if (el2.style) {
      const fw = el2.style.fontWeight;
      if (fw) {
        const w = parseInt(fw, 10);
        next.b = fw === 'bold' || (!!w && w >= 600) ? true : fw === 'normal' || (!!w && w < 600) ? false : next.b;
      }
      if (el2.style.color) {
        const hex = rgbToHex(el2.style.color);
        // 링크 파랑은 **표시용**이지 모델 값이 아니다. 클래스로만 주는데도 여기
        // 걸리는 경로가 하나 있다: 링크 글자 위에서 타이핑하면 크롬이 그 자리의
        // 계산된 색을 인라인 span으로 굳혀 넣는다(typing style). 그대로 읽으면
        // 링크를 떼도 파란 글자가 남는다 — 실브라우저에서 재현. 색 선택은 스와치
        // 전용이고 두 링크색은 어느 테마 팔레트에도 없어, 걸러도 잃는 게 없다.
        if (hex && !isLinkInk(hex)) next.c = hex;
      }
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
  el.childNodes.forEach((child) => walk(child, { b: false, c: null, i: false, s: false, href: null }));
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
  // "서식이 있는가" 판정은 코어 한 곳(`isStyledRuns`)에 있다 — 링크만 걸린 런이
  // 평문으로 접혀 링크가 사라지는 일이 없게.
  return { text, rich: isStyledRuns(runs) ? runs.filter((r) => r.t) : null };
}

/** 편집 박스의 **현재 값**과, `linearize`가 준 오프셋을 그 값 안으로 맞추는 클램프.
 *
 * 편집 박스는 빈 마지막 줄을 보이게 하려고 placeholder `<br>`를 하나 더 둔다
 * (`listEditHtml`). `linearize`는 그 `<br>`까지 한 글자로 세는 반면 값 쪽은 후행
 * 줄바꿈 하나를 접으므로, 캐럿이 맨 끝에 있을 때 오프셋이 값보다 1 크다.
 * 둘을 따로 읽으면 그 한 칸이 어긋난다 — 실제로 "빈 줄에서 Shift+Enter를 눌렀는데
 * 캐럿이 **앞 줄**로 읽혀 리스트가 되살아나던" 제보의 원인이었다. `keepTrailing`으로
 * 읽고(빈 줄을 값에 남기고) 오프셋을 값 길이로 자르면 두 좌표계가 다시 맞는다. */
export function liveEditValue(el: HTMLElement): { text: string; rich: RichRun[] | null; clamp: (n: number) => number } {
  const v = domToRuns(el, true);
  return { text: v.text, rich: v.rich, clamp: (n) => Math.max(0, Math.min(n, v.text.length)) };
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
  // 마지막으로 지나온 위치 — 어떤 이유로든 오프셋을 못 찾았을 때의 폴백.
  // 예전엔 못 찾으면 `el` 전체를 선택했는데, 그러면 다음 타이핑이 본문을 통째로
  // 갈아엎는다(제보: 빈 줄에서 Backspace 후 글자를 치면 전부 사라짐).
  let lastC: Node | null = null;
  let lastO = 0;
  const walk = (node: Node): void => {
    if (sC && eC) return;
    if (node.nodeType === 3) {
      const len = (node.nodeValue || '').length;
      // 리스트 마커 스팬의 **끝 경계**는 내용 쪽에 양보한다. 마커 스팬은
      // `white-space: pre`(flex-shrink 0)라 그 안에 들어간 글자는 줄바꿈되지 않아
      // 도형을 뚫고 나간다(제보) — Shift+Enter·Tab 직후 캐럿이 정확히 이 경계에
      // 오므로, 여기서 양보하지 않으면 이어지는 타이핑이 전부 마커 안에 쌓인다.
      const inMarker = !!(node.parentElement && node.parentElement.hasAttribute('data-list-marker'));
      const claim = (pos: number): boolean => pos < acc + len || (pos === acc + len && !inMarker);
      if (!sC && claim(s0)) {
        sC = node;
        sO = Math.max(0, s0 - acc);
      }
      if (!eC && claim(s1)) {
        eC = node;
        eO = Math.max(0, s1 - acc);
      }
      acc += len;
      lastC = node;
      lastO = len;
      return;
    }
    if (node.nodeType !== 1) return;
    if (node.nodeName === 'BR') {
      // 빈 줄은 텍스트 노드가 없고 `<br>`만 있다 — 그 자리를 캐럿 위치로 인정한다
      // (부모 + 자식 인덱스). 이게 없으면 빈 줄로 가는 오프셋이 영영 안 풀린다.
      const parent = node.parentNode;
      const idx = parent ? Array.prototype.indexOf.call(parent.childNodes, node) : 0;
      if (!sC && s0 <= acc) {
        sC = parent;
        sO = idx;
      }
      if (!eC && s1 <= acc) {
        eC = parent;
        eO = idx;
      }
      acc += 1;
      if (parent) {
        lastC = parent;
        lastO = idx;
      }
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
    // 못 찾은 오프셋은 **마지막으로 지나온 자리**로 모은다(내용이 아예 없을 때만
    // `el` 전체 — 그때는 선택할 것도 없다).
    r.setStart(sC || lastC || el, sC ? sO : lastC ? lastO : 0);
    r.setEnd(eC || lastC || el, eC ? eO : lastC ? lastO : el.childNodes.length);
    ws.removeAllRanges();
    ws.addRange(r);
    el.focus();
  } catch {
    /* a stale/detached range (element unmounted mid-operation) — nothing to restore */
  }
}

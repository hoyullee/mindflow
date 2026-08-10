// DOM-facing rich-text editing helpers — the browser half of the partial
// (per-character-range) styling pipeline whose char-model core lives in
// `@mindflow/mindmap-core`'s `richtext.ts` (`applyPartialStyle`/`stripRichStyle`).
// These are direct ports of `Component`'s own DOM-touching helpers
// (MindFlow.dc.html:2558-2613, 2657-2698) — kept here (not in the core
// package) specifically because they read/write a live `contentEditable`
// element's DOM/Selection, which the core package's DOM-purity lint forbids.

import type { RichRun } from '@mindflow/mindmap-core';
import { isStyledRuns, normalizeUrl, parseListPrefix } from '@mindflow/mindmap-core';
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
      if (r.href) return `<span class="${LINK_CLASS}" data-href="${escHtml(r.href)}" style="text-decoration:underline">${inner}</span>`;
      // 멘션 — 링크와 같은 이유로 클래스+data 속성만(색은 `.mf-mention`이 준다).
      if (r.m) return `<span class="mf-mention" data-mention-email="${escHtml(r.m)}">${inner}</span>`;
      return inner;
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
    m: string | null;
  }
  const push = (t: string, st: St): void => {
    if (!t) return;
    const last = runs[runs.length - 1];
    if (last && !!last.b === st.b && (last.c || null) === (st.c || null) && !!last.i === st.i && !!last.s === st.s && (last.href || null) === (st.href || null) && (last.m || null) === (st.m || null)) last.t += t;
    else {
      const r: RichRun = { t, b: st.b, c: st.c || null };
      if (st.i) r.i = true;
      if (st.s) r.s = true;
      if (st.href) r.href = st.href;
      if (st.m) r.m = st.m;
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
    const mentionAttr = el2.getAttribute('data-mention-email');
    if (mentionAttr) next.m = mentionAttr;
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
  el.childNodes.forEach((child) => walk(child, { b: false, c: null, i: false, s: false, href: null, m: null }));
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

/**
 * 편집 박스 안의 **현재 선택 구간**을 값(raw 텍스트) 좌표계에서 잘라 돌려준다 —
 * 선택이 없거나(캐럿뿐) 박스 밖이면 `null`.
 *
 * 복사 전용: 리스트 마커 스팬은 `user-select: none`이라(제보: 전체 선택 시 마커까지
 * 선택돼 보임) 브라우저 기본 복사에서는 마커가 **빠진** 텍스트가 실린다. 마커는
 * 데이터의 일부이므로(텍스트 마커가 곧 리스트) 붙여넣으면 리스트가 사라진다 —
 * 대신 값에서 자르면 선택 경계 **사이**의 마커·들여쓰기가 원문 그대로 보존된다.
 * 한 줄 일부만 고른 선택은 경계가 내용 안이라 어차피 마커를 물지 않는다(무변경).
 */
export function selectedRawText(el: HTMLElement): string | null {
  const ws = window.getSelection();
  if (!ws || !ws.rangeCount || ws.isCollapsed) return null;
  const rng = ws.getRangeAt(0);
  if (!el.contains(rng.startContainer) || !el.contains(rng.endContainer)) return null;
  const lin = linearize(el, [
    { container: rng.startContainer, offset: rng.startOffset },
    { container: rng.endContainer, offset: rng.endOffset },
  ]);
  const v = liveEditValue(el);
  const a = v.clamp(Math.min(lin.pos[0] ?? 0, lin.pos[1] ?? 0));
  const b = v.clamp(Math.max(lin.pos[0] ?? 0, lin.pos[1] ?? 0));
  if (a === b) return null;
  return v.text.slice(a, b);
}

/** `off`가 있는 줄이 리스트고 `off`가 마커 구역(줄 시작 ~ 마커 끝 직전) 안이면
 * 그 줄의 **내용 시작** 오프셋을, 아니면 `null`을 돌려준다. */
function markerContentStart(text: string, off: number): number | null {
  const lineStart = text.lastIndexOf('\n', off - 1) + 1;
  const nl = text.indexOf('\n', lineStart);
  const line = text.slice(lineStart, nl === -1 ? undefined : nl);
  const p = parseListPrefix(line);
  if (!p) return null;
  const cs = lineStart + p.raw.length;
  return off < cs ? cs : null;
}

/** 편집 박스의 접힌 캐럿을 읽어 값 좌표 오프셋으로 — 선택이 없거나(범위 선택)
 * 박스 밖이면 `null`. */
function collapsedCaret(el: HTMLElement): { off: number; text: string } | null {
  const ws = window.getSelection();
  if (!ws || !ws.rangeCount || !ws.isCollapsed) return null;
  const rng = ws.getRangeAt(0);
  if (!el.contains(rng.startContainer)) return null;
  const lin = linearize(el, [{ container: rng.startContainer, offset: rng.startOffset }]);
  const v = liveEditValue(el);
  return { off: v.clamp(lin.pos[0] ?? 0), text: v.text };
}

/**
 * 캐럿이 리스트 **마커 구역**에 있으면 그 줄의 내용 시작으로 옮긴다(옮겼으면 true).
 *
 * 배경(제보): 마커 스팬에 `user-select: none`을 준 뒤 크롬이 마커 텍스트 안에는
 * 캐럿을 놓지 않는 대신 **마커 앞**(행 시작)에 캐럿 자리를 만들었다 — 거기서 친
 * 글자가 마커 앞에 쌓여 그 줄이 리스트에서 풀렸다(`ㅇㅇㅇ5. 오케이`). 마커는
 * 편집기가 관리하는 장식이므로 캐럿이 앉을 자리가 아니다 — 클릭·방향키·Home 등
 * 어떤 경로로 들어와도 내용 시작으로 스냅한다(Notion과 같은 감각). 편집 박스의
 * selectionchange·keydown 두 곳에서 부른다(클릭 직후 빠른 타이핑 대비 이중화).
 */
export function snapCaretOffListMarker(el: HTMLElement): boolean {
  const ws = window.getSelection();
  if (!ws || !ws.rangeCount || !ws.isCollapsed) return false;
  const rng = ws.getRangeAt(0);
  if (!el.contains(rng.startContainer)) return false;
  const c = collapsedCaret(el);
  if (!c) return false;
  const cs = markerContentStart(c.text, c.off);
  if (cs != null) {
    setLinearSelection(el, cs, cs);
    return true;
  }
  // 값 좌표는 이미 내용 시작(마커 끝 경계)이지만 DOM 앵커가 마커 **노드 안**에
  // 남는 경우(↑/↓ 세로 이동 등) — 같은 픽셀 자리라 보이진 않아도, 다음 타이핑이
  // 마커 스팬(white-space:pre)으로 들어간다. 내용 쪽으로 재앵커한다
  // (`setLinearSelection`은 마커 끝 경계를 내용에 양보하므로 같은 오프셋이면 된다).
  const anchor = rng.startContainer.nodeType === 3 ? rng.startContainer.parentElement : (rng.startContainer as Element | null);
  if (anchor && typeof anchor.closest === 'function' && anchor.closest('[data-list-marker]')) {
    setLinearSelection(el, c.off, c.off);
    return true;
  }
  return false;
}

/**
 * ArrowLeft 전용: 캐럿이 리스트 줄의 **내용 시작**에 있으면 마커를 통째로 건너
 * 앞 줄 끝으로 보낸다(처리했으면 true — 호출부가 preventDefault). 스냅만 있으면
 * 기본 ArrowLeft가 마커 구역으로 들어갔다 되튕겨 캐럿이 그 줄에 갇힌다.
 * 첫 줄이면 갈 곳이 없어 제자리(그래도 true — 마커 구역 진입은 막는다).
 */
export function listArrowLeft(el: HTMLElement): boolean {
  const c = collapsedCaret(el);
  if (!c) return false;
  const lineStart = c.text.lastIndexOf('\n', c.off - 1) + 1;
  const nl = c.text.indexOf('\n', lineStart);
  const line = c.text.slice(lineStart, nl === -1 ? undefined : nl);
  const p = parseListPrefix(line);
  if (!p || c.off !== lineStart + p.raw.length) return false;
  const target = lineStart > 0 ? lineStart - 1 : c.off;
  setLinearSelection(el, target, target);
  return true;
}

/**
 * ↑/↓ 세로 캐럿 이동 — 리스트 편집 박스에서는 **우리가 직접** 처리한다(처리했으면
 * true — 호출부가 preventDefault).
 *
 * 배경(제보: ↑를 눌러도 캐럿이 위로 안 올라감): 크롬의 세로 캐럿 이동은
 * [마커|내용] **flex 행 경계를 건너지 못한다** — 앱 JS가 전혀 없는 정적
 * contenteditable로 재현해도(마커 user-select 여부와 무관) ↑가 이전 행으로 가지
 * 않고 같은 행의 마커 끝 경계에 떨어진다. 리스트 도입 때부터의 잠복 문제.
 *
 * 이동 좌표는 **픽셀 기준**(`caretRangeFromPoint`) — 캐럿 rect에서 한 줄 높이만큼
 * 위/아래 지점의 캐럿 자리를 찾으므로, 감긴 줄(한 행 안의 여러 시각 줄) 안 이동도
 * 자연스럽다. 도착점이 마커 구역이면 내용 시작으로 클램프. 편집 박스 밖(첫 줄
 * 위/끝 줄 아래)은 관례대로 첫 줄 내용 시작/텍스트 끝. 픽셀 API가 없는 환경
 * (jsdom)은 내용-시작 기준 열 보존의 텍스트 모델로 폴백한다.
 */
export function listArrowVertical(el: HTMLElement, dir: -1 | 1): boolean {
  // 리스트 행이 없으면 기본 동작 그대로 — 평문 줄(<div>)은 크롬이 잘 다닌다.
  if (!el.querySelector('[data-list-marker]')) return false;
  const c = collapsedCaret(el);
  if (!c) return false;
  const ws = window.getSelection()!;
  const rng = ws.getRangeAt(0);

  const place = (off: number): void => {
    const snapped = markerContentStart(c.text, off);
    setLinearSelection(el, snapped ?? off, snapped ?? off);
  };

  const fromPoint = (
    document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }
  ).caretRangeFromPoint?.bind(document);
  if (typeof fromPoint === 'function' && typeof rng.getClientRects === 'function') {
    let rect: { left: number; top: number; bottom: number; height: number } | null = rng.getClientRects()[0] ?? null;
    if (!rect || !rect.height) {
      // 빈 줄(<br>) 캐럿은 rect가 없다 — 앵커 요소(내용 스팬)의 좌상단으로 대신한다.
      const host = rng.startContainer.nodeType === 3 ? rng.startContainer.parentElement : (rng.startContainer as Element | null);
      const hr = host?.getBoundingClientRect?.();
      if (hr && hr.height) rect = hr;
    }
    if (rect) {
      const lh = rect.height || 18;
      const target = fromPoint(rect.left, dir < 0 ? rect.top - lh / 2 : rect.bottom + lh / 2);
      if (target && el.contains(target.startContainer)) {
        const lin = linearize(el, [{ container: target.startContainer, offset: target.startOffset }]);
        const v = liveEditValue(el);
        place(v.clamp(lin.pos[0] ?? 0));
        return true;
      }
      // 편집 박스 밖 — 첫 줄 위는 내용 시작으로, 끝 줄 아래는 텍스트 끝으로.
      place(dir < 0 ? 0 : c.text.length);
      return true;
    }
  }

  // 텍스트 모델 폴백 — 내용 시작 기준 열 보존(마커 폭 차이를 흡수).
  const lines = c.text.split('\n');
  let idx = 0;
  let start = 0;
  while (idx < lines.length - 1 && start + lines[idx]!.length < c.off) {
    start += lines[idx]!.length + 1;
    idx++;
  }
  const ti = idx + dir;
  if (ti < 0 || ti >= lines.length) {
    place(dir < 0 ? 0 : c.text.length);
    return true;
  }
  const col = Math.max(0, c.off - (start + (parseListPrefix(lines[idx]!)?.raw.length ?? 0)));
  let tStart = 0;
  for (let i = 0; i < ti; i++) tStart += lines[i]!.length + 1;
  const tContent = tStart + (parseListPrefix(lines[ti]!)?.raw.length ?? 0);
  place(Math.min(tContent + col, tStart + lines[ti]!.length));
  return true;
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
  // 방금 센 글자가 줄바꿈이었나 — 블록(`<div>`)이 만드는 **암묵적 줄바꿈**을
  // `linearize`/`domToRuns`와 **같은 규칙**으로 세기 위한 상태다. 두 곳은 앞이 이미
  // 줄바꿈이면 더 넣지 않는데 여기만 무조건 1을 더해, 빈 줄(`<div><br></div>`)이
  // 하나 있을 때마다 오프셋이 1씩 밀렸다(제보: 빈 줄 뒤에 새 리스트를 만들면 캐럿이
  // 마커 **안**에 떨어져 다음 글자가 마커를 부쉈다). 시작은 `true` — 맨 앞 블록은
  // 줄바꿈을 만들지 않는다.
  let lastNl = true;
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
      if (len) lastNl = (node.nodeValue || '').slice(-1) === '\n';
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
      lastNl = true;
      if (parent) {
        lastC = parent;
        lastO = idx;
      }
      return;
    }
    const isBlock = (node.nodeName === 'DIV' || node.nodeName === 'P') && node !== el;
    if (isBlock && acc > 0 && !lastNl) {
      acc += 1;
      lastNl = true;
    }
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

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
import { mentionInitial, mentionTone } from './mentionChip';

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

/**
 * 칩을 **한 덩어리**로 만드는 속성(제보: 날짜 칩을 Backspace로 지우면 글자가 하나씩
 * 지워진다 · 캐럿이 달력 아이콘 뒤에 선다).
 *
 * 칩은 글이 아니라 **하나의 값**이다 — "9월 27일 일"에서 `일`만 지운 상태는 뜻이
 * 없고, 그 상태의 런은 여전히 `dt`를 달고 있어 화면에는 멀쩡한 칩으로 남는다(값과
 * 보이는 것이 어긋난다). `contenteditable="false"`면 브라우저가 이 스팬을 **원자**로
 * 다루므로 캐럿이 안으로 들어가지 못하고, 지우면 통째로 사라진다.
 *
 * 글자는 DOM에 그대로 있으므로 `domToRuns`·`linearize`가 읽는 값은 달라지지 않는다
 * (아바타·달력 글리프를 `::before`로 그리는 것과 같은 이유 — 값을 건드리지 않는 곳에
 * 모양을 둔다).
 *
 * 브라우저마다 원자 요소의 경계 처리가 조금씩 다르므로 **지우는 일 자체는 JS가
 * 못박는다**(`NoteLine`의 `chipAtCaret`) — 이 속성은 캐럿이 안으로 못 들어가게 하는
 * 몫이고, 그 핸들러가 "앞/뒤의 칩을 통째로"를 보장한다.
 */
const CHIP_ATOMIC = ' contenteditable="false"';

/** 요일 글자 — 자리가 곧 `Date#getDay()`의 값이다(0=일 … 6=토). */
const DOW_CHARS = '일월화수목금토';

/** `YYYY-MM-DD` → 요일(0=일 … 6=토). 읽을 수 없으면 `-1`. */
function dowOfIso(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return -1;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
}

/**
 * 날짜 칩 라벨의 **요일 글자가 시작하는 자리** — 없으면 `-1`.
 *
 * 조건이 둘인 이유가 있다. ① 앞에 **공백**이 있어야 한다: `9월 27일`의 끝 글자도
 * `일`이라 그것만 보면 **날(日)을 요일로 읽는다**(테스트가 이 자리를 잡았다).
 * ② 그 글자가 **정말 그 날의 요일**이어야 한다: 라벨은 사람이 고칠 수 있는 글이고,
 * `dt`가 정본이다. 둘 다 맞을 때만 가른다 — 아니면 통째로 둔다(색이 안 붙을 뿐이다).
 */
function dowCut(t: string, iso: string): number {
  const dow = dowOfIso(iso);
  if (dow < 0 || t.length < 2) return -1;
  return /\s/.test(t.slice(-2, -1)) && t.slice(-1) === DOW_CHARS[dow] ? t.length - 1 : -1;
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
      let inner = st ? `<span style="${st}">${conv(r.t)}</span>` : conv(r.t);
      // 아래 셋은 공책의 서식(`RichRun.u`/`k`/`hl`). **요소로 감싼다** — 인라인
      // 스타일로 심으면 `domToRuns`가 되읽을 때 링크의 밑줄·코드의 배경과 뒤섞여
      // 무엇이 서식이고 무엇이 표시용인지 갈리지 않는다(링크·멘션과 같은 판단).
      if (r.hl) inner = `<span class="mf-hl" data-hl="${escHtml(r.hl)}">${inner}</span>`;
      if (r.k) inner = `<code>${inner}</code>`;
      if (r.u) inner = `<u>${inner}</u>`;
      // 링크는 `data-href`를 가진 span으로 — 편집 박스(contentEditable) 안에서는
      // 실제 `<a href>`가 브라우저 기본 동작(드래그로 링크 끌기 등)을 끌어들이고,
      // 무엇보다 저장된 주소를 그대로 DOM 속성에 싣지 않아도 왕복이 된다.
      // 클릭해서 여는 건 커밋된 렌더(`NodeLayer`)가 담당한다.
      // 색은 `.mf-link` 클래스(→ `--mf-link`)가 준다 — 인라인 `color`로 심으면
      // 커밋 때 `domToRuns`가 그걸 런의 `c`로 저장해 링크를 떼도 파란색이 남는다.
      if (r.href) inner = `<span class="${LINK_CLASS}" data-href="${escHtml(r.href)}" style="text-decoration:underline">${inner}</span>`;
      /**
       * 멘션 — 링크와 같은 이유로 클래스+data 속성만(색은 `.mf-mention`이 준다).
       *
       * 머리글자와 색을 **속성으로** 싣는 이유: 공책에서는 이 칩이 아바타 달린
       * 알약으로 보여야 하는데(스펙 4-7), 아바타를 자식 요소로 넣으면 그 글자가
       * `domToRuns`에 읽혀 **값에 섞이고** 캐럿이 그 안에 설 수 있다. 속성에 두면
       * CSS의 `::before`가 그리므로 DOM 글자가 아니다 — 값도 캐럿도 건드리지 않는다.
       */
      else if (r.m)
        inner = `<span class="mf-mention"${CHIP_ATOMIC} data-mention-email="${escHtml(r.m)}" data-mention-ini="${escHtml(mentionInitial(r.t))}" data-mention-tone="${escHtml(mentionTone(r.m))}">${inner}</span>`;
      /**
       * 날짜 칩·페이지 링크 — 멘션과 **같은 규칙**(클래스 + data 속성)이다.
       *
       * 모양(면·테두리·달력 아이콘)은 전부 CSS가 준다. 인라인 style로 심으면
       * `domToRuns`가 그 색·배경을 런의 `c`로 되읽어 **칩을 떼도 색이 남는다** —
       * 링크 파랑에서 실제로 겪은 사고와 같은 계열이다(위 `isLinkInk` 주석).
       */
      else if (r.dt) {
        /**
         * **요일 글자만 따로 감싼다**(요청) — 토·일은 일정 페이지와 같은 색으로.
         *
         * 색은 `data-dow`를 보고 CSS가 준다(`editor.css`). 여기서 인라인 색을 심으면
         * `domToRuns`가 그것을 런의 `c`로 되읽어 **칩을 떼도 색이 남는다**(위 `isLinkInk`).
         * 감싸는 스팬은 **글자를 바꾸지 않으므로** 값(`domToRuns`)도 그대로다.
         *
         * 공휴일은 여기서 알 수 없다 — 그 값은 구글에서 오고, 본문을 그리는 이 함수는
         * 순수하다. 공휴일 색은 팝오버 머리가 맡는다(거기서는 일정과 함께 안다).
         */
        const cut = dowCut(r.t, r.dt);
        const body =
          cut < 0
            ? inner
            : `${st ? `<span style="${st}">${conv(r.t.slice(0, cut))}</span>` : conv(r.t.slice(0, cut))}<span class="mf-datechip-dow">${st ? `<span style="${st}">${conv(r.t.slice(cut))}</span>` : conv(r.t.slice(cut))}</span>`;
        inner = `<span class="mf-datechip"${CHIP_ATOMIC} data-date="${escHtml(r.dt)}" data-dow="${dowOfIso(r.dt)}">${body}</span>`;
      }
      else if (r.pg) inner = `<span class="mf-pagelink"${CHIP_ATOMIC} data-page="${escHtml(r.pg)}">${inner}</span>`;
      /**
       * 본문 댓글의 형광 — **맨 바깥에서** 감싼다(스펙 6-3).
       *
       * 댓글은 링크·코드·칩이 섞인 범위에도 걸 수 있으므로(6-2), 안쪽 요소를
       * 감싸는 자리에 와야 형광이 그 구간 전체에 한 번에 칠해진다. 값은 스레드
       * id뿐이다 — 누가 무엇을 썼는지·해결했는지는 댓글 저장소가 든다.
       */
      if (r.cm) inner = `<span class="mf-cmark" data-cm="${escHtml(r.cm)}">${inner}</span>`;
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
    /** 공책의 서식 셋 — 밑줄·인라인 코드·형광펜 키. */
    u: boolean;
    k: boolean;
    hl: string | null;
    /** 날짜 칩이 가리키는 날(`RichRun.dt`). */
    dt: string | null;
    /** 문서 안 페이지 링크(`RichRun.pg`). */
    pg: string | null;
    cm: string | null;
    /**
     * 이 가지가 **링크의 표시 잔해**인가.
     *
     * 링크 글자를 통째로 지우고 새로 타이핑하면 크롬이 그 자리의 계산된 모양을
     * 굳혀 넣는다 — 실브라우저에서 `<font color="#1a63d8"><u>X</u></font>`로
     * 재현했다(아래 링크색 필터의 주석). 색은 링크 잉크라고 걸러 내는데 **밑줄은
     * 그대로 남아** 사용자가 긋지 않은 밑줄이 저장된다. 링크 잉크를 걸러 낸
     * 가지에서는 밑줄도 함께 잔해로 본다.
     */
    linkInk: boolean;
  }
  const push = (t: string, st: St): void => {
    if (!t) return;
    const last = runs[runs.length - 1];
    if (
      last &&
      !!last.b === st.b &&
      (last.c || null) === (st.c || null) &&
      !!last.i === st.i &&
      !!last.s === st.s &&
      (last.href || null) === (st.href || null) &&
      (last.m || null) === (st.m || null) &&
      !!last.u === st.u &&
      !!last.k === st.k &&
      (last.hl || null) === (st.hl || null) &&
      (last.dt || null) === (st.dt || null) &&
      (last.pg || null) === (st.pg || null) &&
      (last.cm || null) === (st.cm || null)
    )
      last.t += t;
    else {
      const r: RichRun = { t, b: st.b, c: st.c || null };
      if (st.i) r.i = true;
      if (st.s) r.s = true;
      if (st.href) r.href = st.href;
      if (st.m) r.m = st.m;
      if (st.u) r.u = true;
      if (st.k) r.k = true;
      if (st.hl) r.hl = st.hl;
      if (st.dt) r.dt = st.dt;
      if (st.pg) r.pg = st.pg;
      if (st.cm) r.cm = st.cm;
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
    // 공책의 서식 — 우리가 심은 요소, 그리고 붙여넣기로 들어온 같은 뜻의 요소도 받는다.
    if ((tag === 'U' || tag === 'INS') && !next.linkInk) next.u = true;
    if (tag === 'CODE' || tag === 'KBD' || tag === 'SAMP') next.k = true;
    if (tag === 'MARK') next.hl = next.hl || 'yellow';
    const hlAttr = el2.getAttribute('data-hl');
    if (hlAttr) next.hl = hlAttr;
    if (tag === 'FONT' && el2.getAttribute('color')) {
      const attr = el2.getAttribute('color') || '';
      if (isLinkInk(attr)) next.linkInk = true;
      else next.c = attr;
    }
    // 링크: 우리가 심은 `data-href`, 그리고 붙여넣기로 들어온 진짜 `<a href>`도 받는다.
    const linkAttr = el2.getAttribute('data-href') || (tag === 'A' ? el2.getAttribute('href') : null);
    if (linkAttr) next.href = normalizeUrl(linkAttr);
    const mentionAttr = el2.getAttribute('data-mention-email');
    if (mentionAttr) next.m = mentionAttr;
    // 날짜 칩·페이지 링크 — 우리가 심은 표식만 받는다(붙여넣기로 들어온 남의
    // 마크업에는 이 속성이 없으므로 평문으로 내려앉는다. 그 편이 안전하다).
    const dateAttr = el2.getAttribute('data-date');
    if (dateAttr) next.dt = dateAttr;
    const pageAttr = el2.getAttribute('data-page');
    if (pageAttr) next.pg = pageAttr;
    // 본문 댓글의 형광 — 우리가 심은 표식만.
    const cmAttr = el2.getAttribute('data-cm');
    if (cmAttr) next.cm = cmAttr;
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
        if (hex && isLinkInk(hex)) next.linkInk = true;
        else if (hex) next.c = hex;
      }
      const fs = el2.style.fontStyle;
      if (fs === 'italic' || fs === 'oblique') next.i = true;
      else if (fs === 'normal') next.i = false;
      // textDecoration은 shorthand라 브라우저마다 'line-through'/'line-through solid …'로
      // 읽힌다 — 포함 여부로 본다. 'none'은 해제.
      const td = el2.style.textDecoration || el2.style.textDecorationLine || '';
      if (/line-through/.test(td)) next.s = true;
      else if (td === 'none') next.s = false;
      // 밑줄도 shorthand에 섞여 온다. 다만 **링크 안에서는 무시한다** — 링크는
      // 표시용으로 밑줄을 그으므로(`runsToHtml`), 그걸 읽으면 링크를 뗀 뒤에도
      // 밑줄이 남는다(링크 파랑을 걸러 내는 것과 같은 함정).
      if (!next.href && !next.linkInk) {
        if (/underline/.test(td)) next.u = true;
        else if (td === 'none') next.u = false;
      }
    }
    const isBlock = tag === 'DIV' || tag === 'P';
    if (isBlock && runs.length && runs[runs.length - 1]!.t.slice(-1) !== '\n') push('\n', st);
    el2.childNodes.forEach((child) => walk(child, next));
  };
  el.childNodes.forEach((child) => walk(child, { b: false, c: null, i: false, s: false, href: null, m: null, u: false, k: false, hl: null, dt: null, pg: null, cm: null, linkInk: false }));
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

/**
 * **빈 편집 박스의 채움 `<br>`** — 글자로 세지 않는다(제보: 빈 줄에서 ↓가 먹지 않는다).
 *
 * 글을 다 지우면 크로뮴이 줄을 보이게 하려고 `<br>` 하나를 남긴다(bogus BR — 우리가
 * 그린 것이 아니다). 그것을 `\n` 한 글자로 세면 **빈 줄인데 길이가 1**이 되어
 * "글 끝인가"가 영영 거짓이 된다: `caretOnEdgeLine`의 `at >= lineLength(el)`가
 * `0 >= 1`로 읽혀 ↓가 다음 줄로 넘어가지 못했다(↑는 `at <= 0`이라 멀쩡해서, 같은 줄에서
 * 위로는 가는데 아래로는 못 가는 이상한 모양이었다 — 실브라우저로 재현했다).
 *
 * **혼자 있을 때만** 채움으로 본다 — 글 뒤의 `<br>`은 진짜 줄바꿈이다(`가<br>`).
 * 값이 정확히 `"\n"` 하나인 줄은 이 규칙에서 빈 줄로 접히는데, 화면으로는 어차피
 * 같은 빈 줄이라 잃는 것이 없다.
 */
export function fillerBr(el: HTMLElement): Node | null {
  return el.childNodes.length === 1 && el.firstChild?.nodeName === 'BR' ? el.firstChild : null;
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
  const skip = fillerBr(el);
  const walk = (node: Node): void => {
    if (node === skip) return;
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

/**
 * `linearize`의 **역**: 값 좌표 몇 개를 그 자리의 (노드, 오프셋)으로 되돌린다.
 *
 * `setLinearSelection`에서 갈라 낸 것이다 — 값 좌표를 DOM 자리로 푸는 곳이 둘이
 * 되면(선택 복원과 칠하기) 규칙이 언젠가 갈라지고, 그 어긋남이 곧 "고른 자리와
 * 서식이 걸린 자리가 다르다"는 제보가 된다. `<br>`을 한 글자로 세는 것도,
 * 블록이 만드는 암묵적 줄바꿈도, 마커 스팬의 끝 경계를 내용 쪽에 양보하는 것도
 * 전부 `linearize`·`domToRuns`와 같은 규칙이라야 한다.
 */
export function linearPoints(el: HTMLElement, positions: number[]): { node: Node; offset: number }[] {
  const out = new Array<{ node: Node; offset: number } | null>(positions.length).fill(null);
  const skip = fillerBr(el);
  let acc = 0;
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
  const done = (): boolean => out.every((x) => x !== null);
  const walk = (node: Node): void => {
    if (done()) return;
    if (node.nodeType === 3) {
      const len = (node.nodeValue || '').length;
      // 리스트 마커 스팬의 **끝 경계**는 내용 쪽에 양보한다. 마커 스팬은
      // `white-space: pre`(flex-shrink 0)라 그 안에 들어간 글자는 줄바꿈되지 않아
      // 도형을 뚫고 나간다(제보) — Shift+Enter·Tab 직후 캐럿이 정확히 이 경계에
      // 오므로, 여기서 양보하지 않으면 이어지는 타이핑이 전부 마커 안에 쌓인다.
      const inMarker = !!(node.parentElement && node.parentElement.hasAttribute('data-list-marker'));
      const claim = (pos: number): boolean => pos < acc + len || (pos === acc + len && !inMarker);
      positions.forEach((pos, i) => {
        if (!out[i] && claim(pos)) out[i] = { node, offset: Math.max(0, pos - acc) };
      });
      acc += len;
      if (len) lastNl = (node.nodeValue || '').slice(-1) === '\n';
      lastC = node;
      lastO = len;
      return;
    }
    if (node.nodeType !== 1) return;
    if (node === skip) {
      // 채움 `<br>`은 글자가 아니지만 **캐럿이 설 자리**이긴 하다 — 빈 줄의 0번
      // 자리를 그 앞(부모 + 인덱스)으로 돌려준다(`linearize`와 같은 셈).
      const parent = node.parentNode;
      const idx = parent ? Array.prototype.indexOf.call(parent.childNodes, node) : 0;
      positions.forEach((pos, i) => {
        if (!out[i] && pos <= acc && parent) out[i] = { node: parent, offset: idx };
      });
      if (parent) {
        lastC = parent;
        lastO = idx;
      }
      return;
    }
    if (node.nodeName === 'BR') {
      // 빈 줄은 텍스트 노드가 없고 `<br>`만 있다 — 그 자리를 캐럿 위치로 인정한다
      // (부모 + 자식 인덱스). 이게 없으면 빈 줄로 가는 오프셋이 영영 안 풀린다.
      const parent = node.parentNode;
      const idx = parent ? Array.prototype.indexOf.call(parent.childNodes, node) : 0;
      positions.forEach((pos, i) => {
        if (!out[i] && pos <= acc && parent) out[i] = { node: parent, offset: idx };
      });
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
      if (done()) return;
    }
  };
  walk(el);
  return out.map((x) => x ?? (lastC ? { node: lastC, offset: lastO } : { node: el, offset: 0 }));
}

/** Port of `Component#setLinearSelection` (MindFlow.dc.html:2677-2698): the inverse of
 * `linearize` — re-applies a `[s0, s1)` plain-text offset range as the live DOM Selection,
 * used after `applyPartial` rewrites the editor's innerHTML (which otherwise drops the
 * user's selection) to restore it so a follow-up style click still targets the same run. */
export function setLinearSelection(el: HTMLElement, s0: number, s1: number): void {
  const [a, b] = linearPoints(el, [s0, s1]);
  try {
    const ws = window.getSelection();
    if (!ws || !a || !b) return;
    const r = document.createRange();
    r.setStart(a.node, a.offset);
    r.setEnd(b.node, b.offset);
    ws.removeAllRanges();
    ws.addRange(r);
    // **스크롤은 옮기지 않는다** — 선택을 되돌리는 일이지 화면을 움직이는 일이 아니다.
    // 긴 페이지에서 서식을 걸 때마다 본문이 튀던 자리다(제보 계열).
    el.focus({ preventScroll: true });
  } catch {
    /* a stale/detached range (element unmounted mid-operation) — nothing to restore */
  }
}

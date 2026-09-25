// 런·줄을 **다른 앱이 읽는 HTML**로 — 클립보드의 `text/html` 한 벌.
//
// ## 왜 `runsToHtml`을 쓰지 않나
//
// `richtextDom.ts`의 `runsToHtml`은 **우리 편집 박스가 읽는** HTML이다. 링크를
// `<span class="mf-link" data-href>`로, 형광펜을 `<span class="mf-hl" data-hl>`로
// 그리고 색은 시트(`editor.css`)가 준다 — 그래야 커밋 때 `domToRuns`가 표시용 색을
// 모델 값으로 잘못 읽지 않는다. 그런데 **클래스는 클립보드를 따라가지 않는다**:
// 워드·노션·메일에 붙이면 링크는 검은 글자가 되고 형광펜은 사라진다(제보 12).
//
// 그래서 나가는 길은 규칙이 반대다 — **의미 태그와 인라인 style만** 쓴다. 들어오는
// 길(`domToRuns`)이 `<a href>`·`<strong>`·`<mark>`를 이미 읽으므로 왕복도 선다.
//
// DOM을 쓰지 않는다(코어 순수성 lint) — 문자열만 짓는다.
//
// **주의**: 여기서 마커(`•`/`1.`)는 **값이 아니라 목록 구조**다. 맵·화이트보드의 복사
// (`selectedRawText`)는 마커를 **값에서 잘라** 싣는 다른 규칙이므로 두 규칙을 섞지 않는다.

import type { RichRun } from './model';
import { noteHighlightColor } from './note';
import { normalizeUrl } from './url';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 속성값 — `escHtml`과 달리 **따옴표까지** 막는다(속성 안으로 나가는 값이다). */
function attr(s: string): string {
  return esc(s).replace(/"/g, '&quot;');
}

/**
 * 런들 → 인라인 HTML. `pre`면 줄바꿈을 `<br>`로 바꾸지 않는다(`<pre>` 안에서는
 * 그 자체가 줄바꿈이라 `<br>`을 넣으면 두 줄이 된다).
 */
export function runsToClipHtml(runs: RichRun[] | null | undefined, text = '', pre = false): string {
  const rs: RichRun[] = runs && runs.length ? runs : [{ t: text, b: false, c: null }];
  return rs
    .map((r) => {
      let out = esc(r.t);
      if (!out) return '';
      if (!pre) out = out.replace(/\n/g, '<br>');
      if (r.k) out = `<code style="font-family:ui-monospace,SFMono-Regular,monospace">${out}</code>`;
      const hl = r.hl ? noteHighlightColor(r.hl) : null;
      if (hl) out = `<span style="background-color:${attr(hl)}">${out}</span>`;
      if (r.c) out = `<span style="color:${attr(r.c)}">${out}</span>`;
      if (r.b) out = `<strong>${out}</strong>`;
      if (r.i) out = `<em>${out}</em>`;
      if (r.s) out = `<s>${out}</s>`;
      if (r.u) out = `<u>${out}</u>`;
      // 멘션·날짜 칩·페이지 링크는 **우리 안에서만 뜻이 있는 표식**이라 글자로
      // 내보낸다(`@김서연` · `8월 27일 목`). 밖으로 나가는 클립보드에 `geurio://`
      // 같은 주소를 실으면 붙여넣은 쪽에서 열 수 없는 죽은 링크가 된다.
      const href = r.href ? normalizeUrl(r.href) : null;
      if (href) out = `<a href="${attr(href)}">${out}</a>`;
      return out;
    })
    .join('');
}

/** 클립보드로 나가는 한 줄 — 어떤 블록의 몇 번째 단계인지까지 든다. */
export interface ClipLine {
  /** 블록 종류(`p`·`h1`~`h3`·`ul`·`ol`·`ck`·`quote`·`code`·`callout`·`toggle`·`cell`). */
  kind: string;
  runs: RichRun[] | null;
  text: string;
  /** 목록의 들여쓴 단계(0부터). */
  depth?: number;
  /** 체크리스트의 체크 여부. */
  done?: boolean;
  /** 번호 목록의 시작 번호 — 0단계의 첫 줄에서만 뜻이 있다. */
  num?: number;
}

const LIST_KINDS = new Set(['ul', 'ol', 'ck']);

function tagOf(kind: string): string {
  if (kind === 'h1' || kind === 'h2' || kind === 'h3') return kind;
  if (kind === 'quote') return 'blockquote';
  return 'p';
}

/**
 * 줄들 → **한 덩이 HTML**. 목록은 `<ul>`/`<ol>`로 묶고 단계는 중첩으로 그린다
 * (다른 앱이 "목록"으로 읽는 유일한 모양이다 — `- ` 글자로는 그냥 문장이 된다).
 */
export function clipLinesToHtml(lines: ClipLine[]): string {
  const out: string[] = [];
  /** 지금 열려 있는 목록들 — `[태그, 단계]`. */
  const open: { tag: string; depth: number }[] = [];
  const close = (to: number): void => {
    while (open.length > to) out.push(`</${open.pop()!.tag}>`);
  };
  for (const ln of lines) {
    if (LIST_KINDS.has(ln.kind)) {
      const tag = ln.kind === 'ol' ? 'ol' : 'ul';
      const depth = Math.max(0, ln.depth ?? 0);
      // 종류가 바뀌면 같은 단계라도 다시 연다(글머리 → 번호).
      while (open.length && (open.length - 1 > depth || (open.length - 1 === depth && open[open.length - 1]!.tag !== tag))) {
        out.push(`</${open.pop()!.tag}>`);
      }
      while (open.length <= depth) {
        const start = open.length === depth && ln.num && ln.num > 1 ? ` start="${ln.num}"` : '';
        out.push(`<${tag}${tag === 'ol' ? start : ''}>`);
        open.push({ tag, depth: open.length });
      }
      const body = runsToClipHtml(ln.runs, ln.text);
      // 체크리스트는 `<li>` 앞에 상자 글자를 둔다 — HTML 목록에 체크 상태가 없다.
      out.push(`<li>${ln.kind === 'ck' ? (ln.done ? '☑ ' : '☐ ') : ''}${body}</li>`);
      continue;
    }
    close(0);
    if (ln.kind === 'code') {
      out.push(`<pre style="font-family:ui-monospace,SFMono-Regular,monospace"><code>${runsToClipHtml(ln.runs, ln.text, true)}</code></pre>`);
      continue;
    }
    const tag = tagOf(ln.kind);
    out.push(`<${tag}>${runsToClipHtml(ln.runs, ln.text) || '<br>'}</${tag}>`);
  }
  close(0);
  return out.join('');
}

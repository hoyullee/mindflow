// 일정 **메모의 서식**(요청: 구글 캘린더와 같은 편집 — 굵게·기울임·밑줄·번호 매기기·
// 글머리 기호·링크·서식 제거).
//
// **저장은 HTML이다.** 구글 캘린더의 `description`이 원래 HTML이고, 우리 표(0033)의
// `description`도 그냥 문자열이라 같은 값을 담는다 — 우리만의 서식 모델을 새로 두면
// 구글에 보낼 때 다시 HTML로 옮겨야 하고, 그 변환이 곧 드리프트가 된다(캔버스의
// `RichRun`은 좌표·측정과 얽혀 있어 여기 쓸 수 없다).
//
// 그래서 **위생 처리가 필수**다: 남이 만든 일정의 메모가 그대로 우리 화면에
// 들어오므로(초대받은 일정) 태그·속성을 허용 목록으로 좁히고, 링크 주소는 코어의
// `normalizeUrl`(http/https/mailto만)을 지난다 — `javascript:`류는 **값에 들어가지도
// 못한다**(렌더에서 거르면 다른 경로로 샌다는 것이 하이퍼링크 작업의 교훈).

import { normalizeUrl } from '@mindflow/mindmap-core';

/** 남길 태그 — 구글 캘린더가 실제로 쓰는 것들(+ 문단·줄바꿈). */
const ALLOWED = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'A', 'UL', 'OL', 'LI', 'BR', 'P', 'DIV', 'SPAN']);

/** 태그가 하나라도 있으면 HTML로 본다 — 옛 값(평문)은 그대로 평문이다. */
export function looksLikeHtml(s: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(s);
}

/** 평문 메모 → 편집기에 넣을 HTML(줄바꿈만 옮긴다). */
export function textToMemoHtml(text: string): string {
  return escapeHtml(text).replace(/\n/g, '<br>');
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * 저장된 값 → 편집기·표시에 쓸 **안전한 HTML**. 평문이면 줄바꿈만 옮긴다.
 */
export function memoHtml(value: string): string {
  if (!value) return '';
  return looksLikeHtml(value) ? sanitizeMemoHtml(value) : textToMemoHtml(value);
}

/**
 * 편집기가 만든/남이 보낸 HTML을 **허용 목록으로 좁힌다**.
 *
 * `DOMParser`가 없는 환경(서버·일부 테스트)에서는 태그를 통째로 지운 평문으로
 * 물러선다 — 위생 처리를 건너뛰고 그대로 두는 것보다 안전하다.
 */
export function sanitizeMemoHtml(html: string): string {
  if (typeof DOMParser === 'undefined') return escapeHtml(stripTags(html));
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  clean(doc.body);
  return doc.body.innerHTML;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, '');
}

function clean(root: Element): void {
  for (const el of Array.from(root.querySelectorAll('*'))) {
    if (!ALLOWED.has(el.tagName)) {
      // 태그만 벗기고 **글자는 남긴다** — 남의 메모에서 문장이 통째로 사라지지 않게.
      el.replaceWith(...Array.from(el.childNodes));
      continue;
    }
    // 주소는 속성을 지우기 **전에** 읽는다.
    const href = el.tagName === 'A' ? normalizeUrl(el.getAttribute('href') ?? '') : null;
    for (const attr of Array.from(el.attributes)) el.removeAttribute(attr.name);
    if (el.tagName !== 'A') continue;
    if (!href) {
      // 열 수 없는 주소(`javascript:` 등)면 링크를 벗기고 글자만 남긴다.
      el.replaceWith(...Array.from(el.childNodes));
      continue;
    }
    el.setAttribute('href', href);
    // 새 탭 + 참조 차단 — 남의 메모에 걸린 링크가 우리 창을 조종하지 못하게.
    el.setAttribute('target', '_blank');
    el.setAttribute('rel', 'noopener noreferrer');
  }
}

/** 표시·검색용 평문 — 목록·미리보기가 태그를 그대로 보여 주지 않게. */
export function memoPlainText(value: string): string {
  if (!value) return '';
  if (!looksLikeHtml(value)) return value;
  if (typeof DOMParser === 'undefined') return stripTags(value);
  const doc = new DOMParser().parseFromString(`<body>${value}</body>`, 'text/html');
  for (const br of Array.from(doc.body.querySelectorAll('br, li, p, div'))) br.before('\n');
  return (doc.body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
}

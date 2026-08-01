// 하이퍼링크 주소 정규화 — 순수 문자열 로직(DOM·네트워크 없음).
//
// 링크는 사용자가 **자유 입력**하는 값이라 저장 전에 반드시 여기를 통과시킨다.
// 스킴을 허용 목록으로 좁히는 것이 핵심 — `javascript:`/`data:`/`vbscript:`는
// 렌더러가 `<a href>`로 그리는 순간 클릭 한 번에 스크립트가 되므로 **저장 자체를
// 막는다**(렌더 시점에 거르는 것보다 안전하다: 저장된 문서는 협업·내보내기·
// 썸네일 등 여러 경로로 다시 읽힌다).

/** 링크로 허용하는 스킴 — 웹 주소와 메일뿐. */
const ALLOWED = ['http:', 'https:', 'mailto:'];

/** 스킴처럼 보이는 접두(`foo:`) — 있으면 그 스킴을 검사하고, 없으면 `https://`를 붙인다. */
const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/**
 * 사용자가 입력한 주소를 저장 가능한 형태로 — 못 쓰는 주소면 `null`.
 *
 * - 앞뒤 공백 제거, 빈 문자열은 `null`
 * - 스킴이 없으면 `https://`를 붙인다(`example.com` → `https://example.com`)
 * - `www.`처럼 스킴 없이 시작해도 같은 규칙
 * - `mailto:` 는 그대로, `a@b.com` 처럼 보이면 `mailto:`를 붙인다
 * - 허용 목록 밖 스킴(`javascript:` 등)과 파싱 실패는 `null`
 */
export function normalizeUrl(input: string): string | null {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  // 제어문자·공백이 섞인 입력은 거른다 — `java\nscript:`류 우회 차단.
  // (정규식에 제어문자를 직접 쓰면 `no-control-regex`에 걸려 코드포인트로 본다.)
  for (const ch of raw) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 0x20 || cp === 0x7f || /\s/.test(ch)) return null;
  }

  let candidate = raw;
  if (!SCHEME_RE.test(raw)) {
    candidate = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) ? `mailto:${raw}` : `https://${raw}`;
  }
  try {
    const u = new URL(candidate);
    if (!ALLOWED.includes(u.protocol)) return null;
    // http(s)는 호스트가 있어야 한다(`https://` 만 친 경우 등을 거른다).
    if (u.protocol !== 'mailto:' && !u.hostname) return null;
    return u.href;
  } catch {
    return null;
  }
}

/** 화면에 짧게 보여 줄 주소 — 스킴과 끝 슬래시를 떼고 길면 말줄임. */
export function displayUrl(href: string, max = 42): string {
  const short = String(href || '')
    .replace(/^https?:\/\//, '')
    .replace(/^mailto:/, '')
    .replace(/\/$/, '');
  return short.length > max ? `${short.slice(0, max - 1)}…` : short;
}

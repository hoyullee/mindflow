/**
 * 설치형 앱의 Jira 연결 — 동의는 **시스템 브라우저**에서 끝나고, 인가 코드는 딥링크로 앱에 돌아온다
 * (구글 캘린더 `desktopGoogleCalendar.ts`와 같은 길).
 *
 * 1. 앱이 `authorize { desktop: true }`를 부르면 서버가 `state`를 `d.<ts>.<sig>`로 서명해 준다.
 * 2. 브라우저의 `/auth/jira`는 그 표시를 보고 **교환하지 않고** `geurio://jira?code=…&state=…`로 앱을 깨운다
 *    (브라우저가 로그인돼 있을 필요가 없다 — 교환은 앱의 세션으로 한다).
 * 3. 앱은 **자기가 시작한 연결의 `state`와 같을 때만** 받는다 — 딥링크는 아무나 쏠 수 있다.
 */

const SCHEME = 'geurio';
const TARGET = 'jira';

/** 설치형 앱에서 시작한 연결의 `state`인가(서버가 붙인 표시 — 정당성은 서버가 서명으로 판단한다). */
export const isDesktopState = (state: string | null | undefined): boolean => !!state && state.startsWith('d.');

export function buildJiraDeepLink(code: string, state: string): string {
  return `${SCHEME}://${TARGET}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
}

/** 딥링크에서 코드를 읽는다 — 우리 모양이 아니면 null(로그인·구글 캘린더 딥링크와 같은 창구로 온다). */
export function readJiraDeepLink(raw: string): { code: string; state: string } | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== `${SCHEME}:`) return null;
  const target = (u.host || u.pathname.replace(/^\/*/, '')).replace(/\/+$/, '');
  if (target !== TARGET) return null;
  const code = u.searchParams.get('code') ?? '';
  const state = u.searchParams.get('state') ?? '';
  return code && state ? { code, state } : null;
}

/** 동의 주소에서 서버가 넣은 `state`를 꺼낸다 — 돌아온 딥링크와 대조할 값. */
export function stateOfAuthUrl(url: string): string | null {
  try {
    return new URL(url).searchParams.get('state');
  } catch {
    return null;
  }
}

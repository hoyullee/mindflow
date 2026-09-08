// 설치형 데스크톱 앱(Electron 셸)의 Google 로그인.
//
// **왜 앱 창 안에서 하지 않는가**: Google은 임베드된 웹뷰의 OAuth를 막는다
// (`disallowed_useragent`) — Electron도 그 대상이다. 그래서 RFC 8252(네이티브
// 앱의 OAuth) 관례대로 **시스템 브라우저**에서 동의를 받고, 커스텀 프로토콜
// (`geurio://`)로 앱에 돌려준다. 사용자 에이전트를 위장해 앱 안에서 여는 길도
// 있지만 그건 정책 위반이고, 우리 앱은 이미 검수를 통과한 상태라 건드리지 않는다.
//
// **스코프·브랜딩·게시 상태를 하나도 바꾸지 않는다** — 여기서 여는 주소는
// Supabase가 만든 그 OAuth 시작 주소이고, Google 콘솔에 등록된 리다이렉트
// 대상도 그대로 Supabase의 콜백이다. 새로 추가되는 것은 **Supabase의 리다이렉트
// 허용 목록**에 우리 핸드오프 주소 한 줄뿐이다(server/supabase/docs/backend.md §20).
//
// 흐름:
//   1. 앱: `signInWithOAuth`의 시작 주소를 받되 이동하지 않고(`skipBrowserRedirect`)
//      `redirectTo`를 핸드오프 페이지로 둔다 → 시스템 브라우저에서 연다.
//   2. 브라우저: 동의 → Supabase 콜백 → `/auth/desktop`에 세션이 선다.
//   3. 브라우저: 그 세션의 갱신 토큰을 `geurio://auth?refresh_token=…`로 넘기고
//      **자기 사본은 지운다**(같은 세션이 두 곳에 남지 않게).
//   4. 앱: 딥링크를 받아 갱신 토큰으로 세션을 세운다. Supabase의 갱신 토큰은
//      한 번 쓰면 회전하므로, 주소에 실려 지나간 그 값은 그 순간 무효가 된다.

/** 브라우저가 로그인을 끝낸 뒤 들르는 페이지(공개 라우트). */
export const DESKTOP_HANDOFF_PATH = '/auth/desktop';

/** 셸이 등록한 커스텀 프로토콜(apps/desktop/src/shell.ts의 `DEEP_LINK_SCHEME`). */
const SCHEME = 'geurio';
const AUTH_TARGET = 'auth';

/** 브라우저에서 로그인을 끝낸 뒤 돌아올 주소 — Supabase 리다이렉트 허용 목록에 있어야 한다. */
export function handoffRedirectTo(origin: string): string {
  return `${origin}${DESKTOP_HANDOFF_PATH}`;
}

/** 브라우저 → 앱으로 세션을 넘길 딥링크. */
export function buildAuthDeepLink(refreshToken: string): string {
  return `${SCHEME}://${AUTH_TARGET}?refresh_token=${encodeURIComponent(refreshToken)}`;
}

/**
 * 딥링크에서 갱신 토큰을 읽는다. 우리가 아는 모양이 아니면 `null` — 이 문자열은
 * OS가 넘겨준 것이라 아무나 만들 수 있으므로(다른 앱·웹페이지가 `geurio://`를
 * 쏠 수 있다) 모양을 확인하고, 값의 정당성은 서버가 판단한다(가짜 토큰은 그냥
 * 로그인 실패다).
 */
export function readAuthDeepLink(raw: string): { refreshToken: string } | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== `${SCHEME}:`) return null;
  // `geurio://auth`는 host='auth', `geurio:auth`는 pathname='auth' — OS·브라우저가
  // 스킴 URL을 정규화하는 방식이 갈리므로 둘 다 받는다.
  const target = (u.host || u.pathname.replace(/^\/*/, '')).replace(/\/+$/, '');
  if (target !== AUTH_TARGET) return null;
  const hash = u.hash.startsWith('#') ? u.hash.slice(1) : u.hash;
  const refreshToken = u.searchParams.get('refresh_token') ?? new URLSearchParams(hash).get('refresh_token') ?? '';
  return refreshToken ? { refreshToken } : null;
}

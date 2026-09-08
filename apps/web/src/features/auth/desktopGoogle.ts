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
// 허용 목록**에 우리 핸드오프 주소 한 줄뿐이다(server/supabase/docs/backend.md §21).
//
// **넘기는 것은 세션이 아니라 인가 코드다.** 처음에는 브라우저에 선 세션의 갱신
// 토큰을 넘겼는데 그 길은 성립하지 않았다(제보로 확인):
//   - 우리 Supabase 클라이언트는 **PKCE** 흐름이라 콜백이 `?code=…`로 오고, 그
//     코드는 **`signInWithOAuth`를 부른 클라이언트의 verifier**로만 교환된다.
//     그 verifier는 **앱**에 있으므로 브라우저는 애초에 세션을 세울 수 없다.
//   - 그래서 브라우저가 넘길 수 있는 세션은 그 사람이 **전에 웹에서 로그인해 둔**
//     세션뿐이었고, 뒤이어 부르는 `signOut('local')`이 그 세션을 **서버에서**
//     끊었다(GoTrue의 `local`은 "이 세션만 로그아웃" = 그 갱신 토큰 폐기 —
//     저장소만 비우는 것이 아니다. auth-js가 `POST /logout?scope=local`을 보낸다).
//     앱이 이어받을 토큰이 그 자리에서 무효가 되니 매번 실패했다.
//
// 지금 흐름:
//   1. 앱: `signInWithOAuth`의 시작 주소를 받되 이동하지 않고(`skipBrowserRedirect`)
//      `redirectTo`를 핸드오프 페이지로 둔다 → 시스템 브라우저에서 연다.
//      이때 PKCE verifier가 **앱의 저장소**에 남는다.
//   2. 브라우저: 동의 → Supabase 콜백 → `/auth/desktop?code=…`.
//   3. 브라우저: 그 코드를 `geurio://auth?code=…`로 앱에 넘긴다. **세션을 세우지도,
//      남의 세션을 건드리지도 않는다** — 그래서 지울 사본도 없다.
//   4. 앱: `exchangeCodeForSession(code)` — 자기 verifier로 교환해 세션을 세운다.
//      코드는 한 번만 쓸 수 있어 주소에 실려 지나간 값은 그 자리에서 죽는다.

/** 브라우저가 로그인을 끝낸 뒤 들르는 페이지(공개 라우트). */
export const DESKTOP_HANDOFF_PATH = '/auth/desktop';

/** 셸이 등록한 커스텀 프로토콜(apps/desktop/src/shell.ts의 `DEEP_LINK_SCHEME`). */
const SCHEME = 'geurio';
const AUTH_TARGET = 'auth';

/** 브라우저에서 로그인을 끝낸 뒤 돌아올 주소 — Supabase 리다이렉트 허용 목록에 있어야 한다. */
export function handoffRedirectTo(origin: string): string {
  return `${origin}${DESKTOP_HANDOFF_PATH}`;
}

/** 브라우저 → 앱으로 인가 코드를 넘길 딥링크. */
export function buildAuthDeepLink(code: string): string {
  return `${SCHEME}://${AUTH_TARGET}?code=${encodeURIComponent(code)}`;
}

/**
 * 딥링크에서 인가 코드를 읽는다. 우리가 아는 모양이 아니면 `null` — 이 문자열은
 * OS가 넘겨준 것이라 아무나 만들 수 있으므로(다른 앱·웹페이지가 `geurio://`를
 * 쏠 수 있다) 모양을 확인하고, 값의 정당성은 서버가 판단한다(가짜 코드는 그냥
 * 교환 실패다 — 게다가 우리 verifier와 맞아야 하므로 지어낼 수 없다).
 */
export function readAuthDeepLink(raw: string): { code: string } | null {
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
  const code = u.searchParams.get('code') ?? new URLSearchParams(hash).get('code') ?? '';
  return code ? { code } : null;
}

/* ── 핸드오프 주소의 인가 코드 낚아채기 ──────────────────────────────────────
 * 이 코드는 **앱의** verifier로만 교환되므로 브라우저에서 쓰면 실패한다. 그런데
 * 우리 클라이언트는 `detectSessionInUrl: true`라, 그냥 두면 페이지가 뜨는 길에
 * 스스로 교환을 시도하고 **주소에서 `?code=`를 지워** 버린다(그러면 우리가 읽을
 * 것이 없다). 그래서 클라이언트가 만들어지기 **전에**(`main.tsx`) 값을 낚아채고
 * 주소에서 지운다 — 핸드오프 경로에서만 도므로 평범한 웹 로그인은 그대로다.
 */
let captured: string | null = null;

export function captureDesktopAuthCode(): string | null {
  if (typeof window === 'undefined') return null;
  if (window.location.pathname !== DESKTOP_HANDOFF_PATH) return null;
  const code = new URLSearchParams(window.location.search).get('code');
  if (!code) return null;
  captured = code;
  try {
    window.history.replaceState({}, '', DESKTOP_HANDOFF_PATH);
  } catch {
    // 주소를 정리하지 못했더라도 값은 손에 있다 — 핸드오프는 계속한다.
  }
  return code;
}

/**
 * 낚아챈 인가 코드. 아직 낚아채지 않았으면(엔트리를 거치지 않은 렌더) 그 자리에서
 * 한 번 시도한다. **비우지 않는다** — 페이지가 다시 그려져도 같은 값을 봐야 한다.
 */
export function desktopAuthCode(): string | null {
  return captured ?? captureDesktopAuthCode();
}

/** 테스트 전용 — 모듈에 남은 값을 비운다. */
export function resetDesktopAuthCode(): void {
  captured = null;
}

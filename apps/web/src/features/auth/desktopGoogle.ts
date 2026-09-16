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
// 흐름:
//   1. 앱: `signInWithOAuth`의 시작 주소를 받되 이동하지 않고(`skipBrowserRedirect`)
//      `redirectTo`를 핸드오프 페이지로 둔다 → 시스템 브라우저에서 연다.
//   2. 브라우저: 동의 → Supabase 콜백 → `/auth/desktop#access_token=…&refresh_token=…`
//      (**implicit** 흐름이라 토큰이 **해시**로 온다 — 아래 "두 번 틀린 것" 참고).
//   3. 브라우저: 그 해시에서 갱신 토큰만 읽어 `geurio://auth?refresh_token=…`로 앱에
//      넘기고 주소를 치운다. 브라우저에는 **세션이 서지 않는다** — 이 주소에서는
//      클라이언트가 URL을 아예 보지 않기 때문이다(`isAuthCourierPath` 참고.
//      "낚아채기가 먼저 돌아서"가 아니다 — 그렇게 믿었다가 ③에서 깨졌다).
//   4. 앱: `refreshSession({ refresh_token })`으로 자기 세션을 세운다. 갱신 토큰은
//      쓰는 순간 회전하므로 주소에 실려 지나간 값은 그 자리에서 무효가 된다.
//
// ── 두 번 틀린 것(둘 다 제보로 드러났다) ─────────────────────────────────────
//  ① 첫 판: 브라우저에 선 세션의 갱신 토큰을 넘기고 `signOut('local')`로 사본을
//     지웠다. 그런데 GoTrue의 `local`은 "이 세션만 로그아웃"이라 auth-js가
//     `POST /logout?scope=local`을 보내 **그 세션을 서버에서 끊는다** — 저장소만
//     비우는 것이 아니다. 앱이 이어받을 토큰이 그 자리에서 폐기돼 매번
//     `인증 코드가 올바르지 않거나 만료되었어요`로 끝났다.
//  ② 둘째 판: 원인을 PKCE로 잘못 짚어 `?code=`를 넘기게 바꿨다. 그런데
//     `@supabase/auth-js`의 **기본 `flowType`은 `implicit`**이고 우리는 그 값을
//     지정하지 않는다 — 콜백에 `code`는 애초에 오지 않고 토큰이 해시로 온다.
//     그래서 핸드오프가 넘길 것을 못 찾아 `로그인 정보를 받지 못했어요`가 됐다.
//     (그 값은 이제 `supabaseClient.ts`에 **명시**해 둔다 — 이 경로가 그 가정에
//     기대므로, 라이브러리 기본값이 뒤집히면 조용히 깨진다.)
//  ③ 셋째 판: 세션이 브라우저에 서지 않는 근거를 **순서**에 뒀다("클라이언트가
//     만들어지기 전에 낚아챈다"). 그 순서는 성립하지 않았고, 크롬에 A로 로그인해
//     둔 사람이 앱에서 B로 로그인하자 **크롬까지 B가 됐다**(제보). 근거를 순서가
//     아니라 **성질**로 옮겼다 — `isAuthCourierPath`의 주석이 전말이다.
//  교훈: 남의 라이브러리 동작은 **소스에서 확인하고** 그 사실을 코드에 못박는다.
//  그리고 **경주로 얻은 안전은 안전이 아니다** — 순서가 바뀌면 조용히 되돌아온다.

import { GCAL_HANDOFF_PATH } from '../home/calendar/desktopGoogleCalendar';

/** 브라우저가 로그인을 끝낸 뒤 들르는 페이지(공개 라우트). */
export const DESKTOP_HANDOFF_PATH = '/auth/desktop';

/** 셸이 등록한 커스텀 프로토콜(apps/desktop/src/shell.ts의 `DEEP_LINK_SCHEME`). */
const SCHEME = 'geurio';
const AUTH_TARGET = 'auth';

/** 브라우저에서 로그인을 끝낸 뒤 돌아올 주소 — Supabase 리다이렉트 허용 목록에 있어야 한다. */
export function handoffRedirectTo(origin: string): string {
  return `${origin}${DESKTOP_HANDOFF_PATH}`;
}

/** 브라우저 → 앱으로 갱신 토큰을 넘길 딥링크. */
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
  const token = u.searchParams.get('refresh_token') ?? new URLSearchParams(hash).get('refresh_token') ?? '';
  return token ? { refreshToken: token } : null;
}

/**
 * 이 주소는 **심부름꾼 페이지**인가 — 브라우저가 받은 값을 앱에 넘기기만 하는 자리.
 *
 * 이 판단이 하는 일은 하나다: 그 주소에서 만들어지는 Supabase 클라이언트는
 * **URL에서 세션을 줍지 않는다**(`detectSessionInUrl: false` — supabaseClient.ts).
 *
 * ## 왜 필요한가 (제보로 드러난 계정 뒤섞임)
 *
 * 제보: 크롬에 **A로 로그인**해 둔 채 설치형 앱에서 **B로 로그인**했더니, **크롬도
 * B가 되어 있었다.** 앱의 Google 로그인은 시스템 브라우저를 거치는데(Google이
 * 임베드 웹뷰를 막는다) 그 브라우저가 바로 사용자가 A로 쓰던 그 브라우저다.
 *
 * 원래 계획은 "클라이언트가 만들어지기 **전에** 해시를 낚아채면 세션이 서지 않는다"
 * 였고, `main.tsx`가 그렇게 부른다. **그 계획은 두 가지 이유로 성립하지 않았다**:
 *
 *  1. **ESM 임포트가 먼저 평가된다.** `main.tsx`의 본문보다 `import { App }`이
 *     끌어온 모듈들이 먼저 돈다 — 그 안에 `BackendContext.tsx`의
 *     `const defaultBackend = createBackend()`가 있어 클라이언트는 **이미** 만들어져 있다.
 *  2. **주소를 지워도 늦다.** auth-js의 `_initialize()`는 생성자 스택에서
 *     `parseParametersFromURL(window.location.href)`를 **동기로** 읽어 `params`에
 *     담아 두고(implicit 판정까지 동기다), 세션은 한 마이크로태스크 뒤에 **그 사본**으로
 *     세운다. 즉 우리가 그 사이에 주소를 지워도 auth-js는 손에 든 토큰으로
 *     `_saveSession()`을 하고 **BroadcastChannel로 다른 탭까지 `SIGNED_IN`을 알린다.**
 *
 * 그래서 앱은 앱대로 토큰을 받아 B로 로그인하고(우리 낚아채기는 성공한다), 브라우저는
 * 브라우저대로 B 세션을 저장해 **A를 덮어썼다**. 둘 다 성공해서 생긴 고장이다.
 *
 * ## 그래서 경주를 그만둔다
 *
 * 순서를 맞추는 것으로는 이길 수 없다(모듈 평가 순서 하나만 바뀌어도 되돌아온다).
 * **이 주소에서는 클라이언트가 애초에 URL을 보지 않게** 한다 — 순서와 무관한 성질이라
 * 조용히 되살아나지 않는다. 낚아채기는 그대로 두되 이제 역할이 다르다: 앱에 넘길 값을
 * 읽고 **주소창·방문 기록에서 토큰을 치우는** 위생 작업이다.
 */
export function isAuthCourierPath(pathname: string): boolean {
  return pathname === DESKTOP_HANDOFF_PATH || pathname === GCAL_HANDOFF_PATH;
}

/* ── 핸드오프 주소의 토큰 낚아채기 ───────────────────────────────────────────
 * 앱에 넘길 갱신 토큰을 읽고 **주소창·방문 기록에서 토큰을 치운다**.
 *
 * 세션이 브라우저에 서지 않게 막는 것은 **이 함수가 아니다** — 그 일은
 * `isAuthCourierPath`가 `detectSessionInUrl: false`로 한다. 한동안 이 낚아채기가
 * 그 몫까지 한다고 믿었지만 순서가 성립하지 않았고, 그래서 계정이 뒤섞였다(위 ③).
 * 이제 이 함수는 언제 돌아도 되고, 늦게 돌아도 계정을 뒤섞지 않는다.
 */
let captured: string | null = null;

export function captureDesktopAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  if (window.location.pathname !== DESKTOP_HANDOFF_PATH) return null;
  const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
  // implicit는 해시로 온다. 쿼리도 함께 보는 것은 앞으로 흐름이 바뀌어도 이 자리가
  // 조용히 죽지 않게 하는 안전망이다(값의 뜻은 어느 쪽이든 같다).
  const token =
    new URLSearchParams(hash).get('refresh_token') ??
    new URLSearchParams(window.location.search).get('refresh_token');
  if (!token) return null;
  captured = token;
  try {
    window.history.replaceState({}, '', DESKTOP_HANDOFF_PATH);
  } catch {
    // 주소를 정리하지 못했더라도 값은 손에 있다 — 핸드오프는 계속한다.
  }
  return token;
}

/**
 * 낚아챈 갱신 토큰. 아직 낚아채지 않았으면(엔트리를 거치지 않은 렌더) 그 자리에서
 * 한 번 시도한다. **비우지 않는다** — 페이지가 다시 그려져도 같은 값을 봐야 한다.
 */
export function desktopAuthToken(): string | null {
  return captured ?? captureDesktopAuthToken();
}

/** 테스트 전용 — 모듈에 남은 값을 비운다. */
export function resetDesktopAuthToken(): void {
  captured = null;
}

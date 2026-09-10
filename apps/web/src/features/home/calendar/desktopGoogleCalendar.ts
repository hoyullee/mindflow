// 설치형 데스크톱 앱(Electron 셸)의 **Google 캘린더 연동** — 주소·딥링크를 만드는
// 순수 조각들. 실제 흐름을 모는 쪽은 `googleCalendar.ts`다(거기에 토큰 저장과
// 코드 교환이 있다 — 여기서 부르면 순환 import가 된다).
//
// ── 왜 GIS 팝업을 쓰지 않는가 ────────────────────────────────────────────────
// 웹에서는 GIS(`initCodeClient`)가 `window.open`으로 동의 창을 띄운다. 그런데 앱
// 창은 **우리 출처만** 띄우므로(셸의 `setWindowOpenHandler`) 그 요청이 시스템
// 브라우저로 넘어가고, GIS에게는 `window.open`이 `null`을 돌려준 것으로 보인다 →
// `popup_failed_to_open` → 화면에 **"팝업이 막혔어요"**(제보 ②). 그리고 브라우저에서
// 동의를 마쳐도 그 창의 `opener`가 없어 코드를 돌려줄 곳이 없다(제보 ①).
//
// 억지로 앱 창 안에서 여는 길도 있지만 Google은 임베드 웹뷰의 OAuth를 막고
// (`disallowed_useragent`) 사용자 에이전트 위장은 정책 위반이다 — 검수를 막 통과한
// 상태라 건드리지 않는다. 그래서 **로그인과 같은 길**(RFC 8252)을 쓴다:
//
//   1. 앱: 동의 주소를 만들어 **시스템 브라우저**에서 연다(`response_type=code`).
//   2. 브라우저: 동의 → `https://<origin>/auth/gcal?code=…&state=…`
//   3. 그 페이지: `geurio://gcal?code=…&state=…`로 앱을 깨운다.
//   4. 앱: `state`를 대조하고 코드를 **Edge Function**에 넘겨 교환한다
//      (client secret은 서버에만 있다 — 브라우저는 코드를 나르기만 한다).
//
// **스코프는 하나도 늘지 않는다.** 새로 필요한 것은 Google 콘솔의
// **승인된 리디렉션 URI**에 `https://geurio.com/auth/gcal` 한 줄뿐이다
// (server/supabase/docs/backend.md §19 — 리다이렉트 URI는 검수 대상이 아니다).

/** 브라우저가 동의를 끝낸 뒤 들르는 페이지(공개 라우트). */
export const GCAL_HANDOFF_PATH = '/auth/gcal';

/** 셸이 등록한 커스텀 프로토콜(apps/desktop/src/shell.ts의 `DEEP_LINK_SCHEME`). */
const SCHEME = 'geurio';
const GCAL_TARGET = 'gcal';

/**
 * 동의가 끝난 뒤 구글이 되돌려 보낼 주소. **Google 콘솔의 승인된 리디렉션 URI에
 * 이 값이 있어야 한다** — 없으면 구글이 `redirect_uri_mismatch`로 거절하고
 * 사용자는 브라우저에서 구글의 오류 화면을 본다.
 */
export function gcalRedirectUri(origin: string): string {
  return `${origin}${GCAL_HANDOFF_PATH}`;
}

/** 서버(Edge Function)가 받아 주는 리디렉션 URI인가 — 교환 요청을 보내기 전 확인. */
export function isGcalRedirectUri(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.pathname === GCAL_HANDOFF_PATH;
  } catch {
    return false;
  }
}

/**
 * 시스템 브라우저에서 열 동의 주소.
 *
 * `access_type=offline` + `prompt=consent`는 **refresh token을 받기 위한** 짝이다 —
 * 그게 있어야 서버가 조용히 갱신할 수 있고(§19), 없으면 한 시간마다 다시 연결이다.
 */
export function buildGcalAuthUrl(o: { clientId: string; redirectUri: string; scope: string; state: string; hint?: string }): string {
  const q = new URLSearchParams({
    client_id: o.clientId,
    redirect_uri: o.redirectUri,
    response_type: 'code',
    scope: o.scope,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: o.state,
  });
  if (o.hint) q.set('login_hint', o.hint);
  return `https://accounts.google.com/o/oauth2/v2/auth?${q.toString()}`;
}

/** 브라우저 → 앱으로 인가 코드를 넘길 딥링크. */
export function buildGcalDeepLink(code: string, state: string): string {
  return `${SCHEME}://${GCAL_TARGET}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
}

/**
 * 딥링크에서 인가 코드를 읽는다. 우리가 아는 모양이 아니면 `null` — 이 문자열은
 * OS가 넘겨준 것이라 아무나 만들 수 있으므로(다른 앱·웹페이지가 `geurio://`를 쏠 수
 * 있다) 모양을 확인하고, **값의 정당성은 `state` 대조와 서버가 판단한다**.
 *
 * 로그인 딥링크(`geurio://auth`)와 같은 창구로 오므로 대상이 다르면 조용히 버린다.
 */
export function readGcalDeepLink(raw: string): { code: string; state: string } | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== `${SCHEME}:`) return null;
  // `geurio://gcal`은 host='gcal', `geurio:gcal`은 pathname='gcal' — OS·브라우저가
  // 스킴 URL을 정규화하는 방식이 갈리므로 둘 다 받는다(로그인 딥링크와 같은 규칙).
  const target = (u.host || u.pathname.replace(/^\/*/, '')).replace(/\/+$/, '');
  if (target !== GCAL_TARGET) return null;
  const code = u.searchParams.get('code') ?? '';
  return code ? { code, state: u.searchParams.get('state') ?? '' } : null;
}

/** 한 번 쓰고 버리는 대조값 — 남이 쏜 `geurio://gcal?code=…`를 우리 것으로 착각하지 않게. */
export function newGcalState(): string {
  const buf = new Uint8Array(16);
  // 테스트·구형 환경에는 `crypto`가 없을 수 있다 — 그때도 흐름은 굴러가야 한다.
  const c = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c?.getRandomValues) c.getRandomValues(buf);
  else for (let i = 0; i < buf.length; i += 1) buf[i] = Math.floor(Math.random() * 256);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

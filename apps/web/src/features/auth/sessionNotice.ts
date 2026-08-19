// 세션 만료를 **조용히 넘기지 않는다** — 로그인 화면으로 튕길 때 그 이유와
// 돌아갈 자리를 함께 들고 간다(세션 정책 ②, `server/supabase/docs/backend.md` §15).
//
// 왜 표시가 필요한가: `RequireAuth`가 세션 유무만 보고 `/login`으로 보내면
// "로그아웃한 것"과 "세션이 만료된 것"이 화면상 같아진다. 그리고 편집 중이던
// 맵으로 돌아오려면 사용자가 주소를 다시 찾아야 한다.
//
// 저장은 두 갈래다:
// - `mf_had_session`(localStorage, 기기에 남는다) = "이 기기에서 로그인한 적이
//   있다". 처음부터 로그아웃 상태인 방문(그냥 문지기)과 **세션이 사라진 방문**
//   (만료)을 가르는 유일한 단서다 — 탭을 닫아 둔 사이 만료된 경우까지 잡는다.
// - `mf_session_expired`(sessionStorage, 이 탭 한 번만) = 방금 만료로 튕겼다.
//   로그인 화면이 한 번 읽고 지운다(같은 안내가 계속 붙어 있지 않게).
//
// 사용자가 **직접** 로그아웃한 경우에는 마커를 지우므로 만료 안내가 뜨지 않는다.

const HAD_SESSION = 'mf_had_session';
const EXPIRED = 'mf_session_expired';

/** 로그인 상태를 이 기기에 기억한다(만료 판정의 근거). */
export function rememberSignedIn(): void {
  try {
    localStorage.setItem(HAD_SESSION, '1');
  } catch {
    /* 저장 불가(프라이빗 모드·쿼터) — 만료 안내만 못 뜬다 */
  }
}

/** 이 기기에서 로그인한 적이 있는가. */
export function hadSession(): boolean {
  try {
    return localStorage.getItem(HAD_SESSION) === '1';
  } catch {
    return false;
  }
}

/** 사용자가 직접 로그아웃 — 만료가 아니므로 마커를 지운다. */
export function forgetSignedIn(): void {
  try {
    localStorage.removeItem(HAD_SESSION);
    sessionStorage.removeItem(EXPIRED);
  } catch {
    /* no-op */
  }
}

/** 만료로 튕긴다고 표시(로그인 화면이 한 번 읽는다). */
export function noteSessionExpired(): void {
  try {
    sessionStorage.setItem(EXPIRED, '1');
  } catch {
    /* no-op */
  }
}

/** 만료 안내를 **꺼내 온다**(읽고 지운다 — 한 번만 보여 준다). */
export function takeSessionExpired(): boolean {
  try {
    const hit = sessionStorage.getItem(EXPIRED) === '1';
    if (hit) sessionStorage.removeItem(EXPIRED);
    return hit;
  } catch {
    return false;
  }
}

/**
 * 로그인 뒤 돌아갈 자리 — **우리 앱 안의 경로만** 통과시킨다(순수 함수).
 *
 * `//evil.com`·`https://evil.com`처럼 밖으로 나가는 값을 그대로 쓰면 로그인
 * 페이지가 오픈 리다이렉트가 된다. 슬래시 하나로 시작하고 다음 글자가 슬래시나
 * 백슬래시가 아닌 경로만 받는다. 로그인·랜딩으로 되돌아가는 값도 뜻이 없어 버린다.
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  const v = (raw || '').trim();
  if (!v || v[0] !== '/' || v[1] === '/' || v[1] === '\\') return null;
  const path = v.split('?')[0]!.split('#')[0]!;
  if (path === '/' || path === '/login') return null;
  return v;
}

/** 지금 화면(경로+질의)을 `next`로 실은 로그인 주소. */
export function loginUrlWithNext(pathname: string, search = ''): string {
  const here = safeNextPath(`${pathname}${search}`);
  return here ? `/login?next=${encodeURIComponent(here)}` : '/login';
}

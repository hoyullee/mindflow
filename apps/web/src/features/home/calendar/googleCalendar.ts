/**
 * 구글 캘린더 **읽기 전용 겹치기**(PR5).
 *
 * ## 왜 이렇게 만들었나
 *
 * **구글은 정본이 아니다.** 우리는 구글에 쓰지 않고, 받아 온 일정을 우리 DB에
 * 저장하지도 않는다 — 보이는 달치를 그때그때 받아 화면에만 겹친다. 저장하면
 * 두 곳의 진실이 갈리고(구글에서 지운 일정이 우리 쪽에 남는다) 동기화라는 큰
 * 문제를 새로 떠안는다. 겹치기만 하면 **구글이 언제나 옳다**.
 *
 * **인증은 로그인과 따로다.** 로그인은 GIS **ID 토큰** 흐름이라(googleIdentity.ts)
 * API 스코프를 주지 않는다. 캘린더를 읽으려면 `calendar.readonly` 스코프의
 * **액세스 토큰**이 필요하고, 그건 GIS의 다른 API(`accounts.oauth2`)다. 로그인에
 * 스코프를 묶지 않은 이유는 구글이 권하는 **점진적 승인**이기도 하다 — 캘린더를
 * 안 쓰는 사람에게 캘린더 권한을 묻지 않는다.
 *
 * **연결은 서버가 유지한다.** 브라우저는 인가 코드를 받아 Edge Function
 * `google-oauth`에 넘기고, 함수가 client secret으로 교환해 **refresh token을 서버에**
 * 보관한다(0035 `google_credentials` — 클라이언트 정책 없음). 액세스 토큰이 만료되면
 * `ensureGoogleToken`이 그 함수로 **팝업 없이** 새로 받아 온다.
 *
 * 예전에는 브라우저 전용 토큰 흐름뿐이라 refresh token이 없었고, 갱신하려면 GIS를
 * 다시 불러야 하는데 그건 조용한 갱신(`prompt: ''`)이라도 **팝업 창을 연다**(이
 * API에는 창 없는 갱신이 없다). 그래서 한 시간마다 "다시 연결"을 눌러야 했다.
 * 그 흐름은 **폴백으로 남아 있다** — 로컬·데모 모드나 함수·시크릿 미배포 서버에서는
 * 지금도 그대로 굴러간다(배포 순서와 무관하게 앱이 깨지지 않는다).
 *
 * **액세스 토큰은 이 기기에 남는다**(`localStorage`). 예전에는 `sessionStorage`에
 * 뒀는데 그건 **탭마다 따로**여서, 새 탭을 열면 연동이 풀린 것처럼 보였다(제보:
 * "자꾸 해제된다"). 대가는 한 시간짜리 토큰 하나다(XSS는 sessionStorage도 같이
 * 읽는다). refresh token은 **절대 브라우저에 오지 않는다** — 만료가 없어서 유출
 * 표면이 한 시간에서 무기한으로 늘어난다. 옛 탭에 남은 sessionStorage 토큰은 처음
 * 읽을 때 옮겨 담아 연동이 끊기지 않게 한다.
 *
 * ## 배포 전 필요한 것(코드 밖)
 *
 * 연결 유지에는 **서버 시크릿 둘**(`GOOGLE_CLIENT_ID`·`GOOGLE_CLIENT_SECRET`)과
 * `google-oauth` 함수 배포가 필요하다 — 없으면 위의 폴백으로 굴러간다. 절차는
 * `backend.md` §19.
 */

import { loadGisScript, readGoogleClientId } from '../../auth/googleIdentity';
import { disconnectGoogleServer, exchangeGoogleCode, refreshGoogleAccess, serverKnownUnavailable, type ServerToken } from './googleOAuthServer';
import { rememberName, rememberNames } from './nameBook';

/**
 * 이 앱이 구글에 요구하는 것 — **필수 둘 + 선택 셋.**
 *
 * ## 필수 — 없으면 기능이 성립하지 않는다
 * - `calendar.events` 일정 읽기·쓰기. 그리오에서 만들고 고치려면 필요하다.
 * - `calendar.calendarlist.readonly` "어느 캘린더를 겹칠까"를 고르게 하는 목록.
 *   `calendar.events`는 일정만 주고 캘린더 **목록**은 주지 않는다.
 *
 * ## 선택 — 있으면 더 편하고, 없으면 그만큼만 줄어든다
 * - `directory.readonly` 조직 구성원을 **이름으로** 찾아 참석자로 넣는다(People API).
 * - `contacts.other.readonly` 주고받은 적 있는 사람도 후보에(개인 계정에서 특히).
 * - `admin.directory.resource.calendar.readonly` **회의실** 목록(Admin SDK).
 *
 * **왜 필수와 선택을 가르나**: 개인 구글 계정에는 조직 디렉터리가 없고, 회의실
 * 스코프는 조직 설정에 따라 관리자 동의를 요구할 수 있다. 그걸 필수로 묶으면
 * **받지 못한 사람은 캘린더 연동 자체가 막힌다** — 그럴 바엔 그 기능만 접고
 * 이메일 입력으로 돌아가는 편이 낫다(정직한 어포던스: 안 되는 것은 안 보인다).
 *
 * 전체 권한(`calendar`)을 받지 않은 이유: 캘린더 자체를 만들거나 지우지 않으므로
 * 요구할 근거가 없다 — 검수도 스코프마다 "왜 필요한가"를 묻는다.
 */
export const GOOGLE_SCOPE_REQUIRED = ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.calendarlist.readonly'];

export const GOOGLE_SCOPE_DIRECTORY = 'https://www.googleapis.com/auth/directory.readonly';
export const GOOGLE_SCOPE_OTHER_CONTACTS = 'https://www.googleapis.com/auth/contacts.other.readonly';
export const GOOGLE_SCOPE_ROOMS = 'https://www.googleapis.com/auth/admin.directory.resource.calendar.readonly';

export const GOOGLE_SCOPE_OPTIONAL = [GOOGLE_SCOPE_DIRECTORY, GOOGLE_SCOPE_OTHER_CONTACTS, GOOGLE_SCOPE_ROOMS];

/** 동의 창에서 함께 묻는 전부(필수 + 선택). */
export const GOOGLE_CALENDAR_SCOPES = [...GOOGLE_SCOPE_REQUIRED, ...GOOGLE_SCOPE_OPTIONAL];
export const GOOGLE_CALENDAR_SCOPE = GOOGLE_CALENDAR_SCOPES.join(' ');

/** 승인된 스코프 문자열 → 집합. */
export function scopeSet(granted: string | undefined): Set<string> {
  return new Set((granted ?? '').split(/\s+/).filter(Boolean));
}

/**
 * 받아 둔 토큰이 **필수** 권한을 다 담고 있는가. 스코프를 넓힌 뒤에도 옛 토큰이
 * 남아 있으면 쓰기 요청만 403으로 죽는다 — 그럴 바엔 없는 것으로 보고 다시 받게
 * 한다(사용자에겐 "다시 연결" 한 번).
 *
 * **선택 스코프는 보지 않는다** — 하나라도 거절당하면 연동이 통째로 막히기 때문이다.
 */
export function scopeCovers(granted: string | undefined): boolean {
  if (!granted) return false;
  const have = scopeSet(granted);
  return GOOGLE_SCOPE_REQUIRED.every((s) => have.has(s));
}

/** 토큰을 담아 두는 자리 — 탭이 닫히면 사라진다(위 주석의 이유). */
const TOKEN_KEY = 'mf_gcal_token';

const API = 'https://www.googleapis.com/calendar/v3';

/** GIS `accounts.oauth2` 중 이 앱이 건드리는 것만. */
export interface GsiTokenApi {
  /**
   * 인가 코드 흐름 — 브라우저는 **코드**만 받고 교환은 서버가 한다. 이 흐름이라야
   * refresh token이 나오고, 그래야 연결이 한 시간 뒤에 끊기지 않는다.
   */
  initCodeClient?(config: {
    client_id: string;
    scope: string;
    ux_mode?: 'popup' | 'redirect';
    select_account?: boolean;
    hint?: string;
    callback: (res: { code?: string; scope?: string; error?: string; error_description?: string }) => void;
    error_callback?: (err: { type?: string; message?: string }) => void;
  }): { requestCode(): void };
  initTokenClient(config: {
    client_id: string;
    scope: string;
    prompt?: '' | 'none' | 'consent' | 'select_account';
    hint?: string;
    callback: (res: { access_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string }) => void;
    error_callback?: (err: { type?: string; message?: string }) => void;
  }): { requestAccessToken(overrides?: { prompt?: string; hint?: string }): void };
  revoke(token: string, done?: () => void): void;
}

export interface GoogleToken {
  accessToken: string;
  /** epoch ms — 이 시각이 지나면 다시 받아야 한다. */
  expiresAt: number;
  /** 구글이 실제로 승인한 스코프(공백으로 이어진 문자열) — `scopeCovers`가 본다. */
  scope?: string;
}

/** 구글이 돌려준 캘린더 하나(목록 화면이 쓰는 것만). */
export interface GoogleCalendarMeta {
  id: string;
  summary: string;
  /** 구글이 그 캘린더에 지정해 둔 색 — 우리 칩도 이 색을 쓴다. */
  color?: string;
  primary?: boolean;
  /** 공휴일 캘린더인가 — 일정 칩이 아니라 **날짜 색**으로 그린다. */
  holiday?: boolean;
  /**
   * 이 캘린더에 **쓸 수 있는가**(`accessRole`이 owner/writer). 공휴일 캘린더나 남이
   * 보기 전용으로 공유한 캘린더는 거짓이다 — 그런 곳은 목적지로 내주지 않고,
   * 그 일정도 고칠 수 없다고 화면이 말한다.
   */
  writable?: boolean;
}

/** 받아 온 일정 하나(그리는 데 필요한 것만 — 원문은 들고 있지 않는다). */
export interface GoogleEvent {
  id: string;
  calendarId: string;
  calendarName: string;
  title: string;
  /** `YYYY-MM-DD`(로컬) — 종일이든 시각이든 이 값으로 달력에 놓는다. */
  startDate: string;
  endDate: string;
  startTime?: string;
  endTime?: string;
  allDay: boolean;
  location?: string;
  description?: string;
  /** 구글에서 열기 링크. */
  htmlLink?: string;
  /** 그 캘린더의 색(캘린더 목록에서). */
  color?: string;
  /**
   * 사용자가 **그 일정에** 지정한 색(요청) — 구글의 이벤트 색 번호(1~11)다.
   * 캘린더 색과 다른 값이고, 지정하지 않으면 없다(그때는 캘린더 색을 쓴다).
   */
  colorId?: string;
  holiday?: boolean;
  /** 공휴일 중에서도 **실제로 쉬는 날**인가(`isDayOffHoliday`) — 달력을 칠하는 기준. */
  dayOff?: boolean;
  /** 구글 쪽 일정 id(우리 `id`는 캘린더까지 붙인 값이라 요청에 못 쓴다). */
  eventId: string;
  /** 그 캘린더에 쓸 수 있는가 — 고칠 수 있는지 화면이 이 값으로 판단한다. */
  writable?: boolean;
  /** 남이 덮어쓴 것을 모르고 다시 덮지 않게 — 수정 요청의 `If-Match`에 싣는다. */
  etag?: string;
  /** 반복 일정의 **회차**면 원본 일정 id — 있으면 "이 회차만" 고친다. */
  recurringEventId?: string;
  /**
   * **근무 위치**(구글의 `eventType: 'workingLocation'`) — 재택·사무실 표시다.
   * 일정이 아니라 그 날의 상태이므로 달력의 칩으로 늘어놓지 않고(제보: 근무 위치까지
   * 일정으로 잡혔다) 날짜 칸 우측 상단에 따로 그린다. 값은 사람이 읽을 한 마디다.
   */
  workLocation?: string;
  /** 그 근무 위치의 갈래 — 고치는 팝업이 지금 값을 켜 두려고 든다. */
  workLocationKind?: WorkLocationKind;
  /** 초대한 사람들의 이메일 — 구글이 초대 메일을 보낸다(우리는 못 보낸다). */
  attendees?: string[];
  /** 예약한 회의실의 리소스 주소 — 구글에서는 이것도 참석자다(`resource: true`). */
  rooms?: string[];
  /** 공개 설정 — 기본/공개/비공개. */
  visibility?: GoogleVisibility;
  /** 참여 가능 여부 — 바쁨(opaque)/한가함(transparent). */
  transparency?: GoogleTransparency;
  /**
   * 알림 — `null`은 "없음", 숫자는 "N분 전", `undefined`는 **캘린더 기본 알림**이다.
   * 구글의 `reminders.useDefault`가 그 셋을 가른다.
   */
  reminderMinutes?: number | null;
  /** Google Meet 링크(있으면). */
  meetLink?: string;
  /**
   * **이 일정을 만든 사람**(요청) — 초대받은 일정이면 "누가 불렀나"가 정보다.
   * 내가 만든 일정에는 `self`가 서므로 화면이 그때는 이 줄을 그리지 않는다.
   */
  organizer?: { email: string; name?: string; self?: true };
  /**
   * **참석자별 응답**(email → 상태). 화면이 쓰는 것은 내 응답 하나지만
   * (`myRsvpOf`), 전부 들고 있어야 참석자 배열을 다시 쓸 때 **남의 응답을 지우지
   * 않는다** — 구글의 PATCH는 이 배열을 통째로 바꾸므로, 이메일만 실어 보내면
   * 모두의 참석 여부가 '미응답'으로 되돌아간다.
   */
  rsvps?: Record<string, GoogleRsvp>;
  /** 참석자 목록에서 **나**인 항목의 이메일(`self: true`) — 없으면 초대받지 않았다. */
  selfEmail?: string;
  /**
   * 구글이 알려 준 **표시 이름**(email → 이름). 이름을 아는 사람은 구글이 참석자·
   * 주최자에 `displayName`을 실어 준다 — 이 값을 버리면 화면이 이메일 앞부분으로
   * 떨어진다(제보). 없는 사람은 디렉터리 검색이 채우고, 그것도 없으면 로컬파트다.
   */
  names?: Record<string, string>;
}

/** 참석 여부 — 구글의 `responseStatus` 그대로. */
export type GoogleRsvp = 'accepted' | 'declined' | 'tentative' | 'needsAction';

/** 내 응답 — 초대받지 않은 일정(내가 만든 것 포함)에는 없다. */
export function myRsvpOf(g: Pick<GoogleEvent, 'rsvps' | 'selfEmail'>): GoogleRsvp | undefined {
  return g.selfEmail ? (g.rsvps?.[g.selfEmail] ?? 'needsAction') : undefined;
}

export type GoogleVisibility = 'default' | 'public' | 'private';
export type GoogleTransparency = 'opaque' | 'transparent';

// ── 토큰 ────────────────────────────────────────────────────────────────────

/** 만료 60초 전부터는 만료로 본다 — 요청 도중에 죽는 토큰을 쓰지 않는다. */
const SKEW_MS = 60_000;

export function readStoredToken(now = Date.now()): GoogleToken | null {
  try {
    let raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) {
      // 이 기기로 옮기기 전(sessionStorage) 탭에 남은 토큰은 그대로 이어 쓴다 —
      // 배포 순간 연동이 끊긴 것처럼 보이지 않게.
      raw = sessionStorage.getItem(TOKEN_KEY);
      if (raw) {
        localStorage.setItem(TOKEN_KEY, raw);
        sessionStorage.removeItem(TOKEN_KEY);
      }
    }
    if (!raw) return null;
    const t = JSON.parse(raw) as Partial<GoogleToken>;
    if (typeof t.accessToken !== 'string' || typeof t.expiresAt !== 'number') return null;
    if (t.expiresAt - SKEW_MS <= now) return null;
    // 스코프를 넓힌 배포 뒤 남아 있는 옛 토큰은 **없는 것으로 본다**(위 `scopeCovers`).
    if (!scopeCovers(t.scope)) return null;
    return { accessToken: t.accessToken, expiresAt: t.expiresAt, ...(t.scope ? { scope: t.scope } : {}) };
  } catch {
    return null;
  }
}

/**
 * 토큰이 바뀌었음을 **같은 탭의 다른 훅 인스턴스**에 알린다. 토큰은 탭 sessionStorage에
 * 살아서, 설정 모달에서 "다시 연결"해도 일정 화면의 훅 인스턴스는 다시 조회할 계기가
 * 없었다 — prefs가 이미 켜져 있으면 아무 의존성도 바뀌지 않아 **새로고침해야 보였다**(제보).
 */
const tokenListeners = new Set<() => void>();
export function onTokenChange(cb: () => void): () => void {
  tokenListeners.add(cb);
  // 다른 탭이 연결·해제하면 그 탭의 `storage` 이벤트로 알 수 있다 — 토큰이 이제
  // 기기 저장소에 있으므로 탭 사이에도 상태가 갈리지 않는다.
  const onStorage = (e: StorageEvent): void => {
    if (e.key === TOKEN_KEY || e.key === null) cb();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    tokenListeners.delete(cb);
    window.removeEventListener('storage', onStorage);
  };
}

export function storeToken(t: GoogleToken | null): void {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, JSON.stringify(t));
    else localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* 사생활 보호 모드 등 — 저장 못 해도 이번 탭은 메모리로 굴러간다 */
  }
  for (const cb of [...tokenListeners]) cb();
}

function currentTokenApi(): GsiTokenApi | null {
  const w = window as unknown as { google?: { accounts?: { oauth2?: GsiTokenApi } } };
  return w.google?.accounts?.oauth2 ?? null;
}

/** GIS 토큰 API. 스크립트가 막혔거나(광고 차단·오프라인) 없으면 `null`. */
export async function loadGoogleTokenApi(): Promise<GsiTokenApi | null> {
  const existing = currentTokenApi();
  if (existing) return existing;
  await loadGisScript();
  return currentTokenApi();
}

/**
 * 토큰 요청의 결과 셋 — `cancelled`는 **사용자가 창을 닫았거나 거절한 것**이다(제보:
 * 그때 "Popup window closed"가 오류처럼 떴다). 취소는 실패가 아니라 결정이므로
 * 화면은 문구 없이 제자리로 돌아간다.
 */
export type TokenRequestResult = { token: GoogleToken } | { error: string } | { cancelled: true };

/**
 * 액세스 토큰을 받는다.
 *
 * @param interactive 동의 창을 띄워도 되는가. 사용자가 **직접 누른** 연결에서만
 *   true다 — 화면을 여는 것만으로 팝업이 뜨면 안 된다(그리고 브라우저가 막는다).
 */
/** 서버가 준 액세스 토큰을 저장하고 결과로 바꾼다(코드 교환·조용한 갱신 공용). */
function acceptServerToken(t: ServerToken): TokenRequestResult {
  const token: GoogleToken = {
    accessToken: t.accessToken,
    expiresAt: Date.now() + t.expiresIn * 1000,
    scope: t.scope || GOOGLE_CALENDAR_SCOPE,
  };
  // 승인 범위가 모자라면 저장하지 않는다 — 그 토큰으로는 어차피 쓸 수 없다.
  if (!scopeCovers(token.scope)) return { error: '캘린더 읽기·쓰기 권한을 모두 허용해야 일정을 만들 수 있어요.' };
  storeToken(token);
  return { token };
}

/**
 * 인가 코드를 받아 서버에 넘긴다. 서버 흐름을 쓸 수 없으면 `null`을 돌려주고
 * 호출부가 예전(브라우저 토큰) 흐름으로 물러난다.
 *
 * 코드 흐름에는 `prompt` 손잡이가 없다(GIS `initCodeClient`의 설정에 그런 값이
 * 없다). 대신 **결과로 판단한다**: 서버가 refresh token을 갖게 됐는지를
 * `persistent`로 알려 주고, 그렇지 못하면 예전처럼 한 시간짜리로 굴러간다.
 */
async function requestViaCode(api: GsiTokenApi, clientId: string, hint?: string): Promise<TokenRequestResult | null> {
  if (!api.initCodeClient) return null;
  const code = await new Promise<{ code: string } | { cancelled: true } | { error: string } | null>((resolve) => {
    let settled = false;
    const done = (r: { code: string } | { cancelled: true } | { error: string } | null) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    try {
      const client = api.initCodeClient!({
        client_id: clientId,
        scope: GOOGLE_CALENDAR_SCOPE,
        ux_mode: 'popup',
        ...(hint ? { hint } : {}),
        callback: (res) => {
          if (res.code) {
            done({ code: res.code });
            return;
          }
          if (res.error === 'access_denied') {
            done({ cancelled: true });
            return;
          }
          done({ error: res.error_description || res.error || '구글 권한을 받지 못했어요.' });
        },
        error_callback: (err) =>
          err.type === 'popup_closed'
            ? done({ cancelled: true })
            : done({
                error:
                  err.type === 'popup_failed_to_open'
                    ? '팝업이 막혔어요. 브라우저의 팝업 차단을 풀고 다시 눌러 주세요.'
                    : err.message || err.type || '구글 권한을 받지 못했어요.',
              }),
      });
      client.requestCode();
    } catch {
      // 이 브라우저의 GIS가 코드 흐름을 모르면 예전 흐름으로 물러난다.
      done(null);
    }
  });
  if (!code) return null;
  if ('cancelled' in code || 'error' in code) return code;

  const res = await exchangeGoogleCode(code.code);
  // 서버가 없다는 사실은 **코드를 받은 뒤에야** 알 수도 있다 — 그때는 사용자가 이미
  // 동의 창을 지났으므로, 호출부의 예전 흐름이 이어서 토큰을 받는다(창이 한 번 더
  // 뜨지만 이미 승인한 계정이라 곧 닫힌다).
  if ('unavailable' in res) return null;
  if ('needsConsent' in res) return { error: GOOGLE_RECONNECT_MSG };
  if ('error' in res) return { error: res.error };
  return acceptServerToken(res.token);
}

export async function requestGoogleToken(interactive: boolean, hint?: string): Promise<TokenRequestResult> {
  const clientId = readGoogleClientId();
  if (!clientId) return { error: '구글 연동이 설정되지 않았어요.' };
  const api = await loadGoogleTokenApi();
  if (!api) return { error: '구글에 연결하지 못했어요. 네트워크나 차단 확장을 확인해 주세요.' };

  // 창을 열기 **전에** 서버에 먼저 물어본다. 이유 둘:
  //  ① 서버가 이미 자격 증명을 갖고 있으면 창을 열 것도 없다(그냥 이어진다).
  //  ② 서버 흐름이 없는 환경인지도 여기서 알 수 있다 — 코드부터 받아 놓고 교환에서
  //     알게 되면 사용자가 동의 창을 두 번 지나야 한다.
  if (!serverKnownUnavailable()) {
    const silent = await refreshGoogleAccess();
    if ('token' in silent) return acceptServerToken(silent.token);
    // 서버는 살아 있는데 자격 증명이 없다 → 코드 흐름으로 받아 둔다(창 한 번).
    if ('needsConsent' in silent || 'error' in silent) {
      const viaCode = await requestViaCode(api, clientId, hint);
      if (viaCode) return viaCode;
    }
  }

  return new Promise<TokenRequestResult>((resolve) => {
    let settled = false;
    const done = (r: TokenRequestResult) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    try {
      const client = api.initTokenClient({
        client_id: clientId,
        scope: GOOGLE_CALENDAR_SCOPE,
        // 첫 연결·다시 연결은 동의 화면(`consent`). `''`는 "이미 승인했으면 바로" —
        // 그래도 팝업 창 자체는 뜬다(GIS에 창 없는 갱신이 없다). 그래서 이 함수는
        // 어느 모드든 **사용자 제스처에서만** 불려야 한다.
        prompt: interactive ? 'consent' : '',
        ...(hint ? { hint } : {}),
        callback: (res) => {
          if (res.access_token && res.expires_in) {
            // 구글이 **실제로 승인한** 스코프를 그대로 적어 둔다 — 사용자가 동의
            // 화면에서 일부만 체크할 수 있어서, 요구한 값이 아니라 받은 값을 믿는다.
            const granted = typeof res.scope === 'string' ? res.scope : GOOGLE_CALENDAR_SCOPE;
            const token = { accessToken: res.access_token, expiresAt: Date.now() + res.expires_in * 1000, scope: granted };
            storeToken(token);
            if (!scopeCovers(granted)) {
              done({ error: '캘린더 읽기·쓰기 권한을 모두 허용해야 일정을 만들 수 있어요.' });
              return;
            }
            done({ token });
            return;
          }
          // 동의 화면에서 **거절**을 누른 것은 취소다 — 오류로 말하지 않는다.
          if (res.error === 'access_denied') {
            done({ cancelled: true });
            return;
          }
          done({ error: res.error_description || res.error || '구글 권한을 받지 못했어요.' });
        },
        // GIS의 `popup_closed`는 사용자가 창을 닫은 것 — "Popup window closed"라는
        // 원문을 화면에 내보내지 않는다(제보). 창이 **열리지 못한** 것(팝업 차단)만 오류다.
        error_callback: (err) => (err.type === 'popup_closed' ? done({ cancelled: true }) : done({ error: err.type === 'popup_failed_to_open' ? '팝업이 막혔어요. 브라우저의 팝업 차단을 풀고 다시 눌러 주세요.' : err.message || err.type || '구글 권한을 받지 못했어요.' })),
      });
      client.requestAccessToken();
    } catch {
      done({ error: '구글에 연결하지 못했어요.' });
    }
  });
}

/** 토큰이 없어 다시 연결이 필요할 때의 안내 — 화면(설정·달력 머리 버튼)이 보여 준다. */
export const GOOGLE_RECONNECT_MSG = '구글 연결이 만료됐어요. 달력의 다시 연결 버튼으로 이어 주세요.';

/**
 * 저장된 토큰이 살아 있으면 그대로 쓴다. 없으면 **요청하지 않고** 실패를 돌려준다.
 *
 * 예전에는 여기서 `requestGoogleToken(false)`로 조용히 다시 받았는데, GIS 토큰
 * 요청은 `prompt: ''`여도 **팝업 창을 연다**(이 API에는 iframe 갱신이 없다 —
 * 구글 세션 상태에 따라 로그인 창까지 뜬다). 그래서 재로그인 뒤 달력을 여는
 * 것만으로 구글 팝업이 떴다(제보). 토큰이 없다는 사실은 화면이 "다시 연결"
 * 버튼으로 말하고, 새 요청은 **사용자가 직접 누른 곳**에서만 나간다.
 */
export async function ensureGoogleToken(): Promise<{ token: GoogleToken } | { error: string }> {
  const stored = readStoredToken();
  if (stored) return { token: stored };
  // 서버 흐름이 있으면 **팝업 없이** 새 액세스 토큰을 받아 온다(refresh token은
  // 서버에만 있다). 없는 환경에서는 예전대로 "다시 연결"을 요청한다.
  if (serverKnownUnavailable()) return { error: GOOGLE_RECONNECT_MSG };
  if (!refreshing) {
    refreshing = silentRefresh();
    void refreshing.finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

/**
 * 조용한 갱신 — 화면 여러 곳이 동시에 토큰을 찾을 수 있으므로 **한 번만** 부른다
 * (첫 요청이 도는 동안 나머지는 같은 약속을 기다린다).
 */
let refreshing: Promise<{ token: GoogleToken } | { error: string }> | null = null;

async function silentRefresh(): Promise<{ token: GoogleToken } | { error: string }> {
  const res = await refreshGoogleAccess();
  if (!('token' in res)) return { error: GOOGLE_RECONNECT_MSG };
  const got = acceptServerToken(res.token);
  // 권한이 모자란 토큰이면 화면은 "다시 연결"로 권한을 다시 묻는 편이 맞다.
  return 'token' in got ? got : { error: GOOGLE_RECONNECT_MSG };
}

/** 연결 해제 — 이 기기의 토큰을 버리고 구글 쪽 승인도 취소한다. */
export async function revokeGoogleToken(): Promise<void> {
  const stored = readStoredToken();
  storeToken(null);
  // 서버에 보관된 refresh token도 함께 버린다 — 그게 남아 있으면 "연결을 끊었다"가
  // 거짓말이 된다(우리 서버가 계속 액세스 토큰을 발급할 수 있는 상태).
  await disconnectGoogleServer().catch(() => undefined);
  if (!stored) return;
  const api = await loadGoogleTokenApi();
  try {
    api?.revoke(stored.accessToken);
  } catch {
    /* 취소가 실패해도 이 기기에서는 이미 잊었다 */
  }
}

// ── REST ────────────────────────────────────────────────────────────────────

async function get(path: string, token: string, params: Record<string, string>): Promise<unknown> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${API}${path}${qs ? `?${qs}` : ''}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    // 401은 "토큰이 죽었다" — 호출부가 조용히 다시 받아 재시도한다.
    const err = new Error(`google ${res.status}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/**
 * 구글의 **이벤트 색 팔레트**(요청 — 일정에 지정한 색을 그대로 가져온다).
 *
 * 색은 번호(`colorId` 1~11)로 오므로 실제 hex는 `/colors`에서 받아야 한다. 다만
 * 그 조회가 실패해도(스코프·네트워크) 색이 통째로 사라지면 안 되니, 구글이 오래
 * 유지해 온 값을 **폴백 표**로 함께 둔다. 표가 먼저 그려지고, 조회가 도착하면
 * 그 값으로 갈아 끼운다(사용자에게는 늘 색이 보인다).
 */
export const GOOGLE_EVENT_COLORS: Record<string, string> = {
  '1': '#7986cb', // Lavender
  '2': '#33b679', // Sage
  '3': '#8e24aa', // Grape
  '4': '#e67c73', // Flamingo
  '5': '#f6bf26', // Banana
  '6': '#f4511e', // Tangerine
  '7': '#039be5', // Peacock
  '8': '#616161', // Graphite
  '9': '#3f51b5', // Blueberry
  '10': '#0b8043', // Basil
  '11': '#d50000', // Tomato
};

/**
 * `/colors`의 이벤트 팔레트 — 번호 → 배경 hex. 실패하면 `null`(폴백 표를 쓴다).
 *
 * **실패를 드러낸다**(제보: 구글에서 지정한 색과 표식 색이 달랐다). 이 조회가 조용히
 * 실패하면 화면은 레거시 폴백 표로 그리고, 구글이 팔레트를 넓힌 뒤 지정한 색은 표에
 * 없어 **캘린더 색으로 떨어진다** — 사용자에겐 "엉뚱한 색"으로 보인다. 그러니 왜
 * 못 받았는지 콘솔에 남긴다(400 진단과 같은 결: 원인을 화면·로그가 말한다).
 */
export async function fetchEventColors(token: string): Promise<Record<string, string> | null> {
  try {
    const json = (await get('/colors', token, {})) as { event?: Record<string, { background?: unknown }> };
    const src = json?.event;
    if (!src || typeof src !== 'object') {
      console.warn('[geurio] 구글 색 팔레트가 비어 있어요 — 폴백 표로 그립니다');
      return null;
    }
    const out: Record<string, string> = {};
    for (const [id, v] of Object.entries(src)) {
      if (typeof v?.background === 'string') out[id] = v.background;
    }
    const ids = Object.keys(out);
    if (ids.length === 0) return null;
    // **몇 색을 받았는지 남긴다** — 색 칸의 개수는 이 응답이 정하므로(우리가 목록을
    // 적어 두지 않는다) "구글 UI에는 24색인데 여기는 11칸"의 답이 이 한 줄에 있다.
    console.info(`[geurio] 구글 이벤트 색 ${ids.length}개(번호 ${ids.sort((a, b) => Number(a) - Number(b)).join(',')})`);
    return out;
  } catch (e) {
    console.warn('[geurio] 구글 색 팔레트를 못 받았어요 — 폴백 표로 그립니다', (e as { status?: number }).status ?? e);
    return null;
  }
}

/**
 * 그 일정이 화면에서 쓸 색 — 일정에 지정한 색이 있으면 그것, 없으면 캘린더 색.
 *
 * 번호를 못 풀면(팔레트를 못 받았거나 구글이 새 번호를 쓰면) 캘린더 색으로 물러서되
 * **콘솔에 그 번호를 남긴다** — 그 상태가 곧 제보의 "색이 다르다"이고, 번호를 알면
 * 폴백 표를 채울 수 있다(우리가 지어낼 수는 없다).
 */
const warnedColorIds = new Set<string>();
export function eventColorOf(ev: GoogleEvent, palette: Record<string, string>): string | undefined {
  if (!ev.colorId) return ev.color;
  const hex = palette[ev.colorId] ?? GOOGLE_EVENT_COLORS[ev.colorId];
  if (hex) return hex;
  if (!warnedColorIds.has(ev.colorId)) {
    warnedColorIds.add(ev.colorId);
    console.warn(`[geurio] 모르는 구글 이벤트 색 번호 ${ev.colorId} — 캘린더 색으로 그립니다(팔레트 키: ${Object.keys(palette).join(',') || '없음'})`);
  }
  return ev.color;
}

/** 공휴일 캘린더 판별 — 구글의 공용 공휴일 캘린더 id가 이 꼴이다. */
export function isHolidayCalendarId(id: string): boolean {
  return id.includes('#holiday@group.v.calendar.google.com');
}

// 구글의 공휴일 캘린더에는 **쉬는 날이 아닌 것도 잔뜩** 들어 있다 — 24절기·기념일·
// 종교 절기까지. 그걸 전부 공휴일로 보면 달력이 통째로 분홍으로 물든다(제보).
// 구글은 종류를 `description`에 적어 준다("Public holiday" / "Observance" /
// "Season" …, 한국어 로케일이면 "공휴일" / "기념일"). 아래는 그 표기를 읽는다.
const OBSERVANCE_TOKENS = ['observance', 'season', 'sporting', 'clock change', 'daylight', 'working day', 'christian', 'muslim', 'hindu', 'jewish', 'hebrew', 'orthodox', '기념일', '절기', '잡절'];
const DAY_OFF_TOKENS = ['public holiday', 'national holiday', 'bank holiday', 'common local holiday', 'federal holiday', '공휴일', '국경일'];

/**
 * 그 공휴일이 **실제로 쉬는 날인가.** 확실할 때만 참이다 — 표기가 없거나 모르는
 * 값이면 거짓이다(이름은 그대로 보여 주되 달력을 칠하지는 않는다). 칠하는 쪽으로
 * 기울면 표기를 못 읽는 로케일에서 다시 온 달이 분홍이 된다.
 */
export function isDayOffHoliday(description?: string): boolean {
  const d = (description || '').toLowerCase();
  if (!d) return false;
  if (OBSERVANCE_TOKENS.some((t) => d.includes(t))) return false;
  return DAY_OFF_TOKENS.some((t) => d.includes(t));
}

export function parseCalendarList(json: unknown): GoogleCalendarMeta[] {
  const items = (json as { items?: unknown })?.items;
  if (!Array.isArray(items)) return [];
  const out: GoogleCalendarMeta[] = [];
  for (const raw of items) {
    const it = raw as Record<string, unknown>;
    const id = typeof it.id === 'string' ? it.id : '';
    if (!id) continue;
    // 숨긴 캘린더는 구글 화면에서도 안 보인다 — 우리도 목록에 올리지 않는다.
    if (it.hidden === true) continue;
    const summary = typeof it.summaryOverride === 'string' && it.summaryOverride ? it.summaryOverride : typeof it.summary === 'string' ? it.summary : id;
    const color = typeof it.backgroundColor === 'string' ? it.backgroundColor : undefined;
    out.push({
      id,
      summary,
      ...(color ? { color } : {}),
      ...(it.primary === true ? { primary: true } : {}),
      ...(isHolidayCalendarId(id) ? { holiday: true } : {}),
      ...(it.accessRole === 'owner' || it.accessRole === 'writer' ? { writable: true } : {}),
    });
  }
  // 기본 캘린더 먼저, 그 다음 이름순 — 목록 순서가 매번 흔들리지 않게.
  out.sort((a, b) => (a.primary ? -1 : b.primary ? 1 : a.summary.localeCompare(b.summary, 'ko')));
  return out;
}

export async function fetchCalendarList(token: string): Promise<GoogleCalendarMeta[]> {
  return parseCalendarList(await get('/users/me/calendarList', token, { minAccessRole: 'reader', maxResults: '250' }));
}

/** `2026-08-30T10:00:00+09:00` / `2026-08-30` → 로컬 `YYYY-MM-DD` + `HH:MM`. */
export function splitGoogleDateTime(v: { date?: string; dateTime?: string } | undefined): { date: string; time?: string } | null {
  if (!v) return null;
  if (v.date) return { date: v.date };
  if (!v.dateTime) return null;
  const d = new Date(v.dateTime);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, '0');
  return { date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, time: `${p(d.getHours())}:${p(d.getMinutes())}` };
}

/** 종일 일정의 `end.date`는 **다음 날**이다(배타적) — 우리 모델로 넣을 땐 하루를 더한다. */
function nextDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(y, m - 1, d + 1);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

/** 종일 일정의 `end.date`는 **다음 날**이다(배타적) — 하루 빼야 우리 모델과 맞는다. */
function prevDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(y, m - 1, d - 1);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

const RSVPS: readonly GoogleRsvp[] = ['accepted', 'declined', 'tentative', 'needsAction'];

/**
 * 참석자 — 이메일 목록(화면), 응답 표(쓰기), 그리고 **나**인 항목.
 *
 * **회의실은 갈라낸다**: 구글은 회의실도 참석자로 싣지만(`resource: true`) 사람과
 * 같은 줄에 늘어놓으면 "누구를 초대했나"가 흐려진다.
 *
 * 응답(`responseStatus`)은 화면에 쓰는 것이 내 것 하나뿐이지만 **전부** 담는다 —
 * 참석자 배열을 다시 쓸 때 남의 응답을 지우지 않으려면 그 값이 필요하다.
 */
function parseAttendees(raw: unknown): { attendees?: string[]; rooms?: string[]; rsvps?: Record<string, GoogleRsvp>; selfEmail?: string; names?: Record<string, string> } {
  if (!Array.isArray(raw)) return {};
  const people: string[] = [];
  const rooms: string[] = [];
  const rsvps: Record<string, GoogleRsvp> = {};
  const names: Record<string, string> = {};
  let selfEmail = '';
  for (const a of raw as Record<string, unknown>[]) {
    const email = typeof a.email === 'string' ? a.email : '';
    if (!email) continue;
    (a.resource === true ? rooms : people).push(email);
    const st = a.responseStatus;
    if (typeof st === 'string' && (RSVPS as readonly string[]).includes(st)) rsvps[email] = st as GoogleRsvp;
    // **이름을 버리지 않는다**(제보: 이름 대신 이메일 앞부분이 나왔다) — 구글이 아는
    // 사람은 `displayName`을 함께 준다. 예전에는 이메일만 남겨서, 화면이 디렉터리
    // 검색(선택 스코프)에 없는 사람을 전부 로컬파트로 그렸다.
    if (typeof a.displayName === 'string' && a.displayName.trim()) names[email] = a.displayName.trim();
    if (a.self === true && a.resource !== true) selfEmail = email;
  }
  return {
    ...(people.length ? { attendees: people } : {}),
    ...(rooms.length ? { rooms } : {}),
    ...(Object.keys(rsvps).length ? { rsvps } : {}),
    ...(selfEmail ? { selfEmail } : {}),
    ...(Object.keys(names).length ? { names } : {}),
  };
}

/**
 * 참석자·주최자 파싱 결과를 합치면서 **이름을 장부에 적는다**(`nameBook`) — 주최자에만
 * 온 `displayName`이 같은 사람의 참석자 행에도 쓰이게(제보: 한 사람이 두 이름).
 * 주최자 이름은 이 일정의 `names`에도 바로 넣는다.
 */
function remembered(
  a: ReturnType<typeof parseAttendees>,
  o: ReturnType<typeof parseOrganizer>,
): ReturnType<typeof parseAttendees> & ReturnType<typeof parseOrganizer> {
  rememberNames(a.names);
  const org = o.organizer;
  if (org?.name) rememberName(org.email, org.name);
  const names = { ...(a.names ?? {}), ...(org?.name && !a.names?.[org.email] ? { [org.email]: org.name } : {}) };
  return { ...a, ...o, ...(Object.keys(names).length ? { names } : {}) };
}

/**
 * 근무 위치를 한 마디로 — 재택 / 사무실(층·이름) / 직접 적은 곳.
 *
 * 구글은 `workingLocationProperties.type`으로 갈래를 주고 각 갈래에 라벨을 담는다.
 * 라벨이 없으면 갈래 이름만 쓴다 — 없는 것을 지어내지 않는다.
 */
export function workLocationLabel(raw: unknown): string {
  const w = raw as { type?: unknown; officeLocation?: { label?: unknown; buildingId?: unknown }; customLocation?: { label?: unknown } } | undefined;
  const text = (v: unknown): string => (typeof v === 'string' && v.trim() ? v.trim() : '');
  if (w?.type === 'homeOffice') return '재택';
  if (w?.type === 'officeLocation') return text(w.officeLocation?.label) || text(w.officeLocation?.buildingId) || '사무실';
  if (w?.type === 'customLocation') return text(w.customLocation?.label) || '근무 위치';
  return '근무 위치';
}

/** 근무 위치의 세 갈래 — 구글의 `workingLocationProperties.type`이 그대로 이 값이다. */
export type WorkLocationKind = 'homeOffice' | 'officeLocation' | 'customLocation';

/** 받은 값의 갈래 — 모르는 값이면 `null`(지어내지 않는다). */
export function workLocationKindOf(raw: unknown): WorkLocationKind | null {
  const t = (raw as { type?: unknown } | undefined)?.type;
  return t === 'homeOffice' || t === 'officeLocation' || t === 'customLocation' ? t : null;
}

/**
 * 팝업이 고른 값 — 사무실·기타 위치는 이름을 함께 든다(집은 이름이 없다).
 *
 * **구간과 시각**은 구글의 근무 위치 화면과 같은 모양이다(사용자 스크린샷): 종일은
 * 여러 날에 걸칠 수 있고, `시간 추가`를 켜면 **하루 안의 구간**이 된다(구글도 시각
 * 근무 위치를 하루로 제한한다) — 그래서 둘은 함께 쓰이지 않는다.
 */
export interface WorkLocationDraft {
  kind: WorkLocationKind;
  label?: string;
  /** 시작 날짜(포함). */
  startDate: string;
  /** 종료 날짜(포함) — 없으면 하루치. 시각이 있으면 무시한다. */
  endDate?: string;
  /** `시간 추가` — 둘 다 있을 때만 시각 근무 위치다. */
  startTime?: string;
  endTime?: string;
  /**
   * 매주 그 요일에 되풀이한다(요청 ④ — 구글의 `근무 위치 수정` 화면과 같은 선택).
   *
   * **하루짜리에만** 뜻이 있다: 구간은 이미 하루씩 여러 일정으로 나가므로 되풀이를
   * 얹으면 그 여러 개가 각각 매주 반복되는, 사용자가 고른 적 없는 모양이 된다.
   * 그래서 되풀이는 **일정 하나 + RRULE**이고 회차는 구글이 펼친다.
   */
  repeat?: 'weekly';
}

/** 한 번에 걸 수 있는 날 수 — 그만큼 요청이 나가므로 상한을 둔다. */
export const WORK_LOCATION_MAX_DAYS = 31;

/**
 * 근무 위치 일정 **하나**가 차지하는 구간 — 언제나 **그 하루**다.
 *
 * 구글이 그렇게 못박아 뒀다(라이브 제보의 400): `malformedWorkingLocationEvent`
 * — *"An all-day working location event must be exactly one day long."* 그래서
 * `endDate`는 **한 일정의 길이가 아니라 며칠에 걸 것인가**를 뜻하고, 그 해석은
 * `workLocationDays` **한 곳**에서만 한다(이 함수는 그 값을 아예 보지 않는다 —
 * 그래야 여러 날짜가 한 일정에 실리는 상태를 만들 수 없다).
 *
 * 시각이 켜져 있으면 그 하루 안의 구간이다(구글도 시각 근무 위치를 하루로 제한한다).
 */
export function workLocationWhen(w: WorkLocationDraft): Pick<GoogleEventDraft, 'allDay' | 'startDate' | 'endDate' | 'startTime' | 'endTime'> {
  const from = w.startDate;
  if (w.startTime && w.endTime) return { allDay: false, startDate: from, endDate: from, startTime: w.startTime, endTime: w.endTime };
  return { allDay: true, startDate: from, endDate: from };
}

/**
 * 그 초안을 **어느 날들에** 걸 것인가 — 종일은 시작~종료의 하루하루, 시각은 그 하루.
 *
 * 구글의 근무 위치 화면이 구간을 다루는 것은 맞지만(사용자 스크린샷) 저장은 **하루씩
 * 따로**다(위 제약). 그래서 우리도 그 구간의 날마다 하나씩 쓴다 — 날짜 칸이 근무
 * 위치를 하루 단위로 보여 주는 것과도 결이 같다.
 */
export function workLocationDays(w: WorkLocationDraft): string[] {
  const from = w.startDate;
  // 매주 되풀이는 **일정 하나**다 — 회차를 우리가 만들지 않고 구글이 펼친다.
  if (w.repeat === 'weekly') return [from];
  if (w.startTime && w.endTime) return [from];
  const to = w.endDate && w.endDate > from ? w.endDate : from;
  const days: string[] = [];
  for (let d = from; d <= to && days.length < WORK_LOCATION_MAX_DAYS; d = nextDay(d)) days.push(d);
  return days;
}

/** 그 날 하루짜리 초안 — 구간을 하루하루로 나눌 때 쓴다. */
export function workLocationForDay(w: WorkLocationDraft, iso: string): WorkLocationDraft {
  return { ...w, startDate: iso, endDate: iso };
}

/** 그 일정의 구간이 초안과 다른가 — PATCH에 `start`/`end`를 실을지 정한다. */
export function workLocationWhenChanged(
  ev: Pick<GoogleEvent, 'allDay' | 'startDate' | 'endDate' | 'startTime' | 'endTime'>,
  w: WorkLocationDraft,
): boolean {
  const n = workLocationWhen(w);
  return (
    n.allDay !== ev.allDay ||
    n.startDate !== ev.startDate ||
    n.endDate !== ev.endDate ||
    (n.startTime ?? '') !== (ev.startTime ?? '') ||
    (n.endTime ?? '') !== (ev.endTime ?? '')
  );
}

/**
 * `workingLocationProperties` — 갈래마다 이름이 들어가는 자리가 다르다.
 * 이름이 비면 그 하위 객체를 비워 보낸다(구글이 기본 표기를 쓴다).
 */
export function workLocationProps(w: WorkLocationDraft): Record<string, unknown> {
  const label = (w.label ?? '').trim().slice(0, 100);
  if (w.kind === 'homeOffice') return { type: 'homeOffice', homeOffice: {} };
  if (w.kind === 'officeLocation') return { type: 'officeLocation', officeLocation: label ? { label } : {} };
  return { type: 'customLocation', customLocation: label ? { label } : {} };
}

/**
 * 근무 위치 **일정 하나**의 본문(만들 때).
 *
 * 구글은 근무 위치를 `eventType: 'workingLocation'` 일정으로 든다 — 종일이면 **그
 * 하루**이고 끝이 배타적인 다음 날이며(`whenBody`의 그 규칙), `시간 추가`를 켜면
 * 하루 안의 시각 구간이다. 여러 날은 **일정 하나가 아니라 하루씩 여러 개**다
 * (`workLocationDays`). 제목은 구글의 클라이언트가 갈래로 지어 보여 주므로 우리가
 * 지어 넣지 않는다.
 *
 * `visibility: 'public'` · `transparency: 'transparent'`를 함께 보내는 이유:
 * 근무 위치는 "그 날의 상태"라 바쁨으로 잡히면 안 되고(회의실·한가함 조회에
 * 걸린다), 구글의 클라이언트도 그렇게 만든다. **기본 캘린더에만** 쓸 수 있다.
 */
export function workLocationEventBody(w: WorkLocationDraft): Record<string, unknown> {
  return {
    eventType: 'workingLocation',
    ...whenBody(workLocationWhen(w)),
    visibility: 'public',
    transparency: 'transparent',
    workingLocationProperties: workLocationProps(w),
    ...(w.repeat === 'weekly' ? { recurrence: [weeklyRule(w.startDate)] } : {}),
  };
}

/**
 * `RRULE:FREQ=WEEKLY;BYDAY=WE` — 그 날짜의 요일로 매주(끝 조건 없음).
 *
 * 요일을 규칙에 **명시하는** 이유: `DTSTART`가 정하는 요일에 맡기면 나중에 시작일만
 * 옮기는 PATCH에서 규칙과 실제 요일이 어긋날 수 있다.
 */
export function weeklyRule(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  const day = Number.isNaN(d.getTime()) ? 0 : d.getDay();
  return `RRULE:FREQ=WEEKLY;BYDAY=${['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][day]}`;
}

/** 그 날의 근무 위치 일정 — 없으면 `null`(있으면 고치거나 지운다). */
export function findWorkLocation(events: readonly GoogleEvent[], iso: string): GoogleEvent | null {
  return events.find((e) => !!e.workLocation && e.startDate <= iso && iso <= e.endDate) ?? null;
}

export async function createWorkLocationEvent(token: string, calendarId: string, w: WorkLocationDraft): Promise<void> {
  await send(`/calendars/${encodeURIComponent(calendarId)}/events`, token, 'POST', workLocationEventBody(w));
}

/**
 * 고치는 PATCH — **바뀐 것만** 보낸다(#552의 그 규칙).
 *
 * 갈래·이름만 바꿨으면 `workingLocationProperties` 하나뿐이고, 구간(날짜·시각)도
 * 바뀌었으면 `start`/`end` 짝이 함께 간다. `forPatch`가 쓰지 않는 쪽(`date`/
 * `dateTime`)을 `null`로 지우므로 종일 ↔ 시각 전환도 거절되지 않는다.
 */
export function workLocationPatch(w: WorkLocationDraft, whenChanged: boolean, addRepeat = false): GoogleEventPatch {
  const body: Record<string, unknown> = { workingLocationProperties: workLocationProps(w) };
  const touched: GoogleWriteField[] = ['workLocation'];
  if (whenChanged) {
    Object.assign(body, whenBody(workLocationWhen(w), true));
    touched.push('when');
  }
  // 하루짜리를 **매주로 바꿀 때만** 규칙을 싣는다(구글은 회차(instance)에 규칙을
  // 받지 않으므로, 이미 반복인 일정에는 부르는 쪽이 이 플래그를 세우지 않는다).
  if (addRepeat && w.repeat === 'weekly') body.recurrence = [weeklyRule(w.startDate)];
  return { body, touched };
}

/** 주최자 — 이름이 없으면 이메일만(구글이 이름을 모르는 계정도 있다). */
function parseOrganizer(raw: unknown): { organizer?: { email: string; name?: string; self?: true } } {
  const o = raw as Record<string, unknown> | undefined;
  const email = o && typeof o.email === 'string' ? o.email : '';
  if (!email) return {};
  return {
    organizer: {
      email,
      ...(typeof o?.displayName === 'string' && o.displayName ? { name: o.displayName } : {}),
      ...(o?.self === true ? { self: true as const } : {}),
    },
  };
}

/**
 * 알림 셋을 가른다: `useDefault`면 **캘린더 기본**(키 없음), 재정의가 비어 있으면
 * **없음**(`null`), 있으면 첫 팝업 알림의 분(`number`).
 */
function parseReminders(raw: unknown): { reminderMinutes?: number | null } {
  const r = raw as { useDefault?: unknown; overrides?: unknown } | undefined;
  if (!r || typeof r !== 'object') return {};
  if (r.useDefault === true) return {};
  const ov = Array.isArray(r.overrides) ? r.overrides : [];
  const first = ov.map((o) => (o as { minutes?: unknown }).minutes).find((m): m is number => typeof m === 'number');
  return { reminderMinutes: first ?? null };
}

export function parseEvents(json: unknown, cal: GoogleCalendarMeta): GoogleEvent[] {
  const items = (json as { items?: unknown })?.items;
  if (!Array.isArray(items)) return [];
  const out: GoogleEvent[] = [];
  for (const raw of items) {
    const it = raw as Record<string, unknown>;
    const id = typeof it.id === 'string' ? it.id : '';
    if (!id) continue;
    // 취소된 회차(반복 일정의 예외)는 그리지 않는다.
    if (it.status === 'cancelled') continue;
    const s = splitGoogleDateTime(it.start as { date?: string; dateTime?: string });
    const e = splitGoogleDateTime(it.end as { date?: string; dateTime?: string });
    if (!s) continue;
    const allDay = !s.time;
    const endDate = e ? (allDay ? prevDay(e.date) : e.date) : s.date;
    out.push({
      id: `${cal.id}::${id}`,
      eventId: id,
      calendarId: cal.id,
      calendarName: cal.summary,
      title: typeof it.summary === 'string' && it.summary ? it.summary : '(제목 없음)',
      startDate: s.date,
      endDate: endDate < s.date ? s.date : endDate,
      ...(s.time ? { startTime: s.time } : {}),
      ...(e?.time ? { endTime: e.time } : {}),
      allDay,
      ...(typeof it.location === 'string' && it.location ? { location: it.location } : {}),
      ...(typeof it.description === 'string' && it.description ? { description: it.description } : {}),
      ...(typeof it.htmlLink === 'string' ? { htmlLink: it.htmlLink } : {}),
      ...(cal.color ? { color: cal.color } : {}),
      ...(typeof it.colorId === 'string' && it.colorId ? { colorId: it.colorId } : {}),
      ...(cal.writable ? { writable: true } : {}),
      ...(typeof it.etag === 'string' ? { etag: it.etag } : {}),
      ...(typeof it.recurringEventId === 'string' ? { recurringEventId: it.recurringEventId } : {}),
      ...(it.eventType === 'workingLocation'
        ? { workLocation: workLocationLabel(it.workingLocationProperties), ...(workLocationKindOf(it.workingLocationProperties) ? { workLocationKind: workLocationKindOf(it.workingLocationProperties)! } : {}) }
        : {}),
      ...remembered(parseAttendees(it.attendees), parseOrganizer(it.organizer)),
      ...(it.visibility === 'public' || it.visibility === 'private' ? { visibility: it.visibility } : {}),
      ...(it.transparency === 'transparent' ? { transparency: 'transparent' as const } : {}),
      ...parseReminders(it.reminders),
      ...(typeof it.hangoutLink === 'string' && it.hangoutLink ? { meetLink: it.hangoutLink } : {}),
      ...(cal.holiday ? { holiday: true } : {}),
      ...(cal.holiday && isDayOffHoliday(typeof it.description === 'string' ? it.description : undefined) ? { dayOff: true } : {}),
    });
  }
  return out;
}

/**
 * 한 캘린더의 구간 일정. `singleEvents`로 반복 일정을 **회차로 펼쳐** 받는다 —
 * 규칙(RRULE)을 우리가 해석하지 않아도 되고, 화면에 놓을 날이 그대로 나온다.
 */
export async function fetchEvents(token: string, cal: GoogleCalendarMeta, from: string, to: string): Promise<GoogleEvent[]> {
  const json = await get(`/calendars/${encodeURIComponent(cal.id)}/events`, token, {
    timeMin: `${from}T00:00:00Z`,
    // 구간 끝날의 밤까지 — 시간대 차이로 하루가 잘려 보이지 않게 넉넉히 잡는다.
    timeMax: `${to}T23:59:59Z`,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '250',
    showDeleted: 'false',
  });
  return parseEvents(json, cal);
}

// ── 쓰기(PR6) ───────────────────────────────────────────────────────────────
//
// 만든 일정은 **구글에만** 남는다 — 우리 DB에 사본을 두지 않는다(위 머리말의 그
// 이유 그대로: 사본을 두면 두 곳의 진실이 갈린다). 그래서 저장이 끝나면 화면은
// 보이는 달을 다시 받아 **구글이 돌려준 것**을 그린다.

/** 화면이 만들거나 고치는 값 — 구글 스키마가 아니라 우리 말로 받는다. */
export interface GoogleEventDraft {
  title: string;
  allDay: boolean;
  /** 포함 구간(끝날까지) — 구글의 배타적 `end.date`는 아래에서 맞춘다. */
  startDate: string;
  endDate: string;
  startTime?: string;
  endTime?: string;
  location?: string;
  description?: string;
  /**
   * 아래 다섯은 **구글 일정에만** 뜻이 있다(디자인 원본도 `nIsGoogle`로 감싼다).
   * 초대 메일·알림·바쁨 표시는 **구글이 실제로 처리해 주는 것**이고, 우리 표에는
   * 그걸 보낼 장치가 없다 — 그래서 목적지가 구글일 때만 화면에 뜬다.
   */
  attendees?: string[];
  /** 예약할 회의실의 리소스 주소 — 본문에서는 참석자로 합쳐진다. */
  rooms?: string[];
  /** 참석자별 응답 — 배열을 다시 쓸 때 그대로 실어 남의 응답을 지키려고 든다. */
  rsvps?: Record<string, GoogleRsvp>;
  visibility?: GoogleVisibility;
  transparency?: GoogleTransparency;
  /** `null`=없음, 숫자=N분 전, 없으면 캘린더 기본 알림. */
  reminderMinutes?: number | null;
  /**
   * 그 일정에 지정한 **색 번호**(요청 — `colorId` 1~11). `null`이면 지정을 지운다
   * (그때는 캘린더 색으로 보인다). 값이 없으면 색을 건드리지 않는다.
   */
  colorId?: string | null;
  /** 반복 규칙(RRULE) — **만들 때만** 싣는다(회차 수정은 구글에서). */
  recurrence?: string[];
  /** Google Meet 링크를 함께 만들까 — 만들 때만. */
  addMeet?: boolean;
}

/** 반복 설정 — 디자인 원본의 `nRep*`(일/주/개월 × N마다 × 종료 없음/날짜/횟수). */
export interface RecurrenceSpec {
  on: boolean;
  unit: 'day' | 'week' | 'month';
  /** N마다 — 1 이상. */
  interval: number;
  endMode: 'none' | 'date' | 'count';
  until?: string;
  count?: number;
  /**
   * 사용자가 `맞춤` 칸을 골랐는가 — **화면 상태**다(RRULE에는 나가지 않는다).
   * `매주`와 "1주마다·종료 없음"은 같은 규칙이지만 고른 칸은 다르므로, 이 값이 없으면
   * 맞춤으로 정해 둔 상세 행이 다음 렌더에서 접힌다.
   */
  custom?: boolean;
}

export const RECURRENCE_OFF: RecurrenceSpec = { on: false, unit: 'week', interval: 1, endMode: 'none' };

/** 설정 → RRULE. 꺼져 있으면 `undefined`(구글에 아무것도 보내지 않는다). */
export function buildRecurrence(r: RecurrenceSpec): string[] | undefined {
  if (!r.on) return undefined;
  const freq = r.unit === 'day' ? 'DAILY' : r.unit === 'week' ? 'WEEKLY' : 'MONTHLY';
  const parts = [`FREQ=${freq}`];
  if (r.interval > 1) parts.push(`INTERVAL=${Math.floor(r.interval)}`);
  // UNTIL은 포함(그 날까지) — 종일이든 시각이든 그 날 끝까지로 잡는다.
  if (r.endMode === 'date' && r.until) parts.push(`UNTIL=${r.until.replace(/-/g, '')}T235959Z`);
  if (r.endMode === 'count' && r.count && r.count > 0) parts.push(`COUNT=${Math.floor(r.count)}`);
  return [`RRULE:${parts.join(';')}`];
}

const UNIT_LABEL: Record<RecurrenceSpec['unit'], string> = { day: '일', week: '주', month: '개월' };

/** 디자인 원본의 `nRepSummary` — 지금 설정을 한 줄로. */
export function recurrenceSummary(r: RecurrenceSpec): string {
  if (!r.on) return '반복하지 않아요';
  const every = `${r.interval > 1 ? `${r.interval}` : ''}${UNIT_LABEL[r.unit]}마다`;
  if (r.endMode === 'date' && r.until) return `${every} · ${r.until}까지`;
  if (r.endMode === 'count' && r.count) return `${every} · ${r.count}회 반복 후 종료`;
  return `${every} · 종료 없음`;
}

/** 이 브라우저의 시간대 — 시각 일정은 이걸 함께 보내야 구글이 같은 시각에 놓는다. */
function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * 우리가 구글에 쓰는 값의 갈래 — PATCH에 실은 것이 무엇인지(그래서 412 때 무엇을
 * 견줄지) 이 이름으로 말한다. `when`은 `start`/`end` 짝을 뜻한다.
 */
export type GoogleWriteField = 'when' | 'title' | 'location' | 'description' | 'attendees' | 'visibility' | 'transparency' | 'reminders' | 'meet' | 'color' | 'workLocation';

/**
 * 부분 수정 — **바뀐 것만** 담는다(PATCH의 결).
 *
 * 예전에는 무엇을 고쳤든 전체 본문을 보냈다. 그래서 제목 한 글자를 고쳐도 `start`가
 * 함께 실려, 구글이 그 시각을 거절하면(제보: `Invalid start time.`) **제목 수정이
 * 시각 때문에 막혔다**. 실은 것이 곧 바꿀 것이어야 원인과 결과가 맞는다.
 */
export interface GoogleEventPatch {
  body: Record<string, unknown>;
  touched: GoogleWriteField[];
}

/**
 * 언제인가 — `start`/`end`는 **짝으로만** 보낸다(구글은 종류가 섞이면 거절한다:
 * 하나는 `date`, 하나는 `dateTime`).
 *
 * @param forPatch PATCH에 실을 것인가 — 그렇다면 **쓰지 않는 쪽을 `null`로 지운다.**
 *
 * 이 `null`이 제보의 400을 만든 지점이다: 구글의 `patch`는 중첩 객체까지 **필드
 * 단위로 병합**하므로, 저장된 `start: { date }` 위에 `start: { dateTime }`을 보내면
 * 병합 결과가 `{ date, dateTime }` **둘 다 있는 상태**가 되어 거절된다
 * (`Invalid start time.`). 종일 ↔ 시각을 오갈 때마다 그렇다 — 그래서 보내지 않는
 * 쪽을 명시적으로 지운다(구글의 patch에서 `null`은 "이 필드를 비워라"다).
 * insert(POST)에는 지울 것이 없으므로 넣지 않는다.
 */
export function whenBody(
  d: Pick<GoogleEventDraft, 'allDay' | 'startDate' | 'endDate' | 'startTime' | 'endTime'>,
  forPatch = false,
): Record<string, unknown> {
  const tz = localTimeZone();
  // 종일이면 `dateTime`을, 시각이면 `date`를 지운다(PATCH일 때만).
  const clear = forPatch ? (d.allDay ? { dateTime: null } : { date: null }) : {};
  return d.allDay
    ? { start: { date: d.startDate, ...clear }, end: { date: nextDay(d.endDate), ...clear } }
    : {
        start: { dateTime: `${d.startDate}T${d.startTime || '00:00'}:00`, timeZone: tz, ...clear },
        end: { dateTime: `${d.endDate}T${d.endTime || d.startTime || '00:00'}:00`, timeZone: tz, ...clear },
      };
}

/**
 * 참석자 + 회의실 — 구글에서 회의실은 `resource: true`인 참석자다.
 *
 * **응답(`responseStatus`)을 함께 싣는다**: 구글의 PATCH는 이 배열을 통째로 바꾸므로
 * 이메일만 보내면 이미 "참석"을 누른 사람들이 전부 '미응답'으로 되돌아간다(한 명을
 * 더 초대하는 저장이 나머지의 응답을 지우는 셈이다).
 */
export function attendeesBody(d: Pick<GoogleEventDraft, 'attendees' | 'rooms' | 'rsvps'>): Array<Record<string, unknown>> {
  const rsvp = (email: string): Record<string, unknown> => {
    const st = d.rsvps?.[email];
    return st ? { responseStatus: st } : {};
  };
  return [
    ...(d.attendees ?? []).map((email) => ({ email, ...rsvp(email) })),
    ...(d.rooms ?? []).map((email) => ({ email, resource: true, ...rsvp(email) })),
  ];
}

/**
 * 그 일정이 차지하는 **구간**(요청 — 회의실이 그 시간에 비어 있는가). 구글에 물을
 * 때 쓰는 RFC3339 문자열이라 로컬 시각을 그대로 UTC로 옮긴다(`toISOString`).
 * 종일은 시작일 0시부터 **종료일 다음 0시**까지다(구글의 종일 규칙과 같은 경계).
 */
export function eventWindowIso(d: Pick<GoogleEventDraft, 'allDay' | 'startDate' | 'endDate' | 'startTime' | 'endTime'>): { fromIso: string; toIso: string } {
  const at = (iso: string, hhmm: string, plusDay = 0): Date => {
    const [y, m, dd] = iso.split('-').map(Number);
    const [h, mi] = hhmm.split(':').map(Number);
    return new Date(y ?? 1970, (m ?? 1) - 1, (dd ?? 1) + plusDay, h ?? 0, mi ?? 0);
  };
  const end = d.endDate < d.startDate ? d.startDate : d.endDate;
  if (d.allDay) return { fromIso: at(d.startDate, '00:00').toISOString(), toIso: at(end, '00:00', 1).toISOString() };
  const from = at(d.startDate, d.startTime || '00:00');
  const to = at(d.startDate, d.endTime || d.startTime || '00:00');
  // 종료가 시작보다 앞서면(입력 중일 수 있다) 최소 한 구간으로 본다.
  return { fromIso: from.toISOString(), toIso: (to > from ? to : new Date(from.getTime() + 30 * 60_000)).toISOString() };
}

/** 알림 — `undefined`는 캘린더 기본, `null`은 없음, 숫자는 N분 전(세 상태). */
export function remindersBody(minutes: number | null | undefined): Record<string, unknown> {
  return minutes === undefined ? { useDefault: true } : { useDefault: false, overrides: minutes === null ? [] : [{ method: 'popup', minutes }] };
}

/**
 * Google Meet — 켜면 **만들어 달라고 요청**하고(구글이 링크를 만든다), 끄면 `null`로
 * **회의를 뗀다**(제보 ④: 이미 있는 일정에서도 Meet를 켜고 끌 수 있어야 한다).
 * 이 필드를 실은 요청에는 `conferenceDataVersion=1`이 있어야 구글이 받아 준다.
 */
export function conferenceBody(on: boolean): Record<string, unknown> | null {
  return on ? { createRequest: { requestId: `mf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` } } : null;
}

export function draftToBody(d: GoogleEventDraft): Record<string, unknown> {
  return {
    summary: d.title,
    ...whenBody(d),
    // 빈 값은 **빈 문자열로 보낸다** — 키를 빼면 구글은 "안 바꾼다"로 읽어서,
    // 위치나 메모를 지운 것이 저장되지 않는다(PATCH의 결).
    location: d.location ?? '',
    description: d.description ?? '',
    // 같은 이유로 참석자도 **빈 배열까지** 보낸다(전원 초대 취소가 저장되게).
    attendees: attendeesBody(d),
    visibility: d.visibility ?? 'default',
    transparency: d.transparency ?? 'opaque',
    reminders: remindersBody(d.reminderMinutes),
    ...(d.colorId ? { colorId: d.colorId } : {}),
    ...(d.recurrence ? { recurrence: d.recurrence } : {}),
    ...(d.addMeet ? { conferenceData: conferenceBody(true) } : {}),
  };
}

async function send(path: string, token: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown, etag?: string): Promise<unknown> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      // 내가 본 판이 최신일 때만 쓴다 — 그 사이 구글에서 바뀌었으면 412로 막힌다.
      ...(etag ? { 'If-Match': etag } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const err = new Error(`google ${res.status}`) as Error & { status?: number; detail?: string };
    err.status = res.status;
    // **구글이 왜 거절했는지 그대로 들고 온다** — 400은 우리 요청이 틀렸다는 뜻이고,
    // 그 문장이 유일한 단서다(제보의 `Invalid start time.`이 그것이었다). 화면은
    // 이 문장을 함께 보여 주고, 콘솔에는 보낸 본문까지 남긴다.
    try {
      const j = (await res.json()) as { error?: { message?: unknown } };
      if (typeof j?.error?.message === 'string') err.detail = j.error.message;
    } catch {
      /* 본문이 없거나 JSON이 아니면 상태 코드만으로 말한다 */
    }
    if (res.status === 400) console.warn('[geurio] 구글이 요청을 거절했어요:', err.detail ?? '(사유 없음)', body);
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

export async function createGoogleEvent(token: string, calendarId: string, draft: GoogleEventDraft): Promise<void> {
  // Meet 링크를 요청할 때는 `conferenceDataVersion=1`이 있어야 구글이 만들어 준다.
  const qs = draft.addMeet ? '?conferenceDataVersion=1' : '';
  await send(`/calendars/${encodeURIComponent(calendarId)}/events${qs}`, token, 'POST', draftToBody(draft));
}

/**
 * 하나를 고친다. **반복 일정이면 이 회차만** 바뀐다 — `singleEvents`로 펼쳐 받은
 * 회차 id에 그대로 쓰기 때문이다. 반복 규칙 자체를 바꾸는 일은 구글에 맡긴다
 * (그 UI를 우리가 다시 만들 이유가 없고, 잘못 만들면 남의 달력을 망가뜨린다).
 */
export async function updateGoogleEvent(token: string, ev: GoogleEvent, patch: GoogleEventPatch): Promise<void> {
  // Meet를 켜거나 끄는 요청에는 `conferenceDataVersion=1`이 있어야 한다(만들 때와 같다).
  const qs = 'conferenceData' in patch.body ? '?conferenceDataVersion=1' : '';
  const path = `/calendars/${encodeURIComponent(ev.calendarId)}/events/${encodeURIComponent(ev.eventId)}${qs}`;
  if (Object.keys(patch.body).length === 0) return;
  try {
    await send(path, token, 'PATCH', patch.body, ev.etag);
    return;
  } catch (e) {
    if ((e as { status?: number }).status !== 412) throw e;
  }
  // 412 = "내가 본 판이 최신이 아니다". **그런데 대개는 사람이 고친 게 아니다**(제보):
  // 회의실을 예약하면 그 리소스가 스스로 초대를 수락하고, 알림·참석자 응답 같은
  // 곁가지도 구글이 서버에서 바꾼다 — 그때마다 판(etag)이 올라간다. 그래서 저장 직후
  // 다시 받아 둔 판조차 곧 낡고, 다음 수정이 통째로 막혔다.
  //
  // 그러니 **무엇이 달라졌는지 보고** 정한다: 우리가 다루는 값이 그대로면(응답 상태만
  // 바뀐 것) 새 판을 기준으로 한 번 더 쓰고, 사람이 제목·시각 같은 것을 고쳤으면
  // 덮지 않고 그대로 막는다(그게 If-Match를 쓰는 이유다).
  const fresh = await fetchGoogleEvent(token, ev);
  if (!fresh || managedFieldsDiffer(ev, fresh, patch.touched)) {
    const err = new Error('google 412') as Error & { status?: number };
    err.status = 412;
    throw err;
  }
  await send(path, token, 'PATCH', patch.body, fresh.etag);
}

/** 그 일정 하나를 다시 받는다 — 412를 만났을 때 무엇이 달라졌는지 보려고. */
export async function fetchGoogleEvent(token: string, ev: GoogleEvent): Promise<GoogleEvent | null> {
  const cal: GoogleCalendarMeta = { id: ev.calendarId, summary: ev.calendarName, ...(ev.color ? { color: ev.color } : {}), ...(ev.writable ? { writable: true } : {}) };
  try {
    const json = await get(`/calendars/${encodeURIComponent(ev.calendarId)}/events/${encodeURIComponent(ev.eventId)}`, token, {});
    // 한 건은 목록이 아니다 — 같은 파서를 쓰려고 목록 모양으로 감싼다.
    return parseEvents({ items: [json] }, cal)[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * 두 판 사이에 **우리가 쓰려는 값**이 달라졌는가 — `only`가 그 범위다.
 *
 * 범위를 좁히는 것이 이 함수의 핵심이다(제보): 제목만 고치는 저장이 "그 사이 날짜가
 * 바뀌었다"는 이유로 막히면, 사용자는 되돌릴 길 없이 갇힌다. 우리가 보내지도 않는
 * 필드는 충돌이 아니다 — PATCH는 보낸 키만 바꾸므로 남의 변경을 덮지도 않는다.
 */
export function managedFieldsDiffer(a: GoogleEvent, b: GoogleEvent, only?: readonly GoogleWriteField[]): boolean {
  const of = (e: GoogleEvent): Record<GoogleWriteField, unknown> => ({
    title: e.title,
    when: [e.startDate, e.endDate, e.startTime ?? null, e.endTime ?? null, e.allDay],
    meet: !!e.meetLink,
    location: e.location ?? '',
    description: e.description ?? '',
    // 응답까지 본다 — 팝업이 열려 있는 동안 누군가 "참석"을 눌렀다면, 우리가 든
    // 낡은 배열로 그 응답을 덮어쓸 수 있다(그때는 덮지 않고 막는 편이 맞다).
    attendees: [[...(e.attendees ?? [])].sort(), [...(e.rooms ?? [])].sort(), Object.entries(e.rsvps ?? {}).sort()],
    visibility: e.visibility ?? 'default',
    transparency: e.transparency ?? 'opaque',
    reminders: e.reminderMinutes ?? 'default',
    color: e.colorId ?? 'default',
    workLocation: [e.workLocationKind ?? '', e.workLocation ?? ''],
  });
  const x = of(a);
  const y = of(b);
  const fields = only ?? (Object.keys(x) as GoogleWriteField[]);
  return fields.some((f) => JSON.stringify(x[f]) !== JSON.stringify(y[f]));
}

export async function deleteGoogleEvent(token: string, ev: GoogleEvent): Promise<void> {
  await send(`/calendars/${encodeURIComponent(ev.calendarId)}/events/${encodeURIComponent(ev.eventId)}`, token, 'DELETE');
}

/** 구글이 돌려준 상태 코드 → 사람이 읽을 문장. */
export function googleWriteError(e: unknown): string {
  const status = (e as { status?: number }).status;
  // 412는 이제 **내가 쓰려던 그 값**이 그 사이 바뀐 경우만 온다(범위를 좁혔다) —
  // 그러니 "다시 시도"가 아니라 새로 받은 값을 보라고 말한다.
  if (status === 412) return '그 사이 구글에서 이 값이 바뀌었어요. 팝업을 닫고 다시 열어 확인해 주세요.';
  if (status === 403) return '이 캘린더에 쓸 권한이 없어요.';
  if (status === 404) return '구글에서 이미 사라진 일정이에요.';
  if (status === 401) return '구글 권한이 만료됐어요. 설정에서 다시 연결해 주세요.';
  // 400은 **우리 요청이 틀렸다**는 뜻이라 "잠시 후 다시"가 거짓말이 된다 — 구글이
  // 준 사유를 그대로 보여 준다(사용자에게도, 제보를 받는 우리에게도 유일한 단서다).
  const detail = (e as { detail?: string }).detail;
  if (status === 400) return detail ? `구글이 이 요청을 거절했어요: ${detail}` : '구글이 이 요청을 거절했어요.';
  return '구글에 저장하지 못했어요. 잠시 후 다시 시도해 주세요.';
}

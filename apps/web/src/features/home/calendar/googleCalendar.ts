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
 * **토큰은 이 탭에만 산다.** 브라우저 흐름에는 refresh token이 없고 액세스 토큰은
 * 한 시간짜리다. `sessionStorage`에 두는 이유는 localStorage와 달리 **탭을 닫으면
 * 사라지기** 때문이다(유출 표면이 작다). 만료되면 `prompt: ''`로 조용히 다시
 * 받는다 — 구글 세션이 살아 있으면 사용자는 아무것도 보지 못한다.
 *
 * ## 배포 전 필요한 것(코드 밖)
 *
 * `calendar.readonly`는 구글이 **민감(sensitive) 스코프**로 분류한다 — 콘솔의 동의
 * 화면에 스코프를 추가하고 **앱 검수**를 받아야 일반 사용자에게 열린다(검수 전에는
 * 테스트 사용자 100명까지+ "확인되지 않은 앱" 경고). 절차는 `backend.md` §19.
 * 그 전까지 이 기능은 **꺼진 채**이고, 앱은 아무것도 달라지지 않는다.
 */

import { loadGisScript, readGoogleClientId } from '../../auth/googleIdentity';

/**
 * 이 앱이 구글에 요구하는 전부 — **딱 두 가지**다.
 *
 * - `calendar.events` 일정 읽기·쓰기. 그리오에서 만들고 고치려면 필요하다(PR6).
 * - `calendar.calendarlist.readonly` "어느 캘린더를 겹칠까"를 고르게 하는 목록.
 *   `calendar.events`는 일정만 주고 캘린더 **목록**은 주지 않는다.
 *
 * 전체 권한(`calendar`)을 받지 않은 이유: 캘린더 자체를 만들거나 지우지 않으므로
 * 요구할 근거가 없다 — 검수도 스코프마다 "왜 필요한가"를 묻는다.
 */
export const GOOGLE_CALENDAR_SCOPES = ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.calendarlist.readonly'];
export const GOOGLE_CALENDAR_SCOPE = GOOGLE_CALENDAR_SCOPES.join(' ');

/**
 * 받아 둔 토큰이 지금 필요한 권한을 **다 담고 있는가.** 스코프를 넓힌 뒤에도 옛
 * 토큰이 남아 있으면 쓰기 요청만 403으로 죽는다 — 그럴 바엔 없는 것으로 보고
 * 다시 받게 한다(사용자에겐 "다시 연결" 한 번).
 */
export function scopeCovers(granted: string | undefined): boolean {
  if (!granted) return false;
  const have = new Set(granted.split(/\s+/).filter(Boolean));
  return GOOGLE_CALENDAR_SCOPES.every((s) => have.has(s));
}

/** 토큰을 담아 두는 자리 — 탭이 닫히면 사라진다(위 주석의 이유). */
const TOKEN_KEY = 'mf_gcal_token';

const API = 'https://www.googleapis.com/calendar/v3';

/** GIS `accounts.oauth2` 중 이 앱이 건드리는 것만. */
export interface GsiTokenApi {
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
  color?: string;
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
}

// ── 토큰 ────────────────────────────────────────────────────────────────────

/** 만료 60초 전부터는 만료로 본다 — 요청 도중에 죽는 토큰을 쓰지 않는다. */
const SKEW_MS = 60_000;

export function readStoredToken(now = Date.now()): GoogleToken | null {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY);
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

export function storeToken(t: GoogleToken | null): void {
  try {
    if (t) sessionStorage.setItem(TOKEN_KEY, JSON.stringify(t));
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* 사생활 보호 모드 등 — 저장 못 해도 이번 탭은 메모리로 굴러간다 */
  }
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

export type TokenRequestResult = { token: GoogleToken } | { error: string };

/**
 * 액세스 토큰을 받는다.
 *
 * @param interactive 동의 창을 띄워도 되는가. 사용자가 **직접 누른** 연결에서만
 *   true다 — 화면을 여는 것만으로 팝업이 뜨면 안 된다(그리고 브라우저가 막는다).
 */
export async function requestGoogleToken(interactive: boolean, hint?: string): Promise<TokenRequestResult> {
  const clientId = readGoogleClientId();
  if (!clientId) return { error: '구글 연동이 설정되지 않았어요.' };
  const api = await loadGoogleTokenApi();
  if (!api) return { error: '구글에 연결하지 못했어요. 네트워크나 차단 확장을 확인해 주세요.' };

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
        // 조용한 갱신은 `''`(이미 승인했으면 창 없이 준다), 첫 연결은 계정 선택.
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
          done({ error: res.error_description || res.error || '구글 권한을 받지 못했어요.' });
        },
        error_callback: (err) => done({ error: err.message || err.type || '구글 권한을 받지 못했어요.' }),
      });
      client.requestAccessToken();
    } catch {
      done({ error: '구글에 연결하지 못했어요.' });
    }
  });
}

/** 저장된 토큰이 살아 있으면 그대로, 아니면 **조용히** 다시 받는다. */
export async function ensureGoogleToken(hint?: string): Promise<TokenRequestResult> {
  const stored = readStoredToken();
  if (stored) return { token: stored };
  return requestGoogleToken(false, hint);
}

/** 연결 해제 — 이 기기의 토큰을 버리고 구글 쪽 승인도 취소한다. */
export async function revokeGoogleToken(): Promise<void> {
  const stored = readStoredToken();
  storeToken(null);
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
      ...(cal.writable ? { writable: true } : {}),
      ...(typeof it.etag === 'string' ? { etag: it.etag } : {}),
      ...(typeof it.recurringEventId === 'string' ? { recurringEventId: it.recurringEventId } : {}),
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
}

/** 이 브라우저의 시간대 — 시각 일정은 이걸 함께 보내야 구글이 같은 시각에 놓는다. */
function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function draftToBody(d: GoogleEventDraft): Record<string, unknown> {
  const tz = localTimeZone();
  const when = d.allDay
    ? { start: { date: d.startDate }, end: { date: nextDay(d.endDate) } }
    : {
        start: { dateTime: `${d.startDate}T${d.startTime || '00:00'}:00`, timeZone: tz },
        end: { dateTime: `${d.endDate}T${d.endTime || d.startTime || '00:00'}:00`, timeZone: tz },
      };
  return {
    summary: d.title,
    ...when,
    // 빈 값은 **빈 문자열로 보낸다** — 키를 빼면 구글은 "안 바꾼다"로 읽어서,
    // 위치나 메모를 지운 것이 저장되지 않는다(PATCH의 결).
    location: d.location ?? '',
    description: d.description ?? '',
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
    const err = new Error(`google ${res.status}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

export async function createGoogleEvent(token: string, calendarId: string, draft: GoogleEventDraft): Promise<void> {
  await send(`/calendars/${encodeURIComponent(calendarId)}/events`, token, 'POST', draftToBody(draft));
}

/**
 * 하나를 고친다. **반복 일정이면 이 회차만** 바뀐다 — `singleEvents`로 펼쳐 받은
 * 회차 id에 그대로 쓰기 때문이다. 반복 규칙 자체를 바꾸는 일은 구글에 맡긴다
 * (그 UI를 우리가 다시 만들 이유가 없고, 잘못 만들면 남의 달력을 망가뜨린다).
 */
export async function updateGoogleEvent(token: string, ev: GoogleEvent, draft: GoogleEventDraft): Promise<void> {
  await send(`/calendars/${encodeURIComponent(ev.calendarId)}/events/${encodeURIComponent(ev.eventId)}`, token, 'PATCH', draftToBody(draft), ev.etag);
}

export async function deleteGoogleEvent(token: string, ev: GoogleEvent): Promise<void> {
  await send(`/calendars/${encodeURIComponent(ev.calendarId)}/events/${encodeURIComponent(ev.eventId)}`, token, 'DELETE');
}

/** 구글이 돌려준 상태 코드 → 사람이 읽을 문장. */
export function googleWriteError(e: unknown): string {
  const status = (e as { status?: number }).status;
  if (status === 412) return '그 사이 구글에서 바뀌었어요. 새로 받은 내용을 보고 다시 시도해 주세요.';
  if (status === 403) return '이 캘린더에 쓸 권한이 없어요.';
  if (status === 404) return '구글에서 이미 사라진 일정이에요.';
  if (status === 401) return '구글 권한이 만료됐어요. 설정에서 다시 연결해 주세요.';
  return '구글에 저장하지 못했어요. 잠시 후 다시 시도해 주세요.';
}

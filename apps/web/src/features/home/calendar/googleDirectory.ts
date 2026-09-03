import { rememberName } from './nameBook';

// 참석자 이름 검색 · 회의실 목록 — 캘린더 API **밖**의 두 API를 부른다.
//
// ## 왜 다른 API인가
//
// 캘린더 API는 일정만 안다. "이 조직에 누가 있나"는 **People API**, "회의실이
// 무엇이 있나"는 **Admin SDK Directory**다. Notion 캘린더가 이름 검색과 회의실을
// 보여 주는 것도 이 둘을 함께 받기 때문이다(스코프를 더 받는 것뿐이다).
//
// ## 없을 수도 있다는 전제로 만든다
//
// - 개인 구글 계정에는 **조직 디렉터리가 없다**(빈 결과).
// - 회의실 스코프(`admin.directory.*`)는 조직 설정에 따라 **관리자 동의**를 요구할
//   수 있고, 그때 이 요청은 403이다.
//
// 그래서 두 함수 모두 **실패를 값으로** 돌려준다(`null`) — 호출부는 그 기능만 접고
// 이메일 직접 입력으로 돌아간다. 연동 자체가 막히지 않는다.

const PEOPLE = 'https://people.googleapis.com/v1';
const ADMIN = 'https://admin.googleapis.com/admin/directory/v1';

/** 참석자 후보 한 명. */
export interface DirectoryPerson {
  /** 기본(primary) 주소 — 화면에 보이는 값. */
  email: string;
  name: string;
  /**
   * 그 사람의 **모든** 주소(별칭 포함, 소문자). 디렉터리는 `johan@mail.example.com`으로
   * 물어도 기본 주소 `johan@example.com`으로 답하므로, 질의와 맞춰 볼 때는 이 목록을
   * 봐야 한다(제보 — 별칭으로 초대된 사람이 영영 로컬파트로 남았다).
   */
  emails: string[];
}

/** 회의실 하나 — 구글에는 `resourceEmail`이 곧 참석자 주소다. */
export interface MeetingRoom {
  email: string;
  name: string;
  /** 건물·층 등 — 같은 이름의 회의실을 가르는 데 쓴다. */
  where?: string;
  /** 정원(있으면). */
  capacity?: number;
}

async function get(url: string, token: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    // 403은 "그 스코프를 못 받았다/관리자 동의가 필요하다" — 조용히 접는다.
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

function personsFrom(raw: unknown, key: 'people' | 'results'): DirectoryPerson[] {
  const list = (raw as Record<string, unknown> | null)?.[key];
  if (!Array.isArray(list)) return [];
  const out: DirectoryPerson[] = [];
  for (const item of list) {
    // otherContacts:search는 `{ person: {...} }`로 한 겹 감싼다.
    const p = (key === 'results' ? (item as { person?: unknown }).person : item) as Record<string, unknown> | undefined;
    if (!p) continue;
    const raws = Array.isArray(p.emailAddresses) ? (p.emailAddresses as { value?: unknown; metadata?: { primary?: unknown } }[]) : [];
    const all = raws.map((e) => e.value).filter((v): v is string => typeof v === 'string' && !!v);
    if (all.length === 0) continue;
    // 기본 주소가 먼저 — 구글은 `metadata.primary`로 표시한다(없으면 첫 것).
    const primary = raws.find((e) => e.metadata?.primary === true && typeof e.value === 'string')?.value as string | undefined;
    const email = (primary ?? all[0]!).toLowerCase();
    const emails = [...new Set(all.map((v) => v.toLowerCase()))];
    const names = Array.isArray(p.names) ? p.names : [];
    const name = names.map((n) => (n as { displayName?: unknown }).displayName).find((v): v is string => typeof v === 'string' && !!v);
    // 디렉터리가 알려 준 이름은 **모든 주소**로 장부에 적는다 — 별칭으로 초대된 자리에서도
    // 같은 사람이 같은 이름으로 보이게(`nameBook`).
    if (name) for (const e of emails) rememberName(e, name);
    out.push({ email, name: name ?? email, emails });
  }
  return out;
}

/**
 * 이름·이메일로 사람을 찾는다 — 조직 디렉터리와 **주고받은 적 있는 사람**을 함께 본다
 * (개인 계정에는 디렉터리가 없으므로 후자가 사실상 유일한 원천이다).
 *
 * 못 찾는 것과 **못 물어보는 것**을 가른다: 둘 다 실패하면 `null`(기능을 접는다),
 * 하나라도 응답했으면 배열이다(빈 배열 = 정말 결과가 없다).
 */
export async function searchPeople(token: string, query: string, opts: { directory: boolean; otherContacts: boolean }): Promise<DirectoryPerson[] | null> {
  const q = query.trim();
  if (!q) return [];
  const readMask = 'names,emailAddresses';
  const calls: Promise<{ ok: boolean; list: DirectoryPerson[] }>[] = [];
  if (opts.directory) {
    const url =
      `${PEOPLE}/people:searchDirectoryPeople?query=${encodeURIComponent(q)}&readMask=${readMask}&pageSize=10` +
      '&sources=DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE&sources=DIRECTORY_SOURCE_TYPE_DOMAIN_CONTACT';
    calls.push(get(url, token).then((r) => ({ ok: r !== null, list: personsFrom(r, 'people') })));
  }
  if (opts.otherContacts) {
    const url = `${PEOPLE}/otherContacts:search?query=${encodeURIComponent(q)}&readMask=${readMask}&pageSize=10`;
    calls.push(get(url, token).then((r) => ({ ok: r !== null, list: personsFrom(r, 'results') })));
  }
  if (calls.length === 0) return null;
  const done = await Promise.all(calls);
  if (!done.some((d) => d.ok)) return null;
  // 같은 사람이 두 원천에 있으면 하나로 — 디렉터리 쪽 이름을 우선한다(먼저 온다).
  const seen = new Set<string>();
  const merged: DirectoryPerson[] = [];
  for (const d of done) {
    for (const p of d.list) {
      if (seen.has(p.email)) continue;
      seen.add(p.email);
      merged.push(p);
    }
  }
  return merged.slice(0, 12);
}

/**
 * 조직의 회의실 — Admin SDK. 관리자 동의가 필요한 조직에서는 403이므로 `null`이고,
 * 그때 화면은 회의실 구획을 **그리지 않는다**.
 */
export async function fetchRooms(token: string): Promise<MeetingRoom[] | null> {
  const raw = await get(`${ADMIN}/customer/my_customer/resources/calendars?maxResults=500`, token);
  if (raw === null) return null;
  const items = (raw as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  const out: MeetingRoom[] = [];
  for (const it of items as Record<string, unknown>[]) {
    const email = typeof it.resourceEmail === 'string' ? it.resourceEmail : '';
    if (!email) continue;
    // 회의실만 — 프로젝터·차량 같은 다른 리소스는 일정에 넣을 자리가 아니다.
    const category = typeof it.resourceCategory === 'string' ? it.resourceCategory : '';
    if (category && category !== 'CONFERENCE_ROOM') continue;
    const name = typeof it.generatedResourceName === 'string' && it.generatedResourceName ? it.generatedResourceName : typeof it.resourceName === 'string' ? it.resourceName : email;
    const where = typeof it.buildingId === 'string' && it.buildingId ? it.buildingId : typeof it.floorName === 'string' ? it.floorName : undefined;
    const capacity = typeof it.capacity === 'number' ? it.capacity : undefined;
    out.push({ email: email.toLowerCase(), name, ...(where ? { where } : {}), ...(capacity ? { capacity } : {}) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}

/** 검색어로 회의실 걸러 내기 — 목록은 한 번 받아 두고 화면에서 좁힌다(왕복 0). */
export function filterRooms(rooms: readonly MeetingRoom[], query: string): MeetingRoom[] {
  const q = query.trim().toLowerCase();
  if (!q) return rooms.slice(0, 12);
  return rooms.filter((r) => r.name.toLowerCase().includes(q) || (r.where ?? '').toLowerCase().includes(q)).slice(0, 12);
}

/**
 * 그 구간에 회의실을 잡고 있는 일정 — 조직이 회의실 캘린더를 **공개한 만큼만** 온다.
 *
 * 회의실 캘린더를 "한가함/바쁨만"으로 공개해 두면 제목·주최자가 없이 시각만 오고,
 * 그때는 화면도 시각만 말한다(없는 것을 지어내지 않는다).
 */
export interface RoomBusy {
  busy: boolean;
  /** 잡은 사람 — 주최자 이름(없으면 주소). */
  by?: string;
  /** 그 일정의 제목. */
  title?: string;
  /** 로컬 `HH:MM` — 종일 일정이면 없다. */
  from?: string;
  to?: string;
}

/**
 * 이 시간대에 그 회의실이 **비어 있는가, 아니면 누가 쓰고 있는가**(요청) — 구글
 * 캘린더는 달력에 겹쳐 보여
 * 주지만 우리는 팝업이라 그럴 자리가 없다. 그래서 **회의실 행 자체가** 말한다.
 *
 * ## 왜 `events.list`인가(freebusy가 아니라)
 * 구글의 `freeBusy.query`는 스코프가 따로다(`calendar.freebusy` 계열). 지금 승인된
 * 스코프로는 못 부르고, 스코프를 늘리려면 동의 화면을 고쳐 **검수를 다시 받아야**
 * 한다. 회의실도 결국 캘린더이므로, 이미 있는 `calendar.events`로 그 캘린더의
 * 일정을 **그 구간만** 물어보면 같은 답을 얻는다.
 *
 * ## 모르는 것은 칠하지 않는다
 * 조직이 회의실 캘린더를 "한가함/바쁨만" 또는 아무것도 공개하지 않게 두면 403·404가
 * 온다. 그때는 `null`이고 화면은 배지를 그리지 않는다 — "사용 가능"이라 잘못 말하는
 * 것보다 아무 말도 안 하는 편이 낫다.
 *
 * @param skipEventId 지금 고치고 있는 일정 — 그 일정이 이미 잡아 둔 회의실을
 *   "사용 중"이라 말하면 자기 자신과 부딪힌다고 하는 셈이다.
 */
export async function checkRoom(token: string, roomEmail: string, fromIso: string, toIso: string, skipEventId?: string): Promise<RoomBusy | null> {
  const q = new URLSearchParams({ timeMin: fromIso, timeMax: toIso, singleEvents: 'true', maxResults: '5', showDeleted: 'false' });
  const json = await get(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(roomEmail)}/events?${q.toString()}`, token);
  if (json === null) return null;
  const items = (json as { items?: unknown }).items;
  if (!Array.isArray(items)) return null;
  const hit = items.find((raw) => {
    const it = raw as Record<string, unknown>;
    if (it.status === 'cancelled') return false;
    // 회의실이 스스로 거절한 초대는 그 방을 쓰지 않는다는 뜻이다.
    const me = Array.isArray(it.attendees) ? (it.attendees as Record<string, unknown>[]).find((a) => a.email === roomEmail) : undefined;
    if (me?.responseStatus === 'declined') return false;
    if (skipEventId && (it.id === skipEventId || it.recurringEventId === skipEventId)) return false;
    return true;
  }) as Record<string, unknown> | undefined;
  if (!hit) return { busy: false };
  const org = hit.organizer as { displayName?: string; email?: string } | undefined;
  const by = org?.displayName || org?.email;
  const title = typeof hit.summary === 'string' ? hit.summary : undefined;
  return {
    busy: true,
    ...(by ? { by } : {}),
    ...(title ? { title } : {}),
    ...(hhmm(hit.start) ? { from: hhmm(hit.start)! } : {}),
    ...(hhmm(hit.end) ? { to: hhmm(hit.end)! } : {}),
  };
}

/** 구글의 `start`/`end`에서 로컬 `HH:MM` — 종일이면 시각이 없다(`undefined`). */
function hhmm(raw: unknown): string | undefined {
  const dt = (raw as { dateTime?: unknown } | undefined)?.dateTime;
  if (typeof dt !== 'string') return undefined;
  const d = new Date(dt);
  if (Number.isNaN(d.getTime())) return undefined;
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

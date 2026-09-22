// 잡아 둔 회의실이 **예약을 거절한 일정**의 기록 — 알림 센터에 쌓인다(요청).
//
// ## 왜 알림 센터인가
//
// 처음 판은 만든 직후 **토스트** + 상세 팝업 **경고**로 말했다. 둘 다 "그 자리에
// 있어야만" 보이는 말이라 놓치면 끝이었다 — 토스트는 몇 초 뒤 사라지고, 경고는 그
// 일정을 다시 열어야 나온다. 그래서 요청대로 둘을 걷어내고 **남는 자리**로 옮겼다.
// 달력 칩(⚠)은 그대로다 — 그쪽은 "어느 일정인가"를 가리키는 표지이고, 여기는
// "무슨 일이 있었나"의 기록이다.
//
// ## 왜 이 기기(localStorage)인가
//
// `reminderInbox`와 같은 이유다: 우편함(0022 `notifications`)은 **DB 트리거만**
// 채우고(클라이언트 insert를 열면 아무나 남의 우편함에 가짜 알림을 꽂을 수 있다),
// 캘린더 데이터는 개인정보처리방침대로 서버에 쌓지 않는다(§4·§6). 그래서 기록도
// 이 기기에 두고 우편함 목록이 서버 것과 여기 것을 합쳐 보여 준다.
//
// ## 언제 적재하나
//
// 만든 직후 한 번이 아니라 **일정 목록을 받는 그 자리**다(`useGoogleCalendar`).
// 회의실 캘린더의 자동 거절은 만든 응답에 이미 실려 오는 일이 많지만 늘 그렇지는
// 않고(그때는 `needsAction`으로 왔다가 잠시 뒤 거절이 된다), 무엇보다 **남이 잡아
// 둔 방이 나중에 거절**되는 일도 있다. 목록은 60초마다 다시 오므로(`useLiveRefresh`)
// 그 자리에 두면 두 경우가 한 길로 잡힌다.

import type { AppNotification } from '../../../adapters/ports';
import { todayISO } from './model';
import { declinedRooms, type GoogleEvent } from './googleCalendar';
import { knownName } from './nameBook';

const KEY = 'mf_room_conflict_inbox';
/** 우편함에 남기는 개수 — 목록은 한 화면이라 더 쌓아 둘 이유가 없다. */
const MAX = 30;
/** 나이 상한 — 지난 기록은 정보가 아니라 목록의 길이가 된다. */
const TTL_MS = 14 * 24 * 60 * 60_000;

interface Stored {
  /** `일정id@날짜` — 반복 일정은 **회차마다** 따로 센다(거절도 회차마다 따로다). */
  id: string;
  /** 일정 제목(스냅샷) — 목록의 칩이 이 값을 쓴다. */
  title: string;
  /** 거절한 회의실들을 사람이 읽을 한 마디로. */
  rooms: string;
  date: string;
  eventId: string;
  /** 처음 알아챈 시각(ISO). */
  at: string;
  read: boolean;
}

type Listener = () => void;
const listeners = new Set<Listener>();

function read(): Stored[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed.filter((n): n is Stored => {
      if (!n || typeof n !== 'object') return false;
      const v = n as Partial<Stored>;
      if (typeof v.id !== 'string' || typeof v.title !== 'string' || typeof v.at !== 'string') return false;
      const t = Date.parse(v.at);
      return Number.isFinite(t) && now - t < TTL_MS;
    });
  } catch {
    return [];
  }
}

function write(list: Stored[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    /* 쿼터 초과 — 기록이 달력을 방해하면 안 된다(칩은 이미 서 있다) */
  }
  listeners.forEach((fn) => fn());
}

/** 그 회차의 열쇠 — 반복 일정은 회차마다 다른 날에 서고 거절도 회차마다 따로다. */
function keyOf(ev: Pick<GoogleEvent, 'eventId' | 'startDate'>): string {
  return `${ev.eventId}@${ev.startDate}`;
}

/**
 * 거절한 회의실들을 한 마디로 — 이름을 아는 방은 이름으로(구글이 실어 준 표시
 * 이름·디렉터리에서 기억한 이름), 모르면 주소 앞부분이다. 셋 이상이면 꼬리를 접는다
 * (알림 한 줄에 회의실 목록을 늘어놓을 자리가 없다).
 */
export function roomConflictLabel(ev: Pick<GoogleEvent, 'rooms' | 'rsvps' | 'names'>): string {
  const emails = declinedRooms(ev);
  const names = emails.map((e) => ev.names?.[e] ?? knownName(e) ?? e.split('@')[0] ?? e);
  if (names.length <= 2) return names.join(', ');
  return `${names.slice(0, 2).join(', ')} 외 ${names.length - 2}곳`;
}

/**
 * 받아 온 일정 목록을 훑어 기록을 **맞춘다**(더하고 지운다).
 *
 * 더하는 것은 **내가 만든 앞으로의 일정**뿐이다 — 남이 잡은 방이 거절한 것까지
 * 알리면 내가 손쓸 수 없는 알림이 되고(고칠 권한이 없다), 지난 일정은 이미 끝난
 * 일이다. 지우는 것은 **그 사실이 사라진 것을 실제로 본 경우**뿐이다(시간을 옮겨
 * 방이 받아들였다) — 목록에 없는 일정은 범위 밖일 수도 있으므로 건드리지 않는다.
 */
export function syncRoomConflictNotices(events: readonly GoogleEvent[], now = Date.now()): void {
  const today = todayISO(new Date(now));
  const list = read();
  const have = new Map(list.map((n) => [n.id, n]));
  const add: Stored[] = [];
  const drop = new Set<string>();
  for (const ev of events) {
    const id = keyOf(ev);
    const bad = declinedRooms(ev).length > 0;
    // 내가 만든 일정인가 — 구글은 공유 캘린더에 만든 일정의 `organizer`를 그
    // 캘린더로 두므로 `creator`도 함께 본다(`GoogleEvent.creator` 머리말).
    const mine = !!ev.creator?.self || !!ev.organizer?.self;
    if (bad && mine && ev.startDate >= today) {
      if (!have.has(id)) add.push({ id, title: ev.title, rooms: roomConflictLabel(ev), date: ev.startDate, eventId: ev.eventId, at: new Date(now).toISOString(), read: false });
    } else if (have.has(id)) {
      drop.add(id);
    }
  }
  if (add.length === 0 && drop.size === 0) return; // 쓰지 않으면 신호도 없다(되풀이 방지)
  write([...add, ...list.filter((n) => !drop.has(n.id))]);
}

/** 우편함이 읽는 꼴로 — 서버 알림·일정 알림과 한 목록에 섞인다. */
export function listRoomConflictNotices(): AppNotification[] {
  return read().map((n) => ({
    id: `room:${n.id}`,
    kind: 'room_conflict' as const,
    documentId: null,
    nodeId: null,
    actorName: '',
    // 둘째 줄 칩이 이 값을 쓴다 — 그 자리에서 궁금한 것은 **어느 일정인가**다.
    preview: n.title,
    docTitle: n.title,
    createdAt: n.at,
    read: n.read,
    calendar: { date: n.date, eventId: n.eventId, source: 'google' as const, body: n.rooms ? `회의실이 예약을 거절했어요 — ${n.rooms}` : '회의실이 예약을 거절했어요' },
  }));
}

/** 우편함을 열면 전부 읽음 — 서버 알림과 같은 규칙(열었으면 본 것). */
export function markRoomConflictNoticesRead(): void {
  const list = read();
  if (!list.some((n) => !n.read)) return;
  write(list.map((n) => ({ ...n, read: true })));
}

/** 새 기록이 생기면 우편함이 곧바로 다시 읽는다(같은 탭 안의 신호). */
export function onRoomConflictInboxChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

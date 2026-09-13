// 일정 알림의 **기록** — 뜬 알림이 홈 LNB의 우편함에도 남는다(제보: 일정 알림이 올
// 때 `알림` 항목에 추가되게).
//
// ## 왜 이 기기(localStorage)인가
//
// 우편함(0022 `notifications`)은 **DB 트리거만** 채운다 — 클라이언트 insert를 열면
// 아무나 남의 우편함에 가짜 알림을 꽂을 수 있다. 그런데 일정 알림은 서버가 만들지
// 않는다: 스케줄러가 이 기기 안에서 띄우고, 캘린더 데이터는 개인정보처리방침대로
// 서버에 쌓지 않는다(§4·§6). 그래서 **기록도 이 기기에** 두고, 우편함 목록이
// 서버 것과 여기 것을 합쳐 보여 준다(`NotificationsContext`).
//
// 읽음 상태도 같은 이유로 이 기기의 값이다 — 알림 자체가 기기마다 따로 뜬다
// (OS 알림 권한·설정이 기기별이다).

import type { AppNotification } from '../../adapters/ports';
import { reminderBody, type ReminderItem } from './reminders';
import { isGoogleReminder } from './reminders';

const KEY = 'mf_reminder_inbox';
/** 우편함에 남기는 개수 — 목록은 한 화면이라 더 쌓아 둘 이유가 없다. */
const MAX = 30;
/** 나이 상한 — 지난 알림은 정보가 아니라 목록의 길이가 된다. */
const TTL_MS = 14 * 24 * 60 * 60_000;

interface Stored {
  /** `키@알림시각` — 같은 알림이 두 번 기록되지 않게(탭이 여럿일 수 있다). */
  id: string;
  title: string;
  body: string;
  date: string;
  eventId: string;
  source: 'geurio' | 'google';
  /** 띄운 시각(ISO). */
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
    /* 쿼터 초과 — 기록이 알림을 방해하면 안 된다(알림 자체는 이미 떴다) */
  }
  listeners.forEach((fn) => fn());
}

/**
 * 방금 띄운 알림을 기록한다. **띄운 그 자리에서** 부른다(스케줄러) — 화면이 떠
 * 있든 아니든 남아야 하고, 토스트를 놓친 사용자가 나중에 확인하는 자리가 이것이다.
 */
export function pushReminderNotice(item: ReminderItem, now = Date.now()): void {
  const id = `${item.key}@${item.fireAt}`;
  const list = read();
  if (list.some((n) => n.id === id)) return; // 탭이 여럿이면 각자 훑는다
  write([
    {
      id,
      title: item.title,
      body: reminderBody(item),
      date: item.date,
      eventId: item.eventId,
      source: isGoogleReminder(item) ? 'google' : 'geurio',
      at: new Date(now).toISOString(),
      read: false,
    },
    ...list,
  ]);
}

/** 우편함이 읽는 꼴로 — 서버 알림과 한 목록에 섞인다. */
export function listReminderNotices(): AppNotification[] {
  return read().map((n) => ({
    id: `rem:${n.id}`,
    kind: 'reminder' as const,
    documentId: null,
    nodeId: null,
    actorName: '',
    // 둘째 줄 칩이 이 값을 쓴다 — 그 자리에서 궁금한 것은 **어느 일정인가**다.
    preview: n.title,
    docTitle: n.title,
    createdAt: n.at,
    read: n.read,
    calendar: { date: n.date, eventId: n.eventId, source: n.source, body: n.body },
  }));
}

/** 우편함을 열면 전부 읽음 — 서버 알림과 같은 규칙(열었으면 본 것). */
export function markReminderNoticesRead(): void {
  const list = read();
  if (!list.some((n) => !n.read)) return;
  write(list.map((n) => ({ ...n, read: true })));
}

/** 새 기록이 생기면 우편함이 곧바로 다시 읽는다(같은 탭 안의 신호). */
export function onReminderInboxChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

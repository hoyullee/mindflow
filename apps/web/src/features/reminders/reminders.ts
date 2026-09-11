// 일정 알림 — **무엇을 언제 띄울까**를 정하는 순수 부분(요청: "오전 10:30 일정에
// 10분 알림이면 10:20에 앱 알림과 OS 알림을 받는 것").
//
// ## 왜 서버가 아니라 여기인가
//
// 서버 푸시로 가면 일정의 제목·시각을 우리 서버에 쌓아야 하는데, 개인정보처리방침이
// 캘린더 데이터를 "브라우저에서 화면에 그리는 데만 쓰고 서버에 저장하지 않는다"고
// **명시**하고 있고(§4·§5·§6) 구글 민감 스코프 검수가 그 방침으로 통과했다. 로컬
// 예약이면 방침·스코프를 한 줄도 건드리지 않고 "앱이 켜져 있을 때"를 온전히 덮는다.
// (앱을 완전히 닫아도 뜨게 하는 일은 다음 단계 — 모바일은 OS가 예약을 들고 있고,
// 데스크톱은 트레이 상주가 필요하다.)
//
// ## 왜 `setTimeout` 하나가 아니라 주기 확인인가
//
// ① 백그라운드 탭의 타이머는 크롬이 1분에 한 번으로 조인다(intensive throttling)
// ② **절전 중에는 타이머가 아예 돌지 않는다** — 깨어난 뒤에 몰아서 오거나 그냥 지나간다.
// 그래서 짧은 주기로 "지금 띄울 것"을 훑고, 지나간 알림은 유예(REMINDER_GRACE_MS)
// 안이면 늦게라도 띄우고 그보다 오래됐으면 조용히 넘긴다(어제 알림이 오늘 뜨지 않게).

import type { CalendarEvent } from '../../adapters/ports';
import { daysBetween, isoOf, minutesOf, timeLabel } from '../home/calendar/model';
import { expandRecurrence } from '../home/calendar/recurrence';

/** 지나간 알림을 늦게라도 띄우는 유예 — 절전·탭 스로틀에서 깨어난 직후를 위한 창. */
export const REMINDER_GRACE_MS = 5 * 60_000;

/** 띄울 것이 있는지 훑는 주기. 알림 시각을 이 정도 안쪽으로 맞춘다. */
export const REMINDER_TICK_MS = 30_000;

/** 일정 목록을 다시 받는 주기(다른 기기에서 만든 일정도 잡히게). */
export const REMINDER_REFETCH_MS = 5 * 60_000;

/** 앞으로 며칠치를 들고 있을까 — 알림은 최대 4주 전이지만 대개 하루 안쪽이다. */
export const REMINDER_WINDOW_DAYS = 2;

/** 알림 한 건 — 화면·OS 알림이 그대로 소비한다. */
export interface ReminderItem {
  /**
   * 중복 방지 키. **회차마다 다르다**(반복 일정) — 같으면 첫 회차만 기억되고 다음
   * 회차가 조용히 건너뛰어진다.
   */
  key: string;
  /** 일정 id(딥링크·묶기용 — 회차 접미사가 없다). */
  eventId: string;
  title: string;
  /** 그 회차가 놓인 날(`YYYY-MM-DD`). */
  date: string;
  /** `HH:MM` — 화면이 `오전 10:30`으로 그린다. */
  startTime: string;
  /** 일정 시작(epoch ms, 로컬 시각 기준). */
  startAt: number;
  /** 알림을 띄울 시각(epoch ms). */
  fireAt: number;
  /** 사용자가 고른 값 — 화면 문구가 이 값을 그대로 말한다("10분 후 시작"). */
  minutes: number;
}

/** 로컬 날짜(`YYYY-MM-DD`) + 시각(`HH:MM`) → epoch ms. 꼴이 아니면 null. */
export function localMs(dateIso: string, hhmm: string): number | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso);
  const t = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!d || !t) return null;
  // 로컬 기준으로 만든다 — 우리 날짜·시각은 처음부터 로컬 문자열이다(0033 주석).
  return new Date(+d[1]!, +d[2]! - 1, +d[3]!, +t[1]!, +t[2]!, 0, 0).getTime();
}

/**
 * 일정들 → 알림 목록(구간 안의 회차까지 펼친다).
 *
 * **시각 있는 일정만** 대상이다 — 종일 일정의 "10분 전"은 자정 10분 전이라 뜻이
 * 어긋나고, 정규화가 종일로 바뀔 때 값을 지우므로 여기 올 일도 거의 없다(방어).
 */
export function reminderItems(events: readonly CalendarEvent[], from: string, to: string): ReminderItem[] {
  const out: ReminderItem[] = [];
  for (const e of events) {
    const minutes = e.reminderMinutes;
    if (typeof minutes !== 'number' || e.allDay || !e.startTime) continue;
    const span = Math.max(0, daysBetween(e.startDate, e.endDate));
    for (const start of expandRecurrence(e.recurrence, e.startDate, from, to, span)) {
      const startAt = localMs(start, e.startTime);
      if (startAt === null) continue;
      out.push({
        key: `${e.id}#${start}`,
        eventId: e.id,
        title: e.title || '(제목 없음)',
        date: start,
        startTime: e.startTime,
        startAt,
        fireAt: startAt - minutes * 60_000,
        minutes,
      });
    }
  }
  return out.sort((a, b) => a.fireAt - b.fireAt);
}

/**
 * 구글 일정 한 건 중 **알림에 필요한 것만**(2단계).
 *
 * `GoogleEvent`를 그대로 받지 않는 이유는 이 파일을 순수하게 두기 위해서다 —
 * 구조만 맞으면 되므로 호출부가 그대로 넘긴다.
 */
export interface GoogleReminderSource {
  /** `캘린더::일정` — 우리 쪽 유일 id. 회차는 구글이 이미 펼쳐 준다(`singleEvents`). */
  id: string;
  calendarId: string;
  title: string;
  startDate: string;
  startTime?: string;
  allDay: boolean;
  /** `null`은 "알림 없음", 숫자는 "N분 전", **`undefined`는 캘린더 기본 알림**이다. */
  reminderMinutes?: number | null;
  /** 공휴일 캘린더의 항목 — 일정이 아니다. */
  holiday?: boolean;
  /** 근무 위치(재택·사무실) — 그 날의 상태이지 회의가 아니다. */
  workLocation?: string;
  /** 내 응답 — 거절한 회의는 구글도 알리지 않는다. */
  rsvp?: 'accepted' | 'declined' | 'tentative' | 'needsAction';
}

/**
 * 구글 일정 → 알림 목록.
 *
 * **무엇을 몇 분 전에 띄울지**는 두 곳에서 온다: 그 일정에 직접 건 알림(override)이
 * 있으면 그 값, 없으면(`useDefault`) **그 캘린더의 기본 알림**이다(대부분이 이쪽이라
 * 기본을 모르면 이 기능이 사실상 비어 버린다 — 그래서 목록을 받을 때 챙겨 둔다).
 * 둘 다 없으면 띄우지 않는다 — 모르는 값을 지어내지 않는다.
 *
 * 빼는 것 넷: 종일(자정 기준이라 뜻이 어긋난다)·공휴일·근무 위치(회의가 아니다)·
 * **내가 거절한 회의**(구글도 알리지 않는다).
 */
export function googleReminderItems(
  events: readonly GoogleReminderSource[],
  defaults: ReadonlyMap<string, number>,
  from: string,
  to: string,
): ReminderItem[] {
  const out: ReminderItem[] = [];
  for (const e of events) {
    if (e.allDay || !e.startTime || e.holiday || e.workLocation || e.rsvp === 'declined') continue;
    if (e.startDate < from || e.startDate > to) continue;
    const minutes = e.reminderMinutes === undefined ? defaults.get(e.calendarId) : (e.reminderMinutes ?? undefined);
    if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes < 0) continue;
    const startAt = localMs(e.startDate, e.startTime);
    if (startAt === null) continue;
    out.push({
      // 구글 id에는 이미 캘린더가 붙어 있어 우리 일정과 겹칠 일이 없지만, 저장소에
      // 남는 키라 어디서 온 것인지 읽히게 접두를 둔다.
      key: `g:${e.id}#${e.startDate}`,
      eventId: e.id,
      title: e.title || '(제목 없음)',
      date: e.startDate,
      startTime: e.startTime,
      startAt,
      fireAt: startAt - minutes * 60_000,
      minutes,
    });
  }
  return out.sort((a, b) => a.fireAt - b.fireAt);
}

/**
 * 지금 띄울 것 — 알림 시각이 지났고 유예 안쪽인 것만.
 *
 * 유예를 두는 이유는 위 주석의 ②(절전)이고, **넘긴 것은 기억하지 않는다** — 시간은
 * 앞으로만 가므로 다시 창에 들어올 일이 없고, 그래야 기억이 무한히 자라지 않는다.
 */
export function dueReminders(items: readonly ReminderItem[], now: number, grace = REMINDER_GRACE_MS): ReminderItem[] {
  return items.filter((i) => i.fireAt <= now && now - i.fireAt <= grace);
}

/**
 * 알림 본문 — `오전 10:30 · 10분 후 시작`.
 *
 * 인앱 토스트·웹 OS 알림·**모바일 OS 예약**이 한 문장을 쓴다: 같은 알림이 어디서
 * 뜨느냐에 따라 다르게 읽히면 안 된다.
 */
export function reminderBody(item: ReminderItem): string {
  const mins = minutesOf(item.startTime);
  const when = mins === null ? item.startTime : timeLabel(mins);
  return `${when} · ${reminderLead(item.minutes)}`;
}

/**
 * OS 알림에 실어 보낸 꾸러미를 되읽는다(모바일 3단계).
 *
 * 앱이 **닫혀 있다 열리는** 경로라 우리가 만든 값이라는 보장이 없다(OS·플러그인을
 * 거쳐 온다) — 그래서 모양을 하나씩 확인하고 아니면 `null`이다.
 */
export function parseReminderExtra(extra: unknown): ReminderItem | null {
  if (!extra || typeof extra !== 'object') return null;
  const e = extra as Record<string, unknown>;
  const str = (k: string): string | null => (typeof e[k] === 'string' ? (e[k] as string) : null);
  const num = (k: string): number | null =>
    typeof e[k] === 'number' && Number.isFinite(e[k]) ? (e[k] as number) : null;
  const key = str('key');
  const eventId = str('eventId');
  const title = str('title');
  const date = str('date');
  const startTime = str('startTime');
  const startAt = num('startAt');
  const fireAt = num('fireAt');
  const minutes = num('minutes');
  if (key === null || eventId === null || title === null || date === null) return null;
  if (startTime === null || startAt === null || fireAt === null || minutes === null) return null;
  return { key, eventId, title, date, startTime, startAt, fireAt, minutes };
}

/** "10분 후 시작" — 사용자가 고른 값을 그대로 말한다(지금 시각으로 다시 재지 않는다). */
export function reminderLead(minutes: number): string {
  if (minutes <= 0) return '지금 시작';
  if (minutes % 1440 === 0) return `${minutes / 1440}일 후 시작`;
  if (minutes % 60 === 0) return `${minutes / 60}시간 후 시작`;
  return `${minutes}분 후 시작`;
}

/** 오늘(로컬) — 알림 창의 시작. */
export function reminderWindow(now: Date = new Date(), days = REMINDER_WINDOW_DAYS): { from: string; to: string } {
  const from = isoOf(now.getFullYear(), now.getMonth() + 1, now.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  return { from, to: isoOf(end.getFullYear(), end.getMonth() + 1, end.getDate()) };
}

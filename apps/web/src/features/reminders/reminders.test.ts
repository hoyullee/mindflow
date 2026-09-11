import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '../../adapters/ports';
import {
  REMINDER_GRACE_MS,
  dueReminders,
  googleReminderItems,
  isGoogleReminder,
  localMs,
  reminderItems,
  reminderLead,
  reminderWindow,
  type GoogleReminderSource,
} from './reminders';

const EV = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'e1',
  title: '팀 회의',
  startDate: '2026-09-15',
  endDate: '2026-09-15',
  allDay: false,
  startTime: '10:30',
  endTime: '11:30',
  reminderMinutes: 10,
  source: 'geurio',
  ...over,
});

describe('일정 알림 — 무엇을 언제 띄울까', () => {
  it('로컬 날짜+시각을 그 기기의 시각으로 읽는다', () => {
    const ms = localMs('2026-09-15', '10:30');
    expect(ms).not.toBeNull();
    const d = new Date(ms!);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth() + 1).toBe(9);
    expect(d.getDate()).toBe(15);
    expect(d.getHours()).toBe(10);
    expect(d.getMinutes()).toBe(30);
    expect(localMs('2026-09-15', '25:00')).toBeNull();
    expect(localMs('bad', '10:30')).toBeNull();
  });

  it('알림 시각 = 시작 − 고른 분 (요청의 그 예: 10:30 일정 · 10분 → 10:20)', () => {
    const [item] = reminderItems([EV()], '2026-09-14', '2026-09-17');
    expect(item).toBeTruthy();
    expect(new Date(item!.fireAt).getHours()).toBe(10);
    expect(new Date(item!.fireAt).getMinutes()).toBe(20);
    expect(item!.startAt - item!.fireAt).toBe(10 * 60_000);
    expect(item!.title).toBe('팀 회의');
    expect(item!.minutes).toBe(10);
  });

  it('알림을 걸지 않은 일정과 종일 일정은 대상이 아니다', () => {
    // 종일에 "10분 전"은 자정 10분 전이라 뜻이 어긋난다 — 정규화가 값을 지우지만
    // 여기서도 방어한다(옛 데이터·다른 기기가 남긴 값).
    expect(reminderItems([EV({ reminderMinutes: undefined })], '2026-09-14', '2026-09-17')).toEqual([]);
    expect(reminderItems([EV({ allDay: true, startTime: undefined })], '2026-09-14', '2026-09-17')).toEqual([]);
    expect(reminderItems([EV({ allDay: true })], '2026-09-14', '2026-09-17')).toEqual([]);
  });

  it('반복 일정은 회차마다 하나씩 — 키가 달라야 첫 회차만 기억되고 끝나지 않는다', () => {
    const items = reminderItems([EV({ recurrence: 'RRULE:FREQ=DAILY' })], '2026-09-15', '2026-09-17');
    expect(items.length).toBe(3);
    expect(new Set(items.map((i) => i.key)).size).toBe(3);
    expect(items.map((i) => i.date)).toEqual(['2026-09-15', '2026-09-16', '2026-09-17']);
    // 회차마다 그 날의 10:20이다(같은 시각이 아니라).
    expect(items.every((i) => new Date(i.fireAt).getMinutes() === 20)).toBe(true);
  });

  it('아직 오지 않은 알림은 띄우지 않고, 지나간 것은 유예 안쪽만 띄운다', () => {
    const [item] = reminderItems([EV()], '2026-09-14', '2026-09-17');
    const at = item!.fireAt;
    expect(dueReminders([item!], at - 1_000)).toEqual([]);
    expect(dueReminders([item!], at)).toEqual([item]);
    expect(dueReminders([item!], at + REMINDER_GRACE_MS)).toEqual([item]);
    // 유예를 넘긴 것은 조용히 넘긴다 — 어제 알림이 오늘 앱을 켜자마자 뜨지 않게.
    expect(dueReminders([item!], at + REMINDER_GRACE_MS + 1)).toEqual([]);
  });

  it('문구는 사용자가 고른 값을 그대로 말한다', () => {
    expect(reminderLead(0)).toBe('지금 시작');
    expect(reminderLead(10)).toBe('10분 후 시작');
    expect(reminderLead(60)).toBe('1시간 후 시작');
    expect(reminderLead(1440)).toBe('1일 후 시작');
  });

  it('조회 창은 오늘부터 며칠치다', () => {
    const { from, to } = reminderWindow(new Date(2026, 8, 15, 23, 40), 2);
    expect(from).toBe('2026-09-15');
    expect(to).toBe('2026-09-17');
    // 달 경계도 넘는다(달력 격자와 같은 규칙).
    expect(reminderWindow(new Date(2026, 8, 30, 1, 0), 2).to).toBe('2026-10-02');
  });
});

const G = (over: Partial<GoogleReminderSource> = {}): GoogleReminderSource => ({
  id: 'cal-a::g1',
  calendarId: 'cal-a',
  title: '주간 회의',
  startDate: '2026-09-15',
  startTime: '10:30',
  allDay: false,
  ...over,
});

/** 그 캘린더의 기본 알림 — 대부분의 구글 일정이 이 값을 따른다(`useDefault`). */
const DEFAULTS = new Map([['cal-a', 30]]);

describe('구글 일정 알림(2단계)', () => {
  it('일정에 직접 건 알림이 캘린더 기본보다 먼저다', () => {
    const [item] = googleReminderItems([G({ reminderMinutes: 10 })], DEFAULTS, '2026-09-14', '2026-09-17');
    expect(item!.minutes).toBe(10);
    expect(new Date(item!.fireAt).getHours()).toBe(10);
    expect(new Date(item!.fireAt).getMinutes()).toBe(20);
    // 저장소에 남는 키라 어디서 온 것인지 읽히게 접두를 둔다 — 그 접두가 곧 출처다
    // (알림을 눌렀을 때 어느 상세 팝업을 열지가 여기서 갈린다).
    expect(item!.key).toBe('g:cal-a::g1#2026-09-15');
    expect(isGoogleReminder(item!)).toBe(true);
    expect(item!.eventId).toBe('cal-a::g1');
  });

  it('일정에 건 알림이 없으면(useDefault) **그 캘린더의 기본 알림**을 쓴다', () => {
    const [item] = googleReminderItems([G()], DEFAULTS, '2026-09-14', '2026-09-17');
    expect(item!.minutes).toBe(30);
    // 기본을 모르는 캘린더면 띄우지 않는다 — 모르는 값을 지어내지 않는다.
    expect(googleReminderItems([G({ calendarId: 'cal-b' })], DEFAULTS, '2026-09-14', '2026-09-17')).toEqual([]);
  });

  it('"알림 없음"으로 꺼 둔 일정은 캘린더 기본으로 되살아나지 않는다', () => {
    expect(googleReminderItems([G({ reminderMinutes: null })], DEFAULTS, '2026-09-14', '2026-09-17')).toEqual([]);
  });

  it('회의가 아닌 것과 거절한 회의는 빠진다', () => {
    const skipped: Partial<GoogleReminderSource>[] = [
      { allDay: true, startTime: undefined },
      { holiday: true },
      { workLocation: '재택' },
      { rsvp: 'declined' },
    ];
    for (const over of skipped) {
      expect(googleReminderItems([G({ reminderMinutes: 10, ...over })], DEFAULTS, '2026-09-14', '2026-09-17')).toEqual([]);
    }
    // 수락·미응답은 그대로 대상이다(구글도 알린다).
    expect(googleReminderItems([G({ reminderMinutes: 10, rsvp: 'needsAction' })], DEFAULTS, '2026-09-14', '2026-09-17')).toHaveLength(1);
  });

  it('창 밖의 일정은 담지 않는다', () => {
    expect(googleReminderItems([G({ reminderMinutes: 10 })], DEFAULTS, '2026-09-16', '2026-09-17')).toEqual([]);
  });
});

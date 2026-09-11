import { describe, expect, it } from 'vitest';
import {
  NATIVE_MAX_PENDING,
  planNativeSchedule,
  reminderNotificationId,
} from './nativeSchedule';
import type { ReminderItem } from './reminders';

const T0 = new Date(2026, 8, 20, 9, 0, 0).getTime();

function item(over: Partial<ReminderItem> & { key: string; fireAt: number }): ReminderItem {
  return {
    eventId: over.key,
    title: '회의',
    date: '2026-09-20',
    startTime: '10:00',
    startAt: over.fireAt + 600_000,
    minutes: 10,
    ...over,
  };
}

describe('reminderNotificationId', () => {
  it('같은 입력이면 같은 수, 31비트 양수', () => {
    const a = reminderNotificationId('e1#2026-09-20', T0, '회의');
    expect(a).toBe(reminderNotificationId('e1#2026-09-20', T0, '회의'));
    expect(Number.isInteger(a)).toBe(true);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThanOrEqual(0x7fffffff);
  });

  it('시각이나 제목이 바뀌면 다른 알림이 된다(옛 예약은 거둬진다)', () => {
    const base = reminderNotificationId('e1#2026-09-20', T0, '회의');
    expect(reminderNotificationId('e1#2026-09-20', T0 + 60_000, '회의')).not.toBe(base);
    expect(reminderNotificationId('e1#2026-09-20', T0, '회의 (장소 변경)')).not.toBe(base);
    expect(reminderNotificationId('e2#2026-09-20', T0, '회의')).not.toBe(base);
  });
});

describe('planNativeSchedule', () => {
  it('없는 것만 심고 남는 것만 거둔다', () => {
    const a = item({ key: 'a', fireAt: T0 + 60_000 });
    const b = item({ key: 'b', fireAt: T0 + 120_000 });
    const stale = 424242;
    const plan = planNativeSchedule([a, b], [reminderNotificationId(a.key, a.fireAt, a.title), stale], T0);
    expect(plan.schedule.map((i) => i.key)).toEqual(['b']);
    expect(plan.cancel).toEqual([stale]);
  });

  it('같은 입력을 다시 주면 아무 일도 하지 않는다(멱등)', () => {
    const items = [item({ key: 'a', fireAt: T0 + 60_000 }), item({ key: 'b', fireAt: T0 + 120_000 })];
    const ids = items.map((i) => reminderNotificationId(i.key, i.fireAt, i.title));
    expect(planNativeSchedule(items, ids, T0)).toEqual({ schedule: [], cancel: [] });
  });

  it('이미 지난 알림은 OS에 맡기지 않는다(앱이 켜져 있을 때의 유예가 맡는다)', () => {
    const past = item({ key: 'past', fireAt: T0 - 60_000 });
    const soon = item({ key: 'soon', fireAt: T0 + 60_000 });
    const plan = planNativeSchedule([past, soon], [], T0);
    expect(plan.schedule.map((i) => i.key)).toEqual(['soon']);
  });

  it('지난 알림이 이미 걸려 있으면 거둔다', () => {
    const past = item({ key: 'past', fireAt: T0 - 60_000 });
    const id = reminderNotificationId(past.key, past.fireAt, past.title);
    expect(planNativeSchedule([past], [id], T0).cancel).toEqual([id]);
  });

  it('상한을 넘으면 가까운 것부터 채운다(iOS 64개 제한)', () => {
    const many = Array.from({ length: NATIVE_MAX_PENDING + 5 }, (_, i) =>
      item({ key: `k${i}`, fireAt: T0 + (NATIVE_MAX_PENDING + 5 - i) * 60_000 }),
    );
    const plan = planNativeSchedule(many, [], T0);
    expect(plan.schedule).toHaveLength(NATIVE_MAX_PENDING);
    // 입력은 먼 것이 앞이지만 가까운 것부터 잘린다.
    expect(plan.schedule[0]!.key).toBe(`k${NATIVE_MAX_PENDING + 4}`);
  });

  it('목록이 비면(알림 끔) 걸려 있던 것을 전부 거둔다', () => {
    expect(planNativeSchedule([], [1, 2, 3], T0)).toEqual({ schedule: [], cancel: [1, 2, 3] });
  });
});

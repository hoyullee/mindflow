// 일정 알림의 기록 — 우편함(LNB `알림`)이 읽는 쪽(제보: 일정 알림도 알림 항목에).
//
// 서버 우편함(0022)은 **DB 트리거만** 채우므로 이 기록은 이 기기에 산다. 그래서
// 여기서 지키는 계약은 셋이다: 같은 알림이 두 번 남지 않는다(탭이 여럿이다),
// 목록은 자라지 않는다(상한·나이), 그리고 **어느 일정인지**를 잃지 않는다(딥링크).

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  listReminderNotices,
  markReminderNoticesRead,
  onReminderInboxChange,
  pushReminderNotice,
} from './reminderInbox';
import type { ReminderItem } from './reminders';

function item(over: Partial<ReminderItem> = {}): ReminderItem {
  return {
    key: 'e1#2026-09-15',
    eventId: 'e1',
    date: '2026-09-15',
    title: '팀 회의',
    startTime: '10:30',
    fireAt: Date.parse('2026-09-15T10:20:00'),
    startAt: Date.parse('2026-09-15T10:30:00'),
    minutes: 10,
    ...over,
  };
}

beforeEach(() => localStorage.clear());

describe('일정 알림 기록', () => {
  it('띄운 알림이 우편함 꼴로 남는다 — 어느 일정인지까지(딥링크가 그걸 쓴다)', () => {
    pushReminderNotice(item());
    const [n] = listReminderNotices();
    expect(n!.kind).toBe('reminder');
    expect(n!.read).toBe(false);
    // 둘째 줄 칩은 **어느 일정인가**를 말한다(사람이 없는 알림이다).
    expect(n!.preview).toBe('팀 회의');
    expect(n!.calendar).toMatchObject({ date: '2026-09-15', eventId: 'e1', source: 'geurio' });
    expect(n!.calendar!.body).toContain('10분');
  });

  it('같은 알림은 두 번 남지 않는다 — 탭이 여럿이면 각자 훑는다', () => {
    pushReminderNotice(item());
    pushReminderNotice(item());
    expect(listReminderNotices()).toHaveLength(1);
    // 일정을 옮기면 알림 시각이 달라진다 = 새 알림이다(그게 맞다).
    pushReminderNotice(item({ fireAt: Date.parse('2026-09-16T10:20:00') }));
    expect(listReminderNotices()).toHaveLength(2);
  });

  it('구글 일정은 그 원천을 기억한다 — 상세 팝업이 원천마다 다르다', () => {
    pushReminderNotice(item({ key: 'g:e9#2026-09-15', eventId: 'e9' }));
    expect(listReminderNotices()[0]!.calendar!.source).toBe('google');
  });

  it('오래된 것과 넘치는 것은 버린다 — 목록이 아니라 길이가 된다', () => {
    const old = Date.now() - 20 * 24 * 60 * 60_000;
    pushReminderNotice(item({ key: 'old', fireAt: 1 }), old);
    for (let i = 0; i < 35; i += 1) pushReminderNotice(item({ key: `k${i}`, fireAt: i }));
    const list = listReminderNotices();
    expect(list).toHaveLength(30);
    expect(list.some((n) => n.id.includes('old'))).toBe(false);
  });

  it('우편함을 열면 전부 읽음 — 서버 알림과 같은 규칙', () => {
    pushReminderNotice(item());
    markReminderNoticesRead();
    expect(listReminderNotices()[0]!.read).toBe(true);
  });

  it('새 기록이 생기면 우편함이 곧바로 다시 읽는다', () => {
    const fn = vi.fn();
    const off = onReminderInboxChange(fn);
    pushReminderNotice(item());
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    pushReminderNotice(item({ key: 'k2' }));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('저장소가 깨져 있어도 목록이 통째로 죽지 않는다', () => {
    localStorage.setItem('mf_reminder_inbox', '{not json');
    expect(listReminderNotices()).toEqual([]);
    pushReminderNotice(item());
    expect(listReminderNotices()).toHaveLength(1);
  });
});

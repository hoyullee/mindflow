// 배경 훑기 — **일정 화면을 보고 있지 않아도** 회의실 거절이 알림 센터에 쌓이는가
// (제보). 훅이 스스로 조회하므로 조회 두 곳을 가짜로 두고 그 결과만 본다.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';

const ensureGoogleToken = vi.fn();
const fetchEvents = vi.fn();

vi.mock('./googleCalendar', async () => {
  const actual = await vi.importActual<typeof import('./googleCalendar')>('./googleCalendar');
  return {
    ...actual,
    ensureGoogleToken: (...a: unknown[]) => ensureGoogleToken(...a),
    fetchEvents: (...a: unknown[]) => fetchEvents(...a),
  };
});

const { useRoomConflictWatch } = await import('./useRoomConflictWatch');
const { listRoomConflictNotices } = await import('./roomConflictInbox');
const { noteSyncedReminderPrefs, resetReminderSync } = await import('../../reminders/reminderSync');
const { notifyCalendarChanged } = await import('../../reminders/calendarChanged');

function Probe() {
  useRoomConflictWatch();
  return null;
}

/** 오늘 이후여야 적재된다 — 며칠 뒤로 잡는다. */
function soon(days = 3): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const ROOM = 'room-35-01@resource.calendar.google.com';

function declinedEvent(date: string) {
  return {
    id: `cal-a#g1`,
    calendarId: 'cal-a',
    calendarName: '',
    title: '팀 싱크',
    startDate: date,
    endDate: date,
    startTime: '09:00',
    endTime: '10:00',
    allDay: false,
    eventId: 'g1',
    creator: { email: 'me@example.com', self: true as const },
    rooms: [ROOM],
    rsvps: { [ROOM]: 'declined' as const },
  };
}

beforeEach(() => {
  localStorage.clear();
  resetReminderSync();
  ensureGoogleToken.mockReset().mockResolvedValue({ token: { accessToken: 'tok' } });
  fetchEvents.mockReset().mockResolvedValue([declinedEvent(soon())]);
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('회의실 거절 배경 훑기', () => {
  it('계정 값이 **마운트보다 늦게** 와도 훑는다 — 신호를 구독한다', async () => {
    render(<Probe />);
    // 아직 계정 값이 없다 = 조회할 캘린더를 모른다 → 왕복 0회.
    expect(ensureGoogleToken).not.toHaveBeenCalled();

    noteSyncedReminderPrefs(undefined, { calendars: ['cal-a'] });
    await waitFor(() => expect(listRoomConflictNotices()).toHaveLength(1));
    expect(listRoomConflictNotices()[0]!.preview).toBe('팀 싱크');
    // 구간은 오늘부터 — 지난 일정은 훑을 이유가 없다.
    const [, , from] = fetchEvents.mock.calls[0] as [string, unknown, string, string];
    expect(from).toBe(soon(0));
  });

  it('공휴일 캘린더는 묻지 않는다 — 종일이라 회의실이 없다', async () => {
    noteSyncedReminderPrefs(undefined, { calendars: ['cal-a', 'ko.south_korea#holiday@group.v.calendar.google.com'] });
    render(<Probe />);
    await waitFor(() => expect(fetchEvents).toHaveBeenCalled());
    expect(fetchEvents.mock.calls.map((c) => (c[1] as { id: string }).id)).toEqual(['cal-a']);
  });

  it('우리가 고친 일정은 기다리지 않는다 — 그 신호에 곧바로 다시 훑는다', async () => {
    noteSyncedReminderPrefs(undefined, { calendars: ['cal-a'] });
    render(<Probe />);
    await waitFor(() => expect(fetchEvents).toHaveBeenCalledTimes(1));
    notifyCalendarChanged();
    await waitFor(() => expect(fetchEvents).toHaveBeenCalledTimes(2));
  });

  it('토큰을 못 받으면 조용히 물러난다 — 배경에서 동의 창이 뜨면 안 된다', async () => {
    ensureGoogleToken.mockResolvedValue({ error: 'reauth' });
    noteSyncedReminderPrefs(undefined, { calendars: ['cal-a'] });
    render(<Probe />);
    await waitFor(() => expect(ensureGoogleToken).toHaveBeenCalled());
    expect(fetchEvents).not.toHaveBeenCalled();
    expect(listRoomConflictNotices()).toEqual([]);
  });

  it('캘린더 하나가 실패해도 나머지는 본다', async () => {
    fetchEvents.mockImplementation(async (_t: string, cal: { id: string }) => {
      if (cal.id === 'cal-a') throw new Error('403');
      return [declinedEvent(soon())];
    });
    noteSyncedReminderPrefs(undefined, { calendars: ['cal-a', 'cal-b'] });
    render(<Probe />);
    await waitFor(() => expect(listRoomConflictNotices()).toHaveLength(1));
  });
});

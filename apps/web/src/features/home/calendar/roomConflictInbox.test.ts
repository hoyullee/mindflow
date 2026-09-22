import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  listRoomConflictNotices,
  markRoomConflictNoticesRead,
  onRoomConflictInboxChange,
  roomConflictLabel,
  syncRoomConflictNotices,
} from './roomConflictInbox';
import type { GoogleEvent } from './googleCalendar';

// 잡아 둔 회의실이 **예약을 거절한 일정**의 기록 — 알림 센터가 이 목록을 섞어 본다.

const NOW = Date.parse('2026-09-22T09:00:00+09:00');
const ROOM = 'room-35-01@resource.calendar.google.com';

function ev(over: Partial<GoogleEvent> = {}): GoogleEvent {
  return {
    id: `c#${over.eventId ?? 'g1'}`,
    calendarId: 'me@example.com',
    calendarName: '내 캘린더',
    title: '팀 싱크',
    startDate: '2026-09-25',
    endDate: '2026-09-25',
    startTime: '09:00',
    endTime: '10:00',
    allDay: false,
    eventId: 'g1',
    creator: { email: 'me@example.com', self: true },
    rooms: [ROOM],
    rsvps: { [ROOM]: 'declined' },
    ...over,
  };
}

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('회의실 거절 기록', () => {
  it('거절한 회의실이 있는 **내 앞으로의 일정**을 적재한다', () => {
    syncRoomConflictNotices([ev()], NOW);
    const list = listRoomConflictNotices();
    expect(list).toHaveLength(1);
    expect(list[0]!.kind).toBe('room_conflict');
    expect(list[0]!.preview).toBe('팀 싱크');
    expect(list[0]!.calendar).toEqual({ date: '2026-09-25', eventId: 'g1', source: 'google', body: '회의실이 예약을 거절했어요 — room-35-01' });
    expect(list[0]!.read).toBe(false);
  });

  it('두 번 훑어도 한 건 — 같은 회차는 같은 열쇠다(60초마다 다시 온다)', () => {
    syncRoomConflictNotices([ev()], NOW);
    syncRoomConflictNotices([ev()], NOW + 60_000);
    expect(listRoomConflictNotices()).toHaveLength(1);
  });

  it('반복 일정은 **회차마다** 따로 센다 — 거절도 회차마다 따로다', () => {
    syncRoomConflictNotices([ev(), ev({ startDate: '2026-10-02', endDate: '2026-10-02' })], NOW);
    expect(listRoomConflictNotices()).toHaveLength(2);
  });

  it('남이 만든 일정·지난 일정·거절이 없는 일정은 적재하지 않는다', () => {
    syncRoomConflictNotices(
      [
        // 남이 잡은 방 — 내가 고칠 수 없는 알림은 소음이다.
        ev({ eventId: 'g2', creator: { email: 'other@example.com' } }),
        // 지난 일정 — 이미 끝난 일이다.
        ev({ eventId: 'g3', startDate: '2026-09-01', endDate: '2026-09-01' }),
        // 방이 받아들인 일정.
        ev({ eventId: 'g4', rsvps: { [ROOM]: 'accepted' } }),
        // 회의실이 아예 없는 일정.
        ev({ eventId: 'g5', rooms: [], rsvps: {} }),
      ],
      NOW,
    );
    expect(listRoomConflictNotices()).toEqual([]);
  });

  it('공유 캘린더에 만든 일정도 내 것이다 — 구글은 `organizer`를 그 캘린더로 둔다', () => {
    syncRoomConflictNotices([ev({ creator: { email: 'me@example.com', self: true }, organizer: { email: 'team@example.com' } })], NOW);
    expect(listRoomConflictNotices()).toHaveLength(1);
  });

  it('시간을 옮겨 방이 받아들이면 기록을 **지운다** — 그 사실을 실제로 본 경우만', () => {
    syncRoomConflictNotices([ev()], NOW);
    expect(listRoomConflictNotices()).toHaveLength(1);
    // 목록에 없는 일정은 범위 밖일 수도 있으므로 건드리지 않는다.
    syncRoomConflictNotices([], NOW + 60_000);
    expect(listRoomConflictNotices()).toHaveLength(1);
    // 같은 일정이 거절 없이 왔다 — 그때 지운다.
    syncRoomConflictNotices([ev({ rsvps: { [ROOM]: 'accepted' } })], NOW + 120_000);
    expect(listRoomConflictNotices()).toEqual([]);
  });

  it('바뀐 것이 없으면 **쓰지 않는다** — 쓰면 신호가 돌아 우편함이 되풀이 갱신된다', () => {
    let hits = 0;
    const off = onRoomConflictInboxChange(() => {
      hits += 1;
    });
    syncRoomConflictNotices([ev()], NOW);
    expect(hits).toBe(1);
    syncRoomConflictNotices([ev()], NOW + 1000);
    expect(hits).toBe(1);
    off();
  });

  it('이름을 아는 방은 이름으로, 셋 이상이면 꼬리를 접는다', () => {
    const rooms = ['a@resource.calendar.google.com', 'b@resource.calendar.google.com', 'c@resource.calendar.google.com'];
    const rsvps = Object.fromEntries(rooms.map((r) => [r, 'declined' as const]));
    expect(roomConflictLabel({ rooms: [rooms[0]!], rsvps, names: { [rooms[0]!]: '35층 회의실' } })).toBe('35층 회의실');
    expect(roomConflictLabel({ rooms, rsvps, names: { [rooms[0]!]: '가', [rooms[1]!]: '나', [rooms[2]!]: '다' } })).toBe('가, 나 외 1곳');
  });

  it('열면 전부 읽음 — 서버 알림과 같은 규칙', () => {
    syncRoomConflictNotices([ev()], NOW);
    markRoomConflictNoticesRead();
    expect(listRoomConflictNotices()[0]!.read).toBe(true);
  });

  it('나이가 지난 기록은 목록에서 빠진다(14일)', () => {
    syncRoomConflictNotices([ev()], Date.now() - 15 * 24 * 3600_000);
    expect(listRoomConflictNotices()).toEqual([]);
  });
});

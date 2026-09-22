import { describe, expect, it } from 'vitest';
import { groupRooms, guestSub, meetNote, withOrganizer } from './GoogleEventFields';
import { inputToGoogleDraft, withSelfAccepted } from './newEventSubmit';
import { attendeesBody, declinedRooms, RECURRENCE_OFF } from './googleCalendar';

describe('참석자 머리 문구(guestSub)', () => {
  it('주최자가 따로 있으면 "일정을 만든 사람 외 N명"', () => {
    expect(guestSub(2, true)).toBe('일정을 만든 사람 외 2명 초대');
    expect(guestSub(0, true)).toBe('일정을 만든 사람 외에 초대한 사람이 없어요');
    expect(guestSub(3, false)).toBe('3명 초대');
    expect(guestSub(0, false)).toBe('아직 초대한 사람이 없어요');
  });
});

describe('주최자 되돌려 넣기(withOrganizer)', () => {
  it('화면에서 뺀 주최자를 **원래 자리**에 되돌린다 — 순서가 바뀌면 PATCH가 변경으로 오해한다', () => {
    const original = ['a@x.com', 'boss@x.com', 'c@x.com'];
    expect(withOrganizer(original, 'boss@x.com', ['a@x.com', 'c@x.com'])).toEqual(original);
    // 참석자를 지워도 주최자는 남는다
    expect(withOrganizer(original, 'boss@x.com', ['a@x.com'])).toEqual(['a@x.com', 'boss@x.com']);
    // 추가하면 뒤에 붙는다
    expect(withOrganizer(original, 'boss@x.com', ['a@x.com', 'c@x.com', 'd@x.com'])).toEqual(['a@x.com', 'boss@x.com', 'c@x.com', 'd@x.com']);
  });
  it('주최자가 배열에 없었거나 모르면 그대로다', () => {
    expect(withOrganizer(['a@x.com'], 'boss@x.com', ['a@x.com', 'b@x.com'])).toEqual(['a@x.com', 'b@x.com']);
    expect(withOrganizer(['a@x.com'], '', ['a@x.com'])).toEqual(['a@x.com']);
  });
});

describe('회의실 묶기(groupRooms)', () => {
  const rooms = ['busy', 'free', 'pending', 'unknown', 'free2'].map((email) => ({ email }));
  const busyOf = (e: string) => (e === 'busy' ? true : e.startsWith('free') ? false : e === 'unknown' ? null : undefined);
  it('사용 가능 → 사용 중 → 확인 중 → 확인할 수 없음, 빈 묶음은 없다', () => {
    expect(groupRooms(rooms, busyOf).map((g) => [g.key, g.label, g.rooms.map((r) => r.email)])).toEqual([
      ['free', '사용 가능', ['free', 'free2']],
      ['busy', '사용 중', ['busy']],
      ['pending', '확인 중', ['pending']],
      ['unknown', '확인할 수 없음', ['unknown']],
    ]);
    expect(groupRooms([{ email: 'x' }], () => false).map((g) => g.key)).toEqual(['free']);
  });
});

describe('Meet 토글 안내(meetNote)', () => {
  it('지금 누르면 무슨 일이 일어나는지 말한다 — 이미 등록된 일정은 링크 유무로 갈린다', () => {
    expect(meetNote('create', false, false)).toContain('켜면');
    expect(meetNote('create', true, false)).toContain('등록하면');
    // 이미 링크가 있는 일정(요청 ④) — 켜져 있으면 사실을, 끄면 그 결과를 말한다.
    expect(meetNote('edit', true, true)).toBe('회의 링크가 초대장에 들어가 있어요');
    expect(meetNote('edit', false, true)).toBe('저장하면 회의 링크가 사라져요');
    // 링크가 없는 구글 일정에서 켜면 저장할 때 만들어진다.
    expect(meetNote('edit', true, false)).toBe('저장하면 회의 링크가 만들어져요');
    expect(meetNote('edit', false, false)).toContain('켜면');
  });
});

describe('종일 일정의 알림(inputToGoogleDraft)', () => {
  const base = { title: '회의', startDate: '2026-09-15', endDate: '2026-09-15', allDay: false, startTime: '10:30', endTime: '11:30' };
  const fields = { attendees: [], rooms: [], visibility: 'default' as const, transparency: 'opaque' as const, reminderMinutes: 10, recurrence: RECURRENCE_OFF, addMeet: false };

  it('시각 일정은 고른 값을 그대로 싣는다', () => {
    expect(inputToGoogleDraft(base, fields).reminderMinutes).toBe(10);
  });

  it('종일이면 싣지 않는다 — 화면이 못 고르게 막아 둔 값이 저장되면 안 된다(제보)', () => {
    // 시각으로 고른 뒤 종일로 바꾼 초안 — `undefined`는 "안 건드린다"라 그 캘린더의
    // 기본이 그대로 적용된다(우리가 알림을 지어내지도, 지우지도 않는다).
    const draft = inputToGoogleDraft({ ...base, allDay: true }, fields);
    expect(draft.reminderMinutes).toBeUndefined();
  });
});

describe('내가 만든 일정에는 내가 참석한다(withSelfAccepted — 요청 3)', () => {
  it('사람을 초대한 일정에는 나를 **뒤에** 붙이고 응답을 `참석`으로 싣는다', () => {
    expect(withSelfAccepted(['a@x.com'], 'me@x.com')).toEqual({
      attendees: ['a@x.com', 'me@x.com'],
      rsvps: { 'me@x.com': 'accepted' },
    });
  });

  it('아무도 초대하지 않은 일정은 **그대로 둔다** — 혼자 쓰는 일정에 손님 목록을 만들지 않는다', () => {
    expect(withSelfAccepted([], 'me@x.com')).toEqual({ attendees: [] });
  });

  it('내가 이미 참석자 칸에 있으면 **중복을 만들지 않고 응답만 올린다**', () => {
    // 키는 배열에 든 **그 표기 그대로**여야 한다 — `attendeesBody`가 정확한 문자열로 찾는다.
    expect(withSelfAccepted(['a@x.com', 'Me@X.com'], 'me@x.com')).toEqual({
      attendees: ['a@x.com', 'Me@X.com'],
      rsvps: { 'Me@X.com': 'accepted' },
    });
  });

  it('내 주소를 모르면(연동 직후 목록이 아직 없다) 아무것도 하지 않는다', () => {
    expect(withSelfAccepted(['a@x.com'])).toEqual({ attendees: ['a@x.com'] });
  });

  it('초안까지 이어진다 — `attendees`와 `rsvps`가 함께 실린다', () => {
    const base = { title: '회의', startDate: '2026-09-15', endDate: '2026-09-15', allDay: false, startTime: '10:30', endTime: '11:30' };
    const fields = { attendees: ['a@x.com'], rooms: [], visibility: 'default' as const, transparency: 'opaque' as const, reminderMinutes: 10, recurrence: RECURRENCE_OFF, addMeet: false };
    const draft = inputToGoogleDraft(base, fields, 'me@x.com');
    expect(draft.attendees).toEqual(['a@x.com', 'me@x.com']);
    expect(draft.rsvps).toEqual({ 'me@x.com': 'accepted' });
    // 구글로 나가는 본문에서도 그렇다(출력 전용 필드는 보내지 않는다).
    expect(attendeesBody(draft)).toEqual([{ email: 'a@x.com' }, { email: 'me@x.com', responseStatus: 'accepted' }]);
  });
});

describe('화면에서 뺀 사람들을 제자리에(withOrganizer — 둘일 수 있다)', () => {
  it('주최자와 나를 **함께** 빼 두었다가 제자리에 되돌린다', () => {
    const original = ['boss@x.com', 'a@x.com', 'me@x.com'];
    // 화면에는 `a@x.com`만 보인다(주최자와 나는 뺐다).
    expect(withOrganizer(original, ['boss@x.com', 'me@x.com'], ['a@x.com'])).toEqual(original);
    // 손님을 하나 더 더하면 뒤에 붙는다.
    expect(withOrganizer(original, ['boss@x.com', 'me@x.com'], ['a@x.com', 'c@x.com'])).toEqual(['boss@x.com', 'a@x.com', 'me@x.com', 'c@x.com']);
    // 손님을 전부 지워도 둘은 남는다.
    expect(withOrganizer(original, ['boss@x.com', 'me@x.com'], [])).toEqual(['boss@x.com', 'me@x.com']);
  });
});

describe('예약을 거절한 회의실(declinedRooms — 요청 4)', () => {
  it('회의실의 `declined`만 고른다 — 사람의 불참은 다른 이야기다', () => {
    expect(
      declinedRooms({
        rooms: ['room-a@x.com', 'room-b@x.com'],
        rsvps: { 'room-a@x.com': 'declined', 'room-b@x.com': 'accepted', 'who@x.com': 'declined' },
      }),
    ).toEqual(['room-a@x.com']);
  });

  it('회의실이 없거나 아직 답하지 않았으면 빈 배열이다 — 없는 경고를 만들지 않는다', () => {
    expect(declinedRooms({})).toEqual([]);
    expect(declinedRooms({ rooms: ['room-a@x.com'], rsvps: { 'room-a@x.com': 'needsAction' } })).toEqual([]);
  });
});

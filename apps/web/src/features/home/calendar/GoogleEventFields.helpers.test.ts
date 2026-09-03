import { describe, expect, it } from 'vitest';
import { groupRooms, guestSub, meetNote, withOrganizer } from './GoogleEventFields';

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

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { GOOGLE_CALENDAR_SCOPE, GOOGLE_EVENT_COLORS, myRsvpOf, attendeesBody, RECURRENCE_OFF, buildRecurrence, draftToBody, eventColorOf, fetchEventColors, googleWriteError, managedFieldsDiffer, updateGoogleEvent, recurrenceSummary, isDayOffHoliday, isHolidayCalendarId, onTokenChange, scopeCovers, parseCalendarList, parseEvents, readStoredToken, splitGoogleDateTime, storeToken, type GoogleCalendarMeta } from './googleCalendar';
import { googleEntries, holidayMap } from './entries';
import { draftFrom, patchFrom } from './GoogleEventDetail';
import { submitNewEvent } from './newEventSubmit';

// 구글 응답 → 우리 모델. 네트워크·GIS는 붙이지 않는다(순수 변환만 검증).

const CAL: GoogleCalendarMeta = { id: 'me@example.com', summary: '내 캘린더', color: '#4285f4', primary: true };
const HOL: GoogleCalendarMeta = { id: 'ko.south_korea#holiday@group.v.calendar.google.com', summary: '대한민국의 휴일', holiday: true };

describe('구글 캘린더 — 응답 해석', () => {
  it('캘린더 목록: 숨긴 것은 빼고, 기본 → 이름순으로 세운다', () => {
    const list = parseCalendarList({
      items: [
        { id: 'b@x', summary: '나중' },
        { id: 'hidden@x', summary: '숨김', hidden: true },
        { id: 'me@example.com', summary: '내 캘린더', primary: true, backgroundColor: '#4285f4' },
        { id: 'a@x', summaryOverride: '먼저' },
      ],
    });
    expect(list.map((c) => c.summary)).toEqual(['내 캘린더', '나중', '먼저']);
    expect(list[0]!.color).toBe('#4285f4');
  });

  it('공휴일 캘린더는 id로 알아본다', () => {
    expect(isHolidayCalendarId(HOL.id)).toBe(true);
    expect(isHolidayCalendarId('me@example.com')).toBe(false);
    expect(parseCalendarList({ items: [{ id: HOL.id, summary: '휴일' }] })[0]!.holiday).toBe(true);
  });

  it('종일 일정의 end.date는 배타적이라 하루를 뺀다', () => {
    const [e] = parseEvents({ items: [{ id: 'x', summary: '휴가', start: { date: '2026-08-10' }, end: { date: '2026-08-13' } }] }, CAL);
    expect(e).toMatchObject({ startDate: '2026-08-10', endDate: '2026-08-12', allDay: true });
  });

  it('시각 일정은 로컬 날짜·HH:MM으로 나눈다', () => {
    const parsed = splitGoogleDateTime({ dateTime: '2026-08-10T09:30:00+09:00' });
    expect(parsed?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(parsed?.time).toMatch(/^\d{2}:\d{2}$/);
  });

  it('취소된 회차와 id 없는 항목은 버린다', () => {
    const out = parseEvents({ items: [{ id: 'a', status: 'cancelled', start: { date: '2026-08-10' } }, { summary: 'id 없음', start: { date: '2026-08-10' } }] }, CAL);
    expect(out).toEqual([]);
  });

  it('일정 id에 캘린더 id를 붙인다 — 캘린더가 달라도 부딪히지 않는다', () => {
    const [a] = parseEvents({ items: [{ id: 'same', summary: 'A', start: { date: '2026-08-10' }, end: { date: '2026-08-11' } }] }, CAL);
    const [b] = parseEvents({ items: [{ id: 'same', summary: 'B', start: { date: '2026-08-10' }, end: { date: '2026-08-11' } }] }, HOL);
    expect(a!.id).not.toBe(b!.id);
  });
});

describe('구글 캘린더 — 화면 항목', () => {
  const events = [
    ...parseEvents({ items: [{ id: 'm1', summary: '회의', start: { dateTime: '2026-08-10T09:00:00+09:00' }, end: { dateTime: '2026-08-10T10:00:00+09:00' }, htmlLink: 'https://cal' }] }, CAL),
    ...parseEvents({ items: [{ id: 'h1', summary: '광복절', start: { date: '2026-08-15' }, end: { date: '2026-08-16' } }] }, HOL),
  ];

  it('공휴일은 칩이 아니라 날짜 색으로 — 항목 목록에서 빠진다', () => {
    const list = googleEntries(events);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ title: '회의', spaceName: 'Google 캘린더', readOnly: true });
    expect(list[0]!.google).toBeTruthy();
  });

  it('공휴일 맵은 연휴를 하루씩 채운다', () => {
    const long = parseEvents({ items: [{ id: 'h2', summary: '설 연휴', description: 'Public holiday', start: { date: '2026-02-16' }, end: { date: '2026-02-19' } }] }, HOL);
    expect(holidayMap(long)).toEqual({
      '2026-02-16': { name: '설 연휴', dayOff: true },
      '2026-02-17': { name: '설 연휴', dayOff: true },
      '2026-02-18': { name: '설 연휴', dayOff: true },
    });
  });

  // 구글의 공휴일 캘린더에는 24절기·기념일까지 들어 있다 — 그걸 다 칠하면 달이
  // 통째로 분홍이 된다(제보). 이름은 남기고 **쉬는 날일 때만** 칠한다.
  it('쉬는 날이 아닌 절기·기념일은 이름만 남고 칠하지 않는다', () => {
    const mixed = parseEvents(
      {
        items: [
          { id: 'h3', summary: '광복절', description: 'Public holiday', start: { date: '2026-08-15' }, end: { date: '2026-08-16' } },
          { id: 'h4', summary: '입추', description: 'Season', start: { date: '2026-08-07' }, end: { date: '2026-08-08' } },
          { id: 'h5', summary: '칠석', description: 'Observance', start: { date: '2026-08-19' }, end: { date: '2026-08-20' } },
          // 표기가 없으면 **칠하지 않는다** — 모르는 로케일에서 달이 분홍이 되는 쪽보다 낫다.
          { id: 'h6', summary: '알 수 없는 날', start: { date: '2026-08-21' }, end: { date: '2026-08-22' } },
        ],
      },
      HOL,
    );
    expect(holidayMap(mixed)).toEqual({
      '2026-08-15': { name: '광복절', dayOff: true },
      '2026-08-07': { name: '입추', dayOff: false },
      '2026-08-19': { name: '칠석', dayOff: false },
      '2026-08-21': { name: '알 수 없는 날', dayOff: false },
    });
  });

  it('한국어 표기도 읽는다 — 공휴일은 칠하고 기념일은 아니다', () => {
    expect(isDayOffHoliday('대한민국의 공휴일')).toBe(true);
    expect(isDayOffHoliday('기념일')).toBe(false);
    expect(isDayOffHoliday('Observance')).toBe(false);
    expect(isDayOffHoliday(undefined)).toBe(false);
  });

  // 쓸 수 있는 캘린더의 일정은 **끌어서 옮길 수 있다**(PR6) — 공휴일·보기 전용은 아니다.
  it('쓸 수 없는 캘린더의 항목만 읽기 전용이다', () => {
    expect(googleEntries(events).every((e) => e.readOnly)).toBe(true);
    const writableCal: GoogleCalendarMeta = { ...CAL, writable: true };
    const mine = parseEvents({ items: [{ id: 'w1', summary: '회의', start: { dateTime: '2026-08-10T09:00:00+09:00' }, end: { dateTime: '2026-08-10T10:00:00+09:00' } }] }, writableCal);
    expect(googleEntries(mine)[0]?.readOnly).toBeUndefined();
    expect(mine[0]?.writable).toBe(true);
  });

  it('accessRole이 owner·writer면 쓸 수 있는 캘린더다', () => {
    const list = parseCalendarList({
      items: [
        { id: 'mine', summary: '내 캘린더', accessRole: 'owner' },
        { id: 'team', summary: '팀', accessRole: 'writer' },
        { id: 'peek', summary: '남의 것', accessRole: 'reader' },
      ],
    });
    expect(list.find((c) => c.id === 'mine')?.writable).toBe(true);
    expect(list.find((c) => c.id === 'team')?.writable).toBe(true);
    expect(list.find((c) => c.id === 'peek')?.writable).toBeUndefined();
  });
});

describe('구글 캘린더 — 토큰 보관', () => {
  beforeEach(() => sessionStorage.clear());

  it('만료된 토큰은 없는 것으로 본다(요청 도중 죽지 않게 60초 여유)', () => {
    const now = Date.now();
    storeToken({ accessToken: 't', expiresAt: now + 30_000, scope: GOOGLE_CALENDAR_SCOPE });
    expect(readStoredToken(now)).toBeNull();
    storeToken({ accessToken: 't', expiresAt: now + 600_000, scope: GOOGLE_CALENDAR_SCOPE });
    expect(readStoredToken(now)?.accessToken).toBe('t');
  });

  // 스코프를 넓힌 배포(PR6) 뒤에도 옛 토큰이 남으면 **쓰기만** 403으로 죽는다 —
  // 그럴 바엔 없는 것으로 보고 다시 받게 한다("다시 연결" 한 번).
  it('권한이 모자란 옛 토큰은 없는 것으로 본다', () => {
    const now = Date.now();
    storeToken({ accessToken: 't', expiresAt: now + 600_000, scope: 'https://www.googleapis.com/auth/calendar.readonly' });
    expect(readStoredToken(now)).toBeNull();
    // 스코프를 아예 모르는 값(더 옛 판이 심은 것)도 마찬가지
    storeToken({ accessToken: 't', expiresAt: now + 600_000 });
    expect(readStoredToken(now)).toBeNull();
  });

  // 제보 — 설정 모달에서 연결해도 뒤의 일정 화면은 새로고침해야 떴다: 토큰은 탭
  // sessionStorage에만 살고 훅 인스턴스가 화면마다 따로라, 한쪽의 연결을 다른 쪽이
  // 알 길이 없었다. storeToken이 구독자에게 알리는 것이 그 다리다(tokenTick).
  it('토큰이 바뀌면 구독자에게 알린다 — 연결·해제 모두(해지한 구독자는 조용하다)', () => {
    const now = Date.now();
    const seen: number[] = [];
    const off = onTokenChange(() => seen.push(1));
    storeToken({ accessToken: 't', expiresAt: now + 600_000, scope: GOOGLE_CALENDAR_SCOPE });
    expect(seen.length).toBe(1);
    storeToken(null); // 해제도 같은 신호다 — 화면이 "다시 연결"로 바뀌어야 한다
    expect(seen.length).toBe(2);
    off();
    storeToken({ accessToken: 't2', expiresAt: now + 600_000, scope: GOOGLE_CALENDAR_SCOPE });
    expect(seen.length).toBe(2);
  });

  it('필요한 스코프를 다 담았는지 본다', () => {
    expect(scopeCovers(GOOGLE_CALENDAR_SCOPE)).toBe(true);
    expect(scopeCovers(`${GOOGLE_CALENDAR_SCOPE} openid email`)).toBe(true);
    expect(scopeCovers('https://www.googleapis.com/auth/calendar.events')).toBe(false);
    expect(scopeCovers(undefined)).toBe(false);
  });

  it('손상된 값은 조용히 버린다', () => {
    sessionStorage.setItem('mf_gcal_token', '{oops');
    expect(readStoredToken()).toBeNull();
  });

  it('탭 저장소를 쓴다 — 창을 닫으면 사라진다(localStorage에 남기지 않는다)', () => {
    storeToken({ accessToken: 't', expiresAt: Date.now() + 600_000, scope: GOOGLE_CALENDAR_SCOPE });
    expect(sessionStorage.getItem('mf_gcal_token')).toBeTruthy();
    expect(localStorage.getItem('mf_gcal_token')).toBeNull();
  });
});

describe('구글 캘린더 — 쓰기 본문(PR6)', () => {
  it('종일 일정의 끝날은 **다음 날**로 보낸다(구글의 end.date는 배타적)', () => {
    const body = draftToBody({ title: '휴가', allDay: true, startDate: '2026-08-10', endDate: '2026-08-12' });
    expect(body).toMatchObject({ summary: '휴가', start: { date: '2026-08-10' }, end: { date: '2026-08-13' } });
  });

  it('시각 일정은 시간대를 함께 보낸다 — 없으면 구글이 다른 시각에 놓는다', () => {
    const body = draftToBody({ title: '회의', allDay: false, startDate: '2026-08-10', endDate: '2026-08-10', startTime: '09:30', endTime: '10:30' }) as {
      start: { dateTime: string; timeZone: string };
      end: { dateTime: string };
    };
    expect(body.start.dateTime).toBe('2026-08-10T09:30:00');
    expect(body.end.dateTime).toBe('2026-08-10T10:30:00');
    expect(body.start.timeZone).toBeTruthy();
  });

  it('빈 위치·메모는 **빈 문자열로** 보낸다 — 키를 빼면 지운 것이 저장되지 않는다', () => {
    const body = draftToBody({ title: 'x', allDay: true, startDate: '2026-08-10', endDate: '2026-08-10' });
    expect(body).toMatchObject({ location: '', description: '' });
  });

  it('상태 코드를 사람이 읽을 문장으로 — 412는 "그 사이 바뀌었다"', () => {
    expect(googleWriteError({ status: 412 })).toContain('바뀌었어요');
    expect(googleWriteError({ status: 403 })).toContain('권한');
    expect(googleWriteError({ status: 500 })).toContain('저장하지 못했어요');
  });
});

describe('구글 일정 상세 — 부분 수정 옮기기(PR6)', () => {
  const g = parseEvents(
    { items: [{ id: 'e1', summary: '회의', location: '3층', description: '메모', start: { dateTime: '2026-08-10T09:00:00+09:00' }, end: { dateTime: '2026-08-10T10:00:00+09:00' } }] },
    { ...CAL, writable: true },
  )[0]!;

  it('바꾸지 않은 값은 그대로 실어 보낸다(PATCH가 지우지 않게)', () => {
    // 시각은 실행 환경의 시간대에 따라 달라지므로 **원본과 같은지**로 본다.
    expect(draftFrom(g, { startDate: '2026-08-11' })).toMatchObject({
      title: '회의',
      allDay: false,
      startDate: '2026-08-11',
      startTime: g.startTime,
      endTime: g.endTime,
      location: '3층',
      description: '메모',
    });
  });

  it('종일로 바꾸면 시각은 사라진다 — 구글도 date만 받는다', () => {
    const d = draftFrom(g, { allDay: true, startTime: undefined, endTime: undefined });
    expect(d.allDay).toBe(true);
    expect(d.startTime).toBeUndefined();
    expect(d.endTime).toBeUndefined();
  });

  it('메모를 비우면 빈 문자열로 — 지운 것이 저장된다', () => {
    expect(draftFrom(g, { note: '' }).description).toBe('');
  });
});

describe('새 일정 목적지(PR6)', () => {
  const input = { title: '회의', startDate: '2026-08-10', endDate: '2026-08-10', allDay: false, startTime: '09:00', endTime: '10:00', note: '준비물' };

  it('Geurio를 고르면 우리 표에만 만든다', async () => {
    const createGeurio = vi.fn(async () => null);
    const createGoogle = vi.fn(async () => null);
    expect(await submitNewEvent(input, { kind: 'geurio' }, { createGeurio, createGoogle })).toBeNull();
    expect(createGeurio).toHaveBeenCalledTimes(1);
    expect(createGoogle).not.toHaveBeenCalled();
  });

  it('구글을 고르면 그 캘린더에만 만든다(메모는 description으로)', async () => {
    const createGeurio = vi.fn(async () => null);
    const createGoogle = vi.fn(async () => null);
    await submitNewEvent(input, { kind: 'google', calendarId: 'me@example.com', fields: { attendees: ['a@b.com'], rooms: [], visibility: 'private', transparency: 'transparent', reminderMinutes: 10, recurrence: { on: true, unit: 'week', interval: 2, endMode: 'count', count: 5 }, addMeet: true } }, { createGeurio, createGoogle });
    expect(createGeurio).not.toHaveBeenCalled();
    expect(createGoogle).toHaveBeenCalledWith(
      'me@example.com',
      expect.objectContaining({
        title: '회의',
        description: '준비물',
        attendees: ['a@b.com'],
        visibility: 'private',
        transparency: 'transparent',
        reminderMinutes: 10,
        recurrence: ['RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=5'],
        addMeet: true,
      }),
    );
  });
});

describe('구글 전용 필드(PR6 후속 — 디자인 원본 nIsGoogle)', () => {
  it('반복 설정 → RRULE. 꺼져 있으면 아무것도 보내지 않는다', () => {
    expect(buildRecurrence(RECURRENCE_OFF)).toBeUndefined();
    expect(buildRecurrence({ on: true, unit: 'day', interval: 1, endMode: 'none' })).toEqual(['RRULE:FREQ=DAILY']);
    expect(buildRecurrence({ on: true, unit: 'week', interval: 3, endMode: 'none' })).toEqual(['RRULE:FREQ=WEEKLY;INTERVAL=3']);
    expect(buildRecurrence({ on: true, unit: 'month', interval: 1, endMode: 'count', count: 6 })).toEqual(['RRULE:FREQ=MONTHLY;COUNT=6']);
    expect(buildRecurrence({ on: true, unit: 'week', interval: 1, endMode: 'date', until: '2026-12-31' })).toEqual(['RRULE:FREQ=WEEKLY;UNTIL=20261231T235959Z']);
  });

  it('반복 요약은 지금 설정을 한 줄로(디자인 원본 nRepSummary)', () => {
    expect(recurrenceSummary(RECURRENCE_OFF)).toBe('반복하지 않아요');
    expect(recurrenceSummary({ on: true, unit: 'week', interval: 2, endMode: 'count', count: 5 })).toBe('2주마다 · 5회 반복 후 종료');
    expect(recurrenceSummary({ on: true, unit: 'day', interval: 1, endMode: 'none' })).toBe('일마다 · 종료 없음');
  });

  it('알림 셋을 가른다 — 기본 알림 / 없음 / N분 전', () => {
    const one = (reminders: unknown) => parseEvents({ items: [{ id: 'r', summary: 'x', start: { date: '2026-08-10' }, end: { date: '2026-08-11' }, reminders }] }, CAL)[0]!;
    // useDefault면 키가 없다 — "캘린더 기본"이라는 뜻이다.
    expect('reminderMinutes' in one({ useDefault: true })).toBe(false);
    expect(one({ useDefault: false, overrides: [] }).reminderMinutes).toBeNull();
    expect(one({ useDefault: false, overrides: [{ method: 'popup', minutes: 30 }] }).reminderMinutes).toBe(30);
  });

  it('참석자·공개·참여·Meet 링크를 읽는다', () => {
    const e = parseEvents(
      {
        items: [
          {
            id: 'g',
            summary: '회의',
            start: { date: '2026-08-10' },
            end: { date: '2026-08-11' },
            attendees: [{ email: 'a@b.com' }, { email: 'c@d.com' }, { displayName: '이메일 없음' }],
            visibility: 'private',
            transparency: 'transparent',
            hangoutLink: 'https://meet.google.com/abc',
          },
        ],
      },
      CAL,
    )[0]!;
    expect(e.attendees).toEqual(['a@b.com', 'c@d.com']);
    expect(e.visibility).toBe('private');
    expect(e.transparency).toBe('transparent');
    expect(e.meetLink).toBe('https://meet.google.com/abc');
  });

  it('본문에 구글 전용 필드를 싣는다 — 빈 참석자도 보낸다(전원 취소가 저장되게)', () => {
    const body = draftToBody({ title: 'x', allDay: true, startDate: '2026-08-10', endDate: '2026-08-10', attendees: [], visibility: 'private', transparency: 'transparent', reminderMinutes: 10 });
    expect(body).toMatchObject({
      attendees: [],
      visibility: 'private',
      transparency: 'transparent',
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 10 }] },
    });
    // 알림을 안 정하면 캘린더 기본을 쓴다
    expect(draftToBody({ title: 'x', allDay: true, startDate: '2026-08-10', endDate: '2026-08-10' })).toMatchObject({ reminders: { useDefault: true } });
    // Meet은 켰을 때만 요청한다
    expect(draftToBody({ title: 'x', allDay: true, startDate: '2026-08-10', endDate: '2026-08-10', addMeet: true })).toHaveProperty('conferenceData');
  });

  it('상세의 부분 수정은 바꾸지 않은 구글 필드도 그대로 실어 보낸다', () => {
    const g = parseEvents(
      { items: [{ id: 'e1', summary: '회의', start: { date: '2026-08-10' }, end: { date: '2026-08-11' }, attendees: [{ email: 'a@b.com' }], visibility: 'private', reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 60 }] } }] },
      { ...CAL, writable: true },
    )[0]!;
    // 제목만 바꿔도 참석자·공개·알림이 유지된다(PATCH에서 빠지면 조용히 지워진다)
    expect(draftFrom(g, { title: '새 제목' })).toMatchObject({ title: '새 제목', attendees: ['a@b.com'], visibility: 'private', reminderMinutes: 60 });
    // 필드 묶음이 바꾼 값은 이긴다
    expect(draftFrom(g, {}, { attendees: [], reminderMinutes: undefined })).toMatchObject({ attendees: [] });
    expect('reminderMinutes' in draftFrom(g, {}, { reminderMinutes: undefined })).toBe(false);
  });

  // 제보 — 제목만 고쳐도 `start`가 함께 실려, 구글이 그 시각을 거절하면(400
  // `Invalid start time.`) **손대지 않은 필드 때문에** 저장이 통째로 막혔다.
  // 실은 것이 곧 바꿀 것이어야 원인과 결과가 맞는다.
  it('PATCH는 바뀐 것만 싣는다 — 제목 수정에 날짜가 따라가지 않는다', () => {
    const g = parseEvents(
      { items: [{ id: 'e1', summary: '회의', start: { dateTime: '2026-08-10T09:00:00+09:00' }, end: { dateTime: '2026-08-10T10:00:00+09:00' }, attendees: [{ email: 'a@b.com' }] }] },
      { ...CAL, writable: true },
    )[0]!;

    const titleOnly = patchFrom(g, { title: '새 제목' });
    expect(Object.keys(titleOnly.body)).toEqual(['summary']);
    expect(titleOnly.touched).toEqual(['title']);

    // 끌어서 옮기면 날짜 짝만 — 구글은 `start`/`end`의 종류가 섞이면 거절하므로 짝이다.
    const moved = patchFrom(g, { startDate: '2026-08-12', endDate: '2026-08-12' });
    expect(Object.keys(moved.body).sort()).toEqual(['end', 'start']);
    expect(moved.touched).toEqual(['when']);

    // 지운 값은 **빈 문자열로** 보낸다(키를 빼면 "안 바꾼다"로 읽힌다).
    expect(patchFrom(g, { location: '' }).body).toEqual({ location: '' });
    // 참석자를 비우는 것도 그 배열만
    const guests = patchFrom(g, {}, { attendees: [] });
    expect(guests.body).toEqual({ attendees: [] });
    expect(guests.touched).toEqual(['attendees']);
    // 아무것도 안 바뀌면 보낼 것이 없다
    expect(patchFrom(g, {}).body).toEqual({});
  });

  // 라이브 제보의 그 400 — 종일 일정을 상세에서 **시각 일정으로** 바꾸면 거절됐다.
  // 구글의 patch는 중첩 객체까지 필드 단위로 병합하므로, 저장된 `start: { date }` 위에
  // `start: { dateTime }`을 얹으면 병합 결과에 **둘이 함께 남아** 유효하지 않다.
  // 그래서 PATCH는 쓰지 않는 쪽을 `null`로 지운다(insert에는 지울 것이 없다).
  it('종일 ↔ 시각을 오갈 때 쓰지 않는 쪽을 null로 지운다', () => {
    const allDayEvent = parseEvents({ items: [{ id: 'e1', summary: '종일 회의', start: { date: '2026-09-27' }, end: { date: '2026-09-28' } }] }, { ...CAL, writable: true })[0]!;
    // 종일 → 시각: `date`를 지운다(지우지 않으면 `Invalid start time.`)
    const toTimed = patchFrom(allDayEvent, { allDay: false, startTime: '09:00', endTime: '12:00' });
    expect(toTimed.body.start).toMatchObject({ dateTime: '2026-09-27T09:00:00', date: null });
    expect(toTimed.body.end).toMatchObject({ dateTime: '2026-09-27T12:00:00', date: null });

    const timedEvent = parseEvents(
      { items: [{ id: 'e2', summary: '회의', start: { dateTime: '2026-09-27T09:00:00+09:00' }, end: { dateTime: '2026-09-27T10:00:00+09:00' } }] },
      { ...CAL, writable: true },
    )[0]!;
    // 시각 → 종일: `dateTime`을 지운다(반대 방향도 같은 함정이다)
    const toAllDay = patchFrom(timedEvent, { allDay: true });
    expect(toAllDay.body.start).toMatchObject({ date: '2026-09-27', dateTime: null });
    expect(toAllDay.body.end).toMatchObject({ date: '2026-09-28', dateTime: null });

    // 만들 때(POST)는 지울 것이 없다 — `null`을 넣지 않는다.
    const created = draftToBody({ title: 'x', allDay: true, startDate: '2026-09-27', endDate: '2026-09-27' });
    expect(created.start).toEqual({ date: '2026-09-27' });
  });

  // 400은 **우리 요청이 틀렸다**는 뜻이라 "잠시 후 다시"가 거짓말이 된다(제보).
  it('구글이 준 사유를 문장에 담는다', () => {
    expect(googleWriteError({ status: 400, detail: 'Invalid start time.' })).toContain('Invalid start time.');
    expect(googleWriteError({ status: 400 })).toContain('거절');
    expect(googleWriteError({ status: 403 })).toContain('권한');
  });

  // 제보 — 구글 일정을 고치면 412("그 사이 구글에서 바뀌었어요")로 막혔다. 대개는 사람이
  // 고친 게 아니라 **회의실이 스스로 초대를 수락**하는 것 같은 곁가지 변화다: 우리가 다루는
  // 값이 그대로면 새 판을 기준으로 한 번 더 쓴다.
  describe('412 — 그 사이 바뀐 것이 무엇인가', () => {
    const base = parseEvents({ items: [{ id: 'e1', etag: '"v1"', summary: '회의', start: { date: '2026-08-10' }, end: { date: '2026-08-11' }, attendees: [{ email: 'a@b.com' }] }] }, { ...CAL, writable: true })[0]!;

    it('응답 상태만 바뀐 판은 내가 쓰려는 값이 아니면 막지 않는다 — 사람이 고친 값은 다르다', () => {
      const same = parseEvents({ items: [{ id: 'e1', etag: '"v2"', summary: '회의', start: { date: '2026-08-10' }, end: { date: '2026-08-11' }, attendees: [{ email: 'a@b.com', responseStatus: 'accepted' }] }] }, CAL)[0]!;
      const changed = parseEvents({ items: [{ id: 'e1', etag: '"v2"', summary: '남이 고친 제목', start: { date: '2026-08-10' }, end: { date: '2026-08-11' }, attendees: [{ email: 'a@b.com' }] }] }, CAL)[0]!;
      // 제목만 쓰는 저장에는 곁가지 변화(회의실이 스스로 수락 등)가 걸리지 않는다.
      expect(managedFieldsDiffer(base, same, ['title'])).toBe(false);
      expect(managedFieldsDiffer(base, changed, ['title'])).toBe(true);
      // **참석자 배열을 쓰는 저장**은 다르다 — 낡은 배열로 그 응답을 덮게 되므로 막는다.
      expect(managedFieldsDiffer(base, same, ['attendees'])).toBe(true);
    });

    it('곁가지 변화면 새 판(etag)으로 한 번 더 쓴다', async () => {
      const calls: { method: string; etag: string | null }[] = [];
      vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
        const method = (init?.method ?? 'GET') as string;
        const etag = ((init?.headers ?? {}) as Record<string, string>)['If-Match'] ?? null;
        calls.push({ method, etag });
        if (method === 'PATCH' && etag === '"v1"') return { ok: false, status: 412, json: async () => ({}) } as unknown as Response;
        if (method === 'GET') return { ok: true, status: 200, json: async () => ({ id: 'e1', etag: '"v2"', summary: '회의', start: { date: '2026-08-10' }, end: { date: '2026-08-11' }, attendees: [{ email: 'a@b.com', responseStatus: 'accepted' }] }) } as unknown as Response;
        return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
      });
      await updateGoogleEvent('tok', base, { body: { summary: '회의' }, touched: ['title'] });
      expect(calls.map((c) => `${c.method}:${c.etag ?? '-'}`)).toEqual(['PATCH:"v1"', 'GET:-', 'PATCH:"v2"']);
      vi.unstubAllGlobals();
    });

    // 제보의 그 흐름 — 만들고 → 끌어서 날짜를 옮기고 → **내용을 고치면** 412였다.
    // 우리가 보내지도 않는 날짜가 달라졌다는 이유로 막혔던 것이다. PATCH는 보낸 키만
    // 바꾸므로 남의 변경을 덮지도 않는다 — 쓰려는 필드만 견주면 된다.
    it('보내지 않는 필드가 달라진 것은 충돌이 아니다 — 제목 수정은 새 판으로 이어 쓴다', async () => {
      const calls: string[] = [];
      vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
        const method = (init?.method ?? 'GET') as string;
        const etag = ((init?.headers ?? {}) as Record<string, string>)['If-Match'] ?? '-';
        calls.push(`${method}:${etag}`);
        if (method === 'PATCH' && etag === '"v1"') return { ok: false, status: 412, json: async () => ({}) } as unknown as Response;
        // 그 사이 **날짜가** 옮겨져 있다(내 드래그가 만든 판일 수도, 남이 옮긴 것일 수도).
        if (method === 'GET')
          return { ok: true, status: 200, json: async () => ({ id: 'e1', etag: '"v2"', summary: '회의', start: { date: '2026-08-20' }, end: { date: '2026-08-21' }, attendees: [{ email: 'a@b.com' }] }) } as unknown as Response;
        return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
      });
      await updateGoogleEvent('tok', base, { body: { summary: '새 제목' }, touched: ['title'] });
      expect(calls).toEqual(['PATCH:"v1"', 'GET:-', 'PATCH:"v2"']);
      // 반대로 **날짜를 쓰려던** 저장이라면 그건 진짜 충돌이라 막는다.
      calls.length = 0;
      await expect(updateGoogleEvent('tok', base, { body: { start: { date: '2026-08-11' }, end: { date: '2026-08-12' } }, touched: ['when'] })).rejects.toMatchObject({ status: 412 });
      vi.unstubAllGlobals();
    });

    it('사람이 고친 판이면 덮지 않고 그대로 막는다(If-Match를 쓰는 이유)', async () => {
      vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
        const method = (init?.method ?? 'GET') as string;
        if (method === 'PATCH') return { ok: false, status: 412, json: async () => ({}) } as unknown as Response;
        return { ok: true, status: 200, json: async () => ({ id: 'e1', etag: '"v2"', summary: '남이 고친 제목', start: { date: '2026-08-10' }, end: { date: '2026-08-11' } }) } as unknown as Response;
      });
      await expect(updateGoogleEvent('tok', base, { body: { summary: '회의' }, touched: ['title'] })).rejects.toMatchObject({ status: 412 });
      vi.unstubAllGlobals();
    });
  });
});

describe('구글 일정 색(요청 ⑤ — 그 일정에 지정한 색을 그대로)', () => {
  it('일정에 지정한 색이 있으면 그 색, 없으면 캘린더 색', () => {
    const [ev] = parseEvents({ items: [{ id: 'x', summary: '회의', colorId: '11', start: { date: '2026-08-10' }, end: { date: '2026-08-11' } }] }, CAL);
    expect(ev!.colorId).toBe('11');
    // `/colors`로 받은 팔레트가 먼저
    expect(eventColorOf(ev!, { '11': '#ff0000' })).toBe('#ff0000');
    // 못 받았으면 하드코딩 폴백 표(색이 통째로 사라지지 않는다)
    expect(eventColorOf(ev!, {})).toBe(GOOGLE_EVENT_COLORS['11']);
    // 색을 지정하지 않은 일정은 그 캘린더의 색
    const [plain] = parseEvents({ items: [{ id: 'y', summary: '회의', start: { date: '2026-08-10' }, end: { date: '2026-08-11' } }] }, CAL);
    expect(plain!.colorId).toBeUndefined();
    expect(eventColorOf(plain!, { '11': '#ff0000' })).toBe(CAL.color);
  });

  it('`/colors`는 배경 hex만 걸러 읽고, 비었으면 null이다(폴백 표를 쓴다)', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => ({ event: { '1': { background: '#7986cb', foreground: '#1d1d1d' }, '2': { background: 3 } } }) }) as unknown as Response);
    expect(await fetchEventColors('tok')).toEqual({ '1': '#7986cb' });
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => ({}) }) as unknown as Response);
    expect(await fetchEventColors('tok')).toBeNull();
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 403, json: async () => ({}) }) as unknown as Response);
    expect(await fetchEventColors('tok')).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe('초대받은 일정 — 참석 여부·주최자(요청 ③)', () => {
  const INVITED = {
    id: 'inv',
    summary: '팀 회의',
    start: { dateTime: '2026-08-20T09:00:00+09:00' },
    end: { dateTime: '2026-08-20T10:00:00+09:00' },
    organizer: { email: 'boss@example.com', displayName: '팀장' },
    attendees: [
      { email: 'boss@example.com', responseStatus: 'accepted' },
      { email: 'me@example.com', self: true, responseStatus: 'needsAction' },
      { email: 'mate@example.com', responseStatus: 'declined' },
      { email: 'room-1@resource.calendar.google.com', resource: true, responseStatus: 'accepted' },
    ],
  };

  it('주최자·참석자별 응답·나 자신을 읽는다', () => {
    const [ev] = parseEvents({ items: [INVITED] }, CAL);
    expect(ev!.organizer).toEqual({ email: 'boss@example.com', name: '팀장' });
    expect(ev!.selfEmail).toBe('me@example.com');
    expect(ev!.rsvps).toEqual({ 'boss@example.com': 'accepted', 'me@example.com': 'needsAction', 'mate@example.com': 'declined', 'room-1@resource.calendar.google.com': 'accepted' });
    // 회의실은 참석자 줄에 섞이지 않는다(사람만 `attendees`)
    expect(ev!.attendees).toEqual(['boss@example.com', 'me@example.com', 'mate@example.com']);
    expect(ev!.rooms).toEqual(['room-1@resource.calendar.google.com']);
    expect(myRsvpOf(ev!)).toBe('needsAction');
  });

  it('내가 만든 일정에는 내 응답이 없다 — 그때는 참석 여부를 묻지 않는다', () => {
    const [mine] = parseEvents({ items: [{ ...INVITED, organizer: { email: 'me@example.com', self: true }, attendees: [{ email: 'mate@example.com', responseStatus: 'accepted' }] }] }, CAL);
    expect(mine!.organizer?.self).toBe(true);
    expect(mine!.selfEmail).toBeUndefined();
    expect(myRsvpOf(mine!)).toBeUndefined();
  });

  it('참석자 배열을 다시 쓸 때 **남의 응답을 그대로 싣는다** — 이메일만 보내면 모두 미응답으로 되돌아간다', () => {
    const body = attendeesBody({
      attendees: ['boss@example.com', 'me@example.com'],
      rooms: ['room-1@resource.calendar.google.com'],
      rsvps: { 'boss@example.com': 'accepted', 'me@example.com': 'declined', 'room-1@resource.calendar.google.com': 'accepted' },
    });
    expect(body).toEqual([
      { email: 'boss@example.com', responseStatus: 'accepted' },
      { email: 'me@example.com', responseStatus: 'declined' },
      { email: 'room-1@resource.calendar.google.com', resource: true, responseStatus: 'accepted' },
    ]);
    // 응답을 모르는 사람은 그 키를 싣지 않는다(구글이 정한 기본을 건드리지 않는다)
    expect(attendeesBody({ attendees: ['x@y.com'] })).toEqual([{ email: 'x@y.com' }]);
  });

  it('내 응답만 바꾼 저장은 참석자 배열 하나만 간다 — 내 것만 달라지고 남의 응답은 그대로', () => {
    const [ev] = parseEvents({ items: [INVITED] }, CAL);
    const patch = patchFrom(ev!, {}, { rsvp: 'accepted' });
    expect(patch.touched).toEqual(['attendees']);
    expect(patch.body).toEqual({
      attendees: [
        { email: 'boss@example.com', responseStatus: 'accepted' },
        { email: 'me@example.com', responseStatus: 'accepted' },
        { email: 'mate@example.com', responseStatus: 'declined' },
        { email: 'room-1@resource.calendar.google.com', resource: true, responseStatus: 'accepted' },
      ],
    });
  });

  it('그 사이 남이 응답했으면 참석자 저장은 충돌이다 — 낡은 배열로 그 응답을 덮지 않는다', () => {
    const [a] = parseEvents({ items: [INVITED] }, CAL);
    const [b] = parseEvents({ items: [{ ...INVITED, attendees: INVITED.attendees.map((x) => (x.email === 'mate@example.com' ? { ...x, responseStatus: 'accepted' } : x)) }] }, CAL);
    expect(managedFieldsDiffer(a!, b!, ['attendees'])).toBe(true);
    // 다른 필드만 쓰는 저장은 여전히 통과한다(범위를 좁히는 것이 이 함수의 핵심)
    expect(managedFieldsDiffer(a!, b!, ['title'])).toBe(false);
  });
});

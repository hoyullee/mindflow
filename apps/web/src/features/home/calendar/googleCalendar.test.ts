import { describe, expect, it, beforeEach, vi } from 'vitest';
import { GOOGLE_CALENDAR_SCOPE, RECURRENCE_OFF, buildRecurrence, draftToBody, googleWriteError, managedFieldsDiffer, updateGoogleEvent, recurrenceSummary, isDayOffHoliday, isHolidayCalendarId, onTokenChange, scopeCovers, parseCalendarList, parseEvents, readStoredToken, splitGoogleDateTime, storeToken, type GoogleCalendarMeta } from './googleCalendar';
import { googleEntries, holidayMap } from './entries';
import { draftFrom } from './GoogleEventDetail';
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

  // 제보 — 구글 일정을 고치면 412("그 사이 구글에서 바뀌었어요")로 막혔다. 대개는 사람이
  // 고친 게 아니라 **회의실이 스스로 초대를 수락**하는 것 같은 곁가지 변화다: 우리가 다루는
  // 값이 그대로면 새 판을 기준으로 한 번 더 쓴다.
  describe('412 — 그 사이 바뀐 것이 무엇인가', () => {
    const base = parseEvents({ items: [{ id: 'e1', etag: '"v1"', summary: '회의', start: { date: '2026-08-10' }, end: { date: '2026-08-11' }, attendees: [{ email: 'a@b.com' }] }] }, { ...CAL, writable: true })[0]!;

    it('응답 상태만 바뀐 판은 같은 것으로 본다 — 사람이 고친 값은 다르다', () => {
      const same = parseEvents({ items: [{ id: 'e1', etag: '"v2"', summary: '회의', start: { date: '2026-08-10' }, end: { date: '2026-08-11' }, attendees: [{ email: 'a@b.com', responseStatus: 'accepted' }] }] }, CAL)[0]!;
      const changed = parseEvents({ items: [{ id: 'e1', etag: '"v2"', summary: '남이 고친 제목', start: { date: '2026-08-10' }, end: { date: '2026-08-11' }, attendees: [{ email: 'a@b.com' }] }] }, CAL)[0]!;
      expect(managedFieldsDiffer(base, same)).toBe(false);
      expect(managedFieldsDiffer(base, changed)).toBe(true);
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
      await updateGoogleEvent('tok', base, { title: '회의', allDay: true, startDate: '2026-08-10', endDate: '2026-08-10' });
      expect(calls.map((c) => `${c.method}:${c.etag ?? '-'}`)).toEqual(['PATCH:"v1"', 'GET:-', 'PATCH:"v2"']);
      vi.unstubAllGlobals();
    });

    it('사람이 고친 판이면 덮지 않고 그대로 막는다(If-Match를 쓰는 이유)', async () => {
      vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
        const method = (init?.method ?? 'GET') as string;
        if (method === 'PATCH') return { ok: false, status: 412, json: async () => ({}) } as unknown as Response;
        return { ok: true, status: 200, json: async () => ({ id: 'e1', etag: '"v2"', summary: '남이 고친 제목', start: { date: '2026-08-10' }, end: { date: '2026-08-11' } }) } as unknown as Response;
      });
      await expect(updateGoogleEvent('tok', base, { title: '회의', allDay: true, startDate: '2026-08-10', endDate: '2026-08-10' })).rejects.toMatchObject({ status: 412 });
      vi.unstubAllGlobals();
    });
  });
});

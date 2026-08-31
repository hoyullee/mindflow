import { describe, expect, it, beforeEach, vi } from 'vitest';
import { GOOGLE_CALENDAR_SCOPE, draftToBody, googleWriteError, isDayOffHoliday, isHolidayCalendarId, scopeCovers, parseCalendarList, parseEvents, readStoredToken, splitGoogleDateTime, storeToken, type GoogleCalendarMeta } from './googleCalendar';
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
    await submitNewEvent(input, { kind: 'google', calendarId: 'me@example.com' }, { createGeurio, createGoogle });
    expect(createGeurio).not.toHaveBeenCalled();
    expect(createGoogle).toHaveBeenCalledWith('me@example.com', expect.objectContaining({ title: '회의', description: '준비물' }));
  });
});

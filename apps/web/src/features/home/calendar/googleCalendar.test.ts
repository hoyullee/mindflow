import { describe, expect, it, beforeEach } from 'vitest';
import { isHolidayCalendarId, parseCalendarList, parseEvents, readStoredToken, splitGoogleDateTime, storeToken, type GoogleCalendarMeta } from './googleCalendar';
import { googleEntries, holidayMap } from './entries';

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
    const long = parseEvents({ items: [{ id: 'h2', summary: '설 연휴', start: { date: '2026-02-16' }, end: { date: '2026-02-19' } }] }, HOL);
    expect(holidayMap(long)).toEqual({ '2026-02-16': '설 연휴', '2026-02-17': '설 연휴', '2026-02-18': '설 연휴' });
  });

  it('구글 항목은 읽기 전용 — 달력의 드래그 가드가 보는 값이 참이다', () => {
    expect(googleEntries(events).every((e) => e.readOnly)).toBe(true);
  });
});

describe('구글 캘린더 — 토큰 보관', () => {
  beforeEach(() => sessionStorage.clear());

  it('만료된 토큰은 없는 것으로 본다(요청 도중 죽지 않게 60초 여유)', () => {
    const now = Date.now();
    storeToken({ accessToken: 't', expiresAt: now + 30_000 });
    expect(readStoredToken(now)).toBeNull();
    storeToken({ accessToken: 't', expiresAt: now + 600_000 });
    expect(readStoredToken(now)?.accessToken).toBe('t');
  });

  it('손상된 값은 조용히 버린다', () => {
    sessionStorage.setItem('mf_gcal_token', '{oops');
    expect(readStoredToken()).toBeNull();
  });

  it('탭 저장소를 쓴다 — 창을 닫으면 사라진다(localStorage에 남기지 않는다)', () => {
    storeToken({ accessToken: 't', expiresAt: Date.now() + 600_000 });
    expect(sessionStorage.getItem('mf_gcal_token')).toBeTruthy();
    expect(localStorage.getItem('mf_gcal_token')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import type { CalendarEntry } from '../home/calendar/entries';
import { SCHED_KINDS, SCHED_NEXT_MAX, schedDays, schedSubtitle, schedTitle } from './noteAgenda';

/** 시험용 항목 하나 — 달력이 보는 최소한의 칸만 채운다. */
const ent = (due: string, title: string, extra: Partial<CalendarEntry> = {}): CalendarEntry =>
  ({ docId: '', cardId: title, title, due, colId: '', colName: '', colIndex: 0, tag: '', boardName: '', spaceName: '', ...extra }) as CalendarEntry;

// 2026-09-26은 **토요일**이라 그 주는 9/20(일)~9/26(토)이다.
const TODAY = '2026-09-26';

describe('schedDays — 종류별 포함 규칙(스펙 2-3)', () => {
  it('오늘 — 한 줄이고, 비어도 그린다', () => {
    expect(schedDays('today', [], TODAY)).toEqual([{ iso: TODAY, entries: [] }]);
    const one = ent(TODAY, '회의');
    expect(schedDays('today', [one], TODAY)[0]?.entries).toEqual([one]);
  });

  it('이번 주 — 일~토에서 **빈 날은 건너뛰되 오늘은 남긴다**', () => {
    const mon = ent('2026-09-21', '월요일 일정');
    const days = schedDays('week', [mon], TODAY);
    expect(days.map((d) => d.iso)).toEqual(['2026-09-21', TODAY]);
    expect(days[1]?.entries).toEqual([]); // 오늘은 비어도 남는다
  });

  it('이번 주 — 주 밖의 일정은 들어오지 않는다', () => {
    expect(schedDays('week', [ent('2026-10-05', '다음 주')], TODAY).map((d) => d.iso)).toEqual([TODAY]);
  });

  it('다가오는 — **개수로** 자르고 날짜별로 묶는다', () => {
    const list = ['2026-09-27', '2026-09-27', '2026-09-28', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'].map((d, i) => ent(d, `일정${i}`));
    const days = schedDays('next', list, TODAY);
    expect(days.reduce((s, d) => s + d.entries.length, 0)).toBe(SCHED_NEXT_MAX);
    expect(days[0]?.iso).toBe('2026-09-27');
    expect(days[0]?.entries).toHaveLength(2);
    // 일곱 번째(10-04)는 잘렸다.
    expect(days.some((d) => d.iso === '2026-10-04')).toBe(false);
  });

  it('다가오는 — **지난 일정은 담지 않는다**', () => {
    expect(schedDays('next', [ent('2026-09-01', '지남')], TODAY)).toEqual([]);
  });

  it('다가오는 — 오늘을 덮는 **기간 일정**은 오늘 줄에 한 번만 담긴다', () => {
    const span = ent('2026-09-30', '출장', { start: '2026-09-24' });
    const days = schedDays('next', [span], TODAY);
    expect(days).toHaveLength(1);
    expect(days[0]?.iso).toBe(TODAY);
  });

  it('달력 — 고른 날 한 줄(고르지 않았으면 오늘)', () => {
    expect(schedDays('month', [], TODAY, '2026-09-30')[0]?.iso).toBe('2026-09-30');
    expect(schedDays('month', [], TODAY)[0]?.iso).toBe(TODAY);
  });
});

describe('머리의 제목과 부제(스펙 2-3의 2·3)', () => {
  it('제목', () => {
    expect(schedTitle('today', TODAY)).toBe('오늘 일정');
    expect(schedTitle('week', TODAY)).toBe('이번 주 일정');
    expect(schedTitle('month', TODAY)).toBe('9월 달력');
    expect(schedTitle('next', TODAY)).toBe('다가오는 일정');
  });

  it('부제 — 무엇을 세었는지까지', () => {
    const list = [ent(TODAY, '오늘것'), ent('2026-09-21', '주중'), ent('2026-10-05', '다음달')];
    expect(schedSubtitle('today', list, TODAY)).toBe('9월 26일 · 1개');
    expect(schedSubtitle('week', list, TODAY)).toBe('9.20 – 9.26 · 2개');
    // 달력은 **그 달 전체**를 센다 — 10월 것은 빠진다.
    expect(schedSubtitle('month', list, TODAY)).toBe('2026년 9월 · 2개');
    expect(schedSubtitle('next', list, TODAY)).toBe('오늘부터 가까운 2개');
  });
});

describe('고르는 목록(2-2)', () => {
  it('네 종류가 스펙 순서대로 있다', () => {
    expect(SCHED_KINDS.map((k) => k.key)).toEqual(['today', 'week', 'month', 'next']);
    expect(SCHED_KINDS.every((k) => k.name && k.desc)).toBe(true);
  });
});

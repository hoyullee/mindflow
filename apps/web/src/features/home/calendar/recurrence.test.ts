import { describe, expect, it } from 'vitest';
import { applyPreset, expandRecurrence, parseRecurrence, presetOf, recurrenceLabel } from './recurrence';
import { buildRecurrence, RECURRENCE_OFF, type RecurrenceSpec } from './googleCalendar';

/**
 * 반복 규칙 — 다섯 칸(반복 없음·매일·매주·매월·맞춤)과 그 규칙이 만드는 날짜들.
 *
 * 지키는 계약: ① 고른 칸을 그대로 되읽는다 ② RRULE로 왕복한다 ③ 회차는 보이는 구간
 * 안에서만 나온다(무한 규칙도 유한하다) ④ 규칙이 없으면 원래 하루 하나.
 */

const SPEC = (over: Partial<RecurrenceSpec> = {}): RecurrenceSpec => ({ ...RECURRENCE_OFF, on: true, ...over });

describe('반복 규칙(프리셋)', () => {
  it('고른 칸을 그대로 되읽는다 — `매주`와 "1주마다"는 규칙이 같아도 칸이 다르다', () => {
    expect(presetOf(RECURRENCE_OFF)).toBe('none');
    expect(presetOf(SPEC({ unit: 'day' }))).toBe('daily');
    expect(presetOf(SPEC({ unit: 'week' }))).toBe('weekly');
    expect(presetOf(SPEC({ unit: 'month' }))).toBe('monthly');
    // 같은 값(1주마다·종료 없음)이라도 `맞춤`을 골랐으면 맞춤이다.
    expect(presetOf(SPEC({ unit: 'week', custom: true }))).toBe('custom');
  });

  it('프리셋을 고르면 1마다·종료 없음이 되고, 맞춤은 지금 값을 그대로 들고 펼친다', () => {
    const custom = SPEC({ unit: 'day', interval: 3, endMode: 'count', count: 7, custom: true });
    expect(applyPreset(custom, 'weekly')).toMatchObject({ on: true, unit: 'week', interval: 1, endMode: 'none', custom: false });
    // 맞춤으로 되돌리면 값이 초기화되지 않는다(고르는 순간 값이 사라지면 놀란다).
    expect(applyPreset(custom, 'custom')).toMatchObject({ interval: 3, count: 7, custom: true });
    expect(applyPreset(custom, 'none')).toMatchObject({ on: false });
  });

  it('요약은 프리셋이면 규칙만, 맞춤이면 종료 조건까지 말한다', () => {
    expect(recurrenceLabel(RECURRENCE_OFF)).toBe('');
    expect(recurrenceLabel(SPEC({ unit: 'day' }), '2026-08-26')).toBe('매일 반복');
    expect(recurrenceLabel(SPEC({ unit: 'week' }), '2026-08-26')).toBe('매주 수요일 반복');
    expect(recurrenceLabel(SPEC({ unit: 'month' }), '2026-08-26')).toBe('매월 26일 반복');
    expect(recurrenceLabel(SPEC({ unit: 'week', interval: 2, custom: true }), '2026-08-26')).toBe('2주마다 반복 · 종료 없음');
    expect(recurrenceLabel(SPEC({ unit: 'week', interval: 2, custom: true, endMode: 'count', count: 6 }))).toBe('2주마다 반복 · 6회 반복 후 종료');
    expect(recurrenceLabel(SPEC({ unit: 'day', custom: true, endMode: 'date', until: '2026-09-30' }))).toBe('1일마다 반복 · 2026년 9월 30일 종료');
  });

  it('RRULE로 왕복한다 — 우리가 만든 규칙만 읽고, 모르는 것은 반복 없음이다', () => {
    const spec = SPEC({ unit: 'week', interval: 2, custom: true, endMode: 'count', count: 6 });
    const rule = buildRecurrence(spec)![0]!;
    expect(rule).toBe('RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=6');
    expect(parseRecurrence(rule)).toMatchObject({ on: true, unit: 'week', interval: 2, endMode: 'count', count: 6 });
    expect(parseRecurrence(buildRecurrence(SPEC({ unit: 'day' }))![0])).toMatchObject({ unit: 'day', interval: 1, endMode: 'none', custom: false });
    expect(parseRecurrence('RRULE:FREQ=YEARLY')).toBeNull();
    expect(parseRecurrence(undefined)).toBeNull();
    // UNTIL은 그 날 끝까지 — 날짜만 남겨 읽는다.
    expect(parseRecurrence('RRULE:FREQ=DAILY;UNTIL=20260930T235959Z')).toMatchObject({ endMode: 'date', until: '2026-09-30' });
  });
});

describe('회차 펼치기', () => {
  const RANGE = { from: '2026-08-01', to: '2026-08-31' };
  const exp = (rule: string | undefined, start: string, span = 0) => expandRecurrence(rule, start, RANGE.from, RANGE.to, span);

  it('규칙이 없으면 원래 하루 하나 — 구간 밖이면 아무것도 없다', () => {
    expect(exp(undefined, '2026-08-26')).toEqual(['2026-08-26']);
    expect(exp(undefined, '2026-09-02')).toEqual([]);
    // 기간 일정은 구간에 걸치기만 하면 포함된다(7/30~8/2).
    expect(exp(undefined, '2026-07-30', 3)).toEqual(['2026-07-30']);
  });

  it('매일·격주·매월 — 간격만큼 벌어진다', () => {
    expect(exp('RRULE:FREQ=DAILY', '2026-08-28')).toEqual(['2026-08-28', '2026-08-29', '2026-08-30', '2026-08-31']);
    expect(exp('RRULE:FREQ=WEEKLY;INTERVAL=2', '2026-08-05')).toEqual(['2026-08-05', '2026-08-19']);
    // 첫 회차가 구간 앞이어도 이번 구간의 회차가 나온다(조회가 그 행을 준다).
    expect(exp('RRULE:FREQ=WEEKLY', '2026-07-29')).toEqual(['2026-08-05', '2026-08-12', '2026-08-19', '2026-08-26']);
    expect(expandRecurrence('RRULE:FREQ=MONTHLY', '2026-01-31', '2026-02-01', '2026-02-28')).toEqual(['2026-02-28']);
  });

  it('종료 조건 — 날짜는 그 날까지, 횟수는 그만큼만', () => {
    expect(exp('RRULE:FREQ=DAILY;UNTIL=20260803T235959Z', '2026-08-01')).toEqual(['2026-08-01', '2026-08-02', '2026-08-03']);
    expect(exp('RRULE:FREQ=DAILY;COUNT=2', '2026-08-01')).toEqual(['2026-08-01', '2026-08-02']);
    // 종료 없는 규칙도 구간에서 멈춘다(무한 루프가 아니다).
    expect(exp('RRULE:FREQ=DAILY', '2026-08-01')).toHaveLength(31);
  });
});

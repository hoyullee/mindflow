import { describe, expect, it } from 'vitest';
import {
  addDays,
  assignColors,
  availability,
  bizDaysIn,
  buildDataset,
  companyHits,
  computeStats,
  dayChips,
  gridDays,
  heatLevel,
  holidayOf,
  layLanes,
  monthBiz,
  monthDays,
  passes,
  visibleChips,
  workedDays,
  type HolidayRules,
} from './model';
import type { JiraTicket } from '../jira/jiraApi';
import { HOLIDAYS } from './holidays';

const KR: HolidayRules = { country: 'KR', weekend: false, exceptions: [], company: [] };
const T = (key: string, epic: string, pid: string, start: string, end: string, status: JiraTicket['status'] = 'doing'): JiraTicket => ({
  key,
  epic,
  person: { id: pid, name: pid },
  start,
  end,
  status,
  summary: key,
  startMissing: false,
  endMissing: false,
});

describe('공휴일 표', () => {
  it('2026 추석은 9/24~26 사흘이고, 토요일에 걸려도 대체공휴일은 없다(설·추석은 일요일·겹침만)', () => {
    expect(HOLIDAYS.KR['2026-09-24']).toBe('추석 연휴');
    expect(HOLIDAYS.KR['2026-09-25']).toBe('추석');
    expect(HOLIDAYS.KR['2026-09-26']).toBe('추석 연휴');
    expect(HOLIDAYS.KR['2026-09-28']).toBeUndefined();
  });
  it('토요일 개천절(2026-10-03)은 월요일 대체공휴일', () => {
    expect(HOLIDAYS.KR['2026-10-05']).toBe('개천절 대체공휴일');
  });
  it('한 날에 겹친 두 휴일(2025-05-05)은 대체공휴일 하나', () => {
    expect(HOLIDAYS.KR['2025-05-06']).toBe('어린이날 대체공휴일');
    expect(HOLIDAYS.KR['2025-05-07']).toBeUndefined();
  });
  it('일요일이 든 추석 연휴(2025-10-05~07)는 연휴 다음 평일이 대체공휴일', () => {
    expect(HOLIDAYS.KR['2025-10-08']).toBe('추석 대체공휴일');
  });
});

describe('영업일', () => {
  it('주말에 걸린 공휴일은 공휴일로 두 번 빼지 않는다 — 식이 영업일과 맞는다', () => {
    const r = monthBiz(2026, 9, { ...KR, company: [{ d: '2026-09-29', name: '창립기념일', repeat: 'yearly' }] });
    // 30일 − 주말 8 − 평일 공휴일 2(24·25; 26일은 토요일) − 추가 휴일 1(29) = 19
    expect(r.weekend).toBe(8);
    expect(r.holiday).toBe(2);
    expect(r.company).toBe(1);
    expect(r.biz.length).toBe(19);
    expect(r.days.length - r.weekend - r.holiday - r.company).toBe(r.biz.length);
  });

  it('주말도 영업일이면 주말에 걸린 공휴일은 공휴일로 센다', () => {
    const r = monthBiz(2026, 9, { ...KR, weekend: true });
    expect(r.weekend).toBe(0);
    expect(r.holiday).toBe(3);
    expect(r.biz.length).toBe(27);
  });

  it('근무일로 처리한 공휴일은 영업일이 된다', () => {
    expect(holidayOf('2026-09-25', KR)?.name).toBe('추석');
    expect(holidayOf('2026-09-25', { ...KR, exceptions: ['2026-09-25'] })).toBeNull();
  });

  it('추가 휴일 반복은 등록일 이후부터만 — 매년·매월·매주', () => {
    const y = { d: '2026-09-29', name: 'x', repeat: 'yearly' as const };
    expect(companyHits(y, '2027-09-29')).toBe(true);
    expect(companyHits(y, '2025-09-29')).toBe(false);
    expect(companyHits({ ...y, repeat: 'monthly' }, '2026-10-29')).toBe(true);
    expect(companyHits({ ...y, repeat: 'weekly' }, '2026-10-06')).toBe(true); // 화요일
    expect(companyHits({ ...y, repeat: 'weekly' }, '2026-09-22')).toBe(false); // 등록 전
    expect(companyHits({ ...y, repeat: 'none' }, '2027-09-29')).toBe(false);
  });

  it('추가 휴일이 공휴일보다 먼저 이름을 가진다(회사 휴일 표시)', () => {
    expect(holidayOf('2026-09-25', { ...KR, company: [{ d: '2026-09-25', name: '회사', repeat: 'none' }] })).toEqual({ name: '회사', company: true });
  });

  it('기간의 영업일은 120일에서 끊는다', () => {
    expect(bizDaysIn('2026-01-01', '2027-12-31', { ...KR, weekend: true }).length).toBeLessThanOrEqual(120);
  });
});

describe('진행 일수', () => {
  const biz = monthBiz(2026, 9, KR).biz;
  it('같은 날 여러 티켓은 1일 · 예정은 세지 않는다', () => {
    const ts = [T('A-1', 'E-1', 'p', '2026-09-01', '2026-09-04'), T('A-2', 'E-2', 'p', '2026-09-03', '2026-09-08'), T('A-3', 'E-1', 'p', '2026-09-14', '2026-09-15', 'todo')];
    // 1~4, 7~8 영업일 = 1,2,3,4,7,8 = 6일
    expect(workedDays(ts, biz, 'p')).toBe(6);
    expect(workedDays(ts, biz, 'p', 'E-1')).toBe(4);
  });

  it('인일 합계는 담당자 합계의 총합과 다를 수 있다(같은 날 두 에픽)', () => {
    const data = buildDataset(
      [
        { key: 'E-1', name: 'e1', start: null, end: null, status: 'doing' },
        { key: 'E-2', name: 'e2', start: null, end: null, status: 'doing' },
      ],
      [T('A-1', 'E-1', 'p', '2026-09-01', '2026-09-02'), T('A-2', 'E-2', 'p', '2026-09-01', '2026-09-02')],
      [],
    );
    const s = computeStats(data.people, data.epics, data.tickets, biz);
    expect(s.grand).toBe(4);
    expect(s.totalSum).toBe(2);
  });

  it('히트맵 단계', () => {
    expect([0, 1, 3, 4, 8, 9, 13, 14].map(heatLevel)).toEqual([0, 1, 1, 2, 2, 3, 3, 4]);
  });
});

describe('일정 맞춰보기', () => {
  it('레벨 네 단계와 정렬', () => {
    const biz = bizDaysIn('2026-10-12', '2026-10-16', KR); // 월~금 5일
    const data = buildDataset(
      [{ key: 'E-1', name: 'e', start: null, end: null, status: 'doing' }],
      [
        T('A-1', 'E-1', 'b', '2026-10-12', '2026-10-13', 'todo'), // 2/5 바쁨 → 여유 60% → 일부 겹침
        T('A-2', 'E-1', 'c', '2026-10-12', '2026-10-15'), // 4/5 → 거의 불가
        T('A-3', 'E-1', 'd', '2026-10-01', '2026-10-31'), // 전부 → 불가
        T('A-4', 'E-1', 'a', '2026-10-12', '2026-10-16', 'done'), // 완료는 바쁨이 아니다 → 전부 가능
      ],
      [],
    );
    const rows = availability(data.people, data.tickets, biz);
    expect(rows.map((r) => [r.person.id, r.level])).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
      ['d', 3],
    ]);
  });
});

describe('필터 · 칩 · 레인', () => {
  const ts = [T('A-1', 'E-1', 'p', '2026-09-01', '2026-09-03'), T('B-1', 'E-2', 'q', '2026-09-02', '2026-09-05')];
  it('같은 종류는 OR, 다른 종류는 AND', () => {
    expect(ts.filter((t) => passes(t, [{ type: 'person', id: 'p' }, { type: 'person', id: 'q' }])).length).toBe(2);
    expect(ts.filter((t) => passes(t, [{ type: 'person', id: 'p' }, { type: 'epic', id: 'E-2' }])).length).toBe(0);
  });

  it('칩이 셋을 넘으면 둘 + 나머지', () => {
    expect(visibleChips([1, 2, 3])).toEqual({ shown: [1, 2, 3], more: 0 });
    expect(visibleChips([1, 2, 3, 4])).toEqual({ shown: [1, 2], more: 2 });
  });

  it('그 날 칩은 에픽별로 묶이고 티켓 많은 순', () => {
    const data = buildDataset(
      [
        { key: 'E-1', name: 'e1', start: null, end: null, status: 'doing' },
        { key: 'E-2', name: 'e2', start: null, end: null, status: 'doing' },
      ],
      [...ts, T('B-2', 'E-2', 'p', '2026-09-02', '2026-09-02')],
      [],
    );
    const chips = dayChips(data.tickets, '2026-09-02', data);
    expect(chips.map((c) => [c.epic.key, c.tickets.length, c.people.length])).toEqual([
      ['E-2', 2, 2],
      ['E-1', 1, 1],
    ]);
  });

  it('겹치는 막대는 레인을 나누고 달 경계 밖은 자른다', () => {
    const days = monthDays(2026, 9);
    const { bars, lanes } = layLanes([T('X-1', 'E', 'p', '2026-08-20', '2026-09-03'), T('X-2', 'E', 'p', '2026-09-02', '2026-09-10'), T('X-3', 'E', 'p', '2026-09-05', '2026-10-10')], days);
    expect(lanes).toBe(2);
    expect(bars.map((b) => [b.item.key, b.s, b.e, b.lane])).toEqual([
      ['X-1', 0, 2, 0],
      ['X-2', 1, 9, 1],
      ['X-3', 4, 29, 0],
    ]);
  });

  it('격자는 그 달 1일이 든 주의 일요일부터 42칸', () => {
    const g = gridDays(2026, 9);
    expect(g[0]).toBe('2026-08-30');
    expect(g.length).toBe(42);
    expect(addDays(g[0]!, 41)).toBe(g[41]);
  });
});

describe('색', () => {
  it('같은 키는 세트가 바뀌어도 대개 같은 색이고, 팔레트 안에서는 겹치지 않는다', () => {
    const a = assignColors(['PAY-100', 'ONB-30', 'SRCH-1'], 6);
    expect(new Set(a.values()).size).toBe(3);
    const b = assignColors(['PAY-100', 'ONB-30', 'SRCH-1', 'ZZZ-9'], 6);
    // 새 키가 끼어도(정렬상 뒤) 앞의 셋은 그대로다
    for (const k of ['PAY-100', 'ONB-30', 'SRCH-1']) expect(b.get(k)).toBe(a.get(k));
  });

  it('직접 더한 사람은 티켓이 있어도 extra로 남는다(목록에서 뺄 수 있게)', () => {
    const d = buildDataset([], [T('A-1', 'E', 'p', '2026-09-01', '2026-09-01')], [{ id: 'p', name: 'p' }, { id: 'z', name: 'z' }]);
    expect(d.people.map((p) => [p.id, p.extra])).toEqual([
      ['p', true],
      ['z', true],
    ]);
  });
});

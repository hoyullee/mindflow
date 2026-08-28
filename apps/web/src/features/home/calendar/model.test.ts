import { describe, expect, it } from 'vitest';
import type { CalendarEntry } from './entries';
import { calendarEntries, datedCards } from './entries';
import { addMonth, calendarStats, dayProgress, coversDay, dateLabel, dueBadge, entriesOn, filterByStat, isSpan, monthCells, monthLabel, overdueEntries, todayISO, upcomingEntries, weekEndISO, weekStartISO } from './model';

// 일정 화면의 데이터 계층 — 순수 함수라 날짜를 고정해 검증한다.

const kanban = (cards: unknown[], columns = [{ id: 'c1', title: '할 일' }, { id: 'c2', title: '진행 중' }, { id: 'c3', title: '완료' }]) =>
  JSON.stringify({ v: 1, kind: 'kanban', nodes: {}, floats: [], lines: [], zones: [], layoutMode: 'right', themeKey: 'coral', columns, cards });

const card = (over: Record<string, unknown> = {}) => ({ id: 'k1', col: 'c1', pos: 1, text: '카드', due: '2026-08-20', ...over });

const SRC = [{ docId: 'd1', boardName: '스프린트 보드', spaceName: '일반 스페이스' }];

describe('일정 수집기(entries)', () => {
  it('기한이 있는 칸반 카드만 모으고 열 이름·순서를 함께 싣는다', () => {
    const out = calendarEntries(SRC, { d1: kanban([card(), card({ id: 'k2', text: '날짜 없음', due: undefined })]) });
    expect(out.length).toBe(1);
    expect(out[0]).toMatchObject({ docId: 'd1', cardId: 'k1', title: '카드', due: '2026-08-20', colName: '할 일', colIndex: 0, boardName: '스프린트 보드', spaceName: '일반 스페이스' });
  });

  it('완료(마지막) 열의 카드는 달력에서 빠진다', () => {
    const out = calendarEntries(SRC, { d1: kanban([card({ col: 'c3' })]) });
    expect(out).toEqual([]);
  });

  it('소속 열이 사라진 카드(유령)와 칸반이 아닌 문서는 무시한다', () => {
    const ghost = calendarEntries(SRC, { d1: kanban([card({ col: 'gone' })]) });
    expect(ghost).toEqual([]);
    const board = calendarEntries(SRC, { d1: JSON.stringify({ kind: 'board', nodes: {}, floats: [] }) });
    expect(board).toEqual([]);
  });

  it('시작일은 기한보다 앞설 때만 싣는다(기간 바의 근거)', () => {
    const ok = calendarEntries(SRC, { d1: kanban([card({ start: '2026-08-18' })]) });
    expect(ok[0]!.start).toBe('2026-08-18');
    const same = calendarEntries(SRC, { d1: kanban([card({ start: '2026-08-20' })]) });
    expect(same[0]!.start).toBeUndefined();
  });

  it('손상된 본문은 없는 것으로 보고, 같은 원문은 다시 파싱하지 않는다', () => {
    expect(datedCards('bad', '{{{')).toEqual([]);
    const raw = kanban([card()]);
    expect(datedCards('d9', raw)).toBe(datedCards('d9', raw)); // 캐시 히트 = 같은 참조
  });

  it('같은 문서가 여러 목록에 있어도 한 번만 읽고, 기한 순으로 정렬한다', () => {
    const out = calendarEntries(
      [...SRC, ...SRC, { docId: 'd2', boardName: 'B', spaceName: 'S' }],
      { d1: kanban([card({ due: '2026-08-25' })]), d2: kanban([card({ id: 'k9', due: '2026-08-10' })]) },
    );
    expect(out.map((e) => e.due)).toEqual(['2026-08-10', '2026-08-25']);
  });
});

const E = (due: string, over: Partial<CalendarEntry> = {}): CalendarEntry => ({
  docId: 'd1', cardId: `k${due}`, title: due, due, colId: 'c1', colName: '할 일', colIndex: 0, tag: '', boardName: 'B', spaceName: 'S', ...over,
});

describe('일정 모델(model)', () => {
  const TODAY = '2026-08-26';

  it('월 이동과 표기', () => {
    expect(monthLabel(2026, 8)).toBe('2026년 8월');
    expect(addMonth(2026, 12, 1)).toEqual({ y: 2027, m: 1 });
    expect(addMonth(2026, 1, -1)).toEqual({ y: 2025, m: 12 });
    expect(todayISO(new Date(2026, 7, 26))).toBe('2026-08-26');
  });

  it('주는 일요일에 시작한다', () => {
    expect(weekStartISO('2026-08-26')).toBe('2026-08-23');
    expect(weekEndISO('2026-08-26')).toBe('2026-08-29');
  });

  it('격자는 항상 6주(42칸)이고 이웃 달 칸은 inMonth=false', () => {
    const cells = monthCells(2026, 8, [], TODAY);
    expect(cells.length).toBe(42);
    // 2026-08-01은 토요일 → 앞에 빈 칸 6개
    expect(cells.slice(0, 6).every((c) => !c.inMonth)).toBe(true);
    expect(cells[6]).toMatchObject({ n: 1, inMonth: true, dow: 6 });
    expect(cells.find((c) => c.iso === TODAY)!.isToday).toBe(true);
    expect(cells.find((c) => c.iso === '2026-08-20')!.dim).toBe(true);
  });

  it('하루짜리는 칸의 칩으로, 기간은 칸마다 바로 — 칩과 바가 겹치지 않는다', () => {
    const span = E('2026-08-20', { start: '2026-08-18', title: '스프린트' });
    const one = E('2026-08-20', { title: '하루' });
    const cells = monthCells(2026, 8, [span, one], TODAY);
    const at = (iso: string) => cells.find((c) => c.iso === iso)!;
    expect(at('2026-08-20').entries.map((e) => e.title)).toEqual(['하루']); // 기간은 칩에 없다
    expect(at('2026-08-18').bars.map((b) => [b.head, b.tail, b.label])).toEqual([[true, false, true]]);
    expect(at('2026-08-19').bars[0]).toMatchObject({ head: false, tail: false });
    expect(at('2026-08-20').bars[0]).toMatchObject({ tail: true });
    expect(at('2026-08-21').bars.length).toBe(0);
  });

  it('칸에 못 담은 칩은 개수로 접는다', () => {
    const cells = monthCells(2026, 8, [E('2026-08-20'), E('2026-08-20', { cardId: 'x' }), E('2026-08-20', { cardId: 'y' })], TODAY, 2);
    const c = cells.find((x) => x.iso === '2026-08-20')!;
    expect(c.entries.length).toBe(2);
    expect(c.moreN).toBe(1);
  });

  it('통계는 기한 기준 — 지난·오늘·이번 주·기간', () => {
    const list = [E('2026-08-20'), E('2026-08-26'), E('2026-08-28'), E('2026-08-30', { start: '2026-08-24' }), E('2026-09-10')];
    expect(calendarStats(list, TODAY).map((s) => [s.key, s.count])).toEqual([['over', 1], ['today', 1], ['week', 2], ['span', 1]]);
  });

  it('통계 칩은 필터다', () => {
    const list = [E('2026-08-20'), E('2026-08-26'), E('2026-08-30', { start: '2026-08-24' })];
    expect(filterByStat(list, 'over', TODAY).map((e) => e.due)).toEqual(['2026-08-20']);
    expect(filterByStat(list, 'span', TODAY).map((e) => e.due)).toEqual(['2026-08-30']);
    expect(filterByStat(list, null, TODAY).length).toBe(3);
  });

  it('목록: 다가오는 것은 이른 순, 지난 것은 최근에 놓친 순', () => {
    const list = [E('2026-08-10'), E('2026-08-20'), E('2026-08-26'), E('2026-08-28')];
    expect(upcomingEntries(list, TODAY).map((e) => e.due)).toEqual(['2026-08-26', '2026-08-28']);
    expect(overdueEntries(list, TODAY).map((e) => e.due)).toEqual(['2026-08-20', '2026-08-10']);
  });

  it('그 날의 항목은 하루짜리 + 그 날을 덮는 기간', () => {
    const span = E('2026-08-30', { start: '2026-08-24', title: '기간' });
    const one = E('2026-08-26', { title: '하루' });
    expect(entriesOn([span, one], '2026-08-26').map((e) => e.title)).toEqual(['기간', '하루']);
    expect(isSpan(span)).toBe(true);
    expect(coversDay(one, '2026-08-27')).toBe(false);
  });

  it('기간 일정은 며칠째인지 센다(하루짜리는 없음)', () => {
    const span = E('2026-08-30', { start: '2026-08-26' }); // 26~30 = 5일
    expect(dayProgress(span, '2026-08-26')).toBe('1/5일째');
    expect(dayProgress(span, '2026-08-28')).toBe('3/5일째');
    expect(dayProgress(span, '2026-08-30')).toBe('5/5일째');
    expect(dayProgress(span, '2026-09-01')).toBeNull(); // 창 밖
    expect(dayProgress(E('2026-08-26'), '2026-08-26')).toBeNull();
  });

  it('배지·날짜 표기', () => {
    expect(dueBadge(TODAY, TODAY)).toBe('오늘');
    expect(dueBadge('2026-08-20', TODAY)).toBe('지남');
    expect(dueBadge('2026-08-29', TODAY)).toBe('D-3');
    expect(dateLabel('2026-08-26')).toBe('8월 26일 (수)');
  });
});

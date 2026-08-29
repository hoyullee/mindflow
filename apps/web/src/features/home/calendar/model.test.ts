import { describe, expect, it } from 'vitest';
import type { CalendarEntry } from './entries';
import { calendarEntries, datedCards, eventEntries } from './entries';
import type { CalendarEvent } from '../../../adapters/ports';
import { addDays, daysBetween, addMonth, calendarStats, statBadge, dayProgress, coversDay, dateLabel, dayTimeline, dueBadge, entriesOn, gridRange, hourLabel, isSpan, minutesOf, monthCells, monthLabel, overdueEntries, timeLabel, todayISO, upcomingEntries, weekEndISO, weekStartISO, HOUR_ROW } from './model';

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

  it('통계는 개수만이 아니라 **그 항목들**을 싣는다 — 칩 팝오버가 그 목록을 그린다', () => {
    const list = [E('2026-08-20'), E('2026-08-26'), E('2026-08-30', { start: '2026-08-24' })];
    const by = Object.fromEntries(calendarStats(list, TODAY).map((s) => [s.key, s]));
    expect(by['over']!.items.map((e) => e.due)).toEqual(['2026-08-20']);
    expect(by['span']!.items.map((e) => e.due)).toEqual(['2026-08-30']);
    // 개수는 언제나 목록 길이다(둘이 갈리면 그게 곧 버그다).
    expect(calendarStats(list, TODAY).every((s) => s.count === s.items.length)).toBe(true);
  });

  it('지난 마감 목록은 가까운 것부터 — 어제 놓친 일이 한 달 전 일보다 급하다', () => {
    const list = [E('2026-08-01'), E('2026-08-25'), E('2026-08-10')];
    const over = calendarStats(list, TODAY).find((s) => s.key === 'over')!;
    expect(over.items.map((e) => e.due)).toEqual(['2026-08-25', '2026-08-10', '2026-08-01']);
  });

  it('통계 팝오버 배지는 며칠 지났는지까지 말한다', () => {
    expect(statBadge(TODAY, TODAY)).toBe('오늘');
    expect(statBadge('2026-08-22', TODAY)).toBe('-4일');
    expect(statBadge('2026-08-29', TODAY)).toBe('D-3');
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

  it('addDays는 daysBetween의 짝이다 — 달·해·윤년을 넘고 서머타임에도 흔들리지 않는다', () => {
    expect(addDays('2026-08-26', 4)).toBe('2026-08-30');
    expect(addDays('2026-08-26', -4)).toBe('2026-08-22');
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2024-02-28', 2)).toBe('2024-03-01');
    expect(addDays('2026-03-07', 2)).toBe('2026-03-09'); // 서머타임 전환 구간
    expect(addDays('2026-08-26', 0)).toBe('2026-08-26');
    expect(addDays('bad', 3)).toBe('bad');
    // 두 함수는 서로를 되돌린다(기간 길이를 지키는 계산의 근거).
    for (const n of [-40, -1, 0, 1, 40]) expect(daysBetween('2026-08-26', addDays('2026-08-26', n))).toBe(n);
  });

  it('daysBetween은 두 날 사이의 날 수다 — 달·해를 넘고 서머타임에도 흔들리지 않는다', () => {
    expect(daysBetween('2026-08-26', '2026-08-30')).toBe(4);
    expect(daysBetween('2026-08-30', '2026-08-26')).toBe(-4);
    expect(daysBetween('2026-08-31', '2026-09-01')).toBe(1); // 달 넘김
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1); // 해 넘김
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2); // 윤년
    expect(daysBetween('2026-08-26', '2026-08-26')).toBe(0);
    // 서머타임 전환일(미국 3월 둘째 일요일 전후) — 정오 기준이라 한 날 어긋나지 않는다
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
    expect(daysBetween('bad', '2026-08-26')).toBe(0); // 꼴이 아니면 움직이지 않는다
  });
});

const EV = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'e1', title: '주간 회의', startDate: '2026-08-26', endDate: '2026-08-26', allDay: false, startTime: '10:00', endTime: '11:00', source: 'geurio', ...over,
});

describe('Geurio 일정(eventEntries)', () => {
  it('칸반 마감과 같은 `CalendarEntry` 모양으로 만든다 — 격자·목록이 종류를 가리지 않게', () => {
    const [e] = eventEntries([EV()]);
    expect(e).toMatchObject({ docId: '', cardId: 'e1', title: '주간 회의', due: '2026-08-26', startTime: '10:00', endTime: '11:00', spaceName: '내 일정' });
    // 문서가 없으므로 docId는 빈 문자열 — 열기가 "그 칸반으로"가 아니라 일정 팝업으로 간다.
    expect(e!.event!.id).toBe('e1');
  });

  it('여러 날 일정만 start를 싣는다(하루면 기간 바가 되지 않는다)', () => {
    expect(eventEntries([EV({ endDate: '2026-08-28' })])[0]!.start).toBe('2026-08-26');
    expect(eventEntries([EV()])[0]!.start).toBeUndefined();
  });

  it('종일이면 시각을 싣지 않는다 — 시간표가 아니라 띠로 그려진다', () => {
    const [e] = eventEntries([EV({ allDay: true })]);
    expect(e!.startTime).toBeUndefined();
    expect(e!.endTime).toBeUndefined();
  });

  it('제목이 비면 자리표시자를 쓴다(빈 줄만 있는 칩을 만들지 않는다)', () => {
    expect(eventEntries([EV({ title: '' })])[0]!.title).toBe('(제목 없음)');
  });
});

describe('시간표(dayTimeline)', () => {
  const T = (from: string, to: string, id: string): CalendarEntry => ({ ...E('2026-08-26', { cardId: id, title: id }), startTime: from, endTime: to });

  it('시각이 없는 항목은 종일 띠로, 있는 항목은 블록으로 간다', () => {
    const t = dayTimeline([E('2026-08-26', { cardId: 'allday' }), T('09:00', '10:00', 'a')], '2026-08-26');
    expect(t.allDay.map((e) => e.cardId)).toEqual(['allday']);
    expect(t.blocks.map((b) => b.entry.cardId)).toEqual(['a']);
    expect(t.blocks[0]).toMatchObject({ from: 540, to: 600, lane: 0, lanes: 1 });
  });

  it('그 날을 지나지 않는 항목은 빠진다', () => {
    expect(dayTimeline([T('09:00', '10:00', 'a')], '2026-08-27').blocks).toEqual([]);
  });

  it('겹치는 블록은 열을 나눠 나란히 둔다', () => {
    const t = dayTimeline([T('09:00', '11:00', 'a'), T('10:00', '12:00', 'b')], '2026-08-26');
    expect(t.blocks.map((b) => [b.entry.cardId, b.lane, b.lanes])).toEqual([
      ['a', 0, 2],
      ['b', 1, 2],
    ]);
  });

  it('겹치지 않으면 같은 열을 다시 쓴다 — 묶음이 끝나면 열 수도 되돌아간다', () => {
    const t = dayTimeline([T('09:00', '10:00', 'a'), T('10:00', '11:00', 'b')], '2026-08-26');
    expect(t.blocks.every((b) => b.lane === 0 && b.lanes === 1)).toBe(true);
  });

  it('세 개가 한꺼번에 겹치면 열이 셋이고, 이어지는 묶음은 따로 센다', () => {
    const t = dayTimeline([T('09:00', '12:00', 'a'), T('09:30', '11:00', 'b'), T('10:00', '10:30', 'c'), T('14:00', '15:00', 'd')], '2026-08-26');
    const lanes = Object.fromEntries(t.blocks.map((b) => [b.entry.cardId, [b.lane, b.lanes]]));
    expect(lanes['a']).toEqual([0, 3]);
    expect(lanes['b']).toEqual([1, 3]);
    expect(lanes['c']).toEqual([2, 3]);
    // 다른 묶음 — 앞 묶음의 열 수에 끌려가지 않는다.
    expect(lanes['d']).toEqual([0, 1]);
  });

  it('끝 시각이 없거나 시작보다 앞이면 1시간으로 본다', () => {
    const noEnd = dayTimeline([{ ...E('2026-08-26', { cardId: 'x' }), startTime: '09:00' }], '2026-08-26');
    expect(noEnd.blocks[0]).toMatchObject({ from: 540, to: 600 });
    const inverted = dayTimeline([T('09:00', '08:00', 'y')], '2026-08-26');
    expect(inverted.blocks[0]).toMatchObject({ from: 540, to: 600 });
  });

  it('아주 짧은 일정도 최소 20분 높이를 갖는다(글자가 들어갈 자리)', () => {
    expect(dayTimeline([T('09:00', '09:05', 'z')], '2026-08-26').blocks[0]!.to).toBe(560);
  });

  it('첫 일정이 보이도록 스크롤 자리를 알려 준다(자정부터 훑게 두지 않는다)', () => {
    const t = dayTimeline([T('14:00', '15:00', 'a')], '2026-08-26');
    expect(t.focusTop).toBe(14 * HOUR_ROW - 28);
    // 시각 일정이 없으면 맞출 것이 없다.
    expect(dayTimeline([E('2026-08-26')], '2026-08-26').focusTop).toBe(0);
    // 이른 일정은 음수로 내려가지 않는다.
    expect(dayTimeline([T('00:10', '00:40', 'b')], '2026-08-26').focusTop).toBe(0);
  });
});

describe('시각·격자 구간', () => {
  it('minutesOf는 `HH:MM`만 받는다', () => {
    expect(minutesOf('09:30')).toBe(570);
    expect(minutesOf('23:59')).toBe(1439);
    expect(minutesOf('24:00')).toBeNull();
    expect(minutesOf('9:5')).toBeNull();
    expect(minutesOf(undefined)).toBeNull();
  });

  it('시각 표기는 오전·오후 12시간제(정오·자정은 12)', () => {
    expect(timeLabel(0)).toBe('오전 12:00');
    expect(timeLabel(570)).toBe('오전 9:30');
    expect(timeLabel(720)).toBe('오후 12:00');
    expect(timeLabel(1350)).toBe('오후 10:30');
    expect(hourLabel(0)).toBe('12AM');
    expect(hourLabel(13)).toBe('1PM');
  });

  it('조회 구간은 보이는 6주 격자 그대로 — 달 경계를 넘는다', () => {
    // 2026-08-01은 토요일 → 격자는 7/26(일)에 시작해 42일
    const { from, to } = gridRange(2026, 8);
    expect(from).toBe('2026-07-26');
    expect(to).toBe('2026-09-05');
    expect(daysBetween(from, to)).toBe(41);
    // 격자가 그리는 첫·마지막 칸과 같아야 한다(목록이 세는 것과 격자가 그리는 것이 같게).
    const cells = monthCells(2026, 8, [], '2026-08-26');
    expect(cells[0]!.iso).toBe(from);
    expect(cells[41]!.iso).toBe(to);
  });
});

import { describe, expect, it } from 'vitest';
import type { CalendarEntry } from './entries';
import { calendarEntries, datedCards, eventEntries } from './entries';
import type { CalendarEvent } from '../../../adapters/ports';
import { addDays, daysBetween, addMonth, calendarStats, statBadge, dayProgress, coversDay, dateLabel, dayTimeline, dueBadge, dueTone, entriesOn, gridRange, hourLabel, isSpan, minutesOf, monthCells, monthLabel, weekLanes, overdueEntries, timeLabel, todayISO, upcomingEntries, weekEndISO, weekLabel, weekStartISO, cellRows, weekRows, HOUR_ROW } from './model';

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

  it('주 이름은 그 주 일요일의 달과 몇 번째 일요일인가로 정한다', () => {
    // 2026-08: 1일이 토요일 → 첫 일요일은 8/2
    expect(weekLabel('2026-08-02')).toBe('8월 1주');
    expect(weekLabel('2026-08-08')).toBe('8월 1주'); // 같은 주(8/2~8/8)
    expect(weekLabel('2026-08-26')).toBe('8월 4주'); // 그 주 일요일 = 8/23
    // 달을 걸치는 주는 **시작한 달**로 읽는다(8/30(일)~9/5)
    expect(weekLabel('2026-09-03')).toBe('8월 5주');
    // 1일이 일요일인 달 — 그 날이 곧 1주
    expect(weekLabel('2026-11-01')).toBe('11월 1주');
    expect(weekLabel('2026-11-30')).toBe('11월 5주');
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

  it('이웃 달 칸에도 항목·기간 바가 그려진다(제보 — 월 경계를 걸치는 일정이 뚝 끊겼다)', () => {
    // 2026-08 격자: 앞은 7/26(일)~7/31, 뒤는 9/1~9/5.
    const sept = E('2026-09-02', { title: '다음 달' });
    const cross = E('2026-09-03', { start: '2026-08-30', title: '걸침' });
    const july = E('2026-07-28', { start: '2026-07-24', title: '지난 달' }); // 격자보다 먼저 시작
    const cells = monthCells(2026, 8, [sept, cross, july], TODAY);
    const at = (iso: string) => cells.find((c) => c.iso === iso)!;
    expect(at('2026-09-02').inMonth).toBe(false);
    expect(at('2026-09-02').entries.map((e) => e.title)).toEqual(['다음 달']);
    expect(at('2026-09-01').bars[0]).toMatchObject({ head: false, tail: false }); // 걸침의 가운데
    expect(at('2026-09-03').bars[0]).toMatchObject({ tail: true });
    // 격자 앞에서 시작한 기간도 첫 칸(일요일)에서 제목을 얻는다
    expect(at('2026-07-26').bars[0]).toMatchObject({ label: true, head: false });
    expect(at('2026-07-28').bars[0]).toMatchObject({ tail: true });
  });

  // ── 제보 ⑧: 기간 바의 줄(lane)은 그 주에서 고정 ────────────────────────────
  it('종료일이 다른 기간 일정들이 주 내내 같은 줄에 머문다(제보 ⑧ — 계단처럼 올라갔다)', () => {
    // 2026-08-16(일)~08-22(토) 주에 겹치는 셋: A는 화요일에 끝나고 B·C는 더 간다.
    const a = E('2026-08-18', { start: '2026-08-16', title: 'A' });
    const b = E('2026-08-20', { start: '2026-08-16', title: 'B' });
    const c = E('2026-08-22', { start: '2026-08-17', title: 'C' });
    const cells = monthCells(2026, 8, [a, b, c], TODAY);
    const at = (iso: string) => cells.find((x) => x.iso === iso)!;
    const laneOf = (iso: string, title: string) => at(iso).bars.find((x) => x.entry.title === title)?.lane;
    // 같이 시작한 A·B는 **긴 B가 위**(구글 규칙), C는 하루 늦게 시작해 그 아래.
    expect(laneOf('2026-08-16', 'B')).toBe(0);
    expect(laneOf('2026-08-16', 'A')).toBe(1);
    expect(laneOf('2026-08-17', 'C')).toBe(2);
    // A가 끝난 뒤에도 B·C는 **그 줄 그대로** — 예전에는 한 칸씩 올라왔다.
    expect(laneOf('2026-08-19', 'B')).toBe(0);
    expect(laneOf('2026-08-19', 'C')).toBe(2);
    expect(laneOf('2026-08-21', 'C')).toBe(2);
    // 칸은 **자기 바 위의 줄만** 비운다 — 정렬에 필요한 것이 그것뿐이고, 아래쪽까지
    // 비우면 바가 없는 칸이 이유 없이 자리를 잃는다.
    expect(at('2026-08-16').barRows).toBe(2); // B(0)·A(1)
    expect(at('2026-08-19').barRows).toBe(3); // B(0) + 빈 줄 + C(2)
    expect(at('2026-08-21').barRows).toBe(3); // C(2) 위의 두 줄은 비워 둔다
    // 그 셋이 없는 주는 자리도 비우지 않는다.
    expect(at('2026-08-25').barRows).toBe(0);
  });

  it('lane은 주마다 다시 배정된다 — 빈 줄이 있으면 그 자리를 쓴다', () => {
    // 첫 주만 걸치는 짧은 것과, 두 주에 걸친 긴 것.
    const long = E('2026-08-26', { start: '2026-08-16', title: '긴 것' });
    const short = E('2026-08-18', { start: '2026-08-17', title: '짧은 것' });
    const later = E('2026-08-27', { start: '2026-08-24', title: '다음 주' });
    const cells = monthCells(2026, 8, [long, short, later], TODAY);
    const at = (iso: string) => cells.find((x) => x.iso === iso)!;
    const laneOf = (iso: string, title: string) => at(iso).bars.find((x) => x.entry.title === title)?.lane;
    expect(laneOf('2026-08-17', '긴 것')).toBe(0);
    expect(laneOf('2026-08-17', '짧은 것')).toBe(1);
    // 다음 주(23~29)에는 긴 것이 계속 0번을 쓰고, 24일에 시작한 것이 1번.
    expect(laneOf('2026-08-24', '긴 것')).toBe(0);
    expect(laneOf('2026-08-24', '다음 주')).toBe(1);
    expect(at('2026-08-24').barRows).toBe(2);
  });

  it('weekLanes는 그 주에 걸치지 않는 기간을 담지 않는다', () => {
    const week = ['2026-08-16', '2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22'];
    const inWeek = E('2026-08-18', { start: '2026-08-17', title: '이 주' });
    const other = E('2026-08-31', { start: '2026-08-30', title: '다른 주' });
    const lanes = weekLanes([inWeek, other], week);
    expect(lanes.get(inWeek)).toBe(0);
    expect(lanes.has(other)).toBe(false);
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

  it('반복 일정은 구간 안에서 **회차마다** 항목이 된다 — 키가 겹치지 않고 끌 수 없다', () => {
    const list = eventEntries([EV({ allDay: true, recurrence: 'RRULE:FREQ=WEEKLY' })], { from: '2026-08-01', to: '2026-08-31' });
    expect(list.map((e) => e.due)).toEqual(['2026-08-26']);

    // 첫 회차가 구간 앞이어도 이번 구간의 회차가 모두 나온다.
    const many = eventEntries([EV({ startDate: '2026-07-29', endDate: '2026-07-29', allDay: true, recurrence: 'RRULE:FREQ=WEEKLY' })], { from: '2026-08-01', to: '2026-08-31' });
    expect(many.map((e) => e.due)).toEqual(['2026-08-05', '2026-08-12', '2026-08-19', '2026-08-26']);
    // 회차마다 다른 키(목록 키가 겹치면 첫 회차만 잡힌다) — 같은 일정을 가리킨다.
    expect(new Set(many.map((e) => e.cardId)).size).toBe(4);
    expect(many.every((e) => e.event!.id === 'e1')).toBe(true);
    // 회차는 끌어서 옮기지 않는다(이 회차만 옮기는 예외를 담을 자리가 없다).
    expect(many.every((e) => e.readOnly)).toBe(true);

    // 기간 일정의 회차는 길이를 지킨다(2일짜리 격주).
    const span = eventEntries([EV({ startDate: '2026-08-03', endDate: '2026-08-04', allDay: true, recurrence: 'RRULE:FREQ=WEEKLY;INTERVAL=2' })], { from: '2026-08-01', to: '2026-08-31' });
    expect(span.map((e) => [e.start, e.due])).toEqual([
      ['2026-08-03', '2026-08-04'],
      ['2026-08-17', '2026-08-18'],
      ['2026-08-31', '2026-09-01'],
    ]);
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

describe('마감 배지의 중요도(dueTone)', () => {
  const TODAY = '2026-08-26';
  it('지남 / 오늘 / 사흘 안 / 그 뒤 네 등급으로 갈린다', () => {
    expect(dueTone('2026-08-25', TODAY)).toBe('over');
    expect(dueTone(TODAY, TODAY)).toBe('today');
    expect(dueTone('2026-08-27', TODAY)).toBe('soon');
    expect(dueTone('2026-08-29', TODAY)).toBe('soon');
    expect(dueTone('2026-08-30', TODAY)).toBe('later');
  });
});

describe('한 칸 안의 순서 — 종일이 언제나 위(요청)', () => {
  const E = (over: Partial<CalendarEntry>): CalendarEntry => ({
    docId: 'd', cardId: 'k', title: 't', due: '2026-08-20', colId: 'c', colName: '할 일', colIndex: 0, tag: '', boardName: 'B', spaceName: 'S', ...over,
  });

  it('격자 칸: 종일 → 시간(시작 시각순)', () => {
    const entries = [
      E({ cardId: 'pm', title: '오후 회의', startTime: '14:00' }),
      E({ cardId: 'all1', title: '휴가' }),
      E({ cardId: 'am', title: '오전 회의', startTime: '09:00' }),
      E({ cardId: 'all2', title: '마감' }),
    ];
    const cell = monthCells(2026, 8, entries, '2026-08-01', 10).find((c) => c.iso === '2026-08-20')!;
    expect(cell.entries.map((e) => e.title)).toEqual(['휴가', '마감', '오전 회의', '오후 회의']);
  });

  it('그 날 목록도 같은 규칙이다 — 접히는 쪽은 언제나 시간 일정', () => {
    const entries = [E({ cardId: 'pm', title: '오후', startTime: '14:00' }), E({ cardId: 'all', title: '종일' })];
    expect(entriesOn(entries, '2026-08-20').map((e) => e.title)).toEqual(['종일', '오후']);
    // 칸이 한 칸뿐이면 남는 것은 시간 일정이다(`+N개 더`).
    const cell = monthCells(2026, 8, entries, '2026-08-01', 1).find((c) => c.iso === '2026-08-20')!;
    expect(cell.entries.map((e) => e.title)).toEqual(['종일']);
    expect(cell.moreN).toBe(1);
  });
});


describe('근무 위치 칸 표시(제보 ⑥)', () => {
  it('그 날 칸에 한 마디로 실린다 — 일정 칩이 아니다', () => {
    const cells = monthCells(2026, 8, [], '2026-08-10', 2, 6, {}, { '2026-08-11': '재택' });
    const on = cells.find((c) => c.iso === '2026-08-11')!;
    expect(on.work).toBe('재택');
    expect(on.entries).toEqual([]);
    expect(cells.find((c) => c.iso === '2026-08-12')!.work).toBeUndefined();
  });
});

describe('칸의 줄 계획(cellRows)', () => {
  const SPAN = (id: string, start: string, due: string): CalendarEntry => ({
    docId: 'd', cardId: id, title: id, due, start, colId: 'c', colName: '할 일', colIndex: 0, tag: '', boardName: 'B', spaceName: 'S',
  });
  const DAY = (id: string, due: string): CalendarEntry => ({
    docId: 'd', cardId: id, title: id, due, colId: 'c', colName: '할 일', colIndex: 0, tag: '', boardName: 'B', spaceName: 'S',
  });
  const cellOf = (entries: CalendarEntry[], iso: string) => monthCells(2026, 8, entries, '2026-08-01', 99).find((c) => c.iso === iso)!;
  /** 그 날이 든 한 주(7칸) — 격자의 첫 칸은 달의 1일이 아니라 그 주의 일요일이다. */
  const weekOf = (entries: CalendarEntry[], iso: string) => {
    const cells = monthCells(2026, 8, entries, '2026-08-01', 99);
    const i = cells.findIndex((c) => c.iso === iso);
    const from = Math.floor(i / 7) * 7;
    return cells.slice(from, from + 7);
  };
  const shape = (rows: ReturnType<typeof cellRows>) => rows.map((r) => (r.kind === 'bar' ? `bar:${r.bar.entry.cardId}` : r.kind === 'chip' ? `chip:${r.entry.cardId}` : r.kind === 'more' ? `more:${r.n}` : 'gap'));

  // A(9~14) · B(10~11) · C(11~14) — 한 주에서 A=0 · B=1 · C=2 줄이고,
  // 12일 칸에서는 B가 이미 끝나 **가운데 줄이 빈다**(제보 ①의 그 모양).
  const A = SPAN('A', '2026-08-09', '2026-08-14');
  const B = SPAN('B', '2026-08-10', '2026-08-11');
  const C = SPAN('C', '2026-08-11', '2026-08-14');

  it('빈 줄이 있으면 하루짜리 칩이 그 자리를 먼저 채운다(제보 ①)', () => {
    expect(shape(cellRows(cellOf([A, B, C, DAY('new', '2026-08-12')], '2026-08-12'), 9))).toEqual(['bar:A', 'chip:new', 'bar:C']);
    // 11일에는 B가 살아 있으므로 새 일정은 그 아래로 간다.
    expect(shape(cellRows(cellOf([A, B, C, DAY('x', '2026-08-11')], '2026-08-11'), 9))).toEqual(['bar:A', 'bar:B', 'bar:C', 'chip:x']);
  });

  it('넘치면 마지막 줄이 +N개가 되고 바·칩을 함께 센다(제보 ②)', () => {
    // 기간 3 + 하루짜리 3 = 6줄인데 5칸만 들어간다 → 4줄 + `+2개`.
    const entries = [A, B, C, DAY('d1', '2026-08-11'), DAY('d2', '2026-08-11'), DAY('d3', '2026-08-11')];
    const rows = cellRows(cellOf(entries, '2026-08-11'), 5);
    expect(rows).toHaveLength(5);
    expect(shape(rows)).toEqual(['bar:A', 'bar:B', 'bar:C', 'chip:d1', 'more:2']);
  });

  it('빈 줄은 접힌 개수에 들지 않는다 — 감출 일정이 없다', () => {
    // 12일 칸: [A · 빈 줄 · C]. 두 줄만 들어가도 감춰진 것은 C 하나뿐이다.
    expect(shape(cellRows(cellOf([A, B, C], '2026-08-12'), 2))).toEqual(['bar:A', 'more:1']);
  });

  it('한 칸에서 접힌 다일 바는 그 주 전체에서 접힌다(제보 ②)', () => {
    // 제보: 혼잡한 가운데 칸에서만 바가 `+N개`로 들어가 띠가 중간에서 끊겨 보였다.
    // 12일만 붐비게 해 놓고 한 주를 계획하면, A는 그 주 어느 칸에서도 바로 서지
    // 않는다(구글 캘린더 정책 — 다일 일정은 한 주 안에서 함께 접힌다).
    const busy = ['d1', 'd2', 'd3'].map((id) => DAY(id, '2026-08-12'));
    const week = weekOf([A, B, C, ...busy], '2026-08-09');
    expect(week.map((c) => c.iso)).toContain('2026-08-12');
    const plan = weekRows(week, 3, 2);
    const byIso = new Map(week.map((c, i) => [c.iso, shape(plan[i]!)]));
    // 12일이 붐벼 C가 그 칸에서 밀렸다 → **그 주 어느 칸에서도** 바로 서지 않는다.
    for (const [, rows] of byIso) expect(rows).not.toContain('bar:C');
    // 접힌 바는 그 칸의 `+N개`에 들어간다 — 개수가 사라지지 않는다.
    expect(byIso.get('2026-08-13')).toEqual(['bar:A', 'more:1']);
    expect(byIso.get('2026-08-12')).toEqual(['bar:A', 'chip:d1', 'more:3']);
    // 12일 밖의 다른 바(B)는 그대로 — 접히는 것은 밀린 그 바뿐이다.
    expect(byIso.get('2026-08-10')).toEqual(['bar:A', 'bar:B']);
  });

  it('여유가 있으면 주 전체가 그대로 그려진다(무회귀)', () => {
    const week = weekOf([A, B, C], '2026-08-09');
    const plan = weekRows(week, 9, 8);
    const at = (iso: string) => shape(plan[week.findIndex((c) => c.iso === iso)]!);
    expect(at('2026-08-12')).toEqual(['bar:A', 'gap', 'bar:C']);
    expect(at('2026-08-11')).toEqual(['bar:A', 'bar:B', 'bar:C']);
  });

  it('모델이 이미 접은 개수(moreN)도 함께 센다', () => {
    const entries = [DAY('a', '2026-08-10'), DAY('b', '2026-08-10'), DAY('c', '2026-08-10')];
    const cell = monthCells(2026, 8, entries, '2026-08-01', 2).find((c) => c.iso === '2026-08-10')!;
    expect(cell.moreN).toBe(1);
    // 두 줄만 그릴 수 있으면 첫 줄 + `+2개`(그린 것 하나 + 모델이 접은 하나).
    expect(shape(cellRows(cell, 2))).toEqual(['chip:a', 'more:2']);
  });
});

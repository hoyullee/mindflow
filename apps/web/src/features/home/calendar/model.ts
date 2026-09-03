// 일정 화면의 순수 계산 — 달력 격자·통계·목록. DOM도 테마도 모른다.
//
// 날짜는 전부 **로컬 날짜 문자열**(`YYYY-MM-DD`)로 다룬다. 칸반 `due`/`start`가 그
// 꼴이고, 여기에 시각·타임존을 끌어들이면 규칙이 둘로 갈린다(시각이 필요한 일정은
// Geurio 일정이 맡는다 — 그때 변환을 한 곳에 모은다).

import type { CalendarEntry, HolidayInfo } from './entries';

export function isoOf(y: number, m: number, d: number): string {
  return `${y}-${`${m}`.padStart(2, '0')}-${`${d}`.padStart(2, '0')}`;
}

export function todayISO(now: Date = new Date()): string {
  return isoOf(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** `YYYY-MM-DD` → {y,m,d}. 꼴이 아니면 null. */
export function partsOf(iso: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? { y: +m[1]!, m: +m[2]!, d: +m[3]! } : null;
}

export function monthLabel(y: number, m: number): string {
  return `${y}년 ${m}월`;
}

export function addMonth(y: number, m: number, delta: number): { y: number; m: number } {
  const t = y * 12 + (m - 1) + delta;
  return { y: Math.floor(t / 12), m: (t % 12) + 1 };
}

/**
 * 두 날 사이의 날 수(`b - a`). 드래그로 날짜를 옮길 때 "몇 날 움직였나"가 된다.
 *
 * 정오를 기준으로 계산한다 — 자정으로 계산하면 서머타임이 있는 지역에서 하루가
 * 23·25시간이 되어 나눗셈이 한 날 어긋난다(우리 앱은 종일 날짜만 다루므로 정오
 * 기준이면 그 흔들림 안쪽이다).
 */
export function daysBetween(a: string, b: string): number {
  const pa = partsOf(a);
  const pb = partsOf(b);
  if (!pa || !pb) return 0;
  const ms = new Date(pb.y, pb.m - 1, pb.d, 12).getTime() - new Date(pa.y, pa.m - 1, pa.d, 12).getTime();
  return Math.round(ms / 86400000);
}

/**
 * `iso`에서 `n`일 뒤(음수면 앞). `daysBetween`의 짝 — 정오 기준이라 서머타임에도
 * 한 날 어긋나지 않는다.
 */
export function addDays(iso: string, n: number): string {
  const p = partsOf(iso);
  if (!p) return iso;
  const d = new Date(p.y, p.m - 1, p.d + n, 12);
  return isoOf(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/** 그 날이 속한 주의 일요일. */
export function weekStartISO(iso: string): string {
  const p = partsOf(iso);
  if (!p) return iso;
  const d = new Date(p.y, p.m - 1, p.d);
  d.setDate(d.getDate() - d.getDay());
  return isoOf(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/** 일요일 시작 7일 창의 마지막 날. */
export function weekEndISO(iso: string): string {
  const p = partsOf(weekStartISO(iso));
  if (!p) return iso;
  const d = new Date(p.y, p.m - 1, p.d + 6);
  return isoOf(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/**
 * `8월 3주` — 그 날이 든 주(일요일 시작)의 이름표.
 *
 * 달은 **그 주의 일요일**이 속한 달이다(주가 달을 걸치면 시작한 달로 읽는다 —
 * 8/30(일)~9/5은 `8월 5주`). 번호는 그 달의 몇 번째 일요일인가이고, 일요일은
 * 7일 간격이라 그 달 1일의 요일과 무관하게 `floor((일-1)/7)+1`이 맞는다.
 */
export function weekLabel(iso: string): string {
  const p = partsOf(weekStartISO(iso));
  if (!p) return '';
  return `${p.m}월 ${Math.floor((p.d - 1) / 7) + 1}주`;
}

/** 기간 일정인가 — 시작일이 있고 기한보다 앞선다. 기간은 **바**로만 그린다(칩 중복 방지). */
export function isSpan(e: CalendarEntry): boolean {
  return !!e.start && e.start < e.due;
}

/** 이 항목이 그 날을 덮는가(기간이면 start~due, 아니면 기한 하루). */
export function coversDay(e: CalendarEntry, iso: string): boolean {
  return isSpan(e) ? e.start! <= iso && iso <= e.due : e.due === iso;
}

export interface MonthBar {
  entry: CalendarEntry;
  /** 이 칸에서 왼쪽/오른쪽 끝인가 — 모서리를 둥글게 한다. */
  head: boolean;
  tail: boolean;
  /** 제목을 이 칸에 쓸지(시작 칸과 주의 첫 칸에만 — 디자인 원본). */
  label: boolean;
  /**
   * 그 **주 안에서** 이 일정이 쓰는 줄(0부터). 주 단위로 고정이라 하루짜리 일정이
   * 끝나도 남은 바가 위로 올라오지 않는다 — 예전에는 칸마다 "그 날을 덮는 것들"을
   * 순서대로 쌓아서, 종료일이 다른 기간 일정 여럿이 겹치면 칸을 지날수록 한 칸씩
   * 올라가 **계단처럼** 보였다(제보 ⑧). 구글 캘린더가 쓰는 방식이다.
   */
  lane: number;
}

export interface MonthCell {
  iso: string;
  /** 칸에 쓰는 숫자. 이웃 달 칸도 숫자를 쓴다(흐리게). */
  n: number;
  /** 이 달의 날짜인가. */
  inMonth: boolean;
  isToday: boolean;
  /** 지난 날 — 흐리게 그린다. */
  dim: boolean;
  /** 0=일 … 6=토. */
  dow: number;
  /**
   * 공휴일 이름 — 숫자 옆에 적는다(디자인 원본). 원천은 사용자가 구독한 **구글
   * 공휴일 캘린더**다(PR5 — `entries.holidayMap`). 연동하지 않았으면 비어 있고,
   * 달력은 예전 그대로 그린다.
   */
  holiday?: string;
  /**
   * 그중 **실제로 쉬는 날**인가 — 이때만 숫자·칸을 일요일 색으로 그린다. 구글의
   * 공휴일 캘린더에는 절기·기념일도 들어 있어, 이름이 있다고 다 칠하면 달이
   * 통째로 분홍이 된다(제보).
   */
  dayOff?: boolean;
  /**
   * 근무 위치(구글) — 재택·사무실 한 마디. 일정이 아니라 그 날의 상태라 칩이 아니고
   * 칸 **우측 상단**에 작게 그린다(제보: 근무 위치까지 일정으로 잡혔다).
   */
  work?: string;
  /** 그 날 하루짜리 항목(기간은 제외 — 바로 그린다). */
  entries: CalendarEntry[];
  bars: MonthBar[];
  /**
   * 이 칸이 기간 바에 **비워 두는 줄 수** — 이 칸의 바 중 가장 아래 lane까지다.
   * 그 위의 빈 줄은 자리를 비우므로 한 주 안에서 같은 일정이 같은 높이에 이어지고,
   * **아래쪽 빈 줄은 비우지 않는다**(바가 없는 칸이 이유 없이 88px을 잃지 않게 —
   * 정렬에 필요한 것은 그 바 **위**의 줄뿐이다).
   */
  barRows: number;
  /** 칸에 못 담아 접은 개수. */
  moreN: number;
}

/**
 * 한 주(7칸)의 기간 일정에 **줄(lane)을 배정한다** — 같은 일정은 그 주 내내 같은 줄에
 * 머문다(제보 ⑧: 종료일이 다른 기간 일정들이 칸마다 계단처럼 올라갔다).
 *
 * 규칙은 구글 캘린더와 같다: **일찍 시작한 것이 위**, 같이 시작하면 **긴 것이 위**,
 * 그래도 같으면 이름·id로 못박는다(순서가 렌더마다 흔들리면 그것도 계단이다).
 * 각 일정은 그 주에서 자기 구간이 비어 있는 **가장 위 줄**을 차지한다.
 */
export function weekLanes(spans: readonly CalendarEntry[], weekIsos: readonly string[]): Map<CalendarEntry, number> {
  const inWeek = spans.filter((e) => weekIsos.some((iso) => coversDay(e, iso)));
  const len = (e: CalendarEntry): number => daysBetween(e.start ?? e.due, e.due);
  const sorted = [...inWeek].sort((a, b) => {
    const as = a.start ?? a.due;
    const bs = b.start ?? b.due;
    if (as !== bs) return as < bs ? -1 : 1;
    if (len(a) !== len(b)) return len(b) - len(a);
    if (a.title !== b.title) return a.title < b.title ? -1 : 1;
    return `${a.docId}:${a.cardId}` < `${b.docId}:${b.cardId}` ? -1 : 1;
  });
  /** lane마다 그 주에서 이미 찬 칸(인덱스) 집합. */
  const taken: Set<number>[] = [];
  const out = new Map<CalendarEntry, number>();
  for (const e of sorted) {
    const cols = weekIsos.map((iso, i) => (coversDay(e, iso) ? i : -1)).filter((i) => i >= 0);
    let lane = 0;
    while (taken[lane] && cols.some((c) => taken[lane]!.has(c))) lane += 1;
    const set = taken[lane] ?? new Set<number>();
    for (const c of cols) set.add(c);
    taken[lane] = set;
    out.set(e, lane);
  }
  return out;
}

/**
 * 달력 격자. 월마다 표 높이가 달라지지 않게 **항상 6주(42칸)**로 채운다(디자인 원본).
 * `perCell`은 한 칸에 보이는 칩 수 — 넘치면 `moreN`으로 접는다.
 */
export function monthCells(y: number, m: number, entries: readonly CalendarEntry[], todayIso: string, perCell = 2, weeks = 6, holidays: Record<string, HolidayInfo> = {}, works: Record<string, string> = {}): MonthCell[] {
  const first = new Date(y, m - 1, 1);
  const firstDow = first.getDay();
  const days = new Date(y, m, 0).getDate();
  const prevDays = new Date(y, m - 1, 0).getDate();
  const byDay = new Map<string, CalendarEntry[]>();
  const spans: CalendarEntry[] = [];
  for (const e of entries) {
    if (isSpan(e)) spans.push(e);
    else {
      const list = byDay.get(e.due);
      if (list) list.push(e);
      else byDay.set(e.due, [e]);
    }
  }
  // 칸을 먼저 **날짜만** 나열하고(주 단위로 lane을 배정해야 하므로) 그 뒤에 만든다.
  const slots: { iso: string; n: number; inMonth: boolean; dow: number }[] = [];
  const push = (iso: string, n: number, inMonth: boolean, dow: number): void => {
    slots.push({ iso, n, inMonth, dow });
  };
  for (let i = 0; i < firstDow; i++) {
    const p = addMonth(y, m, -1);
    push(isoOf(p.y, p.m, prevDays - firstDow + 1 + i), prevDays - firstDow + 1 + i, false, i);
  }
  for (let d = 1; d <= days; d++) push(isoOf(y, m, d), d, true, (firstDow + d - 1) % 7);
  let next = 1;
  const nx = addMonth(y, m, 1);
  while (slots.length < weeks * 7) {
    push(isoOf(nx.y, nx.m, next), next, false, slots.length % 7);
    next += 1;
  }

  const cells: MonthCell[] = [];
  const build = (iso: string, n: number, inMonth: boolean, dow: number, lanes: Map<CalendarEntry, number>): void => {
    // 이웃 달 칸에도 항목을 그린다(제보: 이전 달에서 시작해 이번 달로 이어지거나
    // 다음 달까지 이어지는 일정이 그 칸에서 뚝 끊겨 보였다). 격자는 날짜가 이어지는
    // 6주라 기간 바가 자연스럽게 이어지고, 하루짜리도 구글 캘린더처럼 흐리게 보인다.
    // 격자 첫 칸은 언제나 일요일이므로 격자 앞에서 시작한 기간도 첫 칸에서 제목을 얻는다.
    // 종일이 위, 시간 일정이 아래(요청) — 그래서 `+N개 더`로 접히는 쪽은 시간 일정이다.
    const list = [...(byDay.get(iso) ?? [])].sort(compareInDay);
    const bars: MonthBar[] = spans
      .filter((e) => coversDay(e, iso))
      .map((e) => ({ entry: e, head: e.start === iso, tail: e.due === iso, label: e.start === iso || dow === 0, lane: lanes.get(e) ?? 0 }))
      .sort((a, b) => a.lane - b.lane);
    cells.push({
      iso,
      n,
      inMonth,
      isToday: inMonth && iso === todayIso,
      dim: inMonth ? iso < todayIso : false,
      dow,
      // 공휴일은 **이웃 달 칸에도** 싣는다(요청) — 그 칸의 숫자도 토·일과 같은
      // 규칙으로 색이 정해져야 하고(쉬는 날은 붉게), 이름을 함께 두면 왜 붉은지도
      // 읽힌다. 이웃 달임은 흐린 숫자·가라앉은 면이 이미 말한다.
      ...(holidays[iso] ? { holiday: holidays[iso].name, ...(holidays[iso].dayOff ? { dayOff: true } : {}) } : {}),
      ...(works[iso] ? { work: works[iso] } : {}),
      entries: list.slice(0, perCell),
      bars,
      barRows: bars.length ? Math.max(...bars.map((b) => b.lane)) + 1 : 0,
      moreN: Math.max(0, list.length - perCell),
    });
  };
  // 주마다 lane을 배정하고 그 주의 일곱 칸이 **같은 줄 수**를 비운다.
  for (let w = 0; w * 7 < slots.length; w += 1) {
    const week = slots.slice(w * 7, w * 7 + 7);
    const lanes = weekLanes(spans, week.map((c) => c.iso));
    for (const c of week) build(c.iso, c.n, c.inMonth, c.dow, lanes);
  }
  return cells;
}

/**
 * 칸 하나에 실제로 그릴 **줄 목록**. 달력 격자와 대시보드 위젯이 같은 함수를 쓴다
 * (칸을 채우는 규칙이 화면마다 다르면 그게 곧 버그다).
 *
 * 규칙 셋:
 * ① 기간 바는 그 주에서 배정받은 줄(lane)에 그대로 앉는다 — 위쪽의 빈 줄은 자리를
 *    비워야 같은 일정이 칸을 지나도 같은 높이에 남는다.
 * ② **빈 줄이 있으면 하루짜리 칩이 그 자리를 먼저 채운다**(제보 ①: A·C만 남은 칸의
 *    B 자리가 비어 있는데 새 일정이 그 아래로 밀렸다). 구글 캘린더도 같다.
 * ③ 넘치면 **마지막 줄을 `+N개`에 내준다**(제보 ②: 다일 일정과 하루짜리가 섞이면
 *    접힘 표시가 아예 안 나왔다 — 예전에는 칩만 세고 바는 세지 않았다). N은 그 칸에서
 *    보이지 않게 된 항목 수이고, 빈 줄은 세지 않는다.
 */
export type CellRow = { kind: 'bar'; bar: MonthBar } | { kind: 'chip'; entry: CalendarEntry } | { kind: 'gap' } | { kind: 'more'; n: number };

export function cellRows(cell: MonthCell, capacity: number, shownWithMore?: number): CellRow[] {
  return planCell(cell, capacity, shownWithMore, new Set(), null);
}

/**
 * 한 주(7칸)의 줄 목록 — **기간 바의 접힘은 주 단위로 판단한다**(제보 ②).
 *
 * 칸마다 따로 접으면 혼잡한 가운데 칸에서만 바가 `+N개`로 들어가, 이어지던 띠가
 * **중간에서 끊겨 보인다**(1·3일에는 A가 있는데 2일에만 없다). 구글 캘린더도 한 주
 * 안에서는 같은 줄까지만 보여 준다 — 어느 칸에서든 밀려난 기간 일정은 그 주의
 * **모든 칸에서** 접히고 대신 `+N개`에 함께 센다.
 *
 * 접힌 줄은 자리도 비우지 않는다: 그 주 전체에서 같은 줄이 사라지므로 lane을 다시
 * 촘촘하게 매겨도 칸끼리 어긋나지 않는다(오히려 남은 바가 한 줄 위로 붙어 여유가 는다).
 */
export function weekRows(week: readonly MonthCell[], capacity: number, shownWithMore?: number): CellRow[][] {
  const folded = new Set<CalendarEntry>();
  // 접을 기간 일정이 더 없을 때까지 되풀이한다 — 한 번 접으면 lane이 촘촘해져
  // 다른 칸의 사정도 달라지므로 다시 본다(접는 대상은 매번 늘어나므로 끝난다).
  for (let guard = 0; guard <= week.length * 8; guard += 1) {
    const laneMap = compactLanes(week, folded);
    const plans = week.map((c) => planWithDrops(c, capacity, shownWithMore, folded, laneMap));
    const fresh = plans.flatMap((p) => p.dropped).filter((e) => !folded.has(e));
    if (!fresh.length) return plans.map((p) => p.rows);
    for (const e of fresh) folded.add(e);
  }
  // 여기 오는 일은 없다(위 루프가 반드시 끝난다) — 안전망으로 마지막 계획을 쓴다.
  const laneMap = compactLanes(week, folded);
  return week.map((c) => planWithDrops(c, capacity, shownWithMore, folded, laneMap).rows);
}

/**
 * 접힌 기간 일정을 뺀 뒤 남은 lane을 **0부터 촘촘하게** 다시 매긴다. 주 전체를 보고
 * 한 번에 정하므로 칸마다 같은 값을 쓴다(그래야 띠가 같은 높이에 이어진다).
 */
function compactLanes(week: readonly MonthCell[], folded: ReadonlySet<CalendarEntry>): Map<number, number> {
  const lanes = new Set<number>();
  for (const c of week) for (const b of c.bars) if (!folded.has(b.entry)) lanes.add(b.lane);
  const out = new Map<number, number>();
  [...lanes].sort((a, b) => a - b).forEach((lane, i) => out.set(lane, i));
  return out;
}

function planWithDrops(
  cell: MonthCell,
  capacity: number,
  shownWithMore: number | undefined,
  folded: ReadonlySet<CalendarEntry>,
  laneMap: Map<number, number>,
): { rows: CellRow[]; dropped: CalendarEntry[] } {
  const dropped: CalendarEntry[] = [];
  const rows = planCell(cell, capacity, shownWithMore, folded, laneMap, dropped);
  return { rows, dropped };
}

function planCell(
  cell: MonthCell,
  capacity: number,
  shownWithMore: number | undefined,
  folded: ReadonlySet<CalendarEntry>,
  laneMap: Map<number, number> | null,
  dropped?: CalendarEntry[],
): CellRow[] {
  const bars = cell.bars.filter((b) => !folded.has(b.entry));
  const laneOf = (lane: number): number => laneMap?.get(lane) ?? lane;
  const barRows = bars.length ? Math.max(...bars.map((b) => laneOf(b.lane))) + 1 : 0;
  const rows: CellRow[] = Array.from({ length: barRows }, (_, lane) => {
    const bar = bars.find((b) => laneOf(b.lane) === lane);
    return bar ? ({ kind: 'bar', bar } as CellRow) : ({ kind: 'gap' } as CellRow);
  });
  const queue = [...cell.entries];
  for (let i = 0; i < rows.length && queue.length; i += 1) {
    if (rows[i]!.kind === 'gap') rows[i] = { kind: 'chip', entry: queue.shift()! };
  }
  for (const entry of queue) rows.push({ kind: 'chip', entry });

  // 그 주에서 접힌 기간 일정이 이 날을 덮으면 `+N개`에 함께 센다.
  let foldedHere = 0;
  for (const e of folded) if (coversDay(e, cell.iso)) foldedHere += 1;
  const limit = Math.max(1, capacity);
  if (rows.length <= limit && cell.moreN === 0 && foldedHere === 0) return rows;
  // 접힘 표시를 붙일 때 남길 줄 수는 **따로 받는다**(제보: 여유가 있는데도 접혔다) —
  // `+N개 더` 줄은 칩보다 낮아서 같은 칸 높이에 한 줄이 더 들어간다. 주지 않으면
  // 예전처럼 마지막 줄을 그 표시에 내준다(대시보드 위젯이 그 규칙을 쓴다).
  const keep = Math.max(1, Math.min(shownWithMore ?? limit - 1, rows.length));
  const shown = rows.slice(0, keep);
  const cut = rows.slice(keep);
  if (dropped) for (const r of cut) if (r.kind === 'bar') dropped.push(r.bar.entry);
  const hidden = cut.filter((r) => r.kind !== 'gap').length + cell.moreN + foldedHere;
  // 잘라 낸 것이 빈 줄뿐이면 접힘 표시를 둘 이유가 없다.
  if (hidden === 0) return rows.slice(0, limit);
  return [...shown, { kind: 'more', n: hidden }];
}

/** 통계 줄의 한 칩. 개수가 0이면 무채색으로 그린다(그리는 쪽 판단). */
export interface CalendarStat {
  key: 'over' | 'today' | 'week' | 'span';
  label: string;
  unit: string;
  count: number;
  /** 그 통계에 든 항목들 — 칩을 누르면 뜨는 팝오버가 이 목록을 그린다. */
  items: CalendarEntry[];
}

/** 지난 마감 · 오늘 마감 · 이번 주 · 기간 일정. 기간은 **기한** 기준으로 센다. */
export function calendarStats(entries: readonly CalendarEntry[], todayIso: string): CalendarStat[] {
  const ws = weekStartISO(todayIso);
  const we = weekEndISO(todayIso);
  const over: CalendarEntry[] = [];
  const today: CalendarEntry[] = [];
  const week: CalendarEntry[] = [];
  const span: CalendarEntry[] = [];
  for (const e of entries) {
    if (isSpan(e)) span.push(e);
    if (e.due < todayIso) over.push(e);
    if (e.due === todayIso) today.push(e);
    if (e.due >= ws && e.due <= we) week.push(e);
  }
  // 지난 마감은 **가까운 것부터**(어제 놓친 일이 한 달 전 일보다 급하다).
  over.sort((a, b) => (a.due < b.due ? 1 : a.due > b.due ? -1 : 0));
  return [
    { key: 'over', label: '지난 마감', unit: '건', count: over.length, items: over },
    { key: 'today', label: '오늘 마감', unit: '건', count: today.length, items: today },
    { key: 'week', label: '이번 주', unit: '건', count: week.length, items: week },
    { key: 'span', label: '기간 일정', unit: '개', count: span.length, items: span },
  ];
}


/** 다가오는 마감(오늘 포함, 이른 것 먼저). */
export function upcomingEntries(entries: readonly CalendarEntry[], todayIso: string): CalendarEntry[] {
  return entries.filter((e) => e.due >= todayIso);
}

/** 지난 마감(늦은 것 먼저 = 최근에 놓친 것부터). */
export function overdueEntries(entries: readonly CalendarEntry[], todayIso: string): CalendarEntry[] {
  return entries.filter((e) => e.due < todayIso).sort((a, b) => (a.due < b.due ? 1 : a.due > b.due ? -1 : 0));
}

/**
 * 한 칸 안의 순서(요청) — **종일 일정이 언제나 위**다. 구글 캘린더와 같은 규칙이고
 * 근거도 같다: 종일은 그 날 전체에 걸린 일이라 "몇 시의 일"보다 먼저 읽혀야 하고,
 * 칸이 좁아 뒤가 `+N개 더`로 접히므로 **접히는 쪽이 시간 일정**이어야 맞다.
 *
 * 종일끼리는 원래 순서(수집 순 — 칸반 마감 → Geurio → 구글), 시간 일정끼리는
 * 시작 시각순이다. 시각이 같으면 원래 순서를 지킨다(정렬이 흔들리지 않게).
 */
export function compareInDay(a: CalendarEntry, b: CalendarEntry): number {
  const at = a.startTime ?? '';
  const bt = b.startTime ?? '';
  if (!at && !bt) return 0;
  if (!at) return -1;
  if (!bt) return 1;
  return at < bt ? -1 : at > bt ? 1 : 0;
}

/** 그 날의 모든 항목 — 하루짜리 + 그 날을 덮는 기간. 종일이 위로 온다. */
export function entriesOn(entries: readonly CalendarEntry[], iso: string): CalendarEntry[] {
  return entries.filter((e) => coversDay(e, iso)).sort(compareInDay);
}

/**
 * 그 날 이 항목이 며칠째인가 — 기간 일정의 `3/7일째`(디자인 원본의 note).
 * 하루짜리는 진행이라는 개념이 없어 `null`.
 */
export function dayProgress(e: CalendarEntry, iso: string): string | null {
  if (!isSpan(e)) return null;
  const from = partsOf(e.start!);
  const to = partsOf(e.due);
  const at = partsOf(iso);
  if (!from || !to || !at) return null;
  const day = (p: { y: number; m: number; d: number }) => new Date(p.y, p.m - 1, p.d).getTime();
  const total = Math.round((day(to) - day(from)) / 86_400_000) + 1;
  const nth = Math.round((day(at) - day(from)) / 86_400_000) + 1;
  if (total < 2 || nth < 1 || nth > total) return null;
  return `${nth}/${total}일째`;
}

/** `오늘` / `지남` / `D-3` — 목록의 날짜 배지. */
export function dueBadge(iso: string, todayIso: string): string {
  if (iso === todayIso) return '오늘';
  if (iso < todayIso) return '지남';
  const a = partsOf(todayIso);
  const b = partsOf(iso);
  if (!a || !b) return '';
  const days = Math.round((new Date(b.y, b.m - 1, b.d).getTime() - new Date(a.y, a.m - 1, a.d).getTime()) / 86_400_000);
  return `D-${days}`;
}

/**
 * 마감 배지의 **중요도**(제보 — `오늘`도 `D-14`도 같은 색이라 급한 정도가 안 보였다).
 * 네 단계로만 가른다: 지났다 / 오늘이다 / 사흘 안이다 / 그 뒤다. 색은 화면이 정하고
 * 여기서는 등급만 — 마감 목록·팝오버가 같은 사다리를 쓰게 한다.
 */
export type DueTone = 'over' | 'today' | 'soon' | 'later';
export function dueTone(iso: string, todayIso: string): DueTone {
  const n = daysBetween(todayIso, iso);
  return n < 0 ? 'over' : n === 0 ? 'today' : n <= 3 ? 'soon' : 'later';
}

/**
 * 통계 팝오버 줄의 배지 — 지난 마감은 **며칠 지났는지**(`-4일`)까지 말한다.
 * 격자·사이드의 `dueBadge`가 `지남` 한 마디로 끝내는 것과 다른 이유는, 이 목록이
 * 놓친 일을 훑어 고르는 자리라 어제 것과 한 달 전 것이 구별돼야 하기 때문이다.
 */
export function statBadge(iso: string, todayIso: string): string {
  const n = daysBetween(todayIso, iso);
  return n === 0 ? '오늘' : n < 0 ? `${n}일` : `D-${n}`;
}

/** `8월 26일 (수)` — 팝업·목록의 날짜 표기. */
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
export function dateLabel(iso: string): string {
  const p = partsOf(iso);
  if (!p) return iso;
  return `${p.m}월 ${p.d}일 (${DOW[new Date(p.y, p.m - 1, p.d).getDay()]})`;
}

export { DOW };

// ── 시간표(날짜별 보기) — 디자인 원본의 `agenda*` ──────────────────────────────
//
// 하루 24행(행 높이 `HOUR_ROW`)에 시각 있는 일정을 절대 위치로 놓고, **시간이 겹치는
// 일정은 나란히** 둔다(겹치는 묶음 안에서 열(lane)을 나눠 폭을 쪼갠다 — 원본의 `layout`).
// 순수 계산이라 DOM도 테마도 모른다.

/**
 * 월 격자가 실제로 보여 주는 구간(6주 = 42일). 일정 조회는 이 구간과 겹치는 것을
 * 받아야 한다 — 격자가 그리는 것과 목록이 세는 것이 같아야 하고, 달 경계를 넘는
 * 이웃 달 칸에도 일정이 뜬다.
 */
export function gridRange(y: number, m: number, weeks = 6): { from: string; to: string } {
  const first = new Date(y, m - 1, 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  const end = new Date(start);
  end.setDate(start.getDate() + weeks * 7 - 1);
  return { from: isoOf(start.getFullYear(), start.getMonth() + 1, start.getDate()), to: isoOf(end.getFullYear(), end.getMonth() + 1, end.getDate()) };
}

/** 시간표 한 행의 높이(px) — 원본 `ROW = 36`. */
export const HOUR_ROW = 36;

/** `HH:MM` → 자정부터의 분. 꼴이 아니면 null. */
export function minutesOf(hhmm: string | undefined): number | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(hhmm ?? '');
  return m ? +m[1]! * 60 + +m[2]! : null;
}

/** 분 → `오전 9:30` 꼴(사이드 목록·블록 안 표기). */
export function timeLabel(mins: number): string {
  const h = Math.floor(mins / 60);
  const mm = `${mins % 60}`.padStart(2, '0');
  const ampm = h < 12 ? '오전' : '오후';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${ampm} ${h12}:${mm}`;
}

/** 시간표 블록 한 칸 — 위치·크기는 비율(0~1)로 돌려주고 px 환산은 그리는 쪽이 한다. */
export interface TimelineBlock {
  entry: CalendarEntry;
  /** 시작 분·끝 분(자정 기준). */
  from: number;
  to: number;
  /** 몇 번째 열인가 / 그 묶음의 열 수 — 겹칠 때 폭을 쪼갠다. */
  lane: number;
  lanes: number;
}

export interface DayTimeline {
  /** 종일(시각 없는) 항목 — 시간표 위의 띠. */
  allDay: CalendarEntry[];
  /** 시각 있는 항목의 블록. */
  blocks: TimelineBlock[];
  /** 첫 일정이 보이도록 맞출 스크롤 위치(px). */
  focusTop: number;
}

/**
 * 그 날의 시간표. 시각이 없는 항목은 `allDay`로, 있는 항목은 겹침을 푼 블록으로.
 * 끝 시각이 없거나 시작보다 앞이면 **1시간**으로 본다(원본과 같은 규칙).
 */
export function dayTimeline(entries: readonly CalendarEntry[], iso: string): DayTimeline {
  const onDay = entries.filter((e) => coversDay(e, iso));
  const allDay: CalendarEntry[] = [];
  const raw: TimelineBlock[] = [];
  for (const e of onDay) {
    const from = minutesOf(e.startTime);
    if (from === null) {
      allDay.push(e);
      continue;
    }
    const end = minutesOf(e.endTime);
    const to = end !== null && end > from ? end : from + 60;
    raw.push({ entry: e, from, to: Math.max(to, from + 20), lane: 0, lanes: 1 });
  }
  raw.sort((a, b) => a.from - b.from || a.to - b.to);

  // 겹치는 묶음 단위로 열을 나눈다 — 한 묶음이 끝나면(다음 블록이 묶음 끝 이후에
  // 시작하면) 열 수를 확정하고 다음 묶음을 시작한다.
  const assign = (group: TimelineBlock[]): void => {
    const laneEnd: number[] = [];
    for (const b of group) {
      let i = laneEnd.findIndex((endAt) => endAt <= b.from);
      if (i < 0) {
        i = laneEnd.length;
        laneEnd.push(0);
      }
      laneEnd[i] = b.to;
      b.lane = i;
    }
    const n = Math.max(1, laneEnd.length);
    for (const b of group) b.lanes = n;
  };
  let group: TimelineBlock[] = [];
  let groupEnd = -1;
  for (const b of raw) {
    if (group.length && b.from >= groupEnd) {
      assign(group);
      group = [];
      groupEnd = -1;
    }
    group.push(b);
    groupEnd = Math.max(groupEnd, b.to);
  }
  if (group.length) assign(group);

  const first = raw.length ? Math.min(...raw.map((b) => b.from)) : 0;
  const focusTop = raw.length ? Math.max(0, (first / 60) * HOUR_ROW - 28) : 0;
  return { allDay, blocks: raw, focusTop };
}

/** 시간표 행 라벨 — 원본은 `12AM`·`3PM` 꼴(등폭). */
export function hourLabel(h: number): string {
  return `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'AM' : 'PM'}`;
}

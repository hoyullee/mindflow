// 일정 화면의 순수 계산 — 달력 격자·통계·목록. DOM도 테마도 모른다.
//
// 날짜는 전부 **로컬 날짜 문자열**(`YYYY-MM-DD`)로 다룬다. 칸반 `due`/`start`가 그
// 꼴이고, 여기에 시각·타임존을 끌어들이면 규칙이 둘로 갈린다(시각이 필요한 일정은
// Geurio 일정이 맡는다 — 그때 변환을 한 곳에 모은다).

import type { CalendarEntry } from './entries';

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
  /** 그 날 하루짜리 항목(기간은 제외 — 바로 그린다). */
  entries: CalendarEntry[];
  bars: MonthBar[];
  /** 칸에 못 담아 접은 개수. */
  moreN: number;
}

/**
 * 달력 격자. 월마다 표 높이가 달라지지 않게 **항상 6주(42칸)**로 채운다(디자인 원본).
 * `perCell`은 한 칸에 보이는 칩 수 — 넘치면 `moreN`으로 접는다.
 */
export function monthCells(y: number, m: number, entries: readonly CalendarEntry[], todayIso: string, perCell = 2, weeks = 6): MonthCell[] {
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
  const cells: MonthCell[] = [];
  const push = (iso: string, n: number, inMonth: boolean, dow: number): void => {
    const list = inMonth ? (byDay.get(iso) ?? []) : [];
    const bars: MonthBar[] = inMonth
      ? spans
          .filter((e) => coversDay(e, iso))
          .map((e) => ({ entry: e, head: e.start === iso, tail: e.due === iso, label: e.start === iso || dow === 0 }))
      : [];
    cells.push({
      iso,
      n,
      inMonth,
      isToday: inMonth && iso === todayIso,
      dim: inMonth ? iso < todayIso : false,
      dow,
      entries: list.slice(0, perCell),
      bars,
      moreN: Math.max(0, list.length - perCell),
    });
  };
  for (let i = 0; i < firstDow; i++) {
    const p = addMonth(y, m, -1);
    push(isoOf(p.y, p.m, prevDays - firstDow + 1 + i), prevDays - firstDow + 1 + i, false, i);
  }
  for (let d = 1; d <= days; d++) push(isoOf(y, m, d), d, true, (firstDow + d - 1) % 7);
  let next = 1;
  const nx = addMonth(y, m, 1);
  while (cells.length < weeks * 7) {
    push(isoOf(nx.y, nx.m, next), next, false, cells.length % 7);
    next += 1;
  }
  return cells;
}

/** 통계 줄의 한 칩. 개수가 0이면 무채색으로 그린다(그리는 쪽 판단). */
export interface CalendarStat {
  key: 'over' | 'today' | 'week' | 'span';
  label: string;
  unit: string;
  count: number;
}

/** 지난 마감 · 오늘 마감 · 이번 주 · 기간 일정. 기간은 **기한** 기준으로 센다. */
export function calendarStats(entries: readonly CalendarEntry[], todayIso: string): CalendarStat[] {
  const ws = weekStartISO(todayIso);
  const we = weekEndISO(todayIso);
  let over = 0;
  let today = 0;
  let week = 0;
  let span = 0;
  for (const e of entries) {
    if (isSpan(e)) span += 1;
    if (e.due < todayIso) over += 1;
    if (e.due === todayIso) today += 1;
    if (e.due >= ws && e.due <= we) week += 1;
  }
  return [
    { key: 'over', label: '지난 마감', unit: '건', count: over },
    { key: 'today', label: '오늘 마감', unit: '건', count: today },
    { key: 'week', label: '이번 주', unit: '건', count: week },
    { key: 'span', label: '기간 일정', unit: '개', count: span },
  ];
}

/** 통계 칩으로 거른 목록 — 칩을 누르면 그 갈래만 남는다(디자인 원본의 필터). */
export function filterByStat(entries: readonly CalendarEntry[], key: CalendarStat['key'] | null, todayIso: string): CalendarEntry[] {
  if (!key) return [...entries];
  const ws = weekStartISO(todayIso);
  const we = weekEndISO(todayIso);
  return entries.filter((e) => {
    if (key === 'span') return isSpan(e);
    if (key === 'over') return e.due < todayIso;
    if (key === 'today') return e.due === todayIso;
    return e.due >= ws && e.due <= we;
  });
}

/** 다가오는 마감(오늘 포함, 이른 것 먼저). */
export function upcomingEntries(entries: readonly CalendarEntry[], todayIso: string): CalendarEntry[] {
  return entries.filter((e) => e.due >= todayIso);
}

/** 지난 마감(늦은 것 먼저 = 최근에 놓친 것부터). */
export function overdueEntries(entries: readonly CalendarEntry[], todayIso: string): CalendarEntry[] {
  return entries.filter((e) => e.due < todayIso).sort((a, b) => (a.due < b.due ? 1 : a.due > b.due ? -1 : 0));
}

/** 그 날의 모든 항목 — 하루짜리 + 그 날을 덮는 기간. */
export function entriesOn(entries: readonly CalendarEntry[], iso: string): CalendarEntry[] {
  return entries.filter((e) => coversDay(e, iso));
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

/** `8월 26일 (수)` — 팝업·목록의 날짜 표기. */
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
export function dateLabel(iso: string): string {
  const p = partsOf(iso);
  if (!p) return iso;
  return `${p.m}월 ${p.d}일 (${DOW[new Date(p.y, p.m - 1, p.d).getDay()]})`;
}

export { DOW };

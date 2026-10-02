/**
 * 작업 현황의 **계산** — 화면과 떨어진 순수 함수들(작업 현황 스펙 §2.3).
 *
 * 날짜는 전부 `YYYY-MM-DD` 문자열로 비교하고, Date는 요일을 구할 때만 **UTC로** 만든다
 * (스펙 §12 — 날짜만 다루는 화면이라 시간대가 끼면 하루가 밀린다).
 */
import type { JiraEpic, JiraPerson, JiraTicket, TicketStatus } from '../jira/jiraApi';
import type { CompanyHoliday, WorkStatusPrefs } from '../toolPrefs';
import { HOLIDAYS } from './holidays';

// ── 날짜 ─────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');
export const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const parse = (s: string) => {
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
};
export function addDays(s: string, n: number): string {
  const dt = parse(s);
  dt.setUTCDate(dt.getUTCDate() + n);
  return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}
export const dowOf = (s: string) => parse(s).getUTCDay();
export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const monthDays = (y: number, m: number) => Array.from({ length: daysInMonth(y, m) }, (_, i) => ymd(y, m, i + 1));
export const isWeekend = (s: string) => {
  const w = dowOf(s);
  return w === 0 || w === 6;
};
export const DOW = ['일', '월', '화', '수', '목', '금', '토'] as const;
/** `09.21` — 패널·툴팁의 짧은 날짜. */
export const shortDate = (s: string) => s.slice(5).replace('-', '.');

/** 두 날짜 사이의 날 수(끝 포함). */
export function spanDays(from: string, to: string): number {
  return Math.round((parse(to).getTime() - parse(from).getTime()) / 86_400_000) + 1;
}

// ── 휴일 · 영업일 ────────────────────────────────────────────────────

export interface Holiday {
  name: string;
  /** 추가 휴일(사용자가 등록) — 달력이 건물 아이콘을 붙인다. */
  company: boolean;
}

/** 추가 휴일이 그 날에 걸리는가 — 반복은 **등록한 날 이후**부터만(스펙 §2.3). */
export function companyHits(h: CompanyHoliday, d: string): boolean {
  if (h.repeat === 'none') return d === h.d;
  if (d < h.d) return false;
  if (h.repeat === 'yearly') return d.slice(5) === h.d.slice(5);
  if (h.repeat === 'monthly') return d.slice(8) === h.d.slice(8);
  return dowOf(d) === dowOf(h.d);
}

export type HolidayRules = Pick<WorkStatusPrefs, 'country' | 'weekend' | 'exceptions' | 'company'>;

export function holidayOf(d: string, rules: HolidayRules): Holiday | null {
  const c = rules.company.find((h) => companyHits(h, d));
  if (c) return { name: c.name, company: true };
  const name = HOLIDAYS[rules.country]?.[d];
  if (name && !rules.exceptions.includes(d)) return { name, company: false };
  return null;
}

/** 공휴일 목록(모달 §10-3) — 그 달부터 `limit`개. 근무일로 처리한 날도 싣는다(되돌릴 수 있게). */
export function publicHolidaysFrom(from: string, country: WorkStatusPrefs['country'], limit: number): { d: string; name: string }[] {
  return Object.entries(HOLIDAYS[country] ?? {})
    .filter(([d]) => d >= from)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, limit)
    .map(([d, name]) => ({ d, name }));
}

export function isBizDay(d: string, rules: HolidayRules): boolean {
  if (!rules.weekend && isWeekend(d)) return false;
  return !holidayOf(d, rules);
}

export interface MonthBiz {
  days: string[];
  biz: string[];
  /** 영업일에서 뺀 날을 **처음 뺀 이유 하나로만** 센다 — 주말 → 공휴일 → 추가 휴일 순.
   *  토요일에 걸린 추석을 주말과 공휴일에서 두 번 빼면 식이 영업일과 안 맞는다
   *  (프로토타입의 `공휴일 4`가 그 경우였다 — 실제 뺀 평일 공휴일은 3일). */
  weekend: number;
  holiday: number;
  company: number;
}

export function monthBiz(y: number, m: number, rules: HolidayRules): MonthBiz {
  const days = monthDays(y, m);
  const out: MonthBiz = { days, biz: [], weekend: 0, holiday: 0, company: 0 };
  for (const d of days) {
    if (!rules.weekend && isWeekend(d)) {
      out.weekend++;
      continue;
    }
    const h = holidayOf(d, rules);
    if (!h) out.biz.push(d);
    else if (h.company) out.company++;
    else out.holiday++;
  }
  return out;
}

/** 기간의 영업일 — 일정 맞춰보기(최대 120일, 스펙 §2.3). */
export function bizDaysIn(from: string, to: string, rules: HolidayRules, cap = 120): string[] {
  const out: string[] = [];
  for (let d = from, i = 0; d <= to && i < cap; d = addDays(d, 1), i++) if (isBizDay(d, rules)) out.push(d);
  return out;
}

// ── 색 ───────────────────────────────────────────────────────────────

export const EPIC_PALETTE = [
  { c: '#E85E33', bg: '#FBEDE6' },
  { c: '#5B8DEF', bg: '#E9F0FC' },
  { c: '#4E8C67', bg: '#EBF5EE' },
  { c: '#8B5CF6', bg: '#F1ECFA' },
  { c: '#D8A24F', bg: '#FBF3E4' },
  { c: '#3A9BB5', bg: '#E7F3F6' },
] as const;
export const PERSON_PALETTE = ['#E8845C', '#7C9BD8', '#69B08A', '#B58CD9', '#D9A45C', '#5FA8B8'] as const;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * 키마다 색을 정한다 — **키의 해시로 자리를 잡고, 겹치면 다음 빈 색**으로.
 *
 * 순서대로 돌려 배정하면 에픽 하나가 늘거나 빠질 때 뒤의 색이 전부 밀린다(어제의 파랑이
 * 오늘 초록). 해시로 자리를 잡으면 같은 키는 대개 같은 색이고, 팔레트보다 많아지면 그때만 겹친다.
 */
export function assignColors(keys: string[], size: number): Map<string, number> {
  const out = new Map<string, number>();
  const used = new Set<number>();
  for (const k of [...new Set(keys)].sort()) {
    let i = hash(k) % size;
    if (used.size < size) while (used.has(i)) i = (i + 1) % size;
    used.add(i);
    out.set(k, i);
  }
  return out;
}

// ── 데이터 묶음 ─────────────────────────────────────────────────────

export interface Person {
  id: string;
  name: string;
  ini: string;
  c: string;
  /** 검색으로 직접 더한 사람 — 담당자 팝오버에서 뺄 수 있다. */
  extra: boolean;
}

export interface Epic {
  key: string;
  name: string;
  start: string | null;
  end: string | null;
  c: string;
  bg: string;
  /** 묶음이 티켓 자신(에픽이 없는 티켓) — 달력 칩에 키를 붙이고, 타임라인은 머리 줄 없이 한 줄. */
  solo?: boolean;
}

export type Ticket = JiraTicket;

export interface Dataset {
  people: Person[];
  epics: Epic[];
  tickets: Ticket[];
  pById: Map<string, Person>;
  eByKey: Map<string, Epic>;
}

/** 이름 첫 글자 — 성이 앞인 한글 이름이면 성이고, 영문이면 첫 글자 대문자. */
export const initialOf = (name: string) => (name.trim()[0] ?? '?').toUpperCase();

export function buildDataset(epics: JiraEpic[], tickets: JiraTicket[], extra: JiraPerson[]): Dataset {
  const people = new Map<string, JiraPerson>();
  for (const t of tickets) if (!people.has(t.person.id)) people.set(t.person.id, t.person);
  const extraIds = new Set(extra.map((p) => p.id));
  for (const p of extra) if (!people.has(p.id)) people.set(p.id, p);
  const pColor = assignColors([...people.keys()], PERSON_PALETTE.length);
  const eColor = assignColors(epics.map((e) => e.key), EPIC_PALETTE.length);
  // 티켓 수가 많은 사람부터 — 달력 칩·순위의 기본 순서(이름은 동률일 때).
  const count = new Map<string, number>();
  tickets.forEach((t) => count.set(t.person.id, (count.get(t.person.id) ?? 0) + 1));
  const ps: Person[] = [...people.values()]
    .map((p) => ({ id: p.id, name: p.name, ini: initialOf(p.name), c: PERSON_PALETTE[pColor.get(p.id) ?? 0] as string, extra: extraIds.has(p.id) }))
    .sort((a, b) => (count.get(b.id) ?? 0) - (count.get(a.id) ?? 0) || a.name.localeCompare(b.name, 'ko'));
  const es: Epic[] = epics
    .map((e) => {
      const pal = EPIC_PALETTE[eColor.get(e.key) ?? 0]!;
      return { key: e.key, name: e.name, start: e.start, end: e.end, c: pal.c, bg: pal.bg, ...(e.solo ? { solo: true } : {}) };
    })
    .sort((a, b) => (a.start ?? '9999').localeCompare(b.start ?? '9999') || a.key.localeCompare(b.key));
  return { people: ps, epics: es, tickets, pById: new Map(ps.map((p) => [p.id, p])), eByKey: new Map(es.map((e) => [e.key, e])) };
}

// ── 필터 ─────────────────────────────────────────────────────────────

export type FilterType = 'person' | 'epic' | 'ticket';
export interface Filter {
  type: FilterType;
  id: string;
}

/** 같은 종류끼리는 OR, 다른 종류끼리는 AND(스펙 §4.2). */
export function passes(t: Ticket, filters: Filter[]): boolean {
  if (!filters.length) return true;
  const by = (type: FilterType) => filters.filter((f) => f.type === type).map((f) => f.id);
  const P = by('person');
  const E = by('epic');
  const K = by('ticket');
  return (!P.length || P.includes(t.person.id)) && (!E.length || E.includes(t.epic)) && (!K.length || K.includes(t.key));
}

export const activeOn = (t: { start: string; end: string }, d: string) => t.start <= d && d <= t.end;
export const overlaps = (t: { start: string; end: string }, from: string, to: string) => t.start <= to && t.end >= from;

// ── 담당자 휴가(스펙 `작업 현황 · 담당자 휴가` §2) ─────────────────────────

export type LeaveKind = 'full' | 'am' | 'pm';
export const LEAVE_KIND: Record<LeaveKind, string> = { full: '종일', am: '오전 반차', pm: '오후 반차' };

export interface LeaveLike {
  person: string;
  start: string;
  end: string;
  kind: LeaveKind;
}

/** 사람별로 묶은 휴가 — 계산마다 전체를 훑지 않게. */
export type LeaveIndex = Map<string, LeaveLike[]>;

export function indexLeaves(leaves: readonly LeaveLike[]): LeaveIndex {
  const m: LeaveIndex = new Map();
  for (const l of leaves) m.set(l.person, [...(m.get(l.person) ?? []), l]);
  return m;
}

/** 그날 그 사람이 **일하는 몫** — 휴가 없음 1 · 반차 0.5 · 종일 0(같은 날 오전 + 오후 반차도 0). */
export function leaveWeight(lv: LeaveIndex | undefined, person: string, d: string): number {
  const list = lv?.get(person);
  if (!list) return 1;
  let off = 0;
  for (const l of list) {
    if (l.start > d || l.end < d) continue;
    if (l.kind === 'full') return 0;
    off += 0.5;
  }
  return Math.max(0, 1 - off);
}

/** 그 사람의 영업일(반차 0.5) — 진행률·맞춰보기의 분모. 회사 영업일(`biz.length`)과 다르다. */
export const personBizDays = (lv: LeaveIndex | undefined, person: string, biz: readonly string[]) => biz.reduce((a, d) => a + leaveWeight(lv, person, d), 0);

/** 그 영업일들 안의 휴가 일수(반차 0.5) — 주말·공휴일에 걸친 휴가는 세지 않는다. */
export const leaveDaysIn = (lv: LeaveIndex | undefined, person: string, biz: readonly string[]) => biz.length - personBizDays(lv, person, biz);

/** 그날 휴가인 사람들(종류와 함께) — 달력 휴가 줄·패널. */
export function leavesOn<T extends LeaveLike>(leaves: readonly T[], d: string): T[] {
  return leaves.filter((l) => l.start <= d && d <= l.end);
}

// ── 진행 일수 ────────────────────────────────────────────────────────

const WORKED: TicketStatus[] = ['doing', 'done'];

/**
 * 그 사람(과 그 에픽)의 **진행 중·완료 티켓이 걸친 영업일의 합집합**(스펙 §2.3).
 * 같은 날 여러 티켓은 1일이다.
 */
export function workedDays(tickets: Ticket[], biz: string[], personId: string, epicKey?: string, lv?: LeaveIndex): number {
  const s = new Set<string>();
  for (const t of tickets) {
    if (t.person.id !== personId || (epicKey && t.epic !== epicKey) || !WORKED.includes(t.status)) continue;
    // 종일 휴가인 날은 일한 날이 아니다 — 반차는 1일로 센다(하루라도 일했다 · 휴가 스펙 §2.1).
    for (const d of biz) if (activeOn(t, d) && leaveWeight(lv, personId, d) > 0) s.add(d);
  }
  return s.size;
}

export interface StatRow {
  person: Person;
  cells: { epic: Epic; days: number }[];
  total: number;
  pct: number;
  /** 그 사람의 영업일(휴가를 뺀 — 반차 0.5) — `pct`의 분모. */
  biz: number;
  /** 그 달 휴가 일수(반차 0.5). */
  leave: number;
}

export interface Stats {
  rows: StatRow[];
  /** 에픽별 인일(사람 × 일) 합 — 담당자 합계의 총합과 다를 수 있다(같은 날 두 에픽). */
  foot: number[];
  grand: number;
  /** 담당자 합계의 총합 — `grand`와 다르면 화면이 그 사실을 한 줄로 말한다. */
  totalSum: number;
}

export function computeStats(people: Person[], epics: Epic[], tickets: Ticket[], biz: string[], lv?: LeaveIndex): Stats {
  const rows = people.map((person) => {
    const cells = epics.map((epic) => ({ epic, days: workedDays(tickets, biz, person.id, epic.key, lv) }));
    const total = workedDays(tickets, biz, person.id, undefined, lv);
    const own = personBizDays(lv, person.id, biz);
    return { person, cells, total, pct: own ? Math.round((total / own) * 100) : 0, biz: own, leave: biz.length - own };
  });
  const foot = epics.map((_, i) => rows.reduce((a, r) => a + (r.cells[i]?.days ?? 0), 0));
  return { rows, foot, grand: foot.reduce((a, b) => a + b, 0), totalSum: rows.reduce((a, r) => a + r.total, 0) };
}

/** 집계 칸의 히트맵 단계(스펙 §9) — 0 / 1–3 / 4–8 / 9–13 / 14+. */
export function heatLevel(v: number): 0 | 1 | 2 | 3 | 4 {
  if (v <= 0) return 0;
  if (v < 4) return 1;
  if (v < 9) return 2;
  if (v < 14) return 3;
  return 4;
}

// ── 달력 칸 ──────────────────────────────────────────────────────────

export interface DayChip {
  epic: Epic;
  tickets: Ticket[];
  people: Person[];
}

/** 그 날 걸친 티켓을 **에픽별로** 묶는다 — 티켓 수가 많은 에픽부터(스펙 §5.2). */
export function dayChips(tickets: Ticket[], d: string, data: Dataset): DayChip[] {
  const groups = new Map<string, Ticket[]>();
  for (const t of tickets) if (activeOn(t, d)) groups.set(t.epic, [...(groups.get(t.epic) ?? []), t]);
  const out: DayChip[] = [];
  for (const [key, ts] of groups) {
    const epic = data.eByKey.get(key);
    if (!epic) continue;
    const people = [...new Set(ts.map((t) => t.person.id))].map((id) => data.pById.get(id)).filter((p): p is Person => !!p);
    out.push({ epic, tickets: ts, people });
  }
  return out.sort((a, b) => b.tickets.length - a.tickets.length || a.epic.key.localeCompare(b.epic.key));
}

/** 칩이 셋을 넘으면 둘만 보이고 나머지는 `+N개 프로젝트`(스펙 §5.2). */
export function visibleChips<T>(chips: T[]): { shown: T[]; more: number } {
  return chips.length > 3 ? { shown: chips.slice(0, 2), more: chips.length - 2 } : { shown: chips, more: 0 };
}

/** 달력 격자의 첫 칸(그 달 1일이 든 주의 일요일)부터 42칸. */
export function gridDays(y: number, m: number): string[] {
  const first = ymd(y, m, 1);
  const start = addDays(first, -dowOf(first));
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

// ── 타임라인 레인 ────────────────────────────────────────────────────

export interface Bar<T> {
  item: T;
  /** 그 달 안의 0부터 센 시작·끝 칸(달 경계 밖은 잘린다). */
  s: number;
  e: number;
  lane: number;
}

/** 겹치는 막대를 레인으로 나눈다 — 시작이 이른 것부터, 들어갈 수 있는 가장 위 레인에. */
export function layLanes<T extends { start: string; end: string }>(items: T[], days: string[]): { bars: Bar<T>[]; lanes: number } {
  const first = days[0] ?? '';
  const last = days[days.length - 1] ?? '';
  const n = days.length;
  const lanes: number[] = [];
  const bars: Bar<T>[] = [];
  const idx = (d: string) => spanDays(first, d) - 1;
  for (const item of [...items].filter((t) => overlaps(t, first, last)).sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end))) {
    const s = item.start < first ? 0 : idx(item.start);
    const e = item.end > last ? n - 1 : idx(item.end);
    let lane = lanes.findIndex((end) => end < s);
    if (lane < 0) {
      lane = lanes.length;
      lanes.push(e);
    } else lanes[lane] = e;
    bars.push({ item, s, e, lane });
  }
  return { bars, lanes: lanes.length };
}

// ── 일정 맞춰보기 ────────────────────────────────────────────────────

export type AvailLevel = 0 | 1 | 2 | 3;
export const AVAIL_LABEL = ['전부 가능', '일부 겹침', '거의 불가', '불가'] as const;

export interface AvailRow {
  person: Person;
  /** 그 사람이 일할 수 있는 날(기간 영업일 − 휴가일 — 반차일은 일할 수 있는 날로 남는다). */
  total: number;
  /** 기간 안 휴가 일수(반차 0.5). */
  leave: number;
  busy: number;
  free: number;
  ratio: number;
  level: AvailLevel;
  conflicts: Ticket[];
}

/**
 * 기간 안 영업일 중 그 사람의 **예정·진행 중** 티켓이 걸친 날 = 바쁨(스펙 §2.3).
 * 레벨: 0 전부 가능(바쁨 0) / 1 일부 겹침(여유 ≥ 50%) / 2 거의 불가(여유 > 0) / 3 불가.
 * 정렬: 레벨 오름차순 → 여유 내림차순.
 */
export function availability(people: Person[], tickets: Ticket[], biz: string[], lv?: LeaveIndex): AvailRow[] {
  const from = biz[0];
  const to = biz[biz.length - 1];
  return people
    .map((person) => {
      // 분모는 그 사람이 쉬지 않는 날만(휴가 스펙 §2.1) — 바쁨도 그 안에서만 센다. 분모 0이면 불가.
      const days = biz.filter((d) => leaveWeight(lv, person.id, d) > 0);
      const mine = from && to ? tickets.filter((t) => t.person.id === person.id && t.status !== 'done' && overlaps(t, from, to)) : [];
      const busySet = new Set<string>();
      for (const t of mine) for (const d of days) if (activeOn(t, d)) busySet.add(d);
      const busy = busySet.size;
      const free = days.length - busy;
      const ratio = days.length ? free / days.length : 0;
      const level: AvailLevel = !days.length ? 3 : busy === 0 ? 0 : ratio >= 0.5 ? 1 : ratio > 0 ? 2 : 3;
      return { person, total: days.length, leave: leaveDaysIn(lv, person.id, biz), busy, free, ratio, level, conflicts: mine.sort((a, b) => a.start.localeCompare(b.start)) };
    })
    .sort((a, b) => a.level - b.level || b.free - a.free || a.person.name.localeCompare(b.person.name, 'ko'));
}

// ── 검색 제안 ────────────────────────────────────────────────────────

export interface Suggestions {
  people: Person[];
  epics: Epic[];
  tickets: Ticket[];
}

export function suggest(q: string, data: Dataset, people: Person[]): Suggestions {
  const s = q.trim().toLowerCase();
  if (!s) return { people: [], epics: [], tickets: [] };
  return {
    people: people.filter((p) => p.name.toLowerCase().includes(s)),
    epics: data.epics.filter((e) => e.name.toLowerCase().includes(s) || e.key.toLowerCase().includes(s)),
    tickets: data.tickets.filter((t) => t.key.toLowerCase().includes(s) || t.summary.toLowerCase().includes(s)).slice(0, 6),
  };
}

// ── 에픽 없는 티켓 · 배포 예정일 ──────────────────────────────────────

/** 집계 표의 "에픽 없는 티켓" 열 — 티켓 하나하나가 열이 되면 표가 티켓 수만큼 넓어진다. */
export const SOLO_KEY = '__solo';

/**
 * 집계용으로 묶음을 접는다: 에픽은 그대로, 티켓 자신인 묶음(solo)은 **한 열**로.
 * 달력·타임라인은 티켓 하나씩 보이지만, 사람 × 묶음 진행 일수는 이렇게 봐야 읽힌다.
 */
export function foldSolo(epics: Epic[], tickets: Ticket[]): { epics: Epic[]; tickets: Ticket[] } {
  const solo = new Set(epics.filter((e) => e.solo).map((e) => e.key));
  if (!solo.size) return { epics, tickets };
  const rest = epics.filter((e) => !e.solo);
  const col: Epic = { key: SOLO_KEY, name: '에픽 없는 티켓', start: null, end: null, c: '#9C9186', bg: '#F1ECE6' };
  return { epics: [...rest, col], tickets: tickets.map((t) => (solo.has(t.epic) ? { ...t, epic: SOLO_KEY } : t)) };
}

/** 그날이 배포 예정일인 티켓 — 달력 칸·패널이 쓴다. */
export const releasesOn = (tickets: Ticket[], d: string) => tickets.filter((t) => t.release === d);

// ── 달력 줄(lane) — 이어지는 같은 묶음은 그 주 내내 같은 줄 ─────────────────

/**
 * 한 칸이 담는 줄 수 — `rows`까지는 다 보이고, 넘치면 `withMore`줄 + `+N개`. 화면은 칸 높이를
 * **재서** 정한다(`calCapacity` — 제보 2026-10-01: 칸에 자리가 남는데도 셋째부터 접혔다). 재기 전 기본은 스펙 §5.2의 셋/둘.
 */
export interface CalCapacity {
  rows: number;
  withMore: number;
}
export const CAL_LANES: CalCapacity = { rows: 3, withMore: 2 };

/** 칸 치수(WsCalendar와 같은 값) — 위아래 여백 10 · 날짜 줄 19 · 줄마다 간격 3 + 칩 18 · `+N개` 줄 13. */
const CELL_PAD = 10;
const CELL_HEAD = 19;
const LANE = 21;
const MORE = 16;

/** 잰 칸 높이 → 담을 수 있는 줄 수. 너무 낮아도 한 줄은 둔다(접힌 개수라도 보이게). */
export function calCapacity(cellH: number): CalCapacity {
  const room = cellH - CELL_PAD - CELL_HEAD;
  return { rows: Math.max(1, Math.floor(room / LANE)), withMore: Math.max(1, Math.floor((room - MORE) / LANE)) };
}

export interface WeekPiece {
  chip: DayChip;
  /** 이 칸이 그 묶음 띠의 시작(왼쪽 모서리 둥글게 · 이름을 쓴다) — 전날에 없거나 주의 첫 칸. */
  head: boolean;
  /** 띠의 끝(오른쪽 모서리 둥글게) — 다음 날에 없거나 주의 끝 칸. */
  tail: boolean;
}

export interface WeekPlan {
  /** 칸마다 줄 순서대로 — 그 줄이 비면 null(자리를 비워 아래 줄이 올라오지 않게). */
  rows: (WeekPiece | null)[][];
  /** 칸마다 줄에 못 담은 묶음 수. */
  more: number[];
}

/**
 * 한 주(7칸)의 묶음 칩에 **줄을 배정한다** — 일정 페이지의 `weekLanes`와 같은 규칙(제보 2026-10-01:
 * "연속된 같은 일정이 날짜 칸마다 위아래 제각각"). 일찍 나타난 묶음이 위, 같이 나타나면 오래 걸친 것이 위,
 * 그래도 같으면 키. 각 묶음은 그 주에서 자기 칸들이 비어 있는 **가장 위 줄**을 차지한다.
 * 줄이 칸에 담기는 수(`cap.rows`)를 넘는 주는 **그 주 전체가** `cap.withMore`줄만 보이고 나머지는 칸마다 `+N개`(띠가 중간에서 끊기지 않게).
 * `inMonth`가 거짓인 칸은 비운다(다른 달 칸에는 칩을 그리지 않는다).
 */
export function planWeek(tickets: Ticket[], week: string[], inMonth: boolean[], data: Dataset, cap: CalCapacity = CAL_LANES): WeekPlan {
  const perDay = week.map((d, i) => (inMonth[i] ? dayChips(tickets, d, data) : []));
  const cols = new Map<string, number[]>();
  perDay.forEach((chips, i) => chips.forEach((c) => cols.set(c.epic.key, [...(cols.get(c.epic.key) ?? []), i])));
  const order = [...cols.keys()].sort((a, b) => {
    const ca = cols.get(a)!;
    const cb = cols.get(b)!;
    return ca[0]! - cb[0]! || cb.length - ca.length || a.localeCompare(b);
  });
  const taken: Set<number>[] = [];
  const lane = new Map<string, number>();
  for (const k of order) {
    const cs = cols.get(k)!;
    let l = 0;
    while (taken[l] && cs.some((c) => taken[l]!.has(c))) l += 1;
    const set = taken[l] ?? new Set<number>();
    cs.forEach((c) => set.add(c));
    taken[l] = set;
    lane.set(k, l);
  }
  const lanes = taken.length;
  const shown = lanes > cap.rows ? Math.min(cap.withMore, lanes) : lanes;
  const rows = perDay.map((chips, i) => {
    const row: (WeekPiece | null)[] = Array.from({ length: shown }, () => null);
    for (const chip of chips) {
      const l = lane.get(chip.epic.key)!;
      if (l >= shown) continue;
      const cs = cols.get(chip.epic.key)!;
      row[l] = { chip, head: i === 0 || !cs.includes(i - 1), tail: i === week.length - 1 || !cs.includes(i + 1) };
    }
    // 아래쪽 빈 줄은 잘라 둔다(그 칸 안에서만 — 위쪽의 빈 줄은 띠를 맞추려고 남긴다).
    while (row.length && row[row.length - 1] === null) row.pop();
    return row;
  });
  const more = perDay.map((chips) => chips.filter((c) => lane.get(c.epic.key)! >= shown).length);
  return { rows, more };
}

// 칸반 카드의 곁정보(분류·기한·담당)와 보드 진행률 — 순수 규칙만.
//
// 디자인 원본(`Geurio 칸반보드.dc.html`)은 분류 5종과 담당 4명을 **고정 표**로 들고
// 각자의 색을 함께 적어 뒀다. 실제 앱에서는 둘 다 사용자 데이터라 표로 둘 수 없어
// 규칙으로 바꿨다:
//  · 분류 색은 **이름에서 정한다**(테마 팔레트 인덱스로 결정적 매핑) — 색을 문서에
//    저장하면 테마를 바꿨을 때 옛 색이 남고, 같은 이름이 문서마다 달라진다.
//  · 담당은 **공유 참가자**(0011)에서 고르고 이름은 스냅샷으로 카드에 남긴다.

import type { KanbanCard, KanbanColumn, KanbanTag } from '@mindflow/mindmap-core';
import { mixHex } from './theme';

/** 문자열 → 안정적인 작은 정수(같은 이름은 언제나 같은 색). */
function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * 이 분류의 색 — **문서의 분류 목록에 지정된 색이 있으면 그것**, 없으면 이름에서
 * 정한다(테마 팔레트 인덱스 → 테마를 바꾸면 함께 바뀐다).
 *
 * 이름 기반 기본색 덕분에 분류를 만들자마자 색이 붙고, 색을 고르면 그때부터
 * 문서에 남는다(`KanbanTag.color`).
 */
export function tagColor(name: string, palette: readonly string[], tags: readonly KanbanTag[] = []): string {
  const pick = tags.find((t) => t.name === name);
  if (pick?.color) return pick.color;
  if (!palette.length) return '#888888';
  return palette[hashCode(name) % palette.length] as string;
}

/**
 * 분류 배지의 **글자색** — 그 분류 색을 글자색 쪽으로 눌러 짙게 만든다.
 *
 * 디자인 원본은 분류 5종의 색쌍을 손으로 골랐고(예: 개발 `#EAF3F6` 배경에 `#3F6C7C`
 * 글자) 글자 쪽은 언제나 **채도를 죽인 짙은 색**이다. 우리 분류는 사용자가 만드는
 * 것이라 표를 둘 수 없어 이름에서 팔레트색을 뽑는데(`tagColor`), 그 원색을 10.5px
 * 700 글자에 그대로 쓰면 배지가 튄다(제보). 같은 색조를 유지한 채 명도만 낮춰
 * 원본 톤에 맞춘다 — 실측 `#3f8fd0` → `#3a6180`(원본 개발 `#3F6C7C`와 근접).
 * 배경은 그대로 옅은 틴트라 색 구분은 그대로 읽힌다.
 */
export function tagInk(color: string, textColor: string): string {
  return mixHex(color, textColor, 0.45);
}

/** 열 머리의 점 색 — 지정이 없으면 열 순서대로 팔레트에서(디자인의 단계별 색). */
export function columnColor(col: KanbanColumn, index: number, palette: readonly string[]): string {
  if (col.color) return col.color;
  if (!palette.length) return '#888888';
  return palette[index % palette.length] as string;
}

/** `YYYY-MM-DD` → 그 날짜(로컬 정오 기준 — 시간대 때문에 하루가 밀리지 않게). */
export function parseDue(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 두 날짜의 **일수** 차이(시각은 무시). */
export function dayDiff(iso: string, today: Date): number | null {
  const d = parseDue(iso);
  if (!d) return null;
  const a = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12, 0, 0, 0);
  return Math.round((d.getTime() - a.getTime()) / 86400000);
}

/**
 * 기한 표시 문구 — 가까운 날은 말로, 먼 날은 날짜로(디자인 원본의 "오늘"·"8월 18일").
 * 해가 다르면 연도까지 밝힌다(내년 3월과 작년 3월이 같아 보이지 않게).
 */
export function dueLabel(iso: string, today: Date = new Date()): string {
  const d = parseDue(iso);
  if (!d) return iso;
  const diff = dayDiff(iso, today) as number;
  if (diff === 0) return '오늘';
  if (diff === 1) return '내일';
  if (diff === -1) return '어제';
  const md = `${d.getMonth() + 1}월 ${d.getDate()}일`;
  return d.getFullYear() === today.getFullYear() ? md : `${d.getFullYear()}년 ${md}`;
}

/** 기한의 급함 — 지남(over) / 오늘·내일(soon) / 그 밖(normal). */
export function dueTone(iso: string, today: Date = new Date()): 'over' | 'soon' | 'normal' {
  const diff = dayDiff(iso, today);
  if (diff === null) return 'normal';
  if (diff < 0) return 'over';
  return diff <= 1 ? 'soon' : 'normal';
}

/** 아바타·이름표에 쓰는 한 글자(이메일이면 로컬파트의 첫 글자). */
export function initialOf(nameOrEmail: string): string {
  const s = (nameOrEmail || '').trim();
  if (!s) return '?';
  const base = s.includes('@') ? s.split('@')[0] || s : s;
  return [...base][0]?.toUpperCase() ?? '?';
}

/** 담당자 표시 이름 — 이름 스냅샷이 없으면 이메일 로컬파트. */
export function ownerLabel(card: KanbanCard): string {
  if (card.ownerName && card.ownerName.trim()) return card.ownerName.trim();
  const email = (card.owner ?? '').trim();
  if (!email) return '';
  return email.includes('@') ? (email.split('@')[0] as string) : email;
}

export interface BoardProgress {
  total: number;
  done: number;
  doing: number;
  donePct: number;
  doingPct: number;
  label: string;
  /**
   * 채워진 구간 — **왼쪽부터** 완료·진행 순으로(제보).
   *
   * 색은 그 열의 색이고(요청), 첫 열(아직 시작하지 않은 일)은 **빈 트랙**으로 남는다
   * — 디자인 원본의 `[완료][진행][빈 자리]`와 같은 뜻이다. 전 열을 board 순서대로
   * 칠하면 바가 늘 100% 차 있고 완료 색이 **오른쪽 끝**에 놓여, 일이 끝날수록 색이
   * 오른쪽부터 차오르는 것처럼 읽힌다(제보의 증상).
   */
  segments: { id: string; title: string; count: number; pct: number; color: string }[];
}

/**
 * 진행률 — **마지막 열을 완료로 본다**(카드는 왼쪽에서 오른쪽으로 흐른다는 칸반의
 * 관례). 디자인 원본은 `done`·`doing`이라는 **고정 열 id**를 봤지만 우리 열은
 * 사용자가 만드는 것이라 이름을 약속할 수 없다. 가운데 열들(첫 열도 마지막 열도
 * 아닌)이 "진행 중"이다. 열이 둘 이하면 진행 구간이 없다.
 */
export function boardProgress(columns: readonly KanbanColumn[], cards: readonly KanbanCard[], palette: readonly string[] = []): BoardProgress {
  const ids = columns.map((c) => c.id);
  const inCol = (id: string): number => cards.filter((c) => c.col === id).length;
  const total = cards.filter((c) => ids.includes(c.col)).length;
  const done = ids.length ? inCol(ids[ids.length - 1] as string) : 0;
  const doing = ids.slice(1, -1).reduce((n, id) => n + inCol(id), 0);
  const pct = (n: number): number => (total ? Math.round((n / total) * 100) : 0);
  // 바는 **완료(마지막 열)부터 왼쪽에서 오른쪽으로** 그린다 — 일이 끝날수록 색이
  // 왼쪽부터 차오른다. 색은 그 열의 색이라(요청) 어느 단계에 몰려 있는지도 보인다.
  // 첫 열은 그리지 않는다: 아직 시작하지 않은 일이라 진행이 아니고, 그 자리가
  // 남은 만큼의 빈 트랙이 된다(디자인 원본과 같은 구성).
  const segments = columns
    .map((c, i) => ({ id: c.id, title: c.title, count: inCol(c.id), pct: pct(inCol(c.id)), color: columnColor(c, i, palette) }))
    .slice(1)
    .reverse()
    .filter((seg) => seg.count > 0);
  return { total, done, doing, donePct: pct(done), doingPct: pct(doing), label: `완료 ${done}/${total} · 진행 ${doing}`, segments };
}

/** 검색어가 이 카드에 걸리는가 — 본문과 분류를 본다(대소문자 무시). */
export function cardMatches(card: KanbanCard, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (card.text || '').toLowerCase().includes(q) || (card.tag || '').toLowerCase().includes(q) || (card.ownerName || '').toLowerCase().includes(q);
}

/**
 * 필터 — 담당·분류·긴급으로 카드를 좁힌다(요청, 디자인 원본의 `필터` 패널).
 *
 * 검색어와 마찬가지로 **화면에서만** 거른다(문서는 그대로). 그리고 보는 사람의
 * 상태라 문서에도 협업에도 싣지 않는다 — 한 사람이 필터를 걸면 모두의 화면이
 * 바뀌는 편이 훨씬 이상하다(보기 모드와 같은 판단).
 */
export interface CardFilter {
  /** 담당자 키(이메일이 있으면 이메일, 없으면 표시 이름) — 비어 있으면 전부. */
  owners: string[];
  /** 분류 이름 — 비어 있으면 전부. */
  tags: string[];
  /** 긴급 표시된 카드만. */
  urgentOnly: boolean;
}

export const EMPTY_FILTER: CardFilter = { owners: [], tags: [], urgentOnly: false };

/** 이 카드의 담당자 키 — 목록과 판정이 **같은 규칙**을 쓰도록 한 곳에. */
export function ownerKey(card: KanbanCard): string {
  return (card.owner ?? '').trim() || ownerLabel(card);
}

/** 무언가 걸려 있는가(버튼에 표시를 띄울지 정한다). */
export function filterActive(f: CardFilter): boolean {
  return f.owners.length > 0 || f.tags.length > 0 || f.urgentOnly;
}

/** 담당 후보 — **지금 이 보드의 카드에 실제로 있는 사람**만(고르면 결과가 있다). */
export function ownerOptions(cards: readonly KanbanCard[]): { key: string; name: string }[] {
  const out: { key: string; name: string }[] = [];
  for (const c of cards) {
    const key = ownerKey(c);
    if (!key || out.some((o) => o.key === key)) continue;
    out.push({ key, name: ownerLabel(c) || key });
  }
  return out;
}

/** 검색어와 필터를 함께 통과하는가 — 세 보기(보드·리스트·타임라인)가 같이 쓴다. */
export function cardPasses(card: KanbanCard, query: string, f: CardFilter = EMPTY_FILTER): boolean {
  if (!cardMatches(card, query)) return false;
  if (f.urgentOnly && !card.flagged) return false;
  if (f.owners.length && !f.owners.includes(ownerKey(card))) return false;
  if (f.tags.length && !f.tags.includes((card.tag ?? '').trim())) return false;
  return true;
}

/** 보기 모드 — 디자인 원본의 탭(보드·리스트·타임라인). 문서가 아니라 **보는 사람**의
 * 상태다: 문서에 넣으면 한 사람이 탭을 바꿀 때 모두의 화면이 함께 바뀐다. */
export type KanbanView = 'board' | 'list' | 'timeline';

/** 타임라인이 보여 주는 날 수와 오늘의 자리(디자인 원본은 14일·오늘이 넷째 칸). */
export const TIMELINE_DAYS = 14;
const TIMELINE_BEFORE = 3;

export interface TimelineDay {
  /** `YYYY-MM-DD` */
  iso: string;
  /** 칸 머리 글자 — 오늘은 '오늘', 달이 바뀌는 날은 'M/D', 그 밖은 일(day). */
  label: string;
  today: boolean;
}

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 오늘을 앞에서 넷째 칸에 두는 14일 — 지난 며칠도 보여야 "늦은 일"이 보인다. */
export function timelineRange(today: Date = new Date()): TimelineDay[] {
  const out: TimelineDay[] = [];
  for (let i = 0; i < TIMELINE_DAYS; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - TIMELINE_BEFORE + i, 12, 0, 0, 0);
    const first = i === 0 || d.getDate() === 1;
    out.push({ iso: isoOf(d), label: i === TIMELINE_BEFORE ? '오늘' : first ? `${d.getMonth() + 1}/${d.getDate()}` : String(d.getDate()), today: i === TIMELINE_BEFORE });
  }
  return out;
}

/**
 * 기한 막대가 차지하는 칸 범위.
 *
 * **시작일이 있으면 시작일부터 기한까지**, 없으면 **오늘부터 기한까지**(지났으면
 * 기한부터 오늘까지). 시작일은 나중에 더한 필드라(요청) 적지 않은 카드가 대부분인데,
 * 그때도 "지금부터 그날까지 남은 기간"이 뜻이 통하고 늦은 일은 오늘까지 뻗어
 * 눈에 띈다. 창(14일) 밖은 가장자리로 자른다.
 */
export function timelineSpan(card: { due?: string; start?: string } | string, days: TimelineDay[], today: Date = new Date()): { start: number; end: number; late: boolean } | null {
  if (!days.length) return null;
  const due = typeof card === 'string' ? card : (card.due ?? '');
  const startIso = typeof card === 'string' ? '' : (card.start ?? '');
  const dueDay = dayDiff(due, today);
  if (dueDay === null) return null;
  const first = dayDiff(days[0]!.iso, today) as number;
  const last = dayDiff(days[days.length - 1]!.iso, today) as number;
  const late = dueDay < 0;
  // 기준점 — 시작일이 있으면 그 날, 없으면 오늘(0).
  const anchor = startIso ? (dayDiff(startIso, today) ?? 0) : 0;
  const lo = Math.min(anchor, dueDay);
  const hi = Math.max(anchor, dueDay);
  // 창 밖으로 완전히 벗어난 기한도 **가장자리에 붙여** 보여 준다(원본의 clamp).
  const start = Math.max(first, Math.min(lo, last));
  const end = Math.max(first, Math.min(hi, last));
  return { start: start - first, end: end - first, late };
}

// 일정 화면이 읽는 "맵 본문의 날짜".
//
// 검색(`searchIndex`)과 같은 방식이다 — 원문 JSON을 통째로 훑지 않고 **필요한 필드만
// 골라 모으고**, 본문은 `previewDocs`(썸네일이 이미 받아 둔 그 문자열)를 그대로 쓴다.
// 그래서 일정 화면을 여는 것만으로 새로 내려받는 것이 없다.
//
// 지금 모으는 것은 **칸반 카드의 기한·시작일**뿐이다(마인드맵·화이트보드에는 날짜
// 개념이 없다). 칸반 마감은 **종일**로 다룬다 — 코어 `KanbanCard`에 시각 필드가 없고,
// 시각이 필요한 일정은 Geurio 일정(별도 표)이 맡는다.
//
// **완료 열의 카드는 빼낸다**: 끝난 일이 달력을 채우면 남은 일이 눈에 안 들어온다
// (디자인 원본도 같은 규칙 — `if (col2 === 3) return`). "완료"의 정의는 이 앱이 이미
// 쓰는 것 그대로 = **마지막 열**(`boardProgress`·`dueTone`이 쓰는 규칙).

import type { KanbanCard, KanbanColumn, KanbanTag } from '@mindflow/mindmap-core';
import type { CalendarEvent } from '../../../adapters/ports';
import type { GoogleEvent } from './googleCalendar';

/** 일정 화면·위젯이 그리는 한 항목. 색은 그리는 쪽이 테마로 정하므로 여기엔 이름만 담는다. */
export interface CalendarEntry {
  /** 그 카드가 사는 문서. */
  docId: string;
  /** 카드 id — 상세 팝업·쓰기(PR2)의 대상. */
  cardId: string;
  title: string;
  /** 기한(`YYYY-MM-DD`) — 이 항목이 달력에서 놓이는 날. */
  due: string;
  /** 시작일이 있으면 due까지 기간 바로 그린다. */
  start?: string;
  /** 열 이름·순서 — 상태 점과 "진행 중" 같은 표기에 쓴다. */
  colId: string;
  colName: string;
  colIndex: number;
  /** 열에 지정된 색(없으면 순서대로 팔레트 — `columnColor`와 같은 규칙). */
  colColor?: string;
  /** 분류 이름(없으면 빈 문자열). */
  tag: string;
  /** 그 분류에 문서가 지정해 둔 색(없으면 이름에서 — `tagColor`와 같은 규칙). */
  tagColor?: string;
  /** 담당자 이름 스냅샷(카드에 적힌 값). */
  owner?: string;
  ownerEmail?: string;
  urgent?: boolean;
  /** 카드가 든 보드의 이름·스페이스 — "스프린트 보드 · 진행 중" 표기용. */
  boardName: string;
  spaceName: string;
  /** 보기 전용으로 공유받은 보드인가 — 참이면 고칠 수 없다(진짜 게이트는 서버 RLS). */
  readOnly?: boolean;

  // ── Geurio 일정(0033)일 때만 ──
  /**
   * 이 항목이 **캘린더 전용 일정**인가(칸반 카드가 아니라). 참이면 `cardId`는 그
   * 일정의 id이고 `docId`는 빈 문자열이다 — 가리킬 문서가 없다.
   */
  event?: CalendarEvent;
  /** 시각 있는 일정의 `HH:MM`(종일이면 없다) — 시간표가 이 값으로 놓는다. */
  startTime?: string;
  endTime?: string;

  // ── 구글 캘린더(PR5)일 때만 ──
  /**
   * 구글에서 받아 온 일정인가. 참이면 **읽기 전용**이다 — 우리 것이 아니라 겹쳐
   * 보여 주는 것뿐이라 고치거나 옮길 수 없다(구글이 정본).
   */
  google?: GoogleEvent;
}

interface Parsed {
  /** 파싱의 출처. 문자열 참조가 그대로면 다시 파싱하지 않는다. */
  raw: string;
  cards: DatedCard[];
}

interface DatedCard {
  cardId: string;
  title: string;
  due: string;
  start?: string;
  colId: string;
  colName: string;
  colIndex: number;
  colColor?: string;
  tag: string;
  tagColor?: string;
  owner?: string;
  ownerEmail?: string;
  urgent?: boolean;
}

const cache = new Map<string, Parsed>();
const CACHE_MAX = 400;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function isKanbanBody(d: unknown): d is { columns?: unknown; cards?: unknown; kind?: string } {
  return !!d && typeof d === 'object' && (d as { kind?: unknown }).kind === 'kanban';
}

/** 이 문서에서 날짜가 있는 카드만. 완료(마지막) 열은 빼낸다. */
function collectDated(raw: string): DatedCard[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return []; // 손상된 본문은 없는 것으로 — 일정 화면이 멈추면 안 된다
  }
  if (!isKanbanBody(parsed)) return [];
  const columns = (Array.isArray(parsed.columns) ? parsed.columns : []) as KanbanColumn[];
  const cards = (Array.isArray(parsed.cards) ? parsed.cards : []) as KanbanCard[];
  const tags = (Array.isArray((parsed as { tags?: unknown }).tags) ? (parsed as { tags?: KanbanTag[] }).tags : []) ?? [];
  if (!columns.length) return [];
  const doneId = columns[columns.length - 1]?.id;
  const out: DatedCard[] = [];
  for (const c of cards) {
    if (!c || typeof c !== 'object' || typeof c.id !== 'string') continue;
    if (typeof c.due !== 'string' || !ISO.test(c.due)) continue;
    if (c.col === doneId) continue; // 완료 열은 달력에 없다
    const idx = columns.findIndex((col) => col.id === c.col);
    if (idx < 0) continue; // 소속 열이 사라진 카드(유령) — 코어 파서도 버린다
    const col = columns[idx]!;
    out.push({
      cardId: c.id,
      title: typeof c.text === 'string' ? c.text : '',
      due: c.due,
      ...(typeof c.start === 'string' && ISO.test(c.start) && c.start < c.due ? { start: c.start } : {}),
      colId: col.id,
      colName: typeof col.title === 'string' ? col.title : '',
      colIndex: idx,
      ...(col.color ? { colColor: col.color } : {}),
      tag: typeof c.tag === 'string' ? c.tag : '',
      // 분류의 **지정색**만 싣는다 — 지정이 없으면 그리는 쪽이 이름에서 뽑는다
      // (`tagColor`와 같은 규칙: 색을 저장하면 테마를 바꿔도 옛 색이 남는다).
      ...(() => {
        const picked = c.tag ? tags.find((t) => t.name === c.tag)?.color : null;
        return picked ? { tagColor: picked } : {};
      })(),
      ...(c.ownerName ? { owner: c.ownerName } : {}),
      ...(c.owner ? { ownerEmail: c.owner } : {}),
      ...(c.flagged ? { urgent: true } : {}),
    });
  }
  return out;
}

/** 한 문서의 날짜 있는 카드. `docId`로 캐시하되 원문이 바뀌면 다시 읽는다(저장 반영). */
export function datedCards(docId: string, raw: string | undefined): DatedCard[] {
  if (!raw) return [];
  const hit = cache.get(docId);
  if (hit && hit.raw === raw) return hit.cards;
  const cards = collectDated(raw);
  cache.set(docId, { raw, cards });
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return cards;
}

/** 어느 문서를 훑을지 — 스페이스 목록에서 (docId, 보드 이름, 스페이스 이름)을 뽑는다. */
export interface CalendarSource {
  docId: string;
  boardName: string;
  spaceName: string;
  /** 보기 전용으로 공유받은 보드(`sharedMaps`의 role='view') — 항목에 그대로 실린다. */
  readOnly?: boolean;
}

/**
 * Geurio 일정(0033) → 달력 항목. 칸반 카드와 **같은 모양**으로 만들어 월 격자·통계·
 * 사이드 목록이 종류를 가리지 않고 그린다(그 셋은 `CalendarEntry`만 안다).
 *
 * `due`는 마지막 날이고 `start`는 여러 날 일정일 때만 채운다 — 칸반 카드의 기간 규칙과
 * 같아서 기간 바·드래그 계산이 그대로 성립한다.
 */
export function eventEntries(events: readonly CalendarEvent[]): CalendarEntry[] {
  return events.map((e) => ({
    docId: '',
    cardId: e.id,
    title: e.title || '(제목 없음)',
    due: e.endDate,
    ...(e.endDate > e.startDate ? { start: e.startDate } : {}),
    colId: '',
    colName: 'Geurio 캘린더',
    colIndex: 0,
    ...(e.color ? { colColor: e.color } : {}),
    tag: '',
    boardName: 'Geurio 캘린더',
    spaceName: '내 일정',
    event: e,
    ...(e.allDay ? {} : { ...(e.startTime ? { startTime: e.startTime } : {}), ...(e.endTime ? { endTime: e.endTime } : {}) }),
  }));
}

/**
 * 구글 일정 → 화면 항목. **공휴일 캘린더는 빼낸다** — 그건 칩이 아니라 날짜 색으로
 * 그린다(`holidayMap`). 공휴일까지 칩으로 늘어놓으면 달력이 빨간 알약으로 덮인다.
 */
export function googleEntries(events: readonly GoogleEvent[]): CalendarEntry[] {
  return events
    .filter((e) => !e.holiday)
    .map((e) => ({
      docId: '',
      cardId: e.id,
      title: e.title,
      due: e.endDate,
      ...(e.endDate > e.startDate ? { start: e.startDate } : {}),
      colId: '',
      colName: e.calendarName,
      colIndex: 0,
      ...(e.color ? { colColor: e.color } : {}),
      tag: '',
      boardName: e.calendarName,
      spaceName: 'Google 캘린더',
      // 쓸 수 있는 캘린더의 일정은 **끌어서 날짜를 옮길 수 있다**(PR6). 공휴일과
      // 보기 전용으로 공유된 캘린더는 그대로 읽기 전용이다 — 진짜 게이트는 구글의
      // 권한이고, 이 값은 "고쳐지는 척하는" 화면을 막는 어포던스다.
      ...(e.writable ? {} : { readOnly: true }),
      google: e,
      ...(e.allDay ? {} : { ...(e.startTime ? { startTime: e.startTime } : {}), ...(e.endTime ? { endTime: e.endTime } : {}) }),
    }));
}

/** 그 날의 공휴일 — 이름은 늘 보여 주고, **칠하는 것은 쉬는 날뿐**이다. */
export interface HolidayInfo {
  name: string;
  /** 실제로 쉬는 날(`isDayOffHoliday`) — 달력이 그 칸을 일요일 색으로 그린다. */
  dayOff: boolean;
}

/**
 * 공휴일 캘린더의 종일 일정 → `날짜 → 공휴일`. 달력이 그 날 이름을 숫자 옆에 적고
 * (디자인 원본), **쉬는 날이면** 숫자·칸을 일요일 색으로 그린다.
 *
 * 이름과 색을 가른 이유: 구글의 공휴일 캘린더에는 24절기·기념일까지 들어 있어
 * 전부 칠하면 달이 통째로 분홍이 된다(제보). 이름은 정보이므로 그대로 두고,
 * 색은 **확실히 쉬는 날일 때만** 쓴다.
 */
export function holidayMap(events: readonly GoogleEvent[]): Record<string, HolidayInfo> {
  const out: Record<string, HolidayInfo> = {};
  for (const e of events) {
    if (!e.holiday) continue;
    // 여러 날짜에 걸친 공휴일(연휴)도 하루씩 채운다.
    let d = e.startDate;
    for (let i = 0; i < 32 && d <= e.endDate; i += 1) {
      const prev = out[d];
      // 같은 날에 여럿이면 이름은 먼저 온 것을, 쉬는 날 여부는 **하나라도 참이면** 참.
      if (!prev) out[d] = { name: e.title, dayOff: !!e.dayOff };
      else if (e.dayOff && !prev.dayOff) out[d] = { name: prev.name, dayOff: true };
      const [y, m, day] = d.split('-').map(Number);
      if (!y || !m || !day) break;
      const nx = new Date(y, m - 1, day + 1);
      const p = (n: number) => String(n).padStart(2, '0');
      d = `${nx.getFullYear()}-${p(nx.getMonth() + 1)}-${p(nx.getDate())}`;
    }
  }
  return out;
}

/**
 * 전 스페이스의 일정 항목. 같은 문서가 여러 목록에 있어도 한 번만 읽는다.
 * 결과는 기한 → 제목 순으로 안정 정렬(같은 날 순서가 렌더마다 흔들리지 않게).
 */
export function calendarEntries(sources: readonly CalendarSource[], bodies: Record<string, string | undefined>): CalendarEntry[] {
  const seen = new Set<string>();
  const out: CalendarEntry[] = [];
  for (const s of sources) {
    if (!s.docId || seen.has(s.docId)) continue;
    seen.add(s.docId);
    for (const c of datedCards(s.docId, bodies[s.docId])) {
      out.push({ ...c, docId: s.docId, boardName: s.boardName, spaceName: s.spaceName, ...(s.readOnly ? { readOnly: true } : {}) });
    }
  }
  out.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
  return out;
}

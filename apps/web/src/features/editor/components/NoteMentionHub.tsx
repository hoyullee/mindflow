// 공책 본문의 `@` 멘션 허브 — 사람·날짜·페이지를 한 목록에서 고른다(스펙 4-3~4-5).
//
// 형제 부품은 이 파일의 `SlashMenu`(`NoteEditor.tsx`)다. 자리 잡기·포커스를 뺏지
// 않는 법·키보드를 document에서 받는 법을 그대로 따른다 — 다만 `SlashMenu`는 자기
// `useAnchored`(그 파일 안의 비공개 함수)를 쓸 수 있는데 여기서는 그 파일을 고치면
// 안 되므로(동시에 다른 세션이 고치는 중) 바깥 클릭 닫기·Esc를 이 파일 안에서 다시
// 작게 구현한다. 로직 알맹이(날짜 해석)는 새로 만들지 않고 `noteDateQuery`를 쓴다.
//
// 이 컴포넌트는 **상태를 스스로 들지만 본문을 모른다** — 코어 타입(`NotePage` 등)을
// 전혀 참조하지 않고, 호출부가 이미 추린 `people`/`pages`만 받아 `onPick` 하나만 부른다.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { dateHits, wantsCalendarRow } from '../noteDateQuery';
import type { DateHit } from '../noteDateQuery';
import { mentionInitial, mentionTone } from '../mentionChip';
import { DOW, addDays, isoOf, monthCells, monthLabel, partsOf } from '../../home/calendar/model';

// ── 공개 계약 — 호출부가 이 모양 그대로 부른다 ──────────────────────────────

export interface HubAnchor {
  gx: number;
  gy: number;
  up: boolean;
  listH: number;
}

export interface HubPerson {
  email: string;
  name: string;
}

export interface HubPage {
  id: string;
  title: string;
}

export type HubPick =
  | { kind: 'person'; email: string; name: string }
  | { kind: 'date'; iso: string; label: string }
  | { kind: 'page'; id: string; title: string };

interface HubProps {
  anchor: HubAnchor | null;
  /** `@` 뒤에 친 글자(빈 문자열 가능). */
  query: string;
  /** 기준 날짜 `YYYY-MM-DD`. 테스트가 고정값을 넣으므로 안에서 `new Date()`로 오늘을 읽지 않는다. */
  today: string;
  /** 부를 수 있는 사람들 — 나는 이미 빠져 있다. */
  people: HubPerson[];
  /** 이 공책의 다른 페이지들 — 지금 보는 페이지는 이미 빠져 있다. */
  pages: HubPage[];
  /** `/날짜`로 열렸나. 참이면 사람·페이지 그룹을 숨기고 달력이 함께 보인다. */
  dateOnly?: boolean;
  /**
   * 날짜별 **그날 일정 수**(스펙 4-3의 `일정 N`) — 없으면 그 표기가 뜨지 않는다.
   *
   * 허브가 스스로 캘린더를 읽지 않는 이유: 이 부품은 순수하게 유지해야 테스트가
   * 시계·네트워크 없이 돌고, 같은 값을 이미 읽고 있는 쪽(에디터)이 넘겨 주면 된다.
   */
  counts?: Record<string, number>;
  onPick: (pick: HubPick) => void;
  onClose: () => void;
}

// ── 내부 행 모델 ──────────────────────────────────────────────────────────

type Row = { kind: 'person'; person: HubPerson } | { kind: 'date'; hit: DateHit } | { kind: 'calendar' } | { kind: 'page'; page: HubPage };

function rowKey(row: Row): string {
  switch (row.kind) {
    case 'person':
      return `p:${row.person.email}`;
    case 'date':
      return `d:${row.hit.iso}`;
    case 'page':
      return `g:${row.page.id}`;
    case 'calendar':
      return 'calendar';
  }
}

// ── 날짜 계산 — `noteDateQuery`가 다루지 않는 **달력 그리기 전용** 자잘한 것들 ──
//
// 실제 "이 문자열이 무슨 날인가" 해석은 전부 `dateHits`가 한다. 여기 있는 것은
// 미니 달력을 그리려고 필요한 하루짜리 산수뿐이다(`model.ts`의 `monthCells`도
// 안에서 같은 방식(`new Date(y, m, 0).getDate()`)을 쓴다 — 새 규칙이 아니다).

function safeParts(iso: string, fallback: string): { y: number; m: number; d: number } {
  return partsOf(iso) ?? partsOf(fallback) ?? { y: 1970, m: 1, d: 1 };
}

function lastDayOfMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

/** `8월 27일 목` — 달력 머리의 포커스 날짜 표기(스펙 4-5, 괄호 없이). */
function focusedDayLabel(iso: string, todayFallback: string): string {
  const p = safeParts(iso, todayFallback);
  const dow = new Date(p.y, p.m - 1, p.d).getDay();
  return `${p.m}월 ${p.d}일 ${DOW[dow] ?? ''}`;
}

// ── 배지 — 행 왼쪽의 22px 아이콘/아바타 ──────────────────────────────────

function PersonBadge({ person }: { person: HubPerson }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 22,
        height: 22,
        flex: '0 0 auto',
        borderRadius: 999,
        // 사람 색은 테마 토큰이 아니라 `mentionTone`의 고정값이다 — 본문 칩·프로필
        // 카드와 같은 규칙(mentionChip.ts 주석): 테마를 바꿨다고 그 사람 색이
        // 바뀌면 "누구인지" 알아보는 표식이 흔들린다.
        background: mentionTone(person.email),
        color: '#fff',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 10.5,
        fontWeight: 800,
      }}
    >
      {mentionInitial(person.name)}
    </span>
  );
}

/** 코랄 달력 배지 — 날짜 행과 `다른 날짜 고르기…` 행이 함께 쓴다. */
function DateBadge(): JSX.Element {
  return (
    <span
      aria-hidden="true"
      style={{ width: 22, height: 22, flex: '0 0 auto', borderRadius: 7, background: 'var(--mf-accent)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M16 3v4M8 3v4M3 11h18" />
      </svg>
    </span>
  );
}

function PageBadge(): JSX.Element {
  return (
    <span
      aria-hidden="true"
      style={{ width: 22, height: 22, flex: '0 0 auto', borderRadius: 7, background: 'var(--mf-note-hover)', color: 'var(--mf-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
        <path d="M14 3v5h5" />
      </svg>
    </span>
  );
}

// ── 스타일 — 색은 전부 `SlashMenu`가 쓰는 것과 같은 `var(--mf-*)` 토큰 ──────

const HUB_W = 276;

const HEADER: CSSProperties = { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, padding: '10px 13px 6px', borderBottom: '1px solid var(--mf-border-soft)' };
const HEADER_LABEL: CSSProperties = { fontSize: 11, fontWeight: 800, letterSpacing: '-.01em', color: 'var(--mf-text)' };
const HEADER_HINT: CSSProperties = { flex: '0 0 auto', fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 10, color: 'var(--mf-faint2)', whiteSpace: 'nowrap' };
const HINT_LINE: CSSProperties = { padding: '8px 13px 2px', fontSize: 10.5, lineHeight: 1.5, color: 'var(--mf-faint)', wordBreak: 'keep-all' };
const GROUP_HEAD: CSSProperties = { padding: '4px 9px 6px', fontSize: 10, fontWeight: 800, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--mf-faint)' };

const ROW_BASE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  boxSizing: 'border-box',
  padding: '6px 8px',
  borderRadius: 8,
  border: 'none',
  background: 'transparent',
  color: 'var(--mf-text)',
  fontFamily: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
};
const ROW_MAIN: CSSProperties = { flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 700, color: 'var(--mf-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const ROW_SIDE: CSSProperties = { flex: '0 0 auto', fontSize: 10.5, color: 'var(--mf-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const ROW_SIDE_EMAIL: CSSProperties = { ...ROW_SIDE, maxWidth: 120 };

const BACK_BTN: CSSProperties = { alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', border: 0, background: 'transparent', color: 'var(--mf-subtext)', fontFamily: 'inherit', fontSize: 11, fontWeight: 700, cursor: 'pointer', padding: 0 };

function panelStyle(anchor: HubAnchor): CSSProperties {
  return {
    position: 'fixed',
    left: anchor.gx,
    // 위로 뜰 때는 `gy`(블록 윗선)에서 6px 띄운 자리에 **아랫변**을 댄다 — `SlashMenu`의
    // 두 겹(고정 앵커 + absolute 패널) 대신, `100vh - gy`로 뷰포트 바닥에서부터의
    // 거리를 계산해 한 겹으로 같은 효과를 낸다(호출부가 이미 `up`/`gy`를 골라 줬으므로
    // 여기서는 그 값을 그대로 쓰기만 하면 된다 — 스펙 §1 "그대로 쓴다").
    ...(anchor.up ? { bottom: `calc(100vh - ${anchor.gy}px + 6px)` } : { top: anchor.gy + 6 }),
    width: HUB_W,
    boxSizing: 'border-box',
    borderRadius: 14,
    background: 'var(--mf-card)',
    border: '1px solid var(--mf-border)',
    boxShadow: '0 24px 48px -22px rgba(46,42,38,.5)',
    animation: 'mf-note-pop .13s ease both',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    zIndex: 40,
  };
}

// ── 행 하나 ──────────────────────────────────────────────────────────────

function HubRow({
  row,
  index,
  active,
  counts,
  setActiveEl,
  onHover,
  onPick,
}: {
  row: Row;
  index: number;
  active: boolean;
  /** 날짜별 그날 일정 수 — 행이 `일정 N`을 적을지 가른다(스펙 4-3). */
  counts?: Record<string, number>;
  /**
   * 콜백 ref로 받는다 — `RefObject<HTMLButtonElement | null>`을 그대로 prop 타입으로
   * 넘기면 설치된 `@types/react`(18.3.31)의 `RefObject<T>.current: T | null`이 제네릭
   * 인자 자리에서 `T = HTMLButtonElement | null`과 `T = HTMLButtonElement`를 서로
   * 다른 타입으로 갈라 JSX `ref`가 요구하는 `RefObject<HTMLButtonElement>`에 대입되지
   * 않는다(실측 tsc 오류). 콜백 함수 타입은 그 변성 문제가 아예 없다.
   */
  setActiveEl: (el: HTMLButtonElement | null) => void;
  onHover: () => void;
  onPick: () => void;
}): JSX.Element {
  const icon = row.kind === 'person' ? <PersonBadge person={row.person} /> : row.kind === 'page' ? <PageBadge /> : <DateBadge />;
  const mainText = row.kind === 'person' ? row.person.name : row.kind === 'date' ? row.hit.label : row.kind === 'page' ? row.page.title : '다른 날짜 고르기…';
  const sideText = row.kind === 'person' ? row.person.email : row.kind === 'date' ? row.hit.sub : row.kind === 'calendar' ? '달력 열기' : null;
  // `일정 N`은 **있을 때만** 적는다(스펙 4-3) — 0을 적으면 줄마다 `일정 0`이 붙어
  // 정작 일정이 있는 날이 눈에 띄지 않는다.
  const count = row.kind === 'date' ? (counts?.[row.hit.iso] ?? 0) : 0;
  return (
    <button
      type="button"
      ref={active ? setActiveEl : undefined}
      data-hub-row={index}
      data-hub-kind={row.kind}
      aria-selected={active}
      // 눌러도 본문의 캐럿을 뺏지 않는다 — `SlashMenu`와 같은 이유(스펙 §1): 캐럿이
      // 살아 있어야 고른 결과가 지금 치던 그 자리에 들어간다.
      onMouseDown={(e) => e.preventDefault()}
      // `mouseenter`가 아니라 `mousemove`다 — 목록이 캐럿 바로 아래에 뜨므로 포인터가
      // 이미 그 위에 얹힌 채인 일이 흔한데, 목록이 열리거나 스크롤되면서 다른 행이
      // 포인터 아래로 들어오면 `mouseenter`가 손 대지 않아도 쏜다(`SlashMenu` 주석과
      // 같은 제보 계열의 버그).
      onMouseMove={onHover}
      onClick={onPick}
      style={{ ...ROW_BASE, ...(active ? { background: 'var(--mf-note-hover)' } : {}) }}
    >
      {icon}
      <span style={ROW_MAIN}>{mainText}</span>
      {count > 0 && (
        <span data-hub-count style={{ flex: '0 0 auto', fontSize: 11, fontWeight: 700, color: '#d8794f' }}>
          일정 {count}
        </span>
      )}
      {sideText && <span style={row.kind === 'person' ? ROW_SIDE_EMAIL : ROW_SIDE}>{sideText}</span>}
    </button>
  );
}

// ── 본체 ────────────────────────────────────────────────────────────────

export function NoteMentionHub(props: HubProps): JSX.Element | null {
  const { anchor, query, today, people, pages, dateOnly, counts, onPick, onClose } = props;

  const [cursor, setCursor] = useState(0);
  const [calendarMode, setCalendarMode] = useState(false);
  const [calFocusIso, setCalFocusIso] = useState(today);
  // 달력에서 **한 번이라도** 화살표를 움직였는가 — `dateOnly`에서 Enter가 목록과
  // 달력 중 어느 쪽을 고를지 가른다(스펙 4-5).
  const [calMoved, setCalMoved] = useState(false);

  const listRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef<HTMLButtonElement | null>(null);
  // 콜백 ref를 **정체성이 고정된** 함수로 둔다(`useRef`에 담아 최초 한 번만 쓴다) —
  // 매 렌더 새 함수를 넘기면 React가 이전 노드에 `null`을, 새 노드에 값을 그때마다
  // 다시 넣는다. `activeRef` 자체는 항상 같은 객체라 이 클로저는 언제 만들어졌든 안전하다.
  const setActiveElRef = useRef((el: HTMLButtonElement | null) => {
    activeRef.current = el;
  });
  const wasOpenRef = useRef(false);

  const q = query.trim();
  const qLower = q.toLowerCase();

  const calendarVisible = calendarMode || !!dateOnly;
  // `dateOnly`는 목록·달력이 **함께** 보인다(스펙). 그 밖에는 달력 모드일 때만 목록을
  // 접는다(창이 커지지 않도록 — 스펙 4-5).
  const showList = !calendarMode || !!dateOnly;
  const showCalendar = calendarVisible;

  // ── 그룹 ──
  const personList = dateOnly ? [] : !q ? people.slice(0, 3) : people.filter((p) => p.name.toLowerCase().includes(qLower) || p.email.toLowerCase().includes(qLower)).slice(0, 4);
  const personRows: Row[] = personList.map((person): Row => ({ kind: 'person', person }));

  const dateHitList = dateHits(query, today);
  // `다른 날짜 고르기…` 행은 `dateOnly`에는 두지 않는다 — 그 모드는 달력이 이미
  // 늘 함께 보이므로, 누르면 "이미 보이는 것을 또 열자"는 뜻 없는 행이 된다(판단).
  const showCalendarRow = !dateOnly && wantsCalendarRow(query);
  const dateRows: Row[] = dateHitList.map((hit): Row => ({ kind: 'date', hit }));
  if (showCalendarRow) dateRows.push({ kind: 'calendar' });

  const pageList = dateOnly || !q ? [] : pages.filter((p) => p.title.toLowerCase().includes(qLower)).slice(0, 3);
  const pageRows: Row[] = pageList.map((page): Row => ({ kind: 'page', page }));

  const flat: Row[] = [...personRows, ...dateRows, ...pageRows];
  const activeIndex = flat.length ? Math.min(cursor, flat.length - 1) : -1;
  const dateOffset = personRows.length;
  const pageOffset = dateOffset + dateRows.length;

  // 검색어가 사람·페이지 이야기를 하는 안내문이라, 달력이 보이는 동안은(`dateOnly`
  // 포함) 뜻이 없어진다 — 그 둘은 애초에 목록에서 빠져 있다(판단).
  const showHint = !calendarVisible && !q;

  const headerLabel = dateOnly ? '날짜 넣기' : calendarMode ? '날짜 고르기' : q ? `@${query}` : '멘션';
  const hint = calendarVisible ? '←→↑↓ 날짜 이동 · Enter' : '↑↓ 이동 · Enter';

  const calParts = safeParts(calFocusIso, today);
  const cells = monthCells(calParts.y, calParts.m, [], today);

  function pickRow(row: Row): void {
    if (row.kind === 'calendar') {
      enterCalendar();
      return;
    }
    if (row.kind === 'person') {
      onPick({ kind: 'person', email: row.person.email, name: row.person.name });
      return;
    }
    if (row.kind === 'page') {
      onPick({ kind: 'page', id: row.page.id, title: row.page.title });
      return;
    }
    onPick({ kind: 'date', iso: row.hit.iso, label: row.hit.label });
  }

  function pickDay(iso: string): void {
    onPick({ kind: 'date', iso, label: focusedDayLabel(iso, today) });
  }

  function enterCalendar(): void {
    setCalendarMode(true);
    // "열 때 포커스는 today"(스펙 4-5) — 무엇을 찾던 중이었는지와 무관하게 못박는다.
    setCalFocusIso(today);
    setCalMoved(false);
  }

  function moveCal(deltaDays: number): void {
    setCalFocusIso((iso) => {
      const p = safeParts(iso, today);
      const next = addDays(iso, deltaDays);
      const first = isoOf(p.y, p.m, 1);
      const last = isoOf(p.y, p.m, lastDayOfMonth(p.y, p.m));
      // 그 달의 1일~말일 안에서 멈춘다(스펙) — 달을 넘기면 머리(`monthLabel`)도 같이
      // 넘어가야 하는데, 한 칸 이동에 달이 통째로 바뀌면 "어디로 갔는지" 놓치기 쉽다.
      return next < first ? first : next > last ? last : next;
    });
    setCalMoved(true);
  }

  // 허브가 새로 열릴 때(닫힘→열림) 저번 세션의 달력 모드·커서가 남아있지 않게
  // 되돌린다. 호출부가 `anchor`만 널로 바꾸고 이 컴포넌트를 계속 마운트해 둘 수도
  // 있어(언마운트에 기대지 않는다) 직접 초기화한다.
  useLayoutEffect(() => {
    const open = anchor !== null;
    if (open && !wasOpenRef.current) {
      setCalendarMode(false);
      setCursor(0);
    }
    wasOpenRef.current = open;
  }, [anchor]);

  // 목록이 좁혀지면 고른 줄을 처음으로 되돌린다(없는 줄을 가리키지 않게 — `SlashMenu`와 같다).
  useEffect(() => setCursor(0), [query]);

  /**
   * 고른 줄은 늘 보이게(스펙 5-1의 관례 — `SlashMenu` 주석과 같은 이유).
   * `scrollIntoView`를 쓰지 않는다: 조상 전부를 굴려 본문 판까지 움직이므로, 목록
   * 상자 **안에서만** 넘친 만큼만 굴린다.
   */
  useEffect(() => {
    const box = listRef.current;
    const el = activeRef.current;
    if (!box || !el) return;
    const br = box.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    if (er.top < br.top) box.scrollTop -= br.top - er.top;
    else if (er.bottom > br.bottom) box.scrollTop += er.bottom - br.bottom;
  }, [cursor, query, calendarMode]);

  /**
   * 키보드는 **본문에 있다**(캐럿이 그대로다) — `SlashMenu`와 같은 이유로 document를
   * 캡처 단계에서 듣는다. 그러지 않으면 Enter가 목록을 고르면서 본문에도 줄바꿈이 들어간다.
   */
  useEffect(() => {
    if (!anchor) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        onClose();
        return;
      }
      // 한글을 확정하는 Enter는 가로채지 않는다 — 조합 중이면 흘린다(`SlashMenu`와 같다).
      const composing = e.isComposing || e.keyCode === 229;
      if (composing) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        if (calendarMode && !dateOnly) {
          pickDay(calFocusIso);
        } else if (dateOnly) {
          // dateOnly: 달력을 한 번이라도 움직였으면 그 날짜가 우선이다(스펙 4-5).
          if (calMoved) pickDay(calFocusIso);
          else if (flat.length) pickRow(flat[Math.min(cursor, flat.length - 1)]!);
        } else if (flat.length) {
          pickRow(flat[Math.min(cursor, flat.length - 1)]!);
        }
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        if (calendarMode && !dateOnly) {
          moveCal(e.key === 'ArrowDown' ? 7 : -7);
        } else if (flat.length) {
          // 끝에서 멈추지 않고 돈다(`SlashMenu`와 같은 모듈러 순환).
          setCursor((c) => (c + (e.key === 'ArrowDown' ? 1 : flat.length - 1)) % flat.length);
        }
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (calendarMode || dateOnly) {
          e.preventDefault();
          e.stopPropagation();
          moveCal(e.key === 'ArrowRight' ? 1 : -1);
        } else {
          // 캐럿을 옆으로 옮기는 것은 고르는 일이 아니다(`SlashMenu`와 같은 판단) —
          // 목록만 접고 글자는 그대로 둔다(막지 않으므로 캐럿은 평소처럼 움직인다).
          onClose();
        }
        return;
      }
      if ((e.key === 'Home' || e.key === 'End') && !calendarMode && !dateOnly) {
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
    // `pickRow`/`pickDay`/`moveCal`/`enterCalendar`는 아래 값들만으로 매 렌더 새로
    // 만들어지는 순수 클로저라(전부 `props`/state에서 파생) 별도로 나열하지 않는다.
  }, [anchor, calendarMode, dateOnly, calMoved, calFocusIso, flat, cursor, today, onPick, onClose]);

  // 바깥을 누르면 닫힌다 — 판 안의 누름은 뿌리의 `onPointerDown`에서 막는다(아래).
  // 스크롤로는 닫지 않는다: `SlashMenu`와 같은 이유로, 본문을 굴리며 고르는 자리다.
  useEffect(() => {
    if (!anchor) return;
    const onDown = () => onClose();
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [anchor, onClose]);

  if (!anchor) return null;

  return (
    <div data-note-hub onPointerDown={(e) => e.stopPropagation()} style={panelStyle(anchor)}>
      <div style={HEADER}>
        <span style={HEADER_LABEL}>{headerLabel}</span>
        <span style={HEADER_HINT}>{hint}</span>
      </div>
      {showHint && <div style={HINT_LINE}>이름 · 27 · 8.27 · 금요일 · 페이지 제목으로 찾기</div>}
      {showList && (
        <div ref={listRef} className="lnb-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 1, padding: 7, maxHeight: anchor.listH, overflowY: 'auto', overflowX: 'hidden' }}>
          {personRows.length > 0 && (
            <div style={{ display: 'contents' }}>
              <span style={GROUP_HEAD}>사람</span>
              {personRows.map((row, i) => (
                <HubRow key={rowKey(row)} row={row} index={i} active={i === activeIndex} setActiveEl={setActiveElRef.current} onHover={() => setCursor((c) => (c === i ? c : i))} onPick={() => pickRow(row)} />
              ))}
            </div>
          )}
          {dateRows.length > 0 && (
            <div style={{ display: 'contents' }}>
              <span style={GROUP_HEAD}>날짜</span>
              {dateRows.map((row, i) => {
                const idx = dateOffset + i;
                return <HubRow key={rowKey(row)} row={row} index={idx} active={idx === activeIndex} counts={counts} setActiveEl={setActiveElRef.current} onHover={() => setCursor((c) => (c === idx ? c : idx))} onPick={() => pickRow(row)} />;
              })}
            </div>
          )}
          {pageRows.length > 0 && (
            <div style={{ display: 'contents' }}>
              <span style={GROUP_HEAD}>페이지</span>
              {pageRows.map((row, i) => {
                const idx = pageOffset + i;
                return <HubRow key={rowKey(row)} row={row} index={idx} active={idx === activeIndex} setActiveEl={setActiveElRef.current} onHover={() => setCursor((c) => (c === idx ? c : idx))} onPick={() => pickRow(row)} />;
              })}
            </div>
          )}
          {flat.length === 0 && (
            <div style={{ padding: '18px 9px', textAlign: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--mf-subtext)' }}>{`'${query}'와 맞는 사람·날짜·페이지가 없어요`}</span>
            </div>
          )}
        </div>
      )}
      {showCalendar && (
        <div style={{ padding: '8px 13px 12px', display: 'flex', flexDirection: 'column', gap: 8, borderTop: showList ? '1px solid var(--mf-border-soft)' : undefined }}>
          {calendarMode && !dateOnly && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setCalendarMode(false);
                setCursor(0);
              }}
              style={BACK_BTN}
            >
              ‹ 사람·날짜 목록으로
            </button>
          )}
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--mf-text)', whiteSpace: 'nowrap' }}>{monthLabel(calParts.y, calParts.m)}</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--mf-accent-deep)', whiteSpace: 'nowrap' }}>{focusedDayLabel(calFocusIso, today)}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
            {DOW.map((d) => (
              <span key={d} style={{ textAlign: 'center', fontSize: 10, fontWeight: 700, color: 'var(--mf-faint)' }}>
                {d}
              </span>
            ))}
            {cells.map((cell) => {
              const focused = cell.iso === calFocusIso;
              return (
                <button
                  key={cell.iso}
                  type="button"
                  data-hub-day={cell.iso}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pickDay(cell.iso)}
                  aria-current={focused ? 'date' : undefined}
                  aria-label={`${cell.n}일`}
                  style={{
                    height: 24,
                    borderRadius: 7,
                    border: 0,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontSize: 11,
                    fontWeight: cell.isToday ? 800 : 600,
                    background: focused ? 'var(--mf-accent)' : 'transparent',
                    color: focused ? '#fff' : cell.inMonth ? 'var(--mf-text)' : 'var(--mf-faint)',
                  }}
                >
                  {cell.n}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

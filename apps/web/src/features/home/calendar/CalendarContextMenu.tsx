// 일정 화면의 우클릭 메뉴(요청 ④).
//
// 껍데기는 홈의 그 메뉴(`HomeMenuPanel`)를 그대로 쓴다 — 자리·닫기·화살표 이동·
// 플라이아웃이 앱 안에서 한 벌이어야 하고, 같은 우클릭이 화면마다 다른 모양으로
// 뜨면 그 자체가 어긋남이다. 여기서 정하는 것은 **항목**뿐이다.
//
// 대상은 셋이고 우클릭한 자리가 그것을 정한다:
//   ① 칩·기간 바 → 그 **항목**(열기 · 원천으로 가기 · 하루 옮기기 · 삭제)
//   ② 날짜 칸    → 그 **날**(새 일정 · 그 날 전부 보기 · 날짜별 보기 · 오늘로)
//   ③ 그 밖      → **화면**(새 일정 · 오늘로 · 두 사이드 토글)
//
// 눌러도 아무 일이 없는 항목은 두지 않는다 — 보기 전용으로 공유받은 카드에는 옮기기·
// 삭제가 없고, 구글에서 쓸 수 없는 일정도 마찬가지다(진짜 게이트는 서버·구글 API고
// 이건 "고쳐지는 척하다 안 되는" 화면을 막는 어포던스다).

import type { ReactNode } from 'react';
import { HomeMenuPanel, type HomeMenuItem } from '../components/HomeContextMenu';
import type { CalendarEntry } from './entries';

/** 우클릭한 자리 — 항목·날짜·그 밖(화면). */
export type CalMenuTarget = { entry: CalendarEntry } | { day: string } | { view: true };

export interface CalMenuState {
  target: CalMenuTarget;
  x: number;
  y: number;
}

export interface CalMenuActions {
  onClose: () => void;
  /** 상세 팝업 */
  openEntry: (e: CalendarEntry) => void;
  /** 그 항목의 원천으로 — 칸반이면 그 보드, 구글이면 구글 캘린더(새 탭). */
  openSource: (e: CalendarEntry) => void;
  /** 며칠 옮긴다(기간이면 시작일·기한이 함께). */
  shiftEntry: (e: CalendarEntry, days: number) => void;
  /** 삭제 확인창을 띄운다 — 파괴적 동작은 메뉴가 바로 실행하지 않는다. */
  askDelete: (e: CalendarEntry) => void;
  newEvent: (iso: string) => void;
  openDayList: (iso: string, at: { x: number; y: number }) => void;
  openDaySide: (iso: string) => void;
  goToday: () => void;
  toggleDeadline: () => void;
}

/** 그 항목을 이 메뉴에서 지울 수 있는가 — 없으면 항목을 내주지 않거나 사유를 적는다. */
function deletable(e: CalendarEntry): { ok: true } | { ok: false; hint?: string } {
  if (e.readOnly) return { ok: false };
  if (e.google) {
    if (!e.google.writable) return { ok: false };
    // 반복 일정은 **범위**(이 회차만·이후·전체)를 골라야 지운다 — 그 물음은 상세의
    // 일이다. 여기서 하나를 골라 실행하면 남의 달력이 조용히 망가진다.
    if (e.google.recurringEventId) return { ok: false, hint: '반복 일정은 열어서 범위를 골라 지워요' };
    return { ok: true };
  }
  if (e.event) {
    if (e.event.recurrence) return { ok: false, hint: '반복 일정은 열어서 범위를 골라 지워요' };
    return { ok: true };
  }
  return { ok: true };
}

export function buildCalendarMenu(
  target: CalMenuTarget,
  ctx: { todayIso: string; selectedDay: string; y: number; m: number; dayCount: (iso: string) => number; sideOpen: boolean; deadlineOpen: boolean; isMobile: boolean; at: { x: number; y: number } },
  a: CalMenuActions,
): HomeMenuItem[] {
  if ('entry' in target) {
    const e = target.entry;
    const del = deletable(e);
    const items: HomeMenuItem[] = [{ key: 'open', icon: OpenIcon, label: '열기', onSelect: () => a.openEntry(e) }];
    if (e.google) {
      if (e.google.htmlLink) items.push({ key: 'source', icon: ExternalIcon, label: 'Google에서 열기', onSelect: () => a.openSource(e) });
    } else if (!e.event) {
      items.push({ key: 'source', icon: ExternalIcon, label: '이 칸반 열기', onSelect: () => a.openSource(e) });
    }
    if (!e.readOnly && !(e.google && !e.google.writable)) {
      items.push({ key: 'sep-move', label: '' });
      items.push({ key: 'prev', icon: LeftIcon, label: '하루 앞으로', onSelect: () => a.shiftEntry(e, -1) });
      items.push({ key: 'next', icon: RightIcon, label: '하루 뒤로', onSelect: () => a.shiftEntry(e, 1) });
    }
    if (del.ok || del.hint) {
      items.push({ key: 'sep-del', label: '' });
      items.push({
        key: 'delete',
        icon: TrashIcon,
        label: '삭제',
        danger: true,
        ...(del.ok ? { onSelect: () => a.askDelete(e) } : { disabled: true, ...(del.hint ? { hint: del.hint } : {}) }),
      });
    }
    return items;
  }

  if ('day' in target) {
    const iso = target.day;
    const n = ctx.dayCount(iso);
    const items: HomeMenuItem[] = [{ key: 'new', icon: PlusIcon, label: '이 날에 새 일정', onSelect: () => a.newEvent(iso) }];
    if (n > 0) items.push({ key: 'list', icon: ListIcon, label: `이 날의 일정 모두 보기 (${n})`, onSelect: () => a.openDayList(iso, ctx.at) });
    // 날짜별 보기는 데스크톱 사이드다 — 폰에는 그 판이 없어 항목을 내주지 않는다.
    if (!ctx.isMobile) items.push({ key: 'side', icon: CalendarIcon, label: '날짜별 보기로 열기', onSelect: () => a.openDaySide(iso) });
    if (!isToday(iso, ctx.todayIso)) {
      items.push({ key: 'sep-today', label: '' });
      items.push({ key: 'today', icon: TodayIcon, label: '오늘로 이동', onSelect: a.goToday });
    }
    return items;
  }

  const items: HomeMenuItem[] = [{ key: 'new', icon: PlusIcon, label: '새 일정', onSelect: () => a.newEvent(ctx.selectedDay) }];
  const now = new Date();
  const onNow = ctx.y === now.getFullYear() && ctx.m === now.getMonth() + 1 && ctx.selectedDay === ctx.todayIso;
  if (!onNow) items.push({ key: 'today', icon: TodayIcon, label: '오늘로 이동', onSelect: a.goToday });
  if (!ctx.isMobile) {
    items.push({ key: 'sep-side', label: '' });
    items.push({ key: 'deadline', icon: ListIcon, label: ctx.deadlineOpen ? '마감 목록 닫기' : '마감 목록 보기', onSelect: a.toggleDeadline });
    items.push({ key: 'side', icon: CalendarIcon, label: ctx.sideOpen ? '날짜별 보기 닫기' : '날짜별 보기 열기', onSelect: () => a.openDaySide(ctx.selectedDay) });
  }
  return items;
}

function isToday(iso: string, todayIso: string): boolean {
  return iso === todayIso;
}

export function CalendarContextMenu({
  menu,
  ctx,
  actions,
}: {
  menu: CalMenuState | null;
  ctx: Omit<Parameters<typeof buildCalendarMenu>[1], 'at'>;
  actions: CalMenuActions;
}) {
  if (!menu) return null;
  const items = buildCalendarMenu(menu.target, { ...ctx, at: { x: menu.x, y: menu.y } }, actions);
  if (!items.length) return null;
  const kind = 'entry' in menu.target ? 'cal-entry' : 'day' in menu.target ? 'cal-day' : 'cal-view';
  return <HomeMenuPanel x={menu.x} y={menu.y} items={items} kind={kind} resetKey={JSON.stringify(menu.target)} onClose={actions.onClose} />;
}

// ── 아이콘 ────────────────────────────────────────────────────────────────
const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const icon = (d: ReactNode): ReactNode => (
  <svg width="14" height="14" viewBox="0 0 24 24" {...stroke}>
    {d}
  </svg>
);
const OpenIcon = icon(
  <>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <path d="M7 9h10M7 13h6" />
  </>,
);
const ExternalIcon = icon(
  <>
    <path d="M14 4h6v6M20 4 11 13" />
    <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </>,
);
const LeftIcon = icon(<path d="m15 6-6 6 6 6" />);
const RightIcon = icon(<path d="m9 6 6 6-6 6" />);
const PlusIcon = icon(<path d="M12 5v14M5 12h14" />);
const ListIcon = icon(
  <>
    <path d="M8 6h13M8 12h13M8 18h13" />
    <circle cx="3.5" cy="6" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="3.5" cy="12" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="3.5" cy="18" r="1.1" fill="currentColor" stroke="none" />
  </>,
);
const CalendarIcon = icon(
  <>
    <rect x="3" y="4.5" width="18" height="16" rx="2.5" />
    <path d="M3 9.5h18M8 3v3M16 3v3" />
  </>,
);
const TodayIcon = icon(
  <>
    <rect x="3" y="4.5" width="18" height="16" rx="2.5" />
    <path d="M3 9.5h18M8 3v3M16 3v3" />
    <circle cx="12" cy="14.5" r="2" fill="currentColor" stroke="none" />
  </>,
);
const TrashIcon = icon(
  <>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </>,
);

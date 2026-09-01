import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cardsInColumn, type KanbanCard, type KanbanColumn } from '@mindflow/mindmap-core';
import { useCommentStore } from '../../../adapters/BackendContext';
import { CardFace, cardBase, beginPointerDrag, COL_W, COL_SHADOW } from '../../editor/components/KanbanBoard';
import { dropTargetAt, edgeScroll, type ColumnHit } from '../../editor/kanbanDrag';
import { UI_THEME, hexA, type Theme } from '../../editor/theme';
import { boardSurface, columnBg, columnColor, innerLine } from '../../editor/kanbanMeta';
import { useParticipantAvatars } from '../../editor/useParticipantAvatars';
import type { HomeController } from '../useHomeController';
import type { HomeState } from '../types';
import type { HomeViewModel, DocKindName } from '../viewModel';
import { docKindOf } from '../viewModel';
import { DASH_CAP, DASH_COLS, DASH_MIN_SIZE, DASH_ROW_PX, DASH_ROWS_MAX, calWidgetMode, parseSize, sizesFor, type DashWidgetKind } from '../dashboard/model';
import { CalWidgetBody, type CalWidgetSide } from '../dashboard/CalendarWidget';
import { useCalendarEntries } from '../calendar/useCalendarEntries';
import { useCalendarEvents, type CalendarEventsApi } from '../calendar/useCalendarEvents';
import { eventEntries, googleEntries, holidayMap, type CalendarEntry } from '../calendar/entries';
import { useGoogleCalendar, type GoogleCalendarApi } from '../calendar/useGoogleCalendar';
import { GoogleConnectButton } from '../calendar/GoogleConnectButton';
import { addDays, addMonth, daysBetween, gridRange, isoOf, partsOf, todayISO, weekStartISO } from '../calendar/model';
import { homeChipSurface } from '../theme';
import { CalendarGlyph } from '../calendar/CalendarView';
import { CalendarDetailHost } from '../calendar/CalendarDetail';
import { NewEventModal } from '../calendar/NewEventModal';
import { submitNewEvent } from '../calendar/newEventSubmit';
import { GoogleDetailHost } from '../calendar/GoogleEventDetail';
import { EventDetail, geurioCalendarChips } from '../calendar/EventDetail';
import { widgetDataOf, type WidgetData, type WidgetKanban } from '../dashboard/widgetData';
import { previewSurface, realPreview } from '../mapPreview';
import { useVisibleOnce } from '../useVisibleOnce';
import { mapHref, readDocRaw } from '../storage';
import { formatLastEdited } from '../timeFormat';
import { META_MONO } from '../chrome';
import { UNREAD_BADGE_BG } from '../theme';

/**
 * 대시보드 보기 — 디자인 원본 `Geurio 홈 대시보드.dc.html`의 isDash 화면.
 *
 * 위젯은 전부 **보기 전용**이다: 내용은 썸네일 프리페치와 같은 본문(`previewDocs`)
 * 에서 실제 문서를 읽고, 에디터로 가는 길은 **"열기" 버튼 하나뿐**이다(요청) —
 * 카드 아무 데나 눌러도 열리면, 칸반 카드를 옮기거나 내용을 읽다 실수로 화면이
 * 통째로 바뀐다.
 * 배치 편집(드래그·리사이즈)은 다음 단계 — 지금은 우클릭 메뉴의 크기·내리기·
 * 맨 앞으로가 그 몫을 맡는다.
 *
 * 몸통이 그리는 것(제보로 확정): 마인드맵·화이트보드는 홈 카드와 같은
 * **실렌더**(`realPreview` — 실제 좌표·색·잉크)이고, 칸반은 에디터의 시각 규칙
 * (`widgetData`가 `kanbanMeta`로 계산)을 디자인의 위젯 틀에 부어 실제 보드처럼
 * 보인다.
 */
/** 일정 위젯의 표식 — LNB `일정` 행·헤더 칩과 같은 글리프(같은 것은 같게 보인다). */
const CAL_META = { name: '일정', color: 'var(--mf-accent)', icon: <CalendarGlyph size={14} /> };

/** 위젯 머리의 작은 알약(달 이동의 `오늘`) — 디자인 원본의 그 크기. */
/** 위젯 머리 조작 버튼의 크기 — 20px은 누르기 힘들다는 제보로 28px(머리 높이 약
 *  34px 안에서 여백을 남기는 가장 큰 값). 아래 알약·세그먼트가 같은 값을 쓴다. */
const NAV_H = 28;

/** 위젯 머리의 작은 알약(달 이동의 `오늘`). */
const navPill: CSSProperties = { height: NAV_H, padding: '0 10px', borderRadius: 999, border: '1px solid var(--mf-accent-mute)', background: 'var(--mf-accent-soft)', color: 'var(--mf-accent-strong)', font: 'inherit', fontSize: 11, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap' };

function NavBtn({ label, d, onClick }: { label: string; d: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className="mf-ctl"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      style={{ width: NAV_H, height: NAV_H, borderRadius: 9, border: '1px solid var(--mf-border)', background: 'var(--mf-card)', color: 'var(--mf-muted)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={d} />
      </svg>
    </button>
  );
}

/** 옆 패널 토글(원본 `wSideDlPick`/`wSideDayPick`) — 세그먼트 트랙 안의 한 칸.
 *  켜진 칸만 카드 면 + 그늘 + 강조색 잉크(속성 패널의 크기 세그먼트와 같은 문법). */
function SideBtn({ label, on, onClick, children }: { label: string; on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      data-cal-widget-side-btn={label}
      title={label}
      aria-label={label}
      aria-pressed={on}
      className="mf-ctl"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      style={{
        width: NAV_H - 6,
        height: NAV_H - 4,
        flex: '0 0 auto',
        borderRadius: 8,
        border: 0,
        background: on ? 'var(--mf-card)' : 'transparent',
        boxShadow: on ? '0 1px 3px -1px rgba(46,42,38,.28)' : 'none',
        color: on ? 'var(--mf-accent-strong)' : 'var(--mf-faint)',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {children}
      </svg>
    </button>
  );
}

const KIND_META: Record<DocKindName, { name: string; color: string; icon: JSX.Element }> = {
  map: {
    name: '마인드맵',
    color: 'var(--mf-doc-map)',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="5" cy="12" r="2.4" />
        <path d="M7.4 12h5M12.4 12c2.6 0 3.6-5 6.1-5M12.4 12c2.6 0 3.6 5 6.1 5" />
        <circle cx="20" cy="7" r="1.7" />
        <circle cx="20" cy="17" r="1.7" />
      </svg>
    ),
  },
  board: {
    name: '화이트보드',
    color: 'var(--mf-doc-board)',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3.5" y="4" width="17" height="14" rx="2.5" />
        <path d="m8 14 3-4 2.4 3 2-2.4L18 14" />
      </svg>
    ),
  },
  kanban: {
    name: '칸반보드',
    color: 'var(--mf-doc-kanban)',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3.5" y="4" width="4.6" height="16" rx="1.3" />
        <rect x="9.7" y="4" width="4.6" height="10" rx="1.3" />
        <rect x="15.9" y="4" width="4.6" height="13" rx="1.3" />
      </svg>
    ),
  },
};

interface Props {
  state: HomeState;
  view: HomeViewModel;
  controller: HomeController;
  isMobile?: boolean;
  /** 폰의 LNB 서랍 열기 — 대시보드가 홈의 첫 화면이 되면서(요청) 이 화면에도
   * ≡가 있어야 한다. 없으면 스페이스·검색·알림으로 갈 길이 사라진다. */
  onOpenNav?: () => void;
}


export function DashboardView({ state, view, controller, isMobile = false, onOpenNav }: Props) {
  // 편집 모드는 모바일에서도 열린다(PR④) — 다만 **탭으로 되는 것만** 내준다:
  // 크기 순환·내리기 버튼. HTML5 드래그(재배치)와 모서리 리사이즈는 터치에서
  // 발화하지 않는 마우스 제스처라 데스크톱 전용이고, 순서는 길게 눌러 여는
  // 메뉴의 "맨 앞으로 옮기기"가 맡는다(안내 띠가 기기별로 그렇게 말한다).
  const edit = state.dashEdit;
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  // 리사이즈 중의 라이브 크기 — 커밋은 손을 뗄 때 한 번(undo·저장이 한 단계).
  const [resize, setResize] = useState<{ itemId: string; size: string } | null>(null);
  const resizeRef = useRef<{ itemId: string; size: string } | null>(null);

  const dash = state.dashboards.find((d) => d.id === state.activeDash);
  if (!dash) return null;
  const others = state.dashboards.filter((d) => d.id !== dash.id);
  const cols = isMobile ? 2 : DASH_COLS;
  const atCap = dash.items.length >= DASH_CAP;


  /** 모서리 리사이즈(디자인 startResize) — 시작 사각형 기준으로 픽셀 → 칸 수 환산,
   * 움직이는 동안은 라이브 상태만 갱신하고 손을 뗄 때 커밋한다. */
  const startResize = (e: MouseEvent, itemId: string, kind: DashWidgetKind, startSize: string) => {
    e.preventDefault();
    e.stopPropagation();
    const el = (e.currentTarget as HTMLElement).closest('[data-dash-widget]');
    const grid = gridRef.current;
    if (!el || !grid) return;
    const GAP = 14;
    const cellW = (grid.getBoundingClientRect().width - GAP * (cols - 1)) / cols;
    const start = el.getBoundingClientRect();
    const [minC, minR] = DASH_MIN_SIZE[kind];
    const move = (ev: globalThis.MouseEvent) => {
      const w = ev.clientX - start.left;
      const h = ev.clientY - start.top;
      const cNew = Math.max(minC, Math.min(cols, Math.round((w + GAP) / (cellW + GAP))));
      const rNew = Math.max(minR, Math.min(DASH_ROWS_MAX, Math.round((h + GAP) / (DASH_ROW_PX + GAP))));
      const size = `${cNew}x${rNew}`;
      if (resizeRef.current?.size !== size) {
        resizeRef.current = { itemId, size };
        setResize({ itemId, size });
      }
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      const fin = resizeRef.current;
      resizeRef.current = null;
      setResize(null);
      if (fin && fin.size !== startSize) controller.setDashItemSize(itemId, fin.size);
    };
    resizeRef.current = { itemId, size: startSize };
    setResize({ itemId, size: startSize });
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  // 편집 모드의 고스트 격자 — 지금 배치가 차지하는 넓이에서 여유 행을 더해
  // "놓을 수 있는 자리"를 보여 준다(디자인 editCells).
  const cellArea = dash.items.reduce((a, it) => {
    const [ic, ir] = parseSize(resize?.itemId === it.id ? resize.size : it.size);
    return a + Math.min(ic, cols) * ir;
  }, 0);
  const ghostRows = Math.max(2, Math.ceil(cellArea / cols)) + 3;

  return (
    <div data-dashboard-view style={{ display: 'flex', flexDirection: 'column', margin: isMobile ? '-16px -14px -32px' : '-24px -32px -44px' }}>
      {/* 다크 히어로 — 대시보드 화면임을 한눈에 가르는 띠(디자인 원본 #332E29 고정:
          어두운 면이라 다크 테마에서도 그대로 성립한다). */}
      {/* 인사말·날짜 줄은 없앴다(요청) — 타이틀 한 줄만 남기고 양쪽 묶음을 가운데 정렬한다. */}
      <div style={{ position: 'relative', background: '#332E29', padding: isMobile ? '18px 16px' : '22px 32px', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 14, overflow: 'hidden' }}>
        <div aria-hidden style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(rgba(247,239,232,.07) 1px, transparent 1px)', backgroundSize: '18px 18px' }} />
        <div style={{ position: 'relative', minWidth: 0, flex: '1 1 auto' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flexWrap: 'wrap' }}>
            {/* 폰의 앱 바 ≡ — 홈의 첫 화면이 대시보드라(요청) 여기에도 서랍 손잡이가
                있어야 한다. 툴바의 그것과 같은 고스트 버튼(44px)이고, 색만 다크 히어로에
                맞춘다. 확인하지 않은 공유가 있으면 문에도 점을 찍는다(닫힌 문 뒤의
                배지는 알림이 아니다 — 툴바와 같은 규칙). */}
            {isMobile && onOpenNav && (
              <button
                type="button"
                className="btn"
                onClick={onOpenNav}
                title={view.sharedUnread > 0 ? `메뉴 열기 (새 공유 ${view.sharedUnread}개)` : '메뉴 열기'}
                aria-label={view.sharedUnread > 0 ? `메뉴 열기, 확인하지 않은 공유 ${view.sharedUnread}개` : '메뉴 열기'}
                style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, marginLeft: -12, marginRight: -6, marginTop: -6, marginBottom: -6, border: 'none', borderRadius: 10, background: 'transparent', color: '#F7EFE8', cursor: 'pointer', padding: 0, flexShrink: 0 }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="4" y1="7" x2="20" y2="7" />
                  <line x1="4" y1="12" x2="20" y2="12" />
                  <line x1="4" y1="17" x2="20" y2="17" />
                </svg>
                {view.sharedUnread > 0 && <span data-unread-dot aria-hidden="true" style={{ position: 'absolute', top: 9, right: 9, width: 8, height: 8, borderRadius: '50%', background: UNREAD_BADGE_BG, border: '2px solid #332E29' }} />}
              </button>
            )}
            <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 9, fontSize: 25, fontWeight: 800, letterSpacing: '-.035em', color: '#F7EFE8', whiteSpace: 'nowrap' }}>
              {/* 색은 만들기 팝업에서 고른 그 색(없으면 강조색). 히어로는 고정 다크 면이라
                  어두운 색은 묻히므로 옅은 빛 테두리를 둘러 어느 색에서도 점이 산다. */}
              <span data-dash-hero-dot style={{ width: 10, height: 10, borderRadius: 3.5, background: dash.color ?? 'var(--mf-accent)', boxShadow: '0 0 0 1px rgba(247,239,232,.3)', display: 'block', flexShrink: 0 }} />
              {dash.name}
            </h2>
            <span style={{ ...META_MONO, color: dash.items.length >= DASH_CAP ? '#E8A08A' : '#8C7E6B', whiteSpace: 'nowrap', paddingTop: 6 }}>
              {dash.items.length}/{DASH_CAP}
            </span>
            {others.length > 0 && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, paddingTop: 3 }}>
                {others.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    className="btn"
                    onClick={() => controller.selectDash(d.id)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 24, padding: '0 11px', borderRadius: 999, border: '1px solid rgba(247,239,232,.16)', background: 'transparent', color: '#8C7E6B', font: 'inherit', fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    {/* 그 대시보드의 색 — 이름을 읽지 않고도 어느 것인지 알아본다(LNB와 같은 색). */}
                    <span aria-hidden style={{ width: 6, height: 6, borderRadius: 2, background: d.color ?? 'var(--mf-accent)', display: 'block', flexShrink: 0 }} />
                    {d.name}
                  </button>
                ))}
              </span>
            )}
          </span>
        </div>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {/* 편집 토글(디자인) — 켜면 위젯 드래그 재배치·모서리 리사이즈·인라인
              크기/제거가 열린다. 히어로가 고정 다크 면이라 색도 디자인 값 그대로. */}
          <button
            type="button"
            className="btn"
            data-dash-edit-toggle
            aria-pressed={edit}
            onClick={controller.toggleDashEdit}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              height: 32,
              padding: '0 13px',
              borderRadius: 999,
              border: `1px solid ${edit ? '#F2A184' : 'rgba(247,239,232,.28)'}`,
              background: edit ? '#F2A184' : 'rgba(247,239,232,.07)',
              color: edit ? '#332E29' : '#F7EFE8',
              fontSize: 12.5,
              fontWeight: 700,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'background .14s ease, color .14s ease',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
            {edit ? '편집 끝내기' : '편집'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={controller.openDashPicker}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              height: 32,
              padding: '0 15px',
              borderRadius: 999,
              border: '1px solid var(--mf-accent)',
              background: 'linear-gradient(180deg, var(--mf-accent), var(--mf-accent-strong))',
              color: 'var(--mf-accent-ink)',
              fontSize: 12.5,
              fontWeight: 700,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              boxShadow: '0 9px 20px -12px rgba(var(--mf-accent-rgb), .9)',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            보드 추가
          </button>
        </div>
      </div>

      {/* 격자 바닥 — 캔버스 같은 점 격자(디자인). */}
      <div style={{ padding: isMobile ? '14px 14px 32px' : '18px 32px 44px', display: 'flex', flexDirection: 'column', gap: 14, backgroundImage: 'radial-gradient(var(--mf-dot-grid) 1px, transparent 1px)', backgroundSize: '17px 17px', minHeight: 420, flex: 1 }}>
        {/* 편집 안내 띠(디자인) — 무엇을 할 수 있는지와 종류별 최소 크기를 말한다.
            모바일은 드래그·모서리 리사이즈가 없으므로(터치에서 발화하지 않는 마우스
            제스처) 실제로 되는 조작만 말한다 — 안내가 안 되는 것을 약속하면 안 된다. */}
        {edit && (
          <div data-dash-edit-banner style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 14px', borderRadius: 13, background: 'var(--mf-accent-soft)', border: '1px solid rgba(var(--mf-accent-rgb), .25)', animation: 'mf-dim-in .2s ease both' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--mf-accent-strong)" strokeWidth="2" strokeLinecap="round" aria-hidden="true" style={{ flexShrink: 0 }}>
              <circle cx="12" cy="12" r="9" />
              <path d="M12 11v5M12 8h.01" />
            </svg>
            <span style={{ fontSize: 12, color: 'var(--mf-subtext)' }}>
              {isMobile
                ? '크기 버튼(2×2)으로 카드 크기를 바꾸고 ✕로 내려요. 카드를 길게 누르면 맨 앞으로 옮길 수 있어요.'
                : '카드를 끌어 순서를 바꾸고, 오른쪽 아래 모서리를 끌어 크기를 조절해요. 칸반 보드는 3×2부터, 마인드맵과 화이트보드는 1×1부터 — 최대 4×4까지 놓을 수 있어요.'}
            </span>
          </div>
        )}
        {dash.items.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '70px 24px', borderRadius: 20, border: '1.5px dashed var(--mf-border)', background: 'var(--mf-card)' }}>
            <span style={{ width: 46, height: 46, borderRadius: 15, background: 'var(--mf-accent-soft)', color: 'var(--mf-accent-strong)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" aria-hidden="true">
                <rect x="3.5" y="3.5" width="7.5" height="9.5" rx="1.6" />
                <rect x="13" y="3.5" width="7.5" height="5.5" rx="1.6" />
                <rect x="3.5" y="15" width="7.5" height="5.5" rx="1.6" />
                <rect x="13" y="11" width="7.5" height="9.5" rx="1.6" />
              </svg>
            </span>
            <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: '-.02em' }}>아직 올려둔 보드가 없어요</span>
            <span style={{ fontSize: 12, color: 'var(--mf-muted)', textAlign: 'center', maxWidth: 300 }}>스페이스나 공유받은 문서에서 보드를 골라 올리면, 여기서 한눈에 볼 수 있어요.</span>
            <button
              type="button"
              className="btn"
              onClick={controller.openDashPicker}
              style={{ marginTop: 2, display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 15px', borderRadius: 999, border: '1px solid var(--mf-accent)', background: 'linear-gradient(180deg, var(--mf-accent), var(--mf-accent-strong))', color: 'var(--mf-accent-ink)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}
            >
              보드 추가
            </button>
          </div>
        ) : (
          <div ref={gridRef} data-dash-grid style={{ position: 'relative', display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: DASH_ROW_PX, gridAutoFlow: 'row dense', gap: 14 }}>
            {/* 고스트 격자(디자인 editCells) — 놓을 수 있는 자리를 점선 칸으로 보여 준다.
                포인터를 받지 않아 드래그·리사이즈를 방해하지 않는다. */}
            {edit && (
              <div data-dash-ghost-cells aria-hidden style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: DASH_ROW_PX, gap: 14, pointerEvents: 'none', overflow: 'hidden' }}>
                {Array.from({ length: ghostRows * cols }, (_, i) => (
                  <span key={i} style={{ border: '1.5px dashed var(--mf-border)', borderRadius: 16, background: 'rgba(var(--mf-accent-rgb), .04)' }} />
                ))}
              </div>
            )}
            {dash.items.map((it, idx) => (
              <DashWidget
                key={it.id}
                itemId={it.id}
                docId={it.docId ?? ''}
                itemKind={it.kind}
                size={resize?.itemId === it.id ? resize.size : it.size}
                committedSize={it.size}
                maxCols={cols}
                edit={edit}
                isMobile={isMobile}
                dragging={dragIdx === idx}
                resizing={resize?.itemId === it.id ? resize.size : null}
                state={state}
                view={view}
                controller={controller}
                onDragStartW={() => setDragIdx(idx)}
                onDragEndW={() => setDragIdx(null)}
                onDragOverW={(e) => {
                  if (dragIdx !== null && dragIdx !== idx) e.preventDefault();
                }}
                onDropW={(e) => {
                  e.preventDefault();
                  if (dragIdx !== null && dragIdx !== idx) controller.moveDashItem(dragIdx, idx);
                  setDragIdx(null);
                }}
                onResizeStart={startResize}
                onOpen={(docId, title) => controller.openWithLoader(mapHref(title, docId), title, docId)}
              />
            ))}
            {/* 편집 중 여유 드롭 공간 — 맨 아래로 끌어낼 자리(디자인 editBottomRow). */}
            {edit && !atCap && <span aria-hidden style={{ gridColumn: '1 / -1', gridRow: 'span 1', visibility: 'hidden', pointerEvents: 'none' }} />}
          </div>
        )}
      </div>

    </div>
  );
}

// ── 위젯 ─────────────────────────────────────────────────────────────────

interface DashWidgetProps {
  itemId: string;
  /** 문서 위젯의 대상 — 일정 위젯에서는 빈 문자열이다(가리킬 문서가 없다). */
  docId: string;
  /** 문서가 아닌 위젯의 종류(지금은 일정 하나). */
  itemKind?: 'cal';
  /** 지금 그릴 크기 — 리사이즈 중에는 라이브 값이 들어온다. */
  size: string;
  /** 저장된 크기 — 리사이즈 시작점·크기 순환 버튼의 기준. */
  committedSize: string;
  maxCols: number;
  edit: boolean;
  /** 터치 화면 — 드래그·모서리 리사이즈·카드 열 이동은 마우스 제스처라 내주지
   * 않는다(죽은 어포던스 방지). 편집은 탭으로 되는 것(크기 순환·내리기)만. */
  isMobile: boolean;
  dragging: boolean;
  /** 이 위젯이 리사이즈 중이면 그 라이브 크기(`"3x2"`), 아니면 null. */
  resizing: string | null;
  state: HomeState;
  view: HomeViewModel;
  controller: HomeController;
  onDragStartW: () => void;
  onDragEndW: () => void;
  onDragOverW: (e: ReactDragEvent) => void;
  onDropW: (e: ReactDragEvent) => void;
  onResizeStart: (e: MouseEvent, itemId: string, kind: DashWidgetKind, startSize: string) => void;
  /** 에디터로 열기 — 스페이스의 카드와 같은 길(전체 화면 로더 → 이동). */
  onOpen: (docId: string, title: string) => void;
}

function DashWidget({ itemId, docId, itemKind, size, committedSize, maxCols, edit, isMobile, dragging, resizing, state, view, controller, onDragStartW, onDragEndW, onDragOverW, onDropW, onResizeStart, onOpen }: DashWidgetProps) {
  // 일정 위젯은 문서를 가리키지 않는다 — 아래 문서 조회는 전부 빈 값으로 지나간다.
  const cal = itemKind === 'cal';
  const raw = state.previewDocs[docId] || readDocRaw(docId) || null;
  const resolved = !!raw || !!state.previewResolved[docId];
  const kind = cal ? 'cal' : docKindOf('', docId, state.previewDocs);
  const meta = cal ? CAL_META : KIND_META[kind as DocKindName];
  const [c0, rows] = parseSize(size);
  const c = Math.min(c0, maxCols); // 모바일(2열)에서는 넓은 위젯을 접는다
  const title = cal ? '일정' : view.dashDocTitles[docId];
  const space = cal ? undefined : view.dashDocSpaces[docId];
  const when = cal ? undefined : formatLastEdited(state.docTimes[docId]);
  const missing = !cal && resolved && !raw && !title;
  const data: WidgetData | null = raw ? widgetDataOf(raw) : null;
  const shared = space === '공유받음';
  // 곁정보도 에디터와 같은 출처 — 담당 사진(share_participants)·댓글 수(comments).
  // 칸반 위젯일 때만 읽는다(문서당 한 번, 다른 종류는 왕복 0).
  const isKanbanWidget = kind === 'kanban' && !!raw;
  // 첨부 이미지 URL은 이 위젯이 화면에 닿을 때 발급받는다(홈 카드와 같은 규칙).
  const rootRef = useRef<HTMLDivElement | null>(null);
  const noteVisible = controller.notePreviewVisible;
  useVisibleOnce(rootRef, () => noteVisible(docId));
  const participantAvatars = useParticipantAvatars(docId, isKanbanWidget);
  const commentCounts = useDocCommentCounts(isKanbanWidget ? docId : '');
  // 실렌더의 가지 색 폴백 — 홈 카드가 쓰는 그 hue(카탈로그에 실려 있다).
  const hue = view.dashPickCatalog.find((b) => b.docId === docId)?.hue ?? '#f0663f';
  // 칸반 카드 이동 — 대시보드에서 유일하게 허용된 편집(디자인 "열 이동 가능").
  // 보기 전용으로 공유받은 보드는 어포던스도 내주지 않는다(진짜 게이트는 서버 RLS).
  // **터치에서도 된다**: 드래그가 에디터와 같은 포인터 제스처(길게 누르기)로 바뀌어
  // HTML5 드래그처럼 손가락에서 죽지 않는다 — 그래서 배지도 더 이상 거짓이 아니다.
  const sharedRole = state.sharedMaps.find((m) => m.docId === docId)?.role;
  const canMoveCards = kind === 'kanban' && !!title && !missing && sharedRole !== 'view';

  /** 에디터로 여는 **유일한 길**(요청) — 카드 어디를 눌러도 열리던 것을 "열기"
   *  버튼 하나로 좁혔다. 위젯 안에서 카드를 옮기거나 글을 읽다 실수로 화면이
   *  통째로 바뀌는 일이 없다. */
  const open = (e: MouseEvent) => {
    e.stopPropagation();
    if (!title || edit) return; // 편집 중의 클릭은 배치 조작이지 열기가 아니다(디자인 openBoard)
    if (cal) {
      // "크게 보기"가 말 그대로이게 — 위젯에서 고른 날이 있으면 그 날로 연다.
      if (calSide === 'day') controller.selectCalDay(calDay);
      controller.openCalendar();
      return;
    }
    onOpen(docId, title);
  };
  const onCtx = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    controller.openCtxMenuAt(e.clientX, e.clientY, { kind: 'widget', id: itemId });
  };
  const presets = sizesFor(kind);
  const cycleSize = (e: MouseEvent) => {
    e.stopPropagation();
    const next = presets[(presets.indexOf(committedSize) + 1) % presets.length]!;
    controller.setDashItemSize(itemId, next);
  };
  const removeSelf = (e: MouseEvent) => {
    e.stopPropagation();
    controller.removeDashItem(itemId);
  };
  const sizeLabel = (resizing ?? committedSize).replace('x', '×');

  // ── 일정 위젯 ──────────────────────────────────────────────────────────
  // 항목의 원천은 일정 화면과 **같다**(칸반 마감 + Geurio 일정) — 여기서 다시 모으지
  // 않고 같은 훅을 쓴다. 달 이동은 문서가 아니라 **보는 사람의 상태**라 위젯 안에
  // 둔다(대시보드에 캘린더 위젯은 하나뿐이라 저장할 이유도 없다).
  const todayIso = todayISO();
  const [ym, setYm] = useState(() => {
    const p = partsOf(todayIso)!;
    return { y: p.y, m: p.m };
  });
  const [weekOffset, setWeekOffset] = useState(0);
  /** 옆 패널이 무엇을 보여 주는가(원본 `wcalSide`) — 다가오는 마감 / 고른 날. */
  const [calSide, setCalSide] = useState<CalWidgetSide>('dl');
  /** 옆 패널이 보여 주는 날(원본 `wcalSel`) — 기본은 오늘. */
  const [calDay, setCalDay] = useState(todayIso);
  const calMode = calWidgetMode(c, rows);
  // 달을 넘기는 보기(달력 + 달력만)와 주를 넘기는 보기(주간·목록)를 가른다 —
  // `month-only`가 주 이동에 걸려 ‹ ›를 눌러도 달력이 꿈쩍하지 않았다.
  const calByMonth = calMode === 'month' || calMode === 'month-only';
  // 주간·목록에서는 보이는 주가 든 달을 받는다 — 조회 구간이 그 달 격자 6주라
  // 멀리 넘긴 주도 함께 덮인다(달마다 한 번, 전송량은 유한하다). 미니 달력이 그리는
  // 달도 이 값이라 **보이는 것과 조회한 것이 언제나 같다**.
  //
  // 다만 **이번 주(offset 0)는 오늘의 달**이다 — 주 시작(일요일)의 달을 쓰면 달을
  // 걸치는 주에서 미니 달력이 지난달을 그리고, 오늘 칸이 이웃 달 칸이라 **눌리지도
  // 표시되지도 않는다**(9월 1일에 실제로 그랬다 — 그 주의 일요일은 8월 30일).
  const weekStart = addDays(weekStartISO(todayIso), weekOffset * 7);
  const weekAnchor = weekOffset === 0 ? todayIso : weekStart;
  const evYm = calByMonth ? ym : { y: partsOf(weekAnchor)!.y, m: partsOf(weekAnchor)!.m };
  const cardEntries = useCalendarEntries(state, cal);
  const eventsApi = useCalendarEvents(evYm.y, evYm.m, cal);
  // 구글 겹치기 — 일정 화면과 **같은 훅**이다(두 벌로 두면 한쪽만 고쳐진다).
  const googleApi = useGoogleCalendar(evYm.y, evYm.m, { enabled: !!state.google, calendars: state.google?.calendars ?? [] }, controller.setGoogleCalendars, cal ? 'events' : 'off');
  // 반복 일정은 **보이는 달의 6주**에서 회차로 펼쳐진다(일정 화면과 같은 구간).
  const calEntries = useMemo(
    () => [...cardEntries, ...eventEntries(eventsApi.events, gridRange(evYm.y, evYm.m)), ...googleEntries(googleApi.events)],
    [cardEntries, eventsApi.events, googleApi.events, evYm.y, evYm.m],
  );
  const calHolidays = useMemo(() => holidayMap(googleApi.events), [googleApi.events]);
  const chipSurface = useMemo(() => homeChipSurface(state.theme), [state.theme]);
  // 날짜를 고를 수단이 없는 보기(목록)에서는 **날짜별을 유지하지 않는다** — 크기를
  // N×1로 줄이면 달력도 미니 달력도 사라지므로, 예전에 고른 날의 일정이 남은 채
  // 오늘로 돌아갈 길이 없었다(제보).
  useEffect(() => {
    if (cal && calMode === 'list' && calSide === 'day') setCalSide('dl');
  }, [cal, calMode, calSide]);

  /** 항목을 누르면 상세 팝업 — 일정 화면과 **같은 컴포넌트**를 그대로 쓴다. */
  const pickCalEntry = (e: CalendarEntry) => {
    // 구글 일정은 읽기 전용 팝업(일정 화면과 같은 규칙).
    if (e.google) controller.openCalendarGoogle(e.google.id);
    // 반복 일정은 눌린 **회차**(그 회차의 시작일)까지 — 삭제 범위의 기준이 된다.
    else if (e.event) controller.openCalendarEvent(e.event.id, e.event.recurrence ? (e.start ?? e.due) : undefined);
    else controller.openCalendarCard(e.docId, e.cardId);
  };
  const thisMonth = (() => {
    const p = partsOf(todayIso)!;
    return ym.y === p.y && ym.m === p.m;
  })();
  /** 고른 날이 오늘이 아니다 — 어느 보기에서든 `오늘`로 돌아갈 길을 연다(제보). */
  const calDayOffToday = calSide === 'day' && calDay !== todayIso;
  const calNotNow = (calByMonth ? !thisMonth : weekOffset !== 0) || calDayOffToday;
  const calStep = (delta: number) => {
    if (calByMonth) setYm((p) => addMonth(p.y, p.m, delta));
    else setWeekOffset((w) => w + delta);
  };
  const calToday = () => {
    const p = partsOf(todayIso)!;
    if (calByMonth) setYm({ y: p.y, m: p.m });
    else setWeekOffset(0);
    setCalDay(todayIso);
  };
  /** 그 날이 든 주로 옮긴다 — 주 단위 보기의 미니 달력이 쓰는 유일한 이동. */
  const calGoWeek = (iso: string) => setWeekOffset(Math.round(daysBetween(weekStartISO(todayIso), weekStartISO(iso)) / 7));
  /**
   * 미니 달력의 달 이동. 달 단위 보기는 그 달을 그리면 되지만, 주 단위 보기에서는
   * 그릴 달이 **보이는 주**에서 나오므로(evYm) 주를 그 달 1일로 옮겨야 한다 —
   * 그러지 않으면 화살표를 눌러도 아무 일도 일어나지 않는다.
   */
  const calSetMonth = (y: number, m: number) => {
    if (calByMonth) {
      setYm({ y, m });
      return;
    }
    // 그 달의 **1주**로 간다 — 1일이 든 주가 아니다. 6/1이 월요일이면 그 주는
    // 5/31에 시작해 이름이 `5월 5주`가 되고, 6월을 눌렀는데 5월이 보인다.
    const ws = weekStartISO(isoOf(y, m, 1));
    calGoWeek(partsOf(ws)!.m === m ? ws : addDays(ws, 7));
  };
  /** 머리의 조작 묶음(원본 `calNav`) — 새 일정 · 오늘 · ‹ › · 옆 패널 토글.
   *  버튼은 26px(제보: 20px는 누르기 힘들다) — 위젯 머리 높이(약 40px) 안에서
   *  가장 큰 값이고, 옆 패널 토글은 낱개 버튼 둘 대신 **세그먼트 트랙**으로 묶어
   *  "둘 중 하나"임이 모양으로 보이게 했다(속성 패널의 크기 세그먼트와 같은 문법).
   *  주간·달력만 보기는 옆 패널이 없어 토글을 그리지 않는다(원본 `calSideToggles`).
   *  1열 위젯은 머리가 좁아 **‹ › 만** 남긴다 — 그마저 없으면 이번 주에 갇힌다. */
  const calSideToggles = calMode === 'month' || calMode === 'list' || calMode === 'list-mini';
  const calNav = (
    <span style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
      {c >= 2 && (
        <button
          type="button"
          data-cal-widget-new
          title="새 일정"
          aria-label="새 일정"
          className="mf-ctl"
          onClick={(e) => {
            e.stopPropagation();
            controller.openNewEvent(calSide === 'day' ? calDay : todayIso, true);
          }}
          style={{ width: NAV_H, height: NAV_H, padding: 0, borderRadius: 9, border: '1px solid var(--mf-accent-mute)', background: 'var(--mf-accent-soft)', color: 'var(--mf-accent-strong)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      )}
      {/* 구글 캘린더 연동(요청) — 아직 켜지 않았을 때만. 1열 머리는 좁아 ‹ ›만
          남기므로 여기서도 생략한다(설정에서 켤 수 있다). */}
      {c >= 2 && <GoogleConnectButton api={googleApi} size={NAV_H} />}
      {/* `오늘`은 **크기와 무관하게** 뜬다(제보: 1×1에서 날짜를 바꾸면 돌아올 길이
          없다). 1열은 머리가 좁아 좌우 여백만 줄인다. */}
      {calNotNow && (
        <button type="button" data-cal-widget-today className="mf-ctl" onClick={(e) => { e.stopPropagation(); calToday(); }} style={c >= 2 ? navPill : { ...navPill, padding: '0 8px' }}>
          오늘
        </button>
      )}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
        <NavBtn label={calByMonth ? '이전 달' : '이전 주'} d="m15 6-6 6 6 6" onClick={() => calStep(-1)} />
        <NavBtn label={calByMonth ? '다음 달' : '다음 주'} d="m9 6 6 6-6 6" onClick={() => calStep(1)} />
      </span>
      {c >= 2 && calSideToggles && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, height: NAV_H, padding: 2, boxSizing: 'border-box', borderRadius: 10, background: 'var(--mf-panel2)' }}>
          <SideBtn label="마감 목록" on={calSide === 'dl'} onClick={() => setCalSide('dl')}>
            <path d="M8 6h13M8 12h13M8 18h13" />
            <circle cx="3.5" cy="6" r="1.2" fill="currentColor" stroke="none" />
            <circle cx="3.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
            <circle cx="3.5" cy="18" r="1.2" fill="currentColor" stroke="none" />
          </SideBtn>
          <SideBtn label="날짜별 보기" on={calSide === 'day'} onClick={() => setCalSide('day')}>
            <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
            <path d="M8 3v4M16 3v4M3.5 10h17" />
            <rect x="7" y="13" width="5" height="4.5" rx="1" fill="currentColor" stroke="none" />
          </SideBtn>
        </span>
      )}
    </span>
  );



  return (
    <div
      ref={rootRef}
      data-dash-widget={itemId}
      onContextMenu={onCtx}
      className="mf-dash-widget"
      draggable={edit && !isMobile}
      onDragStart={(e) => {
        if (!edit || isMobile) return;
        onDragStartW();
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      }}
      onDragEnd={onDragEndW}
      onDragOver={onDragOverW}
      onDrop={onDropW}
      style={{
        gridColumn: `span ${c}`,
        gridRow: `span ${rows}`,
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        position: 'relative',
        borderRadius: 16,
        border: `1px solid ${dragging || resizing ? 'var(--mf-accent)' : 'var(--mf-border)'}`,
        background: 'var(--mf-card)',
        overflow: 'hidden',
        boxShadow: '0 2px 5px -3px rgba(46,42,38,.14), 0 20px 36px -30px rgba(46,42,38,.5)',
        opacity: dragging ? 0.45 : 1,
        // 카드 전체는 더 이상 열기 대상이 아니다(요청: "열기" 버튼으로만) — 손가락
        // 커서를 띄우면 아무 데나 눌러도 열린다는 거짓 약속이 된다.
        cursor: edit && !isMobile ? 'grab' : 'default',
        // transition은 여기서 주지 않는다 — 인라인이 `.mf-dash-widget`의 규칙(transform
        // 포함)을 덮어 hover 떠오름이 전이 없이 툭 바뀐다(홈 카드에서 겪은 함정).
      }}
    >
      {/* 리사이즈 손잡이(편집 모드, 데스크톱) — 오른쪽 아래 모서리를 끌어 칸 수를
          바꾼다. 터치에는 내주지 않는다(마우스 제스처 — 크기는 순환 버튼이 맡는다). */}
      {edit && !isMobile && (
        <span
          data-dash-resize
          title="모서리를 끌어 크기 조절"
          onMouseDown={(e) => onResizeStart(e, itemId, kind, committedSize)}
          style={{ position: 'absolute', right: 0, bottom: 0, zIndex: 5, width: 22, height: 22, cursor: 'nwse-resize', display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', padding: 4 }}
        >
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="var(--mf-faint2)" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
            <path d="M11 5 5 11M11 9l-2 2" />
          </svg>
        </span>
      )}
      {/* 리사이즈 중 — 점선 테두리 + 라이브 크기 라벨(디자인). 커밋은 손을 뗄 때. */}
      {resizing && (
        <span data-dash-resizing style={{ position: 'absolute', inset: 0, zIndex: 4, borderRadius: 15, border: '1.5px dashed var(--mf-accent)', background: 'rgba(var(--mf-accent-rgb), .08)', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <span style={{ padding: '5px 11px', borderRadius: 999, background: '#332E29', color: '#FBEDE6', ...META_MONO, fontSize: 12, fontWeight: 700 }}>{sizeLabel}</span>
        </span>
      )}
      {/* 1×1의 편집 컨트롤 — 머리에 자리가 없어 아래 구석에 띄운다(디자인 overlayControls).
          모바일은 리사이즈 손잡이가 없어 구석까지 붙는다. */}
      {edit && c === 1 && (
        <span style={{ position: 'absolute', right: isMobile ? 7 : 22, bottom: 7, zIndex: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
          <EditSizeButton label={sizeLabel} onClick={cycleSize} overlay big={isMobile} />
          <EditRemoveButton onClick={removeSelf} overlay big={isMobile} />
        </span>
      )}

      {/* hover 열기 알약(디자인) — **에디터로 가는 유일한 문**이다(요청: 카드 어디를
          눌러도 열리던 것을 이 버튼 하나로 좁혔다). 데스크톱은 카드에 손을 얹으면
          드러나고, 터치에는 hover가 없어 늘 보인다(home.css).
          편집 중에는 감춘다(그 시간의 클릭은 배치 조작이다 — showOpen: !editMode). */}
      {title && !edit && (
        <button
          type="button"
          className="btn mf-dash-open"
          title={cal ? '일정 화면에서 크게 보기' : '에디터에서 열기'}
          onClick={open}
          style={{
            position: 'absolute',
            right: 9,
            bottom: 9,
            zIndex: 5,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            height: 26,
            padding: '0 11px',
            borderRadius: 999,
            border: '1px solid var(--mf-border)',
            background: 'rgba(255,253,251,.94)',
            color: 'var(--mf-subtext)',
            font: 'inherit',
            fontSize: 11,
            fontWeight: 700,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            backdropFilter: 'blur(6px)',
            boxShadow: '0 10px 20px -14px rgba(46,42,38,.7)',
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14 4h6v6" />
            <path d="M20 4 11 13" />
            <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
          </svg>
          열기
        </button>
      )}

      {/* 머리 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 11px 9px', borderBottom: '1px solid var(--mf-hairline)', flexShrink: 0 }}>
        <span style={{ color: meta.color, display: 'inline-flex', flexShrink: 0 }}>{meta.icon}</span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 44, flex: 1 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: '-.015em', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title ?? (missing ? '문서를 찾을 수 없어요' : '불러오는 중…')}</span>
            {shared && (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--mf-faint2)" strokeWidth="2" strokeLinecap="round" aria-hidden="true" style={{ flexShrink: 0 }}>
                <circle cx="9" cy="8" r="3" />
                <path d="M3 19a6 6 0 0 1 12 0M17 11a3 3 0 1 0 0-6M21 19a5 5 0 0 0-4-4.9" />
              </svg>
            )}
          </span>
          <span style={{ fontSize: 10.5, color: 'var(--mf-muted)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cal ? '내 칸반 전체 · 자동 갱신' : [space, when].filter(Boolean).join(' · ')}</span>
        </span>
        {/* 권한 배지(디자인) — 칸반은 카드의 열만 옮길 수 있고, 나머지는 보기 전용.
            보기 전용으로 공유받은 칸반은 그대로 보기 전용을 단다. */}
        {cal && !edit && calNav}
        {!cal &&
          c >= 2 &&
          !edit &&
          (canMoveCards ? (
            <span title="대시보드에서 카드를 옮길 수 있어요(다른 열·같은 열 안 순서)" data-dash-perm="move" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 19, padding: '0 7px', flexShrink: 0, borderRadius: 999, background: 'var(--mf-success-soft)', color: 'var(--mf-success-ink)', fontSize: 9.5, fontWeight: 700, whiteSpace: 'nowrap' }}>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M8 6 4 12l4 6M16 6l4 6-4 6" />
              </svg>
              카드 이동 가능
            </span>
          ) : (
            <span title="대시보드에서는 볼 수만 있어요. 편집은 열어서 하세요" data-dash-perm="view" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 19, padding: '0 7px', flexShrink: 0, borderRadius: 999, background: 'var(--mf-bg)', color: 'var(--mf-muted)', fontSize: 9.5, fontWeight: 700, whiteSpace: 'nowrap' }}>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z" />
                <circle cx="12" cy="12" r="2.4" />
              </svg>
              보기 전용
            </span>
          ))}
        {/* 편집 컨트롤(디자인 inlineControls) — 크기 순환 + 내리기. 배지 자리를 이어받는다. */}
        {edit && c >= 2 && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
            <EditSizeButton label={sizeLabel} onClick={cycleSize} big={isMobile} />
            <EditRemoveButton onClick={removeSelf} big={isMobile} />
          </span>
        )}
      </div>

      {/* 몸통 */}
      {cal ? (
        <CalWidgetBody
          entries={calEntries}
          todayIso={todayIso}
          mode={calMode}
          cols={c}
          rows={rows}
          surface={chipSurface}
          ym={evYm}
          weekOffset={weekOffset}
          side={calSide}
          selDay={calDay}
          onPickDay={(iso) => {
            setCalDay(iso);
            // 주간 보기의 미니 달력 — 옆 패널이 날짜별이 아니므로 **그 날이 든 주로
            // 옮긴다**(고른 날은 미니 달력에 표시로 남는다).
            if (calMode === 'week') {
              calGoWeek(iso);
              return;
            }
            // 1열 위젯에는 머리에 토글을 둘 자리가 없다 — 고른 날을 **한 번 더**
            // 누르면 마감 목록으로 돌아온다(그러지 않으면 돌아올 길이 없다).
            if (c < 2 && calSide === 'day' && iso === calDay) {
              setCalSide('dl');
              return;
            }
            setCalSide('day');
          }}
          onPickEntry={pickCalEntry}
          onSetMonth={calSetMonth}
          holidays={calHolidays}
          onNewOnDay={(iso) => controller.openNewEvent(iso, true)}
        />
      ) : missing ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, fontSize: 11.5, color: 'var(--mf-faint)', textAlign: 'center' }}>휴지통에 있거나 삭제된 문서예요. 우클릭으로 내릴 수 있어요.</div>
      ) : !data ? (
        <div aria-busy={!resolved} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{!resolved ? <span className="mf-skel" style={{ width: '60%', height: 10, borderRadius: 6 }} /> : <span style={{ fontSize: 11.5, color: 'var(--mf-faint)' }}>내용이 아직 없어요</span>}</div>
      ) : data.kind === 'kanban' ? (
        <KanbanBody data={data} isMobile={isMobile} comments={commentCounts} avatars={participantAvatars.byEmail} onMoveCard={canMoveCards && !edit ? (cardId, toColId, index) => void controller.moveDashCard(docId, cardId, toColId, index) : undefined} />
      ) : (
        <SceneBody raw={raw!} hue={hue} imageUrls={state.previewImageUrls} />
      )}

      {/* 발치 — 아바타(칸반 담당) + 지표 한 줄(디자인). 1행 크기에서는 접는다. */}
      {!cal && rows >= 2 && data && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 11px 9px', borderTop: '1px solid var(--mf-hairline)', flexShrink: 0 }}>
          {data.kind === 'kanban' && data.avatars.length > 0 && (
            <span style={{ display: 'flex', alignItems: 'center' }} aria-hidden>
              {data.avatars.map((a, i) => (
                <span key={i} style={{ width: 19, height: 19, marginLeft: i ? -5 : 0, borderRadius: 999, background: a.color, border: '1.5px solid var(--mf-card)', color: '#fff', fontSize: 8.5, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                  {a.label}
                </span>
              ))}
            </span>
          )}
          <span style={{ flex: 1 }} />
          <span style={{ ...META_MONO, color: 'var(--mf-faint2)', whiteSpace: 'nowrap' }}>
            {data.kind === 'kanban' && data.done ? `${data.done.done}/${data.done.total} done` : data.kind === 'mind' ? `노드 ${data.nodeCount}개` : data.kind === 'board' ? `메모 ${data.noteTotal}개` : ''}
          </span>
        </div>
      )}

      {/* 일정 위젯의 팝업 — 일정 화면과 **같은 컴포넌트**를 그대로 쓴다(둘이 갈리면
          한쪽에만 기능이 붙는다). 대상 상태(`calDetail`·`calNewEvent`·`calEventDetail`)도
          같은 칸이라 화면이 하나만 그려지는 지금 구조에서 부딪히지 않는다. */}
      {cal && !edit && <CalWidgetDialogs state={state} controller={controller} entries={calEntries} events={eventsApi} google={googleApi} isMobile={isMobile} />}
    </div>
  );
}

/**
 * 일정 위젯이 여는 팝업 셋 — 항목 상세(칸반 카드 / Geurio 일정)와 새 일정.
 * 저장 흐름도 일정 화면과 같다(`eventsApi`가 곧 그 표).
 */
function CalWidgetDialogs({
  state,
  controller,
  entries,
  events,
  google,
  isMobile,
}: {
  state: HomeState;
  controller: HomeController;
  entries: readonly CalendarEntry[];
  events: CalendarEventsApi;
  google: GoogleCalendarApi;
  isMobile: boolean;
}) {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // `id#회차시작일` — 반복 일정은 눌린 회차가 삭제 범위(이 일정만/이후)의 기준이다.
  const [evId, evOcc] = (state.calEventDetail ?? '').split('#');
  const ev = evId ? events.events.find((e) => e.id === evId) : null;
  const googleTargets = google.writableCalendars.map((c) => ({ id: c.id, name: c.summary, ...(c.color ? { color: c.color } : {}) }));
  return (
    <>
      <CalendarDetailHost state={state} controller={controller} entries={entries} isMobile={isMobile} />
      <GoogleDetailHost
        openId={state.calGoogleDetail ?? null}
        events={google.events}
        isMobile={isMobile}
        onClose={controller.closeCalendarGoogle}
        onPatch={google.updateEvent}
        onDelete={google.deleteEvent}
        directory={{ canSearchPeople: google.canSearchPeople, searchPeople: google.searchPeople, canPickRooms: google.canPickRooms, rooms: google.rooms, roomsReady: google.roomsReady, loadRooms: google.loadRooms }}
      />
      {state.calNewEvent && (
        <NewEventModal
          draft={state.calNewEvent}
          isMobile={isMobile}
          saving={saving}
          error={saveError}
          onClose={() => {
            setSaveError(null);
            controller.closeNewEvent();
          }}
          googleTargets={googleTargets}
          directory={{ canSearchPeople: google.canSearchPeople, searchPeople: google.searchPeople, canPickRooms: google.canPickRooms, rooms: google.rooms, roomsReady: google.roomsReady, loadRooms: google.loadRooms }}
          onSubmit={(input, target) => {
            setSaving(true);
            void submitNewEvent(input, target, { createGeurio: events.create, createGoogle: google.createEvent }).then((err) => {
              setSaving(false);
              setSaveError(err);
              if (!err) controller.closeNewEvent();
            });
          }}
        />
      )}
      {ev && <EventDetail key={ev.id} event={ev} isMobile={isMobile} {...(evOcc ? { occurrence: evOcc } : {})} calendarChips={geurioCalendarChips(googleTargets)} onClose={controller.closeCalendarEvent} onPatch={(patch) => events.update(ev.id, patch)} onDelete={() => events.remove(ev.id)} />}
    </>
  );
}

/** 그 문서의 댓글 수 — 에디터 카드 곁정보와 **같은 규칙**(미해결 스레드 수, 답글
 * 제외). 위젯이 0을 지어내면 안 되므로 실제 목록을 한 번 읽는다(칸반 위젯당 1회,
 * 못 읽으면 빈 표 — 카드에는 0이 그려진다). */
function useDocCommentCounts(docId: string): Record<string, number> {
  const store = useCommentStore();
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!docId) {
      setCounts({});
      return;
    }
    let alive = true;
    store
      .list(docId)
      .then((rows) => {
        if (!alive) return;
        const m: Record<string, number> = {};
        rows.forEach((cm) => {
          if (cm.parentId || cm.resolved) return;
          m[cm.nodeId] = (m[cm.nodeId] ?? 0) + 1;
        });
        setCounts(m);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [store, docId]);
  return counts;
}

/** 칸반 몸통 — **에디터의 칸반 보드 그대로**다(제보: 열 크기·카드 디자인이 실제
 * 에디터와 달라 보이면 안 된다). 카드는 에디터의 `CardFace`/`cardBase`를 그대로
 * 재사용하고(분류 배지·본문 rich·기한 톤·댓글 수·담당 얼굴·긴급 왼 테두리까지
 * 한 코드), 열도 에디터의 스펙(폭 308/264·머리 구성·그림자)을 같은 값으로 그린다.
 * 색도 에디터와 같은 **UI_THEME 고정**(제보) — 칸반 에디터는 스타일 메뉴가 없어
 * doc.themeKey를 쓰지 않는다(문서에 실린 'white'는 템플릿의 관성값). 위젯이 그걸
 * 읽으면 에디터는 코랄인데 위젯만 파란 팔레트가 된다.
 *
 * 상호작용은 **카드 이동 하나**다: `onMoveCard`가 오면 카드를 끌어 다른 열로,
 * 또는 같은 열 안의 다른 자리로 옮길 수 있다. 드래그도 에디터의 그 기계를 그대로
 * 쓴다(`beginPointerDrag` — 마우스 4px 문턱 / 터치 320ms 길게 누르기, 취소는 이동이
 * 아니다) — 끌고 있는 카드는 목록에서 빠지고 그 자리에 점선 상자가 서며, 손끝에는
 * 같은 얼굴의 고스트가 살짝 기울어 따라온다. 편집 진입(더블클릭 상세·우클릭 메뉴·
 * 추가/삭제)은 내주지 않는다 — 그건 열어서 한다. 배치 편집 모드·보기 전용 공유에서는
 * 드래그 자체가 없다. */
interface CardDragState {
  id: string;
  fromCol: string;
  /** 화면 좌표(포인터) + 카드 안에서 잡은 지점 — 고스트가 손끝을 따라오는 데 쓴다. */
  x: number;
  y: number;
  offX: number;
  offY: number;
  w: number;
  h: number;
  target: { colId: string; index: number } | null;
}

function KanbanBody({ data, isMobile, comments, avatars, onMoveCard }: { data: WidgetKanban; isMobile: boolean; comments: Record<string, number>; avatars: Record<string, string>; onMoveCard?: (cardId: string, toColId: string, index: number) => void }) {
  const th = UI_THEME;
  const track = innerLine(th);
  const colW = isMobile ? 264 : COL_W; // 에디터 Column과 같은 폭
  const lastIdx = data.columns.length - 1;
  const boardRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<CardDragState | null>(null);
  const cardById = (id: string): KanbanCard | undefined => data.cards.find((c) => c.id === id);

  /** 지금 화면에 그려진 열·카드 사각형 — 순수 계산(`dropTargetAt`)에 넘길 재료다. */
  const columnHits = (): ColumnHit[] => {
    const board = boardRef.current;
    if (!board) return [];
    return Array.from(board.querySelectorAll<HTMLElement>('[data-dash-col]')).map((el) => ({
      id: el.getAttribute('data-dash-col') || '',
      rect: el.getBoundingClientRect(),
      cards: Array.from(el.querySelectorAll<HTMLElement>('[data-dash-card]')).map((c) => ({ id: c.getAttribute('data-dash-card') || '', rect: c.getBoundingClientRect() })),
    }));
  };

  const beginCardDrag = (e: ReactPointerEvent, card: KanbanCard) => {
    if (!onMoveCard) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    beginPointerDrag(e, {
      onStart: () => setDrag({ id: card.id, fromCol: card.col, x: startX, y: startY, offX: startX - rect.left, offY: startY - rect.top, w: rect.width, h: rect.height, target: null }),
      onMove: (ev) => {
        const target = dropTargetAt(columnHits(), ev.clientX, ev.clientY, card.id);
        setDrag((prev) => (prev ? { ...prev, x: ev.clientX, y: ev.clientY, target } : prev));
        // 화면 밖 열·카드로도 끌고 갈 수 있게 가장자리에서 스크롤한다(에디터와 같은 규칙).
        const board = boardRef.current;
        if (!board) return;
        const br = board.getBoundingClientRect();
        const dx = edgeScroll(ev.clientX, br.left, br.right);
        if (dx) board.scrollLeft += dx;
        const listEl = target ? board.querySelector<HTMLElement>(`[data-dash-col="${target.colId}"] [data-dash-list]`) : null;
        if (listEl) {
          const cr = listEl.getBoundingClientRect();
          const dy = edgeScroll(ev.clientY, cr.top, cr.bottom, 44, 12);
          if (dy) listEl.scrollTop += dy;
        }
      },
      onDrop: (ev) => {
        const target = dropTargetAt(columnHits(), ev.clientX, ev.clientY, card.id);
        if (target) onMoveCard(card.id, target.colId, target.index);
      },
      onEnd: () => setDrag(null),
    });
  };

  const dragged = drag ? cardById(drag.id) : undefined;
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: boardSurface(th) }}>
      {/* 진행 바 — 에디터 보드 머리의 그 줄(완료부터 왼쪽에서, 열 색 그대로.
          남는 자리는 빈 트랙 = 아직 시작하지 않은 일). */}
      <div style={{ display: 'flex', height: 3, flexShrink: 0, overflow: 'hidden', background: track }} aria-hidden>
        {data.segments.map((seg, i) => (
          <span key={i} style={{ width: `${seg.pct}%`, background: seg.color, display: 'block' }} />
        ))}
      </div>
      {/* 열 줄 — 에디터 보드와 같은 배치(실제 폭의 열이 옆으로 늘어서고 넘치면
          가로 스크롤). 위젯이라고 열을 오그리면 그 순간 에디터와 다른 물건이 된다. */}
      <div ref={boardRef} data-dash-kanban-board style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'stretch', gap: 16, padding: '12px 14px 14px', overflowX: 'auto', overflowY: 'hidden', boxSizing: 'border-box' }}>
        {data.columns.map((col, i) => {
          // 끌고 있는 카드는 목록에서 빠지고, 놓일 자리에 같은 높이의 점선 상자가
          // 선다(에디터와 같은 모델) — 열이 그만큼 늘고 줄어 "여기 들어간다"가
          // 레이아웃으로 보인다.
          const mine = cardsInColumn(data.cards, col.id).filter((c) => c.id !== drag?.id);
          const slotAt = drag?.target?.colId === col.id ? Math.max(0, Math.min(drag.target.index, mine.length)) : null;
          const hot = slotAt !== null;
          const divider = innerLine(th);
          return (
            <section
              key={col.id}
              data-dash-col={col.id}
              data-drop-hot={hot || undefined}
              style={{
                flex: '0 0 auto',
                width: colW,
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
                alignSelf: 'flex-start',
                maxHeight: '100%',
                background: columnBg(col, th),
                border: `1px solid ${hot ? hexA(th.accent, 0.55) : th.border}`,
                borderRadius: 16,
                boxShadow: COL_SHADOW,
                boxSizing: 'border-box',
              }}
            >
              {/* 열 머리 — 에디터와 같은 구성(점·제목·카드 수). ＋/⋯은 편집 동작이라
                  위젯에는 없다(에디터의 읽기 전용 모드와 같은 얼굴). */}
              <header style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '13px 13px 11px', borderBottom: `1px solid ${divider}` }}>
                <span style={{ flex: '0 0 auto', width: 8, height: 8, borderRadius: 999, background: columnColor(col, i, th.palette), display: 'block' }} />
                <span style={{ flex: '1 1 auto', minWidth: 0, fontSize: 13.5, fontWeight: 700, color: th.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{col.title}</span>
                <span style={{ flex: '0 0 auto', minWidth: 22, height: 22, padding: '0 7px', borderRadius: 999, background: th.panel, color: th.subtext, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600 }}>{mine.length}</span>
              </header>
              <div data-dash-list style={{ flex: '0 1 auto', minHeight: 44, overflowY: 'auto', padding: 11, display: 'flex', flexDirection: 'column', gap: 9 }}>
                {mine.map((k, ci) => (
                  <Fragment key={k.id}>
                    {slotAt === ci && <DropSlot h={drag?.h} th={th} />}
                    <div
                      data-dash-card={k.id}
                      data-card-urgent={k.flagged ? k.id : undefined}
                      onPointerDown={(e) => {
                        if (!onMoveCard) return;
                        e.stopPropagation(); // 위젯 자체의 드래그(편집 모드 재배치)와 갈라 둔다
                        beginCardDrag(e, k);
                      }}
                      // 에디터의 카드와 **같은 클래스** — 호버 떠오름·누름 반응이 같다
                      // (규칙은 `kanbanCard.css`, 인라인 transition은 두지 않는다: 그걸
                      // 얹으면 transform 전이가 덮여 툭 바뀐다).
                      className="mf-kb-card"
                      style={{
                        ...cardBase(k, th, false),
                        position: 'relative',
                        userSelect: 'none',
                        touchAction: onMoveCard ? 'pan-y' : undefined, // 길게 누르기 전에는 손가락 스크롤이 산다
                        cursor: onMoveCard ? 'grab' : 'default',
                      }}
                    >
                      <CardFace card={k} theme={th} comments={comments[k.id] ?? 0} tags={data.tags} done={i === lastIdx} avatars={avatars} />
                    </div>
                  </Fragment>
                ))}
                {slotAt !== null && slotAt >= mine.length && <DropSlot h={drag?.h} th={th} />}
                {mine.length === 0 && !hot && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '22px 14px', borderRadius: 12, border: `1.5px dashed ${th.border}`, textAlign: 'center' }}>
                    {/* 에디터의 빈 열 상자와 같은 꼴 — 문구만 위젯의 것("추가해 보세요"는
                        여기서 할 수 없는 일이라 약속하지 않는다). */}
                    <span style={{ fontSize: 12.5, color: th.subtext }}>이 단계에 카드가 없어요.</span>
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
      {/* 손끝을 따라오는 고스트 — 에디터와 같은 얼굴·같은 기울기.
          **body 포털인 이유**: 위젯은 hover에서 `transform`으로 떠오르는데, 변형된
          조상은 `position: fixed`의 기준 상자가 된다 — 그대로 두면 고스트가 위젯 안에
          갇혀 손끝과 어긋난다. */}
      {drag && dragged &&
        createPortal(
          <div
            data-dash-card-ghost
            style={{
              ...cardBase(dragged, th, false),
              position: 'fixed',
              left: drag.x - drag.offX,
              top: drag.y - drag.offY,
              width: drag.w,
              border: `1px solid ${th.accent}`,
              // ⚠️ `borderLeft`를 따로 준다 — 스프레드로 들어온 `cardBase`의 `borderLeft`가
              // **`border`보다 뒤에** 적용돼(객체 키 순서) 왼쪽 변만 기본 테두리로 남았다
              // (제보: 카드 이동 중 좌측 경계선이 잘려 보인다). 긴급 카드의 붉은 3px는
              // 그 카드의 정체라 그대로 둔다.
              ...(dragged.flagged ? null : { borderLeft: `1px solid ${th.accent}` }),
              boxShadow: '0 8px 24px rgba(0,0,0,.18)',
              boxSizing: 'border-box',
              pointerEvents: 'none',
              opacity: 0.95,
              zIndex: 300,
              transform: 'rotate(1.5deg)',
            }}
          >
            <CardFace card={dragged} theme={th} comments={comments[dragged.id] ?? 0} tags={data.tags} done={data.columns.length > 0 && dragged.col === (data.columns[data.columns.length - 1] as KanbanColumn).id} avatars={avatars} />
          </div>,
          document.body,
        )}
    </div>
  );
}

/** 놓일 자리 — 에디터와 같은 점선 상자(높이 = 끌고 있는 카드). */
function DropSlot({ h, th }: { h?: number; th: Theme }) {
  return <div data-dash-drop-slot style={{ flex: '0 0 auto', height: h || 44, borderRadius: 12, border: `1.5px dashed ${hexA(th.accent, 0.75)}`, background: hexA(th.accent, 0.08), boxSizing: 'border-box' }} />;
}

/** 마인드맵·화이트보드 몸통 — 홈 카드와 같은 **실렌더**(`realPreview`). 실제 문서의
 * 좌표·도형·색·잉크가 그대로 축소되어, 위젯이 문서와 다르게 보일 길이 없다(제보).
 * 바탕도 같은 규칙 — **그 문서의 캔버스 배경**(`previewSurface`, 홈 카드와 한 함수). */
function SceneBody({ raw, hue, imageUrls }: { raw: string; hue: string; imageUrls?: Record<string, string> }) {
  const scene = realPreview(raw, hue, imageUrls);
  const surface = previewSurface(raw);
  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, background: surface?.bg ?? 'var(--mf-wash, var(--mf-bg))', overflow: 'hidden' }}>
      <div aria-hidden style={{ position: 'absolute', inset: 0, backgroundImage: `radial-gradient(${surface?.dot ?? 'var(--mf-dot-grid)'} 1px, transparent 1px)`, backgroundSize: '16px 16px' }} />
      <span data-dash-scene style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{scene ?? <span style={{ fontSize: 11.5, color: 'var(--mf-faint)' }}>내용이 아직 없어요</span>}</span>
    </div>
  );
}

/** 편집 모드의 크기 순환 버튼 — 누를 때마다 그 종류가 놓일 수 있는 다음 크기로
 * (디자인 onCycle). 정밀한 조절은 모서리 드래그가 맡는다(데스크톱).
 * `big` = 터치 타깃(30px — 칸반 카드 ✕·색 라벨 버튼과 같은 폰 크기 규칙). */
function EditSizeButton({ label, onClick, overlay = false, big = false }: { label: string; onClick: (e: MouseEvent) => void; overlay?: boolean; big?: boolean }) {
  return (
    <button
      type="button"
      className="btn"
      title="크기 바꾸기"
      data-dash-cycle
      onClick={onClick}
      style={{
        height: big ? 30 : 22,
        minWidth: big ? 34 : 24,
        padding: '0 6px',
        borderRadius: 7,
        border: '1px solid var(--mf-border)',
        background: overlay ? 'rgba(255,253,251,.94)' : 'var(--mf-bg)',
        color: 'var(--mf-subtext)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        ...META_MONO,
        fontSize: 8.5,
        fontWeight: 800,
        ...(overlay ? { backdropFilter: 'blur(6px)' } : null),
      }}
    >
      {label}
    </button>
  );
}

/** 편집 모드의 내리기 ✕ — 우클릭 메뉴의 "대시보드에서 내리기"와 같은 동작. */
function EditRemoveButton({ onClick, overlay = false, big = false }: { onClick: (e: MouseEvent) => void; overlay?: boolean; big?: boolean }) {
  return (
    <button
      type="button"
      className="btn"
      title="대시보드에서 내리기"
      aria-label="대시보드에서 내리기"
      data-dash-remove
      onClick={onClick}
      style={{
        width: big ? 30 : 22,
        height: big ? 30 : 22,
        borderRadius: 7,
        border: '1px solid var(--mf-border)',
        background: overlay ? 'rgba(255,253,251,.94)' : 'var(--mf-bg)',
        color: 'var(--mf-faint)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        ...(overlay ? { backdropFilter: 'blur(6px)' } : null),
      }}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
        <path d="M6 6l12 12M18 6 6 18" />
      </svg>
    </button>
  );
}

export { KIND_META };

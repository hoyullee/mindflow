// 칸반 화면 — 문서 종류 `'kanban'`의 전용 레이아웃(캔버스가 아니다).
//
// 마인드맵·화이트보드는 무한 캔버스 위에 좌표를 가진 물건들을 놓지만, 칸반은
// **열이 가로로 늘어선 고정 레이아웃**이다(사용자 선정): 팬/줌·미니맵·그리기가
// 없고 좌표 개념도 없어, 좁은 화면에서도 그대로 쓸 수 있다. 열이 많으면 가로로,
// 카드가 많으면 열 안에서 세로로 스크롤한다.
//
// 카드 순서는 카드 자신의 `pos` 필드다(코어 `kanban.ts`) — 배열로 들면 끊긴 채
// 두 사람이 카드를 옮길 때 한쪽 순서가 사라진다(#332의 교훈).
//
// 화면 구성은 디자인 원본(`Geurio 칸반보드.dc.html`)을 옮긴 것이다. 원본이 고정
// 표로 들고 있던 값(분류 색·담당 명단)은 규칙으로 바꿨다(`kanbanMeta.ts` 머리말).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { cardsInColumn } from '@mindflow/mindmap-core';
import type { KanbanCard, KanbanColumn, KanbanTag } from '@mindflow/mindmap-core';
import type { EditorController } from '../useEditorState';
import { hexA } from '../theme';
import type { Theme } from '../theme';
import { useIsMobile } from '../../../hooks/useMediaQuery';
import { CommentIcon } from './ToolbarMenus';
import { RichSpan, linkInk } from '../richSpans';
import { columnDropIndex, columnDropIndicator, dropIndicator, dropTargetAt, edgeScroll } from '../kanbanDrag';
import type { ColumnHit, DropTarget } from '../kanbanDrag';
import { boardProgress, cardMatches, columnColor, dueLabel, dueTone, initialOf, ownerLabel, tagColor } from '../kanbanMeta';
import type { KanbanView } from '../kanbanMeta';
import { colorForSeed } from '../../../collab/identity';
import { CardDetail } from './CardDetail';
import { KanbanList, KanbanTimeline } from './KanbanViews';

const COL_W = 308;
const COL_GAP = 16;
/** 좌상단 문서 칩(DocChip)이 떠 있는 자리 — 캔버스에서는 빈 공간 위였지만 칸반은
 * 좌상단부터 열이 시작되므로 그만큼 내려서 겹치지 않게 한다. */
const CHIP_CLEARANCE = 78;
/** 긴급 배지 — 테마와 무관한 경고색(어느 팔레트에서나 "위험"으로 읽혀야 한다). */
const URGENT = '#d9534f';
/** 놓일 자리를 가리키는 점선 상자의 높이(카드 한 장 남짓). */
const DROP_BOX_H = 44;

/** 마우스가 이만큼 움직여야 "끄는 것"으로 친다(클릭·더블클릭과 구분). */
const DRAG_THRESHOLD = 4;
/** 터치는 **길게 눌러야** 드래그가 시작된다 — 그래야 평범한 손가락 스크롤이 산다. */
const TOUCH_HOLD_MS = 320;

/** 열 머리를 끌고 있는 상태 — 카드와 달리 가로 자리만 정한다. */
interface ColDragState {
  id: string;
  x: number;
  offX: number;
  /** 잡은 열의 상단(화면 좌표) — 고스트가 원래 열 머리 높이에 그대로 놓이게. */
  top: number;
  w: number;
  title: string;
  index: number;
}

interface DragState {
  id: string;
  /** 화면 좌표(카드 고스트를 그리는 자리). */
  x: number;
  y: number;
  /** 잡은 지점과 카드 좌상단의 차이 — 고스트가 손가락 아래에서 튀지 않게. */
  offX: number;
  offY: number;
  w: number;
  text: string;
  target: DropTarget | null;
}

/**
 * 포인터 드래그의 공통 골격 — 카드와 열이 **같은 감각**으로 움직이도록 한 곳에 모았다.
 *
 * 마우스는 4px 문턱(클릭·더블클릭과 구분), 터치는 길게 누르기(그래야 평범한 손가락
 * 스크롤이 산다). 잡힌 뒤에는 비-passive `touchmove`를 막는다 — 그러지 않으면
 * 브라우저가 세로 스크롤을 가져가며 `pointercancel`을 쏘고 드래그가 통째로 풀린다
 * (`pointermove`의 preventDefault로는 밑에 깔린 터치 동작을 취소하지 못한다).
 * **취소는 이동이 아니다** — `onDrop`은 실제로 놓았을 때만 부른다.
 */
function beginPointerDrag(
  e: ReactPointerEvent,
  handlers: { onStart: () => void; onMove: (ev: PointerEvent) => void; onDrop: (ev: PointerEvent) => void; onEnd: () => void },
): void {
  const startX = e.clientX;
  const startY = e.clientY;
  const touch = e.pointerType === 'touch';
  let started = false;
  let holdTimer: ReturnType<typeof setTimeout> | null = null;

  const start = (): void => {
    started = true;
    handlers.onStart();
  };
  if (touch) holdTimer = setTimeout(start, TOUCH_HOLD_MS);

  const onMove = (ev: PointerEvent): void => {
    if (!started) {
      if (touch) {
        // 길게 누르기 전에 움직이면 스크롤 의도 — 드래그를 포기한다.
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 8) cleanup();
        return;
      }
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
      start();
    }
    ev.preventDefault();
    handlers.onMove(ev);
  };
  const onTouchMove = (ev: TouchEvent): void => {
    if (started && ev.cancelable) ev.preventDefault();
  };
  const onUp = (ev: PointerEvent): void => {
    const was = started;
    cleanup();
    if (was) handlers.onDrop(ev);
  };
  const onCancel = (): void => cleanup();
  function cleanup(): void {
    if (holdTimer) clearTimeout(holdTimer);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('touchmove', onTouchMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    handlers.onEnd();
  }
  window.addEventListener('pointermove', onMove, { passive: false });
  window.addEventListener('touchmove', onTouchMove, { passive: false });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
}

export function KanbanBoard({ controller, theme: th }: { controller: EditorController; theme: Theme }) {
  const isMobile = useIsMobile();
  const { columns, cards, readOnly } = controller;
  const boardRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;
  const [colDrag, setColDrag] = useState<ColDragState | null>(null);
  /** 카드 검색 — 화면에서만 거른다(문서는 그대로). */
  const [query, setQuery] = useState('');
  // 보기 모드는 컨트롤러가 들고 있다 — 보드 머리의 탭과 GNB 보기 메뉴가 같은 값을
  // 본다(문서가 아니라 보는 사람의 상태라는 점은 그대로).
  const view = controller.kanbanView;
  const setView = controller.setKanbanView;

  /** 지금 화면에 그려진 열·카드의 사각형 — 드롭 자리 계산의 입력(순수 부분은 `kanbanDrag.ts`). */
  const columnHits = useCallback((): ColumnHit[] => {
    const board = boardRef.current;
    if (!board) return [];
    return Array.from(board.querySelectorAll('[data-kanban-column]')).map((el) => ({
      id: el.getAttribute('data-kanban-column') as string,
      rect: el.getBoundingClientRect(),
      cards: Array.from(el.querySelectorAll('[data-kanban-card]')).map((c) => ({ id: c.getAttribute('data-kanban-card') as string, rect: c.getBoundingClientRect() })),
    }));
  }, []);

  /** 카드에서 드래그를 시작한다(공용 제스처 골격 — `beginPointerDrag`). */
  const beginCardDrag = useCallback(
    (e: ReactPointerEvent, card: KanbanCard) => {
      if (controller.readOnly) return;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const startX = e.clientX;
      const startY = e.clientY;
      beginPointerDrag(e, {
        onStart: () => {
          const st: DragState = { id: card.id, x: startX, y: startY, offX: startX - rect.left, offY: startY - rect.top, w: rect.width, text: card.text, target: null };
          setDrag(st);
          dragRef.current = st;
        },
        onMove: (ev) => {
          const hits = columnHits();
          const target = dropTargetAt(hits, ev.clientX, ev.clientY, card.id);
          setDrag((prev) => (prev ? { ...prev, x: ev.clientX, y: ev.clientY, target } : prev));
          // 화면 밖 열·카드로도 끌고 갈 수 있게 가장자리에서 스크롤한다.
          const board = boardRef.current;
          if (!board) return;
          const br = board.getBoundingClientRect();
          const dx = edgeScroll(ev.clientX, br.left, br.right);
          if (dx) board.scrollLeft += dx;
          const colEl = target ? board.querySelector(`[data-kanban-column="${target.colId}"] [data-kanban-list]`) : null;
          if (colEl) {
            const cr = colEl.getBoundingClientRect();
            const dy = edgeScroll(ev.clientY, cr.top, cr.bottom, 44, 12);
            if (dy) colEl.scrollTop += dy;
          }
        },
        onDrop: (ev) => {
          const target = dropTargetAt(columnHits(), ev.clientX, ev.clientY, card.id);
          if (target) controller.moveCardTo(card.id, target.colId, target.index);
        },
        onEnd: () => {
          setDrag(null);
          dragRef.current = null;
        },
      });
    },
    [columnHits, controller],
  );

  /** 열 머리에서 드래그를 시작한다 — 열 순서를 바꾼다. */
  const beginColumnDrag = useCallback(
    (e: ReactPointerEvent, col: KanbanColumn) => {
      if (controller.readOnly) return;
      // 머리 안의 버튼(＋·⋯)·제목 편집기에서 시작한 것은 드래그가 아니다.
      const t = e.target as HTMLElement;
      if (t.closest('[data-column-btn]') || t.closest('[data-column-title-edit]')) return;
      const section = (e.currentTarget as HTMLElement).closest('[data-kanban-column]') as HTMLElement | null;
      if (!section) return;
      const rect = section.getBoundingClientRect();
      const startX = e.clientX;
      beginPointerDrag(e, {
        onStart: () => setColDrag({ id: col.id, x: startX, offX: startX - rect.left, top: rect.top, w: rect.width, title: col.title, index: 0 }),
        onMove: (ev) => {
          const hits = columnHits();
          const index = columnDropIndex(hits, ev.clientX, col.id);
          setColDrag((prev) => (prev ? { ...prev, x: ev.clientX, index } : prev));
          const board = boardRef.current;
          if (!board) return;
          const br = board.getBoundingClientRect();
          const dx = edgeScroll(ev.clientX, br.left, br.right);
          if (dx) board.scrollLeft += dx;
        },
        onDrop: (ev) => controller.moveColumnTo(col.id, columnDropIndex(columnHits(), ev.clientX, col.id)),
        onEnd: () => setColDrag(null),
      });
    },
    [columnHits, controller],
  );

  const indicator = drag?.target ? dropIndicator(columnHits(), drag.target, drag.id) : null;
  const colIndicator = colDrag ? columnDropIndicator(columnHits(), colDrag.index, colDrag.id) : null;
  const progress = useMemo(() => boardProgress(columns, cards), [columns, cards]);
  const detailCard = controller.detailCardId ? cards.find((c) => c.id === controller.detailCardId) : undefined;
  const dragCard = drag ? cards.find((c) => c.id === drag.id) : undefined;

  return (
    <div
      data-kanban-root
      style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', minHeight: 0, background: th.appBg, paddingTop: CHIP_CLEARANCE, boxSizing: 'border-box' }}
    >
      <BoardBar
        theme={th}
        isMobile={isMobile}
        query={query}
        onQuery={setQuery}
        progress={progress}
        view={view}
        onView={setView}
        onComments={controller.canComment ? () => (controller.commentsOpen ? controller.closeComments() : controller.openComments()) : undefined}
      />

      {view === 'list' && <KanbanList controller={controller} theme={th} query={query} isMobile={isMobile} />}
      {view === 'timeline' && <KanbanTimeline controller={controller} theme={th} query={query} isMobile={isMobile} />}

      <div
        ref={boardRef}
        data-kanban-board
        onPointerDown={(e) => {
          // 빈 바닥을 누르면 선택 해제(캔버스의 배경 클릭과 같은 관례).
          if (e.target === e.currentTarget) controller.selectCard(null);
        }}
        style={{
          flex: '1 1 auto',
          minHeight: 0,
          display: view === 'board' ? 'flex' : 'none',
          alignItems: 'stretch',
          gap: COL_GAP,
          padding: isMobile ? '0 12px 14px' : '0 20px 18px',
          overflowX: 'auto',
          overflowY: 'hidden',
          boxSizing: 'border-box',
        }}
      >
        {columns.map((col, i) => (
          <Column
            key={col.id}
            col={col}
            index={i}
            cards={cardsInColumn(cards, col.id)}
            query={query}
            controller={controller}
            theme={th}
            isMobile={isMobile}
            onCardPointerDown={beginCardDrag}
            onHeaderPointerDown={beginColumnDrag}
            draggingId={drag?.id ?? null}
            dragging={colDrag?.id === col.id}
            dropTarget={drag?.target?.colId === col.id}
            done={i === columns.length - 1}
          />
        ))}
        {!readOnly && (
          <button
            type="button"
            data-add-column
            onClick={controller.addColumn}
            style={{
              flex: '0 0 auto',
              width: isMobile ? 232 : 264,
              alignSelf: 'flex-start',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              border: `1.5px dashed ${th.border}`,
              borderRadius: 16,
              background: 'transparent',
              color: th.subtext,
              fontFamily: 'inherit',
              cursor: 'pointer',
              padding: '22px 0',
            }}
          >
            <span style={{ width: 32, height: 32, borderRadius: 10, background: th.panel2, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              <PlusIcon size={16} />
            </span>
            <span style={{ fontSize: 13, fontWeight: 700 }}>열 추가</span>
            <span style={{ fontSize: 11.5, color: hexA(th.subtext, 0.8) }}>단계를 하나 더 만들어요</span>
          </button>
        )}
      </div>

      {/* 끌고 있는 열의 고스트(제목 알약)와 놓일 자리를 가리키는 세로 선. */}
      {colDrag && (
        <div
          data-kanban-col-ghost
          style={{ position: 'fixed', left: colDrag.x - colDrag.offX, top: colDrag.top, width: colDrag.w, padding: '10px 12px', borderRadius: 12, background: th.panel, border: `1px solid ${hexA(th.accent, 0.55)}`, boxShadow: '0 8px 24px rgba(0,0,0,.18)', fontSize: 13.5, fontWeight: 700, color: th.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', pointerEvents: 'none', opacity: 0.95, zIndex: 300 }}
        >
          {colDrag.title}
        </div>
      )}
      {colIndicator && (
        <div
          data-kanban-col-drop-line
          style={{
            position: 'fixed',
            left: colIndicator.left,
            top: colIndicator.top,
            height: colIndicator.height,
            // 카드 가이드 선과 같은 문법 — 얇고 옅게, 양끝이 스며든다.
            width: 2,
            borderRadius: 999,
            background: `linear-gradient(180deg, ${hexA(th.accent, 0)} 0%, ${hexA(th.accent, 0.5)} 8%, ${hexA(th.accent, 0.5)} 92%, ${hexA(th.accent, 0)} 100%)`,
            pointerEvents: 'none',
            zIndex: 299,
          }}
        />
      )}

      {/* 끌고 있는 카드의 고스트 + 삽입 위치 선 — 화면 좌표라 보드 스크롤과 무관하다. */}
      {/* 고스트 — **끌고 있는 카드와 같은 얼굴**(요청). 글자만 보여 주면 배지·기한·
          담당이 사라져 "무엇을 옮기는 중인지"가 흐려진다. */}
      {dragCard && drag && (
        <div
          data-kanban-ghost
          style={{
            ...cardBase(dragCard, th, false),
            position: 'fixed',
            left: drag.x - drag.offX,
            top: drag.y - drag.offY,
            width: drag.w,
            border: `1px solid ${th.accent}`,
            boxShadow: '0 8px 24px rgba(0,0,0,.18)',
            boxSizing: 'border-box',
            pointerEvents: 'none',
            opacity: 0.95,
            zIndex: 300,
            transform: 'rotate(1.5deg)',
          }}
        >
          <CardFace
            card={dragCard}
            theme={th}
            comments={controller.canComment ? (controller.commentCounts[dragCard.id] ?? 0) : 0}
            tags={controller.tags}
            done={columns.length > 0 && dragCard.col === (columns[columns.length - 1] as KanbanColumn).id}
          />
        </div>
      )}
      {/* 놓일 자리 — **점선 사각형**(요청·디자인 원본의 placeholder). 선 하나보다
          "여기 카드가 들어간다"가 또렷하다. 자리를 실제로 밀어내지 않고 겹쳐 그리는
          이유는 그래야 드래그 중 카드들의 사각형(히트 계산의 입력)이 흔들리지 않기
          때문이다. */}
      {indicator && (
        <div
          data-kanban-drop-line
          style={{
            position: 'fixed',
            left: indicator.left,
            top: indicator.top - DROP_BOX_H / 2,
            width: indicator.width,
            height: DROP_BOX_H,
            borderRadius: 12,
            border: `1.5px dashed ${hexA(th.accent, 0.75)}`,
            background: hexA(th.accent, 0.08),
            boxSizing: 'border-box',
            pointerEvents: 'none',
            zIndex: 299,
          }}
        />
      )}

      {detailCard && <CardDetail card={detailCard} controller={controller} theme={th} isMobile={isMobile} />}
    </div>
  );
}

/**
 * 보드 머리 줄 — 카드 검색과 진행률.
 *
 * 디자인 원본의 이 자리에는 제목·저장 상태·뷰 탭·필터도 있었다. 제목과 저장
 * 상태는 이 앱에서 이미 좌상단 문서 칩(DocChip)이 말하고 있어 겹쳐 두지 않았고,
 * 필터 버튼은 원본에도 동작이 없어(핸들러 없음) 두지 않았다 — 눌러도 아무 일
 * 없는 버튼은 없느니만 못하다.
 */
function BoardBar({
  theme: th,
  isMobile,
  query,
  onQuery,
  progress,
  view,
  onView,
  onComments,
}: {
  theme: Theme;
  isMobile: boolean;
  query: string;
  onQuery: (v: string) => void;
  progress: ReturnType<typeof boardProgress>;
  view: KanbanView;
  onView: (v: KanbanView) => void;
  /** 보드 전체 댓글 열기 — 댓글을 쓸 수 없는 문서(링크로 연 사람)에서는 없다. */
  onComments?: () => void;
}) {
  const tab = (v: KanbanView, label: string) => {
    const on = view === v;
    return (
      <button
        key={v}
        type="button"
        data-kanban-tab={v}
        aria-pressed={on}
        onClick={() => onView(v)}
        style={{
          padding: isMobile ? '8px 14px' : '5px 13px',
          borderRadius: 999,
          border: 0,
          fontSize: 12.5,
          fontWeight: 700,
          fontFamily: 'inherit',
          cursor: 'pointer',
          background: on ? th.panel : 'transparent',
          color: on ? th.text : th.subtext,
          boxShadow: on ? '0 2px 6px -4px rgba(0,0,0,.4)' : 'none',
        }}
      >
        {label}
      </button>
    );
  };
  return (
    <div data-kanban-bar style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 10, padding: isMobile ? '0 12px 12px' : '0 20px 14px' }}>
      {/* 디자인 원본과 같은 자리 — 오른쪽에 [검색][보기 탭] 한 묶음(요청). */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, height: isMobile ? 40 : 34, padding: '0 12px', borderRadius: 999, border: `1px solid ${th.border}`, background: th.panel, minWidth: 0, flex: isMobile ? '1 1 100%' : '0 0 auto', width: isMobile ? undefined : 200 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={th.subtext} strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            className="mf-edit"
            data-kanban-search
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation(); // 에디터 전역 단축키(Delete·Enter 등)와 겹치지 않게
              if (e.key === 'Escape') onQuery('');
            }}
            placeholder="카드 검색"
            aria-label="카드 검색"
            style={{ border: 0, outline: 'none', background: 'transparent', fontSize: 13, color: th.text, width: '100%', minWidth: 0, fontFamily: 'inherit' }}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: 3, borderRadius: 999, border: `1px solid ${th.border}`, background: th.panel2 }}>
          {tab('board', '보드')}
          {tab('list', '리스트')}
          {tab('timeline', '타임라인')}
        </div>
        {/* 보드 전체 댓글 — 칸반의 보기 메뉴는 세 보기만 담으므로(요청) 첫 댓글을
            남길 길을 여기 둔다. 카드의 논의는 카드 배지·상세가 맡는다. */}
        {onComments && (
          <button
            type="button"
            className="mf-ed-btn"
            data-kanban-comments
            onClick={onComments}
            title="보드 전체 댓글"
            aria-label="보드 전체 댓글"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: isMobile ? 40 : 34, height: isMobile ? 40 : 34, borderRadius: 999, border: `1px solid ${th.border}`, background: th.panel, color: th.subtext, cursor: 'pointer', padding: 0, flexShrink: 0 }}
          >
            <CommentIcon />
          </button>
        )}
      </div>
      {/* 진행률 — **마지막 열을 완료로 본다**(카드는 왼→오로 흐른다는 관례). */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div data-kanban-progress style={{ flex: '1 1 auto', height: 6, borderRadius: 999, background: th.border, overflow: 'hidden', display: 'flex' }}>
          <span data-progress-done style={{ width: `${progress.donePct}%`, background: th.accent, display: 'block' }} />
          <span data-progress-doing style={{ width: `${progress.doingPct}%`, background: hexA(th.accent, 0.4), display: 'block' }} />
        </div>
        <span data-progress-label title="마지막 열을 완료로 봅니다" style={{ flex: '0 0 auto', fontSize: 13, color: th.subtext, whiteSpace: 'nowrap' }}>
          {progress.label}
        </span>
      </div>
    </div>
  );
}

function PlusIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function Column({
  col,
  index,
  cards,
  query,
  controller,
  theme: th,
  isMobile,
  onCardPointerDown,
  onHeaderPointerDown,
  draggingId,
  dragging,
  dropTarget,
  done,
}: {
  col: KanbanColumn;
  index: number;
  cards: KanbanCard[];
  query: string;
  controller: EditorController;
  theme: Theme;
  isMobile: boolean;
  onCardPointerDown: (e: ReactPointerEvent, card: KanbanCard) => void;
  onHeaderPointerDown: (e: ReactPointerEvent, col: KanbanColumn) => void;
  draggingId: string | null;
  /** 이 열을 끌고 있는가 — 원본은 자리를 지키되 흐리게(카드와 같은 규칙). */
  dragging: boolean;
  /** 이 열이 지금 드롭 대상인가 — 비어 있어도 "여기 들어간다"를 보여 준다. */
  dropTarget: boolean;
  /** 마지막 열(완료)인가 — 지난 기한을 경고로 쓰지 않는다. */
  done: boolean;
}) {
  const [renaming, setRenaming] = useState(false);
  const [composing, setComposing] = useState(false);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const readOnly = controller.readOnly;
  const dot = columnColor(col, index, th.palette);
  const visible = query.trim() ? cards.filter((c) => cardMatches(c, query)) : cards;
  const empty = visible.length === 0 && !composing;

  const startCompose = (): void => {
    if (readOnly) return;
    setComposing(true);
  };

  return (
    <section
      data-kanban-column={col.id}
      style={{
        flex: '0 0 auto',
        width: isMobile ? 264 : COL_W,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        // 열은 **내용만큼만** 높다(요청) — 카드가 적은 열이 화면 끝까지 늘어나면
        // 어느 단계가 비었는지 한눈에 안 들어온다. 길어지면 화면 높이에서 멈추고
        // 열 안이 스크롤된다.
        alignSelf: 'flex-start',
        maxHeight: '100%',
        background: th.panel2,
        border: `1px solid ${dropTarget ? hexA(th.accent, 0.55) : th.border}`,
        borderRadius: 16,
        boxSizing: 'border-box',
        // 끌고 있는 원본은 자리를 지키되 흐리게 — 어디서 떠났는지 보인다(카드와 동일).
        opacity: dragging ? 0.4 : 1,
      }}
    >
      {/* 열 머리를 끌면 열 순서가 바뀐다. 제목 편집(더블클릭)·버튼과 같은 자리를
          쓰므로 카드와 같은 관례로 가른다: 마우스는 4px 문턱, 터치는 길게 누르기. */}
      <header
        data-column-head={col.id}
        onPointerDown={(e) => onHeaderPointerDown(e, col)}
        style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '13px 13px 11px', borderBottom: `1px solid ${th.border}`, cursor: readOnly ? 'default' : 'grab', touchAction: 'pan-y' }}
      >
        <span data-column-dot={col.id} style={{ flex: '0 0 auto', width: 8, height: 8, borderRadius: 999, background: dot, display: 'block' }} />
        {renaming ? (
          <ColumnTitleEdit
            title={col.title}
            theme={th}
            onCommit={(t) => {
              setRenaming(false);
              if (t.trim()) controller.renameColumn(col.id, t.trim());
            }}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <button
            type="button"
            data-column-title={col.id}
            onDoubleClick={() => !readOnly && setRenaming(true)}
            onClick={(e) => e.detail === 0 && !readOnly && setRenaming(true)} // 키보드 활성화
            style={{ flex: '1 1 auto', minWidth: 0, textAlign: 'left', border: 'none', background: 'transparent', padding: 0, fontFamily: 'inherit', fontSize: 13.5, fontWeight: 700, color: th.text, cursor: readOnly ? 'default' : 'text', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {col.title}
          </button>
        )}
        {/* 카드 수 — 사용자 선정: 수만 보여 주고 WIP 상한은 두지 않는다. */}
        <span
          data-column-count={col.id}
          style={{ flex: '0 0 auto', minWidth: 22, height: 22, padding: '0 7px', borderRadius: 999, background: th.panel, color: th.subtext, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600 }}
        >
          {cards.length}
        </span>
        {!readOnly && (
          <>
            <ColumnIconButton label="카드 추가" theme={th} isMobile={isMobile} data-add-card={col.id} onClick={startCompose}>
              <PlusIcon size={15} />
            </ColumnIconButton>
            <ColumnIconButton
              label={`${col.title} 열 메뉴`}
              theme={th}
              isMobile={isMobile}
              data-column-menu={col.id}
              onClick={(e) => {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setMenuAt((prev) => (prev ? null : { x: r.right, y: r.bottom + 6 }));
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <circle cx="5" cy="12" r="1.6" />
                <circle cx="12" cy="12" r="1.6" />
                <circle cx="19" cy="12" r="1.6" />
              </svg>
            </ColumnIconButton>
          </>
        )}
      </header>

      <div data-kanban-list style={{ flex: '0 1 auto', minHeight: 44, overflowY: 'auto', padding: 11, display: 'flex', flexDirection: 'column', gap: 9 }}>
        {visible.map((card) => (
          <Card key={card.id} card={card} controller={controller} theme={th} onPointerDown={onCardPointerDown} dragging={draggingId === card.id} done={done} />
        ))}

        {composing && !readOnly && (
          <CardComposer
            theme={th}
            onCancel={() => setComposing(false)}
            onSubmit={(text) => {
              setComposing(false);
              if (text.trim()) controller.addCard(col.id, text);
            }}
          />
        )}

        {empty && (
          <div
            data-column-empty={col.id}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, padding: '26px 14px', borderRadius: 12, border: `1.5px dashed ${th.border}`, textAlign: 'center' }}
          >
            <span style={{ width: 30, height: 30, borderRadius: 9, background: th.panel, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: th.subtext }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <rect x="4" y="4" width="16" height="16" rx="4" />
                <path d="M12 9v6M9 12h6" />
              </svg>
            </span>
            <span style={{ fontSize: 12.5, color: th.subtext }}>{query.trim() ? '검색 결과가 없어요.' : '이 단계에 들어갈 카드를 추가해 보세요.'}</span>
          </div>
        )}
      </div>

      {!readOnly && (
        <button
          type="button"
          data-add-card-foot={col.id}
          onClick={startCompose}
          style={{ display: 'flex', alignItems: 'center', gap: 7, width: '100%', padding: '11px 13px', border: 0, borderTop: `1px solid ${th.border}`, background: 'transparent', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', color: th.subtext, cursor: 'pointer', borderRadius: '0 0 16px 16px', textAlign: 'left', minHeight: isMobile ? 44 : undefined }}
        >
          <PlusIcon />
          카드 추가
        </button>
      )}

      {menuAt && (
        <ColumnMenu
          col={col}
          theme={th}
          at={menuAt}
          isMobile={isMobile}
          onRename={() => {
            setMenuAt(null);
            setRenaming(true);
          }}
          onColor={(c) => {
            setMenuAt(null);
            controller.setColumnColor(col.id, c);
          }}
          onDelete={() => {
            setMenuAt(null);
            controller.deleteColumn(col.id);
          }}
          onClose={() => setMenuAt(null)}
        />
      )}
    </section>
  );
}

function ColumnIconButton({
  label,
  theme: th,
  isMobile,
  onClick,
  children,
  ...rest
}: {
  label: string;
  theme: Theme;
  isMobile: boolean;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  children: React.ReactNode;
} & Record<`data-${string}`, string>) {
  return (
    <button
      type="button"
      data-column-btn
      aria-label={label}
      title={label}
      onClick={onClick}
      {...rest}
      style={{ flex: '0 0 auto', width: isMobile ? 32 : 26, height: isMobile ? 32 : 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 0, borderRadius: 8, background: 'transparent', color: th.subtext, cursor: 'pointer', padding: 0 }}
    >
      {children}
    </button>
  );
}

/**
 * 카드 만들기 — 열 안에 곧바로 뜨는 입력칸(디자인 원본의 composer).
 *
 * Enter=추가, Shift+Enter=줄바꿈, Esc=취소(도형·메모·카드 편집과 같은 규칙).
 */
function CardComposer({ theme: th, onSubmit, onCancel }: { theme: Theme; onSubmit: (text: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const [val, setVal] = useState('');
  useEffect(() => ref.current?.focus(), []);
  return (
    <div data-card-composer style={{ padding: 10, borderRadius: 12, background: th.panel, border: `1.5px solid ${th.accent}`, boxShadow: `0 12px 26px -20px ${hexA(th.accent, 0.7)}` }}>
      <textarea
        ref={ref}
        className="mf-edit"
        data-card-composer-input
        value={val}
        rows={2}
        placeholder="할 일을 적고 Enter"
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
          e.stopPropagation();
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onSubmit(e.currentTarget.value);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        style={{ width: '100%', border: 0, outline: 'none', resize: 'none', background: 'transparent', fontSize: 13.5, lineHeight: 1.5, color: th.text, fontFamily: 'inherit' }}
      />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 6 }}>
        <span style={{ fontSize: 10.5, color: th.subtext }}>Esc 취소</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            data-composer-cancel
            onClick={onCancel}
            style={{ height: 28, padding: '0 11px', borderRadius: 8, border: `1px solid ${th.border}`, background: th.panel, fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit', color: th.subtext, cursor: 'pointer' }}
          >
            취소
          </button>
          <button
            type="button"
            data-composer-submit
            onClick={() => onSubmit(val)}
            style={{ height: 28, padding: '0 13px', borderRadius: 8, border: `1px solid ${th.accent}`, background: th.accent, fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit', color: th.accentInk, cursor: 'pointer' }}
          >
            추가
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 카드 한 장의 **얼굴** — 분류·긴급 배지 / 본문 / 기한·댓글·담당.
 *
 * 카드 자신과 **드래그 고스트**가 같은 것을 그리도록 떼어 냈다(요청: "고스트를
 * 현재 모양과 정보를 동일하게"). 곁정보는 **비어 있어도 자리를 지킨다** — 값이
 * 없으면 "날짜 없음"·0·점선 아바타로 그려서(요청·디자인 원본) 카드마다 높이가
 * 들쭉날쭉하지 않고, 무엇을 아직 안 정했는지도 보인다.
 */
export function CardFace({ card, theme: th, comments, tags, done }: { card: KanbanCard; theme: Theme; comments: number; tags: KanbanTag[]; done?: boolean }) {
  const owner = ownerLabel(card);
  // 마지막 열(완료)의 카드는 기한이 지나도 붉게 쓰지 않는다 — 끝난 일이다
  // (리스트·타임라인과 같은 규칙).
  const tone = card.due && !done ? dueTone(card.due) : 'normal';
  return (
    <>
      {(card.tag || card.flagged) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
          {card.tag && <TagBadge name={card.tag} theme={th} tags={tags} />}
          {card.flagged && (
            <span
              data-card-urgent={card.id}
              style={{ height: 20, padding: '0 7px', borderRadius: 6, background: hexA(URGENT, 0.14), color: URGENT, display: 'inline-flex', alignItems: 'center', fontSize: 10.5, fontWeight: 700 }}
            >
              긴급
            </span>
          )}
        </div>
      )}

      <p style={{ margin: 0, fontSize: 13.8, lineHeight: 1.5, fontWeight: 600, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {card.text ? <CardText card={card} /> : <span style={{ color: th.subtext, fontWeight: 500 }}>빈 카드</span>}
      </p>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 11 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11.5, color: th.subtext, minWidth: 0 }}>
          <span data-card-due={card.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: tone === 'over' ? URGENT : tone === 'soon' ? th.accent : th.subtext, fontWeight: tone === 'normal' ? 500 : 700 }}>
            <CalendarGlyph />
            {card.due ? dueLabel(card.due) : '날짜 없음'}
          </span>
          <span data-card-comment-count={card.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <CommentIcon />
            {comments}
          </span>
        </div>
        {owner ? <Avatar name={owner} email={card.owner ?? owner} size={24} /> : <NoOwnerGlyph theme={th} />}
      </div>
    </>
  );
}

/** 담당이 없을 때의 자리 — 점선 원 안의 사람 실루엣(비었음을 그린다). */
function NoOwnerGlyph({ theme: th }: { theme: Theme }) {
  return (
    <span
      data-card-no-owner
      role="img"
      aria-label="담당 없음"
      title="담당 없음"
      style={{ width: 24, height: 24, borderRadius: 999, border: `1.5px dashed ${th.border}`, color: th.subtext, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxSizing: 'border-box' }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    </span>
  );
}

function CalendarGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M8 3v4M16 3v4M3 11h18" />
    </svg>
  );
}

/** 카드 배경 계열 — 카드와 고스트가 같은 값을 쓰도록 한 곳에. */
function cardBase(card: KanbanCard, th: Theme, selected: boolean): CSSProperties {
  const base: CSSProperties = {
    background: card.bg || th.panel,
    border: `1px solid ${selected ? th.accent : th.border}`,
    boxShadow: selected ? `0 0 0 2px ${hexA(th.accent, 0.2)}` : '0 1px 2px rgba(0,0,0,.05)',
    borderRadius: 12,
    padding: '12px 12px 11px',
    color: th.text,
  };
  // 링크 잉크 — 커밋된 렌더(`RichSpan`)가 읽는 변수. 값은 **배경이 아니라 글자색**
  // 밝기에서 고른다(글자색은 이미 "이 배경에서 읽히도록" 정해진 값이다).
  (base as Record<string, unknown>)['--mf-link'] = linkInk(base.color as string | undefined);
  return base;
}

function Card({ card, controller, theme: th, onPointerDown, dragging, done }: { card: KanbanCard; controller: EditorController; theme: Theme; onPointerDown: (e: ReactPointerEvent, card: KanbanCard) => void; dragging: boolean; done?: boolean }) {
  const selected = controller.selectedCardId === card.id;
  const comments = controller.canComment ? (controller.commentCounts[card.id] ?? 0) : 0;
  return (
    <div
      data-kanban-card={card.id}
      data-selected={selected ? '1' : undefined}
      onPointerDown={(e) => {
        controller.selectCard(card.id);
        onPointerDown(e, card);
      }}
      // 카드를 두 번 누르면 상세가 열린다 — 제목과 곁정보(분류·기한·담당·긴급)를
      // 한자리에서 고친다(디자인 원본의 `card.onOpen`, 다른 칸반 앱들과 같은 관례).
      // 카드 위 빠른 동작(‹ › ✕)은 없앴다(요청) — 그 셋 다 상세에 있다.
      onDoubleClick={() => controller.openCardDetail(card.id)}
      style={{
        ...cardBase(card, th, selected),
        position: 'relative',
        cursor: 'pointer',
        userSelect: 'none',
        // 끌고 있는 원본은 자리를 지키되 흐리게 — 어디서 떠났는지 보인다.
        opacity: dragging ? 0.35 : 1,
        // 터치: 세로 스크롤은 살리고(길게 눌러야 드래그) 가로 제스처만 막는다.
        touchAction: 'pan-y',
      }}
    >
      <CardFace card={card} theme={th} comments={comments} tags={controller.tags} done={done} />
    </div>
  );
}

export function TagBadge({ name, theme: th, tags = [] }: { name: string; theme: Theme; tags?: KanbanTag[] }) {
  const c = tagColor(name, th.palette, tags);
  return (
    <span
      data-card-tag={name}
      style={{ height: 20, padding: '0 8px', borderRadius: 6, background: hexA(c, 0.16), color: c, display: 'inline-flex', alignItems: 'center', fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap' }}
    >
      {name}
    </span>
  );
}

/** 담당 아바타 — 색은 **접속자 커서와 같은 시드**라 같은 사람이 같은 색이다. */
export function Avatar({ name, email, size = 24, ring }: { name: string; email: string; size?: number; ring?: string }) {
  const bg = colorForSeed(email || name);
  return (
    <span
      data-avatar={email || name}
      title={name}
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        background: bg,
        color: '#fff',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.44,
        fontWeight: 700,
        flexShrink: 0,
        boxSizing: 'border-box',
        border: ring ? `2px solid ${ring}` : undefined,
      }}
    >
      {initialOf(name)}
    </span>
  );
}

function ColumnTitleEdit({ title, theme: th, onCommit, onCancel }: { title: string; theme: Theme; onCommit: (t: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLInputElement | null>(null);
  const [val, setVal] = useState(title);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      className="mf-edit"
      data-column-title-edit
      value={val}
      maxLength={40}
      onChange={(e) => setVal(e.target.value)}
      onBlur={() => onCommit(val)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.nativeEvent.isComposing) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          onCommit(e.currentTarget.value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
      style={{ flex: '1 1 auto', minWidth: 0, border: `1.5px solid ${th.accent}`, borderRadius: 7, background: th.panel, color: th.text, fontSize: 13.5, fontWeight: 700, fontFamily: 'inherit', padding: '3px 7px', outline: 'none' }}
    />
  );
}

/**
 * 열 메뉴 — 이름 변경 · 색 · 삭제.
 *
 * `position: fixed`인 이유는 카드 색 판과 같다: 열은 세로로 스크롤되는 상자 안에
 * 있어 흐름에 두면 잘린다. 바깥을 누르거나 Esc로 닫힌다.
 */
function ColumnMenu({
  col,
  theme: th,
  at,
  isMobile,
  onRename,
  onColor,
  onDelete,
  onClose,
}: {
  col: KanbanColumn;
  theme: Theme;
  at: { x: number; y: number };
  isMobile: boolean;
  onRename: () => void;
  onColor: (c: string | null) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  const W = 196;
  const left = Math.max(8, Math.min(at.x - W, window.innerWidth - W - 8));
  const row: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    minHeight: isMobile ? 44 : 34,
    padding: '0 10px',
    border: 0,
    borderRadius: 8,
    background: 'transparent',
    color: th.text,
    fontSize: 13,
    fontFamily: 'inherit',
    cursor: 'pointer',
    textAlign: 'left',
  };
  return (
    <div
      ref={ref}
      data-column-menu-pop={col.id}
      role="menu"
      aria-label={`${col.title} 열 메뉴`}
      style={{ position: 'fixed', left, top: at.y, width: W, boxSizing: 'border-box', padding: 6, background: th.panel, border: `1px solid ${th.border}`, borderRadius: 12, boxShadow: '0 10px 28px rgba(0,0,0,.16)', zIndex: 320 }}
    >
      <button type="button" role="menuitem" data-column-rename onClick={onRename} style={row}>
        이름 변경
      </button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 10px', flexWrap: 'wrap' }}>
        <button
          type="button"
          role="menuitem"
          data-column-color="default"
          aria-label="기본 색"
          title="기본 색"
          onClick={() => onColor(null)}
          style={{ width: 18, height: 18, borderRadius: 999, border: `1px solid ${th.border}`, background: 'transparent', backgroundImage: `linear-gradient(to top right, transparent calc(50% - 1px), ${th.subtext} calc(50% - 1px), ${th.subtext} calc(50% + 1px), transparent calc(50% + 1px))`, cursor: 'pointer', padding: 0 }}
        />
        {th.palette.slice(0, 8).map((c) => (
          <button
            key={c}
            type="button"
            role="menuitem"
            data-column-color={c}
            aria-label={`색 ${c}`}
            title={`색 ${c}`}
            onClick={() => onColor(c)}
            style={{ width: 18, height: 18, borderRadius: 999, background: c, border: col.color === c ? `2px solid ${th.text}` : `1px solid ${hexA(th.text, 0.15)}`, cursor: 'pointer', padding: 0 }}
          />
        ))}
      </div>
      <button type="button" role="menuitem" data-delete-column={col.id} onClick={onDelete} style={{ ...row, color: URGENT }}>
        열 삭제
      </button>
    </div>
  );
}

/**
 * 카드 본문 — 부분 서식(`rich`)이 있으면 런마다 그린다.
 *
 * 서식은 확정할 때 마크다운 단축·자동 링크로 만들어진다(`commitCardText`).
 * 렌더는 주제·메모와 **같은 `RichSpan`**을 쓰므로 굵게·기울임·취소선·색·링크가
 * 한 규칙으로 보인다(링크 파랑은 `--mf-link` 파이프라인 — 카드가 값을 내려 준다).
 */
export function CardText({ card }: { card: KanbanCard }) {
  if (!card.rich || !card.rich.length) return <>{card.text}</>;
  return (
    <>
      {card.rich.map((r, i) => (
        <RichSpan key={i} seg={r}>
          {r.t}
        </RichSpan>
      ))}
    </>
  );
}

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
import { hexA, mixHex } from '../theme';
import type { Theme } from '../theme';
import { useIsMobile } from '../../../hooks/useMediaQuery';
import { CommentIcon, MenuDivider, MenuSectionLabel } from './ToolbarMenus';
import { RichSpan, linkInk } from '../richSpans';
import { columnDropIndex, dropTargetAt, edgeScroll } from '../kanbanDrag';
import type { ColumnHit, DropTarget } from '../kanbanDrag';
import { EMPTY_FILTER, boardProgress, cardPasses, columnColor, dueLabel, dueTone, filterActive, initialOf, ownerLabel, ownerOptions, tagColor } from '../kanbanMeta';
import type { CardFilter, KanbanView } from '../kanbanMeta';
import { colorForSeed } from '../../../collab/identity';
import { CardDetail } from './CardDetail';
import { KanbanList, KanbanTimeline } from './KanbanViews';

const COL_W = 308;
const COL_GAP = 16;
/** 좌상단 문서 칩(DocChip)이 차지하는 띠 — `left:16, top:16`에 높이 약 54px. */
const CHIP_TOP = 16;
const CHIP_H = 54;
/** 칩 오른쪽으로 비워 두는 폭(칩 236 + 여백) — 이 띠에 함께 서는 도구 줄이 칩을
 * 덮지 않게. 좁아지면 도구 줄은 칩 아래로 내려간다(모바일). */
const CHIP_RESERVE = 236 + CHIP_TOP + 16;
/** 모바일에서 칩 아래로 내려설 때의 위 여백. */
const CHIP_CLEARANCE = 78;
/** 열 상자의 그림자 — 배경에서 또렷이 갈리게(디자인 원본). 열 추가 타일도 같은 값. */
const COL_SHADOW = '0 18px 40px -34px rgba(46,42,38,.4)';
/** 긴급 배지 — 테마와 무관한 경고색(어느 팔레트에서나 "위험"으로 읽혀야 한다). */
const URGENT = '#d9534f';

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
  /** 잡은 열의 높이 — 비워 둔 자리(점선 상자)를 **실제 열 크기**로 그린다. */
  h: number;
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
  /** 잡은 카드의 높이 — 놓일 자리(점선 상자)를 **실제 카드 크기**로 그린다(요청). */
  h: number;
  text: string;
  /** 원래 자리 — 아직 어디에도 겨누지 않았을 때 그 자리에 빈칸을 남긴다. */
  fromCol: string;
  fromIndex: number;
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
  /** 필터(담당·분류·긴급) — 검색어와 같은 성격이라 함께 화면에서만 거른다. */
  const [filter, setFilter] = useState<CardFilter>(EMPTY_FILTER);
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
      const fromIndex = cardsInColumn(controller.cards, card.col).findIndex((c) => c.id === card.id);
      beginPointerDrag(e, {
        onStart: () => {
          const st: DragState = { id: card.id, x: startX, y: startY, offX: startX - rect.left, offY: startY - rect.top, w: rect.width, h: rect.height, text: card.text, fromCol: card.col, fromIndex: Math.max(0, fromIndex), target: null };
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
        onStart: () => setColDrag({ id: col.id, x: startX, offX: startX - rect.left, top: rect.top, w: rect.width, h: rect.height, index: Math.max(0, controller.columns.findIndex((c) => c.id === col.id)) }),
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

  // 놓일 자리 — 아직 어디에도 겨누지 않았으면 **원래 자리**에 빈칸을 남긴다
  // (그래야 끄는 동안 열들이 들썩이지 않는다).
  const dropAt: DropTarget | null = drag ? (drag.target ?? { colId: drag.fromCol, index: drag.fromIndex }) : null;
  const progress = useMemo(() => boardProgress(columns, cards, th.palette), [columns, cards, th.palette]);
  const detailCard = controller.detailCardId ? cards.find((c) => c.id === controller.detailCardId) : undefined;
  const dragCard = drag ? cards.find((c) => c.id === drag.id) : undefined;
  const dragCol = colDrag ? columns.find((c) => c.id === colDrag.id) : undefined;

  /** 그릴 열 차례 — 끌고 있는 열은 **빼고**, 놓일 자리에 같은 크기의 점선 상자를
   *  끼운다(카드와 같은 규칙 — 요청). 히트 계산은 `[data-kanban-column]`만 보므로
   *  이 상자는 자동으로 빠지고, `columnDropIndex`가 받는 좌표계와도 어긋나지 않는다. */
  const colRendered: ({ kind: 'col'; col: KanbanColumn; index: number } | { kind: 'gap' })[] = columns
    .map((col, index) => ({ kind: 'col' as const, col, index }))
    .filter((it) => it.col.id !== colDrag?.id);
  if (colDrag) colRendered.splice(Math.max(0, Math.min(colDrag.index, colRendered.length)), 0, { kind: 'gap' });

  /** 화면에 보이는 카드 수 / 전체 — 필터 패널이 "8 / 8개 카드 표시 중"으로 알린다. */
  const shown = cards.filter((c) => cardPasses(c, query, filter)).length;

  return (
    <div
      data-kanban-root
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        // 바닥은 앱 배경을 패널 쪽으로 살짝 민 색 — 디자인 원본의 `#FDFAF7`처럼
        // 열(패널)보다 **한 톤 더 옅다**(제보: 지금은 너무 진하다). 값을 테마마다
        // 새로 적지 않고 관계로 만들어 다크·화이트에서도 같은 방향으로 성립한다.
        background: mixHex(th.appBg, th.panel, 0.55),
        paddingTop: isMobile ? CHIP_CLEARANCE : CHIP_TOP,
        boxSizing: 'border-box',
      }}
    >
      <BoardBar
        theme={th}
        isMobile={isMobile}
        query={query}
        onQuery={setQuery}
        progress={progress}
        view={view}
        onView={setView}
        filter={filter}
        onFilter={setFilter}
        owners={ownerOptions(cards)}
        tags={controller.tags}
        shown={shown}
        total={cards.length}
      />

      {view === 'list' && <KanbanList controller={controller} theme={th} query={query} filter={filter} isMobile={isMobile} />}
      {view === 'timeline' && <KanbanTimeline controller={controller} theme={th} query={query} filter={filter} isMobile={isMobile} />}

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
        {colRendered.map((item) =>
          item.kind === 'gap' ? (
            <div
              key="col-gap"
              data-kanban-col-slot
              style={{ flex: '0 0 auto', width: isMobile ? 264 : COL_W, height: colDrag?.h, alignSelf: 'flex-start', borderRadius: 16, border: `1.5px dashed ${hexA(th.accent, 0.75)}`, background: hexA(th.accent, 0.08), boxSizing: 'border-box' }}
            />
          ) : (
            <Column
              key={item.col.id}
              col={item.col}
              index={item.index}
              cards={cardsInColumn(cards, item.col.id)}
              query={query}
              filter={filter}
              controller={controller}
              theme={th}
              isMobile={isMobile}
              onCardPointerDown={beginCardDrag}
              onHeaderPointerDown={beginColumnDrag}
              draggingId={drag?.id ?? null}
              dropTarget={drag?.target?.colId === item.col.id}
              dropIndex={dropAt?.colId === item.col.id ? dropAt.index : null}
              dropHeight={drag?.h ?? 0}
              done={item.index === columns.length - 1}
            />
          ),
        )}
        {!readOnly && (
          <button
            type="button"
            className="mf-ed-btn"
            data-add-column
            onClick={controller.addColumn}
            style={{
              flex: '0 0 auto',
              width: isMobile ? 232 : 264,
              // 디자인 원본은 이 타일을 띠 전체 높이로 늘린다(`align-self: stretch`)
              // — 열보다 짧으면 "여기에 열이 하나 더 선다"로 읽히지 않는다(요청).
              alignSelf: 'stretch',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              border: `1.5px dashed ${th.border}`,
              borderRadius: 16,
              background: 'transparent',
              // 열과 같은 그림자 — 점선 타일이 바닥에 묻히지 않게(요청).
              boxShadow: COL_SHADOW,
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

      {/* 끌고 있는 열의 고스트 — **카드와 같은 규칙**(요청): 원본은 목록에서 빠지고
          그 자리에 같은 크기의 점선 상자가, 손끝에는 열의 얼굴(머리 + 카드들)이
          따라온다. 글자 알약만 떠 있으면 무엇을 옮기는 중인지 흐려진다. */}
      {colDrag && dragCol && (
        <div
          data-kanban-col-ghost={dragCol.id}
          style={{
            position: 'fixed',
            left: colDrag.x - colDrag.offX,
            top: colDrag.top,
            width: colDrag.w,
            maxHeight: Math.min(colDrag.h, 360),
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            background: th.panel2,
            border: `1px solid ${th.accent}`,
            borderRadius: 16,
            boxShadow: '0 8px 24px rgba(0,0,0,.18)',
            boxSizing: 'border-box',
            pointerEvents: 'none',
            opacity: 0.95,
            zIndex: 300,
            transform: 'rotate(1.5deg)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '13px 13px 11px', borderBottom: `1px solid ${th.border}` }}>
            <span style={{ flex: '0 0 auto', width: 8, height: 8, borderRadius: 999, background: columnColor(dragCol, colDrag.index, th.palette), display: 'block' }} />
            <span style={{ flex: '1 1 auto', minWidth: 0, fontSize: 13.5, fontWeight: 700, color: th.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dragCol.title}</span>
            <span style={{ flex: '0 0 auto', minWidth: 22, height: 22, padding: '0 7px', borderRadius: 999, background: th.panel, color: th.subtext, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600 }}>
              {cardsInColumn(cards, dragCol.id).length}
            </span>
          </div>
          <div style={{ padding: 11, display: 'flex', flexDirection: 'column', gap: 9 }}>
            {cardsInColumn(cards, dragCol.id)
              .filter((c) => cardPasses(c, query, filter))
              .slice(0, 4)
              .map((c) => (
                <div key={c.id} style={cardBase(c, th, false)}>
                  <CardFace card={c} theme={th} comments={controller.canComment ? (controller.commentCounts[c.id] ?? 0) : 0} tags={controller.tags} done={colDrag.index === columns.length - 1} />
                </div>
              ))}
          </div>
        </div>
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
      {detailCard && <CardDetail card={detailCard} controller={controller} theme={th} isMobile={isMobile} />}
    </div>
  );
}

/**
 * 보드 머리 줄 — 검색 · 보기 탭 · 필터, 그리고 진행률.
 *
 * 디자인 원본의 이 자리에는 제목·저장 상태도 있었지만 이 앱에서는 좌상단 문서
 * 칩(DocChip)이 이미 말하고 있어 겹쳐 두지 않았다. 대신 도구 줄이 **그 칩과 같은
 * 선**에 서므로(요청) 위쪽 한 띠에 문서 상태와 도구가 나란히 놓인다.
 */
function BoardBar({
  theme: th,
  isMobile,
  query,
  onQuery,
  progress,
  view,
  onView,
  filter,
  onFilter,
  owners,
  tags,
  shown,
  total,
}: {
  theme: Theme;
  isMobile: boolean;
  query: string;
  onQuery: (v: string) => void;
  progress: ReturnType<typeof boardProgress>;
  view: KanbanView;
  onView: (v: KanbanView) => void;
  filter: CardFilter;
  onFilter: (f: CardFilter) => void;
  owners: { key: string; name: string }[];
  tags: KanbanTag[];
  shown: number;
  total: number;
}) {
  const [filterOpen, setFilterOpen] = useState(false);
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
      {/* 데스크톱에서는 좌상단 문서 칩과 **같은 선**에 선다(요청) — 칩은 떠 있는
          오버레이라 자리를 차지하지 않으므로, 그 폭만큼 왼쪽을 비워 두고 오른쪽
          끝에 [검색][보기 탭][필터]를 묶는다. 모바일은 폭이 모자라 칩 아래로. */}
      <div
        data-kanban-actions
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          justifyContent: 'flex-end',
          flexWrap: 'wrap',
          minHeight: isMobile ? undefined : CHIP_H,
          paddingLeft: isMobile ? 0 : CHIP_RESERVE,
        }}
      >
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
        {/* 필터 — 디자인 원본의 자리. 원본에는 동작이 없던 버튼이라 그동안 두지
            않았는데, 이제 담당·분류·긴급으로 실제로 좁힌다(요청). */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button
            type="button"
            className="mf-ed-btn"
            data-kanban-filter
            aria-expanded={filterOpen}
            onClick={() => setFilterOpen((v) => !v)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              height: isMobile ? 40 : 34,
              padding: '0 12px',
              borderRadius: 999,
              border: `1px solid ${filterActive(filter) ? th.accent : th.border}`,
              background: filterActive(filter) ? hexA(th.accent, 0.12) : th.panel,
              color: filterActive(filter) ? th.accent : th.subtext,
              fontSize: 13,
              fontWeight: 600,
              fontFamily: 'inherit',
              cursor: 'pointer',
            }}
          >
            <FilterGlyph />
            필터
          </button>
          {filterOpen && (
            <FilterPanel
              theme={th}
              isMobile={isMobile}
              filter={filter}
              onFilter={onFilter}
              owners={owners}
              tags={tags}
              shown={shown}
              total={total}
              onClose={() => setFilterOpen(false)}
            />
          )}
        </div>
      </div>
      {/* 진행률 — **마지막 열을 완료로 본다**(카드는 왼→오로 흐른다는 관례). */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* 열별 구간 — 각 열의 카드 비율만큼 **그 열의 색**으로(요청). 열 색을
            바꾸면 여기도 함께 바뀌므로 "무엇이 어느 단계에 몰려 있는가"가 한 줄로 보인다. */}
        <div data-kanban-progress style={{ flex: '1 1 auto', height: 6, borderRadius: 999, background: th.border, overflow: 'hidden', display: 'flex' }}>
          {progress.segments.map((seg) => (
            <span
              key={seg.id}
              data-progress-seg={seg.id}
              title={`${seg.title} ${seg.count}장`}
              style={{ width: `${seg.pct}%`, background: seg.color, display: 'block' }}
            />
          ))}
        </div>
        <span data-progress-label title="마지막 열을 완료로 봅니다" style={{ flex: '0 0 auto', fontSize: 13, color: th.subtext, whiteSpace: 'nowrap' }}>
          {progress.label}
        </span>
      </div>
    </div>
  );
}

function FilterGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M4 7h16M7 12h10M10 17h4" />
    </svg>
  );
}

/**
 * 필터 패널 — 담당 · 분류 · 긴급만 보기(디자인 원본의 구성).
 *
 * 후보는 **지금 이 보드에 실제로 있는 것**만 담는다: 담당은 카드에 적힌 사람,
 * 분류는 문서의 분류 목록. 고를 것이 없으면 그 구획을 아예 그리지 않는다 —
 * 눌러도 결과가 없는 칩은 없느니만 못하다.
 *
 * `position: absolute`인 이유는 열 메뉴·색 판과 같다(스크롤되는 상자 밖으로
 * 벗어나야 한다). 바깥을 누르거나 Esc로 닫힌다.
 */
function FilterPanel({
  theme: th,
  isMobile,
  filter,
  onFilter,
  owners,
  tags,
  shown,
  total,
  onClose,
}: {
  theme: Theme;
  isMobile: boolean;
  filter: CardFilter;
  onFilter: (f: CardFilter) => void;
  owners: { key: string; name: string }[];
  tags: KanbanTag[];
  shown: number;
  total: number;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent): void => {
      const t = e.target as HTMLElement;
      if (!ref.current?.contains(t) && !t.closest('[data-kanban-filter]')) onClose();
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

  const toggle = (list: string[], v: string): string[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const label: CSSProperties = { fontSize: 11.5, fontWeight: 700, color: th.subtext, margin: '2px 0 7px' };
  const chip = (on: boolean): CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: isMobile ? 34 : 28,
    padding: '0 10px 0 6px',
    borderRadius: 999,
    border: `1px solid ${on ? th.accent : th.border}`,
    background: on ? hexA(th.accent, 0.12) : th.panel,
    color: th.text,
    fontSize: 12.5,
    fontWeight: 600,
    fontFamily: 'inherit',
    cursor: 'pointer',
  });

  return (
    <div
      ref={ref}
      data-kanban-filter-panel
      role="dialog"
      aria-label="필터"
      style={{ position: 'absolute', right: 0, top: 'calc(100% + 8px)', width: 268, boxSizing: 'border-box', padding: 14, background: th.panel, border: `1px solid ${th.border}`, borderRadius: 14, boxShadow: '0 14px 34px rgba(0,0,0,.16)', zIndex: 320, textAlign: 'left' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <strong style={{ fontSize: 13.5, color: th.text }}>필터</strong>
        <button
          type="button"
          data-filter-reset
          onClick={() => onFilter(EMPTY_FILTER)}
          disabled={!filterActive(filter)}
          style={{ border: 0, background: 'transparent', padding: 0, fontSize: 12, fontFamily: 'inherit', color: filterActive(filter) ? th.text : th.subtext, cursor: filterActive(filter) ? 'pointer' : 'default' }}
        >
          초기화
        </button>
      </div>

      {owners.length > 0 && (
        <>
          <p style={label}>담당</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {owners.map((o) => {
              const on = filter.owners.includes(o.key);
              return (
                <button key={o.key} type="button" data-filter-owner={o.key} aria-pressed={on} onClick={() => onFilter({ ...filter, owners: toggle(filter.owners, o.key) })} style={chip(on)}>
                  <Avatar name={o.name} email={o.key} size={20} />
                  {o.name}
                </button>
              );
            })}
          </div>
        </>
      )}

      {tags.length > 0 && (
        <>
          <p style={label}>분류</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {tags.map((t) => {
              const on = filter.tags.includes(t.name);
              const c = tagColor(t.name, th.palette, tags);
              return (
                <button
                  key={t.id}
                  type="button"
                  data-filter-tag={t.name}
                  aria-pressed={on}
                  onClick={() => onFilter({ ...filter, tags: toggle(filter.tags, t.name) })}
                  style={{ ...chip(on), padding: '0 10px' }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: c, display: 'block' }} />
                  {t.name}
                </button>
              );
            })}
          </div>
        </>
      )}

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 10px', borderRadius: 10, border: `1px solid ${th.border}`, background: th.panel2, fontSize: 12.5, color: th.text, cursor: 'pointer', minHeight: isMobile ? 44 : undefined, boxSizing: 'border-box' }}>
        <input type="checkbox" data-filter-urgent checked={filter.urgentOnly} onChange={(e) => onFilter({ ...filter, urgentOnly: e.target.checked })} style={{ margin: 0, accentColor: th.accent }} />
        긴급만 보기
      </label>

      <p data-filter-count style={{ margin: '10px 0 0', fontSize: 11.5, color: th.subtext }}>
        {shown} / {total}개 카드 표시 중
      </p>
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
  filter,
  controller,
  theme: th,
  isMobile,
  onCardPointerDown,
  onHeaderPointerDown,
  draggingId,
  dropTarget,
  dropIndex,
  dropHeight,
  done,
}: {
  col: KanbanColumn;
  index: number;
  cards: KanbanCard[];
  query: string;
  filter: CardFilter;
  controller: EditorController;
  theme: Theme;
  isMobile: boolean;
  onCardPointerDown: (e: ReactPointerEvent, card: KanbanCard) => void;
  onHeaderPointerDown: (e: ReactPointerEvent, col: KanbanColumn) => void;
  draggingId: string | null;
  /** 이 열이 지금 드롭 대상인가 — 비어 있어도 "여기 들어간다"를 보여 준다. */
  dropTarget: boolean;
  /** 놓일 자리(카드 목록 안 index) — 없으면 이 열이 대상이 아니다. */
  dropIndex: number | null;
  /** 놓일 자리 상자의 높이 = 끌고 있는 카드의 높이. */
  dropHeight: number;
  /** 마지막 열(완료)인가 — 지난 기한을 경고로 쓰지 않는다. */
  done: boolean;
}) {
  const [renaming, setRenaming] = useState(false);
  const [composing, setComposing] = useState(false);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  /** 열 삭제 확인(요청) — 열을 지우면 **안의 카드도 함께** 사라지므로 한 번 묻는다. */
  const [confirming, setConfirming] = useState(false);
  const readOnly = controller.readOnly;
  const dot = columnColor(col, index, th.palette);
  const visible = cards.filter((c) => c.id !== draggingId && cardPasses(c, query, filter));
  /** 그릴 차례 — 놓일 자리(점선 상자)를 카드 목록 사이에 끼운 것. */
  const rendered: ({ kind: 'card'; card: KanbanCard } | { kind: 'gap' })[] = visible.map((card) => ({ kind: 'card' as const, card }));
  if (dropIndex !== null) rendered.splice(Math.max(0, Math.min(dropIndex, rendered.length)), 0, { kind: 'gap' });
  const empty = visible.length === 0 && !composing && dropIndex === null;

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
        // 디자인 원본의 열 배경(#FBF6F1)처럼 패널2보다 **한 톤 더 옅게**(제보).
        // 바닥과 같은 방식으로 관계를 적어 테마가 바뀌어도 순서가 유지된다.
        background: mixHex(th.panel2, th.panel, 0.25),
        border: `1px solid ${dropTarget ? hexA(th.accent, 0.55) : th.border}`,
        borderRadius: 16,
        // 배경과 또렷이 갈리게 — 디자인 원본의 열 그림자.
        boxShadow: COL_SHADOW,
        boxSizing: 'border-box',
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
        {/* 끌고 있는 카드는 **자리를 비우고**(원본을 그리지 않는다) 놓일 자리에 같은
            크기의 점선 상자를 끼운다(요청 ④⑤) — 열이 그만큼 늘고 줄어 "여기 들어간다"가
            레이아웃으로 보인다. 히트 계산은 `[data-kanban-card]`만 보므로 이 상자는
            자동으로 빠진다. */}
        {rendered.map((item) =>
          item.kind === 'gap' ? (
            <div
              key="gap"
              data-kanban-drop-slot
              style={{ flex: '0 0 auto', height: dropHeight || 44, borderRadius: 12, border: `1.5px dashed ${hexA(th.accent, 0.75)}`, background: hexA(th.accent, 0.08), boxSizing: 'border-box' }}
            />
          ) : (
            <Card key={item.card.id} card={item.card} controller={controller} theme={th} onPointerDown={onCardPointerDown} dragging={false} done={done} />
          ),
        )}

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
            <span style={{ fontSize: 12.5, color: th.subtext }}>{query.trim() || filterActive(filter) ? '조건에 맞는 카드가 없어요.' : '이 단계에 들어갈 카드를 추가해 보세요.'}</span>
          </div>
        )}
      </div>

      {!readOnly && (
        <button
          type="button"
          className="mf-ed-btn"
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
            setConfirming(true);
          }}
          onClose={() => setMenuAt(null)}
        />
      )}

      {confirming && (
        <ConfirmDeleteColumn
          col={col}
          count={cards.length}
          theme={th}
          isMobile={isMobile}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            controller.deleteColumn(col.id);
          }}
        />
      )}
    </section>
  );
}

/**
 * 열 삭제 확인(요청).
 *
 * 열을 지우면 **안의 카드도 함께** 사라진다 — 되돌릴 수는 있지만(한 번의 커밋이라
 * Ctrl+Z 한 번) 메뉴 한 번 잘못 눌러 여러 장이 사라지는 일은 막아야 한다. 그래서
 * 무엇이 몇 장 사라지는지 문장으로 밝히고, 되돌릴 수 있다는 것도 함께 말한다
 * (홈의 폴더 삭제 확인창과 같은 결).
 *
 * 파괴적 버튼에 처음부터 초점이 가지 않게 **취소에 초점**을 둔다 — Enter를 눌러
 * 지워지는 일이 없다.
 */
function ConfirmDeleteColumn({
  col,
  count,
  theme: th,
  isMobile,
  onCancel,
  onConfirm,
}: {
  col: KanbanColumn;
  count: number;
  theme: Theme;
  isMobile: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onCancel();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  const btn: CSSProperties = {
    height: isMobile ? 44 : 36,
    padding: '0 16px',
    borderRadius: 10,
    fontSize: 13,
    fontWeight: 700,
    fontFamily: 'inherit',
    cursor: 'pointer',
  };
  return (
    <div
      data-confirm-delete-column-veil
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      style={{ position: 'fixed', inset: 0, zIndex: 350, background: hexA('#2e2a26', 0.34), display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
    >
      <div
        data-confirm-delete-column={col.id}
        role="dialog"
        aria-modal="true"
        aria-label="열 삭제 확인"
        style={{ width: 'min(380px, 100%)', boxSizing: 'border-box', padding: 20, borderRadius: 16, background: th.panel, border: `1px solid ${th.border}`, boxShadow: '0 40px 90px -40px rgba(0,0,0,.6)' }}
      >
        <strong style={{ display: 'block', fontSize: 15.5, color: th.text, marginBottom: 8 }}>‘{col.title}’ 열을 삭제할까요?</strong>
        <p data-confirm-body style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: th.subtext }}>
          {count > 0 ? `이 열에 있는 카드 ${count}장도 함께 삭제돼요.` : '이 열에는 카드가 없어요.'} 실행 취소(Ctrl+Z)로 되돌릴 수 있어요.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button ref={cancelRef} type="button" className="mf-ed-btn" data-confirm-cancel onClick={onCancel} style={{ ...btn, border: `1px solid ${th.border}`, background: th.panel, color: th.text }}>
            취소
          </button>
          <button type="button" className="mf-ed-btn" data-confirm-delete onClick={onConfirm} style={{ ...btn, border: `1px solid ${URGENT}`, background: URGENT, color: '#fff' }}>
            삭제
          </button>
        </div>
      </div>
    </div>
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
      className="mf-ed-btn"
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
      className="mf-kb-card"
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
 * 열 메뉴 — 이름 변경 · 열 색 · 삭제.
 *
 * 세 가지가 **성격이 다른 묶음**이라 구분선과 구획 이름으로 갈랐다(제보: 메뉴 안이
 * 구분되지 않는다): 이름 변경(즉시 실행) / 열 색(고르는 판) / 삭제(파괴적). 행의
 * 문법은 GNB 드롭다운과 같다 — 아이콘 + 라벨, `mf-ed-btn` 호버, `MenuDivider`·
 * `MenuSectionLabel`을 그대로 가져다 써서 앱 안의 메뉴가 한 언어를 쓴다.
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

  const W = 236;
  const left = Math.max(8, Math.min(at.x - W, window.innerWidth - W - 8));
  const row: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    minHeight: isMobile ? 44 : 38,
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
  const glyph = (color: string): CSSProperties => ({ display: 'flex', width: 18, justifyContent: 'center', color, flex: '0 0 auto' });
  // 스와치는 **한 줄로 떨어지는 그리드**다(속성 패널의 색 줄과 같은 규칙) — wrap에
  // 맡기면 7+2처럼 어중간하게 접혀 어느 색이 어느 단계인지 눈이 헤맨다.
  const swatch: CSSProperties = { width: '100%', aspectRatio: '1', borderRadius: 999, cursor: 'pointer', padding: 0, boxSizing: 'border-box' };
  return (
    <div
      ref={ref}
      data-column-menu-pop={col.id}
      role="menu"
      aria-label={`${col.title} 열 메뉴`}
      style={{ position: 'fixed', left, top: at.y, width: W, boxSizing: 'border-box', padding: 5, background: th.panel, border: `1px solid ${th.border}`, borderRadius: 12, boxShadow: '0 12px 32px rgba(0,0,0,.16)', zIndex: 320 }}
    >
      <button type="button" className="mf-ed-btn" role="menuitem" data-column-rename onClick={onRename} style={row}>
        <span style={glyph(th.subtext)}>
          <PencilGlyph />
        </span>
        이름 변경
      </button>

      <MenuDivider theme={th} />
      <MenuSectionLabel theme={th}>열 색</MenuSectionLabel>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9, 1fr)', gap: 5, padding: '2px 10px 8px' }}>
        {/* 기본 색 — 대각선은 이 앱에서 "색 없음"의 관례다(속성 패널의 '자동' 칩).
            지정이 없으면 열 순서대로 팔레트를 따르므로 이 칸이 활성이 된다. */}
        <button
          type="button"
          role="menuitem"
          data-column-color="default"
          aria-label="기본 색"
          title="기본 색"
          onClick={() => onColor(null)}
          style={{
            ...swatch,
            border: col.color ? `1px solid ${th.border}` : `2px solid ${th.text}`,
            background: 'transparent',
            backgroundImage: `linear-gradient(to top right, transparent calc(50% - 1px), ${th.subtext} calc(50% - 1px), ${th.subtext} calc(50% + 1px), transparent calc(50% + 1px))`,
          }}
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
            style={{ ...swatch, background: c, border: col.color === c ? `2px solid ${th.text}` : `1px solid ${hexA(th.text, 0.15)}` }}
          />
        ))}
      </div>

      <MenuDivider theme={th} />
      <button type="button" className="mf-ed-btn mf-ed-danger" role="menuitem" data-delete-column={col.id} onClick={onDelete} style={{ ...row, color: URGENT }}>
        <span style={glyph(URGENT)}>
          <TrashGlyph />
        </span>
        열 삭제
      </button>
    </div>
  );
}

function PencilGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function TrashGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
    </svg>
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

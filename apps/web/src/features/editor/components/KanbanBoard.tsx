// 칸반 화면 — 문서 종류 `'kanban'`의 전용 레이아웃(캔버스가 아니다).
//
// 마인드맵·화이트보드는 무한 캔버스 위에 좌표를 가진 물건들을 놓지만, 칸반은
// **열이 가로로 늘어선 고정 레이아웃**이다(사용자 선정): 팬/줌·미니맵·그리기가
// 없고 좌표 개념도 없어, 좁은 화면에서도 그대로 쓸 수 있다. 열이 많으면 가로로,
// 카드가 많으면 열 안에서 세로로 스크롤한다.
//
// 카드 순서는 카드 자신의 `pos` 필드다(코어 `kanban.ts`) — 배열로 들면 끊긴 채
// 두 사람이 카드를 옮길 때 한쪽 순서가 사라진다(#332의 교훈).

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { cardsInColumn } from '@mindflow/mindmap-core';
import type { KanbanCard, KanbanColumn } from '@mindflow/mindmap-core';
import type { EditorController } from '../useEditorState';
import type { Theme } from '../theme';
import { useIsMobile } from '../../../hooks/useMediaQuery';
import { dropIndicator, dropTargetAt, edgeScroll } from '../kanbanDrag';
import type { ColumnHit, DropTarget } from '../kanbanDrag';

const COL_W = 288;
const COL_GAP = 16;
/** 좌상단 문서 칩(DocChip)이 떠 있는 자리 — 캔버스에서는 빈 공간 위였지만 칸반은
 * 좌상단부터 열이 시작되므로 그만큼 내려서 겹치지 않게 한다. */
const CHIP_CLEARANCE = 78;

/** 마우스가 이만큼 움직여야 "끄는 것"으로 친다(클릭·더블클릭과 구분). */
const DRAG_THRESHOLD = 4;
/** 터치는 **길게 눌러야** 드래그가 시작된다 — 그래야 평범한 손가락 스크롤이 산다. */
const TOUCH_HOLD_MS = 320;

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

export function KanbanBoard({ controller, theme: th }: { controller: EditorController; theme: Theme }) {
  const isMobile = useIsMobile();
  const { columns, cards, readOnly } = controller;
  const boardRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;

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

  /** 카드에서 드래그를 시작한다(마우스는 문턱, 터치는 길게 누르기 — 각각의 관례). */
  const beginCardDrag = useCallback(
    (e: ReactPointerEvent, card: KanbanCard) => {
      if (controller.readOnly || controller.editingCardId) return;
      const el = e.currentTarget as HTMLElement;
      const rect = el.getBoundingClientRect();
      const startX = e.clientX;
      const startY = e.clientY;
      const touch = e.pointerType === 'touch';
      let started = false;
      let holdTimer: ReturnType<typeof setTimeout> | null = null;

      const start = (): void => {
        started = true;
        const st: DragState = { id: card.id, x: startX, y: startY, offX: startX - rect.left, offY: startY - rect.top, w: rect.width, text: card.text, target: null };
        setDrag(st);
        dragRef.current = st;
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
        const hits = columnHits();
        const target = dropTargetAt(hits, ev.clientX, ev.clientY, card.id);
        setDrag((prev) => (prev ? { ...prev, x: ev.clientX, y: ev.clientY, target } : prev));
        // 화면 밖 열·카드로도 끌고 갈 수 있게 가장자리에서 스크롤한다.
        const board = boardRef.current;
        if (board) {
          const br = board.getBoundingClientRect();
          const dx = edgeScroll(ev.clientX, br.left, br.right);
          if (dx) board.scrollLeft += dx;
          const colEl = target ? board.querySelector(`[data-kanban-column="${target.colId}"] [data-kanban-list]`) : null;
          if (colEl) {
            const cr = colEl.getBoundingClientRect();
            const dy = edgeScroll(ev.clientY, cr.top, cr.bottom, 44, 12);
            if (dy) colEl.scrollTop += dy;
          }
        }
      };
      const onUp = (ev: PointerEvent): void => {
        const st = dragRef.current;
        cleanup();
        if (!started || !st) return;
        const target = dropTargetAt(columnHits(), ev.clientX, ev.clientY, card.id);
        if (target) controller.moveCardTo(card.id, target.colId, target.index);
      };
      function cleanup(): void {
        if (holdTimer) clearTimeout(holdTimer);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        setDrag(null);
        dragRef.current = null;
      }
      window.addEventListener('pointermove', onMove, { passive: false });
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [columnHits, controller],
  );

  const indicator = drag?.target ? dropIndicator(columnHits(), drag.target, drag.id) : null;

  return (
    <div
      ref={boardRef}
      data-kanban-board
      onPointerDown={(e) => {
        // 빈 바닥을 누르면 선택 해제(캔버스의 배경 클릭과 같은 관례).
        if (e.target === e.currentTarget) controller.selectCard(null);
      }}
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'stretch',
        gap: COL_GAP,
        padding: isMobile ? `${CHIP_CLEARANCE}px 12px 14px` : `${CHIP_CLEARANCE}px 20px 18px`,
        overflowX: 'auto',
        overflowY: 'hidden',
        background: th.appBg,
        boxSizing: 'border-box',
      }}
    >
      {columns.map((col) => (
        <Column key={col.id} col={col} cards={cardsInColumn(cards, col.id)} controller={controller} theme={th} isMobile={isMobile} onCardPointerDown={beginCardDrag} draggingId={drag?.id ?? null} />
      ))}
      {!readOnly && (
        <button
          type="button"
          data-add-column
          onClick={controller.addColumn}
          style={{
            flex: '0 0 auto',
            width: COL_W,
            minHeight: 52,
            alignSelf: 'flex-start',
            border: `1.5px dashed ${th.border}`,
            borderRadius: 14,
            background: 'transparent',
            color: th.subtext,
            fontSize: 13.5,
            fontWeight: 600,
            fontFamily: 'inherit',
            cursor: 'pointer',
            padding: '15px 0',
          }}
        >
          ＋ 열 추가
        </button>
      )}

      {/* 끌고 있는 카드의 고스트 + 삽입 위치 선 — 화면 좌표라 보드 스크롤과 무관하다. */}
      {drag && (
        <div
          data-kanban-ghost
          style={{ position: 'fixed', left: drag.x - drag.offX, top: drag.y - drag.offY, width: drag.w, padding: '10px 11px', borderRadius: 10, background: th.panel, border: `1px solid ${th.accent}`, boxShadow: '0 8px 24px rgba(0,0,0,.18)', fontSize: 13.5, lineHeight: 1.5, color: th.text, whiteSpace: 'pre-wrap', wordBreak: 'break-word', pointerEvents: 'none', opacity: 0.95, zIndex: 300, transform: 'rotate(1.5deg)' }}
        >
          {drag.text || '빈 카드'}
        </div>
      )}
      {indicator && (
        <div
          data-kanban-drop-line
          style={{ position: 'fixed', left: indicator.left, top: indicator.top, width: indicator.width, height: 3, borderRadius: 2, background: th.accent, pointerEvents: 'none', zIndex: 299 }}
        />
      )}
    </div>
  );
}

function Column({
  col,
  cards,
  controller,
  theme: th,
  isMobile,
  onCardPointerDown,
  draggingId,
}: {
  col: KanbanColumn;
  cards: KanbanCard[];
  controller: EditorController;
  theme: Theme;
  isMobile: boolean;
  onCardPointerDown: (e: ReactPointerEvent, card: KanbanCard) => void;
  draggingId: string | null;
}) {
  const [renaming, setRenaming] = useState(false);
  const readOnly = controller.readOnly;
  return (
    <section
      data-kanban-column={col.id}
      style={{
        flex: '0 0 auto',
        width: isMobile ? 264 : COL_W,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        maxHeight: '100%',
        background: th.panel2,
        border: `1px solid ${th.border}`,
        borderRadius: 14,
        boxSizing: 'border-box',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 12px 9px' }}>
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
        <span data-column-count={col.id} style={{ flex: '0 0 auto', fontSize: 12, fontWeight: 700, color: th.subtext }}>
          {cards.length}
        </span>
        {!readOnly && (
          <button
            type="button"
            aria-label={`${col.title} 열 삭제`}
            title="열 삭제"
            data-delete-column={col.id}
            onClick={() => controller.deleteColumn(col.id)}
            style={{ flex: '0 0 auto', width: isMobile ? 32 : 24, height: isMobile ? 32 : 24, border: 'none', borderRadius: 7, background: 'transparent', color: th.subtext, cursor: 'pointer', fontSize: 15, lineHeight: 1 }}
          >
            ×
          </button>
        )}
      </header>

      <div data-kanban-list style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '0 10px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {cards.map((card) => (
          <Card key={card.id} card={card} controller={controller} theme={th} onPointerDown={onCardPointerDown} dragging={draggingId === card.id} />
        ))}
        {!readOnly && (
          <button
            type="button"
            data-add-card={col.id}
            onClick={() => controller.addCard(col.id)}
            style={{ border: 'none', borderRadius: 10, background: 'transparent', color: th.subtext, fontSize: 13, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', padding: '9px 10px', textAlign: 'left', minHeight: 40 }}
          >
            ＋ 카드 추가
          </button>
        )}
      </div>
    </section>
  );
}

function Card({ card, controller, theme: th, onPointerDown, dragging }: { card: KanbanCard; controller: EditorController; theme: Theme; onPointerDown: (e: ReactPointerEvent, card: KanbanCard) => void; dragging: boolean }) {
  const editing = controller.editingCardId === card.id;
  const selected = controller.selectedCardId === card.id;
  const base: CSSProperties = {
    background: card.bg || th.panel,
    border: `1px solid ${selected ? th.accent : th.border}`,
    boxShadow: selected ? `0 0 0 2px ${th.accent}33` : '0 1px 2px rgba(0,0,0,.05)',
    borderRadius: 10,
    padding: '10px 11px',
    fontSize: 13.5,
    lineHeight: 1.5,
    color: th.text,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  };
  if (editing) return <CardEdit card={card} style={base} onCommit={(t) => controller.commitCardText(card.id, t)} />;
  return (
    <div
      data-kanban-card={card.id}
      data-selected={selected ? '1' : undefined}
      onPointerDown={(e) => {
        controller.selectCard(card.id);
        onPointerDown(e, card);
      }}
      onDoubleClick={() => controller.startEditCard(card.id)}
      style={{
        ...base,
        cursor: 'pointer',
        userSelect: 'none',
        // 끌고 있는 원본은 자리를 지키되 흐리게 — 어디서 떠났는지 보인다.
        opacity: dragging ? 0.35 : 1,
        // 터치: 세로 스크롤은 살리고(길게 눌러야 드래그) 가로 제스처만 막는다.
        touchAction: 'pan-y',
      }}
    >
      {card.text || <span style={{ color: th.subtext }}>빈 카드</span>}
    </div>
  );
}

function CardEdit({ card, style, onCommit }: { card: KanbanCard; style: CSSProperties; onCommit: (text: string) => void }) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const [val, setVal] = useState(card.text);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);
  const grow = (el: HTMLTextAreaElement | null): void => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };
  return (
    <textarea
      ref={(el) => {
        ref.current = el;
        grow(el);
      }}
      className="mf-edit"
      data-kanban-card-edit={card.id}
      value={val}
      onChange={(e) => {
        setVal(e.target.value);
        grow(e.target);
      }}
      onBlur={() => onCommit(val)}
      onKeyDown={(e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
        e.stopPropagation(); // 에디터 전역 단축키(Delete·방향키 등)와 겹치지 않게
        if (e.nativeEvent.isComposing) return;
        // 카드 한 장은 짧은 글이라 Enter=확정, Shift+Enter=줄바꿈(도형·메모와 같은 규칙).
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          onCommit(e.currentTarget.value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCommit(card.text); // 되돌리기
        }
      }}
      style={{ ...style, cursor: 'text', resize: 'none', outline: 'none', fontFamily: 'inherit', overflow: 'hidden', minHeight: 38 }}
    />
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

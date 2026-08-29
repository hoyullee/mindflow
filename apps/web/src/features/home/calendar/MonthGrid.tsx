import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import type { CalendarEntry } from './entries';
import type { MonthCell } from './model';
import { DOW, daysBetween } from './model';
import { beginPointerDrag } from '../../editor/components/KanbanBoard';
import { entryChip, type ChipSurface } from './chips';

/** 끄는 동안의 상태 — 손끝의 고스트와 놓일 칸. */
interface CalDragState {
  entry: CalendarEntry;
  /** 잡은 칸 — 기간 일정은 이 칸을 기준으로 평행이동한다(바 가운데를 잡아도 자연스럽게). */
  fromIso: string;
  x: number;
  y: number;
  /** 지금 포인터 아래의 날짜 칸(없으면 격자 밖). */
  overIso: string | null;
}

/** 포인터 아래의 날짜 칸을 좌표로 찾는다 — 칸은 격자 자식이라 히트테스트가 가장 단순하다. */
function cellAt(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y);
  const cell = el?.closest?.('[data-day-cell]') as HTMLElement | null;
  return cell?.dataset.dayCell ?? null;
}

/**
 * 월 달력 격자 — 디자인 원본 `Geurio 일정 캘린더.dc.html`의 calGrid.
 *
 * 칸 색은 요일이 정한다(일요일은 따뜻하게, 토요일은 차갑게), 오늘은 강조색 링,
 * 지난 날은 흐리게. 기간 일정은 **칸마다 바 한 조각**으로 그린다 — 시작 칸과 주의
 * 첫 칸(일요일)에만 제목을 쓰고 양 끝만 모서리를 둥글린다. 이 방식은 lane 계산이
 * 없어 단순하고, 디자인 원본이 쓰는 그 방식이다.
 */
export function MonthGrid({
  cells,
  onPickDay,
  onPickEntry,
  onMore,
  onShift,
  selected,
  surface,
  compact = false,
}: {
  cells: readonly MonthCell[];
  onPickDay: (iso: string) => void;
  onPickEntry: (e: CalendarEntry) => void;
  onMore: (iso: string) => void;
  /** 항목을 다른 칸에 놓았다 — 며칠 옮길지(기간이면 시작일·기한이 함께 움직인다). */
  onShift: (e: CalendarEntry, days: number) => void;
  selected: string | null;
  surface: ChipSurface;
  compact?: boolean;
}) {
  const [drag, setDrag] = useState<CalDragState | null>(null);
  const dragRef = useRef<CalDragState | null>(null);
  dragRef.current = drag;
  /** 끌었는가 — 드래그 끝의 `click`이 상세 팝업을 열지 않게 삼킨다(다음 누름에서 리셋). */
  const draggedRef = useRef(false);

  /** 칩·바를 잡았다 — 마우스는 4px 문턱, 터치는 길게 누르기(`beginPointerDrag`). */
  const grab = (ev: ReactPointerEvent, entry: CalendarEntry, fromIso: string): void => {
    // 새 누름이 시작됐다 — 앞선 드래그의 표식은 여기서 씻는다(어떤 칩을 누르든).
    draggedRef.current = false;
    // 보기 전용으로 공유받은 보드는 끌리지 않는다 — 옮겨 봐야 서버가 막는다.
    if (entry.readOnly) return;
    const seed: CalDragState = { entry, fromIso, x: ev.clientX, y: ev.clientY, overIso: fromIso };
    beginPointerDrag(ev, {
      onStart: () => {
        draggedRef.current = true;
        setDrag(seed);
      },
      onMove: (e) => setDrag((prev) => (prev ? { ...prev, x: e.clientX, y: e.clientY, overIso: cellAt(e.clientX, e.clientY) } : prev)),
      onDrop: (e) => {
        const cur = dragRef.current;
        const to = cellAt(e.clientX, e.clientY);
        // 격자 밖이나 제자리에 놓았으면 아무 일도 없다(취소도 이동이 아니다).
        if (cur && to && to !== cur.fromIso) onShift(cur.entry, daysBetween(cur.fromIso, to));
      },
      onEnd: () => setDrag(null),
    });
  };

  /** 클릭 = 상세 팝업. 다만 **끌고 난 뒤의 클릭은 아니다**(놓은 자리에서 팝업이 뜨면 안 된다). */
  const clickEntry = (e: CalendarEntry): void => {
    // **한 번만** 삼킨다 — 표식이 남으면 다음 평범한 클릭까지 먹는다.
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    onPickEntry(e);
  };

  return (
    <div
      data-month-grid
      style={{
        flex: '1 1 auto',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 16,
        border: '1px solid var(--mf-border)',
        background: 'var(--mf-card)',
        boxShadow: 'var(--mf-card-shadow)',
        overflow: 'hidden',
      }}
    >
      {/* 요일 머리 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid var(--mf-border-soft)', background: 'var(--mf-panel2)', flexShrink: 0 }}>
        {DOW.map((d, i) => (
          <span
            key={d}
            // 디자인 원본의 요일 머리 — 작고 굵고 자간을 넓게(달력 표의 머리다운 꼴).
            style={{
              padding: '9px 0 8px',
              textAlign: 'center',
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: '.08em',
              color: i === 0 ? 'var(--mf-danger)' : i === 6 ? 'var(--mf-info)' : 'var(--mf-faint)',
            }}
          >
            {d}
          </span>
        ))}
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gridAutoRows: '1fr' }}>
        {cells.map((c) => (
          <DayCell
            key={c.iso}
            cell={c}
            selected={selected === c.iso}
            compact={compact}
            surface={surface}
            onPickDay={onPickDay}
            onPickEntry={clickEntry}
            onMore={onMore}
            onGrab={grab}
            dragging={drag?.entry}
            dropHot={!!drag && drag.overIso === c.iso && drag.overIso !== drag.fromIso}
          />
        ))}
      </div>

      {drag && <DragGhost drag={drag} surface={surface} />}
    </div>
  );
}

/**
 * 손끝을 따라오는 고스트 — 칸반 카드 드래그와 같은 모델(원본은 자리에서 흐려지고,
 * 옮기는 것은 이 알약이 대신 말한다). **body 포털**이다: 격자·칸에 걸린 변형이나
 * `overflow: hidden`이 `position: fixed`를 가둔다(위젯 고스트에서 겪은 그 함정).
 */
function DragGhost({ drag, surface }: { drag: CalDragState; surface: ChipSurface }) {
  const chip = entryChip(drag.entry, surface);
  const to = drag.overIso && drag.overIso !== drag.fromIso ? daysBetween(drag.fromIso, drag.overIso) : 0;
  return createPortal(
    <div
      data-cal-ghost
      aria-hidden="true"
      style={{
        position: 'fixed',
        left: drag.x + 10,
        top: drag.y + 10,
        zIndex: 400,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        maxWidth: 220,
        height: 22,
        padding: '0 9px',
        borderRadius: 999,
        background: chip.bg,
        color: chip.fg,
        border: '1px solid var(--mf-accent)',
        boxShadow: '0 10px 22px -14px rgba(0,0,0,.5)',
        font: 'inherit',
        fontSize: 10.5,
        fontWeight: 800,
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        transform: 'rotate(1.5deg)',
      }}
    >
      <span style={{ width: 5, height: 5, borderRadius: 999, background: chip.dot, flexShrink: 0 }} />
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{drag.entry.title || '제목 없음'}</span>
      {to !== 0 && (
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, opacity: 0.8 }}>
          {to > 0 ? `+${to}` : to}일
        </span>
      )}
    </div>,
    document.body,
  );
}

function DayCell({
  cell,
  selected,
  compact,
  surface,
  onPickDay,
  onPickEntry,
  onMore,
  onGrab,
  dragging,
  dropHot,
}: {
  cell: MonthCell;
  selected: boolean;
  compact: boolean;
  surface: ChipSurface;
  onPickDay: (iso: string) => void;
  onPickEntry: (e: CalendarEntry) => void;
  onMore: (iso: string) => void;
  onGrab: (ev: ReactPointerEvent, e: CalendarEntry, fromIso: string) => void;
  /** 지금 끌고 있는 항목(그 칩은 자리에서 흐려진다). */
  dragging: CalendarEntry | undefined;
  /** 이 칸에 놓이려는 중인가 — 놓일 자리를 강조색 링으로 알린다. */
  dropHot: boolean;
}) {
  const { inMonth, isToday, dim, dow } = cell;
  // 칸 색은 아주 옅은 파생 토큰이다(디자인 원본의 관계 그대로):
  //   선택 < 오늘 < 오늘+선택. 예전에는 강조색 면(soft/mute)을 그대로 써서 칸이
  //   통째로 진하게 칠해졌다(제보: 부자연스럽다).
  // 이웃 달 칸은 숫자만 흐리게 + 배경 한 톤 진하게(디자인 원본).
  const bg = !inMonth
    ? 'var(--mf-sunken)'
    : selected
      ? isToday
        ? 'var(--mf-cal-sel-today)'
        : 'var(--mf-cal-sel)'
      : isToday
        ? 'var(--mf-cal-today)'
        : // 주말은 디자인 원본대로 두 색으로 갈린다 — 일요일·공휴일은 파스텔 분홍
          // (#FEF8F5), 토요일은 파스텔 하늘색(#F9FBFD). 값은 표에 적지 않고 그 칸의
          // 숫자 색에서 파생한다(`--mf-cal-sun`/`-sat`) — 숫자와 배경이 언제나 같은
          // 색조를 쓰고, 여섯 테마 × 다크에 값을 새로 정할 필요가 없다.
          dow === 0 || cell.holiday
          ? 'var(--mf-cal-sun)'
          : dow === 6
            ? 'var(--mf-cal-sat)'
            : 'var(--mf-card)';
  const numFg = !inMonth
    ? 'var(--mf-faint)'
    : isToday
      ? 'var(--mf-accent-ink)'
      : dow === 0 || cell.holiday
        ? 'var(--mf-danger)'
        : dow === 6
          ? 'var(--mf-info)'
          : dim
            ? 'var(--mf-faint)'
            : 'var(--mf-subtext)';
  const cellStyle: CSSProperties = {
    minWidth: 0,
    minHeight: compact ? 44 : 78,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    padding: compact ? '3px 3px 4px' : '5px 5px 6px',
    borderRight: '1px solid var(--mf-border-soft)',
    borderBottom: '1px solid var(--mf-border-soft)',
    background: dropHot ? 'var(--mf-accent-soft)' : bg,
    // 고른 칸의 표시는 **안쪽 링**이다 — 테두리를 굵히면 격자가 1px 밀린다.
    // 놓일 칸은 그보다 진한 링 + 옅은 면으로(지금 무엇이 일어나려는가가 먼저다).
    ...(dropHot ? { boxShadow: 'inset 0 0 0 2px var(--mf-accent)' } : selected ? { boxShadow: 'inset 0 0 0 1.5px var(--mf-cal-ring)' } : {}),
    opacity: inMonth ? 1 : 0.7,
    cursor: inMonth ? 'pointer' : 'default',
    // 칸이 내용보다 좁아도 격자가 밀리지 않게 — 넘치는 칩은 접힌다(moreN).
    overflow: 'hidden',
  };

  return (
    <div
      data-day-cell={cell.iso}
      data-today={isToday ? '1' : undefined}
      data-out-month={inMonth ? undefined : '1'}
      role={inMonth ? 'button' : undefined}
      tabIndex={inMonth ? 0 : undefined}
      aria-label={inMonth ? `${cell.n}일` : undefined}
      onClick={inMonth ? () => onPickDay(cell.iso) : undefined}
      onKeyDown={
        inMonth
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onPickDay(cell.iso);
              }
            }
          : undefined
      }
      style={cellStyle}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
        <span
          style={{
            minWidth: 18,
            height: 18,
            padding: '0 4px',
            borderRadius: 999,
            background: isToday ? 'var(--mf-accent)' : 'transparent',
            color: numFg,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: compact ? 9.5 : 11,
            fontWeight: isToday ? 800 : 600,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {cell.n}
        </span>
      </span>

      {/* 기간 바 → 하루짜리 칩 → 접힌 개수 */}
      {cell.bars.map((b) => {
        const chip = entryChip(b.entry, surface);
        return (
          <button
            key={`bar-${b.entry.docId}-${b.entry.cardId}`}
            type="button"
            data-cal-bar
            title={`${b.entry.title} · ${b.entry.boardName}`}
            onPointerDown={(e) => {
              e.stopPropagation();
              onGrab(e, b.entry, cell.iso);
            }}
            onClick={(e) => {
              e.stopPropagation();
              onPickEntry(b.entry);
            }}
            style={{
              height: compact ? 12 : 16,
              minWidth: 0,
              border: 0,
              padding: b.label ? '0 5px' : 0,
              borderRadius: 2,
              borderTopLeftRadius: b.head ? 5 : 2,
              borderBottomLeftRadius: b.head ? 5 : 2,
              borderTopRightRadius: b.tail ? 5 : 2,
              borderBottomRightRadius: b.tail ? 5 : 2,
              background: chip.bg,
              color: chip.fg,
              font: 'inherit',
              fontSize: compact ? 8.5 : 10,
              fontWeight: 700,
              textAlign: 'left',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              cursor: b.entry.readOnly ? 'pointer' : 'grab',
              flexShrink: 0,
              opacity: isDragged(dragging, b.entry) ? 0.4 : cell.dim ? 0.6 : 1,
              touchAction: 'none',
            }}
          >
            {b.label ? b.entry.title : ''}
          </button>
        );
      })}

      {cell.entries.map((e) => {
        const chip = entryChip(e, surface);
        return (
          <button
            key={`${e.docId}-${e.cardId}`}
            type="button"
            data-cal-chip
            title={`${e.title} · ${e.boardName} · ${e.colName}`}
            onPointerDown={(ev) => {
              ev.stopPropagation();
              onGrab(ev, e, cell.iso);
            }}
            onClick={(ev) => {
              ev.stopPropagation();
              onPickEntry(e);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              minWidth: 0,
              height: compact ? 13 : 17,
              padding: '0 6px',
              border: 0,
              borderRadius: 999,
              background: chip.bg,
              color: chip.fg,
              font: 'inherit',
              fontSize: compact ? 8.5 : 10,
              fontWeight: 700,
              letterSpacing: '-.01em',
              cursor: e.readOnly ? 'pointer' : 'grab',
              flexShrink: 0,
              opacity: isDragged(dragging, e) ? 0.4 : cell.dim ? 0.6 : 1,
              touchAction: 'none',
            }}
          >
            <span style={{ width: 4, height: 4, borderRadius: 999, background: chip.dot, flexShrink: 0 }} />
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.title}</span>
          </button>
        );
      })}

      {cell.moreN > 0 && (
        <button
          type="button"
          data-cal-more
          onClick={(e) => {
            e.stopPropagation();
            onMore(cell.iso);
          }}
          style={{ border: 0, background: 'transparent', padding: '0 4px', textAlign: 'left', font: 'inherit', fontSize: compact ? 8.5 : 10, fontWeight: 700, color: 'var(--mf-faint)', cursor: 'pointer', flexShrink: 0 }}
        >
          +{cell.moreN}개 더
        </button>
      )}
    </div>
  );
}

/** 지금 끌고 있는 그 항목인가 — 원본은 자리에서 흐려진다(옮기는 것은 고스트가 말한다). */
function isDragged(dragging: CalendarEntry | undefined, e: CalendarEntry): boolean {
  return !!dragging && dragging.docId === e.docId && dragging.cardId === e.cardId;
}

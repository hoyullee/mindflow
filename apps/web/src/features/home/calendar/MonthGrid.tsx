import type { CSSProperties } from 'react';
import type { CalendarEntry } from './entries';
import type { MonthCell } from './model';
import { DOW } from './model';
import { entryChip } from './chips';

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
  selected,
  compact = false,
}: {
  cells: readonly MonthCell[];
  onPickDay: (iso: string) => void;
  onPickEntry: (e: CalendarEntry) => void;
  onMore: (iso: string) => void;
  selected: string | null;
  compact?: boolean;
}) {
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
        boxShadow: 'var(--mf-card-shadow-sm)',
        overflow: 'hidden',
      }}
    >
      {/* 요일 머리 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid var(--mf-border-soft)', background: 'var(--mf-panel2)', flexShrink: 0 }}>
        {DOW.map((d, i) => (
          <span
            key={d}
            style={{
              padding: '7px 0',
              textAlign: 'center',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '.02em',
              color: i === 0 ? 'var(--mf-danger)' : i === 6 ? 'var(--mf-info)' : 'var(--mf-muted)',
            }}
          >
            {d}
          </span>
        ))}
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gridAutoRows: '1fr' }}>
        {cells.map((c) => (
          <DayCell key={c.iso} cell={c} selected={selected === c.iso} compact={compact} onPickDay={onPickDay} onPickEntry={onPickEntry} onMore={onMore} />
        ))}
      </div>
    </div>
  );
}

function DayCell({
  cell,
  selected,
  compact,
  onPickDay,
  onPickEntry,
  onMore,
}: {
  cell: MonthCell;
  selected: boolean;
  compact: boolean;
  onPickDay: (iso: string) => void;
  onPickEntry: (e: CalendarEntry) => void;
  onMore: (iso: string) => void;
}) {
  const { inMonth, isToday, dim, dow } = cell;
  // 이웃 달 칸은 숫자만 흐리게 + 배경 한 톤 진하게(디자인 원본).
  const bg = !inMonth
    ? 'var(--mf-sunken)'
    : selected
      ? 'var(--mf-accent-mute)'
      : isToday
        ? 'var(--mf-accent-soft)'
        : dow === 0 || dow === 6
          ? // 주말은 한 톤 가라앉힌 면 하나로 묶는다. 디자인 원본은 일요일을 따뜻하게
            // (#FEF8F5) 토요일을 차갑게(#F9FBFD) 갈랐지만 우리 토큰에는 그만큼 옅은
            // 두 색이 없고, 두 색을 새로 만들면 여섯 테마 × 다크에 전부 값을 정해야
            // 한다. 요일 구분은 **숫자 색**(일=danger / 토=info)이 이미 말한다.
            'var(--mf-panel2)'
          : 'var(--mf-card)';
  const numFg = !inMonth
    ? 'var(--mf-faint)'
    : isToday
      ? 'var(--mf-accent-ink)'
      : dow === 0
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
    background: bg,
    opacity: inMonth ? 1 : 0.7,
    cursor: inMonth ? 'pointer' : 'default',
    // 칸이 내용보다 좁아도 격자가 밀리지 않게 — 넘치는 칩은 접힌다(moreN).
    overflow: 'hidden',
  };

  return (
    <div
      data-day-cell={cell.iso}
      data-today={isToday ? '1' : undefined}
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
        const chip = entryChip(b.entry);
        return (
          <button
            key={`bar-${b.entry.docId}-${b.entry.cardId}`}
            type="button"
            title={`${b.entry.title} · ${b.entry.boardName}`}
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
              cursor: 'pointer',
              flexShrink: 0,
              opacity: cell.dim ? 0.6 : 1,
            }}
          >
            {b.label ? b.entry.title : ''}
          </button>
        );
      })}

      {cell.entries.map((e) => {
        const chip = entryChip(e);
        return (
          <button
            key={`${e.docId}-${e.cardId}`}
            type="button"
            data-cal-chip
            title={`${e.title} · ${e.boardName} · ${e.colName}`}
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
              cursor: 'pointer',
              flexShrink: 0,
              opacity: cell.dim ? 0.6 : 1,
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

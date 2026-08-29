// 통계 칩 — 디자인 원본 `Geurio 일정 캘린더.dc.html`의 `calStats` 블록 이식.
//
// 예전에는 칩이 **필터**여서, 누르면 달력이 그 항목만 남기고 통째로 비었다. 무엇이
// 걸렸는지 보려고 눌렀는데 나머지가 사라지니 달력을 읽는 자리가 아니게 됐다.
// 디자인 원본대로 **누르면 목록이 뜨는 팝오버**로 바꾼다 — 달력은 그대로 있고,
// 목록에서 항목을 고르면 그 상세가 열린다.

import { useState } from 'react';
import { Popover } from '../../../components/Popover';
import type { CalendarEntry } from './entries';
import type { CalendarStat } from './model';
import { statBadge } from './model';

/** 팝오버가 한 번에 보여 주는 줄 수 — 나머지는 `+N개 더`로 접는다(원본과 같다). */
const MAX_ROWS = 5;

/** 중요도 순서(디자인 원본의 TONE): 지난 마감 > 오늘 > 이번 주 > 기간. */
const DOT: Record<CalendarStat['key'], string> = { over: 'var(--mf-danger)', today: 'var(--mf-accent)', week: 'var(--mf-star)', span: 'var(--mf-faint2)' };
const FG: Record<CalendarStat['key'], string> = { over: 'var(--mf-danger)', today: 'var(--mf-accent-strong)', week: 'var(--mf-star)', span: 'var(--mf-muted)' };

export function StatChips({ stats, todayIso, onPickEntry }: { stats: readonly CalendarStat[]; todayIso: string; onPickEntry: (e: CalendarEntry) => void }) {
  return (
    <div data-cal-stats style={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', flexShrink: 0 }}>
      {stats.map((s) => (
        <StatChip key={s.key} stat={s} todayIso={todayIso} onPickEntry={onPickEntry} />
      ))}
    </div>
  );
}

function StatChip({ stat, todayIso, onPickEntry }: { stat: CalendarStat; todayIso: string; onPickEntry: (e: CalendarEntry) => void }) {
  const [open, setOpen] = useState(false);
  const zero = stat.count === 0;
  const rows = stat.items.slice(0, MAX_ROWS);

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label={`${stat.label} 목록`}
      side="bottom"
      align="start"
      sideOffset={2}
      panel={{
        width: 274,
        boxSizing: 'border-box',
        borderRadius: 14,
        background: 'var(--mf-card)',
        border: '1px solid var(--mf-border)',
        boxShadow: 'var(--mf-card-shadow)',
        padding: 9,
        zIndex: 240,
      }}
      trigger={
        <button
          type="button"
          data-cal-stat={stat.key}
          aria-expanded={open}
          // 면(꺼짐·hover·열림)은 `home.css`의 `.mf-cal-chip`이 정한다 — 인라인으로
          // 두면 hover 규칙과 싸운다(그래서 `.mf-ctl`을 쓰지 않는다).
          className="mf-cal-chip"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 30, padding: '0 10px', borderRadius: 999, border: 0, font: 'inherit', cursor: 'pointer' }}
        >
          <span style={{ width: 6, height: 6, borderRadius: 999, background: zero ? 'var(--mf-border)' : DOT[stat.key], flexShrink: 0 }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--mf-muted)', whiteSpace: 'nowrap' }}>{stat.label}</span>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5, fontWeight: zero ? 600 : stat.key === 'over' || stat.key === 'today' ? 800 : 700, color: zero ? 'var(--mf-faint)' : FG[stat.key], whiteSpace: 'nowrap' }}>
            {stat.count}
            {stat.unit}
          </span>
        </button>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 7, padding: '2px 5px 7px' }}>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '-.01em', color: 'var(--mf-text)', whiteSpace: 'nowrap' }}>{stat.label}</span>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: zero ? 'var(--mf-faint)' : FG[stat.key], whiteSpace: 'nowrap' }}>
            {stat.count}
            {stat.unit}
          </span>
        </span>

        {rows.map((e) => {
          const badge = statBadge(e.due, todayIso);
          const past = e.due < todayIso;
          const isToday = e.due === todayIso;
          return (
            <button
              key={`${e.docId}-${e.cardId}`}
              type="button"
              data-cal-stat-item={e.cardId}
              onClick={() => {
                setOpen(false);
                onPickEntry(e);
              }}
              className="mf-ctl"
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 6, border: 0, borderRadius: 9, background: 'transparent', font: 'inherit', textAlign: 'left', cursor: 'pointer', minWidth: 0 }}
            >
              <span
                style={{
                  flex: '0 0 auto',
                  minWidth: 34,
                  height: 17,
                  padding: '0 6px',
                  borderRadius: 999,
                  background: isToday ? 'var(--mf-accent-soft)' : past ? 'var(--mf-danger-bg)' : 'var(--mf-panel2)',
                  color: isToday ? 'var(--mf-accent-strong)' : past ? 'var(--mf-danger)' : 'var(--mf-muted)',
                  fontSize: 9,
                  fontWeight: 800,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  whiteSpace: 'nowrap',
                }}
              >
                {badge}
              </span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, fontWeight: 600, color: 'var(--mf-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.title}</span>
            </button>
          );
        })}

        {stat.count > MAX_ROWS && <span style={{ padding: '4px 6px 2px', fontSize: 10.5, color: 'var(--mf-faint)' }}>+{stat.count - MAX_ROWS}개 더</span>}
        {zero && <span style={{ padding: '4px 6px 6px', fontSize: 11.5, color: 'var(--mf-faint)' }}>해당하는 일정이 없어요</span>}
      </div>
    </Popover>
  );
}

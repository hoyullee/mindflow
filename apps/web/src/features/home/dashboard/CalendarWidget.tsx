/**
 * 대시보드 캘린더 위젯 — 디자인 원본 `Geurio 일정 캘린더.dc.html`의 `isCal` 위젯.
 *
 * **크기가 보기를 정한다**(`calWidgetMode`): 작으면 다가오는 마감 목록, 2×2부터
 * 주간 일곱 줄, 4×3부터 월간(작은 달력 + 옆 목록). 고를 것을 따로 두지 않는 이유는
 * 크기가 이미 "얼마나 보여 줄까"를 말하기 때문이다.
 *
 * 항목의 원천은 일정 화면과 **같다**(칸반 마감 + Geurio 일정) — 여기서 다시 모으지
 * 않고 `entries`를 받는다. 위젯은 **보기 전용**이고(#518의 규칙: 위젯 안에서 실수로
 * 화면이 통째로 바뀌지 않는다) 항목을 누르면 그 날짜의 일정 화면으로 간다.
 */

import { useMemo } from 'react';
import type { CalendarEntry } from '../calendar/entries';
import { entryChip, type ChipSurface } from '../calendar/chips';
import { DOW, addDays, entriesOn, monthCells, monthLabel, partsOf, statBadge, upcomingEntries, weekStartISO } from '../calendar/model';

const MONO = { fontFamily: "'JetBrains Mono', monospace" } as const;

export interface CalWidgetProps {
  entries: readonly CalendarEntry[];
  todayIso: string;
  mode: 'month' | 'week' | 'list';
  cols: number;
  rows: number;
  surface: ChipSurface;
  /** 지금 보고 있는 달(월간) — 위젯 머리의 ‹ › 가 옮긴다. */
  ym: { y: number; m: number };
  /** 주간 보기의 기준 주(0 = 이번 주). */
  weekOffset: number;
  /** 항목을 누르면 그 날짜의 일정 화면으로. */
  onPick: (iso: string) => void;
}

export function CalWidgetBody({ entries, todayIso, mode, cols, rows, surface, ym, weekOffset, onPick }: CalWidgetProps) {
  if (mode === 'month') return <MonthBody entries={entries} todayIso={todayIso} rows={rows} surface={surface} ym={ym} onPick={onPick} />;
  if (mode === 'week') return <WeekBody entries={entries} todayIso={todayIso} cols={cols} rows={rows} surface={surface} weekOffset={weekOffset} onPick={onPick} />;
  return <ListBody entries={entries} todayIso={todayIso} cols={cols} rows={rows} surface={surface} onPick={onPick} />;
}

/** 다가오는 마감 — 가장 작은 보기. 크기만큼만 보여 주고 나머지는 개수로 접는다. */
function ListBody({ entries, todayIso, cols, rows, surface, onPick }: Omit<CalWidgetProps, 'mode' | 'ym' | 'weekOffset'>) {
  const list = upcomingEntries(entries, todayIso);
  const cap = rows >= 2 ? 8 : cols >= 2 ? 4 : 3;
  const shown = list.slice(0, cap);
  return (
    <div data-cal-widget-list style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '7px 6px 6px', overflow: 'hidden' }}>
      <SectionLabel>다가오는 마감</SectionLabel>
      {shown.length === 0 ? (
        <Empty>다가오는 마감이 없어요</Empty>
      ) : (
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 1 }}>
          {shown.map((e) => (
            <Row key={rowKey(e)} entry={e} todayIso={todayIso} surface={surface} onPick={onPick} />
          ))}
          {list.length > shown.length && <span style={{ fontSize: 8.5, color: 'var(--mf-faint2)', padding: '1px 6px' }}>+{list.length - shown.length}개 더</span>}
        </div>
      )}
    </div>
  );
}

/** 주간 — 요일 일곱 줄(디자인 `calWeek`). */
function WeekBody({ entries, todayIso, cols, rows, surface, weekOffset, onPick }: Omit<CalWidgetProps, 'mode' | 'ym'>) {
  const start = addDays(weekStartISO(todayIso), weekOffset * 7);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(start, i)), [start]);
  const maxPer = rows >= 3 ? 3 : cols >= 3 ? 2 : 1;
  return (
    <div data-cal-widget-week style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '8px 8px 6px', overflow: 'hidden' }}>
      <SectionLabel>{weekOffset === 0 ? '이번 주' : '주간'} · {calWidgetHeadLabel('week', { y: 0, m: 0 }, todayIso, weekOffset)}</SectionLabel>
      {/* 일곱 줄이 높이를 나눠 갖는다 — 위에 몰리고 아래가 비면 위젯이 반쯤 빈 것처럼
          보인다(2×2에서는 한 줄이 30px 남짓이라 칩 하나가 딱 들어간다). */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 1 }}>
        {days.map((iso, i) => {
          const list = entriesOn(entries, iso);
          const shown = list.slice(0, maxPer);
          const isToday = iso === todayIso;
          const n = partsOf(iso)?.d ?? '';
          return (
            <div key={iso} style={{ flex: '1 1 0', minHeight: 0, overflow: 'hidden', display: 'flex', alignItems: 'flex-start', gap: 7, padding: '3px 4px', borderRadius: 8, background: isToday ? 'var(--mf-accent-soft)' : 'transparent', minWidth: 0 }}>
              <span style={{ flex: '0 0 38px', display: 'flex', alignItems: 'center', gap: 4, paddingTop: 1 }}>
                <span style={{ width: 12, fontSize: 8.5, fontWeight: 700, textAlign: 'center', color: i === 0 ? 'var(--mf-danger)' : i === 6 ? 'var(--mf-info)' : 'var(--mf-faint)' }}>{DOW[i]}</span>
                <span style={{ width: 16, height: 16, borderRadius: 999, background: isToday ? 'var(--mf-accent)' : 'transparent', color: isToday ? 'var(--mf-accent-ink)' : 'var(--mf-subtext)', fontSize: 8.5, fontWeight: 800, ...MONO, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{n}</span>
              </span>
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                {shown.map((e) => (
                  <Chip key={rowKey(e)} entry={e} surface={surface} onPick={() => onPick(iso)} />
                ))}
                {list.length > shown.length && <span style={{ fontSize: 8, color: 'var(--mf-faint2)', padding: '0 6px' }}>+{list.length - shown.length}개 더</span>}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 월간 — 작은 달력 + 옆 목록(디자인 `calModeMonth`). */
function MonthBody({ entries, todayIso, rows, surface, ym, onPick }: Omit<CalWidgetProps, 'mode' | 'cols' | 'weekOffset'>) {
  const perCell = rows >= 4 ? 2 : 1;
  const cells = useMemo(() => monthCells(ym.y, ym.m, entries, todayIso, perCell), [ym.y, ym.m, entries, todayIso, perCell]);
  const list = upcomingEntries(entries, todayIso).slice(0, rows >= 4 ? 10 : 5);
  return (
    <div data-cal-widget-month style={{ flex: 1, minHeight: 0, display: 'flex', minWidth: 0, overflow: 'hidden' }}>
      <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 10px 9px', borderRight: '1px solid var(--mf-hairline)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3, flexShrink: 0 }}>
          {DOW.map((d) => (
            <span key={d} style={{ fontSize: 8, fontWeight: 800, letterSpacing: '.04em', color: 'var(--mf-faint2)', textAlign: 'center' }}>
              {d}
            </span>
          ))}
        </div>
        <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gridAutoRows: '1fr', gap: 3 }}>
          {cells.map((c) => (
            <button
              key={c.iso}
              type="button"
              data-cal-widget-cell={c.iso}
              disabled={!c.inMonth}
              onClick={() => onPick(c.iso)}
              style={{
                borderRadius: 8,
                border: `1px solid ${c.isToday ? 'var(--mf-accent-mute)' : 'transparent'}`,
                background: c.inMonth ? (c.isToday ? 'var(--mf-accent-soft)' : 'var(--mf-card)') : 'var(--mf-cal-out)',
                padding: '3px 3px 2px',
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                minWidth: 0,
                minHeight: 0,
                overflow: 'hidden',
                font: 'inherit',
                cursor: c.inMonth ? 'pointer' : 'default',
              }}
            >
              <span style={{ width: 15, height: 15, flex: '0 0 auto', borderRadius: 999, background: c.isToday ? 'var(--mf-accent)' : 'transparent', color: c.isToday ? 'var(--mf-accent-ink)' : c.inMonth ? 'var(--mf-subtext)' : 'var(--mf-faint2)', fontSize: 8, fontWeight: c.isToday ? 800 : 600, ...MONO, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{c.n}</span>
              {/* 칸 안의 항목 — 디자인 원본처럼 **제목까지** 쓴다(색 막대만 두면 무엇이
                  걸렸는지 알 수 없다). 좁으면 말줄임으로 접힌다. */}
              {c.entries.map((e) => {
                const chip = entryChip(e, surface);
                return (
                  <span key={rowKey(e)} style={{ display: 'block', width: '100%', boxSizing: 'border-box', padding: '0 4px', height: 11, lineHeight: '11px', borderRadius: 3, background: chip.bg, color: chip.fg, fontSize: 8, fontWeight: 700, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.title}
                  </span>
                );
              })}
              {c.bars.map((b) => {
                const chip = entryChip(b.entry, surface);
                return (
                  <span
                    key={`bar-${rowKey(b.entry)}`}
                    style={{
                      display: 'block',
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: b.label ? '0 4px' : 0,
                      height: 10,
                      lineHeight: '10px',
                      background: chip.bg,
                      color: chip.fg,
                      fontSize: 7.5,
                      fontWeight: 800,
                      textAlign: 'left',
                      // 기간 바는 양 끝만 둥글다(달력 격자와 같은 규칙 — 한 조각씩 그린다)
                      borderRadius: `${b.head ? 5 : 2}px ${b.tail ? 5 : 2}px ${b.tail ? 5 : 2}px ${b.head ? 5 : 2}px`,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {b.label ? b.entry.title : ''}
                  </span>
                );
              })}
              {c.moreN > 0 && <span style={{ fontSize: 7.5, color: 'var(--mf-faint2)', padding: '0 3px' }}>+{c.moreN}</span>}
            </button>
          ))}
        </div>
      </div>
      <div style={{ flex: '0 0 34%', minWidth: 118, display: 'flex', flexDirection: 'column', padding: '8px 6px 6px', overflow: 'hidden' }}>
        <SectionLabel>다가오는 마감</SectionLabel>
        {list.length === 0 ? (
          <Empty>다가오는 마감이 없어요</Empty>
        ) : (
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 1 }}>
            {list.map((e) => (
              <Row key={rowKey(e)} entry={e} todayIso={todayIso} surface={surface} onPick={onPick} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ entry, todayIso, surface, onPick }: { entry: CalendarEntry; todayIso: string; surface: ChipSurface; onPick: (iso: string) => void }) {
  const chip = entryChip(entry, surface);
  const badge = statBadge(entry.due, todayIso);
  const over = entry.due < todayIso;
  const today = entry.due === todayIso;
  return (
    <button
      type="button"
      data-cal-widget-row={rowKey(entry)}
      className="mf-ctl"
      title={`${entry.title} · ${entry.boardName}`}
      onClick={() => onPick(entry.due)}
      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 5px', border: 0, borderRadius: 7, background: 'transparent', font: 'inherit', textAlign: 'left', minWidth: 0, cursor: 'pointer', flexShrink: 0 }}
    >
      <span style={{ flex: '0 0 auto', minWidth: 30, height: 15, padding: '0 4px', borderRadius: 5, background: today ? 'var(--mf-accent-soft)' : over ? 'var(--mf-danger-bg)' : 'var(--mf-panel2)', color: today ? 'var(--mf-accent-strong)' : over ? 'var(--mf-danger)' : 'var(--mf-muted)', fontSize: 8, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', whiteSpace: 'nowrap' }}>{badge}</span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 9.5, fontWeight: 600, color: 'var(--mf-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.title || '제목 없음'}</span>
      <span style={{ width: 4, height: 4, borderRadius: 999, background: chip.dot, flex: '0 0 auto', display: 'block' }} />
    </button>
  );
}

function Chip({ entry, surface, onPick }: { entry: CalendarEntry; surface: ChipSurface; onPick: () => void }) {
  const chip = entryChip(entry, surface);
  return (
    <button
      type="button"
      data-cal-widget-chip={rowKey(entry)}
      title={`${entry.title} · ${entry.boardName}`}
      onClick={onPick}
      style={{ display: 'flex', alignItems: 'center', gap: 5, width: '100%', boxSizing: 'border-box', padding: '2px 7px', borderRadius: 999, border: 0, borderLeft: `3px solid ${chip.dot}`, background: chip.bg, color: chip.fg, font: 'inherit', fontSize: 9, fontWeight: 700, minWidth: 0, textAlign: 'left', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
    >
      {entry.title || '제목 없음'}
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <span style={{ flexShrink: 0, fontSize: 9.5, fontWeight: 800, letterSpacing: '.05em', color: 'var(--mf-faint2)', padding: '1px 5px 4px' }}>{children}</span>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <span style={{ padding: '6px 6px', fontSize: 9.5, color: 'var(--mf-faint)' }}>{children}</span>;
}

function rowKey(e: CalendarEntry): string {
  return `${e.docId}:${e.cardId}`;
}

/** 위젯 머리의 달 표기 — 월간은 `2026년 8월`, 주간은 그 주의 범위. */
export function calWidgetHeadLabel(mode: 'month' | 'week' | 'list', ym: { y: number; m: number }, todayIso: string, weekOffset: number): string {
  if (mode === 'month') return monthLabel(ym.y, ym.m);
  if (mode === 'week') {
    const s = addDays(weekStartISO(todayIso), weekOffset * 7);
    const e = addDays(s, 6);
    const a = partsOf(s);
    const b = partsOf(e);
    if (!a || !b) return '';
    return `${a.m}.${a.d} – ${b.m}.${b.d}`;
  }
  return '';
}

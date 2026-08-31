/**
 * 대시보드 캘린더 위젯 — 디자인 원본 `Geurio 일정 캘린더.dc.html`의 `isCal` 위젯.
 *
 * **크기가 보기를 정한다**(`calWidgetMode`): 4×3+ 월간(달력 + 옆 패널), 3×3+ 달력만,
 * 1열+높이 마감 목록 + 미니 달력, 3×2+ 주간 일곱 줄 + 미니 달력, 2×2 주간, 그보다 작으면 목록. 고를 것을
 * 따로 두지 않는 이유는 크기가 이미 "얼마나 보여 줄까"를 말하기 때문이다.
 *
 * **위젯 안에서 끝난다**(원본 `onDay`) — 날짜 칸을 누르면 그 자리에서 옆 패널이 그
 * 날로 바뀌고, 항목을 누르면 상세 팝업이 뜬다. 화면을 옮기는 문은 "열기" 하나다.
 *
 * 글자 크기는 **일정 화면과 같은 값**을 쓴다(제보: 너무 작다) — 칩 11.5·목록 13·
 * 날짜 12는 그 화면이 여러 차례 제보를 거쳐 정착한 값이라, 위젯이 그걸 줄여 그리면
 * 같은 것이 화면마다 달라 보인다.
 */

import { useEffect, useMemo, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { CalendarEntry, HolidayInfo } from '../calendar/entries';
import { MiniCalendar } from '../calendar/MiniCalendar';
import type { CalWidgetMode } from './model';
import { entryChip, type ChipSurface } from '../calendar/chips';
import {
  DOW,
  addDays,
  dayTimeline,
  dueBadge,
  entriesOn,
  hourLabel,
  isSpan,
  monthCells,
  monthLabel,
  partsOf,
  upcomingEntries,
  weekLabel,
  weekStartISO,
} from '../calendar/model';

const MONO = { fontFamily: "'JetBrains Mono', monospace" } as const;

/** 주간 보기(3열 이상)의 미니 달력 옆 패널 폭 — 2행 위젯 높이에서 칸이 정사각에 가깝다. */
const MINI_SIDE_W = 244;

/** 위젯 시간표 한 행(px) — 원본 `this.dayTimeline(sel, evs, 26)`. */
const ROW = 30;

/** 옆 패널이 무엇을 보여 주는가 — 다가오는 마감 / 고른 날짜(원본 `wcalSide`). */
export type CalWidgetSide = 'dl' | 'day';

export interface CalWidgetProps {
  entries: readonly CalendarEntry[];
  todayIso: string;
  mode: CalWidgetMode;
  cols: number;
  rows: number;
  surface: ChipSurface;
  /** 지금 보고 있는 달(월간·미니 달력) — 위젯 머리의 ‹ › 가 옮긴다. */
  ym: { y: number; m: number };
  /** 주간 보기의 기준 주(0 = 이번 주). */
  weekOffset: number;
  side: CalWidgetSide;
  /** 옆 패널이 보여 주는 날(기본은 오늘). */
  selDay: string;
  /** 날짜 칸을 누르면 — **화면을 옮기지 않고** 옆 패널을 그 날로 바꾼다. */
  onPickDay: (iso: string) => void;
  /** 항목을 누르면 상세 팝업. */
  onPickEntry: (e: CalendarEntry) => void;
  /** 미니 달력의 달 이동(1열 보기). */
  onSetMonth: (y: number, m: number) => void;
  /** 공휴일(구글 연동) — `날짜 → 이름`. 연동 안 했으면 빈 객체다. */
  holidays?: Record<string, HolidayInfo>;
  /** 빈 자리를 **더블클릭** — 그 날짜로 새 일정(요청). */
  onNewOnDay?: (iso: string) => void;
}

export function CalWidgetBody(props: CalWidgetProps) {
  if (props.mode === 'month' || props.mode === 'month-only') return <MonthBody {...props} />;
  if (props.mode === 'week') return <WeekBody {...props} />;
  if (props.mode === 'list-mini') return <ListMiniBody {...props} />;
  return <ListBody {...props} />;
}

/** 이 보기가 목록에 담을 것 — 원본 `listSrc`: 목록 보기는 **이번 주**를 센다. */
function listSource(entries: readonly CalendarEntry[], todayIso: string, weekOffset: number, side: CalWidgetSide, selDay: string): CalendarEntry[] {
  if (side === 'day') return entriesOn(entries, selDay);
  const from = addDays(weekStartISO(todayIso), weekOffset * 7);
  const to = addDays(from, 6);
  return entries.filter((e) => e.due >= from && e.due <= to).sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
}

/**
 * 목록의 이름표(요청) — 이번 주는 `이번 주 마감`, 다른 주는 **`8월 3주 마감`**.
 * 주 이름은 `weekLabel` 한 곳에서 나오므로 주간 보기의 머리와 문구가 갈리지 않는다.
 */
function listTitle(side: CalWidgetSide, selDay: string, todayIso: string, weekOffset: number): string {
  if (side === 'day') return dayTitle(selDay);
  return `${weekName(todayIso, weekOffset)} 마감`;
}

/** 보이는 주의 이름 — 이번 주면 `이번 주`, 아니면 `8월 3주`. */
function weekName(todayIso: string, weekOffset: number): string {
  return weekOffset === 0 ? '이번 주' : weekLabel(addDays(weekStartISO(todayIso), weekOffset * 7));
}

/** 목록 — 가장 작은 보기. 이번 주 마감(또는 고른 날)을 크기만큼 보여 준다. */
function ListBody({ entries, todayIso, cols, rows, surface, weekOffset, side, selDay, onPickEntry }: CalWidgetProps) {
  const cap = rows >= 2 ? 7 : cols >= 2 ? 3 : 2;
  const src = useMemo(() => listSource(entries, todayIso, weekOffset, side, selDay), [entries, todayIso, weekOffset, side, selDay]);
  return (
    <div data-cal-widget-list style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '8px 7px 7px', overflow: 'hidden' }}>
      <SectionLabel>{listTitle(side, selDay, todayIso, weekOffset)}</SectionLabel>
      <DeadlineList src={src} cap={cap} todayIso={todayIso} surface={surface} showTime={side === 'day'} empty={side === 'day' ? '이 날에는 일정이 없어요' : `${weekName(todayIso, weekOffset)} 마감이 없어요`} onPickEntry={onPickEntry} />
    </div>
  );
}

/** 1열 + 높이 — 위는 이번 주 마감, 아래는 일정 화면과 **같은 미니 달력**(요청). */
function ListMiniBody({ entries, todayIso, rows, surface, ym, weekOffset, side, selDay, onPickDay, onPickEntry, onSetMonth, holidays }: CalWidgetProps) {
  const src = useMemo(() => listSource(entries, todayIso, weekOffset, side, selDay), [entries, todayIso, weekOffset, side, selDay]);
  return (
    <div data-cal-widget-listmini style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '8px 7px 7px', overflow: 'hidden' }}>
        <SectionLabel>{listTitle(side, selDay, todayIso, weekOffset)}</SectionLabel>
        <DeadlineList src={src} cap={rows >= 4 ? 6 : 3} todayIso={todayIso} surface={surface} showTime={side === 'day'} empty={side === 'day' ? '이 날에는 일정이 없어요' : `${weekName(todayIso, weekOffset)} 마감이 없어요`} onPickEntry={onPickEntry} />
      </div>
      <div style={{ flexShrink: 0, padding: '10px 12px 12px', borderTop: '1px solid var(--mf-hairline)' }}>
        <MiniCalendar entries={entries} todayIso={todayIso} y={ym.y} m={ym.m} selectedDay={side === 'day' ? selDay : ''} onPickDay={onPickDay} onSetMonth={onSetMonth} holidays={holidays} cellH={24} />
      </div>
    </div>
  );
}

/** 마감 목록 — 세 보기가 함께 쓴다(같은 것을 두 벌로 두지 않는다). */
function DeadlineList({
  src,
  cap,
  todayIso,
  surface,
  showTime,
  empty,
  onPickEntry,
}: {
  src: readonly CalendarEntry[];
  cap: number;
  todayIso: string;
  surface: ChipSurface;
  showTime?: boolean;
  empty: string;
  onPickEntry: (e: CalendarEntry) => void;
}) {
  const shown = src.slice(0, cap);
  if (shown.length === 0) return <Empty>{empty}</Empty>;
  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 1 }}>
      {shown.map((e) => (
        <Row key={rowKey(e)} entry={e} todayIso={todayIso} surface={surface} showTime={showTime} onPick={onPickEntry} />
      ))}
      {src.length > shown.length && <span style={{ fontSize: 10.5, color: 'var(--mf-faint2)', padding: '2px 7px' }}>+{src.length - shown.length}개 더</span>}
    </div>
  );
}

/**
 * 주간 — 요일 일곱 줄(원본 `calWeek`). 본문이 이미 날짜별이라 마감/날짜별 토글은
 * 없지만, **3열 이상**(3×2·4×2)에는 일정 화면 오른쪽 위의 그 미니 달력을 옆 패널로
 * 둔다(요청) — 주간만 보면 "지금 이 주가 달의 어디쯤인가"를 알 수 없다.
 */
function WeekBody({ entries, todayIso, cols, rows, surface, ym, weekOffset, selDay, onPickDay, onPickEntry, onSetMonth, holidays }: CalWidgetProps) {
  const start = addDays(weekStartISO(todayIso), weekOffset * 7);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(start, i)), [start]);
  const withSide = cols >= 3;
  const maxPer = rows >= 3 ? 3 : cols >= 3 ? 2 : 1;
  const a = partsOf(start);
  const b = partsOf(addDays(start, 6));
  const range = a && b ? `${a.m}.${a.d} – ${b.m}.${b.d}` : '';
  const body = (
    <div data-cal-widget-week style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '8px 9px 7px', overflow: 'hidden' }}>
      <SectionLabel pad="0 4px 6px">
        {weekName(todayIso, weekOffset)} · {range}
      </SectionLabel>
      {/* 일곱 줄이 높이를 나눠 갖는다 — 위에 몰리고 아래가 비면 위젯이 반쯤 빈 것처럼
          보인다(2×2에서는 한 줄이 30px 남짓이라 칩 하나가 딱 들어간다). */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 1 }}>
        {days.map((iso, i) => {
          const list = entriesOn(entries, iso);
          const bars = list.filter(isSpan);
          const singles = list.filter((e) => !isSpan(e));
          const shown = singles.slice(0, Math.max(0, maxPer - bars.length));
          const moreN = singles.length - shown.length;
          const isToday = iso === todayIso;
          const n = partsOf(iso)?.d ?? '';
          return (
            <div key={iso} style={{ flex: '1 1 0', minHeight: 0, overflow: 'hidden', display: 'flex', alignItems: 'flex-start', gap: 8, padding: '3px 5px', borderRadius: 9, background: isToday ? 'var(--mf-cal-sel)' : 'transparent', minWidth: 0 }}>
              <span style={{ flex: '0 0 44px', display: 'flex', alignItems: 'center', gap: 5, paddingTop: 1 }}>
                <span style={{ width: 13, fontSize: 11, fontWeight: 700, textAlign: 'center', color: i === 0 ? 'var(--mf-danger)' : i === 6 ? 'var(--mf-info)' : 'var(--mf-faint)' }}>{DOW[i]}</span>
                <span style={{ width: 20, height: 20, borderRadius: 999, background: isToday ? 'var(--mf-accent)' : 'transparent', color: isToday ? 'var(--mf-accent-ink)' : list.length ? 'var(--mf-text)' : 'var(--mf-faint2)', fontSize: 12, fontWeight: 800, ...MONO, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{n}</span>
              </span>
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                {bars.map((e) => (
                  <Bar key={`bar-${rowKey(e)}`} entry={e} iso={iso} dow={i} surface={surface} h={17} onPick={onPickEntry} />
                ))}
                {shown.map((e) => (
                  <Chip key={rowKey(e)} entry={e} todayIso={todayIso} surface={surface} compact={cols < 3} onPick={onPickEntry} />
                ))}
                {moreN > 0 && <span style={{ fontSize: 10.5, color: 'var(--mf-faint2)', padding: '0 6px' }}>+{moreN}개 더</span>}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
  if (!withSide) return body;
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', minWidth: 0, overflow: 'hidden' }}>
      <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', borderRight: '1px solid var(--mf-hairline)' }}>{body}</div>
      <div data-cal-widget-side="mini" style={{ flex: `0 0 ${MINI_SIDE_W}px`, minWidth: 0, padding: 8, display: 'flex', overflow: 'hidden' }}>
        {/* 옆 패널을 **꽉 채운다**(제보: 아래에 빈 여백이 남는다) — 여섯 줄이 남은
            높이를 나눠 갖고, 폭도 칸이 정사각에 가깝도록 잡았다(2행 위젯 높이 기준). */}
        <MiniCalendar entries={entries} todayIso={todayIso} y={ym.y} m={ym.m} selectedDay={selDay} onPickDay={onPickDay} onSetMonth={onSetMonth} holidays={holidays} fill />
      </div>
    </div>
  );
}

/** 월간 — 달력(+ 옆 패널). 3열은 달력만 그린다(요청 — 옆 패널까지 넣으면 칸이 좁다). */
function MonthBody({ entries, todayIso, mode, cols, rows, surface, ym, side, selDay, onPickDay, onPickEntry, holidays, onNewOnDay }: CalWidgetProps) {
  const withSide = mode === 'month';
  const perCell = rows >= 4 ? 2 : 1;
  const cells = useMemo(() => monthCells(ym.y, ym.m, entries, todayIso, perCell, 6, holidays), [ym.y, ym.m, entries, todayIso, perCell, holidays]);
  return (
    <div data-cal-widget-month style={{ flex: 1, minHeight: 0, display: 'flex', minWidth: 0, overflow: 'hidden' }}>
      <div style={{ flex: withSide ? '1 1 75%' : '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5, padding: '9px 11px 10px', borderRight: withSide ? '1px solid var(--mf-hairline)' : 0 }}>
        <span style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--mf-subtext)', letterSpacing: '-.01em', paddingBottom: 1 }}>{monthLabel(ym.y, ym.m)}</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3, flexShrink: 0 }}>
          {DOW.map((d, i) => (
            <span key={d} style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.04em', color: i === 0 ? 'var(--mf-danger)' : i === 6 ? 'var(--mf-info)' : 'var(--mf-faint2)', textAlign: 'center' }}>
              {d}
            </span>
          ))}
        </div>
        <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gridAutoRows: '1fr', gap: 3 }}>
          {cells.map((c) => {
            const on = withSide && c.inMonth && c.iso === selDay;
            // 칸 배경 — 큰 달력과 같은 규칙(주말·공휴일 톤, 고른 날은 면만 바뀐다).
            const bg = !c.inMonth
              ? 'var(--mf-cal-out)'
              : on
                ? 'var(--mf-cal-sel)'
                : c.holiday || c.dow === 0
                  ? 'var(--mf-cal-sun)'
                  : c.dow === 6
                    ? 'var(--mf-cal-sat)'
                    : 'var(--mf-card)';
            const cellInner = (
              <>
                <span style={{ display: 'flex', alignItems: 'center', gap: 3, minWidth: 0, flex: '0 0 auto' }}>
                  <span
                    style={{
                      width: 19,
                      height: 19,
                      flex: '0 0 auto',
                      borderRadius: 999,
                      // 고른 날은 **면만** 바뀐다(요청) — 숫자에까지 주황을 칠하면
                      // 오늘 표시와 구별되지 않는다.
                      background: c.isToday ? 'var(--mf-accent)' : 'transparent',
                      color: c.isToday
                        ? 'var(--mf-accent-ink)'
                        : !c.inMonth
                          ? 'var(--mf-faint2)'
                          : c.holiday || c.dow === 0
                            ? 'var(--mf-danger)'
                            : c.dow === 6
                              ? 'var(--mf-info)'
                              : 'var(--mf-subtext)',
                      fontSize: 12,
                      fontWeight: c.isToday ? 800 : 600,
                      ...MONO,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {c.n}
                  </span>
                  {c.holiday && <span style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--mf-danger)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.holiday}</span>}
                </span>
                {c.bars.map((b) => (
                  <Bar key={`bar-${rowKey(b.entry)}`} entry={b.entry} label={b.label} head={b.head} tail={b.tail} surface={surface} h={15} onPick={onPickEntry} />
                ))}
                {c.entries.map((e) => (
                  <Chip key={rowKey(e)} entry={e} todayIso={todayIso} surface={surface} compact={cols < 4} small onPick={onPickEntry} />
                ))}
                {c.moreN > 0 && <span style={{ fontSize: 10, color: 'var(--mf-faint2)', padding: '0 3px' }}>+{c.moreN}</span>}
              </>
            );
            const cellStyle = {
              borderRadius: 8,
              // 칸 테두리 — 디자인 원본의 `bd`(오늘만 강조색). 예전에는 투명이라
              // 격자가 통째로 사라져 보였다(제보).
              border: `1px solid ${c.isToday ? 'var(--mf-accent-mute)' : c.inMonth ? 'var(--mf-cal-grid)' : 'transparent'}`,
              background: bg,
              padding: '3px 3px 2px',
              display: 'flex',
              flexDirection: 'column' as const,
              gap: 2,
              minWidth: 0,
              minHeight: 0,
              overflow: 'hidden',
              font: 'inherit',
            };
            // 옆 패널이 없는 보기(3열)에서는 날짜 칸이 **누를 대상이 아니다** —
            // 고른 날을 보여 줄 자리가 없으므로 손가락 커서를 내주지 않는다.
            // 빈 자리 더블클릭 = 그 날짜로 새 일정(요청). 칩 위에서 온 것은 그
            // 항목의 일이라 손대지 않는다(일정 화면의 `MonthGrid`와 같은 규칙).
            const dbl =
              c.inMonth && onNewOnDay
                ? (e: ReactMouseEvent) => {
                    if ((e.target as HTMLElement).closest('[data-cal-widget-chip],[data-cal-widget-bar]')) return;
                    e.stopPropagation();
                    e.preventDefault();
                    onNewOnDay(c.iso);
                  }
                : undefined;
            if (!withSide) {
              return (
                <div key={c.iso} data-cal-widget-cell={c.iso} onDoubleClick={dbl} style={{ ...cellStyle, cursor: 'default' }}>
                  {cellInner}
                </div>
              );
            }
            return (
              <button
                key={c.iso}
                type="button"
                data-cal-widget-cell={c.iso}
                data-on={on ? '1' : undefined}
                disabled={!c.inMonth}
                title={c.inMonth ? `${partsOf(c.iso)!.m}월 ${c.n}일 일정 보기` : ''}
                onClick={(e) => {
                  e.stopPropagation();
                  onPickDay(c.iso);
                }}
                onDoubleClick={dbl}
                style={{ ...cellStyle, cursor: c.inMonth ? 'pointer' : 'default' }}
              >
                {cellInner}
              </button>
            );
          })}
        </div>
      </div>
      {withSide && <MonthSide entries={entries} todayIso={todayIso} rows={rows} surface={surface} side={side} selDay={selDay} onPickEntry={onPickEntry} />}
    </div>
  );
}

/** 월간의 옆 패널 — 다가오는 마감(`dl`) 또는 고른 날의 시간표(`day`). */
function MonthSide({
  entries,
  todayIso,
  rows,
  surface,
  side,
  selDay,
  onPickEntry,
}: Pick<CalWidgetProps, 'entries' | 'todayIso' | 'rows' | 'surface' | 'side' | 'selDay' | 'onPickEntry'>) {
  const day = side === 'day';
  const list = useMemo(() => upcomingEntries(entries, todayIso), [entries, todayIso]);
  return (
    <div data-cal-widget-side={side} style={{ flex: '1 1 25%', minWidth: 0, display: 'flex', flexDirection: 'column', padding: '9px 7px 7px', overflow: 'hidden' }}>
      <SectionLabel>{day ? dayTitle(selDay) : '다가오는 마감'}</SectionLabel>
      {day ? (
        <DaySide entries={entries} todayIso={todayIso} iso={selDay} surface={surface} onPickEntry={onPickEntry} />
      ) : (
        <DeadlineList src={list} cap={rows >= 4 ? 8 : 5} todayIso={todayIso} surface={surface} empty="다가오는 마감이 없어요" onPickEntry={onPickEntry} />
      )}
    </div>
  );
}

/** 고른 날 — 종일 항목 띠 + 24시간 시간표(원본 `calDayAllDay`/`calDayHours`). */
function DaySide({
  entries,
  todayIso,
  iso,
  surface,
  onPickEntry,
}: {
  entries: readonly CalendarEntry[];
  todayIso: string;
  iso: string;
  surface: ChipSurface;
  onPickEntry: (e: CalendarEntry) => void;
}) {
  const timeline = useMemo(() => dayTimeline(entries, iso), [entries, iso]);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  // 첫 일정이 보이도록 맞춘다 — 자정부터 훑게 두지 않는다(원본 `calDayRef`).
  const first = timeline.blocks.length ? Math.min(...timeline.blocks.map((b) => b.from)) : 0;
  const focusTop = timeline.blocks.length ? Math.max(0, (first / 60) * ROW - 20) : 0;
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = focusTop;
  }, [focusTop, iso]);

  const empty = timeline.allDay.length === 0 && timeline.blocks.length === 0;
  const nowMin = (() => {
    if (iso !== todayIso) return null;
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  })();

  return (
    <>
      {timeline.allDay.length > 0 && (
        <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 2, padding: '0 4px 6px' }}>
          {timeline.allDay.map((e) => {
            const chip = entryChip(e, surface);
            return (
              <button
                key={rowKey(e)}
                type="button"
                data-cal-widget-allday={rowKey(e)}
                title={`${e.title} · ${e.boardName}`}
                onClick={(ev) => {
                  ev.stopPropagation();
                  onPickEntry(e);
                }}
                style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', boxSizing: 'border-box', padding: '5px 8px', border: 0, borderLeft: `3px solid ${chip.dot}`, borderRadius: '3px 8px 8px 3px', background: chip.bg, cursor: 'pointer', font: 'inherit', textAlign: 'left', minWidth: 0 }}
              >
                <span data-cal-widget-allday-title style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: 'var(--mf-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.title || '제목 없음'}</span>
                <span style={{ flex: '0 0 auto', fontSize: 11, color: 'var(--mf-muted)', whiteSpace: 'nowrap' }}>{e.colName}</span>
              </button>
            );
          })}
        </div>
      )}
      {/* 빈 날 — 안내만 둔다(요청: `일정 추가` 버튼 제거). 새 일정은 머리의 ＋가 맡는다. */}
      {empty && <Empty>이 날에는 일정이 없어요</Empty>}
      <div ref={bodyRef} className="mf-cal-scroll" data-cal-widget-timeline style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 4px 4px' }}>
        <div style={{ position: 'relative', height: ROW * 24, display: 'flex', flexDirection: 'column' }}>
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, height: ROW, flex: '0 0 auto' }}>
              <span style={{ flex: '0 0 26px', textAlign: 'right', ...MONO, fontSize: 9.5, color: 'var(--mf-faint2)', transform: 'translateY(-4px)', whiteSpace: 'nowrap' }}>{hourLabel(h)}</span>
              <span style={{ flex: 1, minWidth: 0, borderTop: '1px solid var(--mf-border-soft)', display: 'block' }} />
            </span>
          ))}
          {nowMin !== null && (
            <span data-cal-widget-now style={{ position: 'absolute', left: 30, right: 0, top: (nowMin / 60) * ROW, display: 'flex', alignItems: 'center', pointerEvents: 'none' }}>
              <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--mf-accent)', display: 'block', flex: '0 0 auto', marginLeft: -3 }} />
              <span style={{ flex: 1, height: 1.5, background: 'var(--mf-accent)', display: 'block' }} />
            </span>
          )}
          {timeline.blocks.map((b) => {
            const chip = entryChip(b.entry, surface);
            const n = b.lanes;
            return (
              <button
                key={rowKey(b.entry)}
                type="button"
                data-cal-widget-block={b.entry.cardId}
                title={b.entry.title}
                onClick={(e) => {
                  e.stopPropagation();
                  onPickEntry(b.entry);
                }}
                style={{
                  position: 'absolute',
                  left: `calc(34px + (100% - 36px) * ${b.lane} / ${n})`,
                  width: `calc((100% - 36px) / ${n} - ${n > 1 ? 2 : 0}px)`,
                  top: (b.from / 60) * ROW,
                  height: Math.max(22, ((b.to - b.from) / 60) * ROW - 2),
                  boxSizing: 'border-box',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  padding: '2px 6px',
                  border: 0,
                  borderLeft: `3px solid ${chip.dot}`,
                  borderRadius: '3px 7px 7px 3px',
                  background: chip.bg,
                  boxShadow: n > 1 ? '0 0 0 1.5px var(--mf-card)' : 'none',
                  cursor: 'pointer',
                  font: 'inherit',
                  textAlign: 'left',
                  overflow: 'hidden',
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: '-.015em', color: 'var(--mf-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.entry.title || '제목 없음'}</span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

/** 목록 한 줄 — 배지 + 제목 + 상태 점(원본 `calSideList`). */
function Row({ entry, todayIso, surface, showTime, onPick }: { entry: CalendarEntry; todayIso: string; surface: ChipSurface; showTime?: boolean; onPick: (e: CalendarEntry) => void }) {
  const chip = entryChip(entry, surface);
  // 날짜별 보기에서는 "며칠 남았나"가 뜻이 없다 — 그 날의 시각(없으면 종일)을 쓴다.
  const badge = showTime ? entry.startTime || '종일' : dueBadge(entry.due, todayIso);
  const over = !showTime && entry.due < todayIso;
  const today = !showTime && entry.due === todayIso;
  return (
    <button
      type="button"
      data-cal-widget-row={rowKey(entry)}
      className="mf-ctl"
      title={`${entry.title} · ${entry.boardName}`}
      onClick={(e) => {
        e.stopPropagation();
        onPick(entry);
      }}
      style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 6px', border: 0, borderRadius: 8, background: 'transparent', font: 'inherit', textAlign: 'left', minWidth: 0, cursor: 'pointer', flexShrink: 0 }}
    >
      <span style={{ flex: '0 0 auto', minWidth: 38, height: 19, padding: '0 6px', borderRadius: 6, background: today ? 'var(--mf-accent-soft)' : over ? 'var(--mf-danger-bg)' : 'var(--mf-panel2)', color: today ? 'var(--mf-accent-strong)' : over ? 'var(--mf-danger)' : 'var(--mf-muted)', fontSize: 10.5, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', whiteSpace: 'nowrap' }}>{badge}</span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: 'var(--mf-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.title || '제목 없음'}</span>
      <span style={{ width: 5, height: 5, borderRadius: 999, background: chip.dot, flex: '0 0 auto', display: 'block' }} />
    </button>
  );
}

/**
 * 칸·주간 줄의 항목 칩 — 원본 `calChip`의 Geurio 문법(분류색 필 + 상태 점).
 * 지난 것은 흐리게(`op: .6`), 좁으면 시각을 접는다(`compact`).
 */
function Chip({ entry, todayIso, surface, compact, small, onPick }: { entry: CalendarEntry; todayIso: string; surface: ChipSurface; compact: boolean; small?: boolean; onPick: (e: CalendarEntry) => void }) {
  const chip = entryChip(entry, surface);
  const time = !compact && entry.startTime ? `${entry.startTime} ` : '';
  return (
    <button
      type="button"
      data-cal-widget-chip={rowKey(entry)}
      title={`${entry.title} · ${entry.boardName}`}
      onClick={(e) => {
        e.stopPropagation();
        onPick(entry);
      }}
      className="mf-cal-chip-btn"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: small ? 4 : 5,
        width: '100%',
        boxSizing: 'border-box',
        padding: small ? '1px 6px' : '3px 8px',
        borderRadius: 999,
        border: 0,
        background: chip.bg,
        color: chip.fg,
        font: 'inherit',
        minWidth: 0,
        textAlign: 'left',
        cursor: 'pointer',
        opacity: entry.due < todayIso ? 0.6 : 1,
      }}
    >
      <span style={{ width: 4, height: 4, borderRadius: 999, background: chip.dot, flex: '0 0 auto', display: 'block' }} />
      <span style={{ flex: 1, minWidth: 0, fontSize: small ? 11.5 : 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {time}
        {entry.title || '제목 없음'}
      </span>
    </button>
  );
}

/** 기간 바 한 조각 — 양 끝만 둥글다(달력 격자와 같은 규칙: 칸마다 한 조각). */
function Bar({
  entry,
  iso,
  dow,
  label,
  head,
  tail,
  surface,
  h,
  onPick,
}: {
  entry: CalendarEntry;
  iso?: string;
  dow?: number;
  label?: boolean;
  head?: boolean;
  tail?: boolean;
  surface: ChipSurface;
  h: number;
  onPick: (e: CalendarEntry) => void;
}) {
  const chip = entryChip(entry, surface);
  const isHead = head ?? (iso ? entry.start === iso : false);
  const isTail = tail ?? (iso ? entry.due === iso : false);
  const showLabel = label ?? (isHead || dow === 0);
  return (
    <button
      type="button"
      data-cal-widget-bar={rowKey(entry)}
      title={`${entry.title} · ${entry.boardName}`}
      onClick={(e) => {
        e.stopPropagation();
        onPick(entry);
      }}
      style={{
        display: 'block',
        width: '100%',
        boxSizing: 'border-box',
        height: h,
        lineHeight: `${h}px`,
        border: 0,
        padding: showLabel ? '0 6px' : 0,
        background: chip.bg,
        color: chip.fg,
        borderRadius: `${isHead ? 6 : 2}px ${isTail ? 6 : 2}px ${isTail ? 6 : 2}px ${isHead ? 6 : 2}px`,
        font: 'inherit',
        fontSize: h > 15 ? 12 : 11,
        fontWeight: 800,
        textAlign: 'left',
        cursor: 'pointer',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      {showLabel ? entry.title : ''}
    </button>
  );
}

function SectionLabel({ children, pad = '1px 6px 5px' }: { children: React.ReactNode; pad?: string }) {
  return <span style={{ flexShrink: 0, fontSize: 11.5, fontWeight: 800, letterSpacing: '.04em', color: 'var(--mf-faint2)', padding: pad }}>{children}</span>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <span style={{ padding: '7px 7px', fontSize: 11.5, color: 'var(--mf-faint)' }}>{children}</span>;
}

function rowKey(e: CalendarEntry): string {
  return `${e.docId}:${e.cardId}`;
}

/** `8월 29일` — 옆 패널·목록의 날짜 제목(원본 `calSideTitle`). */
export function dayTitle(iso: string): string {
  const p = partsOf(iso);
  return p ? `${p.m}월 ${p.d}일` : '';
}

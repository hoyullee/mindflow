/**
 * 대시보드 캘린더 위젯 — 디자인 원본 `Geurio 일정 캘린더.dc.html`의 `isCal` 위젯.
 *
 * **크기가 보기를 정한다**(`calWidgetMode`): 작으면 목록, 2×2부터 주간 일곱 줄,
 * 4×3부터 월간(달력 + 옆 패널). 고를 것을 따로 두지 않는 이유는 크기가 이미
 * "얼마나 보여 줄까"를 말하기 때문이다.
 *
 * **위젯 안에서 끝난다**(원본 `onDay`) — 날짜 칸을 누르면 그 자리에서 옆 패널이
 * 그 날로 바뀌고, 항목을 누르면 상세 팝업이 뜬다. 예전에는 어느 자리를 눌러도
 * 일정 화면으로 떠났는데, 날짜 칸이 몸통을 통째로 덮으므로 사실상 "아무 데나
 * 클릭하면 화면이 바뀐다"였다(제보). 화면을 옮기는 문은 "일정 열기" 하나다.
 *
 * 항목의 원천은 일정 화면과 **같다**(칸반 마감 + Geurio 일정) — 여기서 다시 모으지
 * 않고 `entries`를 받는다.
 */

import { useEffect, useMemo, useRef } from 'react';
import type { CalendarEntry } from '../calendar/entries';
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
  weekStartISO,
} from '../calendar/model';

const MONO = { fontFamily: "'JetBrains Mono', monospace" } as const;

/** 위젯 시간표 한 행(px) — 원본 `this.dayTimeline(sel, evs, 26)`. */
const ROW = 26;

/** 옆 패널이 무엇을 보여 주는가 — 다가오는 마감 / 고른 날짜(원본 `wcalSide`). */
export type CalWidgetSide = 'dl' | 'day';

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
  side: CalWidgetSide;
  /** 옆 패널이 보여 주는 날(기본은 오늘). */
  selDay: string;
  /** 날짜 칸을 누르면 — **화면을 옮기지 않고** 옆 패널을 그 날로 바꾼다. */
  onPickDay: (iso: string) => void;
  /** 항목을 누르면 상세 팝업. */
  onPickEntry: (e: CalendarEntry) => void;
  /** 빈 날의 `일정 추가`. */
  onNewEvent: (iso: string) => void;
}

export function CalWidgetBody(props: CalWidgetProps) {
  if (props.mode === 'month') return <MonthBody {...props} />;
  if (props.mode === 'week') return <WeekBody {...props} />;
  return <ListBody {...props} />;
}

/** 목록 — 가장 작은 보기. 이번 주 마감(또는 고른 날)을 크기만큼 보여 준다. */
function ListBody({ entries, todayIso, cols, rows, surface, weekOffset, side, selDay, onPickEntry }: CalWidgetProps) {
  const cap = rows >= 2 ? 8 : cols >= 2 ? 4 : 3;
  const day = side === 'day';
  // 원본 `listSrc`: 목록 보기는 **이번 주**를 센다(월간·주간의 "다가오는 마감"과 다르다).
  const src = useMemo(() => {
    if (day) return entriesOn(entries, selDay);
    const from = addDays(weekStartISO(todayIso), weekOffset * 7);
    const to = addDays(from, 6);
    return entries.filter((e) => e.due >= from && e.due <= to).sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
  }, [entries, day, selDay, todayIso, weekOffset]);
  const shown = src.slice(0, cap);
  const title = day ? dayTitle(selDay) : `${weekOffset === 0 ? '이번 주' : '주간'} 마감`;
  return (
    <div data-cal-widget-list style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '7px 6px 6px', overflow: 'hidden' }}>
      <SectionLabel>{title}</SectionLabel>
      {shown.length === 0 ? (
        <Empty>{day ? '이 날에는 일정이 없어요' : '이번 주 마감이 없어요'}</Empty>
      ) : (
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 1 }}>
          {shown.map((e) => (
            <Row key={rowKey(e)} entry={e} todayIso={todayIso} surface={surface} showTime={day} onPick={onPickEntry} />
          ))}
          {src.length > shown.length && <span style={{ fontSize: 8.5, color: 'var(--mf-faint2)', padding: '1px 6px' }}>+{src.length - shown.length}개 더</span>}
        </div>
      )}
    </div>
  );
}

/** 주간 — 요일 일곱 줄(원본 `calWeek`). 본문이 이미 날짜별이라 옆 패널이 없다. */
function WeekBody({ entries, todayIso, cols, rows, surface, weekOffset, onPickEntry }: CalWidgetProps) {
  const start = addDays(weekStartISO(todayIso), weekOffset * 7);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(start, i)), [start]);
  const maxPer = rows >= 3 ? 3 : cols >= 3 ? 2 : 1;
  const a = partsOf(start);
  const b = partsOf(addDays(start, 6));
  const range = a && b ? `${a.m}.${a.d} – ${b.m}.${b.d}` : '';
  return (
    <div data-cal-widget-week style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '8px 8px 6px', overflow: 'hidden' }}>
      <SectionLabel pad="0 4px 5px">
        {weekOffset === 0 ? '이번 주' : '주간'} · {range}
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
            <div key={iso} style={{ flex: '1 1 0', minHeight: 0, overflow: 'hidden', display: 'flex', alignItems: 'flex-start', gap: 7, padding: '3px 4px', borderRadius: 8, background: isToday ? 'var(--mf-cal-sel)' : 'transparent', minWidth: 0 }}>
              <span style={{ flex: '0 0 38px', display: 'flex', alignItems: 'center', gap: 4, paddingTop: 1 }}>
                <span style={{ width: 12, fontSize: 8.5, fontWeight: 700, textAlign: 'center', color: i === 0 ? 'var(--mf-danger)' : i === 6 ? 'var(--mf-info)' : 'var(--mf-faint)' }}>{DOW[i]}</span>
                <span style={{ width: 16, height: 16, borderRadius: 999, background: isToday ? 'var(--mf-accent)' : 'transparent', color: isToday ? 'var(--mf-accent-ink)' : list.length ? 'var(--mf-text)' : 'var(--mf-faint2)', fontSize: 8.5, fontWeight: 800, ...MONO, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{n}</span>
              </span>
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                {bars.map((e) => (
                  <Bar key={`bar-${rowKey(e)}`} entry={e} iso={iso} dow={i} surface={surface} h={13} onPick={onPickEntry} />
                ))}
                {shown.map((e) => (
                  <Chip key={rowKey(e)} entry={e} todayIso={todayIso} surface={surface} compact={cols < 3} onPick={onPickEntry} />
                ))}
                {moreN > 0 && <span style={{ fontSize: 8, color: 'var(--mf-faint2)', padding: '0 6px' }}>+{moreN}개 더</span>}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 월간 — 달력(75%) + 옆 패널(25%). 원본 `calModeMonth`. */
function MonthBody({ entries, todayIso, cols, rows, surface, ym, side, selDay, onPickDay, onPickEntry, onNewEvent }: CalWidgetProps) {
  const perCell = rows >= 4 ? 2 : 1;
  const cells = useMemo(() => monthCells(ym.y, ym.m, entries, todayIso, perCell), [ym.y, ym.m, entries, todayIso, perCell]);
  return (
    <div data-cal-widget-month style={{ flex: 1, minHeight: 0, display: 'flex', minWidth: 0, overflow: 'hidden' }}>
      <div style={{ flex: '1 1 75%', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 10px 9px', borderRight: '1px solid var(--mf-hairline)' }}>
        <span style={{ fontSize: 9.5, fontWeight: 800, color: 'var(--mf-subtext)', letterSpacing: '-.01em', paddingBottom: 1 }}>{monthLabel(ym.y, ym.m)}</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3, flexShrink: 0 }}>
          {DOW.map((d) => (
            <span key={d} style={{ fontSize: 8, fontWeight: 800, letterSpacing: '.04em', color: 'var(--mf-faint2)', textAlign: 'center' }}>
              {d}
            </span>
          ))}
        </div>
        <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gridAutoRows: '1fr', gap: 3 }}>
          {cells.map((c) => {
            const on = c.inMonth && c.iso === selDay;
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
                style={{
                  borderRadius: 8,
                  border: `1px solid ${c.isToday ? 'var(--mf-accent-mute)' : 'transparent'}`,
                  background: on ? 'var(--mf-cal-sel)' : c.inMonth ? 'var(--mf-card)' : 'var(--mf-cal-out)',
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
                <span style={{ display: 'flex', alignItems: 'center', gap: 3, minWidth: 0, flex: '0 0 auto' }}>
                  <span
                    style={{
                      width: 15,
                      height: 15,
                      flex: '0 0 auto',
                      borderRadius: 999,
                      background: on || c.isToday ? 'var(--mf-accent)' : 'transparent',
                      color: on || c.isToday ? 'var(--mf-accent-ink)' : c.inMonth ? 'var(--mf-subtext)' : 'var(--mf-faint2)',
                      fontSize: 8,
                      fontWeight: c.isToday || on ? 800 : 600,
                      ...MONO,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {c.n}
                  </span>
                  {c.holiday && <span style={{ fontSize: 7, fontWeight: 700, color: 'var(--mf-danger)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.holiday}</span>}
                </span>
                {c.bars.map((b) => (
                  <Bar key={`bar-${rowKey(b.entry)}`} entry={b.entry} label={b.label} head={b.head} tail={b.tail} surface={surface} h={10} onPick={onPickEntry} />
                ))}
                {c.entries.map((e) => (
                  <Chip key={rowKey(e)} entry={e} todayIso={todayIso} surface={surface} compact={cols < 3} small onPick={onPickEntry} />
                ))}
                {c.moreN > 0 && <span style={{ fontSize: 7.5, color: 'var(--mf-faint2)', padding: '0 3px' }}>+{c.moreN}</span>}
              </button>
            );
          })}
        </div>
      </div>
      <MonthSide entries={entries} todayIso={todayIso} rows={rows} surface={surface} side={side} selDay={selDay} onPickEntry={onPickEntry} onNewEvent={onNewEvent} />
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
  onNewEvent,
}: Pick<CalWidgetProps, 'entries' | 'todayIso' | 'rows' | 'surface' | 'side' | 'selDay' | 'onPickEntry' | 'onNewEvent'>) {
  const day = side === 'day';
  const list = useMemo(() => upcomingEntries(entries, todayIso).slice(0, rows >= 3 ? 10 : 5), [entries, todayIso, rows]);
  return (
    <div data-cal-widget-side={side} style={{ flex: '1 1 25%', minWidth: 0, display: 'flex', flexDirection: 'column', padding: '8px 6px 6px', overflow: 'hidden' }}>
      <SectionLabel>{day ? dayTitle(selDay) : '다가오는 마감'}</SectionLabel>
      {day ? (
        <DaySide entries={entries} todayIso={todayIso} iso={selDay} surface={surface} onPickEntry={onPickEntry} onNewEvent={onNewEvent} />
      ) : list.length === 0 ? (
        <Empty>다가오는 마감이 없어요</Empty>
      ) : (
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 1 }}>
          {list.map((e) => (
            <Row key={rowKey(e)} entry={e} todayIso={todayIso} surface={surface} onPick={onPickEntry} />
          ))}
        </div>
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
  onNewEvent,
}: {
  entries: readonly CalendarEntry[];
  todayIso: string;
  iso: string;
  surface: ChipSurface;
  onPickEntry: (e: CalendarEntry) => void;
  onNewEvent: (iso: string) => void;
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
        <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 2, padding: '0 4px 5px' }}>
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
                style={{ display: 'flex', alignItems: 'center', gap: 5, width: '100%', boxSizing: 'border-box', padding: '3px 6px', border: 0, borderLeft: `2.5px solid ${chip.dot}`, borderRadius: '3px 6px 6px 3px', background: chip.bg, cursor: 'pointer', font: 'inherit', textAlign: 'left', minWidth: 0 }}
              >
                <span style={{ flex: 1, minWidth: 0, fontSize: 8.5, fontWeight: 700, color: 'var(--mf-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.title || '제목 없음'}</span>
                <span style={{ flex: '0 0 auto', fontSize: 7.5, color: 'var(--mf-muted)', whiteSpace: 'nowrap' }}>{e.colName}</span>
              </button>
            );
          })}
        </div>
      )}
      {empty && (
        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 5, padding: '6px 6px' }}>
          <span style={{ fontSize: 9, color: 'var(--mf-faint)' }}>이 날에는 일정이 없어요</span>
          <button
            type="button"
            data-cal-widget-daynew
            className="mf-ctl"
            onClick={(e) => {
              e.stopPropagation();
              onNewEvent(iso);
            }}
            style={{ height: 22, padding: '0 9px', borderRadius: 999, border: '1px solid var(--mf-border)', background: 'var(--mf-card)', color: 'var(--mf-muted)', font: 'inherit', fontSize: 9, fontWeight: 700, cursor: 'pointer' }}
          >
            일정 추가
          </button>
        </span>
      )}
      <div ref={bodyRef} className="lnb-scroll" data-cal-widget-timeline style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 4px 4px' }}>
        <div style={{ position: 'relative', height: ROW * 24, display: 'flex', flexDirection: 'column' }}>
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} style={{ display: 'flex', alignItems: 'flex-start', gap: 5, height: ROW, flex: '0 0 auto' }}>
              <span style={{ flex: '0 0 20px', textAlign: 'right', ...MONO, fontSize: 7, color: 'var(--mf-faint2)', transform: 'translateY(-3px)', whiteSpace: 'nowrap' }}>{hourLabel(h)}</span>
              <span style={{ flex: 1, minWidth: 0, borderTop: '1px solid var(--mf-border-soft)', display: 'block' }} />
            </span>
          ))}
          {nowMin !== null && (
            <span data-cal-widget-now style={{ position: 'absolute', left: 24, right: 0, top: (nowMin / 60) * ROW, display: 'flex', alignItems: 'center', pointerEvents: 'none' }}>
              <span style={{ width: 5, height: 5, borderRadius: 999, background: 'var(--mf-accent)', display: 'block', flex: '0 0 auto', marginLeft: -2.5 }} />
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
                  left: `calc(28px + (100% - 30px) * ${b.lane} / ${n})`,
                  width: `calc((100% - 30px) / ${n} - ${n > 1 ? 2 : 0}px)`,
                  top: (b.from / 60) * ROW,
                  height: Math.max(18, ((b.to - b.from) / 60) * ROW - 2),
                  boxSizing: 'border-box',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  padding: '2px 5px',
                  border: 0,
                  borderLeft: `2.5px solid ${chip.dot}`,
                  borderRadius: '3px 6px 6px 3px',
                  background: chip.bg,
                  boxShadow: n > 1 ? '0 0 0 1.5px var(--mf-card)' : 'none',
                  cursor: 'pointer',
                  font: 'inherit',
                  textAlign: 'left',
                  overflow: 'hidden',
                }}
              >
                <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: '-.015em', color: 'var(--mf-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.entry.title || '제목 없음'}</span>
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
      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 5px', border: 0, borderRadius: 7, background: 'transparent', font: 'inherit', textAlign: 'left', minWidth: 0, cursor: 'pointer', flexShrink: 0 }}
    >
      <span style={{ flex: '0 0 auto', minWidth: 30, height: 15, padding: '0 4px', borderRadius: 5, background: today ? 'var(--mf-accent-soft)' : over ? 'var(--mf-danger-bg)' : 'var(--mf-panel2)', color: today ? 'var(--mf-accent-strong)' : over ? 'var(--mf-danger)' : 'var(--mf-muted)', fontSize: 8, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', whiteSpace: 'nowrap' }}>{badge}</span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 9.5, fontWeight: 600, color: 'var(--mf-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.title || '제목 없음'}</span>
      <span style={{ width: 4, height: 4, borderRadius: 999, background: chip.dot, flex: '0 0 auto', display: 'block' }} />
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
        gap: small ? 3 : 5,
        width: '100%',
        boxSizing: 'border-box',
        padding: small ? '1px 5px' : '2px 7px',
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
      <span style={{ width: small ? 3 : 4, height: small ? 3 : 4, borderRadius: 999, background: chip.dot, flex: '0 0 auto', display: 'block' }} />
      <span style={{ flex: 1, minWidth: 0, fontSize: small ? 8 : 9, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
        padding: showLabel ? `0 ${h > 11 ? 5 : 4}px` : 0,
        background: chip.bg,
        color: chip.fg,
        borderRadius: `${isHead ? 5 : 2}px ${isTail ? 5 : 2}px ${isTail ? 5 : 2}px ${isHead ? 5 : 2}px`,
        font: 'inherit',
        fontSize: h > 11 ? 8 : 7,
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

function SectionLabel({ children, pad = '1px 5px 4px' }: { children: React.ReactNode; pad?: string }) {
  return <span style={{ flexShrink: 0, fontSize: 9.5, fontWeight: 800, letterSpacing: '.05em', color: 'var(--mf-faint2)', padding: pad }}>{children}</span>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <span style={{ padding: '6px 6px', fontSize: 9.5, color: 'var(--mf-faint)' }}>{children}</span>;
}

function rowKey(e: CalendarEntry): string {
  return `${e.docId}:${e.cardId}`;
}

/** `8월 29일` — 옆 패널·목록의 날짜 제목(원본 `calSideTitle`). */
export function dayTitle(iso: string): string {
  const p = partsOf(iso);
  return p ? `${p.m}월 ${p.d}일` : '';
}

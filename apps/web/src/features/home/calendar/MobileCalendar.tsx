// 모바일 「일정」 탭(모바일 홈 디자인 M3 · N6) — 달력엔 **점만**, 고른 날은 아래에서 읽는다.
//
// 데스크톱 달력은 칸마다 칩(제목)을 쌓는다. 폰 폭(한 칸 ≈ 52px)에서는 제목이 두세 글자에서
// 잘려 아무것도 읽히지 않았다 — 그래서 칸에는 **무엇이 있다는 점**(종류 색, 셋까지)만 두고,
// 고른 날의 일정은 달력 아래의 목록이 제목·시각·출처로 말한다(디자인). 데이터는 데스크톱과
// 같은 `CalendarEntry`·`MonthCell`이고, 항목을 누르면 같은 상세 팝업이 뜬다.
//
// 달 넘기기는 셋이다: 제목을 눌러 월 고르기 시트(N6), 달력을 좌우로 밀기, 시트의 ‹ ›.
// 달을 넘기면 고른 날도 그 달로 옮긴다(이번 달이면 오늘, 아니면 1일) — 고른 날이 화면
// 밖에 남으면 아래 목록이 보이지 않는 날을 말한다.

import { useEffect, useRef, useState } from 'react';
import type { CalendarEntry, HolidayInfo } from './entries';
import { type ChipSurface, entryChip, isDeclined } from './chips';
import { type CalendarBrief, type MonthCell, DOW, addMonth, dayProgress, entriesOn, isSpan, isoOf, minutesOf, partsOf, timeLabel } from './model';
import { MONO_FONT } from '../chrome';
import { Glyph, MobileSheet, SheetClose } from '../mobile/parts';

/** 칸 하나에 찍는 점의 수 — 그 이상은 세지 않는다(디자인: 셋까지). */
const DOTS_MAX = 3;
/** 이만큼 옆으로 밀면 달을 넘긴다 — 세로 스크롤과 갈라 보기 위해 가로가 세로의 1.5배여야 한다. */
const SWIPE_MIN = 56;

/** 그 날 칸에 찍을 점의 색 — 기간 바와 하루짜리를 합쳐 순서대로, 같은 항목은 한 번. */
function dotsOf(cell: MonthCell, surface: ChipSurface): string[] {
  const seen = new Set<CalendarEntry>();
  const out: string[] = [];
  for (const e of [...cell.bars.map((b) => b.entry), ...cell.entries]) {
    if (seen.has(e)) continue;
    seen.add(e);
    out.push(entryChip(e, surface).base);
    if (out.length >= DOTS_MAX) break;
  }
  return out;
}

/** 목록 줄의 둘째 줄 — 칸반은 `보드 · 열`(기간이면 며칠째), 일정은 출처와 장소. */
function subOf(e: CalendarEntry, iso: string): string {
  if (e.google) return ['Google', e.google.location].filter(Boolean).join(' · ');
  if (e.event) return ['Geurio', e.event.location].filter(Boolean).join(' · ');
  const prog = isSpan(e) ? dayProgress(e, iso) : null;
  return [e.boardName, prog ?? e.colName].filter(Boolean).join(' · ');
}

function timeOf(e: CalendarEntry): string {
  const mins = minutesOf(e.startTime);
  return mins == null ? '종일' : timeLabel(mins);
}

function numColor(cell: MonthCell): string {
  if (cell.isToday) return 'var(--mf-accent-ink)';
  if (cell.dow === 0 || cell.dayOff) return 'var(--mf-cal-num-sun)';
  if (cell.dow === 6) return 'var(--mf-cal-num-sat)';
  return 'var(--mf-m-ink)';
}

interface Props {
  y: number;
  m: number;
  todayIso: string;
  selectedDay: string;
  cells: readonly MonthCell[];
  entries: readonly CalendarEntry[];
  holidays: Record<string, HolidayInfo>;
  brief: CalendarBrief;
  surface: ChipSurface;
  onSetMonth: (y: number, m: number) => void;
  onPickDay: (iso: string) => void;
  onPickEntry: (e: CalendarEntry) => void;
  onNewEvent: (iso: string) => void;
  /** 보여 줄 캘린더(N7) — 시트는 호출부가 띄운다(구글 목록 훅을 그쪽이 든다). */
  onOpenCalendars: () => void;
}

export function MobileCalendar({ y, m, todayIso, selectedDay, cells, entries, holidays, brief, surface, onSetMonth, onPickDay, onPickEntry, onNewEvent, onOpenCalendars }: Props) {
  const [monthSheet, setMonthSheet] = useState(false);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const today = partsOf(todayIso);

  /** 달을 옮기며 고른 날도 그 달로(이번 달이면 오늘). */
  const goMonth = (ny: number, nm: number) => {
    onSetMonth(ny, nm);
    onPickDay(today && today.y === ny && today.m === nm ? todayIso : isoOf(ny, nm, 1));
  };
  const shift = (delta: number) => {
    const t = addMonth(y, m, delta);
    goMonth(t.y, t.m);
  };

  const sel = partsOf(selectedDay);
  const selDow = sel ? new Date(sel.y, sel.m - 1, sel.d).getDay() : 0;
  const list = entriesOn(entries, selectedDay);
  const hol = holidays[selectedDay];
  const stats = [
    { key: 'over', label: '지난 마감', n: brief.overdue, color: brief.overdue ? 'var(--mf-cal-num-sun)' : 'var(--mf-m-faint)' },
    { key: 'today', label: '오늘', n: brief.today, color: brief.today ? 'var(--mf-accent)' : 'var(--mf-m-faint)' },
    { key: 'week', label: '이번 주', n: brief.week, color: brief.week ? '#c08a2e' : 'var(--mf-m-faint)' },
  ];

  return (
    <div data-m-cal style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--mf-m-bg)' }}>
      <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'flex-end', padding: '10px 20px 6px' }}>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--mf-m-faint)' }}>일정</span>
          <button
            type="button"
            className="btn"
            data-m-cal-title
            aria-haspopup="dialog"
            aria-label={`${y}년 ${m}월 · 달 고르기`}
            onClick={() => setMonthSheet(true)}
            style={{ display: 'inline-flex', alignItems: 'baseline', gap: 7, alignSelf: 'flex-start', border: 0, background: 'transparent', padding: 0, fontFamily: 'inherit', cursor: 'pointer' }}
          >
            <span style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-.03em', color: 'var(--mf-m-ink)' }}>{m}월</span>
            <span style={{ fontFamily: MONO_FONT, fontSize: 15, fontWeight: 500, color: 'var(--mf-m-faint)' }}>{y}</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--mf-m-faint)" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ alignSelf: 'center' }}>
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        </span>
        <button type="button" className="btn mf-m-press" data-m-cal-calendars aria-label="보여 줄 캘린더" title="보여 줄 캘린더" onClick={onOpenCalendars} style={{ width: 40, height: 40, flex: '0 0 auto', marginRight: -8, border: 0, borderRadius: 12, background: 'transparent', color: 'var(--mf-m-ink)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0, cursor: 'pointer' }}>
          <Glyph d={<path d="M4 7h16M7 12h10M10 17h4" />} size={21} width={2.2} />
        </button>
      </div>
      <div data-m-cal-stats style={{ flex: '0 0 auto', display: 'flex', alignItems: 'baseline', gap: 12, padding: '0 20px 10px', fontSize: 12.5, color: 'var(--mf-m-mut)', whiteSpace: 'nowrap', overflow: 'hidden' }}>
        {stats.map((s) => (
          <span key={s.key} data-m-cal-stat={s.key} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4 }}>
            {s.label}
            <span style={{ fontFamily: MONO_FONT, fontSize: 13, fontWeight: 600, color: s.color }}>{s.n}</span>
          </span>
        ))}
      </div>

      <div
        data-m-cal-grid
        onTouchStart={(e) => {
          const t = e.touches[0];
          touch.current = t ? { x: t.clientX, y: t.clientY } : null;
        }}
        onTouchEnd={(e) => {
          const s = touch.current;
          touch.current = null;
          const t = e.changedTouches[0];
          if (!s || !t) return;
          const dx = t.clientX - s.x;
          const dy = t.clientY - s.y;
          if (Math.abs(dx) >= SWIPE_MIN && Math.abs(dx) > Math.abs(dy) * 1.5) shift(dx < 0 ? 1 : -1);
        }}
        style={{ flex: '0 0 auto', borderTop: '1px solid var(--mf-m-line)', touchAction: 'pan-y' }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', padding: '6px 12px 2px' }}>
          {DOW.map((d, i) => (
            <span key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: 800, padding: '4px 0', color: i === 0 ? 'var(--mf-cal-num-sun)' : i === 6 ? 'var(--mf-cal-num-sat)' : 'var(--mf-m-faint)' }}>
              {d}
            </span>
          ))}
        </div>
        <div role="grid" aria-label={`${y}년 ${m}월`} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', padding: '0 12px 8px' }}>
          {cells.map((c) => {
            const on = c.iso === selectedDay;
            const dots = dotsOf(c, surface);
            return (
              <button
                key={c.iso}
                type="button"
                role="gridcell"
                className="btn"
                data-m-cal-day={c.iso}
                data-today={c.isToday ? '1' : undefined}
                aria-selected={on}
                aria-label={`${partsOf(c.iso)?.m}월 ${c.n}일${c.holiday ? ` ${c.holiday}` : ''}${dots.length ? ` · 일정 있음` : ''}`}
                onClick={() => {
                  if (!c.inMonth) {
                    const p = partsOf(c.iso);
                    if (p) onSetMonth(p.y, p.m);
                  }
                  onPickDay(c.iso);
                }}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, height: 50, padding: '5px 0 0', border: 0, background: 'transparent', fontFamily: 'inherit', cursor: 'pointer', opacity: c.inMonth ? 1 : 0.32 }}
              >
                <span
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 99,
                    background: c.isToday ? 'var(--mf-accent)' : 'transparent',
                    boxShadow: on && !c.isToday ? 'inset 0 0 0 1.5px var(--mf-m-ink)' : 'none',
                    color: numColor(c),
                    fontFamily: MONO_FONT,
                    fontSize: 13.5,
                    fontWeight: c.isToday || on ? 600 : 500,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {c.n}
                </span>
                <span aria-hidden="true" style={{ display: 'flex', gap: 2.5, height: 4 }}>
                  {dots.map((d, i) => (
                    <span key={i} data-m-cal-dot style={{ width: 4, height: 4, borderRadius: 99, background: d, display: 'block' }} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div data-m-cal-agenda style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', borderTop: '1px solid var(--mf-m-line)', background: 'var(--mf-m-card)' }}>
        <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'baseline', gap: 8, padding: '16px 20px 4px' }}>
          <span style={{ fontFamily: MONO_FONT, fontSize: 22, fontWeight: 600, letterSpacing: '-.03em', color: 'var(--mf-m-ink)' }}>{sel?.d ?? ''}</span>
          <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--mf-m-ink)' }}>
            {DOW[selDow]}요일{selectedDay === todayIso ? ' · 오늘' : ''}
          </span>
          {hol && <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--mf-cal-num-sun)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{hol.name}</span>}
          <span style={{ flex: 1 }} />
          {list.length > 0 && <span data-m-cal-count style={{ fontSize: 12, color: 'var(--mf-m-faint)' }}>{list.length}건</span>}
        </div>
        <div className="mf-m-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: '0 20px 96px' }}>
          {list.map((e) => {
            const chip = entryChip(e, surface);
            const declined = isDeclined(e);
            return (
              <button
                key={`${e.docId}-${e.cardId}-${e.start ?? e.due}`}
                type="button"
                className="btn mf-m-press"
                data-m-cal-item={e.google ? 'google' : e.event ? 'event' : 'kanban'}
                onClick={() => onPickEntry(e)}
                style={{ display: 'flex', alignItems: 'center', gap: 14, minHeight: 56, padding: '6px 4px', margin: '0 -4px', border: 0, borderBottom: '1px solid var(--mf-m-line)', background: 'transparent', fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer', opacity: declined ? 0.55 : 1 }}
              >
                <span style={{ width: 44, flex: '0 0 auto', fontFamily: MONO_FONT, fontSize: 12.5, fontWeight: 600, color: 'var(--mf-m-mut)' }}>{timeOf(e)}</span>
                <span aria-hidden="true" style={{ width: 3, height: 22, flex: '0 0 auto', borderRadius: 99, background: chip.base, display: 'block' }} />
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--mf-m-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: declined ? 'line-through' : undefined }}>{e.title || '제목 없음'}</span>
                  <span style={{ fontSize: 12, color: 'var(--mf-m-mut2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{subOf(e, selectedDay)}</span>
                </span>
              </button>
            );
          })}
          {!list.length && <span data-m-cal-empty style={{ padding: '26px 0', textAlign: 'center', fontSize: 13, color: 'var(--mf-m-faint)' }}>이날은 비어 있어요</span>}
        </div>
      </div>

      <button
        type="button"
        className="btn"
        data-m-fab
        data-cal-new
        aria-label="새 일정"
        title="새 일정"
        onClick={() => onNewEvent(selectedDay)}
        style={{ position: 'absolute', right: 20, bottom: 18, zIndex: 2, width: 54, height: 54, border: 0, borderRadius: 17, background: 'var(--mf-accent)', color: 'var(--mf-accent-ink)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 10px 24px -12px rgba(46,42,38,.55)', cursor: 'pointer', padding: 0 }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>

      <MonthSheet
        open={monthSheet}
        onClose={() => setMonthSheet(false)}
        y={y}
        m={m}
        todayIso={todayIso}
        onPick={(ny, nm) => {
          setMonthSheet(false);
          goMonth(ny, nm);
        }}
      />
    </div>
  );
}

/**
 * 월 고르기(N6) — 연도는 ‹ ›로, 달은 열두 칸. 보고 있는 달이 채워지고, 이번 달은 테두리.
 *
 * 디자인의 칸 숫자("그 달의 일정 수")는 두지 않았다: 우리가 손에 든 일정은 **보고 있는 6주**
 * 뿐이라(구글·Geurio 일정은 달마다 따로 받는다) 다른 달의 수를 적으면 사실이 아니다.
 */
function MonthSheet({ open, onClose, y, m, todayIso, onPick }: { open: boolean; onClose: () => void; y: number; m: number; todayIso: string; onPick: (y: number, m: number) => void }) {
  const [year, setYear] = useState(y);
  // 열 때마다 보고 있는 해에서 시작한다.
  useEffect(() => {
    if (open) setYear(y);
  }, [open, y]);
  const now = partsOf(todayIso);
  const arrow = (d: string, label: string, delta: number) => (
    <button type="button" className="btn mf-m-press" aria-label={label} onClick={() => setYear((v) => v + delta)} style={{ width: 40, height: 40, flex: '0 0 auto', border: 0, borderRadius: 99, background: 'transparent', color: 'var(--mf-m-ink2)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0, cursor: 'pointer' }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={d} />
      </svg>
    </button>
  );
  return (
    <MobileSheet open={open} onClose={onClose} label="달 고르기" attrs={{ 'data-m-month-sheet': '' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '14px 16px 6px', flex: '0 0 auto' }}>
        {arrow('m15 5-7 7 7 7', '이전 해', -1)}
        <span data-m-month-year style={{ flex: 1, textAlign: 'center', fontFamily: MONO_FONT, fontSize: 22, fontWeight: 600, letterSpacing: '-.02em', color: 'var(--mf-m-ink)' }}>
          {year}
        </span>
        {arrow('m9 5 7 7-7 7', '다음 해', 1)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, padding: '6px 16px 0', flex: '0 0 auto' }}>
        {Array.from({ length: 12 }, (_, i) => i + 1).map((mm) => {
          const cur = year === y && mm === m;
          const isNow = !!now && now.y === year && now.m === mm;
          return (
            <button
              key={mm}
              type="button"
              className="btn"
              data-m-month={mm}
              aria-current={cur ? 'true' : undefined}
              onClick={() => onPick(year, mm)}
              style={{ height: 56, border: 0, borderRadius: 14, background: cur ? 'var(--mf-accent)' : 'var(--mf-m-info)', boxShadow: isNow && !cur ? 'inset 0 0 0 1.5px var(--mf-accent)' : 'none', color: cur ? 'var(--mf-accent-ink)' : 'var(--mf-m-ink)', fontFamily: 'inherit', fontSize: 15, fontWeight: cur ? 800 : 700, cursor: 'pointer' }}
            >
              {mm}월
            </button>
          );
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, padding: '14px 20px 4px', flex: '0 0 auto' }}>
        <span style={{ flex: 1, display: 'flex' }}>
          <SheetClose onClick={onClose} />
        </span>
        <button
          type="button"
          className="btn mf-m-press"
          data-m-month-today
          onClick={() => now && onPick(now.y, now.m)}
          style={{ height: 36, padding: '0 14px', border: '1px solid var(--mf-m-btn-line)', borderRadius: 99, background: 'var(--mf-m-card)', color: 'var(--mf-m-ink)', fontFamily: 'inherit', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}
        >
          오늘로
        </button>
      </div>
    </MobileSheet>
  );
}

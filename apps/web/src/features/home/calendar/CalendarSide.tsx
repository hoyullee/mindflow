import { useEffect, useRef, useState } from 'react';
import type { CalendarEntry, HolidayInfo } from './entries';
import { type ChipSurface, declinedStyle, entryChip, roomMark } from './chips';
import { HOUR_ROW, dayProgress, dayTimeline, entriesOn, hourLabel, partsOf, timeLabel } from './model';
import { MiniCalendar, MiniNav } from './MiniCalendar';
import type { DayTimeline } from './model';

/**
 * 일정 화면 오른쪽 — 미니 달력 + 고른 날짜의 날짜별 보기(스펙: 일정 페이지 4).
 *
 * 날짜별 보기는 디자인 원본의 agenda다: 종일 항목의 납작한 행 + 24시간 시간표.
 * 시각이 있는 항목은 Geurio·구글 일정이다 — 칸반 마감은 종일이다(결정).
 *
 * 자리는 둘이다: 본문 행이 넉넉하면 **300px 붙박이 열**(달력이 그만큼 좁아진다), 모자라면
 * 달력 위에 **324px 판으로 겹친다**(막은 호출부가 깐다). 어느 쪽이든 위 선은 요일 줄의
 * 위 선과 같은 색·같은 높이라 헤더 아래에서 한 줄로 이어진다.
 */
export function CalendarSide({
  entries,
  todayIso,
  y,
  m,
  surface,
  selectedDay,
  onPickDay,
  onPickEntry,
  onSetMonth,
  onNewEvent,
  holidays,
  overlay = false,
  frame = 'embed',
  onClose,
}: {
  entries: readonly CalendarEntry[];
  todayIso: string;
  y: number;
  m: number;
  surface: ChipSurface;
  selectedDay: string;
  onPickDay: (iso: string) => void;
  onPickEntry: (e: CalendarEntry) => void;
  onSetMonth: (y: number, m: number) => void;
  /** 이 날짜에 새 일정(원본 `agendaNew` — 머리의 `＋`). 시간표의 빈 시간대를
   *  눌렀으면 그 시각(`HH:MM`)까지 넘긴다. */
  onNewEvent: (iso: string, at?: string) => void;
  /** 공휴일(구글 연동) — 미니 달력이 큰 달력과 같은 색으로 그린다. */
  holidays?: Record<string, HolidayInfo>;
  /** 달력 위에 겹치는 판인가(본문 행이 좁을 때). */
  overlay?: boolean;
  /**
   * `page` — 일정 화면의 열: 위 선이 요일 줄과 이어지고, 열릴 때 살짝 떠오른다(스펙 4).
   * `embed` — 다른 판 안에 든 것(공책 우측 열의 「일정」 탭): 테두리·등장은 그 판이 맡는다.
   */
  frame?: 'page' | 'embed';
  /** 머리의 ✕ — 주면 미니 달력 머리 오른쪽에 선다(공책 우측 열을 접는다). 일정 화면은
   *  헤더의 토글이 그 일을 하므로 주지 않는다. */
  onClose?: () => void;
}) {
  const dayList = entriesOn(entries, selectedDay);
  const timeline = dayTimeline(entries, selectedDay);
  const p = partsOf(selectedDay);

  return (
    <aside
      data-cal-side
      data-cal-side-overlay={overlay ? '1' : undefined}
      // 디자인 원본의 사이드는 **자기 면을 가진 판**이다(카드가 떠 있는 열이 아니라).
      // 달력 영역과 왼쪽 경계선으로 갈리고, 안쪽 구획은 가로선으로 나뉜다.
      style={{
        ...(overlay
          ? { position: 'absolute', top: 0, right: 0, bottom: 0, width: 324, zIndex: 6, boxShadow: '-22px 0 44px -24px rgba(46,42,38,.5)' }
          : { flex: '0 0 300px', width: 300 }),
        minWidth: 0,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'hidden',
        background: 'var(--mf-card)',
        borderLeft: '1px solid var(--mf-border-soft)',
        ...(frame === 'page' ? { borderTop: '1px solid var(--mf-cal-grid)', animation: 'mf-fade .18s ease' } : {}),
      }}
    >
      {/* 미니 달력 — 공책의 일정 블록과 **같은 부품**을 쓴다(일정 화면은 `side` 옷). */}
      <div style={{ flexShrink: 0, padding: '16px 14px 10px', borderBottom: '1px solid var(--mf-hairline)' }}>
        <MiniCalendar
          variant="side"
          surface={surface}
          holidays={holidays}
          entries={entries}
          todayIso={todayIso}
          y={y}
          m={m}
          selectedDay={selectedDay}
          onPickDay={onPickDay}
          onSetMonth={onSetMonth}
          {...(onClose ? { extraNav: <MiniNav size={22} label="사이드 닫기" onClick={onClose} d="M6 6l12 12M18 6 6 18" /> } : {})}
        />
      </div>

      {/* 날짜별 보기 — 머리줄(날짜 · 개수 · ＋) → 종일 행 → 시간표. 미니 달력은 붙박이고
          시간표만 굴러간다. */}
      <div data-cal-agenda-head style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 7, padding: '11px 15px 8px' }}>
        <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: '-.02em', color: 'var(--mf-text)', whiteSpace: 'nowrap' }}>{p ? `${p.m}월 ${p.d}일` : selectedDay}</span>
        <span data-cal-agenda-count style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--mf-faint)', whiteSpace: 'nowrap' }}>{`일정 ${dayList.length}개`}</span>
        {/* 원본 `agendaNew` — 그 날짜에 바로 일정을 만든다(고른 날이 곧 기본값). */}
        <button type="button" data-cal-day-new title="이 날짜에 일정 추가" aria-label="이 날짜에 일정 추가" onClick={() => onNewEvent(selectedDay)} className="mf-cal-plus" style={{ width: 22, height: 22, flex: '0 0 auto', border: 0, borderRadius: 999, background: 'transparent', color: 'var(--mf-muted)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>
      {timeline.allDay.length > 0 && (
        <div data-cal-allday style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 3, padding: '0 15px 10px', maxHeight: '32%', overflowY: 'auto' }} className="lnb-scroll">
          {timeline.allDay.map((e) => (
            <DayChip key={`${e.docId}-${e.cardId}`} entry={e} iso={selectedDay} surface={surface} onPick={onPickEntry} />
          ))}
        </div>
      )}
      {/* 시간 일정이 없는 날 — 시계 + 한 줄 + `일정 추가`(스펙 4.2). **시간표는 그대로 둔다**:
          예전에 이 안내가 시간표를 통째로 갈아 끼웠을 때 빈 시간대를 눌러 그 시각으로
          만드는 길이 사라졌다(제보 #20). 안내는 표 위에 얹힌 한 덩어리다. */}
      {timeline.blocks.length === 0 && (
        <div data-cal-timed-empty style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, padding: '6px 15px 14px' }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--mf-faint2)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7.5V12l3 2" />
          </svg>
          <span style={{ fontSize: 13, color: 'var(--mf-faint)' }}>이 날에는 시간 일정이 없어요</span>
          <button type="button" data-cal-timed-add onClick={() => onNewEvent(selectedDay)} className="mf-cal-pill" style={{ height: 27, padding: '0 12px', borderRadius: 99, border: '1px solid var(--mf-border)', background: 'var(--mf-card)', color: 'var(--mf-subtext)', font: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            일정 추가
          </button>
        </div>
      )}
      <DayTimelineView timeline={timeline} iso={selectedDay} todayIso={todayIso} surface={surface} onPickEntry={onPickEntry} onNewEvent={onNewEvent} />
    </aside>
  );
}

/** 시각 라벨 열의 폭 — 스펙 4.2(40px, 오른쪽 정렬) + 줄과의 간격 8. */
const LABEL_W = 40;
const LABEL_GAP = 8;

/**
 * 시간표 — 디자인 원본의 `agendaHours`/`agendaTimed`. 24행에 시각 있는 일정을 절대 위치로
 * 놓고, 겹치는 일정은 열을 나눠 나란히 둔다(계산은 순수 `dayTimeline`). 오늘이면 현재
 * 시각 선도 그린다(원본 `agendaNowOn`).
 *
 * 행 높이는 **패널에 맞춘다**(스펙 4.2) — 남는 높이를 24로 나누되 36px 아래로는 내려가지
 * 않는다(그보다 낮으면 블록 제목이 한 줄도 못 선다). 대개는 36px이고 표가 굴러간다.
 */
function DayTimelineView({
  timeline,
  iso,
  todayIso,
  surface,
  onPickEntry,
  onNewEvent,
}: {
  timeline: DayTimeline;
  iso: string;
  todayIso: string;
  surface: ChipSurface;
  onPickEntry: (e: CalendarEntry) => void;
  /** 빈 시간대를 눌렀다 — 그 날짜·그 시각으로 새 일정. */
  onNewEvent: (iso: string, at: string) => void;
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [rowH, setRowH] = useState(HOUR_ROW);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    // 맨 아래 자정 선(라벨 한 줄)과 아래 여백만큼은 빼고 나눈다 — 넉넉한 창에서 표가 딱
    // 들어차 굴러가지 않게.
    const read = (): void => setRowH(Math.max(HOUR_ROW, Math.floor((el.clientHeight - 16) / 24)));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // 첫 일정이 보이도록 맞춘다 — 자정부터 훑게 두지 않는다(원본 `syncAgendaScroll`).
  // 위치는 36px 기준으로 계산돼 오므로 지금 행 높이로 늘인다.
  const focusTop = Math.round((timeline.focusTop * rowH) / HOUR_ROW);
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = focusTop;
  }, [focusTop, iso]);

  const nowMin = (() => {
    if (iso !== todayIso) return null;
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  })();

  const label = (h: number) => (
    <span style={{ flex: `0 0 ${LABEL_W}px`, textAlign: 'right', fontFamily: "'JetBrains Mono', monospace", fontSize: 12.5, color: 'var(--mf-faint2)', transform: 'translateY(-5px)', whiteSpace: 'nowrap', lineHeight: 1 }}>{hourLabel(h)}</span>
  );
  const left = LABEL_W + LABEL_GAP;

  return (
    <div ref={bodyRef} className="mf-cal-scroll" data-cal-timeline style={{ flex: '1 1 0', minHeight: 120, overflowY: 'auto', padding: '8px 10px 8px 4px' }}>
      <div style={{ position: 'relative', height: rowH * 24, display: 'flex', flexDirection: 'column' }}>
        {Array.from({ length: 24 }, (_, h) => (
          <span key={h} style={{ display: 'flex', alignItems: 'flex-start', gap: LABEL_GAP, height: rowH, flex: '0 0 auto' }}>
            {label(h)}
            {/* 빈 시간대를 누르면 **그 시각으로** 새 일정(구글 캘린더의 관례). 예전에는
                시간 일정이 없는 날에만 `일정 추가` 버튼이 떴는데, 그 버튼은 시각을
                모르고 시간표 자체도 사라졌다(제보 #20). 이제 표는 늘 있고, 누른
                시간대가 곧 시작 시각이다. */}
            <button
              type="button"
              data-cal-hour={h}
              aria-label={`${hourLabel(h)}에 일정 추가`}
              title={`${hourLabel(h)}에 일정 추가`}
              onClick={() => onNewEvent(iso, `${`${h}`.padStart(2, '0')}:00`)}
              className="mf-ctl"
              style={{ flex: 1, minWidth: 0, height: rowH, padding: 0, border: 0, borderTop: '1px solid var(--mf-border-soft)', background: 'transparent', cursor: 'pointer', display: 'block' }}
            />
          </span>
        ))}
        {/* 하루의 **끝 선**(제보 #19) — 예전에는 11PM 줄 아래가 선 없는 빈 자리라
            그 시간대가 잘린 것처럼 보였다. 자정으로 닫으면 표가 완결된다. */}
        <span data-cal-hour-end style={{ display: 'flex', alignItems: 'flex-start', gap: LABEL_GAP, flex: '0 0 auto' }}>
          {label(0)}
          <span style={{ flex: 1, minWidth: 0, borderTop: '1px solid var(--mf-border-soft)', display: 'block' }} />
        </span>

        {nowMin !== null && (
          <span data-cal-now style={{ position: 'absolute', left: left - 3, right: 0, top: (nowMin / 60) * rowH, display: 'flex', alignItems: 'center', pointerEvents: 'none', zIndex: 4, transform: 'translateY(-50%)' }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--mf-accent)', display: 'block', flex: '0 0 auto' }} />
            <span style={{ flex: 1, height: 1.5, background: 'var(--mf-accent)', display: 'block' }} />
          </span>
        )}

        {timeline.blocks.map((b) => {
          const chip = entryChip(b.entry, surface);
          const n = b.lanes;
          const h = ((b.to - b.from) / 60) * rowH;
          return (
            <button
              key={`${b.entry.docId}-${b.entry.cardId}`}
              type="button"
              data-cal-block={b.entry.cardId}
              title={`${b.entry.title} · ${timeLabel(b.from)}`}
              onClick={() => onPickEntry(b.entry)}
              className="mf-cal-block"
              style={{
                position: 'absolute',
                left: `calc(${left}px + (100% - ${left + 2}px) * ${b.lane} / ${n})`,
                width: `calc((100% - ${left + 2}px) / ${n} - ${n > 1 ? 3 : 0}px)`,
                top: (b.from / 60) * rowH,
                height: Math.max(rowH - 2, h - 2),
                boxSizing: 'border-box',
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
                justifyContent: h >= rowH * 1.5 ? 'flex-start' : 'center',
                padding: `4px ${n > 2 ? 5 : 9}px`,
                border: 0,
                borderLeft: `3px solid ${chip.base}`,
                borderRadius: '4px 9px 9px 4px',
                // 우리 일정은 **종류의 옅은 면**(스펙 4.2), 구글은 예전의 옅은 파랑(그 일정의
                // 색은 왼쪽 바가 말한다 — 구글 칩의 규칙은 바꾸지 않는다).
                background: b.entry.google ? chip.tint : chip.soft,
                // 겹칠 때 카드 경계를 갈라 준다(원본 `ring`).
                boxShadow: n > 1 ? '0 0 0 1.5px var(--mf-card)' : 'none',
                cursor: 'pointer',
                font: 'inherit',
                textAlign: 'left',
                overflow: 'hidden',
              }}
            >
              <span style={{ fontSize: n > 2 ? 11.5 : 13, fontWeight: 800, letterSpacing: '-.015em', color: 'var(--mf-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', ...declinedStyle(b.entry) }}>{roomMark(b.entry)}{b.entry.title}</span>
              {n <= 2 && (
                <span style={{ fontSize: 12, color: 'var(--mf-cal-num)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {timeLabel(b.from)} – {timeLabel(b.to)}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 날짜별 보기의 한 행 — `padding: 6px 9px` · 왼쪽 3px 색 바 · `radius 4/9/9/4` · 종류의 옅은 면
 * (스펙 4.2). 오른쪽 메모는 그 날이 기간의 며칠째인가(`3/7일째`), 아니면 그 카드의 열
 * (`진행 중`) — 일정이면 그 캘린더 이름.
 */
function DayChip({ entry, iso, surface, onPick }: { entry: CalendarEntry; iso: string; surface: ChipSurface; onPick: (e: CalendarEntry) => void }) {
  const chip = entryChip(entry, surface);
  const note = dayProgress(entry, iso) ?? (entry.colName || '마감');
  return (
    <button
      type="button"
      data-cal-day-chip={`${entry.docId}:${entry.cardId}`}
      onClick={() => onPick(entry)}
      className="mf-cal-chip-btn"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        flexShrink: 0,
        boxSizing: 'border-box',
        padding: '6px 9px',
        border: 0,
        borderLeft: `3px solid ${chip.base}`,
        borderRadius: '4px 9px 9px 4px',
        background: entry.google ? chip.tint : chip.soft,
        font: 'inherit',
        textAlign: 'left',
        cursor: 'pointer',
      }}
    >
      <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: 'var(--mf-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', ...declinedStyle(entry) }}>{roomMark(entry)}{entry.title || '제목 없음'}</span>
      <span style={{ flexShrink: 0, maxWidth: '45%', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 12, color: 'var(--mf-muted)', whiteSpace: 'nowrap' }}>{note}</span>
    </button>
  );
}

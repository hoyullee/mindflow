import { useEffect, useRef } from 'react';
import type { CalendarEntry, HolidayInfo } from './entries';
import { entryChip, type ChipSurface } from './chips';
import { HOUR_ROW, dateLabel, dayProgress, dayTimeline, entriesOn, hourLabel, timeLabel } from './model';
import { MiniCalendar, MiniNav } from './MiniCalendar';
import type { DayTimeline } from './model';

/**
 * 일정 화면 오른쪽 — 미니 달력 + (마감 목록 | 고른 날짜 + 시간표).
 *
 * 날짜별 보기는 디자인 원본의 agenda다: 종일 항목의 납작한 행 + 24시간 시간표.
 * 시각이 있는 항목은 Geurio 일정(0033)뿐이다 — 칸반 마감은 종일이다(결정).
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
  onClose,
  holidays,
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
  /** 사이드 접기 — 머리의 ✕(디자인 원본). 위 토글을 다시 누르는 것과 같다. */
  onClose: () => void;
  /** 공휴일(구글 연동) — 미니 달력이 큰 달력과 같은 색으로 그린다. */
  holidays?: Record<string, HolidayInfo>;
}) {
  const dayList = entriesOn(entries, selectedDay);
  const timeline = dayTimeline(entries, selectedDay);

  return (
    <aside
      data-cal-side
      // 디자인 원본의 사이드는 **자기 면을 가진 판**이다(카드가 떠 있는 열이 아니라).
      // 달력 영역과 왼쪽 경계선으로 갈리고, 안쪽 구획은 가로선으로 나뉜다.
      style={{
        flex: '0 0 300px',
        width: 300,
        minWidth: 0,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'hidden',
        background: 'var(--mf-card)',
        borderLeft: '1px solid var(--mf-border-soft)',
      }}
    >
      {/* 미니 달력 — 대시보드 캘린더 위젯(1열)과 **같은 컴포넌트**를 쓴다. */}
      <div style={{ flexShrink: 0, padding: '14px 14px 12px', borderBottom: '1px solid var(--mf-border-soft)' }}>
        <MiniCalendar
          holidays={holidays}
          entries={entries}
          todayIso={todayIso}
          y={y}
          m={m}
          selectedDay={selectedDay}
          onPickDay={onPickDay}
          onSetMonth={onSetMonth}
          extraNav={<MiniNav label="사이드 닫기" onClick={onClose} d="M6 6l12 12M18 6 6 18" />}
        />
      </div>

      {/* 날짜별 보기 — 디자인 원본의 agenda: 종일 항목은 **왼쪽 색 바가 붙은 납작한
          행**(마감 목록의 두 줄 카드와 다른 물건이다), 그 아래가 **시간표**다.
          시각이 있는 항목은 Geurio 일정(0033)뿐이고 칸반 마감은 종일이므로(결정)
          시간표에는 일정이 있을 때만 블록이 놓인다. 미니 달력은 붙박이고 아래만 스크롤. */}
      <Section title={dateLabel(selectedDay)} sub={`일정 ${dayList.length}개`} action={{ label: '이 날짜에 일정 추가', onClick: () => onNewEvent(selectedDay) }}>
        {timeline.allDay.length ? (
          timeline.allDay.map((e) => <DayChip key={`${e.docId}-${e.cardId}`} entry={e} iso={selectedDay} surface={surface} onPick={onPickEntry} />)
        ) : timeline.blocks.length ? null : (
          <Empty text="이 날에는 일정이 없어요" />
        )}
      </Section>
      <DayTimelineView timeline={timeline} iso={selectedDay} todayIso={todayIso} surface={surface} onPickEntry={onPickEntry} onNewEvent={onNewEvent} />
    </aside>
  );
}


function Section({ title, sub, action, children }: { title: string; sub: string; action?: { label: string; onClick: () => void }; children: React.ReactNode }) {
  return (
    <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6, padding: '0 15px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, padding: '0 2px' }}>
        <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: '-.02em', color: 'var(--mf-text)' }}>{title}</span>
        <span style={{ flex: 1, minWidth: 0, fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, color: 'var(--mf-faint)' }}>{sub}</span>
        {/* 원본 `agendaNew` — 그 날짜에 바로 일정을 만든다(고른 날이 곧 기본값). */}
        {action && (
          <button type="button" data-cal-day-new title={action.label} aria-label={action.label} onClick={action.onClick} className="mf-ctl" style={{ width: 22, height: 22, flex: '0 0 auto', border: 0, borderRadius: 999, background: 'transparent', color: 'var(--mf-muted)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{children}</div>
    </div>
  );
}

/**
 * 시간표 — 디자인 원본의 `agendaHours`/`agendaTimed`. 24행(행 36px)에 시각 있는 일정을
 * 절대 위치로 놓고, 겹치는 일정은 열을 나눠 나란히 둔다(계산은 순수 `dayTimeline`).
 * 오늘이면 현재 시각 선도 그린다(원본 `agendaNowOn`).
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
  // 첫 일정이 보이도록 맞춘다 — 자정부터 훑게 두지 않는다(원본 `syncAgendaScroll`).
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = timeline.focusTop;
  }, [timeline.focusTop, iso]);

  const nowMin = (() => {
    if (iso !== todayIso) return null;
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  })();

  return (
    <div ref={bodyRef} className="lnb-scroll" data-cal-timeline style={{ flex: '1 1 0', minHeight: 160, overflowY: 'auto', padding: '0 2px 8px' }}>
      <div style={{ position: 'relative', height: HOUR_ROW * 24, display: 'flex', flexDirection: 'column' }}>
        {Array.from({ length: 24 }, (_, h) => (
          <span key={h} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, height: HOUR_ROW, flex: '0 0 auto' }}>
            <span style={{ flex: '0 0 34px', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: 'var(--mf-faint2)', transform: 'translateY(-4px)', whiteSpace: 'nowrap' }}>{hourLabel(h)}</span>
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
              style={{ flex: 1, minWidth: 0, height: HOUR_ROW, padding: 0, border: 0, borderTop: '1px solid var(--mf-border-soft)', background: 'transparent', cursor: 'pointer', display: 'block' }}
            />
          </span>
        ))}
        {/* 하루의 **끝 선**(제보 #19) — 예전에는 11PM 줄 아래가 선 없는 빈 자리라
            그 시간대가 잘린 것처럼 보였다. 자정으로 닫으면 표가 완결된다. */}
        <span data-cal-hour-end style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flex: '0 0 auto' }}>
          <span style={{ flex: '0 0 34px', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: 'var(--mf-faint2)', transform: 'translateY(-4px)', whiteSpace: 'nowrap' }}>{hourLabel(0)}</span>
          <span style={{ flex: 1, minWidth: 0, borderTop: '1px solid var(--mf-border-soft)', display: 'block' }} />
        </span>

        {nowMin !== null && (
          <span data-cal-now style={{ position: 'absolute', left: 38, right: 0, top: (nowMin / 60) * HOUR_ROW, display: 'flex', alignItems: 'center', pointerEvents: 'none' }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--mf-accent)', display: 'block', flex: '0 0 auto', marginLeft: -3 }} />
            <span style={{ flex: 1, height: 1.5, background: 'var(--mf-accent)', display: 'block' }} />
          </span>
        )}

        {timeline.blocks.map((b) => {
          const chip = entryChip(b.entry, surface);
          const n = b.lanes;
          return (
            <button
              key={`${b.entry.docId}-${b.entry.cardId}`}
              type="button"
              data-cal-block={b.entry.cardId}
              title={`${b.entry.title} · ${timeLabel(b.from)}`}
              onClick={() => onPickEntry(b.entry)}
              className="mf-ctl"
              style={{
                position: 'absolute',
                left: `calc(46px + (100% - 48px) * ${b.lane} / ${n})`,
                width: `calc((100% - 48px) / ${n} - ${n > 1 ? 3 : 0}px)`,
                top: (b.from / 60) * HOUR_ROW,
                height: Math.max(34, ((b.to - b.from) / 60) * HOUR_ROW - 2),
                boxSizing: 'border-box',
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
                justifyContent: 'center',
                padding: `4px ${n > 2 ? 5 : 9}px`,
                border: 0,
                borderLeft: `3px solid ${chip.dot}`,
                borderRadius: '4px 9px 9px 4px',
                // 배경은 **바 색의 옅은 면**(디자인 원본의 시간표 톤 — 제보: 분류 hue의
                // bg를 쓰던 예전 판은 바와 배경 색이 서로 어긋났다).
                background: chip.tint,
                // 겹칠 때 카드 경계를 갈라 준다(원본 `ring`).
                boxShadow: n > 1 ? '0 0 0 1.5px var(--mf-card)' : 'none',
                cursor: 'pointer',
                font: 'inherit',
                textAlign: 'left',
                overflow: 'hidden',
              }}
            >
              <span style={{ fontSize: n > 2 ? 11 : 12.5, fontWeight: 800, letterSpacing: '-.015em', color: 'var(--mf-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.entry.title}</span>
              {n <= 2 && (
                <span style={{ fontSize: 10.5, color: 'var(--mf-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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

function Empty({ text }: { text: string }) {
  return <span style={{ padding: '10px 4px', fontSize: 12, color: 'var(--mf-faint)' }}>{text}</span>;
}

/**
 * 날짜별 보기의 한 행 — `padding: 6px 9px` · 왼쪽 3px 색 바 · `radius 4/9/9/4`
 * (디자인 원본 그대로). 색 바는 그 카드가 있는 **열 색**이다.
 */
function DayChip({ entry, iso, surface, onPick }: { entry: CalendarEntry; iso: string; surface: ChipSurface; onPick: (e: CalendarEntry) => void }) {
  const chip = entryChip(entry, surface);
  const note = dayProgress(entry, iso) ?? entry.colName ?? '마감';
  return (
    <button
      type="button"
      data-cal-day-chip={`${entry.docId}:${entry.cardId}`}
      onClick={() => onPick(entry)}
      className="mf-ctl"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        boxSizing: 'border-box',
        // 글자가 작아 읽기 힘들다는 제보 — 행 높이와 글자를 함께 키웠다.
        padding: '9px 11px',
        border: 0,
        borderLeft: `3px solid ${chip.dot}`,
        borderRadius: '4px 10px 10px 4px',
        // 중립 면(panel2)이 아니라 **바 색의 옅은 면** — 시간표 블록과 같은 톤(제보 이미지).
        background: chip.tint,
        font: 'inherit',
        textAlign: 'left',
        cursor: 'pointer',
      }}
    >
      <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: 'var(--mf-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.title || '제목 없음'}</span>
      <span style={{ flexShrink: 0, fontSize: 11, color: 'var(--mf-muted)', whiteSpace: 'nowrap' }}>{note}</span>
    </button>
  );
}


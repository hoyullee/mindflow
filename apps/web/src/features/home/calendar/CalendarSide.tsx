import { useEffect, useRef } from 'react';
import type { CalendarEntry } from './entries';
import { entryChip, type ChipSurface } from './chips';
import { DOW, HOUR_ROW, dateLabel, dayProgress, dayTimeline, entriesOn, hourLabel, monthCells, timeLabel } from './model';
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
  /** 이 날짜에 새 일정(원본 `agendaNew` — 머리의 `＋`와 빈 상태의 버튼). */
  onNewEvent: (iso: string) => void;
  /** 사이드 접기 — 머리의 ✕(디자인 원본). 위 토글을 다시 누르는 것과 같다. */
  onClose: () => void;
}) {
  // 미니 달력은 본문과 **같은 달**을 보여 준다 — 두 달력이 어긋나면 어느 쪽이
  // 기준인지 흐려진다(디자인 원본은 따로 넘길 수 있지만 그건 다음 단계).
  const cells = monthCells(y, m, entries, todayIso, 0);
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
      {/* 미니 달력 */}
      <div style={{ flexShrink: 0, padding: '14px 14px 12px', borderBottom: '1px solid var(--mf-border-soft)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 2px 9px' }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 800, letterSpacing: '-.02em', color: 'var(--mf-text)', whiteSpace: 'nowrap' }}>{`${y}년 ${m}월`}</span>
          <MiniNav label="이전 달" onClick={() => onSetMonth(m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1)} d="m18 15-6-6-6 6" />
          <MiniNav label="다음 달" onClick={() => onSetMonth(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1)} d="m6 9 6 6 6-6" />
          <MiniNav label="사이드 닫기" onClick={onClose} d="M6 6l12 12M18 6 6 18" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1 }}>
          {DOW.map((d, i) => (
            <span key={d} style={{ textAlign: 'center', fontSize: 9.5, fontWeight: 700, color: i === 0 ? 'var(--mf-danger)' : i === 6 ? 'var(--mf-info)' : 'var(--mf-faint)', paddingBottom: 3 }}>
              {d}
            </span>
          ))}
          {cells.map((c) => {
            const has = c.inMonth && entriesOn(entries, c.iso).length > 0;
            const on = c.iso === selectedDay;
            return (
              <button
                key={c.iso}
                type="button"
                data-mini-day={c.iso}
                disabled={!c.inMonth}
                onClick={() => onPickDay(c.iso)}
                aria-label={c.inMonth ? `${c.n}일` : undefined}
                style={{
                  position: 'relative',
                  height: 26,
                  border: 0,
                  borderRadius: 999,
                  background: on ? 'var(--mf-accent)' : 'transparent',
                  // 숫자를 디자인 원본만큼 또렷하게(제보) — 평일은 본문 글자색·600,
                  // 주말은 큰 달력과 같은 색(일=danger / 토=info). 예전에는 `subtext`
                  // 500이라 미니 달력의 날짜가 바탕에 묻혔다.
                  color: on
                    ? 'var(--mf-accent-ink)'
                    : !c.inMonth
                      ? 'var(--mf-faint2)'
                      : c.isToday
                        ? 'var(--mf-accent-strong)'
                        : c.dow === 0 || c.holiday
                          ? 'var(--mf-danger)'
                          : c.dow === 6
                            ? 'var(--mf-info)'
                            : 'var(--mf-text)',
                  font: 'inherit',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 11,
                  fontWeight: c.isToday || on ? 800 : 600,
                  cursor: c.inMonth ? 'pointer' : 'default',
                }}
              >
                {c.n}
                {has && !on && <span style={{ position: 'absolute', bottom: 3, left: '50%', transform: 'translateX(-50%)', width: 3, height: 3, borderRadius: 999, background: 'var(--mf-accent)' }} />}
              </button>
            );
          })}
        </div>
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

function MiniNav({ label, onClick, d }: { label: string; onClick: () => void; d: string }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="mf-ctl"
      style={{ width: 24, height: 24, borderRadius: 999, border: 0, background: 'transparent', color: 'var(--mf-muted)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={d} />
      </svg>
    </button>
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
  onNewEvent: (iso: string) => void;
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  // 첫 일정이 보이도록 맞춘다 — 자정부터 훑게 두지 않는다(원본 `syncAgendaScroll`).
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = timeline.focusTop;
  }, [timeline.focusTop, iso]);

  if (!timeline.blocks.length) {
    // 원본의 빈 상태 — 시계 글리프 + 안내 + `일정 추가`.
    return (
      <div data-cal-timeline-empty style={{ flex: '1 1 0', minHeight: 120, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 9, padding: 16 }}>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--mf-border)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7.5V12l3 2" />
        </svg>
        <span style={{ fontSize: 11.5, color: 'var(--mf-faint)', textAlign: 'center' }}>이 날에는 시간 일정이 없어요</span>
        <button type="button" data-cal-timeline-new onClick={() => onNewEvent(iso)} className="mf-ctl" style={{ height: 27, padding: '0 13px', borderRadius: 999, border: '1px solid var(--mf-border)', background: 'var(--mf-card)', color: 'var(--mf-muted)', font: 'inherit', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
          일정 추가
        </button>
      </div>
    );
  }

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
            <span style={{ flex: 1, minWidth: 0, borderTop: '1px solid var(--mf-border-soft)', display: 'block' }} />
          </span>
        ))}

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
                background: chip.bg,
                // 겹칠 때 카드 경계를 갈라 준다(원본 `ring`).
                boxShadow: n > 1 ? '0 0 0 1.5px var(--mf-card)' : 'none',
                cursor: 'pointer',
                font: 'inherit',
                textAlign: 'left',
                overflow: 'hidden',
              }}
            >
              <span style={{ fontSize: n > 2 ? 10 : 11, fontWeight: 800, letterSpacing: '-.015em', color: 'var(--mf-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.entry.title}</span>
              {n <= 2 && (
                <span style={{ fontSize: 9.5, color: 'var(--mf-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
        padding: '6px 9px',
        border: 0,
        borderLeft: `3px solid ${chip.dot}`,
        borderRadius: '4px 9px 9px 4px',
        background: 'var(--mf-panel2)',
        font: 'inherit',
        textAlign: 'left',
        cursor: 'pointer',
      }}
    >
      <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, fontWeight: 700, color: 'var(--mf-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.title || '제목 없음'}</span>
      <span style={{ flexShrink: 0, fontSize: 10, color: 'var(--mf-muted)', whiteSpace: 'nowrap' }}>{note}</span>
    </button>
  );
}


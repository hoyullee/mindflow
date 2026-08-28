import type { CalendarEntry } from './entries';
import { entryChip, type ChipSurface } from './chips';
import { DOW, dateLabel, dayProgress, dueBadge, entriesOn, isSpan, monthCells, overdueEntries, upcomingEntries } from './model';

/**
 * 일정 화면 오른쪽 — 미니 달력 + (마감 목록 | 고른 날짜).
 *
 * 디자인 원본은 이 자리에 **시간표**(12AM~11PM)도 두는데, 지금 우리 항목은 전부
 * 종일이라(칸반 마감은 시각을 갖지 않는다 — 결정) 시간표를 그리면 텅 빈 24줄이
 * 남는다. 시각이 있는 Geurio 일정이 들어오는 단계에서 함께 붙인다.
 */
export function CalendarSide({
  entries,
  todayIso,
  y,
  m,
  side,
  surface,
  selectedDay,
  onPickDay,
  onPickEntry,
  onSetMonth,
}: {
  entries: readonly CalendarEntry[];
  todayIso: string;
  y: number;
  m: number;
  side: 'list' | 'day';
  surface: ChipSurface;
  selectedDay: string;
  onPickDay: (iso: string) => void;
  onPickEntry: (e: CalendarEntry) => void;
  onSetMonth: (y: number, m: number) => void;
}) {
  // 미니 달력은 본문과 **같은 달**을 보여 준다 — 두 달력이 어긋나면 어느 쪽이
  // 기준인지 흐려진다(디자인 원본은 따로 넘길 수 있지만 그건 다음 단계).
  const cells = monthCells(y, m, entries, todayIso, 0);
  const dayList = entriesOn(entries, selectedDay);
  const upcoming = upcomingEntries(entries, todayIso);
  const overdue = overdueEntries(entries, todayIso);

  return (
    <aside
      data-cal-side
      style={{
        flex: '0 0 auto',
        width: 300,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: '16px 20px 20px 6px',
        overflowY: 'auto',
        overflowX: 'hidden',
      }}
      className="lnb-scroll"
    >
      {/* 미니 달력 */}
      <div style={{ flexShrink: 0, borderRadius: 14, border: '1px solid var(--mf-border)', background: 'var(--mf-card)', boxShadow: 'var(--mf-card-shadow-sm)', padding: '12px 12px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: '-.02em', color: 'var(--mf-text)' }}>{`${y}년 ${m}월`}</span>
          <span style={{ display: 'inline-flex', gap: 2 }}>
            <MiniNav label="이전 달" onClick={() => onSetMonth(m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1)} d="m15 6-6 6 6 6" />
            <MiniNav label="다음 달" onClick={() => onSetMonth(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1)} d="m9 6 6 6-6 6" />
          </span>
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
                  borderRadius: 8,
                  background: on ? 'var(--mf-accent)' : 'transparent',
                  color: on ? 'var(--mf-accent-ink)' : !c.inMonth ? 'var(--mf-faint2)' : c.isToday ? 'var(--mf-accent-strong)' : 'var(--mf-subtext)',
                  font: 'inherit',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 11,
                  fontWeight: c.isToday || on ? 800 : has ? 700 : 500,
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

      {/* 목록 */}
      {side === 'day' ? (
        /* 날짜별 보기 — 디자인 원본의 agenda: 종일 항목은 **왼쪽 색 바가 붙은 납작한 행**
           (마감 목록의 두 줄 카드와 다른 물건이다). 우측 메모는 열 이름, 기간이면 `N/M일째`.
           원본은 이 아래에 **시간표**(12AM~11PM)를 두는데, 지금 우리 항목은 전부 종일이라
           (칸반 마감은 시각을 갖지 않는다 — 결정) 그리면 빈 24줄만 남는다. 시각이 있는
           Geurio 일정이 들어오는 단계에서 원본의 빈 상태(`이 날에는 시간 일정이 없어요`)와
           함께 붙인다. */
        <Section title={dateLabel(selectedDay)} sub={`일정 ${dayList.length}개`}>
          {dayList.length ? dayList.map((e) => <DayChip key={`${e.docId}-${e.cardId}`} entry={e} iso={selectedDay} surface={surface} onPick={onPickEntry} />) : <Empty text="이 날에는 일정이 없어요" />}
        </Section>
      ) : (
        <>
          <Section title="다가오는 마감" sub={`${upcoming.length}건`}>
            {upcoming.length ? upcoming.slice(0, 20).map((e) => <Row key={`${e.docId}-${e.cardId}`} entry={e} todayIso={todayIso} surface={surface} onPick={onPickEntry} />) : <Empty text="다가오는 마감이 없어요" />}
          </Section>
          {overdue.length > 0 && (
            <Section title="지난 마감" sub={`${overdue.length}건`}>
              {overdue.slice(0, 20).map((e) => (
                <Row key={`${e.docId}-${e.cardId}`} entry={e} todayIso={todayIso} surface={surface} onPick={onPickEntry} />
              ))}
            </Section>
          )}
        </>
      )}
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

function Section({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, padding: '0 2px' }}>
        <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: '-.02em', color: 'var(--mf-text)' }}>{title}</span>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, color: 'var(--mf-faint)' }}>{sub}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{children}</div>
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

function Row({ entry, todayIso, surface, onPick }: { entry: CalendarEntry; todayIso: string; surface: ChipSurface; onPick: (e: CalendarEntry) => void }) {
  const chip = entryChip(entry, surface);
  const badge = dueBadge(entry.due, todayIso);
  const over = entry.due < todayIso;
  return (
    <button
      type="button"
      data-cal-row={`${entry.docId}:${entry.cardId}`}
      onClick={() => onPick(entry)}
      className="mf-ctl"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        padding: '7px 9px',
        borderRadius: 10,
        border: '1px solid var(--mf-border-soft)',
        background: 'var(--mf-card)',
        font: 'inherit',
        textAlign: 'left',
        cursor: 'pointer',
      }}
    >
      <span style={{ width: 5, height: 5, borderRadius: 999, background: chip.dot, flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: '-.01em', color: 'var(--mf-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.title || '제목 없음'}</span>
        <span style={{ fontSize: 11, color: 'var(--mf-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {entry.boardName} · {entry.colName}
          {isSpan(entry) ? ` · ${entry.start!.slice(5).replace('-', '.')} – ${entry.due.slice(5).replace('-', '.')}` : ''}
        </span>
      </span>
      <span
        style={{
          flexShrink: 0,
          height: 18,
          padding: '0 7px',
          borderRadius: 999,
          background: over ? 'var(--mf-danger-bg)' : 'var(--mf-accent-soft)',
          color: over ? 'var(--mf-danger)' : 'var(--mf-accent-strong)',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 9.5,
          fontWeight: 800,
          display: 'inline-flex',
          alignItems: 'center',
        }}
      >
        {badge}
      </span>
    </button>
  );
}

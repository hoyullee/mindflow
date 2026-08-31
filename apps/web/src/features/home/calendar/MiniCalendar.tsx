/**
 * 미니 달력 — 일정 화면 오른쪽 위의 그 달력이고, 대시보드 캘린더 위젯(1열 크기)도
 * **같은 것**을 쓴다(요청). 두 벌로 두면 한쪽에만 손이 가서 어긋난다.
 *
 * 숫자 색 규칙은 큰 달력과 같다(일=danger / 토=info / 오늘=강조색), 항목이 있는 날은
 * 아래 점 하나. 고른 날은 강조색 원.
 */

import type { CalendarEntry } from './entries';
import { DOW, entriesOn, monthCells } from './model';

export function MiniCalendar({
  entries,
  todayIso,
  y,
  m,
  selectedDay,
  onPickDay,
  onSetMonth,
  extraNav,
  cellH = 26,
  fill = false,
  holidays,
}: {
  entries: readonly CalendarEntry[];
  todayIso: string;
  y: number;
  m: number;
  selectedDay: string;
  onPickDay: (iso: string) => void;
  onSetMonth: (y: number, m: number) => void;
  /** 머리 오른쪽에 덧붙일 버튼(일정 화면의 사이드 닫기 ✕). */
  extraNav?: React.ReactNode;
  cellH?: number;
  /**
   * 주어진 높이를 **꽉 채운다**(제보: 아래에 빈 여백이 남는다). 여섯 줄이 남은
   * 높이를 나눠 가지므로 칸이 정사각이 아니게 되고, 그러면 `borderRadius: 999`가
   * 타원이 된다 — 그래서 이 모드에서는 배경(오늘·고른 날 표시)을 **칸이 아니라
   * 안쪽 원**이 진다.
   */
  fill?: boolean;
  /** 공휴일(구글 연동) — 큰 달력과 같은 규칙으로 숫자를 일요일 색으로 그린다. */
  holidays?: Record<string, string>;
}) {
  const cells = monthCells(y, m, entries, todayIso, 0, 6, holidays);
  return (
    <div data-mini-cal style={fill ? { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 } : undefined}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 2px 9px', flexShrink: 0 }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 800, letterSpacing: '-.02em', color: 'var(--mf-text)', whiteSpace: 'nowrap' }}>{`${y}년 ${m}월`}</span>
        <MiniNav label="이전 달" onClick={() => onSetMonth(m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1)} d="m18 15-6-6-6 6" />
        <MiniNav label="다음 달" onClick={() => onSetMonth(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1)} d="m6 9 6 6 6-6" />
        {extraNav}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, ...(fill ? { flex: 1, minHeight: 0, gridTemplateRows: 'auto repeat(6, 1fr)' } : null) }}>
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
              onClick={(e) => {
                e.stopPropagation();
                onPickDay(c.iso);
              }}
              aria-label={c.inMonth ? `${c.n}일` : undefined}
              style={{
                position: 'relative',
                height: fill ? undefined : cellH,
                minHeight: 0,
                padding: 0,
                border: 0,
                borderRadius: 999,
                background: !fill && on ? 'var(--mf-accent)' : 'transparent',
                // 숫자를 디자인 원본만큼 또렷하게(제보) — 평일은 본문 글자색·600,
                // 주말은 큰 달력과 같은 색(일=danger / 토=info).
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
                fontSize: fill ? 12.5 : 11,
                fontWeight: c.isToday || on ? 800 : 600,
                cursor: c.inMonth ? 'pointer' : 'default',
                display: fill ? 'flex' : undefined,
                alignItems: fill ? 'center' : undefined,
                justifyContent: fill ? 'center' : undefined,
              }}
            >
              {fill ? (
                <span
                  data-mini-num
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 999,
                    background: on ? 'var(--mf-accent)' : 'transparent',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {c.n}
                </span>
              ) : (
                c.n
              )}
              {has && !on && <span style={{ position: 'absolute', bottom: fill ? 4 : 3, left: '50%', transform: 'translateX(-50%)', width: 3, height: 3, borderRadius: 999, background: 'var(--mf-accent)' }} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function MiniNav({ label, d, onClick }: { label: string; d: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className="mf-ctl"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      style={{ width: 24, height: 24, borderRadius: 999, border: 0, background: 'transparent', color: 'var(--mf-muted)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={d} />
      </svg>
    </button>
  );
}

/**
 * 미니 달력 — 일정 화면 오른쪽 위의 그 달력이고, 대시보드 캘린더 위젯(1열 크기)도
 * **같은 것**을 쓴다(요청). 두 벌로 두면 한쪽에만 손이 가서 어긋난다.
 *
 * 숫자 색 규칙은 큰 달력과 같다(일=danger / 토=info / 오늘=강조색), 항목이 있는 날은
 * 아래 점 하나. 고른 날은 강조색 원.
 *
 * **이웃 달 날짜도 평범한 칸이다**(제보) — 격자가 담고 있는 날이면 고를 수 있다.
 * 흐린 것은 "이번 달이 아니다"라는 표시일 뿐 못 쓰는 자리라는 뜻이 아니다(큰 달력의
 * `MonthGrid`와 같은 규칙이고, 조회 구간도 `gridRange`라 그 날의 항목이 이미 있다).
 */

import type { CalendarEntry, HolidayInfo } from './entries';
import { type ChipSurface, entryChip } from './chips';
import { DOW, entriesOn, monthCells, partsOf, type MonthCell } from './model';

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
  variant = 'default',
  surface,
}: {
  entries: readonly CalendarEntry[];
  todayIso: string;
  y: number;
  m: number;
  selectedDay: string;
  onPickDay: (iso: string) => void;
  onSetMonth: (y: number, m: number) => void;
  /** 머리 오른쪽에 덧붙일 버튼(공책 우측 열의 닫기 ✕). */
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
  holidays?: Record<string, HolidayInfo>;
  /**
   * `side` — 일정 화면 오른쪽 패널의 옷(스펙: 일정 페이지 4.1). 날짜는 21px 알약, 그 **아래**
   * 3.5px 점(그 날 첫 항목의 종류 색), 고른 날은 옅은 면. 공책의 일정 블록은 `default` 그대로다.
   */
  variant?: 'default' | 'side';
  /** `side`의 점 색을 칩과 같은 규칙으로 뽑는 면(홈 테마). */
  surface?: ChipSurface;
}) {
  const cells = monthCells(y, m, entries, todayIso, 0, 6, holidays);
  if (variant === 'side') return <SideMini cells={cells} entries={entries} y={y} m={m} selectedDay={selectedDay} onPickDay={onPickDay} onSetMonth={onSetMonth} extraNav={extraNav} {...(surface ? { surface } : {})} />;
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
          const has = entriesOn(entries, c.iso).length > 0;
          const on = c.iso === selectedDay;
          return (
            <button
              key={c.iso}
              type="button"
              data-mini-day={c.iso}
              onClick={(e) => {
                e.stopPropagation();
                onPickDay(c.iso);
              }}
              aria-label={`${partsOf(c.iso)!.m}월 ${c.n}일`}
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
                      : c.dow === 0 || c.dayOff
                        ? 'var(--mf-danger)'
                        : c.dow === 6
                          ? 'var(--mf-info)'
                          : 'var(--mf-text)',
                font: 'inherit',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: fill ? 12.5 : 11,
                fontWeight: c.isToday || on ? 800 : 600,
                cursor: 'pointer',
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

export function MiniNav({ label, d, onClick, size = 24 }: { label: string; d: string; onClick: () => void; size?: number }) {
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
      style={{ width: size, height: size, flexShrink: 0, borderRadius: 999, border: 0, background: 'transparent', color: 'var(--mf-muted)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <svg width={size < 24 ? 11 : 12} height={size < 24 ? 11 : 12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={size < 24 ? 2.6 : 2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={d} />
      </svg>
    </button>
  );
}

/**
 * 일정 화면 패널의 미니 달력(스펙 4.1). 규칙은 기본판과 같다 — 이웃 달 날짜도 고를 수
 * 있고, 누르면 큰 달력이 그 달로 가며 그 날이 골라진다(호출부의 `onPickDay`).
 */
function SideMini({
  cells,
  entries,
  y,
  m,
  selectedDay,
  onPickDay,
  onSetMonth,
  surface,
  extraNav,
}: {
  cells: MonthCell[];
  entries: readonly CalendarEntry[];
  y: number;
  m: number;
  selectedDay: string;
  onPickDay: (iso: string) => void;
  onSetMonth: (y: number, m: number) => void;
  surface?: ChipSurface;
  extraNav?: React.ReactNode;
}) {
  return (
    <div data-mini-cal data-mini-variant="side">
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '0 0 9px 4px' }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 800, letterSpacing: '-.02em', color: 'var(--mf-text)', whiteSpace: 'nowrap' }}>{`${y}년 ${m}월`}</span>
        <MiniNav size={22} label="이전 달" onClick={() => onSetMonth(m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1)} d="m18 15-6-6-6 6" />
        <MiniNav size={22} label="다음 달" onClick={() => onSetMonth(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1)} d="m6 9 6 6 6-6" />
        {extraNav}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1 }}>
        {DOW.map((d, i) => (
          <span key={d} style={{ height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9.5, fontWeight: 700, color: i === 0 ? 'var(--mf-cal-dow-sun)' : i === 6 ? 'var(--mf-cal-dow-sat)' : 'var(--mf-faint)' }}>
            {d}
          </span>
        ))}
        {cells.map((c) => {
          const first = entriesOn(entries, c.iso)[0];
          const on = c.iso === selectedDay;
          // 점은 그 날 **첫 항목의 종류 색** — 칸의 칩과 같은 규칙(`entryChip`)이라 큰 달력에서
          // 보던 그 색이 여기서도 난다. 면을 모르면(호출부가 안 줬으면) 강조색.
          const dot = first ? (surface ? entryChip(first, surface).base : 'var(--mf-accent)') : 'transparent';
          const fg = c.isToday
            ? 'var(--mf-accent-ink)'
            : !c.inMonth
              ? 'var(--mf-faint2)'
              : c.dow === 0 || c.dayOff
                ? 'var(--mf-cal-num-sun)'
                : c.dow === 6
                  ? 'var(--mf-cal-num-sat)'
                  : 'var(--mf-text)';
          return (
            <button
              key={c.iso}
              type="button"
              data-mini-day={c.iso}
              data-selected={on ? '1' : undefined}
              onClick={(e) => {
                e.stopPropagation();
                onPickDay(c.iso);
              }}
              aria-label={`${partsOf(c.iso)!.m}월 ${c.n}일`}
              aria-pressed={on}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 4, padding: '0 0 3px', border: 0, background: 'transparent', font: 'inherit', cursor: 'pointer' }}
            >
              <span
                data-mini-num
                style={{
                  height: 21,
                  borderRadius: 99,
                  background: c.isToday ? 'var(--mf-accent)' : on ? 'var(--mf-cal-sel)' : 'transparent',
                  color: fg,
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 11,
                  fontWeight: c.isToday || on ? 800 : 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'background-color .12s ease',
                }}
              >
                {c.n}
              </span>
              <span data-mini-dot={first ? '1' : undefined} aria-hidden="true" style={{ alignSelf: 'center', width: 3.5, height: 3.5, borderRadius: 99, background: dot, opacity: c.inMonth ? 1 : 0.5 }} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

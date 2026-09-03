// 연도·월 고르기 — 디자인 원본 `Geurio 일정 캘린더.dc.html`의 `ymOpen` 블록 이식.
//
// 헤더의 `2026년 8월`을 누르면 열린다. 두 단계다: 월 격자(4열 × 3행)에서 바로 고르거나,
// 가운데 연도를 눌러 **연도 격자**(3열 × 5행 = 15년)로 바꿔 고른 뒤 월로 돌아온다.
// 화살표는 지금 보이는 격자를 따라 움직인다(월 격자면 1년씩, 연도 격자면 15년씩).
//
// 달력을 몇 번씩 넘겨 먼 달로 가는 대신 두 번 눌러 닿게 하는 자리다.

import { useState } from 'react';
import { Popover } from '../../../components/Popover';
import { monthLabel } from './model';

/** 연도 격자가 한 번에 보여 주는 해의 수 — 원본과 같은 15칸(3열 × 5행). */
const YEARS = 15;

export function MonthPicker({
  y,
  m,
  now,
  onPick,
  label,
}: {
  y: number;
  m: number;
  /** 오늘이 속한 해·달 — `이번 달`과 점 표시의 기준. */
  now: { y: number; m: number };
  onPick: (y: number, m: number) => void;
  /** 버튼에 보이는 글자(`2026년 8월`). */
  label: string;
}) {
  const [open, setOpen] = useState(false);
  // 팝오버 안에서만 넘겨 보는 해 — 고르기 전까지 달력은 움직이지 않는다.
  const [viewY, setViewY] = useState(y);
  const [years, setYears] = useState(false);
  const [base, setBase] = useState(y - 7);

  const start = (): void => {
    setViewY(y);
    setYears(false);
    setBase(y - 7);
  };

  const close = (): void => {
    setOpen(false);
    setYears(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        if (v) start();
        setOpen(v);
        if (!v) setYears(false);
      }}
      label="연도·월 선택"
      side="bottom"
      align="center"
      sideOffset={6}
      panel={{
        width: 264,
        boxSizing: 'border-box',
        borderRadius: 18,
        background: 'var(--mf-card)',
        border: '1px solid var(--mf-border)',
        boxShadow: 'var(--mf-card-shadow)',
        overflow: 'hidden',
        zIndex: 260,
      }}
      trigger={
        <button
          type="button"
          data-cal-month
          title="연도·월 선택"
          aria-label="연도·월 선택"
          className="mf-ctl"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            height: 26,
            padding: '0 10px',
            border: 0,
            borderRadius: 999,
            background: open ? 'var(--mf-panel2)' : 'transparent',
            font: 'inherit',
            fontSize: 12.5,
            fontWeight: 800,
            letterSpacing: '-.02em',
            color: 'var(--mf-text)',
            whiteSpace: 'nowrap',
            cursor: 'pointer',
          }}
        >
          {/* 1자리 달과 2자리 달에서 **버튼 폭이 달라지지 않게** — 가장 넓은 표기
              (`…년 12월`)를 같은 칸에 숨겨 두고 그 폭을 쓴다(제보). 숫자는 등폭으로
              맞춰(`tabular-nums`) 2026 ↔ 2027처럼 해가 바뀌어도 흔들리지 않는다.
              고정 px을 적지 않으므로 폰트가 바뀌어도 따라간다. */}
          <span style={{ display: 'inline-grid', fontVariantNumeric: 'tabular-nums' }}>
            <span aria-hidden="true" style={{ gridArea: '1 / 1', visibility: 'hidden', pointerEvents: 'none' }}>
              {monthLabel(y, 12)}
            </span>
            <span data-cal-month-label style={{ gridArea: '1 / 1', textAlign: 'center' }}>{label}</span>
          </span>
          <Caret rotate={false} />
        </button>
      }
    >
      <>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '12px 12px 10px' }}>
          <Arrow
            label={years ? '이전 15년' : '이전 해'}
            d="m15 6-6 6 6 6"
            onClick={() => (years ? setBase((b) => b - YEARS) : setViewY((v) => v - 1))}
          />
          <button
            type="button"
            data-ym-head
            aria-label="연도 선택"
            onClick={() => {
              if (!years) setBase(viewY - 7);
              setYears((v) => !v);
            }}
            className="mf-ctl"
            style={{ flex: 1, minWidth: 0, height: 30, border: 0, borderRadius: 10, background: years ? 'var(--mf-panel2)' : 'transparent', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer', font: 'inherit' }}
          >
            <span style={{ fontSize: 14.5, fontWeight: 800, letterSpacing: '-.03em', color: 'var(--mf-text)', whiteSpace: 'nowrap' }}>
              {years ? `${base} – ${base + YEARS - 1}` : `${viewY}`}
            </span>
            <Caret rotate={years} />
          </button>
          <Arrow
            label={years ? '다음 15년' : '다음 해'}
            d="m9 6 6 6-6 6"
            onClick={() => (years ? setBase((b) => b + YEARS) : setViewY((v) => v + 1))}
          />
        </div>

        {years ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2, padding: '0 10px 10px' }}>
            {Array.from({ length: YEARS }, (_, i) => base + i).map((n) => (
              <Cell
                key={n}
                on={n === viewY}
                isNow={n === now.y}
                mono
                label={`${n}`}
                onClick={() => {
                  setViewY(n);
                  setYears(false);
                }}
                attrs={{ 'data-ym-year': `${n}` }}
              />
            ))}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 2, padding: '0 10px 10px' }}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
              <Cell
                key={n}
                on={viewY === y && n === m}
                isNow={viewY === now.y && n === now.m}
                label={`${n}월`}
                onClick={() => {
                  onPick(viewY, n);
                  close();
                }}
                attrs={{ 'data-ym-month': `${n}` }}
              />
            ))}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 13px 10px', borderTop: '1px solid var(--mf-border-soft)', background: 'var(--mf-panel2)' }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: 10.5, color: 'var(--mf-faint)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {years ? '연도를 고르면 월로 돌아가요' : '연도를 누르면 연도 목록이 열려요'}
          </span>
          <button
            type="button"
            data-ym-today
            onClick={() => {
              onPick(now.y, now.m);
              close();
            }}
            className="mf-ctl"
            style={{ flex: '0 0 auto', whiteSpace: 'nowrap', height: 24, padding: '0 11px', border: 0, borderRadius: 999, background: 'transparent', color: 'var(--mf-accent-strong)', font: 'inherit', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}
          >
            이번 달
          </button>
        </div>
      </>
    </Popover>
  );
}

/** 고른 칸은 강조색으로 채우고, 오늘이 속한 칸은 글자색 + 아래 점으로 알린다. */
function Cell({ on, isNow, label, mono, onClick, attrs }: { on: boolean; isNow: boolean; label: string; mono?: boolean; onClick: () => void; attrs?: Record<string, string> }) {
  return (
    <button
      type="button"
      {...attrs}
      aria-pressed={on}
      onClick={onClick}
      className={on ? undefined : 'mf-ctl'}
      style={{
        position: 'relative',
        height: 44,
        border: 0,
        borderRadius: 12,
        background: on ? 'var(--mf-accent)' : 'transparent',
        color: on ? 'var(--mf-accent-ink)' : isNow ? 'var(--mf-accent-strong)' : 'var(--mf-text)',
        font: 'inherit',
        fontFamily: mono ? "'JetBrains Mono', monospace" : undefined,
        fontSize: mono ? 12.5 : 13,
        fontWeight: on ? 800 : 600,
        letterSpacing: mono ? undefined : '-.02em',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {label}
      {!on && isNow && <span style={{ position: 'absolute', bottom: 7, left: '50%', transform: 'translateX(-50%)', width: 4, height: 4, borderRadius: 999, background: 'var(--mf-accent)', display: 'block' }} />}
    </button>
  );
}

function Arrow({ label, d, onClick }: { label: string; d: string; onClick: () => void }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} className="mf-ctl" style={{ width: 28, height: 28, flex: '0 0 auto', border: 0, borderRadius: 999, background: 'transparent', color: 'var(--mf-muted)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={d} />
      </svg>
    </button>
  );
}

function Caret({ rotate }: { rotate: boolean }) {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--mf-faint2)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" style={{ flex: '0 0 auto', transform: rotate ? 'rotate(180deg)' : 'none', transition: 'transform .16s ease' }} aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

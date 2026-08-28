// 날짜 고르기 팝오버 — 디자인 원본 `Geurio 일정 캘린더.dc.html`의 `pkOpen`(`pkIsDate`).
//
// **native `<input type="date">`를 쓰지 않는 이유**: 디자인은 이 팝오버 하나를 상세
// 팝업·새 일정·반복 종료일이 함께 쓰고(원본의 `openPk('date', …)`), 발치에 `오늘`·
// `지우기`를 둔다 — native 위젯에는 그 자리가 없고 모양도 브라우저·OS마다 다르다.
//
// 트리거 버튼도 함께 낸다(`DateButton`) — 원본의 `data-pkf` 버튼 꼴(달력 글리프 +
// 라벨, 열려 있으면 강조색 테두리 + 링)이 세 곳에서 같아야 한다.

import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Popover } from '../../../components/Popover';
import { DOW, addMonth, isoOf, monthLabel, partsOf, todayISO } from './model';

/** `8월 30일 (일)` — 원본 `fmtDateLabel`. 값이 없으면 `날짜 선택`. */
export function dateLabelOf(iso: string | undefined): string {
  const p = iso ? partsOf(iso) : null;
  if (!p) return '날짜 선택';
  const dow = DOW[new Date(p.y, p.m - 1, p.d).getDay()]!;
  return `${p.m}월 ${p.d}일 (${dow})`;
}

/** 달력 글리프 — 원본의 그 도형(둥근 사각 + 고리 둘 + 가로선). */
export function CalendarIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: '0 0 auto' }} aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
      <path d="M8 3v4M16 3v4M3.5 10h17" />
    </svg>
  );
}

/**
 * 날짜 트리거 + 팝오버 한 벌. 값이 바뀌면 `onPick`이 곧바로 불린다(원본과 같이
 * 고르는 즉시 저장 — 확인 버튼이 없다). `null`은 지우기.
 */
export function DateButton({
  value,
  onPick,
  label,
  min,
  disabled,
  clearable = true,
  attrs,
}: {
  value: string | undefined;
  onPick: (iso: string | null) => void;
  /** 접근 이름 — `시작일`·`기한`처럼 무엇의 날짜인지. */
  label: string;
  /** 이보다 앞선 날은 고를 수 없다(기한 < 시작일 방지). */
  min?: string;
  disabled?: boolean;
  clearable?: boolean;
  attrs?: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label={`${label} 고르기`}
      side="bottom"
      align="start"
      sideOffset={6}
      panel={{
        width: 262,
        boxSizing: 'border-box',
        borderRadius: 16,
        background: 'var(--mf-card)',
        border: '1px solid var(--mf-border)',
        boxShadow: 'var(--mf-card-shadow)',
        overflow: 'hidden',
        zIndex: 340,
      }}
      trigger={
        <button
          type="button"
          aria-label={label}
          disabled={disabled}
          {...attrs}
          style={{
            flex: 1,
            minWidth: 0,
            height: 40,
            padding: '0 12px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            boxSizing: 'border-box',
            borderRadius: 12,
            border: `1px solid ${open ? 'var(--mf-accent)' : 'var(--mf-border)'}`,
            background: 'var(--mf-card)',
            font: 'inherit',
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--mf-text)',
            cursor: disabled ? 'default' : 'pointer',
            textAlign: 'left',
            boxShadow: open ? '0 0 0 3px var(--mf-accent-soft)' : 'none',
          }}
        >
          <span style={{ color: 'var(--mf-faint2)', display: 'inline-flex' }}>
            <CalendarIcon />
          </span>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dateLabelOf(value)}</span>
        </button>
      }
    >
      <DateGrid
        value={value}
        min={min}
        clearable={clearable}
        onPick={(iso) => {
          setOpen(false);
          onPick(iso);
        }}
      />
    </Popover>
  );
}

/** 팝오버 안의 미니 달력 — 원본 `pkCells`(6주 42칸) + 발치 `오늘`·`지우기`. */
function DateGrid({ value, min, clearable, onPick }: { value: string | undefined; min?: string; clearable: boolean; onPick: (iso: string | null) => void }) {
  const today = todayISO();
  const seed = partsOf(value ?? '') ?? partsOf(today)!;
  const [ym, setYm] = useState({ y: seed.y, m: seed.m });

  // 항상 6주 = 42칸(월 격자와 같은 규칙 — 달을 넘겨도 높이가 흔들리지 않는다).
  const first = new Date(ym.y, ym.m - 1, 1);
  const gridStart = new Date(first);
  gridStart.setDate(1 - first.getDay());
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    const iso = isoOf(d.getFullYear(), d.getMonth() + 1, d.getDate());
    return { iso, n: d.getDate(), inMonth: d.getMonth() + 1 === ym.m, blocked: !!min && iso < min };
  });

  return (
    <>
      <span style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '11px 11px 8px' }}>
        <NavBtn label="이전 달" d="m15 6-6 6 6 6" onClick={() => setYm((p) => addMonth(p.y, p.m, -1))} />
        <span data-datepop-month style={{ flex: 1, minWidth: 0, textAlign: 'center', fontSize: 13, fontWeight: 800, letterSpacing: '-.025em', color: 'var(--mf-text)', whiteSpace: 'nowrap' }}>
          {monthLabel(ym.y, ym.m)}
        </span>
        <NavBtn label="다음 달" d="m9 6 6 6-6 6" onClick={() => setYm((p) => addMonth(p.y, p.m, 1))} />
      </span>

      <span style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, padding: '0 10px 3px' }}>
        {DOW.map((d, i) => (
          <span key={d} style={{ height: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9.5, fontWeight: 700, color: i === 0 ? 'var(--mf-danger)' : i === 6 ? 'var(--mf-info)' : 'var(--mf-faint2)' }}>
            {d}
          </span>
        ))}
      </span>

      <span style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, padding: '0 10px 8px' }}>
        {cells.map((c) => {
          const on = c.iso === value;
          const isToday = c.iso === today;
          return (
            <button
              key={c.iso}
              type="button"
              data-datepop-day={c.iso}
              aria-label={`${c.n}일`}
              aria-pressed={on}
              disabled={c.blocked}
              onClick={() => onPick(c.iso)}
              className={c.blocked ? undefined : 'mf-ctl'}
              style={{
                height: 30,
                border: 0,
                borderRadius: 999,
                background: on ? 'var(--mf-accent)' : isToday ? 'var(--mf-accent-soft)' : 'transparent',
                color: on ? 'var(--mf-accent-ink)' : c.blocked ? 'var(--mf-faint)' : c.inMonth ? 'var(--mf-text)' : 'var(--mf-faint)',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 11.5,
                fontWeight: on || isToday ? 800 : c.inMonth ? 600 : 500,
                cursor: c.blocked ? 'default' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: c.blocked ? 0.45 : 1,
              }}
            >
              {c.n}
            </button>
          );
        })}
      </span>

      <span style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px 10px', borderTop: '1px solid var(--mf-border-soft)', background: 'var(--mf-panel2)' }}>
        <button type="button" className="mf-ctl" onClick={() => onPick(today)} style={{ flex: '0 0 auto', whiteSpace: 'nowrap', height: 25, padding: '0 11px', border: 0, borderRadius: 999, background: 'transparent', color: 'var(--mf-accent-strong)', font: 'inherit', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>
          오늘
        </button>
        <span style={{ flex: 1, minWidth: 0 }} />
        {clearable && (
          <button type="button" className="mf-ctl" onClick={() => onPick(null)} style={{ flex: '0 0 auto', whiteSpace: 'nowrap', height: 25, padding: '0 11px', border: 0, borderRadius: 999, background: 'transparent', color: 'var(--mf-muted)', font: 'inherit', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
            지우기
          </button>
        )}
      </span>
    </>
  );
}

function NavBtn({ label, d, onClick }: { label: string; d: string; onClick: () => void }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} className="mf-ctl" style={{ width: 26, height: 26, flex: '0 0 auto', border: 0, borderRadius: 999, background: 'transparent', color: 'var(--mf-muted)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={d} />
      </svg>
    </button>
  );
}

/** 원본의 알약 칩 스타일 — 상세 팝업의 `상태`(라디오)·`분류`(버튼)가 같은 꼴을 쓴다. */
export function pillStyle(on: boolean, dashed = false): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    height: 34,
    padding: '0 15px',
    borderRadius: 999,
    border: dashed ? '1.5px dashed var(--mf-border)' : `1.5px solid ${on ? 'var(--mf-accent-mute)' : 'var(--mf-border)'}`,
    background: dashed ? 'transparent' : on ? 'var(--mf-accent-soft)' : 'var(--mf-card)',
    color: on ? 'var(--mf-accent-strong)' : 'var(--mf-muted)',
    font: 'inherit',
    fontSize: 13,
    fontWeight: on ? 800 : 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    flex: '0 0 auto',
  };
}

export function PillButton({ on, dot, children, onClick, attrs, dashed }: { on: boolean; dot?: string; children: ReactNode; onClick: () => void; attrs?: Record<string, string>; dashed?: boolean }) {
  return (
    // 켜짐을 `aria-pressed`로 알린다 — 종일 토글은 두 상태 버튼이고, 분류 알약은
    // 통계 칩과 같은 "지금 이것"이다(보이는 테두리만으로는 보조기술이 알 수 없다).
    <button type="button" className="mf-ctl" aria-pressed={on} onClick={onClick} {...attrs} style={pillStyle(on, dashed)}>
      {dot && <span style={{ width: 7, height: 7, borderRadius: 999, background: dot, display: 'block', flex: '0 0 auto' }} />}
      {children}
    </button>
  );
}

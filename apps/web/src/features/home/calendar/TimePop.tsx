// 시각 고르기 팝오버 — 디자인 원본 `Geurio 일정 캘린더.dc.html`의 `pkIsTime`.
//
// 15분 간격 목록에서 고른다(원본과 같은 꼴: 최대 236px 높이·스크롤). native
// `<input type="time">`을 쓰지 않는 이유는 날짜 팝오버와 같다 — 모양이 브라우저·OS
// 마다 다르고, 원본은 "고른 시각으로 스크롤이 맞춰진 목록"을 보여 준다.

import { useEffect, useRef, useState } from 'react';
import { Popover } from '../../../components/Popover';
import { minutesOf, timeLabel } from './model';

/** 15분 간격 — 하루 96칸. 원본의 목록 간격. */
const STEP = 15;

function hhmm(mins: number): string {
  return `${`${Math.floor(mins / 60)}`.padStart(2, '0')}:${`${mins % 60}`.padStart(2, '0')}`;
}

export function TimeButton({
  value,
  onPick,
  label,
  min,
  attrs,
}: {
  value: string;
  onPick: (hhmm: string) => void;
  label: string;
  /** 이 시각보다 앞선 값은 고를 수 없다(종료 < 시작 방지). */
  min?: string;
  attrs?: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const cur = minutesOf(value) ?? 0;
  const floor = min ? minutesOf(min) : null;

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label={`${label} 고르기`}
      side="bottom"
      align="start"
      sideOffset={6}
      panel={{
        width: 148,
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
          // 팝오버 트리거도 손을 얹으면 반응한다(디자인 원본의 `style-hover`).
          className="mf-ctl"
          aria-label={label}
          {...attrs}
          style={{
            flex: 1,
            minWidth: 0,
            height: 38,
            padding: '0 12px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            boxSizing: 'border-box',
            borderRadius: 12,
            border: `1px solid ${open ? 'var(--mf-accent)' : 'var(--mf-border)'}`,
            background: 'var(--mf-card)',
            font: 'inherit',
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--mf-text)',
            cursor: 'pointer',
            textAlign: 'left',
            boxShadow: open ? '0 0 0 3px var(--mf-accent-soft)' : 'none',
          }}
        >
          <span style={{ color: 'var(--mf-faint2)', display: 'inline-flex', flex: '0 0 auto' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="8.5" />
              <path d="M12 7.5V12l3 2" />
            </svg>
          </span>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{timeLabel(cur)}</span>
        </button>
      }
    >
      <TimeList
        cur={cur}
        floor={floor}
        onPick={(v) => {
          setOpen(false);
          onPick(v);
        }}
      />
    </Popover>
  );
}

function TimeList({ cur, floor, onPick }: { cur: number; floor: number | null; onPick: (hhmm: string) => void }) {
  const listRef = useRef<HTMLDivElement | null>(null);
  // 고른 시각이 보이도록 맞춘다(원본 `pkListRef` — 자정부터 훑게 두지 않는다).
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const target = el.querySelector('[data-timepop-cur="1"]') as HTMLElement | null;
    if (target) el.scrollTop = Math.max(0, target.offsetTop - 80);
  }, []);
  const items: number[] = [];
  for (let m = 0; m < 24 * 60; m += STEP) items.push(m);
  return (
    <div ref={listRef} className="lnb-scroll" data-timepop style={{ display: 'flex', flexDirection: 'column', gap: 1, maxHeight: 236, overflowY: 'auto', padding: 8 }}>
      {items.map((m) => {
        const on = m === cur;
        const blocked = floor !== null && m <= floor;
        return (
          <button
            key={m}
            type="button"
            data-timepop-time={hhmm(m)}
            data-timepop-cur={on ? '1' : undefined}
            disabled={blocked}
            onClick={() => onPick(hhmm(m))}
            className={blocked ? undefined : 'mf-ctl'}
            style={{
              flex: '0 0 auto',
              height: 26,
              border: 0,
              borderRadius: 8,
              background: on ? 'var(--mf-accent-soft)' : 'transparent',
              color: on ? 'var(--mf-accent-strong)' : blocked ? 'var(--mf-faint)' : 'var(--mf-text)',
              font: 'inherit',
              fontSize: 11.5,
              fontWeight: on ? 800 : 600,
              cursor: blocked ? 'default' : 'pointer',
              textAlign: 'left',
              padding: '0 10px',
              whiteSpace: 'nowrap',
              opacity: blocked ? 0.5 : 1,
            }}
          >
            {timeLabel(m)}
          </button>
        );
      })}
    </div>
  );
}

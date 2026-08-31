// 일정 팝업의 작은 부품들 — 라벨 있는 구획·숫자 조절·알약 묶음.
//
// `GoogleEventFields`가 들고 있던 것을 뽑아냈다: 반복 구획이 **구글 전용이 아니게**
// 되면서(Geurio 일정도 반복한다) 두 파일이 같은 부품을 써야 했다. 값을 두 벌로 두면
// 같은 팝업 안에서 같은 것이 달라 보인다.

import type { CSSProperties, ReactNode } from 'react';
import { RadioCards } from '../../../components/Segmented';

export function Field({ label, trailing, children }: { label: string; trailing?: ReactNode; children?: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span
          style={{
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: '-.01em',
            color: 'var(--mf-subtext)',
          }}
        >
          {label}
        </span>
        <span style={{ flex: 1, minWidth: 0 }} />
        {trailing}
      </span>
      {children}
    </div>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
        minWidth: 0,
      }}
    >
      <span
        style={{
          flex: '0 0 auto',
          fontSize: 11,
          fontWeight: 700,
          color: 'var(--mf-faint2)',
          minWidth: 56,
        }}
      >
        {label}
      </span>
      {children}
    </span>
  );
}

export function SubText({ children }: { children: ReactNode }) {
  return <span style={{ fontSize: 11.5, color: 'var(--mf-faint2)', lineHeight: 1.55 }}>{children}</span>;
}

export function Stepper({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (n: number) => void }) {
  const btn: CSSProperties = {
    width: 24,
    height: 24,
    borderRadius: 8,
    border: '1px solid var(--mf-border)',
    background: 'var(--mf-card)',
    color: 'var(--mf-subtext)',
    font: 'inherit',
    fontSize: 13,
    fontWeight: 800,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: '0 0 auto',
  };
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        flex: '0 0 auto',
      }}
    >
      <button type="button" className="mf-ctl" aria-label="줄이기" onClick={() => onChange(Math.max(min, value - 1))} style={btn}>
        −
      </button>
      <span
        style={{
          minWidth: 22,
          textAlign: 'center',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 12.5,
          fontWeight: 700,
          color: 'var(--mf-text)',
        }}
      >
        {value}
      </span>
      <button type="button" className="mf-ctl" aria-label="늘리기" onClick={() => onChange(Math.min(max, value + 1))} style={btn}>
        +
      </button>
    </span>
  );
}

/** 하나만 고르는 알약 묶음 — 화살표로도 옮겨 다닌다(이 앱의 규칙). */
export function Segments({ aria, items, value, onChange, attr, wide }: { aria: string; items: { value: string; label: string }[]; value: string; onChange: (v: string) => void; attr: string; wide?: boolean }) {
  return (
    <RadioCards
      label={aria}
      value={value}
      onChange={onChange}
      grid={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        flexWrap: 'wrap',
        ...(wide ? {} : { flex: '0 0 auto' }),
      }}
      items={items.map((it) => ({
        value: it.value,
        label: it.label,
        className: 'mf-ctl',
        attrs: { [attr]: it.value },
        style: (on: boolean) => ({
          height: 30,
          padding: '0 12px',
          borderRadius: 999,
          border: on ? '1.5px solid var(--mf-accent-mute)' : '1px solid var(--mf-border)',
          background: on ? 'var(--mf-accent-soft)' : 'var(--mf-card)',
          color: on ? 'var(--mf-accent-strong)' : 'var(--mf-subtext)',
          font: 'inherit',
          fontSize: 12,
          fontWeight: on ? 800 : 600,
          cursor: 'pointer',
          whiteSpace: 'nowrap' as const,
        }),
        children: it.label,
      }))}
    />
  );
}

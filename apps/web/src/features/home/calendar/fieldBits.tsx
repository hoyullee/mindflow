// 일정 팝업의 작은 부품들 — 라벨 있는 구획·숫자 조절·알약 묶음.
//
// `GoogleEventFields`가 들고 있던 것을 뽑아냈다: 반복 구획이 **구글 전용이 아니게**
// 되면서(Geurio 일정도 반복한다) 두 파일이 같은 부품을 써야 했다. 값을 두 벌로 두면
// 같은 팝업 안에서 같은 것이 달라 보인다.

import type { CSSProperties, ReactNode } from 'react';
import { RadioCards } from '../../../components/Segmented';

export function Field({ label, sub, trailing, children }: { label: string; sub?: string; trailing?: ReactNode; children?: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <span style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
        <span style={{ flex: '0 0 auto', whiteSpace: 'nowrap', fontSize: 12, fontWeight: 800, letterSpacing: '-.01em', color: 'var(--mf-subtext)' }}>{label}</span>
        {/* 라벨 옆 한 줄 요약(원본 `nGuestSummary`·`nRoomSummary`) — 없으면 자리만 채운다. */}
        {sub ? (
          <span data-field-sub style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 10.5, color: 'var(--mf-faint2)' }}>
            {sub}
          </span>
        ) : (
          <span style={{ flex: 1, minWidth: 0 }} />
        )}
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

/**
 * 위치 옆의 **지도에서 보기**(요청 ④) — 구글 캘린더는 주소를 입력하는 동안 장소를
 * 자동완성해 주지만, 그건 **Places API**의 일이다: 별도 API 키와 결제 계정이 필요하고
 * (그 키는 브라우저에 실려 나가므로 도메인 제한·사용량 관리까지 딸려 온다) 무료
 * 한도가 없다. 그래서 지금은 자동완성 대신 **적어 둔 주소를 지도에서 여는 길**을 낸다 —
 * 키도 비용도 필요 없고, 사용자가 실제로 하려던 일("그래서 거기가 어디야")에 닿는다.
 *
 * 주소가 비어 있으면 그리지 않는다(눌러도 아무 데도 못 가는 버튼을 두지 않는다).
 */
export function MapLink({ query }: { query: string }) {
  const q = query.trim();
  if (!q) return null;
  return (
    <a
      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`}
      target="_blank"
      rel="noopener noreferrer"
      data-map-link
      className="mf-ctl"
      title="지도에서 보기"
      style={{ flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', gap: 5, height: 24, padding: '0 9px', borderRadius: 999, border: '1px solid var(--mf-border)', background: 'var(--mf-card)', color: 'var(--mf-subtext)', fontSize: 10.5, fontWeight: 700, textDecoration: 'none' }}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
        <circle cx="12" cy="10" r="2.6" />
      </svg>
      지도에서 보기
    </a>
  );
}

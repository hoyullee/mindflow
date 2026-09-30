import { useEffect, type CSSProperties, type ReactNode, type RefObject } from 'react';
import type { TicketStatus } from '../jira/jiraApi';

/** 작업 현황의 공통 조각 — 아바타·세그먼트·상태 배지·바깥 클릭 닫기. */

export const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

export const STATUS: Record<TicketStatus, { label: string; bg: string; fg: string }> = {
  todo: { label: '예정', bg: '#F3EEE8', fg: '#8A8078' },
  doing: { label: '진행 중', bg: '#FBEDE6', fg: '#D8794F' },
  done: { label: '완료', bg: '#EBF5EE', fg: '#2F7D57' },
};

export function Avatar({ ini, c, size, ring, font }: { ini: string; c: string; size: number; ring?: string; font?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        flexShrink: 0,
        background: c,
        color: '#FFFFFF',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: font ?? Math.max(7, Math.round(size * 0.44)),
        fontWeight: 800,
        lineHeight: 1,
        boxShadow: ring ? `0 0 0 1.5px ${ring}` : undefined,
        boxSizing: 'border-box',
      }}
    >
      {ini}
    </span>
  );
}

/** 겹친 아바타 줄 — 앞의 것이 위로 온다. */
export function AvatarStack({ people, size, max, overlap, ring }: { people: { id: string; ini: string; c: string }[]; size: number; max: number; overlap: number; ring: string }) {
  return (
    <span style={{ display: 'inline-flex', flexShrink: 0 }}>
      {people.slice(0, max).map((p, i) => (
        <span key={p.id} style={{ marginLeft: i ? -overlap : 0, zIndex: max - i, display: 'inline-flex' }}>
          <Avatar ini={p.ini} c={p.c} size={size} ring={ring} />
        </span>
      ))}
    </span>
  );
}

export function StatusBadge({ status, height }: { status: TicketStatus; height: number }) {
  const s = STATUS[status];
  return <span style={{ flexShrink: 0, height, padding: '0 6px', borderRadius: 999, background: s.bg, color: s.fg, fontSize: height <= 15 ? 9 : 10, fontWeight: 800, display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>{s.label}</span>;
}

/** 가라앉은 트랙 위의 세그먼트(보기 전환·묶음·국가·반복). */
export function Seg<T extends string>({ items, value, onChange, height, font, pad, label }: { items: [T, string][]; value: T; onChange: (v: T) => void; height: number; font: number; pad: number; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} style={{ display: 'inline-flex', background: 'var(--mf-ws-soft)', padding: 2, borderRadius: 999, flexShrink: 0 }}>
      {items.map(([id, name]) => {
        const on = id === value;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={on}
            className="btn"
            data-seg={id}
            onClick={() => onChange(id)}
            style={{ height, padding: `0 ${pad}px`, border: 0, borderRadius: 999, background: on ? 'var(--mf-ws-card)' : 'transparent', boxShadow: on ? '0 1px 3px rgba(46,42,38,.12)' : 'none', color: on ? 'var(--mf-ws-ink)' : 'var(--mf-ws-mut)', fontFamily: 'inherit', fontSize: font, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            {name}
          </button>
        );
      })}
    </div>
  );
}

/** 바깥을 누르거나 Esc를 누르면 닫는다(팝오버 여럿이 같은 규칙). */
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, close: () => void): void {
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      // 안에서 연 날짜 팝업(Radix 포털)은 DOM으로는 바깥이지만 이 팝오버의 일부다.
      if (t?.closest?.('[data-radix-popper-content-wrapper]')) return;
      if (ref.current && !ref.current.contains(t)) close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('keydown', key);
    };
  }, [ref, open, close]);
}

/** 헤더 오른쪽의 동그란 아이콘 단추(32×32) — 켜짐이면 강조 톤. */
export function RoundButton({ on, label, onClick, children, attrs }: { on: boolean; label: string; onClick: () => void; children: ReactNode; attrs?: Record<string, string> }) {
  return (
    <button
      type="button"
      className="btn"
      aria-label={label}
      title={label}
      aria-pressed={on}
      onClick={onClick}
      {...attrs}
      style={{ width: 32, height: 32, flexShrink: 0, borderRadius: '50%', border: `1px solid ${on ? '#F0D8CA' : 'var(--mf-ws-line2)'}`, background: on ? '#FBEDE6' : 'var(--mf-ws-card)', color: on ? '#D8794F' : 'var(--mf-ws-ink2)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0, cursor: 'pointer' }}
    >
      {children}
    </button>
  );
}

export const popPanel = (extra?: CSSProperties): CSSProperties => ({
  position: 'absolute',
  zIndex: 30,
  background: 'var(--mf-ws-card)',
  border: '1px solid var(--mf-border)',
  borderRadius: 14,
  boxShadow: '0 22px 44px -22px rgba(46,42,38,.5)',
  animation: 'mf-tool-pop .14s ease',
  boxSizing: 'border-box',
  ...extra,
});

export function CalCheckIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
      <path d="M8 3v4M16 3v4M3.5 10h17M9 15.5l2 2 4-4" />
    </svg>
  );
}

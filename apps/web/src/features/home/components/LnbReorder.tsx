import type { CSSProperties, MouseEvent } from 'react';

/**
 * LNB 순서 바꾸기 컨트롤 — ⠿ 토글과 ↑/↓ 쌍.
 *
 * 원래 대시보드 구획(`DashboardSection.tsx`)에 있던 것을 대시보드를 걷어내면서
 * 옮겼다. 쓰는 곳은 스페이스 구획(`Sidebar`·`SpaceRow`)이라 화면 하나가 사라진다고
 * 함께 사라질 이유가 없다.
 */

/** ⠿ 순서 바꾸기 토글 — LNB 스페이스 구획의 머리에 선다(디자인). */
export function ReorderToggle({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="btn"
      title="순서 바꾸기"
      aria-label={label}
      aria-pressed={on}
      onClick={onClick}
      style={{
        width: 20,
        height: 20,
        flexShrink: 0,
        border: 0,
        borderRadius: 7,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: on ? 'var(--mf-accent-strong)' : 'var(--mf-faint)',
        background: on ? 'var(--mf-accent-soft)' : 'transparent',
        cursor: 'pointer',
        transition: 'background .13s ease',
        padding: 0,
      }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
        <circle cx="9" cy="5" r="1.7" />
        <circle cx="15" cy="5" r="1.7" />
        <circle cx="9" cy="12" r="1.7" />
        <circle cx="15" cy="12" r="1.7" />
        <circle cx="9" cy="19" r="1.7" />
        <circle cx="15" cy="19" r="1.7" />
      </svg>
    </button>
  );
}

/** 순서 바꾸기 모드의 ↑/↓ 쌍 — 드래그의 키보드/정밀 대체 수단(디자인 원본). */
export function ArrowPair({ upDisabled, downDisabled, onUp, onDown }: { upDisabled: boolean; downDisabled: boolean; onUp: (e: MouseEvent) => void; onDown: (e: MouseEvent) => void }) {
  const btn = (disabled: boolean): CSSProperties => ({
    width: 18,
    height: 18,
    border: 0,
    borderRadius: 6,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: disabled ? 'var(--mf-faint2)' : 'var(--mf-subtext)',
    background: 'transparent',
    cursor: disabled ? 'default' : 'pointer',
    padding: 0,
  });
  return (
    <>
      <button type="button" className="btn" aria-label="위로" title="위로" disabled={upDisabled} onClick={onUp} style={btn(upDisabled)}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 15 6-6 6 6" />
        </svg>
      </button>
      <button type="button" className="btn" aria-label="아래로" title="아래로" disabled={downDisabled} onClick={onDown} style={btn(downDisabled)}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
    </>
  );
}

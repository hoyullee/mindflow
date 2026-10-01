import { useLayoutEffect, useRef } from 'react';
import { BOTTOM_BAR_VAR } from '../../../pwa/toastShell';
import { MONO_FONT } from '../chrome';
import { useUnreadCount } from '../components/unreadCount';
import { M_ICON } from './parts';

export type MobileTab = 'space' | 'cal' | 'noti' | 'more';

const TABS: { key: MobileTab; label: string }[] = [
  { key: 'space', label: '스페이스' },
  { key: 'cal', label: '일정' },
  { key: 'noti', label: '알림' },
  { key: 'more', label: '전체' },
];

/**
 * 모바일 홈의 **하단 탭 네 개**(모바일 홈 디자인) — 햄버거 서랍(LNB)을 대신한다.
 *
 * 서랍은 "어디로 갈 수 있는가"를 닫힌 문 뒤에 숨겨 두었다: 일정·알림으로 가려면 늘 문을
 * 먼저 열어야 했고, 알림이 왔다는 사실도 문 위의 점 하나로만 알 수 있었다. 탭은 갈 곳 넷을
 * 늘 보이게 두고, 알림 수는 그 탭 위에 직접 선다(LNB 알림 행과 **같은 셈** — `useUnreadCount`).
 *
 * 「전체」에는 **아직 열어 보지 않은 공유**가 점으로 선다 — 공유받음이 그 탭 안(모아보기)에 있으므로,
 * 서랍 시절 ☰의 점과 같은 이유다: 알림이 닫힌 문 뒤에 있으면 알림이 아니다.
 *
 * 막대의 높이를 `--mf-bottom-bar`로 내려 준다 — 설치 안내·오프라인 바 같은 떠 있는 카드가
 * 그만큼 올라서서 탭을 덮지 않는다(`toastShell.ts`, 에디터의 보드 툴바와 같은 계약).
 */
export function MobileTabBar({ active, onSelect, sharedNew = 0 }: { active: MobileTab; onSelect: (tab: MobileTab) => void; sharedNew?: number }) {
  const count = useUnreadCount();
  const ref = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    if (!el) return;
    const apply = () => root.style.setProperty(BOTTOM_BAR_VAR, `${Math.round(el.getBoundingClientRect().height)}px`);
    apply();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(apply) : null;
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      root.style.removeProperty(BOTTOM_BAR_VAR);
    };
  }, []);
  return (
    <nav
      ref={ref}
      data-m-tabbar
      aria-label="홈 탭"
      style={{
        flex: '0 0 auto',
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        padding: '8px 10px max(10px, env(safe-area-inset-bottom))',
        borderTop: '1px solid var(--mf-m-line)',
        background: 'var(--mf-m-bg)',
        position: 'relative',
        zIndex: 5,
      }}
    >
      {TABS.map((t) => {
        const on = t.key === active;
        const badge = t.key === 'noti' && count > 0;
        const dot = t.key === 'more' && sharedNew > 0;
        return (
          <button
            key={t.key}
            type="button"
            className="btn mf-m-tab"
            data-m-tab={t.key}
            aria-current={on ? 'page' : undefined}
            aria-label={badge ? `${t.label} · 안 읽음 ${count}개` : dot ? `${t.label} · 새 공유 ${sharedNew}개` : t.label}
            onClick={() => onSelect(t.key)}
            style={{
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              height: 48,
              padding: 0,
              border: 0,
              borderRadius: 12,
              background: 'transparent',
              color: on ? 'var(--mf-accent)' : 'var(--mf-m-tab)',
              fontFamily: 'inherit',
              fontSize: 10.5,
              fontWeight: on ? 800 : 600,
              whiteSpace: 'nowrap',
              cursor: 'pointer',
            }}
          >
            <svg width={23} height={23} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={on ? 2.3 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {M_ICON[t.key]}
            </svg>
            {t.label}
            {dot && (
              <span data-m-tab-dot aria-hidden="true" style={{ position: 'absolute', top: 5, left: 'calc(50% + 8px)', width: 8, height: 8, borderRadius: 99, background: 'var(--mf-accent)', boxShadow: '0 0 0 2px var(--mf-m-bg)' }} />
            )}
            {badge && (
              <span
                data-m-tab-badge
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  top: 3,
                  left: 'calc(50% + 6px)',
                  minWidth: 15,
                  height: 15,
                  padding: '0 4px',
                  boxSizing: 'border-box',
                  borderRadius: 99,
                  background: 'var(--mf-accent)',
                  color: 'var(--mf-accent-ink)',
                  fontFamily: MONO_FONT,
                  fontSize: 9.5,
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {count > 99 ? '99+' : count}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}

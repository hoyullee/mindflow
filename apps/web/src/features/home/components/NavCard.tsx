// LNB 최상단 **바로가기 카드** — 알림·일정이 함께 쓰는 껍데기.
//
// 두 항목은 아래의 목록 행(대시보드·스페이스)과 성격이 다르다: 여럿 중 하나가
// 아니라 **하나뿐인 목적지**이고, 둘 다 그릇이 아니라 "나"에 딸린 것이다. 그래서
// 한 줄 행이 아니라 두 줄 카드로 그려 격을 달리하고, 프로필 바로 아래에 모아 둔다.
//
// 껍데기를 한 곳에 두는 이유는 드리프트다 — 값을 각자 적어 두면 나란히 선 두
// 카드가 곧 서로 달라 보인다(우클릭 메뉴에서 겪은 것과 같은 계열).

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

export interface NavCardProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 왼쪽 글리프 — **언제나 강조색**이다(요청: 알림 종). 여기가 무슨 자리인지를
   *  상태와 무관하게 말한다. */
  glyph: ReactNode;
  label: string;
  /** 이름 오른쪽 알약(안 읽음 수·지난 마감 수). 색은 호출부가 정한다 — 뜻이 다르다. */
  badge?: ReactNode;
  /** 둘째 줄. 한 조각이 아니라 노드인 이유: 잘리면 안 되는 부분(시간)을
   *  호출부가 따로 묶을 수 있어야 한다. */
  summary: ReactNode;
  /** hot = 눈에 띄어야 하는 상태(안 읽음 · 지금 보는 화면) → 강조색 틴트 면. */
  tone?: 'hot' | 'quiet';
  /** 하위 메뉴가 펼쳐졌는가 — 오른쪽 셰브론이 아래를 가리킨다(디스클로저 관례). */
  expanded?: boolean;
  isMobile?: boolean;
}

/** 둘째 줄의 색 — hot은 따뜻한 갈색(본문 아래 단계), quiet은 흐린 회색. */
export function navCardSummaryColor(tone: 'hot' | 'quiet'): string {
  return tone === 'hot' ? 'var(--mf-subtext)' : 'var(--mf-muted)';
}

export const NavCard = forwardRef<HTMLButtonElement, NavCardProps>(function NavCard(
  { glyph, label, badge, summary, tone = 'quiet', expanded = false, isMobile = false, style, ...rest },
  ref,
) {
  const hot = tone === 'hot';
  return (
    <button
      ref={ref}
      type="button"
      className="nav-item"
      // hover가 틴트를 회색으로 갈아 끼우지 않게 하는 표식 — 손을 얹은 순간
      // "안 읽음/지금 이 화면"이 꺼진 것처럼 보이면 안 된다(달력 칩·켜진 알약에서
      // 이미 겪은 계열). 규칙은 `home.css`의 `.nav-item[data-tinted]`가 든다.
      data-tinted={hot ? '1' : undefined}
      {...rest}
      style={{
        width: '100%',
        border: 'none',
        fontFamily: 'inherit',
        textAlign: 'left',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '9px 11px',
        minHeight: isMobile ? 56 : 50,
        borderRadius: 12,
        cursor: 'pointer',
        letterSpacing: '-.01em',
        background: hot ? 'var(--mf-accent-soft)' : 'transparent',
        color: 'var(--mf-text)',
        transition: 'background .14s ease',
        ...style,
      }}
    >
      <span data-nav-card-glyph style={{ display: 'inline-flex', color: 'var(--mf-accent)', flexShrink: 0 }}>
        {glyph}
      </span>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {/* 이름 줄의 높이를 못박는다 — 배지가 있고 없고에 따라 카드 높이가
            2px씩 달라지면 나란히 선 두 카드가 어긋나 보인다(실측). */}
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 18 }}>
          <span style={{ fontSize: 13, fontWeight: hot ? 700 : 600, color: 'var(--mf-text)' }}>{label}</span>
          {badge}
        </span>
        <span
          data-nav-card-summary
          style={{
            display: 'flex',
            alignItems: 'baseline',
            minWidth: 0,
            fontSize: 11.5,
            fontWeight: 500,
            color: navCardSummaryColor(tone),
            whiteSpace: 'nowrap',
          }}
        >
          {summary}
        </span>
      </span>
      <span
        data-nav-card-chevron
        style={{
          display: 'inline-flex',
          color: hot ? 'var(--mf-accent)' : 'var(--mf-faint)',
          flexShrink: 0,
          // 펼치면 아래를 가리킨다 — 같은 글리프가 "연다"와 "펼쳤다"를 겸한다.
          transform: expanded ? 'rotate(90deg)' : undefined,
          transition: 'transform .16s ease',
        }}
        aria-hidden="true"
      >
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </span>
    </button>
  );
});

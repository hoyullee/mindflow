// LNB 최상단 **오늘 묶음**의 한 줄 — 알림·일정이 함께 쓰는 껍데기(스펙: 홈·LNB 변경 2.1).
//
// 두 항목은 아래의 목록 행(스페이스·모아보기)과 성격이 다르다: 여럿 중 하나가 아니라
// **하나뿐인 목적지**이고, 둘 다 그릇이 아니라 "나"에 딸린 것이다. 그래서 두 줄(제목 +
// 부제)로 그려 격을 달리하고 LNB 맨 위에 한 묶음으로 모은다.
//
// 이번 판에서 **카드를 걷어냈다**(스펙): 면·테두리·그림자 없이 44px 행 둘이 1px 틈으로
// 붙어 선다. 무엇이 무엇인지는 왼쪽 32px 자리의 **글리프**가 말한다 — 알림은 채운 원 안의
// 벨, 일정은 상자 없는 날짜 숫자 + 요일. 그 글리프는 뜻이 달라 호출부가 그린다.
//
// 껍데기를 한 곳에 두는 이유는 드리프트다 — 값을 각자 적어 두면 나란히 선 두 행이 곧
// 서로 달라 보인다(우클릭 메뉴에서 겪은 것과 같은 계열).

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

export interface NavCardProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 왼쪽 32×32 자리 — 알림은 원 안의 벨, 일정은 날짜 숫자 + 요일. */
  glyph: ReactNode;
  label: string;
  /** 둘째 줄 — 노드인 이유: 알림은 넘치면 흐르는 한 줄(`MarqueeText`)을 넣는다. */
  summary: ReactNode;
  /** 오른쪽 끝 슬롯 — 안 읽은 수 같은 것. */
  trailing?: ReactNode;
  /** 지금 이 자리가 활성인가(알림 창이 열림 · 일정 화면을 보는 중) — 옅은 면을 깐다. */
  active?: boolean;
  /** 오른쪽 안쪽 여백 — 행 **위에** 따로 얹는 단추(일정의 캐럿)가 쓸 자리. */
  padRight?: number;
  isMobile?: boolean;
}

export const NavCard = forwardRef<HTMLButtonElement, NavCardProps>(function NavCard(
  { glyph, label, summary, trailing, active = false, padRight, isMobile = false, style, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className="nav-item mf-today-row"
      data-active={active ? '1' : undefined}
      {...rest}
      style={{
        width: '100%',
        border: 'none',
        fontFamily: 'inherit',
        textAlign: 'left',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        // 44px = 위아래 6 + 내용 32(스펙). 손가락에서도 44는 최소 터치 크기를 넘는다.
        padding: `6px ${padRight ?? 8}px 6px 8px`,
        minHeight: isMobile ? 48 : 44,
        boxSizing: 'border-box',
        borderRadius: 13,
        cursor: 'pointer',
        // 활성 면은 hover 면과 **같은 값**이다 — 손을 얹어도 꺼진 것처럼 보이지 않고
        // (`home.css`의 `.nav-item:hover`), 틴트가 "언제나 활성"으로 읽히지도 않는다.
        background: active ? 'var(--mf-panel2)' : 'transparent',
        color: 'var(--mf-text)',
        transition: 'background .15s ease',
        ...style,
      }}
    >
      <span data-nav-card-glyph style={{ position: 'relative', width: 32, height: 32, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {glyph}
      </span>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '-.015em', lineHeight: '16px', color: 'var(--mf-text)' }}>{label}</span>
        <span data-nav-card-summary style={{ display: 'block', minWidth: 0, height: 14, lineHeight: '14px', fontSize: 11, fontWeight: 400, color: 'var(--mf-subtext)', whiteSpace: 'nowrap', overflow: 'hidden' }}>
          {summary}
        </span>
      </span>
      {trailing}
    </button>
  );
});

// LNB 최상단 **바로가기 카드** — 알림·일정이 함께 쓰는 껍데기.
//
// 두 항목은 아래의 목록 행(대시보드·스페이스)과 성격이 다르다: 여럿 중 하나가
// 아니라 **하나뿐인 목적지**이고, 둘 다 그릇이 아니라 "나"에 딸린 것이다. 그래서
// 한 줄 행이 아니라 두 줄 카드로 그려 격을 달리하고, 프로필 바로 아래에 모아 둔다.
//
// 껍데기를 한 곳에 두는 이유는 드리프트다 — 값을 각자 적어 두면 나란히 선 두
// 카드가 곧 서로 달라 보인다(우클릭 메뉴에서 겪은 것과 같은 계열).
//
// 다만 **두 카드가 똑같이 보이면 안 된다**(제보: 일정이 알림과 너무 같다) — 그래서
// 껍데기는 나누고 갈래를 프롭으로 받는다: 왼쪽 글리프의 **타일**(채운/테두리),
// 오른쪽 **꼬리 슬롯**(개수 배지·상태 표식), 셰브론 유무. 값은 여전히 여기 하나뿐이라
// 크기·간격·틴트는 갈리지 않고, 갈리는 것은 뜻이 다른 부분만이다.

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { UNREAD_BADGE_BG } from '../theme';

export interface NavCardProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 왼쪽 글리프 — **언제나 강조색**이다. 여기가 무슨 자리인지를 상태와 무관하게 말한다. */
  glyph: ReactNode;
  /** 글리프를 담는 타일. `accent`=채운 강조색 면(흰 글리프), `plain`=카드 면 + 테두리.
   *  두 카드를 한눈에 가르는 가장 큰 신호라 뜻이 다른 자리는 다른 타일을 쓴다. */
  tile?: 'accent' | 'plain';
  /** 타일 모서리의 알림 점 — "새로 온 것이 있다"를 배지보다 먼저 알린다. */
  tileDot?: boolean;
  label: string;
  /** 이름 오른쪽 알약(지난 마감 수 등). 색은 호출부가 정한다 — 뜻이 다르다. */
  badge?: ReactNode;
  /** 둘째 줄. 한 조각이 아니라 노드인 이유: 잘리면 안 되는 부분(시간)을
   *  호출부가 따로 묶을 수 있어야 한다. */
  summary: ReactNode;
  /** 오른쪽 끝(셰브론 앞) 슬롯 — 개수 배지·상태 표식. 이름 옆이 아니라 여기에
   *  두면 이름이 길어도 자리를 다투지 않고, 두 카드의 오른쪽 끝이 한 열에 선다. */
  trailing?: ReactNode;
  /** 셰브론(오른쪽 화살표) — 하위 메뉴나 다음 화면이 있을 때만. 아무것도 열리지
   *  않는 카드에 두면 "누르면 펼쳐진다"는 거짓 약속이 된다. */
  chevron?: boolean;
  /** hot = 눈에 띄어야 하는 상태(안 읽음 · 지금 보는 화면) → 이름이 굵어지고
   *  요약이 본문 톤으로 올라온다. */
  tone?: 'hot' | 'quiet';
  /** 면을 칠할까 — 기본은 tone을 따르되, 호출부가 **언제나 칠할 수도** 있다
   *  (일정 카드: 요청). `data-tinted`가 함께 서므로 hover가 틴트를 지운다. */
  surface?: 'tint' | 'none';
  /** 지금 보고 있는 화면인가 — 안쪽 링으로 알린다. 면을 언제나 칠하는 카드는
   *  틴트만으로는 "여기 있다"를 말할 수 없다(레이아웃이 밀리지 않게 inset 그늘). */
  current?: boolean;
  /** 하위 메뉴가 펼쳐졌는가 — 오른쪽 셰브론이 아래를 가리킨다(디스클로저 관례). */
  expanded?: boolean;
  isMobile?: boolean;
}

/** 둘째 줄의 색 — hot은 따뜻한 갈색(본문 아래 단계), quiet은 흐린 회색.
 * **틴트 면 위에서는 흐린 회색을 쓰지 않는다** — 코랄 틴트(`#fdeee7`) 위의
 * `--mf-muted`는 11.5px 글자에 대비가 2.8:1로 모자란다(실측). */
export function navCardSummaryColor(tone: 'hot' | 'quiet', tinted = false): string {
  return tone === 'hot' || tinted ? 'var(--mf-subtext)' : 'var(--mf-muted)';
}

export const NavCard = forwardRef<HTMLButtonElement, NavCardProps>(function NavCard(
  {
    glyph,
    tile = 'accent',
    tileDot = false,
    label,
    badge,
    summary,
    trailing,
    chevron = true,
    tone = 'quiet',
    surface,
    current = false,
    expanded = false,
    isMobile = false,
    style,
    ...rest
  },
  ref,
) {
  const hot = tone === 'hot';
  const tinted = (surface ?? (hot ? 'tint' : 'none')) === 'tint';
  const accentTile = tile === 'accent';
  return (
    <button
      ref={ref}
      type="button"
      className="nav-item"
      // hover가 틴트를 회색으로 갈아 끼우지 않게 하는 표식 — 손을 얹은 순간
      // "안 읽음/지금 이 화면"이 꺼진 것처럼 보이면 안 된다(달력 칩·켜진 알약에서
      // 이미 겪은 계열). 규칙은 `home.css`의 `.nav-item[data-tinted]`가 든다.
      data-tinted={tinted ? '1' : undefined}
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
        background: tinted ? 'var(--mf-accent-soft)' : 'transparent',
        // 링은 테두리가 아니라 **안쪽 그늘**이다 — 테두리를 켜면 1px만큼 내용이
        // 밀려 활성/비활성 사이에서 글자가 흔들린다.
        boxShadow: current ? 'inset 0 0 0 1px rgba(var(--mf-accent-rgb), .38)' : undefined,
        color: 'var(--mf-text)',
        transition: 'background .14s ease',
        ...style,
      }}
    >
      <span
        data-nav-card-glyph
        data-nav-card-tile={tile}
        style={{
          position: 'relative',
          width: 32,
          height: 32,
          borderRadius: 10,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          background: accentTile ? 'var(--mf-accent)' : 'var(--mf-card)',
          border: accentTile ? 'none' : '1px solid var(--mf-border)',
          color: accentTile ? 'var(--mf-accent-ink)' : 'var(--mf-accent)',
        }}
      >
        {glyph}
        {tileDot && (
          // 점을 둘러싼 링은 **놓이는 면**의 색이라 타일 모서리에서 오려낸 것처럼
          // 보인다. 이 점이 뜨는 카드는 언제나 틴트 면이다(안 읽음 = hot).
          <span
            data-nav-card-tile-dot
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: -3,
              right: -3,
              width: 10,
              height: 10,
              borderRadius: 999,
              background: UNREAD_BADGE_BG,
              border: '2px solid var(--mf-accent-soft)',
              boxSizing: 'border-box',
            }}
          />
        )}
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
            color: navCardSummaryColor(tone, tinted),
            whiteSpace: 'nowrap',
          }}
        >
          {summary}
        </span>
      </span>
      {trailing}
      {chevron && (
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
      )}
    </button>
  );
});

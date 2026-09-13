// LNB 접이식 목록 구획 — **즐겨찾기·공유받음·휴지통**이 함께 쓰는 껍데기와,
// 일정 하위 메뉴(`보여 줄 캘린더`)가 함께 쓰는 **왼쪽 rail**.
//
// 예전에는 세 구획이 각자 "머리 행 + 가라앉은 판"을 인라인으로 적어 두어, 값이
// 갈릴 자리가 셋이었다(우클릭 메뉴·NavCard와 같은 계열의 드리프트). 첨부 디자인이
// 그 판을 걷어내고 **왼쪽 세로선(rail)**으로 바꾸므로, 이 참에 한 곳으로 모은다.
//
// **머리는 펼쳤을 때만 칠한다** — 틴트의 뜻을 "열려 있다"로 못박는다(일정 카드가
// 활성일 때만 칠하는 것과 같은 규칙: 늘 칠하면 "언제나 활성"으로 읽힌다는 제보).

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** 펼친 목록이 자기 안에서 스크롤하기 시작하는 높이 — 휴지통이 17개쯤 되면
 * 그 하나가 LNB를 통째로 밀어내므로, 세 구획을 함께 쓸 수 있게 여기서 끊는다
 * (첨부 디자인의 휴지통 목록에도 스크롤바가 있다). */
export const LNB_LIST_CAP = 236;

/** rail 안쪽 여백 몫 — 열림 높이 계산과 실제 패딩이 갈리지 않게 한 곳에 둔다. */
const RAIL_PAD = 12;

/**
 * 목록을 감싸는 **왼쪽 세로선 + 들여쓰기**. 선은 머리 아이콘 자리 아래를 지나고
 * 내용은 머리의 이름과 대략 같은 열에서 시작한다(첨부 디자인).
 */
export function LnbRail({ children, cap = true, attrs }: { children: ReactNode; cap?: boolean; attrs?: Record<string, string> }): React.JSX.Element {
  return (
    <div
      data-lnb-rail
      {...attrs}
      style={{
        margin: '2px 2px 6px 16px',
        paddingLeft: 10,
        borderLeft: '1px solid var(--mf-border-soft)',
        minHeight: 0,
      }}
    >
      <div
        className={cap ? 'lnb-scroll' : undefined}
        style={cap ? { maxHeight: LNB_LIST_CAP - RAIL_PAD, overflowY: 'auto', minHeight: 0 } : undefined}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * 접히고 펼쳐지는 상자 — **즐겨찾기·공유받음·휴지통**과 **일정 하위 메뉴**가 같은
 * 것을 쓴다(요청: 일정도 같은 효과로).
 *
 * 높이는 **재서** 쓴다: 목록 길이가 구획마다 다르고 도중에 늘어나기도 하므로(캘린더
 * 목록이 도착한다) 어림값을 적어 두면 곧 갈린다. 못 재는 환경(jsdom)에서는
 * `fallback`으로 물러서고, 그마저 없으면 제한을 두지 않는다 — 테스트에서 내용이
 * 보이지 않는 편이 더 나쁘다.
 *
 * 닫혀 있어도 **내용은 그려 둔다** — 그래야 닫는 동작에도 애니메이션이 걸린다.
 */
export function LnbCollapse({ open, fallback, children }: { open: boolean; fallback?: number; children: ReactNode }): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const [h, setH] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setH(el.scrollHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const target = h > 0 ? h : fallback;
  return (
    <div
      style={{
        overflow: 'hidden',
        flexShrink: 0,
        maxHeight: open ? (target === undefined ? 'none' : `${target}px`) : '0px',
        opacity: open ? 1 : 0,
        // 접힌 동안에는 **초점도 가지 않는다** — `visibility: hidden`은 그 안의 버튼·
        // 체크박스를 Tab 순서에서 빼 준다(높이만 0으로 두면 보이지 않는 행에 초점이
        // 내려앉는다). 닫히는 전이가 끝난 **뒤에** 걸리도록 지연을 준다.
        visibility: open ? 'visible' : 'hidden',
        transition: `max-height .32s cubic-bezier(.4,0,.2,1), opacity .24s ease, visibility 0s linear ${open ? '0s' : '.32s'}`,
      }}
    >
      <div ref={ref}>{children}</div>
    </div>
  );
}

export interface LnbListSectionProps {
  open: boolean;
  onToggle: () => void;
  /** 왼쪽 아이콘 — 구획마다 자기 글리프(별·공유·휴지통)를 그대로 쓴다. */
  glyph: ReactNode;
  label: string;
  /** 이름과 개수 **사이** 슬롯 — 휴지통 `비우기`처럼 hover에 드러나는 동작. */
  action?: ReactNode;
  /** 오른쪽 끝 — 개수(등폭)나 알림 배지. */
  meta?: ReactNode;
  /** 행 수 — 실제 높이를 못 재는 환경(jsdom)의 폴백값을 짓는다. 실브라우저에서는
   * `LnbCollapse`가 잰 값이 이긴다(목록이 도중에 늘어나도 따라간다). */
  rows: number;
  isMobile?: boolean;
  headClassName?: string;
  children: ReactNode;
}

export function LnbListSection({ open, onToggle, glyph, label, action, meta, rows, isMobile = false, headClassName, children }: LnbListSectionProps): React.JSX.Element {
  const rowH = isMobile ? 46 : 38;
  const wanted = Math.max(1, rows) * rowH + RAIL_PAD + 8;
  return (
    <>
      <div
        className={headClassName ? `nav-item ${headClassName}` : 'nav-item'}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        // hover가 틴트를 회색으로 갈아 끼우지 않게 하는 표식 — 손을 얹은 순간
        // "펼쳐져 있다"가 꺼진 것처럼 보이면 안 된다(`home.css`의 `[data-tinted]`).
        data-tinted={open ? '1' : undefined}
        data-lnb-section={label}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          padding: '8px 9px',
          minHeight: isMobile ? 44 : undefined,
          borderRadius: 10,
          cursor: 'pointer',
          fontSize: 13,
          fontWeight: open ? 600 : 500,
          color: open ? 'var(--mf-text)' : 'var(--mf-subtext)',
          background: open ? 'var(--mf-accent-soft)' : 'transparent',
          flexShrink: 0,
        }}
      >
        {glyph} {label}
        {action}
        {meta}
        <ChevronGlyph open={open} />
      </div>
      <LnbCollapse open={open} fallback={Math.min(wanted, LNB_LIST_CAP)}>
        <LnbRail>{children}</LnbRail>
      </LnbCollapse>
    </>
  );
}

/** 접이식 구획 머리의 회전 셰브론 — 닫힘=오른쪽(›), 열림=아래(⌄).
 * 세 구획과 일정 카드가 같은 글리프를 쓴다(값을 각자 적으면 곧 갈린다). */
export function ChevronGlyph({ open }: { open: boolean }): React.JSX.Element {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--mf-faint2)"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .16s ease' }}
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

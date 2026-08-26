/**
 * 홈 화면의 시각 언어(디자인 원본 `Geurio 홈 리디자인.dc.html` 이식).
 *
 * 값을 컴포넌트마다 베끼지 않고 여기 한 곳에 둔다 — 툴바·사이드바·카드가 같은
 * 알약 꼴과 같은 그늘을 쓰므로, 나중에 톤을 조이려면 이 파일만 고치면 된다
 * (에디터의 `features/editor/chrome.ts`와 같은 역할).
 *
 * 색은 전부 CSS 변수를 참조한다(`home/theme.ts`) — 여섯 벌 테마와 다크가 그대로
 * 성립해야 한다. 디자인 원본은 코랄 한 벌만 그렸지만, 그 값들이 코랄 토큰과
 * 거의 같아서 토큰으로 옮기는 것만으로 같은 인상이 난다.
 */

import type { CSSProperties } from 'react';

/** 숫자·개수처럼 "재는 값"에 쓰는 등폭 글꼴(디자인 원본의 JetBrains Mono). */
export const MONO_FONT = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

/** 강조색 알약(1차 버튼) — 위에서 아래로 살짝 어두워지는 세로 그라디언트. */
export const ACCENT_GRAD = 'linear-gradient(180deg, var(--mf-accent), var(--mf-accent-strong))';

/** 툴바 컨트롤의 높이(데스크톱). 디자인 원본은 32px 한 줄로 맞춰 둔다. */
export const CTL_H = 32;
/** 터치 타깃(모바일) — 44px 규칙(M6)은 디자인보다 우선한다. */
export const CTL_H_MOBILE = 44;

/** 2차 버튼(테두리 있는 알약) — 가져오기·새 폴더·검색 상자가 같은 꼴을 쓴다. */
export function pillStyle(isMobile: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: isMobile ? CTL_H_MOBILE : CTL_H,
    padding: isMobile ? '0 14px' : '0 12px',
    borderRadius: 999,
    border: '1px solid var(--mf-border)',
    background: 'var(--mf-panel)',
    color: 'var(--mf-text)',
    fontFamily: 'inherit',
    fontSize: 12.5,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  };
}

/** 아이콘만 있는 원형 버튼(알림·가져오기). 라벨은 `aria-label`·`title`로. */
export function roundIconStyle(isMobile: boolean): CSSProperties {
  const size = isMobile ? CTL_H_MOBILE : CTL_H;
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: size,
    height: size,
    flexShrink: 0,
    borderRadius: 999,
    border: '1px solid var(--mf-border)',
    background: 'var(--mf-panel)',
    color: 'var(--mf-subtext)',
    cursor: 'pointer',
    padding: 0,
    position: 'relative',
  };
}

/** 1차 버튼(새로 만들기) — 강조색 그라디언트 + 그 색의 그림자. */
export function primaryPillStyle(isMobile: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    height: isMobile ? CTL_H_MOBILE : CTL_H,
    padding: isMobile ? 0 : '0 15px',
    width: isMobile ? CTL_H_MOBILE : undefined,
    borderRadius: 999,
    border: '1px solid var(--mf-accent-strong)',
    background: ACCENT_GRAD,
    color: 'var(--mf-accent-ink)',
    fontFamily: 'inherit',
    fontSize: 12.5,
    fontWeight: 700,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    flexShrink: 0,
    boxShadow: '0 10px 22px -12px rgba(var(--mf-accent-rgb), .85)',
  };
}

/** 구획 라벨(사이드바의 "스페이스"·"공유받음") — 작고 넓게 벌린 대문자 꼴. */
export const SECTION_LABEL: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 800,
  letterSpacing: '.07em',
  color: 'var(--mf-faint)',
  textTransform: 'uppercase',
};

/** 개수처럼 곁들이는 등폭 숫자. */
export const META_MONO: CSSProperties = {
  fontFamily: MONO_FONT,
  fontSize: 10.5,
  color: 'var(--mf-faint2)',
};

/** 미리보기 바탕에 깔리는 도트 격자 — 캔버스의 점을 축소해 옮긴 것.
 * `step`은 카드 크기에 따라 다르다(그리드 18px / 최근 항목 13px). */
export function dotGridStyle(step: number, color?: string): CSSProperties {
  // `color`를 넘기면 그 색(문서 테마의 캔버스 도트) — 미리보기가 에디터와 같은
  // 격자를 그린다. 안 넘기면 홈 테마의 도트 색(대시보드 바닥 등 크롬 자리).
  return {
    position: 'absolute',
    inset: 0,
    backgroundImage: `radial-gradient(${color ?? 'var(--mf-dot-grid)'} 1px, transparent 1px)`,
    backgroundSize: `${step}px ${step}px`,
    pointerEvents: 'none',
  };
}

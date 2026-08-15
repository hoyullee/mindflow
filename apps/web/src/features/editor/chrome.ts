// 에디터 크롬(떠 있는 카드·알약·강조 버튼)의 **디자인 토큰**.
//
// 화이트보드 디자인 원본(`Geurio 화이트보드.dc.html`)의 시각 언어를 한곳에 모은다 —
// 유리질 카드(반투명 + 블러), 아래로 길게 깔리는 그림자, 세로 그라디언트 강조 버튼.
// 값을 컴포넌트마다 적어 두면 카드 하나를 손볼 때마다 나머지가 어긋나므로,
// 원본이 반복해서 쓰는 세 가지 꼴만 함수로 남긴다.
//
// 색은 **테마 팔레트에서 파생**한다(고정 헥스를 베끼지 않는다): 크롬은 `UI_THEME`
// (코랄)로 그리지만, 같은 함수가 다크·모노에서도 성립해야 나중에 크롬 테마를
// 열어도 깨지지 않는다.

import type { CSSProperties } from 'react';
import { hexA, mixHex } from './theme';
import type { Theme } from './theme';

/** 떠 있는 카드의 면 — 캔버스가 살짝 비치는 반투명 패널 + 블러. */
export function glassCard(th: Theme, alpha = 0.94): CSSProperties {
  return {
    background: hexA(th.panel, alpha),
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    border: `1px solid ${th.border}`,
  };
}

/** 카드 그림자 — 원본은 **위로 뜨는 빛이 아니라 아래로 깔리는 그늘**을 쓴다
 * (`0 20px 40px -28px`처럼 음수 spread로 번짐을 좁게). */
export const CARD_SHADOW = '0 20px 40px -28px rgba(46,42,38,.5)';
/** 바닥 알약(도구 막대)처럼 더 크게 뜬 것. */
export const FLOAT_SHADOW = '0 22px 46px -24px rgba(46,42,38,.55)';
/** 작은 칩(독칩·피드백 알약). */
export const CHIP_SHADOW = '0 16px 34px -26px rgba(46,42,38,.55)';

/** 강조 버튼의 세로 그라디언트(원본: `#F2764C → #E85E33`). */
export function accentGradient(th: Theme): string {
  return `linear-gradient(180deg,${mixHex(th.accent, '#ffffff', 0.08)},${mixHex(th.accent, '#000000', 0.06)})`;
}

/** 강조 버튼 아래에 깔리는 색 그림자 — 버튼이 면에서 떠 보이게. */
export function accentGlow(th: Theme, strength = 0.8): string {
  return `0 8px 18px -11px ${hexA(th.accent, strength)}`;
}

/** 강조(주 동작) 버튼의 면·글자·테두리·그림자 한 벌. */
export function accentButton(th: Theme): CSSProperties {
  return {
    background: accentGradient(th),
    color: th.accentInk,
    border: `1px solid ${mixHex(th.accent, '#000000', 0.06)}`,
    boxShadow: accentGlow(th),
  };
}

/** 수치를 읽는 자리(줌 배율·색 이름)의 글꼴 — 원본은 등폭으로 눈금처럼 보여 준다.
 * JetBrains Mono는 랜딩에서 이미 self-host 중이다. */
export const MONO_FONT = "'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace";

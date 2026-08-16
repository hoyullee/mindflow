// 스레드 핀의 **한 가지 모양** — 꽂혀 있는 핀·초안 핀·마우스 커서가 전부 여기서 나온다.
//
// 셋이 제각각이면 "지금 꽂으려는 것"과 "꽂혀 있는 것"이 다른 물건으로 보인다(제보).
// 그래서 도형·크기·색을 한 곳에 두고, 안에 무엇을 담느냐만 다르다:
//   꽂혀 있는 핀 = **첫 글을 쓴 사람의 얼굴**(시안 ①)
//   초안 핀·커서 = 채운 말풍선(시안 ②) — 아직 아무도 말하지 않았으니 얼굴이 없다
//
// 폭이 상수인 것도 설계다: 팝업·말풍선이 핀 옆에 설 자리를 계산하려면(commentAnchor)
// 핀의 폭을 알아야 하는데, 개수 글자가 본체를 늘리면 그 값이 렌더 전에는 알 수 없어
// 팝업이 핀 위에 걸터앉는다(제보). 개수는 본체 밖 배지로 뺐다.

import type { CSSProperties } from 'react';
import type { Theme } from '../theme';
import { accentGradient } from '../chrome';
import { mixHex } from '../theme';

/** 핀 본체의 가로·세로(px, 문서 좌표계). 개수·해결 배지는 이 상자 **밖**에 붙는다. */
export const COMMENT_PIN_W = 34;

/** 지도 핀 관례 — 왼쪽 아래 꼭짓점이 가리키는 지점이다(그래서 anchor에 붙는다). */
const PIN_RADIUS = '999px 999px 999px 6px';

/** 채운 말풍선 — 초안 핀과 마우스 커서가 함께 쓴다(시안 ②의 아이콘). */
export const FILLED_BUBBLE_PATH = 'M5 3.4h14a2.6 2.6 0 0 1 2.6 2.6v8.2a2.6 2.6 0 0 1-2.6 2.6H9.2L4.6 20.6a.6.6 0 0 1-1-.46V6a2.6 2.6 0 0 1 2.6-2.6z';

/**
 * 핀 본체의 스타일. `zoom`은 **화면 좌표에 놓이는 핀**(초안)만 쓴다 — 꽂혀 있는 핀은
 * 팬/줌 레이어 안이라 이미 배율이 걸려 있다. 이 인자가 없으면 확대한 캔버스에서
 * 초안 핀만 작게 보인다(실측: 배율 1.25에서 34 vs 43 — 제보).
 *
 * `tone`: 'accent'(초안·선택된 핀) / 'panel'(평소의 핀 — 얼굴이 주인공이라 흰 바탕).
 */
export function commentPinBoxStyle(th: Theme, selected: boolean, zoom = 1, tone: 'accent' | 'panel' = 'accent'): CSSProperties {
  const onAccent = tone === 'accent';
  return {
    width: COMMENT_PIN_W,
    height: COMMENT_PIN_W,
    boxSizing: 'border-box',
    borderRadius: PIN_RADIUS,
    background: onAccent ? accentGradient(th) : th.panel,
    color: onAccent ? th.accentInk : th.text,
    border: onAccent ? `2px solid ${th.panel}` : `1px solid ${th.border}`,
    boxShadow: selected ? `0 0 0 3px ${th.accent}40, 0 6px 16px rgba(46,42,38,.3)` : '0 5px 14px rgba(46,42,38,.22)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    userSelect: 'none',
    // 지점이 왼쪽 **아래** 꼭짓점 — 위로 자란다.
    transform: zoom === 1 ? 'translate(0, -100%)' : `translate(0, -100%) scale(${zoom})`,
    transformOrigin: '0 100%',
  };
}

/** 이름에서 만든 얼굴 색 한 쌍(파스텔 면 + 진한 잉크) — 스레드 목록·접속자 아바타와
 * 같은 규칙이라 같은 사람은 어디서나 같은 색이다. */
const AVATAR_HUES = ['#f0663f', '#e0a53c', '#3f9e6a', '#3f8fd0', '#8a63d2', '#d0568f', '#3fae9e'];
export function authorTint(name: string): { bg: string; ink: string } {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const base = AVATAR_HUES[h % AVATAR_HUES.length]!;
  return { bg: mixHex(base, '#ffffff', 0.6), ink: mixHex(base, '#000000', 0.45) };
}

/** 얼굴 — 이름의 첫 글자. 핀 안(24)과 스레드 목록(26)이 같은 것을 쓴다. */
export function Avatar({ name, size = 24, ring }: { name: string; size?: number; ring?: string }) {
  const tint = authorTint(name || '?');
  return (
    <span
      data-avatar
      aria-hidden
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: 999,
        background: tint.bg,
        color: tint.ink,
        border: ring ? `2px solid ${ring}` : undefined,
        boxSizing: 'border-box',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: Math.round(size * 0.42),
        fontWeight: 700,
        lineHeight: 1,
      }}
    >
      {(name || '?').slice(0, 1)}
    </span>
  );
}

/** 초안 핀·커서가 담는 것: 채운 말풍선(아직 얼굴이 없다). */
export function CommentPinGlyph({ size = 17, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden="true">
      <path d={FILLED_BUBBLE_PATH} />
    </svg>
  );
}

/** 스레드의 글 수 — 본체 우상단에 걸친다(본체 폭을 늘리지 않는다). */
export function CommentPinCount({ count, th }: { count: number; th: Theme }) {
  if (count <= 0) return null;
  return (
    <span
      data-pin-count
      style={{
        position: 'absolute',
        top: -6,
        right: -6,
        minWidth: 18,
        height: 18,
        boxSizing: 'border-box',
        padding: '0 5px',
        borderRadius: 999,
        background: th.accent,
        border: `2px solid ${th.panel}`,
        color: th.accentInk,
        fontSize: 10,
        fontWeight: 800,
        lineHeight: '14px',
        textAlign: 'center',
      }}
    >
      {count}
    </span>
  );
}

/** 해결된 스레드 표시 — 초록 체크(시안 ①). 개수 배지 자리를 대신한다. */
export function CommentPinResolved({ th }: { th: Theme }) {
  return (
    <span
      data-pin-resolved
      style={{
        position: 'absolute',
        right: -5,
        bottom: -5,
        width: 17,
        height: 17,
        borderRadius: 999,
        background: '#2f9e63',
        border: `2px solid ${th.panel}`,
        color: '#ffffff',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M4 12.5 9.5 18 20 6.5" />
      </svg>
    </span>
  );
}

/**
 * 스레드 도구의 마우스 커서 — **꽂히는 초안 핀 그대로**(시안 ②).
 *
 * 손끝의 그림과 놓이는 물건이 다르면 무엇을 만드는 중인지 헷갈린다(제보). 지정점
 * (hotspot)은 물방울의 왼쪽 아래 꼬리라 **커서가 가리키는 자리에 핀이 그대로 선다**.
 */
export function commentPinCursor(accent: string, ink: string): string {
  const S = 30; // 커서 이미지 크기 — 실제 핀(34)보다 살짝 작게(커서 관례)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">` +
    // 물방울 — 핀 본체와 같은 실루엣(왼쪽 아래 꼬리)
    `<path d="M6 1.5h18a4.5 4.5 0 0 1 4.5 4.5v11a4.5 4.5 0 0 1-4.5 4.5H10l-8.5 6.5V6A4.5 4.5 0 0 1 6 1.5z" fill="${accent}" stroke="#ffffff" stroke-width="2.4" stroke-linejoin="round"/>` +
    // 안쪽: 채운 말풍선(핀·초안과 같은 path)
    `<g transform="translate(6.6 5.2) scale(0.66)" fill="${ink}"><path d="${FILLED_BUBBLE_PATH}"/></g></svg>`;
  // hotspot = 꼬리 끝 → 누른 자리가 핀이 가리키는 지점이 된다.
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 2 28, crosshair`;
}

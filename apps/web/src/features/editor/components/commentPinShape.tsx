// 댓글 핀의 **한 가지 모양** — 확정된 핀·초안 핀·마우스 커서가 전부 여기서 나온다.
//
// 셋이 제각각이면 "지금 꽂으려는 것"과 "꽂혀 있는 것"이 다른 물건으로 보인다(제보:
// 초안 아이콘이 댓글 수가 붙은 핀보다 작고 다르게 생겼다). 그래서 도형·크기·색을
// 한 곳에 두고, 다른 것은 **댓글 수 배지가 붙느냐**뿐이다.
//
// 폭이 상수인 것도 설계다: 팝업·말풍선이 핀 옆에 설 자리를 계산하려면(commentAnchor)
// 핀의 폭을 알아야 하는데, 예전처럼 개수 글자가 본체를 늘리면 그 값이 렌더 전에는
// 알 수 없어 팝업이 핀 위에 걸터앉았다(제보 ①). 개수는 본체 밖 배지로 뺐다.

import type { CSSProperties } from 'react';
import type { Theme } from '../theme';
import { accentGradient } from '../chrome';
import { COMMENT_GLYPH, CommentIcon } from './ToolbarMenus';

/** 핀 본체의 가로·세로(px, 문서 좌표계). 개수 배지는 이 상자 **밖**에 붙는다. */
export const COMMENT_PIN_W = 34;

/** 지도 핀 관례 — 왼쪽 아래 꼭짓점이 가리키는 지점이다(그래서 anchor에 붙는다). */
const PIN_RADIUS = '999px 999px 999px 6px';

/**
 * 핀 본체의 스타일. `zoom`은 **화면 좌표에 놓이는 핀**(초안)만 쓴다 — 확정된 핀은
 * 팬/줌 레이어 안이라 이미 배율이 걸려 있다. 이 인자가 없으면 확대한 캔버스에서
 * 초안 핀만 작게 보인다(실측: 배율 1.25에서 34 vs 43 — 제보 ④의 "너무 작다").
 */
export function commentPinBoxStyle(th: Theme, selected: boolean, zoom = 1): CSSProperties {
  return {
    width: COMMENT_PIN_W,
    height: COMMENT_PIN_W,
    boxSizing: 'border-box',
    borderRadius: PIN_RADIUS,
    background: accentGradient(th),
    color: th.accentInk,
    border: `2px solid ${th.panel}`,
    boxShadow: selected ? `0 0 0 3px ${th.accent}40, 0 6px 16px rgba(46,42,38,.35)` : '0 6px 16px rgba(46,42,38,.3)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    userSelect: 'none',
    // 지점이 왼쪽 **아래** 꼭짓점 — 위로 자란다.
    transform: zoom === 1 ? 'translate(0, -100%)' : `translate(0, -100%) scale(${zoom})`,
    transformOrigin: '0 100%',
  };
}

/** 핀 안에 그리는 것: 말풍선 하나. 개수는 아래 배지가 맡는다. */
export function CommentPinGlyph() {
  return <CommentIcon size={17} />;
}

/** 댓글 수 배지 — 본체 우상단에 걸친다(본체 폭을 늘리지 않는다). */
export function CommentPinCount({ count, th }: { count: number; th: Theme }) {
  if (count <= 0) return null;
  return (
    <span
      data-pin-count
      style={{
        position: 'absolute',
        top: -7,
        right: -7,
        minWidth: 18,
        height: 18,
        boxSizing: 'border-box',
        padding: '0 4px',
        borderRadius: 999,
        background: th.panel,
        border: `1.5px solid ${th.accent}`,
        color: th.accent,
        fontSize: 10.5,
        fontWeight: 800,
        lineHeight: '15px',
        textAlign: 'center',
        boxShadow: '0 1px 4px rgba(0,0,0,.12)',
      }}
    >
      {count}
    </span>
  );
}

/**
 * 댓글 도구의 마우스 커서(요청 ③) — **핀 그대로**를 손끝에 붙인다.
 *
 * 예전에는 흰 테두리를 두른 말풍선 글리프라 꽂히는 핀과 딴판이었다. 지금은 같은
 * 물방울에 같은 말풍선이고, 지정점(hotspot)이 물방울의 왼쪽 아래 꼭짓점이라
 * **커서가 가리키는 자리에 핀이 그대로 선다**.
 */
export function commentPinCursor(accent: string, ink: string): string {
  const S = 30; // 커서 이미지 크기 — 실제 핀(34)보다 살짝 작게(커서 관례)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">` +
    // 물방울: 왼쪽 아래만 각진 라운드 사각(위에서 아래로 자란 핀의 실루엣)
    `<path d="M4 2h18a4 4 0 0 1 4 4v12a4 4 0 0 1-4 4H8l-6 4V6a4 4 0 0 1 4-4z" fill="${accent}" stroke="#ffffff" stroke-width="2"/>` +
    // 안쪽 말풍선 — 앱 아이콘과 같은 path를 24 뷰박스에서 축소해 얹는다
    `<g transform="translate(6.5 5.5) scale(0.72)" fill="none" stroke="${ink}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="${COMMENT_GLYPH.bubble}"/><path d="${COMMENT_GLYPH.line1}"/><path d="${COMMENT_GLYPH.line2}"/></g></svg>`;
  // hotspot = 꼬리 끝(2, 28) → 누른 자리가 핀이 가리키는 지점이 된다.
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 2 28, crosshair`;
}

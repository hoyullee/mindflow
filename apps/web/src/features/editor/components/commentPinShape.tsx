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
import { hexA, mixHex } from '../theme';

/** 핀 본체의 가로·세로(px, 문서 좌표계). 개수·해결 배지는 이 상자 **밖**에 붙는다. */
export const COMMENT_PIN_W = 34;

/**
 * 시안의 실루엣 — **둥근 사각의 왼쪽 아래만 각지게** 깎아 그 꼭짓점이 지점을 가리킨다.
 * 예전 값(999px = 원)은 위가 완전히 둥글어 핀이 아니라 아치처럼 보였다(제보).
 */
const PIN_RADIUS = '15px 15px 15px 3px';

/** 말풍선 윤곽 — 초안 핀·마우스 커서·도구 막대 아이콘이 함께 쓴다(시안 ③).
 * 안이 비어 있어(선) 코럴 바탕 위에서 흰 말풍선으로 또렷하게 읽힌다.
 *
 * **둥근 사각이 아니라 타원**이다 — 시안을 5배로 확대해 보면 몸통이 옆으로 퍼진
 * 타원이고 왼쪽 아래에 짧은 꼬리가 달렸다(예전 사각 말풍선은 딴 물건으로 보였다). */
export const THREAD_BUBBLE_PATH =
  'M12.3 4.2C7.7 4.2 4 7.2 4 10.9c0 2.1 1.2 3.9 3.1 5.2L5.7 20.4l4.6-2.3c.65.1 1.32.15 2 .15 4.6 0 8.3-3 8.3-6.7s-3.7-6.7-8.3-6.7Z';

/**
 * 핀 본체의 스타일. `zoom`은 **화면 좌표에 놓이는 핀**(초안)만 쓴다 — 꽂혀 있는 핀은
 * 팬/줌 레이어 안이라 이미 배율이 걸려 있다. 이 인자가 없으면 확대한 캔버스에서
 * 초안 핀만 작게 보인다(실측: 배율 1.25에서 34 vs 43 — 제보).
 *
 * `tone`: 'accent'(초안·선택된 핀) / 'panel'(평소의 핀 — 얼굴이 주인공이라 흰 바탕).
 * `edge`: 흰 테두리. 초안 핀은 배경이 무엇이든 도드라져야 해서 두르지만, **고른 핀은
 * 두르지 않는다** — 몸통(코럴)·흰 테두리·얼굴의 흰 링이 겹쳐 과녁처럼 보인다(시안 ②).
 */
export function commentPinBoxStyle(th: Theme, selected: boolean, zoom = 1, tone: 'accent' | 'panel' = 'accent', edge = true): CSSProperties {
  const onAccent = tone === 'accent';
  return {
    width: COMMENT_PIN_W,
    height: COMMENT_PIN_W,
    boxSizing: 'border-box',
    borderRadius: PIN_RADIUS,
    background: onAccent ? accentGradient(th) : th.panel,
    color: onAccent ? th.accentInk : th.text,
    border: onAccent ? (edge ? `2px solid ${th.panel}` : 'none') : `1px solid ${th.border}`,
    boxShadow: selected ? `0 0 0 3px ${hexA(th.accent, 0.28)}, 0 6px 16px rgba(46,42,38,.3)` : '0 5px 14px rgba(46,42,38,.22)',
    // 브라우저 기본 포커스 외곽선을 끈다 — 고른 핀은 위 그림자(강조색 후광)가 말한다.
    // 그대로 두면 클릭한 핀에 **검은 링**이 얹혀 디자인이 통째로 깨진다(제보 스크린샷).
    outline: 'none',
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

/** 얼굴 — 이름의 첫 글자. 핀 안(28)과 스레드 목록(26)이 같은 것을 쓴다.
 *
 * `onAccent`: 강조색 몸통 **위**에 얹을 때. 이때는 이름 색을 쓰지 않고 **반투명 흰
 * 원 + 흰 글자**가 된다(시안 ②) — 파스텔 얼굴을 그대로 두면 코럴 몸통·흰 링과
 * 겹쳐 과녁처럼 보인다. */
export function Avatar({ name, size = 24, ring, onAccent = false, src }: { name: string; size?: number; ring?: string; onAccent?: boolean; src?: string | null }) {
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
        background: onAccent ? 'rgba(255,255,255,.3)' : tint.bg,
        color: onAccent ? '#ffffff' : tint.ink,
        border: ring ? `2px solid ${ring}` : undefined,
        boxSizing: 'border-box',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: Math.round(size * 0.42),
        fontWeight: 700,
        lineHeight: 1,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {(name || '?').slice(0, 1)}
      {/* 프로필 이미지(0031) — 첫 글자를 아래에 남겨 둔다(주소가 죽으면 그대로 폴백). */}
      {src && (
        <img
          src={src}
          alt=""
          aria-hidden="true"
          referrerPolicy="no-referrer"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        />
      )}
    </span>
  );
}

/** 초안 핀·커서·도구 막대가 담는 것: 말풍선 윤곽(아직 얼굴이 없다 — 시안 ③). */
export function CommentPinGlyph({ size = 17, color = 'currentColor', width = 2.1 }: { size?: number; color?: string; width?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={THREAD_BUBBLE_PATH} />
    </svg>
  );
}

/** 스레드의 글 수 — 본체 우상단에 걸친다(본체 폭을 늘리지 않는다).
 * 고른 핀은 몸통이 강조색이라 배지도 강조색이면 묻힌다 — 그때만 **잉크색**으로
 * 뒤집는다(시안 ②). */
export function CommentPinCount({ count, th, onAccent = false }: { count: number; th: Theme; onAccent?: boolean }) {
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
        background: onAccent ? th.text : th.accent,
        border: `2px solid ${th.panel}`,
        color: onAccent ? th.panel : th.accentInk,
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
  // 본체: 둥근 사각의 왼쪽 아래만 각지게(핀 CSS의 13/13/13/5와 같은 비율).
  const body = 'M14 1.5h3.4A11.1 11.1 0 0 1 28.5 12.6v3.4a11.1 11.1 0 0 1-11.1 11.1H1.5V12.6A11.1 11.1 0 0 1 12.6 1.5z';
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">` +
    `<path d="${body}" fill="${accent}" stroke="#ffffff" stroke-width="2.2" stroke-linejoin="round"/>` +
    // 안쪽: 핀·초안과 **같은 말풍선 윤곽**(시안 ③) — 잉크색으로 그린다.
    // 말풍선의 광학적 중심을 몸통의 둥근 쪽(왼쪽 아래가 각져 무게가 위·오른쪽에
    // 실린다)에 맞춘다 — 기하학적 중앙에 두면 살짝 아래로 처져 보인다.
    `<g transform="translate(6.7 4.9) scale(0.7)" fill="none" stroke="${ink}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="${THREAD_BUBBLE_PATH}"/></g></svg>`;
  // hotspot = 왼쪽 아래 꼭짓점 → 누른 자리가 핀이 가리키는 지점이 된다.
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 2 28, crosshair`;
}

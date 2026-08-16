// 댓글 핀의 **화면 자리** — 팝업(요청 ⑦)과 초안 말풍선(요청 ④)이 같은 규칙으로
// 핀 옆에 선다.
//
// 핀은 팬/줌 레이어 안(문서 좌표)에 있고 팝업·말풍선은 화면 좌표 상자에 뜬다.
// 두 세계를 잇는 계산은 한 곳에만 둔다 — 둘이 어긋나면 "핀 옆에 뜬다"가 깨진다.

import { COMMENT_PIN_W } from './commentPinShape';

export interface Viewportish {
  pan: { x: number; y: number };
  zoom: number;
  vw: number;
  vh: number;
}

/** 문서 좌표 → `.mf-ed-vp` 기준 화면 좌표. */
export function pinScreenPos(vp: Viewportish, at: { x: number; y: number }): { x: number; y: number } {
  return { x: at.x * vp.zoom + vp.pan.x, y: at.y * vp.zoom + vp.pan.y };
}

/**
 * 핀 옆에 뜨는 상자의 왼쪽 위 자리 — **핀을 가리지 않고** 그 오른쪽에 바짝 붙는다
 * (요청 ①). 오른쪽에 자리가 없으면 왼쪽으로 넘기고, 그래도 모자라면 화면 안으로
 * 밀어 넣되 그때는 핀 **아래**로 내려 겹침을 피한다.
 *
 * 간격이 핀 폭에서 나오는 이유: 핀은 지점에서 오른쪽·위쪽으로 자라므로(물방울의
 * 왼쪽 아래 꼭짓점이 지점) 폭을 모르면 상자가 핀 위에 걸터앉는다. 개수를 본체 밖
 * 배지로 뺀 것도 이 폭을 상수로 만들기 위해서다(`commentPinShape`).
 */
export function anchoredBoxPos(vp: Viewportish, at: { x: number; y: number }, w: number, h: number, gapPx?: number): { left: number; top: number } {
  const p = pinScreenPos(vp, at);
  // 핀은 팬/줌 레이어 안이라 화면에서는 배율만큼 커진다 — 간격도 함께 커져야
  // 확대한 캔버스에서 팝업이 핀을 덮지 않는다.
  const pinW = COMMENT_PIN_W * (vp.zoom || 1);
  const gap = gapPx ?? pinW + 12;
  const pad = 12;
  const right = p.x + gap;
  const flipped = right + w + pad > vp.vw;
  const left = flipped ? p.x - 12 - w : right;
  // 핀 상단(지점에서 위로 COMMENT_PIN_W)과 상자 윗변을 나란히 — 핀이 팝업의
  // 어깨에 걸리는 자리라 "이 핀의 논의"가 눈으로 이어진다.
  let top = p.y - pinW - 2;
  const clampedLeft = Math.max(pad, Math.min(left, Math.max(pad, vp.vw - w - pad)));
  // 좌우 어느 쪽에도 자리가 없어 상자가 핀 위로 밀렸다면 세로로 비킨다.
  if (clampedLeft < p.x + gap && clampedLeft + w > p.x - 12) top = p.y + 10;
  return {
    left: clampedLeft,
    top: Math.max(pad, Math.min(top, Math.max(pad, vp.vh - h - pad))),
  };
}

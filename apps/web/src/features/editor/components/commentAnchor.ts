// 댓글 핀의 **화면 자리** — 팝업(요청 ⑦)과 초안 말풍선(요청 ④)이 같은 규칙으로
// 핀 옆에 선다.
//
// 핀은 팬/줌 레이어 안(문서 좌표)에 있고 팝업·말풍선은 화면 좌표 상자에 뜬다.
// 두 세계를 잇는 계산은 한 곳에만 둔다 — 둘이 어긋나면 "핀 옆에 뜬다"가 깨진다.

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
 * 핀 옆에 뜨는 상자의 왼쪽 위 자리 — 오른쪽에 자리가 없으면 왼쪽으로 넘기고,
 * 그래도 모자라면 화면 안으로 밀어 넣는다(팝업이 화면 밖으로 나가지 않게).
 *
 * `gap`은 핀 **폭**보다 넓어야 한다(핀은 지점에서 오른쪽으로 자란다) — 좁으면
 * 상자가 핀 위에 걸터앉아 무엇을 가리키는지 흐려진다(실브라우저에서 확인).
 */
export function anchoredBoxPos(vp: Viewportish, at: { x: number; y: number }, w: number, h: number, gap = 40): { left: number; top: number } {
  const p = pinScreenPos(vp, at);
  const pad = 12;
  const right = p.x + gap;
  // 핀은 아래쪽 꼭짓점이 지점을 가리키므로(물방울) 상자는 그 위쪽에 걸친다.
  const left = right + w + pad > vp.vw ? p.x - gap - w : right;
  const top = p.y - 34;
  return {
    left: Math.max(pad, Math.min(left, Math.max(pad, vp.vw - w - pad))),
    top: Math.max(pad, Math.min(top, Math.max(pad, vp.vh - h - pad))),
  };
}

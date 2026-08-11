// 자유 그리기 획(화이트보드 M4)의 순수 기하 — 렌더/입력은 웹의 몫이고, 여기는
// "획이 차지하는 영역"과 "이 점이 획에 닿았는가"(획 지우개)만 안다.

import type { Stroke } from './model';

export interface StrokeBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** 획의 경계 상자(선 굵기 절반 포함). 점이 없으면 null. */
export function strokeBounds(s: Stroke): StrokeBox | null {
  const pts = s.pts;
  if (pts.length < 2) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i + 1 < pts.length; i += 2) {
    const x = pts[i]!;
    const y = pts[i + 1]!;
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  const half = (s.w || 2) / 2;
  return { x0: x0 - half, y0: y0 - half, x1: x1 + half, y1: y1 + half };
}

/** 점 (px,py)에서 선분 (ax,ay)-(bx,by)까지의 거리 제곱. */
function distSqToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq > 0 ? ((px - ax) * dx + (py - ay) * dy) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return (px - cx) * (px - cx) + (py - cy) * (py - cy);
}

/**
 * 획 지우개의 히트 판정 — 점 (x,y)가 획의 어느 선분에서든 `tol` 안이면 true.
 * tol에는 호출부가 (지우개 반경 + 선 굵기 절반)을 넣는다.
 */
export function strokeHit(s: Stroke, x: number, y: number, tol: number): boolean {
  const pts = s.pts;
  if (pts.length < 2) return false;
  const tolSq = tol * tol;
  if (pts.length === 2) {
    const dx = x - pts[0]!;
    const dy = y - pts[1]!;
    return dx * dx + dy * dy <= tolSq;
  }
  for (let i = 0; i + 3 < pts.length; i += 2) {
    if (distSqToSegment(x, y, pts[i]!, pts[i + 1]!, pts[i + 2]!, pts[i + 3]!) <= tolSq) return true;
  }
  return false;
}

/** SVG/캔버스 공용 path d 문자열 — `M x y L x y …`. 점이 하나뿐이면 극소 선분으로
 * 만들어 점도 찍히게 한다(둥근 캡이 원으로 그려진다). */
export function strokePathD(pts: number[]): string {
  if (pts.length < 2) return '';
  if (pts.length === 2) return `M ${pts[0]} ${pts[1]} L ${pts[0]! + 0.01} ${pts[1]}`;
  let d = `M ${pts[0]} ${pts[1]}`;
  for (let i = 2; i + 1 < pts.length; i += 2) d += ` L ${pts[i]} ${pts[i + 1]}`;
  return d;
}

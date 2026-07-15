// Pure line/curve geometry — used by any renderer (web SVG/Canvas, export) to
// draw connection lines. No DOM/canvas: font-independent maths only.
//
// Ports of Component#lineCPs / #cubicAt / #portPoint (MindFlow.dc.html:123086,
// 123641, 122044). The node-to-node connector ("elbow"/curve) path and full
// SVG string generation are render-coupled and live with the web renderer (M3),
// not here.

export interface Point {
  x: number;
  y: number;
}

/** A cubic Bézier resolved from a line's endpoints + curvature. */
export interface LineGeometry {
  P0: Point;
  P3: Point;
  c1: number;
  c2: number;
  /** Unit normal of the P0→P3 segment (curvature is applied along it). */
  nx: number;
  ny: number;
  C1: Point;
  C2: Point;
}

/** Minimal shape `resolveLineGeometry` needs — a full `Line` satisfies it. */
export interface LineLike {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  c1?: number | null;
  c2?: number | null;
  /** Legacy single-curvature field; used for both control points when c1/c2 absent. */
  curve?: number | null;
}

/**
 * Port of `Component#lineCPs` (MindFlow.dc.html:123086) for free lines
 * (endpoint coordinates). Curvature `c1`/`c2` offset the two control points
 * along the segment normal; falls back to the legacy `curve` field for both.
 *
 * Anchored lines (a1/a2 attaching an endpoint to a node/float box) are not part
 * of the `Line` model yet; when they are, resolve the endpoints to box ports
 * first (see `portPoint`) and pass the resolved coordinates in.
 */
export function resolveLineGeometry(line: LineLike): LineGeometry {
  const P0: Point = { x: line.x1, y: line.y1 };
  const P3: Point = { x: line.x2, y: line.y2 };
  const c1 = line.c1 != null ? line.c1 : (line.curve ?? 0);
  const c2 = line.c2 != null ? line.c2 : (line.curve ?? 0);
  const len = Math.hypot(P3.x - P0.x, P3.y - P0.y) || 1;
  const nx = -(P3.y - P0.y) / len;
  const ny = (P3.x - P0.x) / len;
  return {
    P0,
    P3,
    c1,
    c2,
    nx,
    ny,
    C1: { x: P0.x + (P3.x - P0.x) / 3 + nx * c1, y: P0.y + (P3.y - P0.y) / 3 + ny * c1 },
    C2: { x: P0.x + (2 * (P3.x - P0.x)) / 3 + nx * c2, y: P0.y + (2 * (P3.y - P0.y)) / 3 + ny * c2 },
  };
}

/** Point on a cubic Bézier at parameter `t` ∈ [0,1]. Port of `Component#cubicAt`. */
export function cubicAt(g: LineGeometry, t: number): Point {
  const it = 1 - t;
  return {
    x: it * it * it * g.P0.x + 3 * it * it * t * g.C1.x + 3 * it * t * t * g.C2.x + t * t * t * g.P3.x,
    y: it * it * it * g.P0.y + 3 * it * it * t * g.C1.y + 3 * it * t * t * g.C2.y + t * t * t * g.P3.y,
  };
}

/** Axis-aligned box described by its center and half-extents. */
export interface Box {
  cx: number;
  cy: number;
  hw: number;
  hh: number;
}

export type PortSide = 'top' | 'bottom' | 'left' | 'right';

/** Point on the middle of a box edge. Port of `Component#portPoint`. */
export function portPoint(box: Box, side: PortSide): Point {
  if (side === 'top') return { x: box.cx, y: box.cy - box.hh };
  if (side === 'bottom') return { x: box.cx, y: box.cy + box.hh };
  if (side === 'left') return { x: box.cx - box.hw, y: box.cy };
  return { x: box.cx + box.hw, y: box.cy }; // right
}

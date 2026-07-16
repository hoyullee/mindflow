// Pure line/curve geometry — used by any renderer (web SVG/Canvas, export) to
// draw connection lines. No DOM/canvas: font-independent maths only.
//
// Ports of Component#lineCPs / #cubicAt / #portPoint (MindFlow.dc.html:123086,
// 123641, 122044). The node-to-node connector ("elbow"/curve) path and full
// SVG string generation are render-coupled and live with the web renderer (M3),
// not here.
//
// Line anchor magnets (`a1`/`a2`, MindFlow.dc.html:2377-2454): resolving an
// anchor to a screen point needs a box lookup (node `_geom` / float box),
// which is a host concern (the host owns layout/DOM measurement) — so
// `resolveLineEndpoints`/`findLineSnap` below take that lookup as an injected
// callback/candidate list rather than reading any state themselves.

import type { LineAnchor } from './model';

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
 * Anchored lines (`a1`/`a2` attaching an endpoint to a node/float box) are
 * resolved to their on-screen coordinates by `resolveLineEndpoints` first —
 * pass the resolved `{x1,y1,x2,y2}` in here alongside the line's `c1`/`c2`/
 * `curve` (a plain object spread works: `{ ...line, ...resolveLineEndpoints(line, boxOf) }`).
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

/**
 * Point on a box's border in the direction of `(tox, toy)` from its center —
 * port of `Component#borderPoint` (MindFlow.dc.html:2391-2396). Used as the
 * fallback for legacy anchors that have no `side` (aim at the other end's
 * point instead of a fixed port).
 */
export function borderPoint(box: Box, tox: number, toy: number): Point {
  const dx = tox - box.cx;
  const dy = toy - box.cy;
  if (dx === 0 && dy === 0) return { x: box.cx, y: box.cy - box.hh };
  const t = Math.min(box.hw / (Math.abs(dx) || 1e-6), box.hh / (Math.abs(dy) || 1e-6));
  return { x: box.cx + dx * t, y: box.cy + dy * t };
}

/** Minimal line shape `resolveLineEndpoints` needs — a full `Line` satisfies it. */
export interface AnchoredLineLike {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  a1?: LineAnchor | null;
  a2?: LineAnchor | null;
}

/** The resolved on-screen coordinates of a (possibly anchored) line's two endpoints. */
export interface LineEndpoints {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Resolves one endpoint (`which` 1 or 2) of a possibly-anchored line to its
 * on-screen point — port of `Component#resolveEnd` (MindFlow.dc.html:2403-2412).
 * `boxOf` looks up the anchor's target box (node `_geom` or float box); the
 * host owns that lookup (layout/DOM concern), so it's injected rather than
 * read from any core state. Falls back to the raw `x{which}/y{which}` when
 * there's no anchor, or the anchor's target box can no longer be found (e.g.
 * a deleted node/float — matches the original's `if (!box) return {x,y}`).
 */
function resolveEnd(line: AnchoredLineLike, which: 1 | 2, boxOf: (anchor: LineAnchor) => Box | null): Point {
  const anchor = which === 1 ? line.a1 : line.a2;
  const raw: Point = which === 1 ? { x: line.x1, y: line.y1 } : { x: line.x2, y: line.y2 };
  if (!anchor) return raw;
  const box = boxOf(anchor);
  if (!box) return raw;
  if (anchor.side) return portPoint(box, anchor.side);
  // legacy anchor without a side: fall back to the border point toward the other end
  const otherRaw: Point = which === 1 ? { x: line.x2, y: line.y2 } : { x: line.x1, y: line.y1 };
  const otherAnchor = which === 1 ? line.a2 : line.a1;
  const otherBox = otherAnchor ? boxOf(otherAnchor) : null;
  const other = otherBox ? { x: otherBox.cx, y: otherBox.cy } : otherRaw;
  return borderPoint(box, other.x, other.y);
}

/**
 * Resolves both endpoints of a possibly-anchored line to their on-screen
 * coordinates — port of `Component#resolveLine` (MindFlow.dc.html:2414-2417).
 * Feed the result (spread over the line) into `resolveLineGeometry` to get
 * the anchor-aware Bézier for rendering/hit-testing/export.
 */
export function resolveLineEndpoints(line: AnchoredLineLike, boxOf: (anchor: LineAnchor) => Box | null): LineEndpoints {
  const p1 = resolveEnd(line, 1, boxOf);
  const p2 = resolveEnd(line, 2, boxOf);
  return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
}

/** A snap candidate — a node or float's current box, offered up for endpoint-magnet testing. */
export interface SnapCandidate {
  kind: 'node' | 'float';
  id: string;
  box: Box;
}

/** Snap threshold in canvas px — port of `Component#findSnap`'s `SNAP` constant (MindFlow.dc.html:2443). */
export const LINE_SNAP_DISTANCE = 34;

const PORT_SIDES: PortSide[] = ['top', 'bottom', 'left', 'right'];

/**
 * Finds the nearest port (of any candidate node/float box) to a point, within
 * `snap` px — port of `Component#findSnap` (MindFlow.dc.html:2442-2454). Ties
 * keep the first candidate encountered (strict `<` comparison), matching the
 * original. Returns `null` when nothing is within range.
 */
export function findLineSnap(x: number, y: number, candidates: SnapCandidate[], snap: number = LINE_SNAP_DISTANCE): LineAnchor | null {
  let best: LineAnchor | null = null;
  let bestD = snap;
  for (const c of candidates) {
    for (const side of PORT_SIDES) {
      const p = portPoint(c.box, side);
      const dd = Math.hypot(x - p.x, y - p.y);
      if (dd < bestD) {
        bestD = dd;
        best = { kind: c.kind, id: c.id, side };
      }
    }
  }
  return best;
}

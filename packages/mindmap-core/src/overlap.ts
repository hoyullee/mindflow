// Free-shape overlap resolution — port of `Component#computeFreeNudge` /
// `applyFreeNudge` / `resolveOverlapFree` (MindFlow.dc.html:2170-2249).
//
// A "free shape" (a node with `free: true` and no parent) can be dragged
// anywhere on the canvas. This computes the smallest translation that lifts the
// shape (and its whole subtree) clear of every OTHER node box — a magnet-style
// "don't overlap" nudge applied on drop / after its box grows.
//
// Pure geometry: box POSITION *and* SIZE are injected via `boxOf`, a rendering
// concern. The original mutates `nodes[id].x/y` in `_layout`, so it read
// positions straight off the nodes; this port's `layout()` returns a SEPARATE
// laid-out map (it never touches `doc.nodes`), so tree-node positions live only
// in the rendered geometry — hence `boxOf` must supply them (a tree node's
// `doc.nodes` x/y is 0, not its on-screen spot). `nodes` here is used only for
// the subtree structure (which ids move together) and to enumerate obstacles.
//
// Memos (floats) aren't nodes, so they're never obstacles — matching the
// original, where "shapes and memos may overlap freely; only shape-vs-shape
// (and shape-vs-tree-node) auto-arranges".

import type { NodeMap } from './model';

export interface OverlapBox {
  /** Box center x (on-screen / laid-out). */
  x: number;
  /** Box center y (on-screen / laid-out). */
  y: number;
  w: number;
  h: number;
}

export interface FreeNudge {
  dx: number;
  dy: number;
  /** The subtree ids the caller should shift by (dx, dy). */
  ids: string[];
}

export interface FreeNudgeOptions {
  /** Clearance kept around the shape (px). Port default: 12. */
  margin?: number;
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A free shape moves with its whole subtree — every descendant, collapsed or not. */
function subtreeIds(rootId: string, nodes: NodeMap): string[] {
  const out = [rootId];
  const walk = (id: string): void => {
    const n = nodes[id];
    if (!n) return;
    n.children.forEach((c) => {
      if (nodes[c]) {
        out.push(c);
        walk(c);
      }
    });
  };
  walk(rootId);
  return out;
}

/**
 * The translation that lifts the free subtree rooted at `rootId` clear of every
 * other node box (with `margin` clearance), or `null` if it's already clear (or
 * has no measurable box). Port of `Component#computeFreeNudge`:
 * 1. iterative minimum-translation push (14 passes) — resolve the biggest
 *    overlap along its shorter axis each pass;
 * 2. if that oscillates between tightly-packed neighbours, spiral-search the
 *    nearest fully clear spot from the drop point instead.
 */
export function computeFreeNudge(
  rootId: string,
  nodes: NodeMap,
  boxOf: (id: string) => OverlapBox | null,
  opts: FreeNudgeOptions = {},
): FreeNudge | null {
  if (!nodes[rootId]) return null;
  const ids = subtreeIds(rootId, nodes);
  const idSet = new Set(ids);

  const rectOf = (id: string): Rect | null => {
    const b = boxOf(id);
    if (!b) return null;
    return { x0: b.x - b.w / 2, y0: b.y - b.h / 2, x1: b.x + b.w / 2, y1: b.y + b.h / 2 };
  };

  let bb: Rect | null = null;
  ids.forEach((id) => {
    const r = rectOf(id);
    if (!r) return;
    bb = bb
      ? { x0: Math.min(bb.x0, r.x0), y0: Math.min(bb.y0, r.y0), x1: Math.max(bb.x1, r.x1), y1: Math.max(bb.y1, r.y1) }
      : r;
  });
  if (!bb) return null;
  const box = bb as Rect;

  const obstacles: Rect[] = [];
  for (const id in nodes) {
    if (idSet.has(id)) continue;
    const r = rectOf(id);
    if (r) obstacles.push(r);
  }
  if (!obstacles.length) return null;

  const M = opts.margin ?? 12;

  const collides = (ddx: number, ddy: number): boolean => {
    const a = { x0: box.x0 + ddx - M, y0: box.y0 + ddy - M, x1: box.x1 + ddx + M, y1: box.y1 + ddy + M };
    for (const o of obstacles) {
      const ox = Math.min(a.x1, o.x1) - Math.max(a.x0, o.x0);
      const oy = Math.min(a.y1, o.y1) - Math.max(a.y0, o.y0);
      if (ox > 0.5 && oy > 0.5) return true;
    }
    return false;
  };

  if (!collides(0, 0)) return null;

  let dx = 0;
  let dy = 0;

  // Primary: the smallest push straight out along one of the four axes. This is
  // predictable (the shape slides directly off whatever it's on) and minimal —
  // no diagonal fling. We probe each direction until the box is clear and keep the
  // shortest escape. Step 6px is fine enough that the result hugs the true minimum.
  const STEP = 6;
  const MAX = 1400;
  let best: { dx: number; dy: number; dist: number } | null = null;
  for (const [ux, uy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    for (let d = STEP; d <= MAX; d += STEP) {
      if (!collides(ux * d, uy * d)) {
        if (!best || d < best.dist) best = { dx: ux * d, dy: uy * d, dist: d };
        break;
      }
    }
  }

  if (best) {
    dx = best.dx;
    dy = best.dy;
  } else {
    // Fully boxed in on every axis — spiral out from the drop point to the nearest
    // fully clear spot (diagonal escapes only reachable this way).
    const step = 16;
    let found = false;
    for (let ring = 1; ring <= 90 && !found; ring++) {
      const r = ring * step;
      const nCand = Math.max(8, ring * 4);
      for (let i = 0; i < nCand; i++) {
        const ang = (i / nCand) * Math.PI * 2;
        const cx = Math.cos(ang) * r;
        const cy = Math.sin(ang) * r;
        if (!collides(cx, cy)) {
          dx = cx;
          dy = cy;
          found = true;
          break;
        }
      }
    }
    if (!found) return null;
  }

  if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) return { dx, dy, ids };
  return null;
}

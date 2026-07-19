// Free-shape overlap resolution — port of `Component#computeFreeNudge` /
// `applyFreeNudge` / `resolveOverlapFree` (MindFlow.dc.html:2170-2249).
//
// A "free shape" (a node with `free: true` and no parent) can be dragged
// anywhere on the canvas. This computes the smallest translation that lifts the
// shape (and its whole subtree) clear of every OTHER node box — a magnet-style
// "don't overlap" nudge applied on drop / after its box grows.
//
// Pure geometry: box SIZES are injected via `boxOf` (a rendering concern — see
// `SizeOf`/`layout`), positions come from `nodes[id].x/y` (box centers). Memos
// (floats) aren't nodes, so they're never obstacles — matching the original,
// where "shapes and memos may overlap freely; only shape-vs-shape auto-arranges".

import type { NodeMap } from './model';

export interface OverlapSize {
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
  boxOf: (id: string) => OverlapSize | null,
  opts: FreeNudgeOptions = {},
): FreeNudge | null {
  if (!nodes[rootId]) return null;
  const ids = subtreeIds(rootId, nodes);
  const idSet = new Set(ids);

  const rectOf = (id: string): Rect | null => {
    const n = nodes[id];
    const b = boxOf(id);
    if (!n || !b) return null;
    return { x0: n.x - b.w / 2, y0: n.y - b.h / 2, x1: n.x + b.w / 2, y1: n.y + b.h / 2 };
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
  let dx = 0;
  let dy = 0;

  const collides = (ddx: number, ddy: number): boolean => {
    const a = { x0: box.x0 + ddx - M, y0: box.y0 + ddy - M, x1: box.x1 + ddx + M, y1: box.y1 + ddy + M };
    for (const o of obstacles) {
      const ox = Math.min(a.x1, o.x1) - Math.max(a.x0, o.x0);
      const oy = Math.min(a.y1, o.y1) - Math.max(a.y0, o.y0);
      if (ox > 0.5 && oy > 0.5) return true;
    }
    return false;
  };

  for (let iter = 0; iter < 14; iter++) {
    let pushed = false;
    for (const o of obstacles) {
      const a = { x0: box.x0 + dx - M, y0: box.y0 + dy - M, x1: box.x1 + dx + M, y1: box.y1 + dy + M };
      const ox = Math.min(a.x1, o.x1) - Math.max(a.x0, o.x0);
      const oy = Math.min(a.y1, o.y1) - Math.max(a.y0, o.y0);
      if (ox > 0.5 && oy > 0.5) {
        pushed = true;
        // push along the axis of least overlap (smallest displacement out)
        if (ox < oy) dx += (a.x0 + a.x1) / 2 < (o.x0 + o.x1) / 2 ? -ox : ox;
        else dy += (a.y0 + a.y1) / 2 < (o.y0 + o.y1) / 2 ? -oy : oy;
      }
    }
    if (!pushed) break;
  }

  if (collides(dx, dy)) {
    dx = 0;
    dy = 0;
    const step = 24;
    let found = false;
    for (let ring = 1; ring <= 40 && !found; ring++) {
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

// Arrow-key node navigation scoring — extracted as a pure function so the
// directional cone is unit-testable without the editor hook. Port of
// `Component#navigate` (MindFlow.dc.html:2058-2081), with a tightened cone (see
// `nearestInDirection` below) that fixes diagonal jumps.

export type NavDir = 'up' | 'down' | 'left' | 'right';

/**
 * Any object with map-space centre coordinates (the editor's `GeomMap` entries
 * qualify). `w`/`h` are optional box sizes: when present, `along`/`perp` are
 * measured between box **edges** instead of centres (missing sizes read as 0,
 * which degrades to the old centre model).
 */
export interface NavPoint {
  x: number;
  y: number;
  w?: number;
  h?: number;
}

/**
 * Given the map-space centre of every visible node and the currently-selected
 * node `fromId`, return the id of the node the arrow `dir` should move to — the
 * nearest node genuinely in that direction, measured **relative to the selected
 * node** (the reference frame the user expects).
 *
 * `along` = distance in the pressed direction, `perp` = sideways deviation from
 * that axis; the distance score is `along + perp*2.2` (dc's original weighting).
 *
 * Two passes with the same score but different acceptance cones:
 *  - Pass 1 (tight, 45°: `perp <= along`): only nodes genuinely in the pressed
 *    direction, so a well-aligned neighbour always beats a diagonal one.
 *  - Pass 2 (fallback, dc's loose `perp <= along*2 + 60`): used only when the
 *    tight pass finds nothing (sparse/radial layouts where the nearest node in
 *    that direction is steeply off-axis), so the arrow still moves somewhere.
 *
 * dc used only the loose cone; its `+60` additive slack let a barely-sideways
 * but mostly-perpendicular neighbour qualify and — being physically close — win
 * on proximity. Concretely, pressing Left could jump to a sibling a few px to the
 * left but far *above* (sibling box centres differ by their own widths) instead
 * of the parent directly to the left. That read as the arrow moving by "some
 * other reference" rather than the selected node.
 *
 * When boxes are provided, distances are edge-based: `along` is the gap between
 * the facing edges and `perp` is the gap between the boxes' projections on the
 * cross axis (0 when they overlap — e.g. a node directly below shares the x
 * range). Centre-based measuring broke variable-width columns: children are
 * left-edge-aligned, so a wide node's centre sits far right of a narrow
 * sibling's, and pressing Down saw the directly-below wide node as "diagonal"
 * (perp > along → rejected by the tight cone) while a farther, narrower node two
 * rows down passed and won — the arrow skipped a node. The reverse direction had
 * different centre geometry and worked, which is why the skip felt intermittent.
 */
export function nearestInDirection(points: Record<string, NavPoint>, fromId: string, dir: NavDir): string | null {
  const a = points[fromId];
  if (!a) return null;
  const ids = Object.keys(points);
  const aw = a.w ?? 0;
  const ah = a.h ?? 0;
  // Cross-axis projection gap between two boxes (0 = they overlap on that axis).
  const gap = (c1: number, s1: number, c2: number, s2: number): number =>
    Math.max(0, Math.max(c1 - s1 / 2, c2 - s2 / 2) - Math.min(c1 + s1 / 2, c2 + s2 / 2));
  const pick = (accept: (along: number, perp: number) => boolean): string | null => {
    let best: string | null = null;
    let bestScore = Infinity;
    ids.forEach((id) => {
      if (id === fromId) return;
      const b = points[id];
      if (!b) return;
      const bw = b.w ?? 0;
      const bh = b.h ?? 0;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      let along: number;
      let perp: number;
      let ok: boolean;
      if (dir === 'left') {
        ok = dx < -1;
        along = (a.x - aw / 2) - (b.x + bw / 2);
        perp = gap(a.y, ah, b.y, bh);
      } else if (dir === 'right') {
        ok = dx > 1;
        along = (b.x - bw / 2) - (a.x + aw / 2);
        perp = gap(a.y, ah, b.y, bh);
      } else if (dir === 'up') {
        ok = dy < -1;
        along = (a.y - ah / 2) - (b.y + bh / 2);
        perp = gap(a.x, aw, b.x, bw);
      } else {
        ok = dy > 1;
        along = (b.y - bh / 2) - (a.y + ah / 2);
        perp = gap(a.x, aw, b.x, bw);
      }
      if (!ok) return;
      // Boxes can overlap in the pressed direction (edge gap < 0) while the
      // centre is still genuinely that way — clamp so the cone/score stay sane.
      along = Math.max(1, along);
      if (!accept(along, perp)) return;
      const score = along + perp * 2.2;
      if (score < bestScore) {
        bestScore = score;
        best = id;
      }
    });
    return best;
  };
  return pick((along, perp) => perp <= along) ?? pick((along, perp) => perp <= along * 2 + 60);
}

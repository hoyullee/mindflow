// Arrow-key node navigation scoring — extracted as a pure function so the
// directional cone is unit-testable without the editor hook. Port of
// `Component#navigate` (MindFlow.dc.html:2058-2081), with a tightened cone (see
// `nearestInDirection` below) that fixes diagonal jumps.

export type NavDir = 'up' | 'down' | 'left' | 'right';

/** Any object with map-space centre coordinates (the editor's `GeomMap` entries qualify). */
export interface NavPoint {
  x: number;
  y: number;
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
 */
export function nearestInDirection(points: Record<string, NavPoint>, fromId: string, dir: NavDir): string | null {
  const a = points[fromId];
  if (!a) return null;
  const ids = Object.keys(points);
  const pick = (accept: (along: number, perp: number) => boolean): string | null => {
    let best: string | null = null;
    let bestScore = Infinity;
    ids.forEach((id) => {
      if (id === fromId) return;
      const b = points[id];
      if (!b) return;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      let along: number;
      let perp: number;
      let ok: boolean;
      if (dir === 'left') {
        ok = dx < -1;
        along = -dx;
        perp = Math.abs(dy);
      } else if (dir === 'right') {
        ok = dx > 1;
        along = dx;
        perp = Math.abs(dy);
      } else if (dir === 'up') {
        ok = dy < -1;
        along = -dy;
        perp = Math.abs(dx);
      } else {
        ok = dy > 1;
        along = dy;
        perp = Math.abs(dx);
      }
      if (!ok) return;
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

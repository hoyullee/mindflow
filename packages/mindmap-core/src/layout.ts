// Layout engine — pure port of `Component#_layout` / `Component#layoutFreeSub`
// (MindFlow.dc.html:977-1072), plus their pure tree-shape helpers
// `visKids` / `descendants` / `leafCount` (MindFlow.dc.html:888-890).
//
// `Component#metrics` (MindFlow.dc.html:917-...) — the original's canvas-based
// text measurer that produces each node's `{w,h}` — is INTENTIONALLY NOT
// ported here (it is a rendering concern). Instead this module takes a
// `SizeOf` callback injected by the caller: the web renderer wires it to a
// canvas measurer that reproduces `metrics`; tests wire it to fixed fixture
// sizes (see `test/fixtures/golden/node-sizes.json`).
//
// Purity: the original mutates `nodes` in place and relies on hidden
// instance state `this._rootAnchor` for root-pinning (every call site first
// does `const nodes = this.cloneNodes()`, then `this._layout(nodes, mode)`,
// then `this.setState({ nodes })` — e.g. MindFlow.dc.html:1904, 1917,
// 2554-2555). This port instead:
//   - clones `doc.nodes` internally and NEVER mutates the input `doc`;
//   - takes the root anchor as an explicit `opts.rootAnchor` parameter
//     (default `{ x: 0, y: 0 }`) instead of reading/writing instance state
//     (see `LayoutOptions` below — this is the "_rootAnchor promotion" ADR R3
//     risk called out in the M1b task);
//   - returns a brand-new `NodeMap` instead of mutating + calling `setState`.

import type { Doc, Node, NodeMap, LayoutMode } from './model';
import { ROOT_ID } from './model';
import { cloneNodes } from './serialize';

/** A node's on-screen box size, as measured by the host's text-measurer. */
export interface NodeSize {
  w: number;
  h: number;
}

/**
 * Injected node-size measurer — the pure-core stand-in for
 * `Component#metrics(node, depth)` (MindFlow.dc.html:917). NOT ported here
 * because it depends on canvas text measurement, a rendering concern.
 */
export type SizeOf = (node: Node, depth: number) => NodeSize;

export interface LayoutOptions {
  /**
   * Promotion of the hidden instance field `this._rootAnchor`
   * (MindFlow.dc.html:1049-1052; set after a root-node drag at
   * MindFlow.dc.html:1818, 1826). Defaults to `{ x: 0, y: 0 }`, matching the
   * original's own lazy default (`if (!this._rootAnchor) this._rootAnchor =
   * { x: 0, y: 0 };`, MindFlow.dc.html:1049).
   */
  rootAnchor?: { x: number; y: number };
}

/** Port of `Component#visKids` (MindFlow.dc.html:889). */
function visKids(nodes: NodeMap, id: string): string[] {
  const n = nodes[id];
  if (!n) return [];
  return n.collapsed ? [] : n.children.filter((c) => !!nodes[c]);
}

/** Port of `Component#descendants` (MindFlow.dc.html:888). */
function descendants(id: string, nodes: NodeMap): string[] {
  const out: string[] = [];
  const walk = (i: string): void => {
    const n = nodes[i];
    if (!n) return;
    n.children.forEach((c) => {
      if (nodes[c]) {
        out.push(c);
        walk(c);
      }
    });
  };
  walk(id);
  return out;
}

/** Port of `Component#leafCount` (MindFlow.dc.html:890). */
function leafCount(nodes: NodeMap, id: string): number {
  const ks = visKids(nodes, id);
  if (!ks.length) return 1;
  return ks.reduce((s, k) => s + leafCount(nodes, k), 0);
}

/**
 * Non-null accessor for a node id known (by construction — it came from a
 * `children` array already filtered through `visKids`/`descendants`, or is
 * `ROOT_ID`/a free-shape id enumerated from `nodes` itself) to be present.
 */
function at(nodes: NodeMap, id: string): Node {
  const n = nodes[id];
  if (!n) throw new Error(`layout: missing node "${id}"`);
  return n;
}

/**
 * Port of `Component#_layout(nodes, mode)` (MindFlow.dc.html:977-1055).
 *
 * Pure function: `doc` (and `doc.nodes`) is never mutated. Internally clones
 * `doc.nodes` (`cloneNodes`, matching the original's own clone-then-layout
 * call pattern) and returns the resulting `NodeMap` with `x`/`y` (and, for
 * the radial mode's first-level branches, `side`) computed.
 */
export function layout(doc: Doc, mode: LayoutMode, sizeOf: SizeOf, opts: LayoutOptions = {}): NodeMap {
  const nodes = cloneNodes(doc.nodes);
  const rootAnchor = opts.rootAnchor ?? { x: 0, y: 0 };

  // free-floating shapes (and their subtrees) live outside the tree layout
  // (MindFlow.dc.html:980-983)
  const freeRoots = Object.keys(nodes).filter((id) => {
    const n = nodes[id];
    return !!n && !!n.free && !n.parent;
  });
  const freeSet = new Set<string>();
  freeRoots.forEach((f) => {
    freeSet.add(f);
    descendants(f, nodes).forEach((d) => freeSet.add(d));
  });

  if (mode === 'down') {
    layoutDown(nodes, sizeOf);
  } else {
    layoutSided(nodes, mode, sizeOf);
  }

  // keep the root pinned to its anchor so adding nodes never shifts the
  // center (MindFlow.dc.html:1048-1052)
  const root = at(nodes, ROOT_ID);
  const dx = rootAnchor.x - root.x;
  const dy = rootAnchor.y - root.y;
  if (dx || dy) {
    for (const k in nodes) {
      if (freeSet.has(k)) continue;
      const n = nodes[k];
      if (!n) continue;
      n.x += dx;
      n.y += dy;
    }
  }

  // lay out each free shape's own subtree, anchored at the free shape's
  // position (MindFlow.dc.html:1053-1054)
  freeRoots.forEach((f) => layoutFreeSub(nodes, f, sizeOf));

  return nodes;
}

/** `mode === 'down'` (org-chart) branch of `_layout` (MindFlow.dc.html:984-1003). */
function layoutDown(nodes: NodeMap, sizeOf: SizeOf): void {
  // per-depth row positions honour the tallest node in each row
  const maxH: number[] = [];
  const scan = (id: string, depth: number): void => {
    maxH[depth] = Math.max(maxH[depth] ?? 0, sizeOf(at(nodes, id), depth).h);
    visKids(nodes, id).forEach((k) => scan(k, depth + 1));
  };
  scan(ROOT_ID, 0);
  const yC: number[] = [0];
  for (let dd = 1; dd < maxH.length; dd++) {
    yC[dd] = (yC[dd - 1] ?? 0) + (maxH[dd - 1] ?? 34) / 2 + 96 + (maxH[dd] ?? 34) / 2;
  }

  const cur = { v: 0 };
  const place = (id: string, depth: number): void => {
    const n = at(nodes, id);
    const ks = visKids(nodes, id);
    n.y = yC[depth] ?? 0;
    const w = sizeOf(n, depth).w;
    if (!ks.length) {
      n.x = cur.v + w / 2;
      cur.v += w + 46;
      return;
    }
    const startV = cur.v;
    const sub = [id, ...descendants(id, nodes).filter((d) => !at(nodes, d).free)];
    let f = 0;
    let l = 0;
    ks.forEach((k, i) => {
      place(k, depth + 1);
      const kx = at(nodes, k).x;
      if (i === 0) f = kx;
      l = kx;
    });
    n.x = (f + l) / 2;
    // a parent wider than its children span would poke LEFT of the previous
    // sibling → shift subtree right
    const left = n.x - w / 2;
    if (left < startV) {
      const shiftDx = startV - left;
      sub.forEach((sid) => {
        const sn = nodes[sid];
        if (sn) sn.x += shiftDx;
      });
    }
    cur.v = Math.max(cur.v, n.x + w / 2 + 46); // a wide parent also reserves room
  };
  place(ROOT_ID, 0);
}

/** `mode === 'radial' | 'right'` branch of `_layout` (MindFlow.dc.html:1004-1046). */
function layoutSided(nodes: NodeMap, mode: LayoutMode, sizeOf: SizeOf): void {
  // radial / right : each first-level branch is pinned to a side (R/L) that
  // persists, and each side is laid out + centered independently so adding
  // to one side never moves the other. Horizontal position is width-aware:
  // children clear their parent's actual edge.
  const hgap = 110;
  const rootW = sizeOf(at(nodes, ROOT_ID), 0).w;

  const place = (
    id: string,
    depth: number,
    sign: number,
    cur: { v: number },
    acc: string[],
    px: number,
    pw: number,
  ): void => {
    const n = at(nodes, id);
    acc.push(id);
    const ks = visKids(nodes, id);
    const m = sizeOf(n, depth);
    const w = m.w;
    const h = m.h;
    n.x = px + sign * (pw / 2 + hgap + w / 2);
    if (!ks.length) {
      n.y = cur.v + h / 2;
      cur.v += h + 30;
      return;
    }
    const startV = cur.v;
    const startIdx = acc.length;
    let f = 0;
    let l = 0;
    ks.forEach((k, i) => {
      place(k, depth + 1, sign, cur, acc, n.x, w);
      const ky = at(nodes, k).y;
      if (i === 0) f = ky;
      l = ky;
    });
    n.y = (f + l) / 2;
    // a parent taller than its children span would poke ABOVE the previous
    // sibling → shift the whole subtree down
    const top = n.y - h / 2;
    if (top < startV) {
      const shiftDy = startV - top;
      n.y += shiftDy;
      for (let i = startIdx; i < acc.length; i++) {
        const aid = acc[i];
        if (aid) at(nodes, aid).y += shiftDy;
      }
    }
    // …and reserve room below so the next sibling clears it
    cur.v = Math.max(cur.v, n.y + h / 2 + 30);
  };

  const layoutSide = (branches: string[], sign: number): void => {
    if (!branches.length) return;
    const cur = { v: 0 };
    const acc: string[] = [];
    branches.forEach((k) => place(k, 1, sign, cur, acc, 0, rootW));
    let mn = Infinity;
    let mx = -Infinity;
    acc.forEach((id) => {
      const y = at(nodes, id).y;
      mn = Math.min(mn, y);
      mx = Math.max(mx, y);
    });
    const c = (mn + mx) / 2;
    acc.forEach((id) => {
      at(nodes, id).y -= c;
    });
  };

  const kids = visKids(nodes, ROOT_ID);
  let R: string[];
  let L: string[];
  if (mode === 'right') {
    R = kids.slice();
    L = [];
  } else {
    // honor already-assigned sides; balance only the unassigned ones
    let rc = 0;
    let lc = 0;
    kids.forEach((k) => {
      const c = leafCount(nodes, k);
      const side = at(nodes, k).side;
      if (side === 'R') rc += c;
      else if (side === 'L') lc += c;
    });
    kids.forEach((k) => {
      const kn = at(nodes, k);
      if (kn.side !== 'R' && kn.side !== 'L') {
        const c = leafCount(nodes, k);
        if (rc <= lc) {
          kn.side = 'R';
          rc += c;
        } else {
          kn.side = 'L';
          lc += c;
        }
      }
    });
    R = kids.filter((k) => at(nodes, k).side === 'R');
    L = kids.filter((k) => at(nodes, k).side === 'L');
  }

  const root = at(nodes, ROOT_ID);
  root.x = 0;
  root.y = 0;
  layoutSide(R, 1);
  layoutSide(L, -1);
}

/** Port of `Component#layoutFreeSub` (MindFlow.dc.html:1056-1072). */
function layoutFreeSub(nodes: NodeMap, fid: string, sizeOf: SizeOf): void {
  const fnode = at(nodes, fid);
  if (!fnode.children.length) return;
  const hgap = 90;
  const pos: Record<string, { x: number; y: number }> = {};
  let cur = 0;
  const posAt = (id: string): { x: number; y: number } => {
    const p = pos[id];
    if (!p) throw new Error(`layoutFreeSub: missing pos for "${id}"`);
    return p;
  };
  const place = (id: string, depth: number, px: number, pw: number): void => {
    const ks = visKids(nodes, id);
    const m = sizeOf(at(nodes, id), depth + 1);
    const w = m.w;
    const h = m.h;
    pos[id] = { x: depth === 0 ? 0 : px + pw / 2 + hgap + w / 2, y: 0 };
    if (!ks.length) {
      posAt(id).y = cur + h / 2;
      cur += h + 26;
      return;
    }
    let f = 0;
    let l = 0;
    ks.forEach((k, i) => {
      place(k, depth + 1, posAt(id).x, w);
      const ky = posAt(k).y;
      if (i === 0) f = ky;
      l = ky;
    });
    posAt(id).y = (f + l) / 2;
    cur = Math.max(cur, posAt(id).y + h / 2 + 26);
  };
  place(fid, 0, 0, 0);
  const fpos = posAt(fid);
  const dx = fnode.x - fpos.x;
  const dy = fnode.y - fpos.y;
  for (const id in pos) {
    const n = nodes[id];
    const p = pos[id];
    if (n && p) {
      n.x = p.x + dx;
      n.y = p.y + dy;
    }
  }
}

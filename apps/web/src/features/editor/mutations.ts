// Structural + styling doc mutations for the editor — the React-port
// counterparts of `Component`'s tree/float/line/zone mutators
// (addChild/addSibling/deleteSel/setShape/setColor/... in MindFlow.dc.html).
//
// These are NOT `@mindflow/mindmap-core` concerns (the core only owns
// model/serialize/layout/geometry/history/markdown) — they are the app's own
// editing actions, exactly as the original keeps them on its `Component`
// controller rather than in a shared "engine". Every function here is a pure
// `(state) => state` transform so the hook stays easy to test and to wire into
// undo/redo. All of them build on `cloneNodes`/`descendants` from the core /
// tree helpers rather than re-deriving that logic.

import type { Float, Line, Node, NodeMap, OverlapBox, RichRun, Zone } from '@mindflow/mindmap-core';
import { ROOT_ID, cloneNodes, computeFreeNudge, stripRichStyle } from '@mindflow/mindmap-core';
import { descendants } from './tree';

// ---- id generation (port of `Component#newId`, MindFlow.dc.html:885 — a
// per-instance incrementing counter + timestamp suffix) ----
export type IdFactory = (prefix?: string) => string;

export function createIdFactory(): IdFactory {
  let uid = 0;
  return (prefix = 'x') => `${prefix}${++uid}_${Date.now().toString(36)}`;
}

// ---- node structural ops ----

/** Port of `Component#addChild` (MindFlow.dc.html:1898), minus the state/focus side effects. */
export function addChildNode(nodes: NodeMap, parentId: string, newId: string): NodeMap {
  const p = nodes[parentId];
  if (!p) return nodes;
  const out = cloneNodes(nodes);
  const op = out[parentId];
  if (!op) return nodes;
  if (op.collapsed) op.collapsed = false;
  out[newId] = { id: newId, text: '새 주제', emoji: '', parent: parentId, children: [], collapsed: false, color: null, x: op.x + 120, y: op.y };
  op.children.push(newId);
  return out;
}

/**
 * Port of `Component#addSibling` (MindFlow.dc.html:1908). Returns `null` when
 * `id` has no parent (the root) — callers should fall back to
 * `addChildNode(nodes, ROOT_ID, newId)`, matching the original's `if (!par) {
 * this.addChild(); return; }`.
 */
export function addSiblingNode(nodes: NodeMap, id: string, newId: string): NodeMap | null {
  const n = nodes[id];
  if (!n || !n.parent) return null;
  const out = cloneNodes(nodes);
  const on = out[id];
  const p = out[n.parent];
  if (!on || !p) return null;
  const idx = p.children.indexOf(id);
  const sibling: Node = { id: newId, text: '새 주제', emoji: '', parent: n.parent, children: [], collapsed: false, color: null, x: p.x, y: p.y };
  if (n.parent === ROOT_ID && (on.side === 'R' || on.side === 'L')) sibling.side = on.side;
  out[newId] = sibling;
  p.children.splice(idx + 1, 0, newId);
  return out;
}

/** Port of `Component#deleteSel` (MindFlow.dc.html:1921), minus the root guard (caller's job). */
export function deleteNodeSubtree(nodes: NodeMap, id: string): { nodes: NodeMap; nextSelected: string } | null {
  if (id === ROOT_ID) return null;
  const n = nodes[id];
  if (!n) return null;
  const out = cloneNodes(nodes);
  const par = out[id]?.parent ?? null;
  const rm = [id, ...descendants(out, id)];
  if (par && out[par]) out[par].children = out[par].children.filter((c) => c !== id);
  rm.forEach((r) => {
    delete out[r];
  });
  return { nodes: out, nextSelected: par || ROOT_ID };
}

/** Port of `Component#toggleCollapse` (MindFlow.dc.html:1930). */
export function toggleCollapseNode(nodes: NodeMap, id: string): NodeMap {
  const n = nodes[id];
  if (!n) return nodes;
  const out = cloneNodes(nodes);
  const on = out[id];
  if (on) on.collapsed = !on.collapsed;
  return out;
}

/** Port of `Component#addFreeNode` (MindFlow.dc.html:2122), minus the state/focus side effects. */
export function addFreeShapeNode(nodes: NodeMap, newId: string, x: number, y: number): NodeMap {
  const out = cloneNodes(nodes);
  out[newId] = { id: newId, text: '새 도형', emoji: '', parent: null, children: [], collapsed: false, color: null, free: true, x, y };
  return out;
}

/**
 * Detach a still-attached node from its parent and turn it into a free
 * shape at `(x, y)` — the drag-drop-far-enough branch of `Component#onUp`
 * (MindFlow.dc.html:1791-1797) combined with `Component#detachNode`
 * (MindFlow.dc.html:2164). Descendants are NOT repositioned here: `layout()`
 * re-derives their position from the new anchor via `layoutFreeSub` on the
 * next render, exactly as the original's own `_layout` call does.
 */
export function detachNodeToFree(nodes: NodeMap, id: string, x: number, y: number): NodeMap {
  const n = nodes[id];
  if (!n || !n.parent) return nodes;
  const out = cloneNodes(nodes);
  const on = out[id];
  const par = out[n.parent];
  if (!on) return nodes;
  if (par) par.children = par.children.filter((c) => c !== id);
  on.parent = null;
  on.free = true;
  delete on.side;
  on.x = x;
  on.y = y;
  return out;
}

/** Port of `Component#commitEdit` (MindFlow.dc.html:2049) — text-only, no layout call (caller relays out).
 * Still used by every editor OTHER than the node text box itself (outline row rename, float/line/zone
 * text) — none of those carry partial rich-text runs. */
export function commitNodeText(nodes: NodeMap, id: string, text: string): NodeMap {
  const n = nodes[id];
  if (!n) return nodes;
  const out = cloneNodes(nodes);
  const on = out[id];
  if (on) on.text = (text || '').trim() || '주제';
  return out;
}

/** Port of `Component#commitRichEdit` (MindFlow.dc.html:2629-2643) — the node text box's own
 * commit, carrying partial-style `rich` runs alongside `text` (`domToRuns`'s output, parsed from
 * the live `contentEditable` DOM by the caller). A blank (whitespace-only) commit resets BOTH
 * `text` and `rich` back to the plain placeholder, matching the original's `hasText` branch —
 * unlike `commitNodeText` above, which only trims (never resets to a placeholder mid-string). */
export function commitNodeRichText(nodes: NodeMap, id: string, text: string, rich: RichRun[] | null): NodeMap {
  const n = nodes[id];
  if (!n) return nodes;
  const out = cloneNodes(nodes);
  const on = out[id];
  if (!on) return out;
  const hasText = (text || '').trim().length > 0;
  on.text = hasText ? text.replace(/\s+$/, '') : '주제';
  on.rich = hasText ? rich : null;
  return out;
}

/** Port of `Component#commitTitle` (MindFlow.dc.html:778). */
export function commitRootTitle(nodes: NodeMap, text: string, fallback: string): NodeMap {
  const r = nodes[ROOT_ID];
  if (!r) return nodes;
  const out = cloneNodes(nodes);
  const or_ = out[ROOT_ID];
  if (or_) {
    const t = (text || '').trim();
    or_.text = t || fallback || '새 마인드맵';
  }
  return out;
}

/** Generic per-node field setter — backs setColor/setFill/setStroke/setTextColor/etc. */
export function setNodeField<K extends keyof Node>(nodes: NodeMap, id: string, key: K, value: Node[K]): NodeMap {
  const n = nodes[id];
  if (!n) return nodes;
  const out = cloneNodes(nodes);
  const on = out[id];
  if (on) on[key] = value;
  return out;
}

/** Port of `Component#onNodeResizeDown`/`onMove` 'node-resize' (MindFlow.dc.html:1613, 1670-1677). */
export function resizeNode(nodes: NodeMap, id: string, cw: number, ch: number): NodeMap {
  const n = nodes[id];
  if (!n) return nodes;
  const out = cloneNodes(nodes);
  const on = out[id];
  if (on) {
    on.cw = Math.max(40, cw);
    on.ch = Math.max(24, ch);
  }
  return out;
}

/** Port of `Component#resetNodeSize` (MindFlow.dc.html:1618). */
export function resetNodeSize(nodes: NodeMap, id: string): NodeMap {
  const n = nodes[id];
  if (!n) return nodes;
  const out = cloneNodes(nodes);
  const on = out[id];
  if (on) {
    delete on.cw;
    delete on.ch;
  }
  return out;
}

/** Move a free-standing shape (and, via `layout()`'s `layoutFreeSub`, its subtree) to `(x, y)`. */
export function moveFreeNode(nodes: NodeMap, id: string, x: number, y: number): NodeMap {
  const n = nodes[id];
  if (!n) return nodes;
  const out = cloneNodes(nodes);
  const on = out[id];
  if (on) {
    on.x = x;
    on.y = y;
  }
  return out;
}

/**
 * Magnet "don't overlap" nudge — shifts the free shape (subtree) rooted at `id`
 * clear of every other node box, using the core's pure `computeFreeNudge`. Sizes
 * come from `sizeOf` (the editor's live `geom`); positions from the nodes. Returns
 * the same `nodes` reference untouched when nothing needs to move, so callers can
 * fold it into an existing commit without forcing a spurious history entry.
 * Port of `Component#applyFreeNudge` (MindFlow.dc.html:2241-2245). `boxOf`
 * supplies each node's on-screen center + size (from `geom`) — positions must
 * come from the rendered geometry, not `doc.nodes` (tree nodes' doc x/y is 0).
 */
export function nudgeFreeNode(nodes: NodeMap, id: string, boxOf: (nodeId: string) => OverlapBox | null): NodeMap {
  const v = computeFreeNudge(id, nodes, boxOf);
  if (!v) return nodes;
  const out = cloneNodes(nodes);
  v.ids.forEach((nid) => {
    const on = out[nid];
    if (on) {
      on.x += v.dx;
      on.y += v.dy;
    }
  });
  return out;
}

// ---- bulk (multi-select) node ops — ports of `nodeTargets()`-driven setters
// (setColor/setFill/.../setEmoji, MindFlow.dc.html:2545-2555, 2730-2731) so a
// marquee multi-selection can apply one style change to every targeted node
// in a single undo step, exactly like the original. ----

/** Generic per-node bulk field setter — backs the multi-select property panel's
 * shape/color/fill/stroke/alpha/textColor setters (single selection is just the `ids.length === 1` case). */
export function setNodesField<K extends keyof Node>(nodes: NodeMap, ids: string[], key: K, value: Node[K]): NodeMap {
  const valid = ids.filter((id) => nodes[id]);
  if (!valid.length) return nodes;
  const out = cloneNodes(nodes);
  valid.forEach((id) => {
    const on = out[id];
    if (on) on[key] = value;
  });
  return out;
}

/** Port of `Component#toggleNodeBold` (MindFlow.dc.html:2730) — bulk-aware: flips every
 * target relative to the FIRST target's current value (matches the original's `nodeTargets()[0]`).
 * Also strips any conflicting PARTIAL bold runs off each target (`stripRich(n, 'b')`,
 * MindFlow.dc.html:2727, 2730) so a whole-node bold toggle can't leave a stray bold run that
 * would otherwise still render bold even after the node-level bold is turned back off (or look
 * indistinguishable from the whole-node bold once it's turned on). */
export function toggleNodesBold(nodes: NodeMap, ids: string[]): NodeMap {
  const valid = ids.filter((id) => nodes[id]);
  const first = valid[0];
  if (!first) return nodes;
  const cur = !!nodes[first]?.bold;
  const out = cloneNodes(nodes);
  valid.forEach((id) => {
    const on = out[id];
    if (on) {
      on.bold = !cur;
      on.rich = stripRichStyle(on.rich, 'b');
    }
  });
  return out;
}

/** Port of `Component#setEmoji` (MindFlow.dc.html:2555) — per-id toggle (unlike bold, each
 * node's emoji toggles independently against ITS OWN current value, not the first target's). */
export function toggleNodesEmoji(nodes: NodeMap, ids: string[], emoji: string): NodeMap {
  const valid = ids.filter((id) => nodes[id]);
  if (!valid.length) return nodes;
  const out = cloneNodes(nodes);
  valid.forEach((id) => {
    const on = out[id];
    if (on) on.emoji = on.emoji === emoji ? '' : emoji;
  });
  return out;
}

// ---- bulk (multi-select) float / line ops — ports of `applyFloatText`/`applyLineText`
// (MindFlow.dc.html:2733, 2738), which the original ALSO applies uniformly via
// `floatTargets()`/`lineTargets()` regardless of single vs. multi selection. ----

export function updateFloatItems(floats: Float[], ids: string[], patch: Partial<Float>): Float[] {
  return floats.map((f) => (ids.includes(f.id) ? { ...f, ...patch } : f));
}
export function updateLineItems(lines: Line[], ids: string[], patch: Partial<Line>): Line[] {
  return lines.map((l) => (ids.includes(l.id) ? { ...l, ...patch } : l));
}

// ---- multi-select bulk delete — port of `Component#deleteMulti` (MindFlow.dc.html:1595). ----

/** Removes every targeted node's subtree (skipping the root, same guard as `deleteNodeSubtree`). */
export function deleteNodesMulti(nodes: NodeMap, ids: string[]): NodeMap {
  const out = cloneNodes(nodes);
  ids.forEach((id) => {
    if (id === ROOT_ID || !out[id]) return;
    const par = out[id]?.parent ?? null;
    const rm = [id, ...descendants(out, id)];
    if (par && out[par]) out[par].children = out[par].children.filter((c) => c !== id);
    rm.forEach((r) => {
      delete out[r];
    });
  });
  return out;
}

// ---- multi-select group translate — port of `Component#startGroupDrag`'s `onMove` 'group'
// branch (MindFlow.dc.html:1706-1713). NOTE: only FREE root nodes carry a meaningful `x`/`y`
// in this port's architecture (`layout()` recomputes every attached tree node's position from
// scratch on every render — see `layout.ts`'s doc comment — so setting `x`/`y` on an attached
// node here would be silently overwritten the moment the resulting doc change re-runs layout).
// Group-drag therefore only translates free-standing nodes/floats/lines; attached tree nodes
// caught in a marquee selection are still multi-selected/multi-deletable, just not multi-draggable
// — a deliberate, documented deviation from the original (tracked in the Editor-c report). */
export function translateNodesBy(nodes: NodeMap, orig: Record<string, { x: number; y: number }>, dx: number, dy: number): NodeMap {
  const ids = Object.keys(orig).filter((id) => nodes[id]);
  if (!ids.length) return nodes;
  const out = cloneNodes(nodes);
  ids.forEach((id) => {
    const o = orig[id];
    const on = out[id];
    if (on && o) {
      on.x = o.x + dx;
      on.y = o.y + dy;
    }
  });
  return out;
}
export function translateFloatsBy(floats: Float[], orig: Record<string, { x: number; y: number }>, dx: number, dy: number): Float[] {
  return floats.map((f) => (orig[f.id] ? { ...f, x: orig[f.id]!.x + dx, y: orig[f.id]!.y + dy } : f));
}
export function translateLinesBy(lines: Line[], orig: Record<string, { x1: number; y1: number; x2: number; y2: number }>, dx: number, dy: number): Line[] {
  return lines.map((l) => (orig[l.id] ? { ...l, x1: orig[l.id]!.x1 + dx, y1: orig[l.id]!.y1 + dy, x2: orig[l.id]!.x2 + dx, y2: orig[l.id]!.y2 + dy } : l));
}

// ---- drag-drop reparenting — port of `Component#attachFreeNode` (MindFlow.dc.html:2132),
// used for BOTH the free→attach case and the attached→re-parent case (the original also
// reuses one function for both: any non-root node dropped onto another node's drop-zone). ----

export type AttachZone = 'child' | 'above' | 'below';

/** Returns `null` on a no-op (missing ids, self-drop, or a would-be cycle — dropping a node onto
 * its own descendant), matching the original's early-return guards. */
export function reattachNode(nodes: NodeMap, id: string, targetId: string, zone: AttachZone): NodeMap | null {
  const n = nodes[id];
  const t = nodes[targetId];
  if (!n || !t) return null;
  if (id === targetId) return null;
  if (descendants(nodes, id).includes(targetId)) return null;
  const out = cloneNodes(nodes);
  const on = out[id];
  const ot = out[targetId];
  if (!on || !ot) return null;
  if (on.parent && out[on.parent]) out[on.parent]!.children = out[on.parent]!.children.filter((c) => c !== id);
  delete on.free;
  if (zone === 'child' || !ot.parent) {
    on.parent = targetId;
    ot.children.push(id);
    if (ot.collapsed) ot.collapsed = false;
    if (ot.side) on.side = ot.side;
  } else {
    const parId = ot.parent;
    const par = parId ? out[parId] : undefined;
    if (!par) return null;
    on.parent = parId ?? null;
    const idx = par.children.indexOf(targetId);
    par.children.splice(zone === 'above' ? idx : idx + 1, 0, id);
    if (ot.side) on.side = ot.side;
  }
  // NOTE: the original also nudges every OTHER free shape clear of the re-laid-out tree in the
  // same update (MindFlow.dc.html:2155, `applyFreeNudge`) — out of scope here (already deferred
  // in Editor-b's own free-shape-overlap notes); a reattach may leave free shapes overlapping.
  return out;
}

// ---- outline indent / outdent — port of `Component#outlineIndent`/`#outlineOutdent`
// (MindFlow.dc.html:1961, 1970). ----

/** Makes `id` a child of its immediately-preceding sibling (Tab in the outline editor). */
export function outlineIndentNode(nodes: NodeMap, id: string): NodeMap {
  const n = nodes[id];
  if (!n || !n.parent) return nodes;
  const p = nodes[n.parent];
  if (!p) return nodes;
  const idx = p.children.indexOf(id);
  if (idx <= 0) return nodes;
  const prevId = p.children[idx - 1];
  if (!prevId || !nodes[prevId]) return nodes;
  const out = cloneNodes(nodes);
  const op = out[n.parent];
  const on = out[id];
  const oprev = out[prevId];
  if (!op || !on || !oprev) return nodes;
  op.children.splice(idx, 1);
  on.parent = prevId;
  oprev.collapsed = false;
  oprev.children.push(id);
  delete on.side;
  return out;
}

/** Promotes `id` to be a sibling of its parent, right after it (Shift+Tab in the outline editor). */
export function outlineOutdentNode(nodes: NodeMap, id: string): NodeMap {
  const n = nodes[id];
  if (!n || !n.parent) return nodes;
  const p = nodes[n.parent];
  if (!p || !p.parent) return nodes; // a direct child of the root can't outdent
  const gp = nodes[p.parent];
  if (!gp) return nodes;
  const out = cloneNodes(nodes);
  const op = out[n.parent];
  const on = out[id];
  const ogp = out[p.parent];
  if (!op || !on || !ogp) return nodes;
  op.children = op.children.filter((c) => c !== id);
  on.parent = ogp.id;
  const pidx = ogp.children.indexOf(op.id);
  ogp.children.splice(pidx + 1, 0, id);
  if (ogp.id === ROOT_ID && (op.side === 'R' || op.side === 'L')) on.side = op.side;
  return out;
}

// ---- floats ----

export function addFloatItem(floats: Float[], id: string, x: number, y: number): Float[] {
  return [...floats, { id, x, y, w: 180, text: '' }];
}
export function updateFloatItem(floats: Float[], id: string, patch: Partial<Float>): Float[] {
  return floats.map((f) => (f.id === id ? { ...f, ...patch } : f));
}
export function removeFloatItem(floats: Float[], id: string): Float[] {
  return floats.filter((f) => f.id !== id);
}

// ---- lines ----

export function addLineItem(lines: Line[], id: string, x1: number, y1: number, x2: number, y2: number): Line[] {
  return [...lines, { id, x1, y1, x2, y2, startArrow: false, endArrow: true, dashed: true, c1: 0, c2: 0, label: '' }];
}
export function updateLineItem(lines: Line[], id: string, patch: Partial<Line>): Line[] {
  return lines.map((l) => (l.id === id ? { ...l, ...patch } : l));
}
export function removeLineItem(lines: Line[], id: string): Line[] {
  return lines.filter((l) => l.id !== id);
}

// ---- zones ----

export function addZoneItem(zones: Zone[], id: string, x: number, y: number): Zone[] {
  return [...zones, { id, x, y, w: 340, h: 220, label: '영역', color: null }];
}
export function updateZoneItem(zones: Zone[], id: string, patch: Partial<Zone>): Zone[] {
  return zones.map((z) => (z.id === id ? { ...z, ...patch } : z));
}
export function removeZoneItem(zones: Zone[], id: string): Zone[] {
  return zones.filter((z) => z.id !== id);
}

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

import type { Float, Line, Node, NodeMap, Zone } from '@mindflow/mindmap-core';
import { ROOT_ID, cloneNodes } from '@mindflow/mindmap-core';
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

/** Port of `Component#commitEdit` (MindFlow.dc.html:2049) — text-only, no layout call (caller relays out). */
export function commitNodeText(nodes: NodeMap, id: string, text: string): NodeMap {
  const n = nodes[id];
  if (!n) return nodes;
  const out = cloneNodes(nodes);
  const on = out[id];
  if (on) on.text = (text || '').trim() || '주제';
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

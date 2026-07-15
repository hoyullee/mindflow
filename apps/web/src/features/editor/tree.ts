// Small pure tree-view helpers used only for rendering (visible-node ordering,
// per-node accent color). These are NOT layout/serialize/geometry — those
// live in `@mindflow/mindmap-core` and are consumed as-is — but rather thin,
// render-local bookkeeping ported from the original controller so the render
// output matches pixel-for-pixel.
//
// Ports of `Component#buildVisible` / `#colorOf` / `#visKids` / `#descendants`
// (MindFlow.dc.html:889, 1075-1087).

import type { LayoutMode, Node, NodeMap } from '@mindflow/mindmap-core';
import { ROOT_ID } from '@mindflow/mindmap-core';
import type { Theme } from './theme';

export interface VisibleEntry {
  id: string;
  depth: number;
}

/** Port of `Component#visKids` (MindFlow.dc.html:889). */
export function visKids(nodes: NodeMap, id: string): string[] {
  const n = nodes[id];
  if (!n) return [];
  return n.collapsed ? [] : n.children.filter((c) => !!nodes[c]);
}

/** Port of `Component#descendants` (MindFlow.dc.html:888, unfiltered by collapse). */
export function descendants(nodes: NodeMap, id: string): string[] {
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

/**
 * Port of `Component#buildVisible` (MindFlow.dc.html:1075): a depth-first walk
 * from the root (respecting `collapsed`), plus each free-standing shape (and
 * its own subtree) at a flat depth of 1.
 */
export function buildVisible(nodes: NodeMap): VisibleEntry[] {
  const out: VisibleEntry[] = [];
  const walk = (id: string, depth: number): void => {
    const n = nodes[id];
    if (!n) return;
    out.push({ id, depth });
    if (!n.collapsed) n.children.forEach((c) => walk(c, depth + 1));
  };
  walk(ROOT_ID, 0);
  for (const id in nodes) {
    const n = nodes[id];
    if (n?.free && !n.parent) walk(id, 1);
  }
  return out;
}

/** Port of `Component#colorOf` (MindFlow.dc.html:1076-1087). */
export function colorOf(id: string, nodes: NodeMap, theme: Theme): string {
  if (id === ROOT_ID) return theme.accent;
  let cur: Node | undefined = nodes[id];
  const chain: Node[] = [];
  while (cur && cur.parent) {
    chain.push(cur);
    cur = nodes[cur.parent];
  }
  if (cur && cur.id !== ROOT_ID) chain.push(cur); // free-standing shape: include its own root
  for (const c of chain) if (c.color) return c.color;
  const d1 = chain[chain.length - 1];
  if (!d1) return theme.palette[0] ?? theme.accent;
  const root = nodes[ROOT_ID];
  const idx = root ? root.children.indexOf(d1.id) : -1;
  const palette = theme.palette;
  return palette[(idx < 0 ? 0 : idx) % palette.length] ?? theme.accent;
}

export interface OutlineRow {
  id: string;
  depth: number;
}

/**
 * Port of `Component#outlineRows` (MindFlow.dc.html:1936-1943): a depth-first
 * walk from the root respecting `collapsed`, then each free-standing shape (and
 * its own subtree) at a flat depth of 1 — used by both the outline view's row
 * order and its keyboard ArrowUp/ArrowDown navigation.
 */
export function outlineRows(nodes: NodeMap): OutlineRow[] {
  const rows: OutlineRow[] = [];
  const walk = (id: string, depth: number): void => {
    const n = nodes[id];
    if (!n) return;
    rows.push({ id, depth });
    if (!n.collapsed) n.children.forEach((c) => walk(c, depth + 1));
  };
  walk(ROOT_ID, 0);
  for (const id in nodes) {
    const n = nodes[id];
    if (n?.free && !n.parent) walk(id, 1);
  }
  return rows;
}

/** Port of `Component#depthOf` (MindFlow.dc.html:887). */
export function depthOf(nodes: NodeMap, id: string): number {
  let d = 0;
  let n = nodes[id];
  while (n?.parent) {
    d++;
    n = nodes[n.parent];
  }
  return d;
}

export const LAYOUT_MODES: { k: LayoutMode; label: string }[] = [
  { k: 'radial', label: '방사형' },
  { k: 'right', label: '오른쪽' },
  { k: 'down', label: '조직도' },
];

export type EdgeStyle = 'curve' | 'elbow' | 'straight';

export const EDGE_MODES: { k: EdgeStyle; label: string }[] = [
  { k: 'curve', label: '곡선' },
  { k: 'elbow', label: '꺾은선' },
  { k: 'straight', label: '직선' },
];

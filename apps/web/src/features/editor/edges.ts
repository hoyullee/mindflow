// Parent → child connector geometry (elbow/curve/straight SVG paths) — port of
// the tree-edge branch of `Component#renderCanvas` (MindFlow.dc.html:1096-1133).
//
// This is render-coupled path-string generation, not pure math (unlike
// `resolveLineGeometry`/`cubicAt`/`portPoint` in `@mindflow/mindmap-core`,
// which this module leaves untouched) — it belongs in the web layer per the
// M3-Editor-a task notes.

import type { LayoutMode } from '@mindflow/mindmap-core';
import type { EdgeStyle } from './tree';

export interface EdgeBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const ELBOW_RADIUS = 12;

/**
 * Port of the per-edge `d` computation inside `renderCanvas`
 * (MindFlow.dc.html:1101-1131). `parentInsetX`/`childInsetX` reproduce
 * `edgeInX()` (MindFlow.dc.html:1100): parallelogram shapes' visible slanted
 * edge sits inside the bounding box, so connectors must land on it instead of
 * the box edge.
 */
export function buildEdgePath(
  mode: LayoutMode,
  edgeStyle: EdgeStyle,
  parent: EdgeBox,
  child: EdgeBox,
  parentInsetX = 0,
  childInsetX = 0,
): string {
  if (mode === 'down') {
    const py = parent.y + parent.h / 2;
    const cy = child.y - child.h / 2;
    if (edgeStyle === 'straight') return `M ${parent.x} ${py} L ${child.x} ${cy}`;
    if (edgeStyle === 'elbow') {
      const ty = py + Math.min(30, Math.abs(cy - py) / 2);
      const r = Math.min(ELBOW_RADIUS, Math.abs(child.x - parent.x), Math.abs(cy - ty));
      const sgn = child.x >= parent.x ? 1 : -1;
      if (Math.abs(child.x - parent.x) < 1) return `M ${parent.x} ${py} L ${child.x} ${cy}`;
      return `M ${parent.x} ${py} L ${parent.x} ${ty} L ${child.x - sgn * r} ${ty} Q ${child.x} ${ty} ${child.x} ${ty + r} L ${child.x} ${cy}`;
    }
    // Curve: keep the horizontal sweep HIGH in the row gap (the layout guarantees
    // a ≥96px gap between a parent's bottom and every child's top), then drop
    // vertically into the child at its own column. A midpoint control point used
    // to let the curve dip into the shared child row and pass BEHIND a tall/wide
    // sibling whose box extends up toward the parent; hugging the gap avoids that
    // and reads as a proper org-chart connector (short bend under the parent,
    // vertical drop into the child).
    const by = py + Math.min(40, Math.abs(cy - py) / 2);
    return `M ${parent.x} ${py} C ${parent.x} ${by} ${child.x} ${by} ${child.x} ${cy}`;
  }

  const rightSide = child.x >= parent.x;
  const px = parent.x + (rightSide ? parent.w / 2 - parentInsetX : -(parent.w / 2 - parentInsetX));
  const cx = child.x + (rightSide ? -(child.w / 2 - childInsetX) : child.w / 2 - childInsetX);
  const mx = (px + cx) / 2;
  if (edgeStyle === 'straight') return `M ${px} ${parent.y} L ${cx} ${child.y}`;
  if (edgeStyle === 'elbow') {
    const tx = px + (rightSide ? 1 : -1) * Math.min(40, Math.abs(cx - px) / 2);
    const r = Math.min(ELBOW_RADIUS, Math.abs(child.y - parent.y), Math.abs(cx - tx));
    const sgnX = cx >= px ? 1 : -1;
    const sgnY = child.y >= parent.y ? 1 : -1;
    if (Math.abs(child.y - parent.y) < 1) return `M ${px} ${parent.y} L ${cx} ${child.y}`;
    return `M ${px} ${parent.y} L ${tx} ${parent.y} L ${tx} ${child.y - sgnY * r} Q ${tx} ${child.y} ${tx + sgnX * r} ${child.y} L ${cx} ${child.y}`;
  }
  return `M ${px} ${parent.y} C ${mx} ${parent.y} ${mx} ${child.y} ${cx} ${child.y}`;
}

/** Port of the per-edge stroke width (MindFlow.dc.html:1104). */
export function edgeStrokeWidth(depth: number): number {
  return Math.max(1.8, 4 - depth * 0.6);
}

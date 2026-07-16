import type { NodeMetrics } from './metrics';

/** A visible node's resolved on-screen box — layout position + metrics. */
export interface NodeGeom extends NodeMetrics {
  x: number;
  y: number;
  depth: number;
}

export type GeomMap = Record<string, NodeGeom>;

export type ViewMode = 'map' | 'outline';

export interface PanState {
  x: number;
  y: number;
}

/** What the property panel (and Delete/F2/Tab/Enter) currently targets. */
export type SelectionKind = 'node' | 'float' | 'line' | 'zone';

export interface Selection {
  kind: SelectionKind;
  id: string;
}

/** Doc-chip save indicator — port of `Component#state.saveState` (MindFlow.dc.html:502). */
export type SaveState = 'saved' | 'dirty' | 'saving';

/** Which endpoint/curvature handle a line drag targets — 1 = start, 2 = end. */
export type LineHandle = 1 | 2;

/** Marquee (rubber-band) multi-selection — port of `Component#state.msel`
 * (MindFlow.dc.html:577, 1548-1556): zones are intentionally excluded, matching
 * the original (zones are never part of `msel`). */
export interface MultiSelection {
  nodes: string[];
  lines: string[];
  floats: string[];
}

/** In-progress marquee rectangle, in canvas (untransformed) coordinates. */
export interface MarqueeRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The drop target a dragged node is currently hovering — port of `Component#_attachHi`
 * (MindFlow.dc.html:1752, `findAttachTarget`'s return shape). */
export interface AttachTarget {
  id: string;
  zone: 'child' | 'above' | 'below';
}

/** What a right-click hit-tested — port of `Component#hitTestAll`'s return shape
 * (MindFlow.dc.html:2815-2836). Priority mirrors the visual stacking: float > zone > line > node. */
export interface HitResult {
  kind: 'node' | 'float' | 'line' | 'zone';
  id: string;
}

/** The right-click context menu's kind — port of `Component#state.ctxMenu.kind`
 * (MindFlow.dc.html:2792-2813): which object (if any) the click landed on, resolved
 * BEFORE the menu opens (`openCtxAt` also selects that object as a side effect,
 * except for `'bg'`/`'multi'`, matching the original). */
export type ContextMenuKind = 'node' | 'float' | 'line' | 'zone' | 'multi' | 'bg';

/** Right-click context menu state — port of `Component#state.ctxMenu`
 * (MindFlow.dc.html:2792-2813, 3101-3146). `sx/sy` are screen (viewport-relative)
 * coordinates used to position the menu; `cx/cy` are canvas (untransformed)
 * coordinates, used by the `'bg'` kind's "추가" items to place the new object at
 * the exact spot that was right-clicked. */
export interface ContextMenuState {
  kind: ContextMenuKind;
  sx: number;
  sy: number;
  cx: number;
  cy: number;
}

/** The "텍스트 정렬 ▸" flyout submenu's own open/position state — port of
 * `Component#state.ctxSub` (MindFlow.dc.html:3120, 3149-3155). `top` is the
 * parent row's `offsetTop`, used to vertically anchor the flyout next to it. */
export interface ContextSubState {
  top: number;
}

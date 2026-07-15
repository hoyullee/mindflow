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

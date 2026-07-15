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

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

// Serialization core — ports of `serializeDoc()` / `loadDoc()` / `cloneNodes()`
// from `MindFlow.dc.html`. Pure, no localStorage: callers own persistence.

import type { Doc, Float, Line, LayoutMode, NodeMap, Zone } from './model';
import { DEFAULT_LAYOUT_MODE, DEFAULT_THEME_KEY } from './model';

/**
 * The subset of app state `serializeDoc()` reads from (MindFlow.dc.html:534-536).
 * `zones` is nullable here because the original reads `this.state.zones || []`
 * (some older/legacy states may not have a `zones` array yet).
 */
export interface SerializableState {
  nodes: NodeMap;
  floats: Float[];
  lines: Line[];
  zones?: Zone[] | null;
  layoutMode: LayoutMode;
  themeKey: string;
}

/**
 * Port of `Component#serializeDoc` (MindFlow.dc.html:534-536).
 *
 * Note the original does not deep-clone: it returns direct references to
 * live state arrays/objects. This function preserves that behavior — callers
 * who need an isolated snapshot should clone before mutating further.
 */
export function serializeDoc(state: SerializableState): Doc {
  return {
    v: 1,
    nodes: state.nodes,
    floats: state.floats,
    lines: state.lines,
    zones: state.zones ?? [],
    layoutMode: state.layoutMode,
    themeKey: state.themeKey,
  };
}

/**
 * Port of `Component#loadDoc` (MindFlow.dc.html:792-808), minus the
 * localStorage read and `this.setState` merge (which required pre-existing
 * component state to fall back on). Since a pure function has no prior
 * state to merge into, missing optional arrays default to `[]` and missing
 * `layoutMode`/`themeKey` fall back to the same constants `buildInitial()`
 * uses for a fresh document (MindFlow.dc.html:495-496, 522-523).
 *
 * Returns `null` when `raw` is not an object or has no truthy `nodes` field,
 * mirroring the original's `if (!d || !d.nodes) return false;` guard
 * (MindFlow.dc.html:795).
 *
 * Open question (see M1a report): the original also reads `d.needsLayout`
 * (MindFlow.dc.html:804) to decide whether to run `_layout` once after an
 * import. That flag is not part of the `Doc` schema (README) and is a
 * layout-milestone concern, so it is intentionally NOT reproduced here.
 */
export function parseDoc(raw: unknown): Doc | null {
  if (raw === null || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  if (!d.nodes) return null;

  const nodes = d.nodes as NodeMap;
  const floats = Array.isArray(d.floats) ? (d.floats as Float[]) : [];
  const lines = Array.isArray(d.lines) ? (d.lines as Line[]) : [];
  const zones = Array.isArray(d.zones) ? (d.zones as Zone[]) : [];
  const layoutMode = (d.layoutMode as LayoutMode | undefined) || DEFAULT_LAYOUT_MODE;
  const themeKey = (d.themeKey as string | undefined) || DEFAULT_THEME_KEY;

  return { v: 1, nodes, floats, lines, zones, layoutMode, themeKey };
}

/**
 * Port of `Component#cloneNodes` (MindFlow.dc.html:884):
 * `() => { const o = {}; const n = this.state.nodes; for (const k in n) o[k] = { ...n[k], children: [...n[k].children] }; return o; }`
 *
 * This is a SHALLOW per-node clone: only the top-level node object and its
 * `children` array are copied. Nested structures such as `rich` runs are
 * NOT deep-cloned — they remain shared references with the input, exactly
 * as in the original.
 */
export function cloneNodes(nodes: NodeMap): NodeMap {
  const out: NodeMap = {};
  for (const id in nodes) {
    const n = nodes[id];
    if (!n) continue;
    out[id] = { ...n, children: [...n.children] };
  }
  return out;
}

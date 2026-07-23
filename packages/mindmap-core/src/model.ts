// Pure data-model types for the MindFlow document.
//
// These mirror the JSON shapes the original dc prototype
// (`MindFlow.dc.html`) reads/writes via `serializeDoc()` / `loadDoc()` —
// see `packages/mindmap-core/test/fixtures/README.md` for the fixture-backed
// schema description this file is derived from.
//
// Scope note (M1a): this file intentionally does NOT model layout-only
// concerns beyond passthrough fields. `side` is written by `_layout`
// (MindFlow.dc.html:977) but nodes may already carry it in a previously
// laid-out, persisted doc, so it is typed here as an optional passthrough
// field even though M1a does not compute it.

import type { PortSide } from './geometry';

/** The three layout algorithms the original app supports (MindFlow.dc.html:496,522-523 default 'radial'). */
export type LayoutMode = 'radial' | 'right' | 'down';

/** Connector (edge) rendering style — the Style menu's 연결선 option
 * (MindFlow.dc.html:463, 1097). Persisted with the doc, like `layoutMode`. */
export type EdgeStyle = 'curve' | 'elbow' | 'straight';

/**
 * One styled text run inside a node's rich-text body.
 * Observed shape: `{ t: text, b?: bold, c?: color }` (MindFlow.dc.html:2612, 2646, 2727).
 */
export interface RichRun {
  t: string;
  b?: boolean;
  c?: string | null;
}

/**
 * A mind-map node (tree node, or a "free" standalone shape when `free: true`).
 *
 * Required fields observed on every node in `serializeDoc()` output
 * (MindFlow.dc.html:491, 505, 534): id/text/emoji/parent/children/collapsed/color/x/y.
 * Everything else is optional styling/content state set by various mutators
 * throughout the controller (see the mapping table in the M1a extraction report).
 */
export interface Node {
  id: string;
  text: string;
  emoji: string;
  parent: string | null;
  children: string[];
  collapsed: boolean;
  color: string | null;
  x: number;
  y: number;

  /** Marks a standalone ("free") shape not part of the root tree (MindFlow.dc.html:101 fixture, 1081). */
  free?: boolean;
  /** Rich-text runs; `null` clears back to plain `text` (MindFlow.dc.html:2612, 2727). */
  rich?: RichRun[] | null;
  bold?: boolean;
  /** Font-size override: 's' small / 'l' large (MindFlow.dc.html:2731 setNodeTsize, render 689/919/2978). */
  tsize?: 's' | 'l';
  shape?: string;
  align?: string;
  fill?: string | null;
  stroke?: string | null;
  fillA?: number;
  strokeA?: number;
  textColor?: string | null;
  note?: string;
  /** User-resized width/height override, cleared via `delete` when unset (MindFlow.dc.html:1620, 1674-1675). */
  cw?: number;
  ch?: number;
  /** Which side of the root a node landed on; written by `_layout`, out of scope for M1a. */
  side?: 'L' | 'R';
}

export type NodeMap = Record<string, Node>;

/** A free-floating memo card (MindFlow.dc.html:2258). */
export interface Float {
  id: string;
  x: number;
  y: number;
  w: number;
  text: string;

  /** User-resized height (MindFlow.dc.html:1681 float-resize drag). */
  h?: number;
  /** Collapsed memo (MindFlow.dc.html:2284 toggleFloatCollapse, render 644). */
  collapsed?: boolean;
  /** Background color override (MindFlow.dc.html:2737 setFloatBg). */
  bg?: string;
  /** Bold text (MindFlow.dc.html:2734 toggleFloatBold). */
  bold?: boolean;
  /** Text color override (MindFlow.dc.html:2736 setFloatTextColor). */
  textColor?: string;
  /** Font-size override: 's' small / 'l' large (MindFlow.dc.html:2735 setFloatTsize). */
  tsize?: 's' | 'l';
  /**
   * Image float (post-dc extension, not in the original prototype): a data
   * URL. When set the float renders as an image card (w×h box, aspect kept
   * by the editor) instead of a memo — text/collapse/bold styling fields are
   * ignored by renderers. Stored inline in the doc (client-side resized at
   * attach time) so save/sync/offline/export all work unchanged; absent on
   * every pre-existing doc, so serialization stays a pure passthrough.
   */
  img?: string;
}

/**
 * A free connector line's "magnetic" endpoint anchor — port of the shape
 * `findSnap()`/`onLineEndDown` build and `resolveEnd()` consumes
 * (MindFlow.dc.html:2403-2419, 2442-2454): which target (a tree/free node's
 * `_geom` box, or a float's box) an endpoint is pinned to, and optionally
 * which of its 4 ports (side). `side` is omitted for legacy anchors that
 * predate the port system — `resolveEnd` falls back to a border-point toward
 * the other end for those (MindFlow.dc.html:2408-2412).
 */
export interface LineAnchor {
  kind: 'node' | 'float';
  id: string;
  side?: PortSide;
}

/** A connector line between arbitrary points/nodes (MindFlow.dc.html:2460). */
export interface Line {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  startArrow: boolean;
  endArrow: boolean;
  dashed: boolean;
  c1: number;
  c2: number;
  label: string;

  /** Line color override; falls back to theme accent (MindFlow.dc.html:701 render). */
  color?: string;
  /** Legacy single-curvature field, migrated into c1/c2 on read (MindFlow.dc.html:1743, 2421-2422). */
  curve?: number;
  /** Label text color override (MindFlow.dc.html:2741 setLineTextColor). */
  ltextColor?: string;
  /** Bold label (MindFlow.dc.html:2739 toggleLineBold). */
  lbold?: boolean;
  /** Label font-size override: 's' small / 'l' large (MindFlow.dc.html:2740 setLineTsize). */
  lsize?: 's' | 'l';
  /**
   * Magnetic anchor for endpoint 1/2 — `x1/y1`/`x2/y2` remain the raw
   * last-dropped coordinates (used when unanchored, or as a fallback when the
   * anchor target vanishes); when set, the endpoint's actual on-screen
   * position is resolved from the target box instead (`resolveEnd`,
   * MindFlow.dc.html:2403-2412). `null` explicitly means "detached" (a drag
   * that ended away from any port), distinct from `undefined` (never
   * anchored) — both render as a plain raw-coordinate endpoint.
   */
  a1?: LineAnchor | null;
  a2?: LineAnchor | null;
}

/** A background grouping rectangle (MindFlow.dc.html:2300). */
export interface Zone {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  color: string | null;
}

/**
 * The full serializable document, matching `serializeDoc()` 1:1
 * (MindFlow.dc.html:534-536).
 */
export interface Doc {
  v: 1;
  nodes: NodeMap;
  floats: Float[];
  lines: Line[];
  zones: Zone[];
  layoutMode: LayoutMode;
  themeKey: string;
  /** Connector style. Optional so hand-built `Doc` literals need not set it;
   * `serializeDoc`/`parseDoc` always normalize it to a concrete value. */
  edgeStyle?: EdgeStyle;
}

/**
 * The root node id is a fixed constant in the original app
 * (`this.rootId = 'root'`, MindFlow.dc.html:467) — it is never persisted or
 * derived, just hardcoded once at construction time.
 */
export const ROOT_ID = 'root';

/** Default layoutMode applied when a loaded doc omits it (MindFlow.dc.html:496, 522-523). */
export const DEFAULT_LAYOUT_MODE: LayoutMode = 'radial';

/** Default connector style when a loaded doc omits it (MindFlow.dc.html:497, 524). */
export const DEFAULT_EDGE_STYLE: EdgeStyle = 'curve';

/** Default themeKey applied when a loaded doc omits it (MindFlow.dc.html:495, 522). */
export const DEFAULT_THEME_KEY = 'coral';

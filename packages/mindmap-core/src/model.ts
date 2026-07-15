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

/** The three layout algorithms the original app supports (MindFlow.dc.html:496,522-523 default 'radial'). */
export type LayoutMode = 'radial' | 'right' | 'down';

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
}

/**
 * The root node id is a fixed constant in the original app
 * (`this.rootId = 'root'`, MindFlow.dc.html:467) — it is never persisted or
 * derived, just hardcoded once at construction time.
 */
export const ROOT_ID = 'root';

/** Default layoutMode applied when a loaded doc omits it (MindFlow.dc.html:496, 522-523). */
export const DEFAULT_LAYOUT_MODE: LayoutMode = 'radial';

/** Default themeKey applied when a loaded doc omits it (MindFlow.dc.html:495, 522). */
export const DEFAULT_THEME_KEY = 'coral';

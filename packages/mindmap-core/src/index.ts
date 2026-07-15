// @mindflow/mindmap-core — the framework-agnostic mind-map engine.
//
// This package is the crown jewel (see docs/architecture/0001-architecture.md).
// It is PURE TypeScript: no DOM, React, network, or storage imports. Platform
// concerns arrive through injected ports (TextMeasurer, Clock, IdGen, DocStore).
// The core-purity ESLint rule (eslint.config.mjs) fails CI on any such import.
//
// M1a: data model, serialization (parseDoc/serializeDoc/cloneNodes),
// Markdown outline export, and undo/redo history land here.
//
// M1b: the layout engine (`_layout`) lands here too, as `layout(doc, mode,
// sizeOf, opts?)` — node sizing (font measurement) is injected via `SizeOf`
// rather than ported, since canvas text measurement is a rendering concern.
//
// SVG geometry and PNG export remain out of scope and land in a later
// milestone.

/** Semantic version of the core engine surface. */
export const CORE_VERSION = '0.0.0';

export type { TextMeasurer, Clock, IdGen } from './ports';

export type { LayoutMode, RichRun, Node, NodeMap, Float, Line, Zone, Doc } from './model';
export { ROOT_ID, DEFAULT_LAYOUT_MODE, DEFAULT_THEME_KEY } from './model';

export type { SerializableState } from './serialize';
export { serializeDoc, parseDoc, cloneNodes } from './serialize';

export type { MarkdownSource } from './markdown';
export { toMarkdown } from './markdown';

export type { HistoryStackOptions } from './history';
export { HistoryStack } from './history';

export type { NodeSize, SizeOf, LayoutOptions } from './layout';
export { layout } from './layout';

export type { Point, LineGeometry, LineLike, Box, PortSide } from './geometry';
export { resolveLineGeometry, cubicAt, portPoint } from './geometry';

// M5: Doc <-> Y.Doc CRDT binding (see docs/architecture/0001-architecture.md
// §2's `crdt/` seam). Pure — `yjs` has no DOM/network dependency itself, so
// this stays framework-agnostic; transport lives in `apps/web/src/collab/`.
export type { YDoc } from './crdt';
export { docToYDoc, yDocToDoc, applyDocToYDoc, addNode, removeNode, setNodeField, encodeStateAsUpdate, applyUpdate } from './crdt';

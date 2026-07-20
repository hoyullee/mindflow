import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { Box, Doc, Float, Line, LineAnchor, LayoutMode, Node, NodeMap, SizeOf, SnapCandidate, Zone } from '@mindflow/mindmap-core';
import { HistoryStack, ROOT_ID, applyPartialStyle, cubicAt, findLineSnap, layout, resolveLineEndpoints, resolveLineGeometry, serializeDoc } from '@mindflow/mindmap-core';
import { domToRuns, linearize, runsToHtml, setLinearSelection } from './richtextDom';
import { useDocStore } from '../../adapters/BackendContext';
import { useAuthUser } from '../../adapters/useAuthUser';
import { useYjsDocSync } from '../../collab/useYjsDocSync';
import { usePresence, type UsePresenceResult } from '../../collab/usePresence';
import { EMPTY_PRESENCE_SELECTION, type PresenceSelection } from '../../collab/presence';
import { CanvasTextMeasurer, computeMetrics } from './metrics';
import { loadOrSeedDoc } from './storage';
import { buildVisible, descendants, outlineRows } from './tree';
import type { EdgeStyle } from './tree';
import { themeKeyOf, themeOf } from './theme';
import type { Theme, ThemeKey } from './theme';
import { downloadFile } from './download';
import { exportPng } from './png';
import * as mutations from './mutations';
import { createIdFactory } from './mutations';
import type {
  AttachTarget,
  ContextMenuState,
  ContextSubState,
  GeomMap,
  HitResult,
  LineHandle,
  MarqueeRect,
  MultiSelection,
  NodeGeom,
  PanState,
  SaveState,
  Selection,
  SelectionKind,
  TextCtxState,
  ViewMode,
} from './types';

// State/interaction controller for the mindmap editor route — the React
// counterpart of `Component`'s state + drag/select/edit/save/undo methods
// (MindFlow.dc.html). Editor-a covered load/layout/pan/zoom/view/theme;
// Editor-b added selection, text editing, structural add/delete, drag-move/
// resize, the property-panel setters, autosave + manual save, undo/redo (via
// `@mindflow/mindmap-core`'s `HistoryStack`), and export. Editor-c added
// marquee multi-select + its bulk property panel, the minimap, editable
// outline view, and drag-to-reparent. A later revision added the right-click
// context menu (`ctxMenu`/`ctxSub`, MindFlow.dc.html:2775-2837, 3087-3170).
//
// This revision adds partial rich-text run styling: `NodeEditBox`
// (`components/NodeLayer.tsx`) is now a real `contentEditable` box (port of
// MindFlow.dc.html:1200-1224), its commit path is `commitNodeRichText`
// (below, port of `commitRichEdit`, MindFlow.dc.html:2629-2643, backed by
// `mutations.commitNodeRichText`), and the floating "B / color / 지우기"
// toolbar (`textCtx` below + `components/TextToolbar.tsx`) applies a style to
// the current DOM selection via `applyPartial` (below, port of
// `Component#applyPartial`'s char-model, MindFlow.dc.html:2701-2725 —
// `@mindflow/mindmap-core`'s `applyPartialStyle` does the actual char-run
// math; `applyPartial` here is just the DOM/Selection plumbing around it via
// `richtextDom.ts`'s `linearize`/`domToRuns`/`runsToHtml`/`setLinearSelection`).
// Unlike the original (which opens the toolbar from a right-click INSIDE an
// active selection), this port opens it directly off a drag-selection in the
// editor — see `TextToolbar.tsx`'s doc comment for the rationale.
//
// Line endpoint anchor magnets (`a1`/`a2`, MindFlow.dc.html:1728-1734,
// 2377-2454) are wired here: dragging a line endpoint near a node/float port
// snaps + anchors it (`findLineSnap`/`lineSnap` below); anchored endpoints are
// resolved every render via `resolveLine`/`lineGeometryOf` (`boxOfAnchor` looks
// up the live node/float box), so they automatically follow their target when
// it moves. `boxOfAnchor`/`resolveLine`/`snapCandidates` are shared by every
// line-geometry consumer (hit-testing, marquee, curve-drag, `LineLayer`,
// PNG export) so anchored lines behave consistently everywhere.

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2.4;
const FIT_PADDING = 90;
// Touch long-press → context menu (the touch equivalent of a right-click): a
// stationary press held this long opens the menu; moving more than the
// tolerance first cancels it (it's a pan).
const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_TOL = 10;

interface ViewportState {
  pan: PanState;
  zoom: number;
  vw: number;
  vh: number;
}

const INITIAL_VIEWPORT: ViewportState = { pan: { x: 0, y: 0 }, zoom: 1, vw: 1200, vh: 700 };

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function zoomAtState(state: ViewportState, nz: number, sx: number, sy: number): ViewportState {
  const z = state.zoom;
  const p = state.pan;
  const clamped = clamp(nz, MIN_ZOOM, MAX_ZOOM);
  const cx = (sx - p.x) / z;
  const cy = (sy - p.y) / z;
  return { ...state, zoom: clamped, pan: { x: sx - cx * clamped, y: sy - cy * clamped } };
}

/** The subset of `Doc` the undo/redo stack snapshots — port of `Component#takeSnap`
 * (MindFlow.dc.html:548-549): `themeKey` is intentionally excluded (the original's own asymmetry). */
interface Snapshot {
  nodes: NodeMap;
  floats: Float[];
  lines: Line[];
  zones: Zone[];
  layoutMode: LayoutMode;
  edgeStyle: EdgeStyle;
}

type ObjDrag =
  | { kind: 'root'; pointerId: number; startClientX: number; startClientY: number; startAnchor: PanState }
  /** Unified free/attached node drag — port of `Component#onMove`'s `d.type === 'node'` branch
   * (MindFlow.dc.html:1748-1755): ANY non-root node drags as a ghost + live drop-target
   * highlight; only on drop does the kind (free vs. attached) decide reattach/detach/move. */
  | {
      kind: 'node-move';
      id: string;
      pointerId: number;
      startClientX: number;
      startClientY: number;
      startGeomX: number;
      startGeomY: number;
      wasFree: boolean;
      excludeIds: Set<string>;
    }
  | { kind: 'node-resize'; id: string; pointerId: number; startClientX: number; startClientY: number; ow: number; oh: number }
  | { kind: 'float'; id: string; pointerId: number; startClientX: number; startClientY: number; ox: number; oy: number }
  | { kind: 'float-resize'; id: string; pointerId: number; startClientX: number; startClientY: number; ow: number; oh: number }
  | { kind: 'zone'; id: string; pointerId: number; startClientX: number; startClientY: number; ox: number; oy: number }
  | { kind: 'zone-resize'; id: string; pointerId: number; startClientX: number; startClientY: number; ow: number; oh: number }
  | { kind: 'line-move'; id: string; pointerId: number; startClientX: number; startClientY: number; o: { x1: number; y1: number; x2: number; y2: number } }
  | { kind: 'line-end'; id: string; which: LineHandle; pointerId: number; startClientX: number; startClientY: number; ox: number; oy: number }
  | { kind: 'line-curve'; id: string; which: LineHandle; pointerId: number; startClientX: number; startClientY: number; oc: number; nx: number; ny: number }
  /** Multi-select group drag — port of `Component#startGroupDrag`/`onMove`'s `'group'` branch
   * (MindFlow.dc.html:1582-1594, 1706-1713). Only free-standing node roots are captured (see
   * `mutations.translateNodesBy`'s doc comment for why attached tree nodes can't be). */
  | {
      kind: 'group';
      pointerId: number;
      startClientX: number;
      startClientY: number;
      nodesOrig: Record<string, { x: number; y: number }>;
      floatsOrig: Record<string, { x: number; y: number }>;
      linesOrig: Record<string, { x1: number; y1: number; x2: number; y2: number }>;
    };

type BgDrag =
  | { kind: 'pan'; pointerId: number; sx: number; sy: number; startPan: PanState; moved: boolean; touch?: boolean }
  | { kind: 'marquee'; pointerId: number; startClientX: number; startClientY: number; x0: number; y0: number; moved: boolean };

function totalSelected(m: MultiSelection): number {
  return m.nodes.length + m.lines.length + m.floats.length;
}

export interface EditorController {
  doc: Doc;
  theme: Theme;
  themeKey: ThemeKey;
  layoutMode: LayoutMode;
  edgeStyle: EdgeStyle;
  view: ViewMode;
  pan: PanState;
  zoom: number;
  zoomPct: number;
  vw: number;
  vh: number;
  geom: GeomMap;
  mapId: string | null;
  docTitle: string;

  setViewportEl: (el: HTMLDivElement | null) => void;
  setLayoutMode: (mode: LayoutMode) => void;
  setEdgeStyle: (s: EdgeStyle) => void;
  setThemeKey: (k: ThemeKey) => void;
  setView: (v: ViewMode) => void;

  onBackgroundPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  fitView: () => void;
  goHome: () => void;

  // ---- presence (M5.5: multi-user awareness — cursor/selection/identity) ----
  /** This tab's own identity + every OTHER connected peer's live cursor/
   * selection (`peers` is `[]` when solo — single-user, no-op rendering). */
  presence: UsePresenceResult;
  /** Reports the pointer's CLIENT (screen) position for presence — converts to
   * canvas coordinates internally (same space as `geom`) and throttles the
   * broadcast; call from the viewport's `onPointerMove`. */
  reportPointerPosition: (clientX: number, clientY: number) => void;
  /** Call from the viewport's `onPointerLeave`/`onPointerCancel` — reports "no
   * cursor" so peers don't see a stale last-known position after this tab's
   * pointer leaves the canvas. */
  clearPointerPosition: () => void;

  // ---- selection ----
  selection: Selection | null;
  selectNode: (id: string) => void;
  selectFloat: (id: string) => void;
  selectLine: (id: string) => void;
  selectZone: (id: string) => void;
  clearSelection: () => void;

  // ---- mobile property sheet ----
  // On mobile the property panel is a 55dvh bottom sheet. Selecting an object no
  // longer auto-opens it (that covered the canvas and panned the map on every
  // tap); the user opens it explicitly. `propsOpen` gates the sheet on mobile
  // and resets whenever the selection changes. (Desktop ignores this — the side
  // panel still shows on selection.)
  propsOpen: boolean;
  openProps: () => void;
  closeProps: () => void;

  // ---- multi-selection (marquee) — port of `Component#state.msel` ----
  multiSelection: MultiSelection | null;
  /** Always non-empty-safe: falls back to the single `selection` when there's no active
   * marquee group — the React-hook counterpart of `Component#msel()` (MindFlow.dc.html:1548). */
  multiGroups: MultiSelection;
  marquee: MarqueeRect | null;

  // ---- minimap ----
  showMinimap: boolean;
  toggleMinimap: () => void;
  panToCanvasPoint: (x: number, y: number) => void;
  centerObjectAboveSheet: (kind: SelectionKind, id: string, reserveBottomPx: number) => void;

  // ---- drag-to-reparent drop target ----
  attachTarget: AttachTarget | null;

  // ---- outline view editing ----
  outlineEditId: string | null;
  outlineStartEdit: (id: string) => void;
  outlineCommitEdit: (id: string, text: string) => void;
  outlineAddChild: (id: string) => void;
  outlineAddSibling: (id: string) => void;
  outlineIndent: (id: string) => void;
  outlineOutdent: (id: string) => void;

  // ---- text editing ----
  editingNodeId: string | null;
  /** The node being resized (drag on its handle) — lifted to the top layer, like
   * `editingNodeId`, so it covers neighbours it grows over mid-drag. */
  resizingNodeId: string | null;
  editingFloatId: string | null;
  editingLineId: string | null;
  editingZoneId: string | null;
  editingTitle: boolean;
  startEditNode: (id: string) => void;
  commitNodeText: (id: string, text: string) => void;
  cancelNodeEdit: () => void;
  /** The node text box's own commit — port of `Component#commitRichEdit`
   * (MindFlow.dc.html:2629-2643): reads the live `contentEditable` DOM (`el`,
   * `NodeEditBox`'s own ref) via `domToRuns`, and writes BOTH `text` and the
   * partial-style `rich` runs in one step (unlike `commitNodeText` above,
   * which is plain-text-only and used by every OTHER text editor). */
  commitNodeRichText: (id: string, el: HTMLElement | null) => void;
  /** Re-measure the node being edited from its live `contentEditable` content so
   * the box grows/shrinks with the text as it's typed (WYSIWYG). Called on every
   * input in `NodeEditBox`. */
  updateNodeEditSize: (id: string, el: HTMLElement | null) => void;
  /** The floating partial-style toolbar's open state — port of
   * `Component#state.textCtx` (MindFlow.dc.html:2782, 3088-3099). `null` when
   * closed; only ever rendered while `editingNodeId` is also set. */
  textCtx: TextCtxState | null;
  /** Opens the toolbar at a screen (viewport-relative) point — called by
   * `NodeEditBox` when a drag-selection inside it becomes non-collapsed. */
  openTextCtx: (sx: number, sy: number) => void;
  /** Port of the outside-click branch of the original's `_winDown` handler
   * for `textCtx` (MindFlow.dc.html:820) — also used on Escape/commit/cancel. */
  closeTextCtx: () => void;
  /** Registers (or clears, on unmount) the currently-focused rich-text
   * `contentEditable` element — this port's stand-in for the original's
   * `this._richEl` instance field (MindFlow.dc.html:1209), since a hooks-based
   * controller has no instance of its own to hang a ref off. `applyPartial`
   * reads from this. */
  setRichEditorEl: (el: HTMLDivElement | null) => void;
  /** Applies a partial style to the CURRENT DOM Selection inside the registered
   * rich editor — port of `Component#applyPartial` (MindFlow.dc.html:2701-2725).
   * DOM-only (rewrites the `contentEditable`'s innerHTML + restores the
   * selection); the actual doc/undo commit happens later, on blur/Enter, via
   * `commitNodeRichText` reading the same live DOM. */
  applyPartial: (kind: 'b' | 'c' | 'clear', val?: string | null) => void;
  startEditFloat: (id: string) => void;
  commitFloatText: (id: string, text: string) => void;
  cancelFloatEdit: () => void;
  startEditLineLabel: (id: string) => void;
  commitLineLabel: (id: string, text: string) => void;
  cancelLineLabelEdit: () => void;
  startEditZoneLabel: (id: string) => void;
  commitZoneLabel: (id: string, text: string) => void;
  cancelZoneLabelEdit: () => void;
  startEditTitle: () => void;
  commitTitle: (text: string) => void;
  cancelTitleEdit: () => void;
  /** Non-null when the last title edit was rejected as a duplicate filename. */
  titleError: string | null;
  dismissTitleError: () => void;

  // ---- structural ----
  addChild: () => void;
  addSibling: () => void;
  deleteSelection: () => void;
  toggleCollapse: (id: string) => void;
  /** `at` (canvas coordinates) is only ever passed by the background context menu's
   * "추가" items (`ContextMenu.tsx`) — port of `Component#addFreeNode`/`addFloat`/
   * `addLine`/`addZone`'s `px != null` branch (MindFlow.dc.html:2122-2124, 2253-2256,
   * 2296-2298, 2455-2459): an explicit spot skips the center-of-viewport + stagger
   * placement entirely (stagger included), landing exactly where the right-click hit. */
  addFreeNodeAt: (at?: { x: number; y: number }) => void;
  addFloatAt: (at?: { x: number; y: number }) => void;
  addLineAt: (at?: { x: number; y: number }) => void;
  addZoneAt: (at?: { x: number; y: number }) => void;

  // ---- node property setters ----
  setShape: (shape: string) => void;
  setColor: (hex: string | null) => void;
  setFill: (hex: string | null) => void;
  setStroke: (hex: string | null) => void;
  setFillAlpha: (a: number) => void;
  setStrokeAlpha: (a: number) => void;
  setTextColor: (hex: string | null) => void;
  toggleNodeBold: () => void;
  setNodeTsize: (v: 's' | 'm' | 'l') => void;
  setEmoji: (e: string) => void;
  clearEmoji: () => void;
  setNote: (text: string) => void;
  /** Port of `Component#setTextAlign` (MindFlow.dc.html:2773) — same bulk-aware pattern
   * as `setShape`/`toggleNodeBold`: applies to every `nodeTargetIds()` target. */
  setTextAlign: (v: 'left' | 'center' | 'right') => void;

  // ---- float property setters (bulk-aware: apply to `multiGroups.floats`,
  // port of `Component#applyFloatText`-backed setters, MindFlow.dc.html:2733-2737) ----
  setFloatBg: (hex: string | null) => void;
  toggleFloatBold: () => void;
  setFloatTsize: (v: 's' | 'm' | 'l') => void;
  setFloatTextColor: (hex: string | null) => void;
  toggleFloatCollapse: (id: string) => void;
  deleteFloat: (id: string) => void;

  // ---- line property setters (bulk-aware: apply to `multiGroups.lines`, except
  // `setLineCurve`/rename which stay single-reference — port of `Component#applyLineText`-backed
  // setters + `setLineCurveN`, MindFlow.dc.html:2492, 2517-2528, 2738-2741) ----
  setLineDashed: (v: boolean) => void;
  setLineArrow: (which: LineHandle, v: boolean) => void;
  setLineCurve: (id: string, which: LineHandle, v: number) => void;
  toggleLineBold: () => void;
  setLineTsize: (v: 's' | 'm' | 'l') => void;
  setLineTextColor: (hex: string | null) => void;
  deleteLine: (id: string) => void;
  /** Resolves a line's on-screen endpoints, following `a1`/`a2` anchors to their live
   * node/float box — port of `Component#resolveLine` (MindFlow.dc.html:2414-2417). Use
   * this (not the line's raw `x1/y1/x2/y2`) for rendering/hit-testing so anchored lines
   * track their target as it moves. */
  resolveLine: (l: Line) => { x1: number; y1: number; x2: number; y2: number };
  /** The anchor-aware Bézier geometry (endpoints resolved + curvature applied) — what
   * `LineLayer` actually draws. */
  lineGeometry: (l: Line) => ReturnType<typeof resolveLineGeometry>;
  /** The line-end drag's current snap target (port of `Component#_snapHi`,
   * MindFlow.dc.html:1733) — null except mid-drag when a port is within range. Drives the
   * 4 port-indicator dots on the hovered node/float (MindFlow.dc.html:1388-1402). */
  lineSnap: LineAnchor | null;
  /** The live box for `lineSnap`'s target (already resolved — `LineLayer` doesn't need
   * its own node/float lookup to draw the port dots). */
  lineSnapBox: Box | null;

  // ---- zone property setters ----
  setZoneColor: (id: string, hex: string | null) => void;
  deleteZone: (id: string) => void;

  // ---- right-click context menu — port of `Component#state.ctxMenu`/`ctxSub`
  // (MindFlow.dc.html:2775-2837, 3087-3170) ----
  ctxMenu: ContextMenuState | null;
  ctxSub: ContextSubState | null;
  /** Wire to the viewport's `onContextMenu` — port of `Component#onCtxMenu`
   * (MindFlow.dc.html:2775-2791). */
  onContextMenu: (e: ReactMouseEvent<HTMLDivElement>) => void;
  /** Port of `Component#closeCtxMenu` (MindFlow.dc.html:2837) — also used by
   * `ContextMenu`'s own outside-click/Escape handling. */
  closeCtxMenu: () => void;
  /** Opens (or closes, if already open) the "텍스트 정렬 ▸" flyout, anchored to the
   * clicked row's `offsetTop` — port of the `alignParent` item's `onClick`
   * (MindFlow.dc.html:3120). */
  toggleCtxSub: (top: number) => void;

  // ---- drag / resize starters ----
  beginNodeDrag: (e: ReactPointerEvent, id: string) => void;
  beginNodeResize: (e: ReactPointerEvent, id: string) => void;
  resetNodeSize: (id: string) => void;
  beginFloatDrag: (e: ReactPointerEvent, id: string) => void;
  beginFloatResize: (e: ReactPointerEvent, id: string) => void;
  beginZoneDrag: (e: ReactPointerEvent, id: string) => void;
  beginZoneResize: (e: ReactPointerEvent, id: string) => void;
  beginLineDrag: (e: ReactPointerEvent, id: string) => void;
  beginLineEndDrag: (e: ReactPointerEvent, id: string, which: LineHandle) => void;
  beginLineCurveDrag: (e: ReactPointerEvent, id: string, which: LineHandle) => void;
  dragGhost: { id: string; x: number; y: number } | null;

  // ---- undo/redo/save/export ----
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  saveState: SaveState;
  saveNow: () => void;
  /** Set when the last `DocStore.save()` lost an optimistic-lock race (another
   * tab/device saved first) — a place for the UI (`DocChip`) to tell the user,
   * per CLAUDE.md's M4 task brief ("충돌 시 사용자 고지 자리 마련"). */
  saveConflict: { currentVersion: number } | null;
  dismissSaveConflict: () => void;
  exportJSON: () => void;
  exportPNG: () => void;
}

function docSignature(d: Doc): string {
  try {
    return JSON.stringify([d.nodes, d.floats, d.lines, d.zones, d.layoutMode, d.themeKey, d.edgeStyle]);
  } catch {
    return '';
  }
}

/** Port of `Component#docTitle` (MindFlow.dc.html:605) — used as the export filename base. */
function safeDocTitle(doc: Doc, fallbackTitle: string): string {
  const raw = doc.nodes[ROOT_ID]?.text || fallbackTitle || '마인드맵';
  return raw.trim().replace(/[\\/:*?"<>|]/g, '_');
}

export function useEditorState(): EditorController {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const docStore = useDocStore();
  const mapId = params.get('map') || null;
  const docStoreId = mapId || 'default';
  const titleParam = params.get('title') ? decodeURIComponent(params.get('title') || '') : '';

  const [doc, setDoc] = useState<Doc>(() => loadOrSeedDoc(mapId, titleParam));
  const [saveConflict, setSaveConflict] = useState<{ currentVersion: number } | null>(null);
  // connector style lives on the doc (persisted like layoutMode/themeKey); mirror
  // it into local state for rendering, seeded from the loaded doc.
  const [edgeStyle, setEdgeStyleState] = useState<EdgeStyle>(() => (doc.edgeStyle as EdgeStyle | undefined) ?? 'curve');
  const [view, setView] = useState<ViewMode>('map');
  const [viewport, setViewport] = useState<ViewportState>(INITIAL_VIEWPORT);
  // True once the ResizeObserver has reported the canvas's real on-screen size.
  // The initial centering waits for this so it centers against the actual
  // viewport, not the 1200×700 default (which on a phone put the root
  // off-screen). If ResizeObserver is unavailable (jsdom), start `true` so the
  // one-shot centering still runs with the default size, as before.
  const [measured, setMeasured] = useState<boolean>(typeof ResizeObserver === 'undefined');
  const [rootAnchor, setRootAnchor] = useState<PanState>({ x: 0, y: 0 });
  const [dragGhost, setDragGhost] = useState<{ id: string; x: number; y: number } | null>(null);

  const [selection, setSelectionState] = useState<Selection | null>(null);
  const [multiSelection, setMultiSelectionState] = useState<MultiSelection | null>(null);
  // Mobile-only: whether the property bottom sheet is open (see the interface
  // note). Reset to closed whenever the selection identity changes so a fresh
  // tap never re-covers the canvas — the user re-opens it per object.
  const [propsOpen, setPropsOpen] = useState(false);
  useEffect(() => {
    setPropsOpen(false);
  }, [selection?.kind, selection?.id]);
  const openProps = useCallback(() => setPropsOpen(true), []);
  const closeProps = useCallback(() => setPropsOpen(false), []);
  const [marquee, setMarquee] = useState<MarqueeRect | null>(null);
  const [attachTarget, setAttachTarget] = useState<AttachTarget | null>(null);
  const [showMinimap, setShowMinimap] = useState(true);
  const [outlineEditId, setOutlineEditId] = useState<string | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  // The node currently being resized (drag on its size handle). Like `editingNodeId`,
  // it's lifted to the top layer so its box cleanly covers any neighbour it grows
  // over mid-drag (the magnet only separates them on release).
  const [resizingNodeId, setResizingNodeId] = useState<string | null>(null);
  // Live box size for the node currently being edited, re-measured on each
  // keystroke from the `contentEditable`'s content (`updateNodeEditSize`). While
  // editing, `geom` uses this instead of the node's stale committed size, so the
  // box grows/shrinks WITH the text (WYSIWYG) instead of the text overflowing a
  // fixed box until commit re-lays-out. `null` = not measured yet (use committed).
  const [editLiveSize, setEditLiveSize] = useState<{ w: number; h: number } | null>(null);
  const [editingFloatId, setEditingFloatId] = useState<string | null>(null);
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  // Set when a title edit was rejected because another map already has that
  // name (duplicate filenames aren't allowed) — surfaced by `DocChip`.
  const [titleError, setTitleError] = useState<string | null>(null);
  const [saveState, setSaveStateState] = useState<SaveState>('saved');
  const [, setHistoryTick] = useState(0);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const [ctxSub, setCtxSub] = useState<ContextSubState | null>(null);
  const [textCtx, setTextCtx] = useState<TextCtxState | null>(null);
  // This port's stand-in for `Component#_richEl` (MindFlow.dc.html:1209) — the
  // currently-mounted rich-text `contentEditable` element, registered by
  // `NodeEditBox` while it's the one rendered (`editingNodeId` is set to its id).
  const richElRef = useRef<HTMLDivElement | null>(null);
  const setRichEditorEl = useCallback((el: HTMLDivElement | null) => {
    richElRef.current = el;
  }, []);

  const idFactory = useRef(createIdFactory()).current;

  // ---- DocStore version (optimistic lock) — `undefined` until the first
  // `load()`/`save()` tells us what the backend currently has. Local mode's
  // initial doc comes from the synchronous `loadOrSeedDoc` seed above (so the
  // very first paint never blocks on a promise); this effect then confirms
  // the version and — for a real backend — swaps in the actual remote doc
  // once it arrives (a no-op re-render for Local, since content is identical).
  //
  // `mountDocSigRef` guards against a race with the user editing before this
  // promise resolves: only ever overwrite `doc` here if it's STILL exactly
  // the mount-time seed (nothing edited yet) — otherwise an in-flight load
  // that resolves after an edit already landed would silently revert it. ----
  const docVersionRef = useRef<number | undefined>(undefined);
  const mountDocSigRef = useRef(docSignature(doc));
  useEffect(() => {
    let cancelled = false;
    docStore
      .load(docStoreId)
      .then((res) => {
        if (cancelled) return;
        if (!res) {
          docVersionRef.current = undefined;
          return;
        }
        docVersionRef.current = res.version;
        const adopt = docSignature(docRef.current) === mountDocSigRef.current && docSignature(res.doc) !== mountDocSigRef.current;
        if (adopt) {
          setDoc(res.doc);
          setEdgeStyleState((res.doc.edgeStyle as EdgeStyle | undefined) ?? 'curve');
        }
      })
      .catch(() => {
        /* load failed (offline, RLS, ...) — keep the locally-seeded doc and
         * treat this as a brand-new/unknown version; the next save() will
         * create it rather than lock against a version we never confirmed */
      });
    return () => {
      cancelled = true;
    };
  }, [docStore, docStoreId]);

  // Titles of OTHER (non-deleted) maps — used to reject renaming this map to a
  // name that's already taken (see `commitTitle`). Best-effort: fetched once on
  // mount; a rename slips through only if another map with the same title was
  // created elsewhere in the moment between this list() and the rename.
  const otherTitlesRef = useRef<Set<string>>(new Set<string>());
  useEffect(() => {
    let cancelled = false;
    docStore
      .list()
      .then((metas) => {
        if (cancelled) return;
        const set = new Set<string>();
        for (const m of metas) {
          if (m.id === docStoreId || m.deletedAt) continue;
          const t = (m.title || '').trim();
          if (t) set.add(t);
        }
        otherTitlesRef.current = set;
      })
      .catch(() => {
        /* listing failed (offline, RLS, ...) — non-fatal; skip the guard */
      });
    return () => {
      cancelled = true;
    };
  }, [docStore, docStoreId]);

  // ---- M5: real-time collaboration ----
  // Backs `doc` with a live Y.Doc (Supabase Realtime if configured, else
  // BroadcastChannel for same-browser multi-tab, else a no-op — see
  // `collab/factory.ts`). Local edits already flow through `setDoc`/`commitDoc`
  // above as normal; `useYjsDocSync` observes the resulting `doc` value and
  // mirrors it into the Y.Doc (and out to peers) as a diff, and merges
  // incoming remote updates straight into `doc` via `setDoc` (bypassing
  // `commitDoc`, so remote edits don't land on THIS tab's local undo stack —
  // see `useYjsDocSync`'s doc comment for the full rationale).
  const awareness = useYjsDocSync(docStoreId, doc, setDoc);

  // ---- presence (multi-user awareness on top of M5's document sync): cursor
  // position + selection + identity, broadcast via the SAME `Awareness`
  // instance `useYjsDocSync` connected above (Supabase Realtime/BroadcastChannel/
  // no-op — whichever `collab/factory.ts` picked). `authUser` resolves
  // asynchronously (a real Supabase session) or stays `null` (local/demo mode,
  // or before the session check resolves) — `usePresence` falls back to a
  // random "adjective+animal" guest identity in that case (`collab/identity.ts`). ----
  const authUser = useAuthUser();
  const presence = usePresence(awareness, authUser?.email);

  // Broadcasts the LOCAL selection (single `selection` OR marquee `multiSelection`,
  // whichever is active — same precedence as `multiGroups` below, plus zones,
  // which `MultiSelection` itself doesn't carry) to peers whenever it changes.
  // Deliberately does NOT touch `doc`/undo — presence-only, per this feature's
  // task brief.
  useEffect(() => {
    const next: PresenceSelection = multiSelection
      ? { nodes: multiSelection.nodes, floats: multiSelection.floats, lines: multiSelection.lines, zones: [] }
      : selection
        ? {
            nodes: selection.kind === 'node' ? [selection.id] : [],
            floats: selection.kind === 'float' ? [selection.id] : [],
            lines: selection.kind === 'line' ? [selection.id] : [],
            zones: selection.kind === 'zone' ? [selection.id] : [],
          }
        : EMPTY_PRESENCE_SELECTION;
    presence.setSelection(next);
  }, [selection, multiSelection, presence]);

  const measurer = useMemo(() => new CanvasTextMeasurer(), []);
  const sizeOf: SizeOf = useCallback(
    (node, depth) => {
      const m = computeMetrics(node, depth, measurer);
      return { w: m.w, h: m.h };
    },
    [measurer],
  );

  const laidOutNodes = useMemo(() => layout(doc, doc.layoutMode, sizeOf, { rootAnchor }), [doc, sizeOf, rootAnchor]);

  const vis = useMemo(() => buildVisible(laidOutNodes), [laidOutNodes]);

  const geom = useMemo<GeomMap>(() => {
    const out: GeomMap = {};
    vis.forEach(({ id, depth }) => {
      const n = laidOutNodes[id];
      if (!n) return;
      const m = computeMetrics(n, depth, measurer);
      const g: NodeGeom = { ...m, x: n.x, y: n.y, depth };
      // While this node is being edited, size the box to the live text (kept
      // centered on the same x/y) so it tracks the content instead of overflowing
      // a stale committed box. `editLiveSize` is computeMetrics of the current
      // editor content, so it matches exactly what commit will produce.
      if (id === editingNodeId && editLiveSize) {
        g.w = editLiveSize.w;
        g.h = editLiveSize.h;
      }
      out[id] = g;
    });
    return out;
  }, [vis, laidOutNodes, measurer, editingNodeId, editLiveSize]);

  const theme = themeOf(doc.themeKey);

  // ---- multi-selection groups — port of `Component#msel()` (MindFlow.dc.html:1548-1556):
  // falls back to the single `selection` when there's no active marquee group, so every
  // bulk-aware setter below (`nodeTargetIds`/`floatTargetIds`/`lineTargetIds`) behaves
  // identically to the pre-Editor-c single-select path when nothing is marquee-selected. ----
  const multiGroups = useMemo<MultiSelection>(() => {
    if (multiSelection) return multiSelection;
    return {
      nodes: selection?.kind === 'node' ? [selection.id] : [],
      lines: selection?.kind === 'line' ? [selection.id] : [],
      floats: selection?.kind === 'float' ? [selection.id] : [],
    };
  }, [multiSelection, selection]);
  const nodeTargetIds = useCallback((): string[] => multiGroups.nodes.filter((id) => doc.nodes[id]), [multiGroups, doc.nodes]);
  const floatTargetIds = useCallback((): string[] => multiGroups.floats.filter((id) => doc.floats.some((f) => f.id === id)), [multiGroups, doc.floats]);
  const lineTargetIds = useCallback((): string[] => multiGroups.lines.filter((l) => doc.lines.some((x) => x.id === l)), [multiGroups, doc.lines]);

  // ---- refs mirroring the latest state, used by handlers/effects that must
  // stay stable across renders (mount-once pointer listeners, useCallback'd
  // commitDoc) so they never read a stale closure ----
  const docRef = useRef(doc);
  useEffect(() => {
    docRef.current = doc;
  }, [doc]);
  const edgeStyleRef = useRef(edgeStyle);
  useEffect(() => {
    edgeStyleRef.current = edgeStyle;
  }, [edgeStyle]);
  const viewportRef = useRef(viewport);
  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);
  const geomRef = useRef(geom);
  useEffect(() => {
    geomRef.current = geom;
  }, [geom]);
  // Id of the free shape to magnet clear of overlap once the current interaction
  // settles (set on text-commit / resize / create; consumed by the nudge effect).
  // `nudgeTick` re-triggers that effect for interactions (resize) that don't
  // otherwise change `doc.nodes` on release.
  const pendingNudgeRef = useRef<string | null>(null);
  const [nudgeTick, setNudgeTick] = useState(0);
  const multiSelectionRef = useRef(multiSelection);
  useEffect(() => {
    multiSelectionRef.current = multiSelection;
  }, [multiSelection]);

  // ---- line endpoint anchor magnets (a1/a2) — port of the `_geom`/float-box lookups
  // `Component#lineTargetBox`/`findSnap`/`resolveEnd` share (MindFlow.dc.html:2377-2454).
  //
  // Two box lookups, deliberately: `boxOfAnchor` (ref-based) is for EVENT HANDLERS
  // (hit-testing/marquee/curve-drag-start/line-end-drag-start below) — those run between
  // renders, once this render has already committed and its `geomRef.current`-syncing
  // effect has flushed, so the ref is exactly as fresh as `geom` itself there. `boxOfAnchorLive`
  // (this render's `geom`/`doc` closures, no ref) is for RENDER-TIME resolution — exposed on
  // the controller as `resolveLine`/`lineGeometry` for `LineLayer` to call WHILE rendering.
  // Using the ref there would be WRONG: `geomRef.current` only updates in a `useEffect` that
  // runs AFTER commit, so reading it during THIS render (e.g. right after a node/float move
  // just changed `geom`) would render one commit stale — an anchored line's magnet would lag
  // a frame behind the node it's supposedly following. ----

  /** Port of `Component#lineTargetBox` (MindFlow.dc.html:2377-2390) — event-handler version. */
  function boxOfAnchor(anchor: LineAnchor): Box | null {
    if (anchor.kind === 'node') {
      const g = geomRef.current[anchor.id];
      return g ? { cx: g.x, cy: g.y, hw: g.w / 2, hh: g.h / 2 } : null;
    }
    const f = docRef.current.floats.find((x) => x.id === anchor.id);
    if (!f) return null;
    const h = f.h || 44;
    return { cx: f.x + f.w / 2, cy: f.y + h / 2, hw: f.w / 2, hh: h / 2 };
  }

  /** Resolves a line's on-screen endpoints, following any anchor's live target box —
   * port of `Component#resolveLine` (MindFlow.dc.html:2414-2417) — event-handler version
   * (used at drag START, where the box only needs to be as fresh as the last commit). */
  function resolveLine(l: Line): { x1: number; y1: number; x2: number; y2: number } {
    return resolveLineEndpoints(l, boxOfAnchor);
  }

  /** Same as `boxOfAnchor`, but reads THIS render's `geom`/`doc` directly (no ref) — for the
   * render-time path (`lineGeometryLive`, exposed as `controller.lineGeometry`). */
  function boxOfAnchorLive(anchor: LineAnchor): Box | null {
    if (anchor.kind === 'node') {
      const g = geom[anchor.id];
      return g ? { cx: g.x, cy: g.y, hw: g.w / 2, hh: g.h / 2 } : null;
    }
    const f = doc.floats.find((x) => x.id === anchor.id);
    if (!f) return null;
    const h = f.h || 44;
    return { cx: f.x + f.w / 2, cy: f.y + h / 2, hw: f.w / 2, hh: h / 2 };
  }

  /** Render-time counterpart of `resolveLine` — exposed as `controller.resolveLine`. */
  function resolveLineLive(l: Line): { x1: number; y1: number; x2: number; y2: number } {
    return resolveLineEndpoints(l, boxOfAnchorLive);
  }

  /** The anchor-aware Bézier geometry for a line — feeds `resolveLineLive`'s resolved
   * endpoints into `resolveLineGeometry` alongside the line's curvature. Exposed as
   * `controller.lineGeometry`, what `LineLayer` actually draws every render. */
  function lineGeometryLive(l: Line) {
    return resolveLineGeometry({ ...l, ...resolveLineLive(l) });
  }

  /** Event-handler counterpart of `lineGeometryLive` — used by hit-testing/marquee/
   * curve-drag-start below, where reading through the ref is correct (see the block
   * comment above). */
  function lineGeometryOf(l: Line) {
    return resolveLineGeometry({ ...l, ...resolveLine(l) });
  }

  /** Every node/float box offered up as a line-endpoint snap target — port of
   * `Component#findSnap`'s candidate scan (MindFlow.dc.html:2451-2452). */
  function snapCandidates(): SnapCandidate[] {
    const out: SnapCandidate[] = [];
    const g = geomRef.current;
    for (const id in g) {
      const gg = g[id];
      if (gg) out.push({ kind: 'node', id, box: { cx: gg.x, cy: gg.y, hw: gg.w / 2, hh: gg.h / 2 } });
    }
    docRef.current.floats.forEach((f) => {
      const h = f.h || 44;
      out.push({ kind: 'float', id: f.id, box: { cx: f.x + f.w / 2, cy: f.y + h / 2, hw: f.w / 2, hh: h / 2 } });
    });
    return out;
  }

  /** The line-end drag's current snap target, for the port-indicator dots on the
   * hovered box — port of `Component#_snapHi` (MindFlow.dc.html:1733, 1390-1402). Only
   * ever non-null while a `line-end` drag is live. */
  const [lineSnap, setLineSnap] = useState<LineAnchor | null>(null);
  const lineSnapBox = lineSnap ? boxOfAnchorLive(lineSnap) : null;

  // ---- undo/redo history (@mindflow/mindmap-core HistoryStack) ----
  const historyRef = useRef<HistoryStack<Snapshot> | null>(null);
  if (historyRef.current === null) {
    historyRef.current = new HistoryStack<Snapshot>({ now: () => Date.now() });
  }
  const historyInitRef = useRef(false);
  useEffect(() => {
    if (historyInitRef.current) return;
    historyInitRef.current = true;
    historyRef.current!.reset({ nodes: doc.nodes, floats: doc.floats, lines: doc.lines, zones: doc.zones, layoutMode: doc.layoutMode, edgeStyle });
    // deliberately empty deps: only the initial (mount-time) doc/edgeStyle matter here
  }, []);

  /** Commits a doc mutation and records an undo/redo step when it actually changed
   * something — the React-hook counterpart of `Component#recordHistory`
   * (MindFlow.dc.html:551), driven explicitly per-action instead of a
   * `componentDidUpdate` diff (this hook has no equivalent lifecycle to diff against). */
  const commitDoc = useCallback((updater: (d: Doc) => Doc, continuous = false) => {
    setDoc((prev) => {
      const next = updater(prev);
      const changed =
        next.nodes !== prev.nodes || next.floats !== prev.floats || next.lines !== prev.lines || next.zones !== prev.zones || next.layoutMode !== prev.layoutMode;
      if (changed) {
        historyRef.current!.record(
          { nodes: next.nodes, floats: next.floats, lines: next.lines, zones: next.zones, layoutMode: next.layoutMode, edgeStyle: edgeStyleRef.current },
          continuous,
        );
        setHistoryTick((t) => t + 1);
      }
      return changed ? next : prev;
    });
  }, []);

  function applySnapshot(snap: Snapshot): void {
    setDoc((prev) => ({ ...prev, nodes: snap.nodes, floats: snap.floats, lines: snap.lines, zones: snap.zones, layoutMode: snap.layoutMode, edgeStyle: snap.edgeStyle }));
    setEdgeStyleState(snap.edgeStyle);
    setSelectionState(null);
    setMultiSelectionState(null);
    setOutlineEditId(null);
    setEditingNodeId(null);
    setEditingFloatId(null);
    setEditingLineId(null);
    setEditingZoneId(null);
    setEditingTitle(false);
    setTextCtx(null);
    setHistoryTick((t) => t + 1);
  }

  const undo = useCallback(() => {
    if (editingNodeId || editingFloatId || editingTitle) return; // native undo inside editors (matches original's guard)
    const snap = historyRef.current!.undo();
    if (snap) applySnapshot(snap);
  }, [editingNodeId, editingFloatId, editingTitle]);

  const redo = useCallback(() => {
    if (editingNodeId || editingFloatId || editingTitle) return;
    const snap = historyRef.current!.redo();
    if (snap) applySnapshot(snap);
  }, [editingNodeId, editingFloatId, editingTitle]);

  // ---- viewport sizing ----
  const viewportElRef = useRef<HTMLDivElement | null>(null);
  const setViewportEl = useCallback((el: HTMLDivElement | null) => {
    viewportElRef.current = el;
  }, []);

  useEffect(() => {
    const el = viewportElRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      setMeasured(true);
      setViewport((prev) => (prev.vw === w && prev.vh === h ? prev : { ...prev, vw: w || prev.vw, vh: h || prev.vh }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [viewportElRef.current]);

  /** Client (screen) coordinates → canvas (untransformed, pan/zoom-independent) coordinates —
   * port of `Component#toCanvas` (MindFlow.dc.html:1661). Shared by the marquee/pan background
   * drag and the object drag/reattach machinery below. */
  function toCanvasPoint(clientX: number, clientY: number, vp: ViewportState): { x: number; y: number } {
    const el = viewportElRef.current;
    const r = el ? el.getBoundingClientRect() : { left: 0, top: 0 };
    // Defensive: some event sources (e.g. a `PointerEvent`-less DOM implementation) can hand back
    // a non-finite `clientX`/`clientY` — never let that leak into rendered coordinates as `NaN`.
    const cx = Number.isFinite(clientX) ? clientX : 0;
    const cy = Number.isFinite(clientY) ? clientY : 0;
    return { x: (cx - r.left - vp.pan.x) / vp.zoom, y: (cy - r.top - vp.pan.y) / vp.zoom };
  }

  // ---- right-click context menu — port of `Component#onCtxMenu`/`openCtxAt`/`hitTestAll`
  // (MindFlow.dc.html:2775-2837). `pendingCtxRef`/`suppressCtxRef` replicate the original's
  // `_pendingCtx`/`_suppressCtx` fields: on macOS the browser's `contextmenu` event fires
  // at MOUSEDOWN (while a drag is still live), so opening has to be deferred to `pointerup`
  // and only actually happens if the pointer never moved (a right-click-drag = pan, so a
  // MOVED right-drag must not also pop the menu); elsewhere `contextmenu` fires at mouseup,
  // by which point the drag already ended, so `_suppressCtx` instead marks "a pan drag JUST
  // ended with movement" for a brief window so the menu doesn't reopen there either.
  // `objDragMovedRef` is this port's stand-in for the original's per-drag `d.moved` field on
  // `objDragRef`'s (node/float/zone/line/group) variants, which don't carry one of their own
  // (see `startObjDrag` below, next to `objDragRef`'s declaration). ----
  const pendingCtxRef = useRef<{ x: number; y: number } | null>(null);
  const suppressCtxRef = useRef(0);
  // Timestamp (ms) until which the next compatibility `click` after a touch
  // tap-select is swallowed — see the tap branch of `onUp` and the guard effect.
  const suppressGhostClickRef = useRef(0);
  const objDragMovedRef = useRef(false);

  /** Port of `Component#hitTestAll` (MindFlow.dc.html:2815-2836): what a canvas point lands
   * on, checked in the SAME priority order as the original (float > zone > line > node) —
   * this is a pure coordinate hit-test against the current doc/geometry, independent of
   * which DOM element the browser's `contextmenu` event actually targeted (matches the
   * original: a right-click doesn't even reach `onZoneDown`'s `e.button !== 0` guard, so
   * this is the ONLY way the menu learns what was clicked). */
  function hitTestAll(p: { x: number; y: number }): HitResult | null {
    const d = docRef.current;
    for (const f of d.floats) {
      const h = f.h || 44;
      if (p.x >= f.x && p.x <= f.x + f.w && p.y >= f.y && p.y <= f.y + h) return { kind: 'float', id: f.id };
    }
    for (const z of d.zones) {
      if (p.x >= z.x && p.x <= z.x + z.w && p.y >= z.y - 16 && p.y <= z.y + z.h) return { kind: 'zone', id: z.id };
    }
    for (const l of d.lines) {
      const geo = lineGeometryOf(l);
      for (let t = 0; t <= 1.0001; t += 0.04) {
        const bp = cubicAt(geo, t);
        if (Math.hypot(p.x - bp.x, p.y - bp.y) < 10) return { kind: 'line', id: l.id };
      }
    }
    const g = geomRef.current;
    for (const id in g) {
      const gg = g[id];
      if (!gg) continue;
      const pad = 4;
      if (p.x >= gg.x - gg.w / 2 - pad && p.x <= gg.x + gg.w / 2 + pad && p.y >= gg.y - gg.h / 2 - pad && p.y <= gg.y + gg.h / 2 + pad) return { kind: 'node', id };
    }
    return null;
  }

  /** Port of `Component#openCtxAt` (MindFlow.dc.html:2792-2813): hit-tests the right-clicked
   * canvas point, selects whatever it landed on (mirroring a plain click's selection-setting
   * side effect), and opens the matching menu `kind`. A right-click on an object that's already
   * part of an active multi-selection keeps the WHOLE group selected and opens the `'multi'`
   * menu instead (port of the `curM`/`inSel` check, MindFlow.dc.html:2797-2802). */
  function openCtxAt(clientX: number, clientY: number): void {
    const vp = viewportRef.current;
    const p = toCanvasPoint(clientX, clientY, vp);
    const el = viewportElRef.current;
    const r = el ? el.getBoundingClientRect() : { left: 0, top: 0 };
    const sx = clientX - r.left;
    const sy = clientY - r.top;
    const hit = hitTestAll(p);
    const ms = multiSelectionRef.current;
    if (ms && totalSelected(ms) > 1 && hit) {
      const inSel = (hit.kind === 'node' && ms.nodes.includes(hit.id)) || (hit.kind === 'float' && ms.floats.includes(hit.id)) || (hit.kind === 'line' && ms.lines.includes(hit.id));
      if (inSel) {
        setCtxSub(null);
        setCtxMenu({ kind: 'multi', sx, sy, cx: p.x, cy: p.y });
        return;
      }
    }
    if (hit && hit.kind === 'node') {
      setSelectionState({ kind: 'node', id: hit.id });
      setMultiSelectionState(null);
      setEditingFloatId(null);
      setCtxSub(null);
      setCtxMenu({ kind: 'node', sx, sy, cx: p.x, cy: p.y });
    } else if (hit && hit.kind === 'float') {
      setSelectionState({ kind: 'float', id: hit.id });
      setMultiSelectionState(null);
      setCtxSub(null);
      setCtxMenu({ kind: 'float', sx, sy, cx: p.x, cy: p.y });
    } else if (hit && hit.kind === 'line') {
      setSelectionState({ kind: 'line', id: hit.id });
      setMultiSelectionState(null);
      setCtxSub(null);
      setCtxMenu({ kind: 'line', sx, sy, cx: p.x, cy: p.y });
    } else if (hit && hit.kind === 'zone') {
      setSelectionState({ kind: 'zone', id: hit.id });
      setMultiSelectionState(null);
      setEditingFloatId(null);
      setCtxSub(null);
      setCtxMenu({ kind: 'zone', sx, sy, cx: p.x, cy: p.y });
    } else {
      setCtxSub(null);
      setCtxMenu({ kind: 'bg', sx, sy, cx: p.x, cy: p.y });
    }
  }

  const closeCtxMenu = useCallback(() => {
    setCtxMenu(null);
    setCtxSub(null);
  }, []);

  const toggleCtxSub = useCallback((top: number) => {
    setCtxSub((prev) => (prev ? null : { top }));
  }, []);

  /** Port of `Component#onCtxMenu` (MindFlow.dc.html:2775-2791), minus the rich-text-selection
   * `textCtx` branch (out of scope — see this file's top-of-module doc comment). */
  const onContextMenu = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (suppressCtxRef.current && Date.now() - suppressCtxRef.current < 300) {
      suppressCtxRef.current = 0;
      return;
    }
    if (dragRef.current || objDragRef.current) {
      pendingCtxRef.current = { x: e.clientX, y: e.clientY };
      return;
    }
    openCtxAt(e.clientX, e.clientY);
  }, []);

  // ---- presence: local pointer -> canvas coordinates -> throttled broadcast
  // (`usePresence.setCursor` does the actual throttling) — reuses the SAME
  // `toCanvasPoint` conversion as the marquee/drag machinery above, so a
  // remote cursor renders in exactly the space `PresenceLayer` (inside the
  // pan/zoom transform group) expects. ----
  const reportPointerPosition = useCallback(
    (clientX: number, clientY: number) => {
      presence.setCursor(toCanvasPoint(clientX, clientY, viewportRef.current));
    },
    [presence.setCursor],
  );
  const clearPointerPosition = useCallback(() => {
    presence.setCursor(null);
  }, [presence.setCursor]);

  // ---- fit-to-view (initial load + whenever a layout switch requests it) ----
  const pendingFitRef = useRef(true);
  const fitView = useCallback(() => {
    setViewport((prev) => {
      const ids = Object.keys(geom);
      if (!ids.length) return prev;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      ids.forEach((id) => {
        const g = geom[id];
        if (!g) return;
        minX = Math.min(minX, g.x - g.w / 2);
        maxX = Math.max(maxX, g.x + g.w / 2);
        minY = Math.min(minY, g.y - g.h / 2);
        maxY = Math.max(maxY, g.y + g.h / 2);
      });
      const bw = Math.max(1, maxX - minX);
      const bh = Math.max(1, maxY - minY);
      let z = Math.min((prev.vw - FIT_PADDING) / bw, (prev.vh - FIT_PADDING) / bh, 1.25);
      z = Math.max(MIN_ZOOM, z);
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      return { ...prev, zoom: z, pan: { x: prev.vw / 2 - cx * z, y: prev.vh / 2 - cy * z } };
    });
  }, [geom]);

  // Initial view (and re-view after a layout switch): center the ROOT node in
  // the viewport at a zoom that fits the whole map. The dc original + `fitView`
  // center the content's bounding-box midpoint, which for a one-sided layout
  // (right/down) leaves the root off to one edge; the product wants the top
  // shape front-and-center on entry, so we pan to the root specifically while
  // still scaling to fit everything. Falls back to the bbox center if the root
  // somehow isn't laid out.
  const centerOnRoot = useCallback(() => {
    setViewport((prev) => {
      const ids = Object.keys(geom);
      if (!ids.length) return prev;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      ids.forEach((id) => {
        const g = geom[id];
        if (!g) return;
        minX = Math.min(minX, g.x - g.w / 2);
        maxX = Math.max(maxX, g.x + g.w / 2);
        minY = Math.min(minY, g.y - g.h / 2);
        maxY = Math.max(maxY, g.y + g.h / 2);
      });
      const rootG = geom[ROOT_ID];
      const cx = rootG ? rootG.x : (minX + maxX) / 2;
      const cy = rootG ? rootG.y : (minY + maxY) / 2;
      // Zoom so the farthest content on either side of the root still fits when
      // the root is centered (half the viewport must cover the larger half-span
      // from the root), so nothing clips off an edge. Capped at 1.25×.
      const halfW = Math.max(cx - minX, maxX - cx, 1);
      const halfH = Math.max(cy - minY, maxY - cy, 1);
      let z = Math.min((prev.vw - FIT_PADDING) / (2 * halfW), (prev.vh - FIT_PADDING) / (2 * halfH), 1.25);
      z = Math.max(MIN_ZOOM, z);
      return { ...prev, zoom: z, pan: { x: prev.vw / 2 - cx * z, y: prev.vh / 2 - cy * z } };
    });
  }, [geom]);

  useEffect(() => {
    if (!pendingFitRef.current) return;
    if (!measured) return; // wait for the real canvas size before the first center
    if (!Object.keys(geom).length) return;
    if (viewport.vw <= 0 || viewport.vh <= 0) return;
    pendingFitRef.current = false;
    centerOnRoot();
  }, [geom, viewport.vw, viewport.vh, measured, centerOnRoot]);

  const setLayoutMode = useCallback(
    (mode: LayoutMode) => {
      pendingFitRef.current = true;
      commitDoc((prev) => (prev.layoutMode === mode ? prev : { ...prev, layoutMode: mode }));
    },
    [commitDoc],
  );

  const setEdgeStyle = useCallback((s: EdgeStyle) => {
    setEdgeStyleState(s);
    // Persist on the doc too (it's a serialized field now) so autosave picks it
    // up — `docSignature` includes `edgeStyle`, so this dirties the doc.
    setDoc((prev) => (prev.edgeStyle === s ? prev : { ...prev, edgeStyle: s }));
    const d = docRef.current;
    historyRef.current!.record({ nodes: d.nodes, floats: d.floats, lines: d.lines, zones: d.zones, layoutMode: d.layoutMode, edgeStyle: s }, false);
    setHistoryTick((t) => t + 1);
  }, []);

  const setThemeKey = useCallback((key: ThemeKey) => {
    // themeKey is intentionally NOT part of the undo snapshot (matches the
    // original's own asymmetry, MindFlow.dc.html:549) — plain state update.
    setDoc((prev) => (prev.themeKey === key ? prev : { ...prev, themeKey: key }));
  }, []);

  // ---- pan (background drag, right/middle button) + marquee (left button) + zoom (wheel / pinch)
  // — port of `Component#onBgDown` (MindFlow.dc.html:1650-1660): left-button background drag is a
  // rubber-band selection; right/middle-button drag pans (matches the bottom-left hint text). ----
  const dragRef = useRef<BgDrag | null>(null);
  const marqueeRectRef = useRef<MarqueeRect | null>(null);
  const pinchRef = useRef<{ dist: number; zoom: number; cx: number; cy: number } | null>(null);
  const activePointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  // Touch-only: on a phone, a one-finger press on an object records the object
  // here and lets the press bubble to the background pan handler instead of
  // selecting/dragging the object immediately. A drag then pans the canvas; a
  // no-move release (a tap) selects this object (see the pan branch of `onUp`).
  // This is why zoom/pan gestures that happen to start on an object no longer
  // grab it. Cleared at the end of every background gesture.
  const pendingTapRef = useRef<Selection | null>(null);
  // Touch long-press timer (see LONG_PRESS_MS): a stationary one-finger hold
  // opens the context menu like a desktop right-click.
  const longPressRef = useRef<{ timer: ReturnType<typeof setTimeout>; x0: number; y0: number } | null>(null);
  const cancelLongPress = (): void => {
    if (longPressRef.current) {
      clearTimeout(longPressRef.current.timer);
      longPressRef.current = null;
    }
  };

  const onBackgroundPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (activePointers.current.size === 2) {
      const pts = Array.from(activePointers.current.values());
      const [a, b] = pts;
      if (a && b) {
        const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        setViewport((prev) => {
          pinchRef.current = { dist, zoom: prev.zoom, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
          return prev;
        });
      }
      dragRef.current = null;
      marqueeRectRef.current = null;
      pendingTapRef.current = null; // a two-finger pinch is a zoom, not a tap-select
      cancelLongPress(); // …nor a long-press
      setMarquee(null);
      return;
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* not implemented in some environments (e.g. jsdom) — non-fatal */
    }
    // Middle/right-mouse OR a single-finger TOUCH drag pans. Touch has no
    // right-click and panning to navigate matters far more than rubber-band
    // selection on a phone, so a one-finger drag moves the canvas (two fingers
    // pinch-zoom, handled above); mouse keeps left=marquee / right·middle=pan.
    const isTouch = e.pointerType === 'touch';
    if (e.button === 1 || e.button === 2 || isTouch) {
      setViewport((prev) => {
        dragRef.current = { kind: 'pan', pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, startPan: prev.pan, moved: false, touch: isTouch };
        return prev;
      });
      if (isTouch) {
        // Arm the long-press: if the finger stays put for LONG_PRESS_MS, open
        // the context menu at the press point (right-click equivalent) and drop
        // the pending pan/tap so the finger-lift neither pans nor selects.
        const px = e.clientX;
        const py = e.clientY;
        cancelLongPress();
        const timer = setTimeout(() => {
          longPressRef.current = null;
          dragRef.current = null;
          pendingTapRef.current = null;
          openCtxAt(px, py);
        }, LONG_PRESS_MS);
        longPressRef.current = { timer, x0: px, y0: py };
      }
      return;
    }
    const vp = viewportRef.current;
    const p = toCanvasPoint(e.clientX, e.clientY, vp);
    dragRef.current = { kind: 'marquee', pointerId: e.pointerId, startClientX: e.clientX, startClientY: e.clientY, x0: p.x, y0: p.y, moved: false };
    marqueeRectRef.current = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    setMarquee(marqueeRectRef.current);
  }, []);

  useEffect(() => {
    function onMove(e: PointerEvent): void {
      if (activePointers.current.has(e.pointerId)) {
        activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }
      // moving past the tolerance turns the gesture into a pan → not a long-press
      if (longPressRef.current) {
        const lp = longPressRef.current;
        if (Math.abs(e.clientX - lp.x0) + Math.abs(e.clientY - lp.y0) > LONG_PRESS_MOVE_TOL) cancelLongPress();
      }
      if (activePointers.current.size === 2 && pinchRef.current) {
        const pts = Array.from(activePointers.current.values());
        const [a, b] = pts;
        if (!a || !b) return;
        const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const pinch = pinchRef.current;
        const nz = (pinch.zoom * dist) / pinch.dist;
        setViewport((prev) => zoomAtState(prev, nz, pinch.cx, pinch.cy));
        return;
      }
      const d = dragRef.current;
      if (!d || d.pointerId !== e.pointerId) return;
      if (d.kind === 'pan') {
        const dx = e.clientX - d.sx;
        const dy = e.clientY - d.sy;
        // port of `Component#onMove`'s pan branch's `if (Math.abs(dx)+Math.abs(dy)>3) d.moved = true`
        // (MindFlow.dc.html:1716) — gates whether a right-click-drag suppresses the context menu.
        if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
        setViewport((prev) => ({ ...prev, pan: { x: d.startPan.x + dx, y: d.startPan.y + dy } }));
        return;
      }
      // marquee
      d.moved = d.moved || Math.abs(e.clientX - d.startClientX) + Math.abs(e.clientY - d.startClientY) > 4;
      const p = toCanvasPoint(e.clientX, e.clientY, viewportRef.current);
      marqueeRectRef.current = { x0: d.x0, y0: d.y0, x1: p.x, y1: p.y };
      setMarquee(marqueeRectRef.current);
    }
    function onUp(e: PointerEvent): void {
      activePointers.current.delete(e.pointerId);
      if (activePointers.current.size < 2) pinchRef.current = null;
      cancelLongPress(); // a release before the hold elapsed is a tap, not a long-press
      const d = dragRef.current;
      if (!d || d.pointerId !== e.pointerId) return;
      dragRef.current = null;
      // deferred right-click menu (macOS fires `contextmenu` at mousedown, while `dragRef`/
      // `objDragRef` is still live): open now, but only if the pointer never moved — port of
      // `Component#onUp`'s generic `_pendingCtx`/`_suppressCtx` handling (MindFlow.dc.html:1778-1780).
      if (d.kind === 'pan' && d.moved) suppressCtxRef.current = Date.now();
      if (pendingCtxRef.current) {
        const pc = pendingCtxRef.current;
        pendingCtxRef.current = null;
        if (!d.moved) openCtxAt(pc.x, pc.y);
      }
      if (d.kind === 'pan') {
        // A no-move TOUCH tap selects on release (touch uses pan for one-finger
        // drag; a press that started on an object stashed it in `pendingTapRef`).
        // Tap on an object → select it; tap on empty background → deselect. A
        // press that MOVED was a pan gesture, so it selects nothing. Mouse
        // right/middle click keeps the original behavior (no deselect — it may
        // be opening the context menu).
        const tap = pendingTapRef.current;
        pendingTapRef.current = null;
        if (d.touch && !d.moved) {
          // Swallow the trailing compatibility mouse `click` the browser fires
          // after a touch tap: it lands at the tap point, which the freshly-
          // opened bottom-sheet property panel may now cover — otherwise it
          // "ghost-clicks" a panel control (e.g. auto-expands the first
          // section). See the capture-phase click guard below.
          suppressGhostClickRef.current = Date.now() + 500;
          if (tap) {
            setSelectionState(tap);
            setMultiSelectionState(null);
            setEditingNodeId(null);
            setEditingFloatId(null);
          } else {
            setSelectionState(null);
            setMultiSelectionState(null);
          }
        }
        return;
      }
      const mq = marqueeRectRef.current;
      marqueeRectRef.current = null;
      setMarquee(null);
      if (!d.moved || !mq) {
        setSelectionState(null);
        setMultiSelectionState(null);
        return;
      }
      const rx0 = Math.min(mq.x0, mq.x1);
      const rx1 = Math.max(mq.x0, mq.x1);
      const ry0 = Math.min(mq.y0, mq.y1);
      const ry1 = Math.max(mq.y0, mq.y1);
      const hit = (cx: number, cy: number, hw: number, hh: number): boolean => cx + hw >= rx0 && cx - hw <= rx1 && cy + hh >= ry0 && cy - hh <= ry1;
      const nodes: string[] = [];
      const g = geomRef.current;
      for (const id in g) {
        const gg = g[id];
        if (gg && hit(gg.x, gg.y, gg.w / 2, gg.h / 2)) nodes.push(id);
      }
      const floats: string[] = [];
      docRef.current.floats.forEach((f) => {
        const h = f.h || 44; // approximates the original's measured `_floatH` (no DOM ref here)
        if (hit(f.x + f.w / 2, f.y + h / 2, f.w / 2, h / 2)) floats.push(f.id);
      });
      const lines: string[] = [];
      docRef.current.lines.forEach((l) => {
        // sample the cubic bezier: select if ANY part of the line is inside the rect
        // (matches `Component#onUp`'s marquee branch, MindFlow.dc.html:1841-1851)
        const geo = lineGeometryOf(l);
        let hitLine = false;
        for (let t = 0; t <= 1.0001; t += 0.05) {
          const bp = cubicAt(geo, t);
          if (bp.x >= rx0 && bp.x <= rx1 && bp.y >= ry0 && bp.y <= ry1) {
            hitLine = true;
            break;
          }
        }
        if (hitLine) lines.push(l.id);
      });
      if (!nodes.length && !floats.length && !lines.length) {
        setSelectionState(null);
        setMultiSelectionState(null);
      } else {
        setSelectionState(null);
        setMultiSelectionState({ nodes, lines, floats });
        setEditingNodeId(null);
        setEditingFloatId(null);
      }
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      cancelLongPress();
    };
  }, []);

  // Ghost-click guard: after a touch tap-select (see `onUp`), the browser fires
  // one compatibility `click` at the tap point ~immediately. The property panel
  // that just opened (mobile bottom sheet) can sit under that point, so the
  // click would activate a panel control unintentionally. Swallow that single
  // click in the capture phase, once, within the short window.
  useEffect(() => {
    const onClickCapture = (e: MouseEvent): void => {
      if (suppressGhostClickRef.current && Date.now() < suppressGhostClickRef.current) {
        suppressGhostClickRef.current = 0;
        e.stopPropagation();
        e.preventDefault();
      }
    };
    window.addEventListener('click', onClickCapture, true);
    return () => window.removeEventListener('click', onClickCapture, true);
  }, []);

  // native (non-passive) wheel listener — mirrors `Component#onWheel`
  // (MindFlow.dc.html:1857-1876): ctrl/meta+wheel or pinch = zoom at cursor,
  // trackpad two-finger scroll = pan, plain wheel = zoom.
  useEffect(() => {
    const el = viewportElRef.current;
    if (!el) return;
    const handler = (e: WheelEvent): void => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * 0.011);
        setViewport((prev) => zoomAtState(prev, prev.zoom * factor, sx, sy));
        return;
      }
      const isTrackpad = e.deltaMode === 0 && (e.deltaX !== 0 || (Math.abs(e.deltaY) < 40 && !Number.isInteger(e.deltaY)) || Math.abs(e.deltaY) < 16);
      if (isTrackpad) {
        setViewport((prev) => ({ ...prev, pan: { x: prev.pan.x - e.deltaX, y: prev.pan.y - e.deltaY } }));
        return;
      }
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      setViewport((prev) => zoomAtState(prev, prev.zoom * factor, sx, sy));
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [viewportElRef.current]);

  const zoomIn = useCallback(() => {
    setViewport((prev) => zoomAtState(prev, prev.zoom * 1.2, prev.vw / 2, prev.vh / 2));
  }, []);
  const zoomOut = useCallback(() => {
    setViewport((prev) => zoomAtState(prev, prev.zoom / 1.2, prev.vw / 2, prev.vh / 2));
  }, []);

  // ---- save (manual + debounced autosave) — port of `saveDoc`/`scheduleAutoSave`/`saveNow`
  // (MindFlow.dc.html:537-543, 598-602), M4: routed through `DocStore.save()` with
  // `docVersionRef` as the optimistic-lock token instead of a raw `localStorage.setItem` ----
  const lastSavedSigRef = useRef(docSignature(doc));
  const autosaveTimerRef = useRef<number | undefined>(undefined);
  const savingTimerRef = useRef<number | undefined>(undefined);

  /** Writes the current doc via `DocStore.save()`. On a version conflict (another
   * tab/device saved first), adopts the server's version as the new base — so the
   * NEXT save attempt targets the right row — and surfaces `saveConflict` so the UI
   * has a place to tell the user (`DocChip`'s banner); this is intentionally NOT a
   * full merge/reload flow (out of scope here, see CLAUDE.md's M4 task brief). */
  const persistDoc = useCallback(async (): Promise<void> => {
    const title = safeDocTitle(docRef.current, titleParam);
    const result = await docStore.save(docStoreId, docRef.current, { prevVersion: docVersionRef.current, title });
    if (result.ok) {
      docVersionRef.current = result.version;
      lastSavedSigRef.current = docSignature(docRef.current);
      setSaveStateState('saved');
      setSaveConflict(null);
    } else if (result.reason === 'conflict') {
      docVersionRef.current = result.currentVersion;
      setSaveConflict({ currentVersion: result.currentVersion });
      setSaveStateState('saved');
    } else {
      setSaveStateState('dirty'); // keep dirty so the next autosave/Ctrl+S tick retries
    }
  }, [docStore, docStoreId, titleParam]);

  useEffect(() => {
    const sig = docSignature(doc);
    if (sig === lastSavedSigRef.current) return;
    setSaveStateState('dirty');
    window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = window.setTimeout(() => {
      setSaveStateState('saving');
      window.clearTimeout(savingTimerRef.current);
      savingTimerRef.current = window.setTimeout(() => {
        void persistDoc();
      }, 250);
    }, 900);
    return () => window.clearTimeout(autosaveTimerRef.current);
  }, [doc, persistDoc]);

  const saveNow = useCallback(() => {
    window.clearTimeout(autosaveTimerRef.current);
    window.clearTimeout(savingTimerRef.current);
    setSaveStateState('saving');
    savingTimerRef.current = window.setTimeout(() => {
      void persistDoc();
    }, 200);
  }, [persistDoc]);

  const dismissSaveConflict = useCallback(() => setSaveConflict(null), []);

  const goHome = useCallback(() => {
    window.clearTimeout(autosaveTimerRef.current);
    window.clearTimeout(savingTimerRef.current);
    // Fire-and-forget: for `LocalDocStore` the write is synchronous under the
    // hood (plain `localStorage.setItem`), so it's already applied by the time
    // this function returns even though `persistDoc` itself is `async`. For a
    // real network backend this is best-effort — the debounced autosave above
    // already keeps saves close to real-time, matching this app's existing
    // "don't block navigation on save" behavior.
    void persistDoc();
    navigate('/home');
  }, [navigate, persistDoc]);

  // ---- selection ----
  const selectNode = useCallback((id: string) => {
    setSelectionState({ kind: 'node', id });
    setMultiSelectionState(null);
  }, []);
  const selectFloat = useCallback((id: string) => {
    setSelectionState({ kind: 'float', id });
    setMultiSelectionState(null);
  }, []);
  const selectLine = useCallback((id: string) => {
    setSelectionState({ kind: 'line', id });
    setMultiSelectionState(null);
  }, []);
  const selectZone = useCallback((id: string) => {
    setSelectionState({ kind: 'zone', id });
    setMultiSelectionState(null);
  }, []);
  /** Clears BOTH the single selection and any active marquee multi-selection — the
   * React-hook counterpart of `Component#clearAllSel` (MindFlow.dc.html:1581), also used
   * for the plain Escape/background-click "deselect everything" gesture. */
  const clearSelection = useCallback(() => {
    setSelectionState(null);
    setMultiSelectionState(null);
  }, []);

  // ---- arrow-key node navigation — port of `Component#navigate`/`#selectAndReveal`
  // (MindFlow.dc.html:2058-2094). `selectAndReveal` selects a node and pans it into
  // view when it lands off-screen (80px margin); `navigateNodes` picks the nearest
  // node in the pressed direction via the original's directional-cone scoring. ----
  const selectAndReveal = useCallback(
    (id: string) => {
      selectNode(id);
      const g = geomRef.current[id];
      if (!g) return;
      setViewport((prev) => {
        const sx = g.x * prev.zoom + prev.pan.x;
        const sy = g.y * prev.zoom + prev.pan.y;
        const m = 80;
        let nx = prev.pan.x;
        let ny = prev.pan.y;
        let need = false;
        if (sx < m) {
          nx = prev.pan.x + (m - sx);
          need = true;
        } else if (sx > prev.vw - m) {
          nx = prev.pan.x - (sx - (prev.vw - m));
          need = true;
        }
        if (sy < m) {
          ny = prev.pan.y + (m - sy);
          need = true;
        } else if (sy > prev.vh - m) {
          ny = prev.pan.y - (sy - (prev.vh - m));
          need = true;
        }
        return need ? { ...prev, pan: { x: nx, y: ny } } : prev;
      });
    },
    [selectNode],
  );
  const navigateNodes = useCallback(
    (fromId: string | null, dir: 'up' | 'down' | 'left' | 'right') => {
      const g = geomRef.current;
      const ids = Object.keys(g);
      if (!ids.length) return;
      // no current node selection → land on root (matches the dc original)
      if (!fromId || !g[fromId]) {
        const target = g[ROOT_ID] ? ROOT_ID : ids[0];
        if (target) selectAndReveal(target);
        return;
      }
      const a = g[fromId];
      let best: string | null = null;
      let bestScore = Infinity;
      ids.forEach((id) => {
        if (id === fromId) return;
        const b = g[id];
        if (!b) return;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        let along: number;
        let perp: number;
        let ok: boolean;
        if (dir === 'left') {
          ok = dx < -1;
          along = -dx;
          perp = Math.abs(dy);
        } else if (dir === 'right') {
          ok = dx > 1;
          along = dx;
          perp = Math.abs(dy);
        } else if (dir === 'up') {
          ok = dy < -1;
          along = -dy;
          perp = Math.abs(dx);
        } else {
          ok = dy > 1;
          along = dy;
          perp = Math.abs(dx);
        }
        if (!ok) return;
        // keep movement within a directional cone so it feels like the arrow pressed
        if (perp > along * 2 + 60) return;
        const score = along + perp * 2.2;
        if (score < bestScore) {
          bestScore = score;
          best = id;
        }
      });
      if (best) selectAndReveal(best);
    },
    [selectAndReveal],
  );

  const isKind = (kind: SelectionKind): string | null => (selection && selection.kind === kind ? selection.id : null);

  // ---- text editing ----
  const startEditNode = useCallback((id: string) => {
    setTitleError(null);
    setSelectionState({ kind: 'node', id });
    setMultiSelectionState(null);
    setEditingNodeId(id);
    setEditLiveSize(null);
    setTextCtx(null);
  }, []);
  /** Re-measure the node being edited from its live `contentEditable` content and
   * store the result so the box tracks the text as the user types (WYSIWYG). Runs
   * on every input in `NodeEditBox`; uses the same `computeMetrics` the commit/layout
   * path uses, so the editing box size matches the committed size exactly. */
  const updateNodeEditSize = useCallback(
    (id: string, el: HTMLElement | null) => {
      if (!el) return;
      const base = docRef.current.nodes[id];
      if (!base) return;
      const depth = geomRef.current[id]?.depth ?? (id === ROOT_ID ? 0 : 1);
      const parsed = domToRuns(el);
      const liveNode: Node = { ...base, text: parsed.text, rich: parsed.rich };
      const m = computeMetrics(liveNode, depth, measurer);
      setEditLiveSize((prev) => (prev && prev.w === m.w && prev.h === m.h ? prev : { w: m.w, h: m.h }));
    },
    [measurer],
  );
  // The ROOT node's text IS the map's filename, so any edit that renames it —
  // the title chip OR the on-canvas root node — must not collide with another
  // map's name. Returns true when `next` would duplicate an existing title.
  const wouldDuplicateTitle = useCallback((next: string): boolean => {
    const t = String(next || '').trim();
    const cur = (docRef.current.nodes[ROOT_ID]?.text || '').trim();
    return !!t && t !== cur && otherTitlesRef.current.has(t);
  }, []);
  const commitNodeText = useCallback(
    (id: string, text: string) => {
      if (id === ROOT_ID && wouldDuplicateTitle(text)) {
        setTitleError(`이미 "${String(text).trim()}" 이름의 맵이 있어요`);
        setEditingNodeId(null);
        return;
      }
      commitDoc((d) => ({ ...d, nodes: mutations.commitNodeText(d.nodes, id, text) }));
      setEditingNodeId(null);
    },
    [commitDoc, wouldDuplicateTitle],
  );
  /** Port of `Component#commitRichEdit` (MindFlow.dc.html:2629-2643) — reads the live
   * `contentEditable` DOM (`el`) via `domToRuns` and commits BOTH `text` and `rich`
   * in one `commitDoc` step. `el` is `null` when the box unmounted out from under the
   * commit (matches the original's own `if (!el) { ...; return; }` guard). */
  const commitNodeRichText = useCallback(
    (id: string, el: HTMLElement | null) => {
      if (!el) {
        setEditingNodeId(null);
        setEditLiveSize(null);
        setTextCtx(null);
        return;
      }
      const parsed = domToRuns(el);
      if (id === ROOT_ID && wouldDuplicateTitle(parsed.text)) {
        setTitleError(`이미 "${parsed.text.trim()}" 이름의 맵이 있어요`);
        setEditingNodeId(null);
        setEditLiveSize(null);
        setTextCtx(null);
        return;
      }
      commitDoc((d) => ({ ...d, nodes: mutations.commitNodeRichText(d.nodes, id, parsed.text, parsed.rich) }));
      setEditingNodeId(null);
      setEditLiveSize(null);
      setTextCtx(null);
      // A free shape whose box just grew may now overlap a neighbour — flag it for
      // the nudge effect (fires once editing clears + geom reflects the new size).
      pendingNudgeRef.current = id;
    },
    [commitDoc, wouldDuplicateTitle],
  );
  const cancelNodeEdit = useCallback(() => {
    setEditingNodeId(null);
    setEditLiveSize(null);
    setTextCtx(null);
  }, []);

  // ---- floating partial-style toolbar ----
  const openTextCtx = useCallback((sx: number, sy: number) => setTextCtx({ sx, sy }), []);
  const closeTextCtx = useCallback(() => setTextCtx(null), []);
  /** Port of `Component#applyPartial` (MindFlow.dc.html:2701-2725) — DOM-only (see the
   * interface doc comment above): reads the registered rich editor's CURRENT Selection
   * + DOM content (not `doc.nodes[id].rich`, which is stale mid-edit — the box's
   * `contentEditable` innerHTML is only ever seeded once, on mount, same as the original's
   * `data-init` guard), applies the style via `@mindflow/mindmap-core`'s `applyPartialStyle`,
   * rewrites the innerHTML, and restores the selection so consecutive style clicks on the
   * same span keep working. */
  const applyPartial = useCallback((kind: 'b' | 'c' | 'clear', val?: string | null) => {
    const ed = richElRef.current;
    if (!ed) return;
    const ws = window.getSelection();
    if (!ws || !ws.rangeCount) return;
    const rng = ws.getRangeAt(0);
    const lin = linearize(ed, [
      { container: rng.startContainer, offset: rng.startOffset },
      { container: rng.endContainer, offset: rng.endOffset },
    ]);
    const a = lin.pos[0] ?? 0;
    const b = lin.pos[1] ?? 0;
    const parsed = domToRuns(ed);
    const next = applyPartialStyle(parsed, a, b, kind, val ?? null);
    ed.innerHTML = runsToHtml(next);
    setLinearSelection(ed, Math.min(a, b), Math.max(a, b));
  }, []);

  const startEditFloat = useCallback((id: string) => {
    setSelectionState({ kind: 'float', id });
    setMultiSelectionState(null);
    setEditingFloatId(id);
  }, []);
  const commitFloatText = useCallback(
    (id: string, text: string) => {
      commitDoc((d) => ({ ...d, floats: mutations.updateFloatItem(d.floats, id, { text }) }));
      setEditingFloatId(null);
    },
    [commitDoc],
  );
  const cancelFloatEdit = useCallback(() => setEditingFloatId(null), []);

  const startEditLineLabel = useCallback((id: string) => {
    setSelectionState({ kind: 'line', id });
    setMultiSelectionState(null);
    setEditingLineId(id);
  }, []);
  const commitLineLabel = useCallback(
    (id: string, text: string) => {
      commitDoc((d) => ({ ...d, lines: mutations.updateLineItem(d.lines, id, { label: (text || '').slice(0, 20) }) }));
      setEditingLineId(null);
    },
    [commitDoc],
  );
  const cancelLineLabelEdit = useCallback(() => setEditingLineId(null), []);

  const startEditZoneLabel = useCallback((id: string) => {
    setSelectionState({ kind: 'zone', id });
    setMultiSelectionState(null);
    setEditingZoneId(id);
  }, []);
  const commitZoneLabel = useCallback(
    (id: string, text: string) => {
      commitDoc((d) => ({ ...d, zones: mutations.updateZoneItem(d.zones, id, { label: String(text || '').slice(0, 24) }) }));
      setEditingZoneId(null);
    },
    [commitDoc],
  );
  const cancelZoneLabelEdit = useCallback(() => setEditingZoneId(null), []);

  const startEditTitle = useCallback(() => {
    setTitleError(null);
    setEditingTitle(true);
  }, []);
  const commitTitle = useCallback(
    (text: string) => {
      // Renaming to another map's existing filename isn't allowed — keep the
      // current title and tell the user. (An unchanged/empty edit falls through
      // to `commitRootTitle`, which restores the fallback when text is blank.)
      if (wouldDuplicateTitle(text)) {
        setTitleError(`이미 "${String(text).trim()}" 이름의 맵이 있어요`);
        setEditingTitle(false);
        return;
      }
      setTitleError(null);
      commitDoc((d) => ({ ...d, nodes: mutations.commitRootTitle(d.nodes, text, titleParam) }));
      setEditingTitle(false);
    },
    [commitDoc, titleParam, wouldDuplicateTitle],
  );
  const cancelTitleEdit = useCallback(() => setEditingTitle(false), []);
  const dismissTitleError = useCallback(() => setTitleError(null), []);

  // ---- structural ----
  const addChild = useCallback(() => {
    const id = isKind('node');
    if (!id) return;
    const newId = idFactory('x');
    commitDoc((d) => ({ ...d, nodes: mutations.addChildNode(d.nodes, id, newId) }));
    setSelectionState({ kind: 'node', id: newId });
    setEditingNodeId(newId);
  }, [selection, commitDoc]);

  const addSibling = useCallback(() => {
    const id = isKind('node');
    if (!id) return;
    const newId = idFactory('x');
    commitDoc((d) => {
      const next = mutations.addSiblingNode(d.nodes, id, newId);
      if (next) return { ...d, nodes: next };
      return { ...d, nodes: mutations.addChildNode(d.nodes, ROOT_ID, newId) };
    });
    setSelectionState({ kind: 'node', id: newId });
    setEditingNodeId(newId);
  }, [selection, commitDoc]);

  const deleteSelection = useCallback(() => {
    // multi-select bulk delete — port of `Component#deleteMulti` (MindFlow.dc.html:1595-1610):
    // every targeted node's subtree + every targeted line/float, in one undo step.
    if (multiSelection && totalSelected(multiSelection) > 1) {
      const ms = multiSelection;
      commitDoc((d) => ({
        ...d,
        nodes: mutations.deleteNodesMulti(d.nodes, ms.nodes),
        lines: d.lines.filter((l) => !ms.lines.includes(l.id)),
        floats: d.floats.filter((f) => !ms.floats.includes(f.id)),
      }));
      setMultiSelectionState(null);
      setSelectionState(null);
      setEditingNodeId(null);
      setEditingFloatId(null);
      return;
    }
    if (!selection) return;
    if (selection.kind === 'node') {
      if (selection.id === ROOT_ID) return;
      const id = selection.id;
      commitDoc((d) => {
        const res = mutations.deleteNodeSubtree(d.nodes, id);
        if (!res) return d;
        setSelectionState({ kind: 'node', id: res.nextSelected });
        return { ...d, nodes: res.nodes };
      });
      setEditingNodeId(null);
    } else if (selection.kind === 'float') {
      commitDoc((d) => ({ ...d, floats: mutations.removeFloatItem(d.floats, selection.id) }));
      setSelectionState(null);
      setEditingFloatId(null);
    } else if (selection.kind === 'line') {
      commitDoc((d) => ({ ...d, lines: mutations.removeLineItem(d.lines, selection.id) }));
      setSelectionState(null);
    } else if (selection.kind === 'zone') {
      commitDoc((d) => ({ ...d, zones: mutations.removeZoneItem(d.zones, selection.id) }));
      setSelectionState(null);
      setEditingZoneId(null);
    }
  }, [selection, multiSelection, commitDoc]);

  const toggleCollapse = useCallback(
    (id: string) => {
      commitDoc((d) => ({ ...d, nodes: mutations.toggleCollapseNode(d.nodes, id) }));
    },
    [commitDoc],
  );

  const addFreeNodeAt = useCallback(
    (at?: { x: number; y: number }) => {
      // an explicit `at` (the bg context menu's "도형 추가") lands EXACTLY there, no stagger —
      // port of `Component#addFreeNode`'s `px != null` branch (MindFlow.dc.html:2122-2128).
      let cx: number;
      let cy: number;
      if (at) {
        cx = at.x;
        cy = at.y;
      } else {
        const vp = viewportRef.current;
        const stagger = (Object.keys(docRef.current.nodes).length % 6) * 20;
        cx = (vp.vw / 2 - vp.pan.x) / vp.zoom + stagger;
        cy = (vp.vh / 2 - vp.pan.y) / vp.zoom - 130 + stagger;
      }
      const newId = idFactory('x');
      commitDoc((d) => ({ ...d, nodes: mutations.addFreeShapeNode(d.nodes, newId, cx, cy) }));
      setSelectionState({ kind: 'node', id: newId });
      setMultiSelectionState(null);
      setEditingNodeId(newId);
      // separate it from any shape it was staggered on top of, once its edit ends
      pendingNudgeRef.current = newId;
    },
    [commitDoc, idFactory],
  );

  const addFloatAt = useCallback(
    (at?: { x: number; y: number }) => {
      // port of `Component#addFloat`'s `px != null` branch (MindFlow.dc.html:2253-2258): an
      // explicit spot is used as-is (no `-90/+150` viewport-center offset, no stagger).
      let cx: number;
      let cy: number;
      if (at) {
        cx = at.x;
        cy = at.y;
      } else {
        const vp = viewportRef.current;
        const stagger = (docRef.current.floats.length % 6) * 22;
        cx = (vp.vw / 2 - vp.pan.x) / vp.zoom - 90 + stagger;
        cy = (vp.vh / 2 - vp.pan.y) / vp.zoom + 150 + stagger;
      }
      const newId = idFactory('f');
      commitDoc((d) => ({ ...d, floats: mutations.addFloatItem(d.floats, newId, cx, cy) }));
      setSelectionState({ kind: 'float', id: newId });
      setMultiSelectionState(null);
      setEditingFloatId(newId);
    },
    [commitDoc, idFactory],
  );

  const addLineAt = useCallback(
    (at?: { x: number; y: number }) => {
      // port of `Component#addLine`'s `px != null` branch (MindFlow.dc.html:2455-2459): the
      // `off` stagger is skipped entirely when an explicit spot is given.
      let cx: number;
      let cy: number;
      let off = 0;
      if (at) {
        cx = at.x;
        cy = at.y;
      } else {
        const vp = viewportRef.current;
        cx = (vp.vw / 2 - vp.pan.x) / vp.zoom;
        cy = (vp.vh / 2 - vp.pan.y) / vp.zoom;
        off = (docRef.current.lines.length % 5) * 22;
      }
      const newId = idFactory('l');
      commitDoc((d) => ({ ...d, lines: mutations.addLineItem(d.lines, newId, cx - 90, cy + off, cx + 90, cy + off) }));
      setSelectionState({ kind: 'line', id: newId });
      setMultiSelectionState(null);
    },
    [commitDoc, idFactory],
  );

  const addZoneAt = useCallback(
    (at?: { x: number; y: number }) => {
      // port of `Component#addZone`'s `px != null` branch (MindFlow.dc.html:2296-2298): an
      // explicit spot is used as-is (no `-170/-110` viewport-center offset).
      let cx: number;
      let cy: number;
      if (at) {
        cx = at.x;
        cy = at.y;
      } else {
        const vp = viewportRef.current;
        cx = (vp.vw / 2 - vp.pan.x) / vp.zoom - 170;
        cy = (vp.vh / 2 - vp.pan.y) / vp.zoom - 110;
      }
      const newId = idFactory('z');
      commitDoc((d) => ({ ...d, zones: mutations.addZoneItem(d.zones, newId, cx, cy) }));
      setSelectionState({ kind: 'zone', id: newId });
      setMultiSelectionState(null);
    },
    [commitDoc, idFactory],
  );

  // ---- node property setters — bulk-aware (port of `nodeTargets()`-driven setters,
  // MindFlow.dc.html:2545-2555, 2730-2731): with a single node selected, `nodeTargetIds()`
  // is just `[selection.id]`, so this is behavior-identical to the pre-Editor-c single-select
  // path; with a marquee multi-selection active, the same setter applies to every target. ----
  const setShape = useCallback((shape: string) => commitDoc((d) => ({ ...d, nodes: mutations.setNodesField(d.nodes, nodeTargetIds(), 'shape', shape) })), [nodeTargetIds, commitDoc]);
  const setColor = useCallback((hex: string | null) => commitDoc((d) => ({ ...d, nodes: mutations.setNodesField(d.nodes, nodeTargetIds(), 'color', hex) })), [nodeTargetIds, commitDoc]);
  const setFill = useCallback((hex: string | null) => commitDoc((d) => ({ ...d, nodes: mutations.setNodesField(d.nodes, nodeTargetIds(), 'fill', hex) })), [nodeTargetIds, commitDoc]);
  const setStroke = useCallback((hex: string | null) => commitDoc((d) => ({ ...d, nodes: mutations.setNodesField(d.nodes, nodeTargetIds(), 'stroke', hex) })), [nodeTargetIds, commitDoc]);
  const setFillAlpha = useCallback((a: number) => commitDoc((d) => ({ ...d, nodes: mutations.setNodesField(d.nodes, nodeTargetIds(), 'fillA', a) }), true), [nodeTargetIds, commitDoc]);
  const setStrokeAlpha = useCallback((a: number) => commitDoc((d) => ({ ...d, nodes: mutations.setNodesField(d.nodes, nodeTargetIds(), 'strokeA', a) }), true), [nodeTargetIds, commitDoc]);
  const setTextColor = useCallback((hex: string | null) => commitDoc((d) => ({ ...d, nodes: mutations.setNodesField(d.nodes, nodeTargetIds(), 'textColor', hex) })), [nodeTargetIds, commitDoc]);
  const toggleNodeBold = useCallback(() => commitDoc((d) => ({ ...d, nodes: mutations.toggleNodesBold(d.nodes, nodeTargetIds()) })), [nodeTargetIds, commitDoc]);
  const setNodeTsize = useCallback(
    (v: 's' | 'm' | 'l') => commitDoc((d) => ({ ...d, nodes: mutations.setNodesField(d.nodes, nodeTargetIds(), 'tsize', v === 'm' ? undefined : v) })),
    [nodeTargetIds, commitDoc],
  );
  const setEmoji = useCallback((e: string) => commitDoc((d) => ({ ...d, nodes: mutations.toggleNodesEmoji(d.nodes, nodeTargetIds(), e) })), [nodeTargetIds, commitDoc]);
  const clearEmoji = useCallback(() => commitDoc((d) => ({ ...d, nodes: mutations.setNodesField(d.nodes, nodeTargetIds(), 'emoji', '') })), [nodeTargetIds, commitDoc]);
  // note stays single-selection-only (the panel only renders it under `singleNodeSel`), matching
  // the original's own `onNoteInput` binding directly to `this.state.selectedId` (MindFlow.dc.html:3085).
  const setNote = useCallback(
    (text: string) => {
      const id = isKind('node');
      if (id) commitDoc((d) => ({ ...d, nodes: mutations.setNodeField(d.nodes, id, 'note', text) }));
    },
    [selection, commitDoc],
  );
  // port of `Component#setTextAlign` (MindFlow.dc.html:2773) — the context menu's "텍스트 정렬"
  // flyout (`ContextMenu.tsx`) is its only caller; bulk-aware like `setShape` above.
  const setTextAlign = useCallback(
    (v: 'left' | 'center' | 'right') => commitDoc((d) => ({ ...d, nodes: mutations.setNodesField(d.nodes, nodeTargetIds(), 'align', v) })),
    [nodeTargetIds, commitDoc],
  );

  // ---- float property setters — bulk-aware style setters (port of `Component#applyFloatText`-backed
  // setters, MindFlow.dc.html:2733-2737) + per-instance actions (toggleFloatCollapse/deleteFloat stay
  // single-id: they act on the specific float box clicked, not the whole selection). ----
  const setFloatBg = useCallback((hex: string | null) => commitDoc((d) => ({ ...d, floats: mutations.updateFloatItems(d.floats, floatTargetIds(), { bg: hex ?? undefined }) })), [floatTargetIds, commitDoc]);
  const toggleFloatBold = useCallback(() => {
    const ids = floatTargetIds();
    const first = ids[0];
    if (!first) return;
    const cur = !!docRef.current.floats.find((f) => f.id === first)?.bold;
    commitDoc((d) => ({ ...d, floats: mutations.updateFloatItems(d.floats, ids, { bold: !cur }) }));
  }, [floatTargetIds, commitDoc]);
  const setFloatTsize = useCallback(
    (v: 's' | 'm' | 'l') => commitDoc((d) => ({ ...d, floats: mutations.updateFloatItems(d.floats, floatTargetIds(), { tsize: v === 'm' ? undefined : v }) })),
    [floatTargetIds, commitDoc],
  );
  const setFloatTextColor = useCallback(
    (hex: string | null) => commitDoc((d) => ({ ...d, floats: mutations.updateFloatItems(d.floats, floatTargetIds(), { textColor: hex ?? undefined }) })),
    [floatTargetIds, commitDoc],
  );
  const toggleFloatCollapse = useCallback(
    (id: string) => commitDoc((d) => ({ ...d, floats: mutations.updateFloatItem(d.floats, id, { collapsed: !d.floats.find((f) => f.id === id)?.collapsed }) })),
    [commitDoc],
  );
  const deleteFloat = useCallback(
    (id: string) => {
      commitDoc((d) => ({ ...d, floats: mutations.removeFloatItem(d.floats, id) }));
      setSelectionState(null);
      setEditingFloatId(null);
    },
    [commitDoc],
  );

  // ---- line property setters — bulk-aware style setters (port of `Component#applyLineText`-backed
  // setters, MindFlow.dc.html:2738-2741) except `setLineCurve` (single-reference only, matching the
  // original's own `setLineCurveN(selL.id, ...)`, MindFlow.dc.html:3078-3079) and `deleteLine` (per-id). ----
  const setLineDashed = useCallback((v: boolean) => commitDoc((d) => ({ ...d, lines: mutations.updateLineItems(d.lines, lineTargetIds(), { dashed: v }) })), [lineTargetIds, commitDoc]);
  const setLineArrow = useCallback(
    (which: LineHandle, v: boolean) => commitDoc((d) => ({ ...d, lines: mutations.updateLineItems(d.lines, lineTargetIds(), which === 1 ? { startArrow: v } : { endArrow: v }) })),
    [lineTargetIds, commitDoc],
  );
  const setLineCurve = useCallback(
    (id: string, which: LineHandle, v: number) => {
      const clamped = Math.max(-500, Math.min(500, v));
      commitDoc((d) => ({ ...d, lines: mutations.updateLineItem(d.lines, id, which === 2 ? { c2: clamped } : { c1: clamped }) }), true);
    },
    [commitDoc],
  );
  const toggleLineBold = useCallback(() => {
    const ids = lineTargetIds();
    const first = ids[0];
    if (!first) return;
    const cur = !!docRef.current.lines.find((l) => l.id === first)?.lbold;
    commitDoc((d) => ({ ...d, lines: mutations.updateLineItems(d.lines, ids, { lbold: !cur }) }));
  }, [lineTargetIds, commitDoc]);
  const setLineTsize = useCallback(
    (v: 's' | 'm' | 'l') => commitDoc((d) => ({ ...d, lines: mutations.updateLineItems(d.lines, lineTargetIds(), { lsize: v === 'm' ? undefined : v }) })),
    [lineTargetIds, commitDoc],
  );
  const setLineTextColor = useCallback(
    (hex: string | null) => commitDoc((d) => ({ ...d, lines: mutations.updateLineItems(d.lines, lineTargetIds(), { ltextColor: hex ?? undefined }) })),
    [lineTargetIds, commitDoc],
  );
  const deleteLine = useCallback(
    (id: string) => {
      commitDoc((d) => ({ ...d, lines: mutations.removeLineItem(d.lines, id) }));
      setSelectionState(null);
    },
    [commitDoc],
  );

  // ---- zone property setters ----
  const setZoneColor = useCallback((id: string, hex: string | null) => commitDoc((d) => ({ ...d, zones: mutations.updateZoneItem(d.zones, id, { color: hex }) })), [commitDoc]);
  const deleteZone = useCallback(
    (id: string) => {
      commitDoc((d) => ({ ...d, zones: mutations.removeZoneItem(d.zones, id) }));
      setSelectionState(null);
      setEditingZoneId(null);
    },
    [commitDoc],
  );

  const resetNodeSize = useCallback((id: string) => commitDoc((d) => ({ ...d, nodes: mutations.resetNodeSize(d.nodes, id) })), [commitDoc]);

  // ---- minimap — port of `Component#renderMinimap`/`#minimapCenterTo` (MindFlow.dc.html:1512-1539).
  // `showMinimap` was a design-time prop in the original (`this.props.showMinimap`); this port
  // exposes it as an in-app toggle next to the zoom controls instead (no props/config screen here). ----
  const toggleMinimap = useCallback(() => setShowMinimap((v) => !v), []);
  const panToCanvasPoint = useCallback((cx: number, cy: number) => {
    setViewport((prev) => ({ ...prev, pan: { x: prev.vw / 2 - cx * prev.zoom, y: prev.vh / 2 - cy * prev.zoom } }));
  }, []);

  /** Canvas-space center of a single selected object (or null if it's gone). */
  const objectCanvasCenter = useCallback((kind: SelectionKind, id: string): { x: number; y: number } | null => {
    if (kind === 'node') {
      const g = geomRef.current[id];
      return g ? { x: g.x, y: g.y } : null;
    }
    if (kind === 'float') {
      const f = docRef.current.floats.find((x) => x.id === id);
      return f ? { x: f.x + f.w / 2, y: f.y + (f.h || 44) / 2 } : null;
    }
    if (kind === 'zone') {
      const z = docRef.current.zones.find((x) => x.id === id);
      return z ? { x: z.x + z.w / 2, y: z.y + z.h / 2 } : null;
    }
    const l = docRef.current.lines.find((x) => x.id === id);
    return l ? cubicAt(lineGeometryOf(l), 0.5) : null; // line midpoint
  }, []);

  /** Center the selected object in the canvas area ABOVE a bottom-anchored
   * property sheet (mobile). `reserveBottomPx` is how much of the viewport the
   * sheet may cover; the object is centered in the remaining top region so it's
   * never hidden behind the sheet. Zoom is unchanged. */
  const centerObjectAboveSheet = useCallback(
    (kind: SelectionKind, id: string, reserveBottomPx: number) => {
      const c = objectCanvasCenter(kind, id);
      if (!c) return;
      setViewport((prev) => {
        const reserve = Math.min(Math.max(0, reserveBottomPx), prev.vh * 0.85);
        const targetY = Math.max(prev.vh * 0.14, (prev.vh - reserve) / 2);
        return { ...prev, pan: { x: prev.vw / 2 - c.x * prev.zoom, y: targetY - c.y * prev.zoom } };
      });
    },
    [objectCanvasCenter],
  );

  // ---- outline view editing — ports of `Component#outlineAdd`/`#outlineIndent`/`#outlineOutdent`
  // (MindFlow.dc.html:1944-1980). Tab/Enter mirror `addChild`/`addSibling`'s tree mutation but land
  // the new node in `outlineEditId` (the outline's own edit-mode flag) rather than `editingNodeId`
  // (the map canvas's), matching the original's separate `outlineEdit` state. ----
  const outlineStartEdit = useCallback((id: string) => {
    setSelectionState({ kind: 'node', id });
    setMultiSelectionState(null);
    setOutlineEditId(id);
  }, []);
  const outlineCommitEdit = useCallback(
    (id: string, text: string) => {
      commitDoc((d) => ({ ...d, nodes: mutations.commitNodeText(d.nodes, id, text) }));
      setOutlineEditId(null);
    },
    [commitDoc],
  );
  const outlineAddChild = useCallback(
    (id: string) => {
      const newId = idFactory('x');
      commitDoc((d) => ({ ...d, nodes: mutations.addChildNode(d.nodes, id, newId) }));
      setSelectionState({ kind: 'node', id: newId });
      setOutlineEditId(newId);
    },
    [commitDoc, idFactory],
  );
  const outlineAddSibling = useCallback(
    (id: string) => {
      const newId = idFactory('x');
      commitDoc((d) => {
        const next = mutations.addSiblingNode(d.nodes, id, newId);
        if (next) return { ...d, nodes: next };
        return { ...d, nodes: mutations.addChildNode(d.nodes, ROOT_ID, newId) };
      });
      setSelectionState({ kind: 'node', id: newId });
      setOutlineEditId(newId);
    },
    [commitDoc, idFactory],
  );
  const outlineIndent = useCallback((id: string) => commitDoc((d) => ({ ...d, nodes: mutations.outlineIndentNode(d.nodes, id) })), [commitDoc]);
  const outlineOutdent = useCallback((id: string) => commitDoc((d) => ({ ...d, nodes: mutations.outlineOutdentNode(d.nodes, id) })), [commitDoc]);

  // ---- object drag/resize (node-move/float-move/float-resize/zone-move/zone-resize/
  // line-move/line-end/line-curve/node-resize/group) — port of `Component#onMove`'s
  // per-type branches (MindFlow.dc.html:1665-1759). `node-move` unifies free/attached
  // node dragging behind a ghost + live drop-target highlight (Editor-c); `group`
  // handles a marquee multi-selection's shared drag (Editor-c). ----
  const objDragRef = useRef<ObjDrag | null>(null);

  /** Starts a new object drag — resets `objDragMovedRef` (this port's per-drag `d.moved`
   * stand-in, since `ObjDrag`'s variants don't carry their own field) alongside setting
   * `objDragRef.current`, so the context-menu machinery above always sees "not yet moved"
   * for a drag that JUST started, even if a previous drag left it `true`. */
  function startObjDrag(d: ObjDrag): void {
    objDragMovedRef.current = false;
    objDragRef.current = d;
  }

  /** Drop-target scan under the drag ghost's canvas point — port of `Component#findAttachTarget`
   * (MindFlow.dc.html:1761-1773). `exclude` keeps a dragged node from being dropped onto itself
   * or one of its own descendants (would create a cycle). */
  function findAttachTarget(p: { x: number; y: number }, exclude: Set<string>): AttachTarget | null {
    const g = geomRef.current;
    for (const id in g) {
      if (exclude.has(id)) continue;
      const gg = g[id];
      if (!gg) continue;
      const pad = 10;
      if (p.x >= gg.x - gg.w / 2 - pad && p.x <= gg.x + gg.w / 2 + pad && p.y >= gg.y - gg.h / 2 - pad && p.y <= gg.y + gg.h / 2 + pad) {
        const rel = (p.y - (gg.y - gg.h / 2)) / gg.h;
        const zone: AttachTarget['zone'] = id === ROOT_ID ? 'child' : rel < 0.25 ? 'above' : rel > 0.75 ? 'below' : 'child';
        return { id, zone };
      }
    }
    return null;
  }

  useEffect(() => {
    function onMove(e: PointerEvent): void {
      const d = objDragRef.current;
      if (!d) return;
      // any actual pointermove while a drag is live counts as "moved" for the context-menu's
      // deferred-open check (see `objDragMovedRef`'s declaration, above `dragRef`).
      objDragMovedRef.current = true;
      const vp = viewportRef.current;
      const dx = (e.clientX - d.startClientX) / vp.zoom;
      const dy = (e.clientY - d.startClientY) / vp.zoom;
      switch (d.kind) {
        case 'root':
          setRootAnchor({ x: d.startAnchor.x + dx, y: d.startAnchor.y + dy });
          break;
        case 'node-move': {
          const p = toCanvasPoint(e.clientX, e.clientY, vp);
          setDragGhost({ id: d.id, x: p.x, y: p.y });
          setAttachTarget(findAttachTarget(p, d.excludeIds));
          break;
        }
        case 'group': {
          commitDoc(
            (doc0) => ({
              ...doc0,
              nodes: mutations.translateNodesBy(doc0.nodes, d.nodesOrig, dx, dy),
              floats: mutations.translateFloatsBy(doc0.floats, d.floatsOrig, dx, dy),
              lines: mutations.translateLinesBy(doc0.lines, d.linesOrig, dx, dy),
            }),
            true,
          );
          break;
        }
        case 'node-resize':
          commitDoc((doc0) => ({ ...doc0, nodes: mutations.resizeNode(doc0.nodes, d.id, d.ow + dx, d.oh + dy) }), true);
          break;
        case 'float':
          commitDoc((doc0) => ({ ...doc0, floats: mutations.updateFloatItem(doc0.floats, d.id, { x: d.ox + dx, y: d.oy + dy }) }), true);
          break;
        case 'float-resize':
          commitDoc(
            (doc0) => ({ ...doc0, floats: mutations.updateFloatItem(doc0.floats, d.id, { w: Math.max(120, Math.round(d.ow + dx)), h: Math.max(44, Math.round(d.oh + dy)) }) }),
            true,
          );
          break;
        case 'zone':
          commitDoc((doc0) => ({ ...doc0, zones: mutations.updateZoneItem(doc0.zones, d.id, { x: d.ox + dx, y: d.oy + dy }) }), true);
          break;
        case 'zone-resize':
          commitDoc(
            (doc0) => ({ ...doc0, zones: mutations.updateZoneItem(doc0.zones, d.id, { w: Math.max(160, Math.round(d.ow + dx)), h: Math.max(100, Math.round(d.oh + dy)) }) }),
            true,
          );
          break;
        case 'line-move':
          commitDoc(
            (doc0) => ({ ...doc0, lines: mutations.updateLineItem(doc0.lines, d.id, { x1: d.o.x1 + dx, y1: d.o.y1 + dy, x2: d.o.x2 + dx, y2: d.o.y2 + dy }) }),
            true,
          );
          break;
        case 'line-end': {
          // port of `Component#onMove`'s `d.type === 'line-end'` branch (MindFlow.dc.html:1728-1735):
          // track the raw cursor point, but also probe for a nearby port to snap/anchor to — the raw
          // x/y are ALWAYS stored too (the anchor is what actually drives the rendered position; raw
          // stays as the detached fallback/last-dropped-spot).
          const rawX = d.ox + dx;
          const rawY = d.oy + dy;
          const snap = findLineSnap(rawX, rawY, snapCandidates());
          setLineSnap(snap);
          const patch = d.which === 1 ? { x1: rawX, y1: rawY, a1: snap } : { x2: rawX, y2: rawY, a2: snap };
          commitDoc((doc0) => ({ ...doc0, lines: mutations.updateLineItem(doc0.lines, d.id, patch) }), true);
          break;
        }
        case 'line-curve': {
          // on-curve handle moves at ~4/9 of the control-point offset at t=1/3 → scale to track the cursor (MindFlow.dc.html:1740)
          const proj = (dx * d.nx + dy * d.ny) * 2.25;
          const clamped = Math.max(-500, Math.min(500, d.oc + proj));
          commitDoc((doc0) => ({ ...doc0, lines: mutations.updateLineItem(doc0.lines, d.id, d.which === 2 ? { c2: clamped } : { c1: clamped }) }), true);
          break;
        }
        default:
          break;
      }
    }
    function onUp(e: PointerEvent): void {
      const d = objDragRef.current;
      if (!d) return;
      objDragRef.current = null;
      // deferred right-click menu (macOS): see the identical block in the background
      // drag's `onUp`, above — this covers a right-click that landed on a NODE/FLOAT/
      // ZONE/LINE (their `begin*Drag` starters don't filter by button, matching the
      // original's `onNodeDown`/`onFloatDown`/`onLineDown`, so a right-mousedown on one
      // of them starts an `objDrag`, not a background pan).
      if (pendingCtxRef.current) {
        const pc = pendingCtxRef.current;
        pendingCtxRef.current = null;
        if (!objDragMovedRef.current) openCtxAt(pc.x, pc.y);
      }
      // clear the snap-target port indicators — port of `Component#onUp`'s
      // `if (d && d.type === 'line-end') { this._snapHi = null; ... }` (MindFlow.dc.html:1824).
      if (d.kind === 'line-end') setLineSnap(null);
      if (d.kind === 'node-resize') {
        setResizingNodeId(null); // drop it back to its normal layer
        if (objDragMovedRef.current) {
          // a free shape resized into a neighbour → magnet it clear once the final
          // size is in geom. Resize commits during the drag, so `doc.nodes` doesn't
          // change on release — bump `nudgeTick` to re-run the nudge effect.
          const rn = docRef.current.nodes[d.id];
          if (rn && !rn.parent && d.id !== ROOT_ID) {
            pendingNudgeRef.current = d.id;
            setNudgeTick((t) => t + 1);
          }
        }
      }
      if (d.kind === 'node-move') {
        const vp = viewportRef.current;
        const p = toCanvasPoint(e.clientX, e.clientY, vp);
        setDragGhost(null);
        setAttachTarget(null);
        // How far the POINTER actually travelled (not how off-centre the grab was).
        // A click — or sub-threshold jitter — that never dragged must only select
        // (done on pointerdown), never move/detach/reattach. Without this, clicking a
        // wide node's edge alone clears the `dist > 40` detach gate below (dist is
        // measured from the node's CENTRE to the cursor), yanking it out of the tree.
        const moveDist = Math.hypot(e.clientX - d.startClientX, e.clientY - d.startClientY) / (vp.zoom || 1);
        const target = moveDist >= 4 ? findAttachTarget(p, d.excludeIds) : null;
        if (moveDist < 4) {
          // pure click — nothing to commit
        } else if (target) {
          // dropped onto another node → reparent (port of `Component#onUp`'s
          // `if (a) { this.attachFreeNode(d.id, a.id, a.zone); return; }`, MindFlow.dc.html:1786)
          commitDoc((doc0) => {
            const next = mutations.reattachNode(doc0.nodes, d.id, target.id, target.zone);
            return next ? { ...doc0, nodes: next } : doc0;
          });
        } else {
          const dist = Math.hypot(p.x - d.startGeomX, p.y - d.startGeomY);
          // Box lookup for the drop: the dragged shape's NEW position is already in
          // the candidate `nodes` (moveFreeNode/detach set it), and every free shape
          // carries its live position in the doc — so read positions from the doc for
          // free shapes and from geom for tree nodes (whose doc x/y is 0). Sizes are
          // position-independent, so geom is always fine for them. Doing this inline
          // lets the drop + magnet land in ONE commit → the shape never renders at the
          // overlapping spot first (no text flicker).
          const boxOf = (nodes: NodeMap) => (id: string) => {
            const gg = geomRef.current[id];
            if (!gg) return null;
            const nn = nodes[id];
            const isFreeRoot = !!nn && !nn.parent && id !== ROOT_ID;
            return { x: isFreeRoot ? nn.x : gg.x, y: isFreeRoot ? nn.y : gg.y, w: gg.w, h: gg.h };
          };
          if (d.wasFree) {
            // a free shape dropped clear of any target moves to the drop point, then
            // magnets clear (only this shape) of anything it landed on — one commit.
            if (dist > 0.5)
              commitDoc((doc0) => {
                const moved = mutations.moveFreeNode(doc0.nodes, d.id, p.x, p.y);
                return { ...doc0, nodes: mutations.nudgeFreeNode(moved, d.id, boxOf(moved)) };
              });
          } else if (dist > 40) {
            // dragged clear of the tree → detach to a free shape at the drop point
            // (MindFlow.dc.html:1791-1797), then magnet it clear — one commit.
            commitDoc((doc0) => {
              const detached = mutations.detachNodeToFree(doc0.nodes, d.id, p.x, p.y);
              return { ...doc0, nodes: mutations.nudgeFreeNode(detached, d.id, boxOf(detached)) };
            });
          }
          // small move, no target: snap back — nothing to commit (matches MindFlow.dc.html:1799)
        }
      } else if (d.kind === 'group' && d.nodesOrig[ROOT_ID]) {
        // the root moved as part of the group → remember its new spot as the pinned anchor
        // (matches the single-drag `d.type === 'node' && d.id === this.rootId` branch, MindFlow.dc.html:1816-1819)
        const r = docRef.current.nodes[ROOT_ID];
        if (r) setRootAnchor({ x: r.x, y: r.y });
      }
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [commitDoc]);

  // Magnet the JUST-moved shape clear of overlap. Only the shape whose id is
  // parked in `pendingNudgeRef` (set on drop / text-commit / create) is nudged —
  // never the ones it landed on — so a stationary shape stays put (only the shape
  // the user acted on moves). Runs once the interaction settles (not mid-edit /
  // mid-drag) so `geomRef` holds the shape's final laid-out size + position.
  // Applied via `setDoc` (a normalization, not an undoable action — matching the
  // original's plain `setState` in `resolveOverlapFree`).
  useEffect(() => {
    const target = pendingNudgeRef.current;
    if (!target) return;
    if (editingNodeId || editingFloatId || editingZoneId || editingLineId) return;
    if (objDragRef.current || dragRef.current) return;
    pendingNudgeRef.current = null;
    const n = doc.nodes[target];
    if (!n || n.parent) return; // gone, or reattached into the tree — nothing to separate
    // positions from geom (laid-out) — NOT doc.nodes, whose tree-node x/y is 0
    const boxOf = (id: string) => {
      const gg = geomRef.current[id];
      return gg ? { x: gg.x, y: gg.y, w: gg.w, h: gg.h } : null;
    };
    const nudged = mutations.nudgeFreeNode(doc.nodes, target, boxOf);
    if (nudged !== doc.nodes) setDoc((prev) => (prev.nodes === doc.nodes ? { ...prev, nodes: nudged } : prev));
  }, [doc.nodes, nudgeTick, editingNodeId, editingFloatId, editingZoneId, editingLineId]);

  function capturePointer(e: ReactPointerEvent): void {
    try {
      (e.target as Element).setPointerCapture?.(e.pointerId);
    } catch {
      /* not implemented in some environments (e.g. jsdom) — non-fatal */
    }
  }

  /** Starts a shared multi-select drag — port of `Component#startGroupDrag` (MindFlow.dc.html:1582-1594).
   * Triggered from `beginNodeDrag`/`beginFloatDrag`/`beginLineDrag` when the grabbed item is part of
   * an active marquee selection with more than one total member (matches the original's
   * `this.state.msel && cur.X.includes(id) && this.mselTotal(cur) > 1` guard). */
  function beginGroupDrag(e: ReactPointerEvent, groups: MultiSelection): void {
    e.stopPropagation();
    capturePointer(e);
    const d = docRef.current;
    const nodesOrig: Record<string, { x: number; y: number }> = {};
    groups.nodes.forEach((id) => {
      const n = d.nodes[id];
      // only free-standing roots carry a meaningful x/y in this port (see
      // `mutations.translateNodesBy`'s doc comment) — attached tree nodes stay put.
      if (n && n.free && !n.parent) nodesOrig[id] = { x: n.x, y: n.y };
    });
    const floatsOrig: Record<string, { x: number; y: number }> = {};
    groups.floats.forEach((id) => {
      const f = d.floats.find((x) => x.id === id);
      if (f) floatsOrig[id] = { x: f.x, y: f.y };
    });
    const linesOrig: Record<string, { x1: number; y1: number; x2: number; y2: number }> = {};
    groups.lines.forEach((id) => {
      const l = d.lines.find((x) => x.id === id);
      if (l) linesOrig[id] = { x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2 };
    });
    startObjDrag({ kind: 'group', pointerId: e.pointerId, startClientX: e.clientX, startClientY: e.clientY, nodesOrig, floatsOrig, linesOrig });
  }

  const beginNodeDrag = useCallback(
    (e: ReactPointerEvent, id: string) => {
      // Touch: defer to a tap. Don't select/drag on press — record the target
      // and let the press bubble to the background so a drag pans and a no-move
      // release selects (see `pendingTapRef`). Mouse keeps press-to-select+drag.
      if (e.pointerType === 'touch') {
        pendingTapRef.current = { kind: 'node', id };
        return;
      }
      const ms = multiSelectionRef.current;
      if (ms && ms.nodes.includes(id) && totalSelected(ms) > 1) {
        beginGroupDrag(e, ms);
        return;
      }
      e.stopPropagation();
      capturePointer(e);
      const n = docRef.current.nodes[id];
      if (!n) return;
      setSelectionState({ kind: 'node', id });
      setMultiSelectionState(null);
      if (id === ROOT_ID) {
        startObjDrag({ kind: 'root', pointerId: e.pointerId, startClientX: e.clientX, startClientY: e.clientY, startAnchor: rootAnchor });
      } else {
        const g = geomRef.current[id];
        const excludeIds = new Set<string>([id, ...descendants(docRef.current.nodes, id)]);
        startObjDrag({
          kind: 'node-move',
          id,
          pointerId: e.pointerId,
          startClientX: e.clientX,
          startClientY: e.clientY,
          startGeomX: g?.x ?? n.x,
          startGeomY: g?.y ?? n.y,
          wasFree: !!n.free,
          excludeIds,
        });
      }
    },
    [rootAnchor],
  );

  const beginNodeResize = useCallback((e: ReactPointerEvent, id: string) => {
    e.stopPropagation();
    e.preventDefault();
    const g = geomRef.current[id];
    if (!g) return;
    setResizingNodeId(id);
    startObjDrag({ kind: 'node-resize', id, pointerId: e.pointerId, startClientX: e.clientX, startClientY: e.clientY, ow: g.w, oh: g.h });
  }, []);

  const beginFloatDrag = useCallback((e: ReactPointerEvent, id: string) => {
    if (e.pointerType === 'touch') {
      pendingTapRef.current = { kind: 'float', id };
      return;
    }
    const ms = multiSelectionRef.current;
    if (ms && ms.floats.includes(id) && totalSelected(ms) > 1) {
      beginGroupDrag(e, ms);
      return;
    }
    e.stopPropagation();
    capturePointer(e);
    const f = docRef.current.floats.find((x) => x.id === id);
    if (!f) return;
    setSelectionState({ kind: 'float', id });
    setMultiSelectionState(null);
    startObjDrag({ kind: 'float', id, pointerId: e.pointerId, startClientX: e.clientX, startClientY: e.clientY, ox: f.x, oy: f.y });
  }, []);

  const beginFloatResize = useCallback((e: ReactPointerEvent, id: string) => {
    e.stopPropagation();
    e.preventDefault();
    const f = docRef.current.floats.find((x) => x.id === id);
    if (!f) return;
    startObjDrag({ kind: 'float-resize', id, pointerId: e.pointerId, startClientX: e.clientX, startClientY: e.clientY, ow: f.w, oh: f.h || 44 });
  }, []);

  const beginZoneDrag = useCallback((e: ReactPointerEvent, id: string) => {
    if (e.pointerType === 'touch') {
      pendingTapRef.current = { kind: 'zone', id };
      return;
    }
    e.stopPropagation();
    capturePointer(e);
    const z = docRef.current.zones.find((x) => x.id === id);
    if (!z) return;
    setSelectionState({ kind: 'zone', id });
    setMultiSelectionState(null);
    startObjDrag({ kind: 'zone', id, pointerId: e.pointerId, startClientX: e.clientX, startClientY: e.clientY, ox: z.x, oy: z.y });
  }, []);

  const beginZoneResize = useCallback((e: ReactPointerEvent, id: string) => {
    e.stopPropagation();
    e.preventDefault();
    const z = docRef.current.zones.find((x) => x.id === id);
    if (!z) return;
    startObjDrag({ kind: 'zone-resize', id, pointerId: e.pointerId, startClientX: e.clientX, startClientY: e.clientY, ow: z.w, oh: z.h });
  }, []);

  const beginLineDrag = useCallback((e: ReactPointerEvent, id: string) => {
    if (e.pointerType === 'touch') {
      pendingTapRef.current = { kind: 'line', id };
      return;
    }
    const ms = multiSelectionRef.current;
    if (ms && ms.lines.includes(id) && totalSelected(ms) > 1) {
      beginGroupDrag(e, ms);
      return;
    }
    e.stopPropagation();
    capturePointer(e);
    const l = docRef.current.lines.find((x) => x.id === id);
    if (!l) return;
    setSelectionState({ kind: 'line', id });
    setMultiSelectionState(null);
    startObjDrag({ kind: 'line-move', id, pointerId: e.pointerId, startClientX: e.clientX, startClientY: e.clientY, o: { x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2 } });
  }, []);

  const beginLineEndDrag = useCallback((e: ReactPointerEvent, id: string, which: LineHandle) => {
    e.stopPropagation();
    capturePointer(e);
    const l = docRef.current.lines.find((x) => x.id === id);
    if (!l) return;
    setSelectionState({ kind: 'line', id });
    // start from the RESOLVED point (port of `Component#onLineEndDown`'s `this.resolveEnd(l, which)`,
    // MindFlow.dc.html:2482) so a drag that begins on an already-anchored endpoint tracks the
    // cursor from where it's actually rendered, not a possibly-stale raw x/y.
    const ep = resolveLine(l);
    const ox = which === 1 ? ep.x1 : ep.x2;
    const oy = which === 1 ? ep.y1 : ep.y2;
    startObjDrag({ kind: 'line-end', id, which, pointerId: e.pointerId, startClientX: e.clientX, startClientY: e.clientY, ox, oy });
  }, []);

  const beginLineCurveDrag = useCallback((e: ReactPointerEvent, id: string, which: LineHandle) => {
    e.stopPropagation();
    capturePointer(e);
    const l = docRef.current.lines.find((x) => x.id === id);
    if (!l) return;
    const g = lineGeometryOf(l);
    startObjDrag({
      kind: 'line-curve',
      id,
      which,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      oc: which === 2 ? g.c2 : g.c1,
      nx: g.nx,
      ny: g.ny,
    });
  }, []);

  // ---- keyboard shortcuts — port of `Component#onKey` (MindFlow.dc.html:2838-2905):
  // the map-view branch (Editor-b), plus the outline-view branch and the multi-select
  // (marquee) Delete/Escape branch (Editor-c). ----
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      const target = e.target as HTMLElement | null;
      const inEditable = !!(target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable));
      if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        saveNow();
        return;
      }

      if (view === 'outline') {
        if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
          e.preventDefault();
          undo();
          return;
        }
        if ((e.metaKey || e.ctrlKey) && ((e.key === 'y' || e.key === 'Y') || (e.shiftKey && (e.key === 'z' || e.key === 'Z')))) {
          e.preventDefault();
          redo();
          return;
        }
        if (inEditable) return; // the row's own <input> handles Tab/Enter/F2/Escape itself
        const id = selection?.kind === 'node' ? selection.id : null;
        if (e.key === 'Tab') {
          e.preventDefault();
          if (id) outlineAddChild(id);
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          if (id) {
            if (id !== ROOT_ID) outlineAddSibling(id);
            else outlineAddChild(id);
          }
          return;
        }
        if (e.key === 'F2') {
          e.preventDefault();
          if (id) setOutlineEditId(id);
          return;
        }
        if ((e.key === 'Delete' || e.key === 'Backspace') && id && id !== ROOT_ID) {
          e.preventDefault();
          deleteSelection();
          return;
        }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const rows = outlineRows(docRef.current.nodes);
          if (!rows.length) return;
          const idx = rows.findIndex((r) => r.id === id);
          const next = e.key === 'ArrowUp' ? Math.max(0, idx - 1) : Math.min(rows.length - 1, idx + 1);
          const row = rows[idx < 0 ? 0 : next];
          if (row) selectNode(row.id);
          return;
        }
        return;
      }

      if (inEditable) return;
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && ((e.key === 'y' || e.key === 'Y') || (e.shiftKey && (e.key === 'z' || e.key === 'Z')))) {
        e.preventDefault();
        redo();
        return;
      }
      // multi-select (marquee) — port of the `this.state.msel && this.mselTotal() > 1` early-return
      // branch (MindFlow.dc.html:2878-2882), checked BEFORE the single-`selection` branches below.
      if (multiSelection && totalSelected(multiSelection) > 1) {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          deleteSelection();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          clearSelection();
        }
        return;
      }
      // arrow keys move the node selection to the nearest neighbour in that direction
      // (port of the dc original's final `else if` arrow block). Only meaningful with a
      // node — or nothing — selected; float/line/zone selections are handled by their own
      // branches below and don't navigate.
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (!selection || selection.kind === 'node') {
          e.preventDefault();
          const dir = e.key === 'ArrowUp' ? 'up' : e.key === 'ArrowDown' ? 'down' : e.key === 'ArrowLeft' ? 'left' : 'right';
          navigateNodes(selection?.kind === 'node' ? selection.id : null, dir);
          return;
        }
      }
      if (!selection) return;
      if (selection.kind === 'node') {
        if (e.key === 'F2') {
          e.preventDefault();
          startEditNode(selection.id);
        } else if (e.key === 'Tab') {
          e.preventDefault();
          addChild();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          addSibling();
        } else if ((e.key === 'Delete' || e.key === 'Backspace') && selection.id !== ROOT_ID) {
          e.preventDefault();
          deleteSelection();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          clearSelection();
        }
      } else if (selection.kind === 'float') {
        if (e.key === 'F2' || e.key === 'Enter') {
          e.preventDefault();
          startEditFloat(selection.id);
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          deleteSelection();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          clearSelection();
        }
      } else if (selection.kind === 'line') {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          deleteSelection();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          clearSelection();
        }
      } else if (selection.kind === 'zone') {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          deleteSelection();
        } else if (e.key === 'F2' || e.key === 'Enter') {
          e.preventDefault();
          startEditZoneLabel(selection.id);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          clearSelection();
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  // ---- export (port of exportJSON/exportOutline/exportPNG, MindFlow.dc.html:613-771) ----
  const exportJSON = useCallback(() => {
    downloadFile(`${safeDocTitle(doc, titleParam)}.json`, JSON.stringify(serializeDoc(doc), null, 2), 'application/json');
  }, [doc, titleParam]);
  const exportPNG = useCallback(() => {
    exportPng(doc, geom, theme, safeDocTitle(doc, titleParam));
  }, [doc, geom, theme, titleParam]);

  const docTitle = laidOutNodes[ROOT_ID]?.text || titleParam || '새 마인드맵';

  return {
    doc,
    theme,
    themeKey: themeKeyOf(doc.themeKey),
    layoutMode: doc.layoutMode,
    edgeStyle,
    view,
    pan: viewport.pan,
    zoom: viewport.zoom,
    zoomPct: Math.round(viewport.zoom * 100),
    vw: viewport.vw,
    vh: viewport.vh,
    geom,
    mapId,
    docTitle,
    setViewportEl,
    setLayoutMode,
    setEdgeStyle,
    setThemeKey,
    setView,
    onBackgroundPointerDown,
    zoomIn,
    zoomOut,
    fitView,
    goHome,

    presence,
    reportPointerPosition,
    clearPointerPosition,

    selection,
    selectNode,
    selectFloat,
    selectLine,
    selectZone,
    clearSelection,

    propsOpen,
    openProps,
    closeProps,

    multiSelection,
    multiGroups,
    marquee,

    showMinimap,
    toggleMinimap,
    panToCanvasPoint,
    centerObjectAboveSheet,

    attachTarget,

    outlineEditId,
    outlineStartEdit,
    outlineCommitEdit,
    outlineAddChild,
    outlineAddSibling,
    outlineIndent,
    outlineOutdent,

    editingNodeId,
    resizingNodeId,
    editingFloatId,
    editingLineId,
    editingZoneId,
    editingTitle,
    startEditNode,
    commitNodeText,
    commitNodeRichText,
    updateNodeEditSize,
    cancelNodeEdit,
    textCtx,
    openTextCtx,
    closeTextCtx,
    setRichEditorEl,
    applyPartial,
    startEditFloat,
    commitFloatText,
    cancelFloatEdit,
    startEditLineLabel,
    commitLineLabel,
    cancelLineLabelEdit,
    startEditZoneLabel,
    commitZoneLabel,
    cancelZoneLabelEdit,
    startEditTitle,
    commitTitle,
    cancelTitleEdit,
    titleError,
    dismissTitleError,

    addChild,
    addSibling,
    deleteSelection,
    toggleCollapse,
    addFreeNodeAt,
    addFloatAt,
    addLineAt,
    addZoneAt,

    setShape,
    setColor,
    setFill,
    setStroke,
    setFillAlpha,
    setStrokeAlpha,
    setTextColor,
    toggleNodeBold,
    setNodeTsize,
    setEmoji,
    clearEmoji,
    setNote,
    setTextAlign,

    setFloatBg,
    toggleFloatBold,
    setFloatTsize,
    setFloatTextColor,
    toggleFloatCollapse,
    deleteFloat,

    setLineDashed,
    setLineArrow,
    setLineCurve,
    toggleLineBold,
    setLineTsize,
    setLineTextColor,
    deleteLine,
    resolveLine: resolveLineLive,
    lineGeometry: lineGeometryLive,
    lineSnap,
    lineSnapBox,

    setZoneColor,
    deleteZone,

    ctxMenu,
    ctxSub,
    onContextMenu,
    closeCtxMenu,
    toggleCtxSub,

    beginNodeDrag,
    beginNodeResize,
    resetNodeSize,
    beginFloatDrag,
    beginFloatResize,
    beginZoneDrag,
    beginZoneResize,
    beginLineDrag,
    beginLineEndDrag,
    beginLineCurveDrag,
    dragGhost,

    canUndo: historyRef.current.canUndo(),
    canRedo: historyRef.current.canRedo(),
    undo,
    redo,
    saveState,
    saveNow,
    saveConflict,
    dismissSaveConflict,
    exportJSON,
    exportPNG,
  };
}

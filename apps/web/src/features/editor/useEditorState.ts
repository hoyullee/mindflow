import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { Doc, Float, Line, LayoutMode, NodeMap, SizeOf, Zone } from '@mindflow/mindmap-core';
import { HistoryStack, ROOT_ID, cubicAt, layout, resolveLineGeometry, serializeDoc, toMarkdown } from '@mindflow/mindmap-core';
import { useDocStore } from '../../adapters/BackendContext';
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
import type { AttachTarget, GeomMap, LineHandle, MarqueeRect, MultiSelection, NodeGeom, PanState, SaveState, Selection, SelectionKind, ViewMode } from './types';

// State/interaction controller for the mindmap editor route — the React
// counterpart of `Component`'s state + drag/select/edit/save/undo methods
// (MindFlow.dc.html). Editor-a covered load/layout/pan/zoom/view/theme;
// Editor-b added selection, text editing, structural add/delete, drag-move/
// resize, the property-panel setters, autosave + manual save, undo/redo (via
// `@mindflow/mindmap-core`'s `HistoryStack`), and export. Editor-c (this
// revision) adds marquee multi-select + its bulk property panel, the
// minimap, editable outline view, and drag-to-reparent.
//
// Still deliberately out of scope (documented per CLAUDE.md's task spec):
// - partial rich-text run styling (`applyPartial`) — `NodeEditBox` stays a
//   plain textarea (Editor-b's own note, `components/NodeLayer.tsx`).
// - line endpoint anchor magnets (`a1`/`a2`) — needs a core `Line` model
//   extension first (`components/LineLayer.tsx`'s own note).
// - the right-click context menu (`ctxMenu`/`ctxSub`, MindFlow.dc.html:2794-
//   2837, 3087-3170) — explicitly optional ("여유되면") in the Editor-c task
//   spec; right-click still just pans (see `onBackgroundPointerDown` below).

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2.4;
const FIT_PADDING = 90;

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
  | { kind: 'pan'; pointerId: number; sx: number; sy: number; startPan: PanState }
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

  // ---- selection ----
  selection: Selection | null;
  selectNode: (id: string) => void;
  selectFloat: (id: string) => void;
  selectLine: (id: string) => void;
  selectZone: (id: string) => void;
  clearSelection: () => void;

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
  editingFloatId: string | null;
  editingLineId: string | null;
  editingZoneId: string | null;
  editingTitle: boolean;
  startEditNode: (id: string) => void;
  commitNodeText: (id: string, text: string) => void;
  cancelNodeEdit: () => void;
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

  // ---- structural ----
  addChild: () => void;
  addSibling: () => void;
  deleteSelection: () => void;
  toggleCollapse: (id: string) => void;
  addFreeNodeAt: () => void;
  addFloatAt: () => void;
  addLineAt: () => void;
  addZoneAt: () => void;

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

  // ---- zone property setters ----
  setZoneColor: (id: string, hex: string | null) => void;
  deleteZone: (id: string) => void;

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
  exportMarkdown: () => void;
  exportPNG: () => void;
}

function docSignature(d: Doc): string {
  try {
    return JSON.stringify([d.nodes, d.floats, d.lines, d.zones, d.layoutMode, d.themeKey]);
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
  const [edgeStyle, setEdgeStyleState] = useState<EdgeStyle>('curve');
  const [view, setView] = useState<ViewMode>('map');
  const [viewport, setViewport] = useState<ViewportState>(INITIAL_VIEWPORT);
  const [rootAnchor, setRootAnchor] = useState<PanState>({ x: 0, y: 0 });
  const [dragGhost, setDragGhost] = useState<{ id: string; x: number; y: number } | null>(null);

  const [selection, setSelectionState] = useState<Selection | null>(null);
  const [multiSelection, setMultiSelectionState] = useState<MultiSelection | null>(null);
  const [marquee, setMarquee] = useState<MarqueeRect | null>(null);
  const [attachTarget, setAttachTarget] = useState<AttachTarget | null>(null);
  const [showMinimap, setShowMinimap] = useState(true);
  const [outlineEditId, setOutlineEditId] = useState<string | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editingFloatId, setEditingFloatId] = useState<string | null>(null);
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [saveState, setSaveStateState] = useState<SaveState>('saved');
  const [, setHistoryTick] = useState(0);

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
        setDoc((prev) => (docSignature(prev) === mountDocSigRef.current && docSignature(res.doc) !== mountDocSigRef.current ? res.doc : prev));
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
      out[id] = g;
    });
    return out;
  }, [vis, laidOutNodes, measurer]);

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
  const multiSelectionRef = useRef(multiSelection);
  useEffect(() => {
    multiSelectionRef.current = multiSelection;
  }, [multiSelection]);

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
    setDoc((prev) => ({ ...prev, nodes: snap.nodes, floats: snap.floats, lines: snap.lines, zones: snap.zones, layoutMode: snap.layoutMode }));
    setEdgeStyleState(snap.edgeStyle);
    setSelectionState(null);
    setMultiSelectionState(null);
    setOutlineEditId(null);
    setEditingNodeId(null);
    setEditingFloatId(null);
    setEditingLineId(null);
    setEditingZoneId(null);
    setEditingTitle(false);
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

  useEffect(() => {
    if (!pendingFitRef.current) return;
    if (!Object.keys(geom).length) return;
    if (viewport.vw <= 0 || viewport.vh <= 0) return;
    pendingFitRef.current = false;
    fitView();
  }, [geom, viewport.vw, viewport.vh]);

  const setLayoutMode = useCallback(
    (mode: LayoutMode) => {
      pendingFitRef.current = true;
      commitDoc((prev) => (prev.layoutMode === mode ? prev : { ...prev, layoutMode: mode }));
    },
    [commitDoc],
  );

  const setEdgeStyle = useCallback((s: EdgeStyle) => {
    setEdgeStyleState(s);
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
      setMarquee(null);
      return;
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* not implemented in some environments (e.g. jsdom) — non-fatal */
    }
    if (e.button === 1 || e.button === 2) {
      setViewport((prev) => {
        dragRef.current = { kind: 'pan', pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, startPan: prev.pan };
        return prev;
      });
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
      const d = dragRef.current;
      if (!d || d.pointerId !== e.pointerId) return;
      dragRef.current = null;
      if (d.kind === 'pan') {
        // plain background click (button 1/2, no movement) also deselects everything, matching
        // `Component#onUp`'s `d.type === 'pan' && !d.moved` branch (MindFlow.dc.html:1855)
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
        const geo = resolveLineGeometry(l);
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
    };
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

  const isKind = (kind: SelectionKind): string | null => (selection && selection.kind === kind ? selection.id : null);

  // ---- text editing ----
  const startEditNode = useCallback((id: string) => {
    setSelectionState({ kind: 'node', id });
    setMultiSelectionState(null);
    setEditingNodeId(id);
  }, []);
  const commitNodeText = useCallback(
    (id: string, text: string) => {
      commitDoc((d) => ({ ...d, nodes: mutations.commitNodeText(d.nodes, id, text) }));
      setEditingNodeId(null);
    },
    [commitDoc],
  );
  const cancelNodeEdit = useCallback(() => setEditingNodeId(null), []);

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

  const startEditTitle = useCallback(() => setEditingTitle(true), []);
  const commitTitle = useCallback(
    (text: string) => {
      commitDoc((d) => ({ ...d, nodes: mutations.commitRootTitle(d.nodes, text, titleParam) }));
      setEditingTitle(false);
    },
    [commitDoc, titleParam],
  );
  const cancelTitleEdit = useCallback(() => setEditingTitle(false), []);

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

  const addFreeNodeAt = useCallback(() => {
    const vp = viewportRef.current;
    const stagger = (Object.keys(docRef.current.nodes).length % 6) * 20;
    const cx = (vp.vw / 2 - vp.pan.x) / vp.zoom + stagger;
    const cy = (vp.vh / 2 - vp.pan.y) / vp.zoom - 130 + stagger;
    const newId = idFactory('x');
    commitDoc((d) => ({ ...d, nodes: mutations.addFreeShapeNode(d.nodes, newId, cx, cy) }));
    setSelectionState({ kind: 'node', id: newId });
    setMultiSelectionState(null);
    setEditingNodeId(newId);
  }, [commitDoc, idFactory]);

  const addFloatAt = useCallback(() => {
    const vp = viewportRef.current;
    const stagger = (docRef.current.floats.length % 6) * 22;
    const cx = (vp.vw / 2 - vp.pan.x) / vp.zoom - 90 + stagger;
    const cy = (vp.vh / 2 - vp.pan.y) / vp.zoom + 150 + stagger;
    const newId = idFactory('f');
    commitDoc((d) => ({ ...d, floats: mutations.addFloatItem(d.floats, newId, cx, cy) }));
    setSelectionState({ kind: 'float', id: newId });
    setMultiSelectionState(null);
    setEditingFloatId(newId);
  }, [commitDoc, idFactory]);

  const addLineAt = useCallback(() => {
    const vp = viewportRef.current;
    const cx = (vp.vw / 2 - vp.pan.x) / vp.zoom;
    const cy = (vp.vh / 2 - vp.pan.y) / vp.zoom;
    const off = (docRef.current.lines.length % 5) * 22;
    const newId = idFactory('l');
    commitDoc((d) => ({ ...d, lines: mutations.addLineItem(d.lines, newId, cx - 90, cy + off, cx + 90, cy + off) }));
    setSelectionState({ kind: 'line', id: newId });
    setMultiSelectionState(null);
  }, [commitDoc, idFactory]);

  const addZoneAt = useCallback(() => {
    const vp = viewportRef.current;
    const cx = (vp.vw / 2 - vp.pan.x) / vp.zoom - 170;
    const cy = (vp.vh / 2 - vp.pan.y) / vp.zoom - 110;
    const newId = idFactory('z');
    commitDoc((d) => ({ ...d, zones: mutations.addZoneItem(d.zones, newId, cx, cy) }));
    setSelectionState({ kind: 'zone', id: newId });
    setMultiSelectionState(null);
  }, [commitDoc, idFactory]);

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
          const patch = d.which === 1 ? { x1: d.ox + dx, y1: d.oy + dy } : { x2: d.ox + dx, y2: d.oy + dy };
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
      if (d.kind === 'node-move') {
        const vp = viewportRef.current;
        const p = toCanvasPoint(e.clientX, e.clientY, vp);
        const target = findAttachTarget(p, d.excludeIds);
        setDragGhost(null);
        setAttachTarget(null);
        if (target) {
          // dropped onto another node → reparent (port of `Component#onUp`'s
          // `if (a) { this.attachFreeNode(d.id, a.id, a.zone); return; }`, MindFlow.dc.html:1786)
          commitDoc((doc0) => {
            const next = mutations.reattachNode(doc0.nodes, d.id, target.id, target.zone);
            return next ? { ...doc0, nodes: next } : doc0;
          });
        } else {
          const dist = Math.hypot(p.x - d.startGeomX, p.y - d.startGeomY);
          if (d.wasFree) {
            // a free shape dropped clear of any target moves to the drop point (MindFlow.dc.html:1801-1809,
            // minus the free-shape-overlap auto-nudge, already deferred in Editor-b)
            if (dist > 0.5) commitDoc((doc0) => ({ ...doc0, nodes: mutations.moveFreeNode(doc0.nodes, d.id, p.x, p.y) }));
          } else if (dist > 40) {
            // dragged clear of the tree → detach to a free shape at the drop point (MindFlow.dc.html:1791-1797)
            commitDoc((doc0) => ({ ...doc0, nodes: mutations.detachNodeToFree(doc0.nodes, d.id, p.x, p.y) }));
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
    objDragRef.current = { kind: 'group', pointerId: e.pointerId, startClientX: e.clientX, startClientY: e.clientY, nodesOrig, floatsOrig, linesOrig };
  }

  const beginNodeDrag = useCallback(
    (e: ReactPointerEvent, id: string) => {
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
        objDragRef.current = { kind: 'root', pointerId: e.pointerId, startClientX: e.clientX, startClientY: e.clientY, startAnchor: rootAnchor };
      } else {
        const g = geomRef.current[id];
        const excludeIds = new Set<string>([id, ...descendants(docRef.current.nodes, id)]);
        objDragRef.current = {
          kind: 'node-move',
          id,
          pointerId: e.pointerId,
          startClientX: e.clientX,
          startClientY: e.clientY,
          startGeomX: g?.x ?? n.x,
          startGeomY: g?.y ?? n.y,
          wasFree: !!n.free,
          excludeIds,
        };
      }
    },
    [rootAnchor],
  );

  const beginNodeResize = useCallback((e: ReactPointerEvent, id: string) => {
    e.stopPropagation();
    e.preventDefault();
    const g = geomRef.current[id];
    if (!g) return;
    objDragRef.current = { kind: 'node-resize', id, pointerId: e.pointerId, startClientX: e.clientX, startClientY: e.clientY, ow: g.w, oh: g.h };
  }, []);

  const beginFloatDrag = useCallback((e: ReactPointerEvent, id: string) => {
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
    objDragRef.current = { kind: 'float', id, pointerId: e.pointerId, startClientX: e.clientX, startClientY: e.clientY, ox: f.x, oy: f.y };
  }, []);

  const beginFloatResize = useCallback((e: ReactPointerEvent, id: string) => {
    e.stopPropagation();
    e.preventDefault();
    const f = docRef.current.floats.find((x) => x.id === id);
    if (!f) return;
    objDragRef.current = { kind: 'float-resize', id, pointerId: e.pointerId, startClientX: e.clientX, startClientY: e.clientY, ow: f.w, oh: f.h || 44 };
  }, []);

  const beginZoneDrag = useCallback((e: ReactPointerEvent, id: string) => {
    e.stopPropagation();
    capturePointer(e);
    const z = docRef.current.zones.find((x) => x.id === id);
    if (!z) return;
    setSelectionState({ kind: 'zone', id });
    setMultiSelectionState(null);
    objDragRef.current = { kind: 'zone', id, pointerId: e.pointerId, startClientX: e.clientX, startClientY: e.clientY, ox: z.x, oy: z.y };
  }, []);

  const beginZoneResize = useCallback((e: ReactPointerEvent, id: string) => {
    e.stopPropagation();
    e.preventDefault();
    const z = docRef.current.zones.find((x) => x.id === id);
    if (!z) return;
    objDragRef.current = { kind: 'zone-resize', id, pointerId: e.pointerId, startClientX: e.clientX, startClientY: e.clientY, ow: z.w, oh: z.h };
  }, []);

  const beginLineDrag = useCallback((e: ReactPointerEvent, id: string) => {
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
    objDragRef.current = { kind: 'line-move', id, pointerId: e.pointerId, startClientX: e.clientX, startClientY: e.clientY, o: { x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2 } };
  }, []);

  const beginLineEndDrag = useCallback((e: ReactPointerEvent, id: string, which: LineHandle) => {
    e.stopPropagation();
    capturePointer(e);
    const l = docRef.current.lines.find((x) => x.id === id);
    if (!l) return;
    setSelectionState({ kind: 'line', id });
    const ox = which === 1 ? l.x1 : l.x2;
    const oy = which === 1 ? l.y1 : l.y2;
    objDragRef.current = { kind: 'line-end', id, which, pointerId: e.pointerId, startClientX: e.clientX, startClientY: e.clientY, ox, oy };
  }, []);

  const beginLineCurveDrag = useCallback((e: ReactPointerEvent, id: string, which: LineHandle) => {
    e.stopPropagation();
    capturePointer(e);
    const l = docRef.current.lines.find((x) => x.id === id);
    if (!l) return;
    const g = resolveLineGeometry(l);
    objDragRef.current = {
      kind: 'line-curve',
      id,
      which,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      oc: which === 2 ? g.c2 : g.c1,
      nx: g.nx,
      ny: g.ny,
    };
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
  const exportMarkdown = useCallback(() => {
    downloadFile(`${safeDocTitle(doc, titleParam)}.md`, toMarkdown(doc), 'text/markdown;charset=utf-8');
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

    selection,
    selectNode,
    selectFloat,
    selectLine,
    selectZone,
    clearSelection,

    multiSelection,
    multiGroups,
    marquee,

    showMinimap,
    toggleMinimap,
    panToCanvasPoint,

    attachTarget,

    outlineEditId,
    outlineStartEdit,
    outlineCommitEdit,
    outlineAddChild,
    outlineAddSibling,
    outlineIndent,
    outlineOutdent,

    editingNodeId,
    editingFloatId,
    editingLineId,
    editingZoneId,
    editingTitle,
    startEditNode,
    commitNodeText,
    cancelNodeEdit,
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

    setZoneColor,
    deleteZone,

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
    exportMarkdown,
    exportPNG,
  };
}

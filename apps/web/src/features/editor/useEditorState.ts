import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { Doc, Float, Line, LayoutMode, NodeMap, SizeOf, Zone } from '@mindflow/mindmap-core';
import { HistoryStack, ROOT_ID, layout, resolveLineGeometry, serializeDoc, toMarkdown } from '@mindflow/mindmap-core';
import { CanvasTextMeasurer, computeMetrics } from './metrics';
import { docStorageKey, loadOrSeedDoc, saveDoc } from './storage';
import { buildVisible } from './tree';
import type { EdgeStyle } from './tree';
import { themeKeyOf, themeOf } from './theme';
import type { Theme, ThemeKey } from './theme';
import { downloadFile } from './download';
import { exportPng } from './png';
import * as mutations from './mutations';
import { createIdFactory } from './mutations';
import type { GeomMap, LineHandle, NodeGeom, PanState, SaveState, Selection, SelectionKind, ViewMode } from './types';

// State/interaction controller for the mindmap editor route — the React
// counterpart of `Component`'s state + drag/select/edit/save/undo methods
// (MindFlow.dc.html). Editor-a covered load/layout/pan/zoom/view/theme;
// Editor-b (this revision) adds selection, text editing, structural add/
// delete, drag-move/resize, the property-panel setters, autosave + manual
// save, undo/redo (via `@mindflow/mindmap-core`'s `HistoryStack`), and export.

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
  | { kind: 'free'; id: string; pointerId: number; startClientX: number; startClientY: number; ox: number; oy: number }
  | { kind: 'attached'; id: string; pointerId: number; startClientX: number; startClientY: number; startGeomX: number; startGeomY: number }
  | { kind: 'node-resize'; id: string; pointerId: number; startClientX: number; startClientY: number; ow: number; oh: number }
  | { kind: 'float'; id: string; pointerId: number; startClientX: number; startClientY: number; ox: number; oy: number }
  | { kind: 'float-resize'; id: string; pointerId: number; startClientX: number; startClientY: number; ow: number; oh: number }
  | { kind: 'zone'; id: string; pointerId: number; startClientX: number; startClientY: number; ox: number; oy: number }
  | { kind: 'zone-resize'; id: string; pointerId: number; startClientX: number; startClientY: number; ow: number; oh: number }
  | { kind: 'line-move'; id: string; pointerId: number; startClientX: number; startClientY: number; o: { x1: number; y1: number; x2: number; y2: number } }
  | { kind: 'line-end'; id: string; which: LineHandle; pointerId: number; startClientX: number; startClientY: number; ox: number; oy: number }
  | { kind: 'line-curve'; id: string; which: LineHandle; pointerId: number; startClientX: number; startClientY: number; oc: number; nx: number; ny: number };

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

  // ---- float property setters ----
  setFloatBg: (hex: string | null) => void;
  toggleFloatBold: (id: string) => void;
  setFloatTsize: (id: string, v: 's' | 'm' | 'l') => void;
  setFloatTextColor: (id: string, hex: string | null) => void;
  toggleFloatCollapse: (id: string) => void;
  deleteFloat: (id: string) => void;

  // ---- line property setters ----
  setLineDashed: (id: string, v: boolean) => void;
  setLineArrow: (id: string, which: LineHandle, v: boolean) => void;
  setLineCurve: (id: string, which: LineHandle, v: number) => void;
  toggleLineBold: (id: string) => void;
  setLineTsize: (id: string, v: 's' | 'm' | 'l') => void;
  setLineTextColor: (id: string, hex: string | null) => void;
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
  const mapId = params.get('map') || null;
  const titleParam = params.get('title') ? decodeURIComponent(params.get('title') || '') : '';

  const [doc, setDoc] = useState<Doc>(() => loadOrSeedDoc(mapId, titleParam));
  const [edgeStyle, setEdgeStyleState] = useState<EdgeStyle>('curve');
  const [view, setView] = useState<ViewMode>('map');
  const [viewport, setViewport] = useState<ViewportState>(INITIAL_VIEWPORT);
  const [rootAnchor, setRootAnchor] = useState<PanState>({ x: 0, y: 0 });
  const [dragGhost, setDragGhost] = useState<{ id: string; x: number; y: number } | null>(null);

  const [selection, setSelectionState] = useState<Selection | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editingFloatId, setEditingFloatId] = useState<string | null>(null);
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [saveState, setSaveStateState] = useState<SaveState>('saved');
  const [, setHistoryTick] = useState(0);

  const idFactory = useRef(createIdFactory()).current;

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

  // ---- pan (background drag) + zoom (wheel / pinch) ----
  const dragRef = useRef<{ pointerId: number; sx: number; sy: number; startPan: PanState } | null>(null);
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
      return;
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* not implemented in some environments (e.g. jsdom) — non-fatal */
    }
    setViewport((prev) => {
      dragRef.current = { pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, startPan: prev.pan };
      return prev;
    });
    // background click: deselect + commit any in-flight edit (matches
    // `Component#onUp`'s `d.type === 'pan' && !d.moved` branch, applied eagerly
    // here since blur already commits text edits on focus loss).
    setSelectionState(null);
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
      const dx = e.clientX - d.sx;
      const dy = e.clientY - d.sy;
      setViewport((prev) => ({ ...prev, pan: { x: d.startPan.x + dx, y: d.startPan.y + dy } }));
    }
    function onUp(e: PointerEvent): void {
      activePointers.current.delete(e.pointerId);
      if (activePointers.current.size < 2) pinchRef.current = null;
      if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null;
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
  // (MindFlow.dc.html:537-543, 598-602) ----
  const lastSavedSigRef = useRef(docSignature(doc));
  const autosaveTimerRef = useRef<number | undefined>(undefined);
  const savingTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const sig = docSignature(doc);
    if (sig === lastSavedSigRef.current) return;
    setSaveStateState('dirty');
    window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = window.setTimeout(() => {
      setSaveStateState('saving');
      window.clearTimeout(savingTimerRef.current);
      savingTimerRef.current = window.setTimeout(() => {
        saveDoc(mapId, docRef.current);
        lastSavedSigRef.current = docSignature(docRef.current);
        setSaveStateState('saved');
      }, 250);
    }, 900);
    return () => window.clearTimeout(autosaveTimerRef.current);
  }, [doc, mapId]);

  const saveNow = useCallback(() => {
    window.clearTimeout(autosaveTimerRef.current);
    window.clearTimeout(savingTimerRef.current);
    setSaveStateState('saving');
    savingTimerRef.current = window.setTimeout(() => {
      saveDoc(mapId, docRef.current);
      lastSavedSigRef.current = docSignature(docRef.current);
      setSaveStateState('saved');
    }, 200);
  }, [mapId]);

  const goHome = useCallback(() => {
    window.clearTimeout(autosaveTimerRef.current);
    window.clearTimeout(savingTimerRef.current);
    try {
      localStorage.setItem(docStorageKey(mapId), JSON.stringify(serializeDoc(docRef.current)));
    } catch {
      /* storage unavailable — non-fatal, matches original's try/catch */
    }
    navigate('/home');
  }, [navigate, mapId]);

  // ---- selection ----
  const selectNode = useCallback((id: string) => setSelectionState({ kind: 'node', id }), []);
  const selectFloat = useCallback((id: string) => setSelectionState({ kind: 'float', id }), []);
  const selectLine = useCallback((id: string) => setSelectionState({ kind: 'line', id }), []);
  const selectZone = useCallback((id: string) => setSelectionState({ kind: 'zone', id }), []);
  const clearSelection = useCallback(() => setSelectionState(null), []);

  const isKind = (kind: SelectionKind): string | null => (selection && selection.kind === kind ? selection.id : null);

  // ---- text editing ----
  const startEditNode = useCallback((id: string) => {
    setSelectionState({ kind: 'node', id });
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
  }, [selection, commitDoc]);

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
  }, [commitDoc, idFactory]);

  const addZoneAt = useCallback(() => {
    const vp = viewportRef.current;
    const cx = (vp.vw / 2 - vp.pan.x) / vp.zoom - 170;
    const cy = (vp.vh / 2 - vp.pan.y) / vp.zoom - 110;
    const newId = idFactory('z');
    commitDoc((d) => ({ ...d, zones: mutations.addZoneItem(d.zones, newId, cx, cy) }));
    setSelectionState({ kind: 'zone', id: newId });
  }, [commitDoc, idFactory]);

  // ---- node property setters (port of setColor/setFill/setStroke/setEmoji/nodeBold/setNodeTsize/setNote, MindFlow.dc.html:2545-2731) ----
  function withSelectedNode(fn: (id: string) => void): void {
    const id = isKind('node');
    if (id) fn(id);
  }
  const setShape = useCallback((shape: string) => withSelectedNode((id) => commitDoc((d) => ({ ...d, nodes: mutations.setNodeField(d.nodes, id, 'shape', shape) }))), [selection, commitDoc]);
  const setColor = useCallback((hex: string | null) => withSelectedNode((id) => commitDoc((d) => ({ ...d, nodes: mutations.setNodeField(d.nodes, id, 'color', hex) }))), [selection, commitDoc]);
  const setFill = useCallback((hex: string | null) => withSelectedNode((id) => commitDoc((d) => ({ ...d, nodes: mutations.setNodeField(d.nodes, id, 'fill', hex) }))), [selection, commitDoc]);
  const setStroke = useCallback((hex: string | null) => withSelectedNode((id) => commitDoc((d) => ({ ...d, nodes: mutations.setNodeField(d.nodes, id, 'stroke', hex) }))), [selection, commitDoc]);
  const setFillAlpha = useCallback((a: number) => withSelectedNode((id) => commitDoc((d) => ({ ...d, nodes: mutations.setNodeField(d.nodes, id, 'fillA', a) }), true)), [selection, commitDoc]);
  const setStrokeAlpha = useCallback((a: number) => withSelectedNode((id) => commitDoc((d) => ({ ...d, nodes: mutations.setNodeField(d.nodes, id, 'strokeA', a) }), true)), [selection, commitDoc]);
  const setTextColor = useCallback((hex: string | null) => withSelectedNode((id) => commitDoc((d) => ({ ...d, nodes: mutations.setNodeField(d.nodes, id, 'textColor', hex) }))), [selection, commitDoc]);
  const toggleNodeBold = useCallback(
    () =>
      withSelectedNode((id) =>
        commitDoc((d) => ({ ...d, nodes: mutations.setNodeField(d.nodes, id, 'bold', !d.nodes[id]?.bold) })),
      ),
    [selection, commitDoc],
  );
  const setNodeTsize = useCallback(
    (v: 's' | 'm' | 'l') => withSelectedNode((id) => commitDoc((d) => ({ ...d, nodes: mutations.setNodeField(d.nodes, id, 'tsize', v === 'm' ? undefined : v) }))),
    [selection, commitDoc],
  );
  const setEmoji = useCallback(
    (e: string) =>
      withSelectedNode((id) =>
        commitDoc((d) => ({ ...d, nodes: mutations.setNodeField(d.nodes, id, 'emoji', d.nodes[id]?.emoji === e ? '' : e) })),
      ),
    [selection, commitDoc],
  );
  const clearEmoji = useCallback(() => withSelectedNode((id) => commitDoc((d) => ({ ...d, nodes: mutations.setNodeField(d.nodes, id, 'emoji', '') }))), [selection, commitDoc]);
  const setNote = useCallback((text: string) => withSelectedNode((id) => commitDoc((d) => ({ ...d, nodes: mutations.setNodeField(d.nodes, id, 'note', text) }))), [selection, commitDoc]);

  // ---- float property setters ----
  const setFloatBg = useCallback(
    (hex: string | null) => {
      const id = isKind('float');
      if (id) commitDoc((d) => ({ ...d, floats: mutations.updateFloatItem(d.floats, id, { bg: hex ?? undefined }) }));
    },
    [selection, commitDoc],
  );
  const toggleFloatBold = useCallback(
    (id: string) => commitDoc((d) => ({ ...d, floats: mutations.updateFloatItem(d.floats, id, { bold: !d.floats.find((f) => f.id === id)?.bold }) })),
    [commitDoc],
  );
  const setFloatTsize = useCallback(
    (id: string, v: 's' | 'm' | 'l') => commitDoc((d) => ({ ...d, floats: mutations.updateFloatItem(d.floats, id, { tsize: v === 'm' ? undefined : v }) })),
    [commitDoc],
  );
  const setFloatTextColor = useCallback(
    (id: string, hex: string | null) => commitDoc((d) => ({ ...d, floats: mutations.updateFloatItem(d.floats, id, { textColor: hex ?? undefined }) })),
    [commitDoc],
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

  // ---- line property setters ----
  const setLineDashed = useCallback((id: string, v: boolean) => commitDoc((d) => ({ ...d, lines: mutations.updateLineItem(d.lines, id, { dashed: v }) })), [commitDoc]);
  const setLineArrow = useCallback(
    (id: string, which: LineHandle, v: boolean) => commitDoc((d) => ({ ...d, lines: mutations.updateLineItem(d.lines, id, which === 1 ? { startArrow: v } : { endArrow: v }) })),
    [commitDoc],
  );
  const setLineCurve = useCallback(
    (id: string, which: LineHandle, v: number) => {
      const clamped = Math.max(-500, Math.min(500, v));
      commitDoc((d) => ({ ...d, lines: mutations.updateLineItem(d.lines, id, which === 2 ? { c2: clamped } : { c1: clamped }) }), true);
    },
    [commitDoc],
  );
  const toggleLineBold = useCallback(
    (id: string) => commitDoc((d) => ({ ...d, lines: mutations.updateLineItem(d.lines, id, { lbold: !d.lines.find((l) => l.id === id)?.lbold }) })),
    [commitDoc],
  );
  const setLineTsize = useCallback(
    (id: string, v: 's' | 'm' | 'l') => commitDoc((d) => ({ ...d, lines: mutations.updateLineItem(d.lines, id, { lsize: v === 'm' ? undefined : v }) })),
    [commitDoc],
  );
  const setLineTextColor = useCallback(
    (id: string, hex: string | null) => commitDoc((d) => ({ ...d, lines: mutations.updateLineItem(d.lines, id, { ltextColor: hex ?? undefined }) })),
    [commitDoc],
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

  // ---- object drag/resize (node-move/float-move/float-resize/zone-move/zone-resize/
  // line-move/line-end/line-curve/node-resize) — port of `Component#onMove`'s
  // per-type branches (MindFlow.dc.html:1665-1759), simplified: a still-attached
  // (non-root, non-free) node drags as an in-place ghost that becomes a free
  // shape if dropped clear of its start point (>40px), matching the original's
  // own detach threshold; the ghost→drop-target reattach gesture and the
  // free-shape overlap auto-nudge are deferred to Editor-c. ----
  const objDragRef = useRef<ObjDrag | null>(null);

  function toCanvasPoint(clientX: number, clientY: number, vp: ViewportState): { x: number; y: number } {
    const el = viewportElRef.current;
    const r = el ? el.getBoundingClientRect() : { left: 0, top: 0 };
    return { x: (clientX - r.left - vp.pan.x) / vp.zoom, y: (clientY - r.top - vp.pan.y) / vp.zoom };
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
        case 'free':
          commitDoc((doc0) => ({ ...doc0, nodes: mutations.moveFreeNode(doc0.nodes, d.id, d.ox + dx, d.oy + dy) }), true);
          break;
        case 'attached': {
          const p = toCanvasPoint(e.clientX, e.clientY, vp);
          setDragGhost({ id: d.id, x: p.x, y: p.y });
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
      if (d.kind === 'attached') {
        const vp = viewportRef.current;
        const p = toCanvasPoint(e.clientX, e.clientY, vp);
        const dist = Math.hypot(p.x - d.startGeomX, p.y - d.startGeomY);
        setDragGhost(null);
        if (dist > 40) {
          commitDoc((doc0) => ({ ...doc0, nodes: mutations.detachNodeToFree(doc0.nodes, d.id, p.x, p.y) }));
        }
        // small move: snap back — nothing to commit (matches MindFlow.dc.html:1799)
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

  const beginNodeDrag = useCallback(
    (e: ReactPointerEvent, id: string) => {
      e.stopPropagation();
      capturePointer(e);
      const n = docRef.current.nodes[id];
      if (!n) return;
      setSelectionState({ kind: 'node', id });
      if (id === ROOT_ID) {
        objDragRef.current = { kind: 'root', pointerId: e.pointerId, startClientX: e.clientX, startClientY: e.clientY, startAnchor: rootAnchor };
      } else if (n.free && !n.parent) {
        objDragRef.current = { kind: 'free', id, pointerId: e.pointerId, startClientX: e.clientX, startClientY: e.clientY, ox: n.x, oy: n.y };
      } else {
        const g = geomRef.current[id];
        if (!g) return;
        objDragRef.current = { kind: 'attached', id, pointerId: e.pointerId, startClientX: e.clientX, startClientY: e.clientY, startGeomX: g.x, startGeomY: g.y };
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
    e.stopPropagation();
    capturePointer(e);
    const f = docRef.current.floats.find((x) => x.id === id);
    if (!f) return;
    setSelectionState({ kind: 'float', id });
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
    e.stopPropagation();
    capturePointer(e);
    const l = docRef.current.lines.find((x) => x.id === id);
    if (!l) return;
    setSelectionState({ kind: 'line', id });
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

  // ---- keyboard shortcuts — port of `Component#onKey`'s map-view branch
  // (MindFlow.dc.html:2838-2905), minus outline-mode/multi-select navigation
  // (Editor-c: marquee multi-select) ----
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      const target = e.target as HTMLElement | null;
      const inEditable = !!(target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable));
      if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        saveNow();
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
    exportJSON,
    exportMarkdown,
    exportPNG,
  };
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { Doc, LayoutMode, SizeOf } from '@mindflow/mindmap-core';
import { ROOT_ID, layout } from '@mindflow/mindmap-core';
import { CanvasTextMeasurer, computeMetrics } from './metrics';
import { loadOrSeedDoc } from './storage';
import { buildVisible } from './tree';
import type { EdgeStyle } from './tree';
import { themeKeyOf, themeOf } from './theme';
import type { Theme, ThemeKey } from './theme';
import type { GeomMap, NodeGeom, PanState, ViewMode } from './types';

// State/interaction controller for the mindmap editor route — the React
// counterpart of `Component`'s state + `_layout`/`fitView`/`zoomAt`/`onWheel`
// (MindFlow.dc.html). Undo/redo, selection, editing, and persistence are out
// of scope for M3-Editor-a (land in Editor-b); this hook only owns what's
// needed to load, lay out, pan/zoom, and switch view/layout/edge/theme.

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
}

export function useEditorState(): EditorController {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const mapId = params.get('map') || null;
  const titleParam = params.get('title') ? decodeURIComponent(params.get('title') || '') : '';

  const [doc, setDoc] = useState<Doc>(() => loadOrSeedDoc(mapId, titleParam));
  const [edgeStyle, setEdgeStyle] = useState<EdgeStyle>('curve');
  const [view, setView] = useState<ViewMode>('map');
  const [viewport, setViewport] = useState<ViewportState>(INITIAL_VIEWPORT);

  const measurer = useMemo(() => new CanvasTextMeasurer(), []);
  const sizeOf: SizeOf = useCallback(
    (node, depth) => {
      const m = computeMetrics(node, depth, measurer);
      return { w: m.w, h: m.h };
    },
    [measurer],
  );

  const laidOutNodes = useMemo(() => layout(doc, doc.layoutMode, sizeOf), [doc, sizeOf]);

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

  const setLayoutMode = useCallback((mode: LayoutMode) => {
    pendingFitRef.current = true;
    setDoc((prev) => (prev.layoutMode === mode ? prev : { ...prev, layoutMode: mode }));
  }, []);

  const setThemeKey = useCallback((key: ThemeKey) => {
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

  const goHome = useCallback(() => {
    navigate('/home');
  }, [navigate]);

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
  };
}

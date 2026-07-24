import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { ROOT_ID } from '@mindflow/mindmap-core';
import { colorOf } from '../tree';
import { hexA } from '../theme';
import type { EditorController } from '../useEditorState';

interface MinimapProps {
  controller: EditorController;
  /** M6: a smaller box on mobile, where screen space is scarce. */
  isMobile?: boolean;
}

const W_DESKTOP = 178;
const H_DESKTOP = 116;
const W_MOBILE = 120;
const H_MOBILE = 78;
const PAD = 8;

/**
 * Bottom-right minimap — port of `Component#renderMinimap`/`#minimapCenterTo`/`#onMinimapDown`
 * (MindFlow.dc.html:1512-1545): the whole map scaled to fit a small `W`×`H` box, a dot per node
 * (root slightly larger), the current viewport traced as a rectangle, and click/drag-to-pan.
 */
export function Minimap({ controller, isMobile = false }: MinimapProps) {
  const { geom, theme: th, pan, zoom, vw, vh } = controller;
  const W = isMobile ? W_MOBILE : W_DESKTOP;
  const H = isMobile ? H_MOBILE : H_DESKTOP;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const draggingRef = useRef(false);
  // The mapped bounds (below) depend on the viewport *size* but not its
  // position, so panning doesn't move the minimap's coordinate system — except
  // that a minimap drag also nudges zoom-independent state, and any future
  // change to the bounds mid-drag would shift the mapping under the pointer.
  // Freezing the bounds snapshot for the whole drag keeps the mapping (and the
  // node dots) rock-steady so the viewport rect tracks the pointer 1:1.
  const [frozen, setFrozen] = useState<{ minX: number; minY: number; maxX: number; maxY: number } | null>(null);

  // 캔버스 준비(첫 센터링·폰트 측정) 전에는 내용 없이 캔버스색 박스만 —
  // 준비 전 지오메트리로 점/뷰포트 사각형을 그렸다가 정착 후 튀는 깜빡임을
  // 캔버스 커튼과 같은 타이밍에 함께 숨긴다. 프레임(ZoomControls)은 그대로.
  if (!controller.canvasReady) {
    return <div aria-hidden="true" data-minimap-holding style={{ width: W, height: H, borderRadius: 8, background: th.canvasBg }} />;
  }

  const ids = Object.keys(geom);
  if (!ids.length) return null;

  let cMinX = Infinity;
  let cMinY = Infinity;
  let cMaxX = -Infinity;
  let cMaxY = -Infinity;
  ids.forEach((id) => {
    const n = geom[id];
    if (!n) return;
    cMinX = Math.min(cMinX, n.x - n.w / 2);
    cMaxX = Math.max(cMaxX, n.x + n.w / 2);
    cMinY = Math.min(cMinY, n.y - n.h / 2);
    cMaxY = Math.max(cMaxY, n.y + n.h / 2);
  });

  // viewport rect, in canvas coordinates (port of MindFlow.dc.html:1525-1527)
  const vx0 = -pan.x / zoom;
  const vy0 = -pan.y / zoom;
  const vx1 = (vw - pan.x) / zoom;
  const vy1 = (vh - pan.y) / zoom;

  // Choose the mapped region so the orange viewport rectangle reads as a small
  // inner box, not a slab filling the whole minimap. It's centered on the
  // CONTENT midpoint and sized to comfortably contain both the node cluster and
  // a REFERENCE viewport, times `OVERVIEW` (so whichever is larger occupies
  // only ~1/OVERVIEW of the minimap). The reference viewport is the screen size
  // at zoom 1 (vw/vh, NOT ÷ the live zoom): tall portrait phones show a much
  // taller visible area than the short content, so a content-only margin
  // couldn't shrink the rect vertically — folding the screen size in fixes
  // that. Crucially the mapping depends on neither pan NOR zoom, so it never
  // shifts while panning and never rescales while zooming — which is what lets
  // the orange rect itself grow/shrink with 1/zoom. (An earlier version divided
  // by the live zoom here; that made the mapping scale cancel the rect's own
  // 1/zoom exactly, so the rect looked FROZEN at every zoom level.) The rect is
  // still CLAMPED to the box below as a backstop when zoomed far out.
  const OVERVIEW = 1.9;
  const cCx = (cMinX + cMaxX) / 2;
  const cCy = (cMinY + cMaxY) / 2;
  const halfW = Math.max((cMaxX - cMinX) / 2, vw / 2) * OVERVIEW + 20;
  const halfH = Math.max((cMaxY - cMinY) / 2, vh / 2) * OVERVIEW + 20;
  const liveMinX = cCx - halfW;
  const liveMinY = cCy - halfH;
  const liveMaxX = cCx + halfW;
  const liveMaxY = cCy + halfH;

  const minX = frozen ? frozen.minX : liveMinX;
  const minY = frozen ? frozen.minY : liveMinY;
  const maxX = frozen ? frozen.maxX : liveMaxX;
  const maxY = frozen ? frozen.maxY : liveMaxY;

  const bw = Math.max(1, maxX - minX);
  const bh = Math.max(1, maxY - minY);
  const s = Math.min((W - PAD * 2) / bw, (H - PAD * 2) / bh);
  const ox = PAD + (W - PAD * 2 - bw * s) / 2;
  const oy = PAD + (H - PAD * 2 - bh * s) / 2;
  const mx = (x: number): number => ox + (x - minX) * s;
  const my = (y: number): number => oy + (y - minY) * s;

  // Viewport rectangle, clamped to the minimap box so it never spills outside
  // (when zoomed out past the content it simply fills the box).
  const clampBox = (v: number, hi: number): number => Math.max(0, Math.min(hi, v));
  const rx0 = clampBox(mx(vx0), W);
  const ry0 = clampBox(my(vy0), H);
  const rx1 = clampBox(mx(vx1), W);
  const ry1 = clampBox(my(vy1), H);

  const centerFromEvent = (clientX: number, clientY: number): void => {
    const svg = svgRef.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const cx = (clientX - r.left - ox) / s + minX;
    const cy = (clientY - r.top - oy) / s + minY;
    controller.panToCanvasPoint(cx, cy);
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>): void => {
    e.stopPropagation();
    e.preventDefault();
    draggingRef.current = true;
    // Freeze the current bounds so the whole drag maps against one stable
    // coordinate system (see `frozen`). Snapshot the live values, not the
    // already-frozen ones, since we're just entering a drag.
    setFrozen({ minX: liveMinX, minY: liveMinY, maxX: liveMaxX, maxY: liveMaxY });
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* not implemented in some environments (e.g. jsdom) — non-fatal */
    }
    centerFromEvent(e.clientX, e.clientY);
  };
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>): void => {
    if (!draggingRef.current) return;
    centerFromEvent(e.clientX, e.clientY);
  };
  const onPointerUp = (): void => {
    draggingRef.current = false;
    setFrozen(null);
  };

  return (
    <svg
      ref={svgRef}
      width={W}
      height={H}
      data-testid="minimap"
      // `touch-action: none` is essential for drag-to-pan on touch devices:
      // without it the browser claims a one-finger drag on the SVG as a
      // scroll/zoom gesture and fires `pointercancel` instead of delivering
      // `pointermove`, so the drag dies the moment the finger moves (the main
      // canvas `.mf-ed-vp` sets this in editor.css for the same reason).
      style={{ display: 'block', borderRadius: 8, cursor: 'grab', background: th.canvasBg, touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {ids.map((id) => {
        const n = geom[id];
        if (!n) return null;
        return <circle key={id} cx={mx(n.x)} cy={my(n.y)} r={id === ROOT_ID ? 3.4 : 2.2} fill={colorOf(id, controller.doc.nodes, th)} opacity={0.9} />;
      })}
      <rect
        data-testid="minimap-viewport"
        x={rx0}
        y={ry0}
        width={Math.max(0, rx1 - rx0)}
        height={Math.max(0, ry1 - ry0)}
        fill={hexA(th.accent, 0.12)}
        stroke={th.accent}
        strokeWidth={1.2}
        rx={3}
      />
    </svg>
  );
}

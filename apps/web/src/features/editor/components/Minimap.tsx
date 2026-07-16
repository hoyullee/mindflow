import { useRef } from 'react';
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

  const ids = Object.keys(geom);
  if (!ids.length) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  ids.forEach((id) => {
    const n = geom[id];
    if (!n) return;
    minX = Math.min(minX, n.x - n.w / 2);
    maxX = Math.max(maxX, n.x + n.w / 2);
    minY = Math.min(minY, n.y - n.h / 2);
    maxY = Math.max(maxY, n.y + n.h / 2);
  });

  // viewport rect, in canvas coordinates (port of MindFlow.dc.html:1525-1527)
  const vx0 = -pan.x / zoom;
  const vy0 = -pan.y / zoom;
  const vx1 = (vw - pan.x) / zoom;
  const vy1 = (vh - pan.y) / zoom;

  // Fit the minimap to content ∪ current viewport (the dc original fit only the
  // content, so when you were zoomed out enough to see past the node cluster the
  // viewport rectangle spilled way outside the minimap and read as "too wide").
  // Unioning in the viewport keeps that rectangle inside the box and proportional
  // to what you're actually seeing; when zoomed in it's a no-op (the viewport is
  // already within the content bounds).
  minX = Math.min(minX, vx0);
  minY = Math.min(minY, vy0);
  maxX = Math.max(maxX, vx1);
  maxY = Math.max(maxY, vy1);

  const bw = Math.max(1, maxX - minX);
  const bh = Math.max(1, maxY - minY);
  const s = Math.min((W - PAD * 2) / bw, (H - PAD * 2) / bh);
  const ox = PAD + (W - PAD * 2 - bw * s) / 2;
  const oy = PAD + (H - PAD * 2 - bh * s) / 2;
  const mx = (x: number): number => ox + (x - minX) * s;
  const my = (y: number): number => oy + (y - minY) * s;

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
  };

  return (
    <svg
      ref={svgRef}
      width={W}
      height={H}
      data-testid="minimap"
      style={{ display: 'block', borderRadius: 8, cursor: 'grab', background: th.canvasBg }}
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
        x={mx(vx0)}
        y={my(vy0)}
        width={(vx1 - vx0) * s}
        height={(vy1 - vy0) * s}
        fill={hexA(th.accent, 0.12)}
        stroke={th.accent}
        strokeWidth={1.2}
        rx={3}
      />
    </svg>
  );
}

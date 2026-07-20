import { cubicAt } from '@mindflow/mindmap-core';
import type { EditorController } from '../useEditorState';
import type { Theme } from '../theme';

interface MoveHandleProps {
  controller: EditorController;
  theme: Theme;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Canvas-space bounding box (center + size) of the current single selection. */
export function boxFor(controller: EditorController): Box | null {
  const s = controller.selection;
  if (!s) return null;
  if (s.kind === 'node') {
    const g = controller.geom[s.id];
    return g ? { x: g.x, y: g.y, w: g.w, h: g.h } : null;
  }
  if (s.kind === 'float') {
    const f = controller.doc.floats.find((x) => x.id === s.id);
    if (!f) return null;
    const h = controller.floatHeights[f.id] ?? f.h ?? 44; // measured (grown) height
    return { x: f.x + f.w / 2, y: f.y + h / 2, w: f.w, h };
  }
  if (s.kind === 'zone') {
    const z = controller.doc.zones.find((x) => x.id === s.id);
    return z ? { x: z.x + z.w / 2, y: z.y + z.h / 2, w: z.w, h: z.h } : null;
  }
  const l = controller.doc.lines.find((x) => x.id === s.id);
  if (!l) return null;
  const m = cubicAt(controller.lineGeometry(l), 0.5);
  return { x: m.x, y: m.y, w: 40, h: 40 };
}

/**
 * Mobile move grip (option B): a deliberate "grab here to move" handle pinned to
 * the top-left of the current selection. Dragging it moves the object via the
 * same drag machinery as dragging the object body (which also works once
 * selected — option A). Rendered in SCREEN space (outside the pan/zoom
 * transform) so it stays a constant, comfortably tappable size at any zoom.
 */
export function MoveHandle({ controller, theme: th }: MoveHandleProps) {
  const box = boxFor(controller);
  if (!box) return null;
  const { pan, zoom } = controller;
  // top-left corner of the box in screen coords, then the handle just outside it
  const cornerX = (box.x - box.w / 2) * zoom + pan.x;
  const cornerY = (box.y - box.h / 2) * zoom + pan.y;
  const SIZE = 38;
  const left = cornerX - SIZE - 2;
  const top = cornerY - SIZE - 2;

  return (
    <button
      type="button"
      aria-label="이동"
      title="드래그하여 이동"
      onPointerDown={controller.beginMoveSelected}
      style={{
        position: 'absolute',
        left,
        top,
        width: SIZE,
        height: SIZE,
        borderRadius: '50%',
        border: `2px solid ${th.panel}`,
        background: th.accent,
        color: th.accentInk,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 2px 8px rgba(0,0,0,.28)',
        cursor: 'grab',
        padding: 0,
        touchAction: 'none',
        zIndex: 18,
      }}
    >
      <svg width={19} height={19} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <polyline points="5 9 2 12 5 15" />
        <polyline points="9 5 12 2 15 5" />
        <polyline points="15 19 12 22 9 19" />
        <polyline points="19 9 22 12 19 15" />
        <line x1={2} y1={12} x2={22} y2={12} />
        <line x1={12} y1={2} x2={12} y2={22} />
      </svg>
    </button>
  );
}

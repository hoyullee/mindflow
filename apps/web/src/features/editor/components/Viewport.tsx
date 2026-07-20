import type { Doc } from '@mindflow/mindmap-core';
import type { EditorController } from '../useEditorState';
import { NodeLayer } from './NodeLayer';
import { EdgeLayer } from './EdgeLayer';
import { FloatLayer } from './FloatLayer';
import { LineLayer } from './LineLayer';
import { ZoneLayer } from './ZoneLayer';
import { MarqueeLayer } from './MarqueeLayer';
import { PresenceLayer } from './PresenceLayer';
import { ContextMenu } from './ContextMenu';
import { TextToolbar } from './TextToolbar';
import { MoveHandle } from './MoveHandle';
import { useIsMobile } from '../../../hooks/useMediaQuery';

interface ViewportProps {
  doc: Doc;
  controller: EditorController;
}

/**
 * The pan/zoom canvas — port of the `.mf-vp` viewport + `Component#renderCanvas`'s
 * outer transform group (MindFlow.dc.html:99-101, 1303-1304). Pan (background
 * drag) and zoom (wheel/pinch/buttons) live in `useEditorState`; this component
 * only applies the resulting CSS transform and stacks the render layers in the
 * original's z-order: zones → tree edges → nodes → free lines → floats.
 */
export function Viewport({ doc, controller }: ViewportProps) {
  const { theme, geom, layoutMode, edgeStyle, pan, zoom } = controller;
  const isMobile = useIsMobile();
  // Show the move grip only for a true single selection that isn't being edited
  // (an active text edit owns the object; a marquee multi-selection has no single box).
  const showMoveHandle =
    isMobile && !!controller.selection && !controller.editingNodeId && !controller.editingFloatId && !controller.editingLineId && !controller.editingZoneId;

  return (
    <div style={{ position: 'relative', flex: '1 1 auto', overflow: 'hidden' }}>
      <div
        className="mf-ed-vp"
        ref={controller.setViewportEl}
        onPointerDown={controller.onBackgroundPointerDown}
        onPointerMove={(e) => controller.reportPointerPosition(e.clientX, e.clientY)}
        onPointerLeave={controller.clearPointerPosition}
        onContextMenu={controller.onContextMenu}
        style={{
          position: 'absolute',
          inset: 0,
          cursor: 'default',
          backgroundColor: theme.canvasBg,
          backgroundImage: `radial-gradient(${theme.dot} 1.2px, transparent 1.2px)`,
          backgroundSize: '26px 26px',
          touchAction: 'none',
        }}
      >
        <div style={{ position: 'absolute', inset: 0 }}>
          {/* Hold the canvas (background only) until the real doc has loaded, so
              the placeholder seed never flashes before the actual tree. */}
          {controller.hydrating ? (
            <LoadingCanvas theme={theme} />
          ) : (
            <>
              <div style={{ position: 'absolute', left: 0, top: 0, transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})`, transformOrigin: '0 0' }}>
                <ZoneLayer zones={doc.zones} theme={theme} controller={controller} />
                <EdgeLayer nodes={doc.nodes} geom={geom} mode={layoutMode} edgeStyle={edgeStyle} theme={theme} />
                <NodeLayer nodes={doc.nodes} geom={geom} mode={layoutMode} theme={theme} controller={controller} />
                <LineLayer lines={doc.lines} theme={theme} controller={controller} />
                <FloatLayer floats={doc.floats} theme={theme} controller={controller} />
                <MarqueeLayer rect={controller.marquee} theme={theme} />
                <PresenceLayer controller={controller} />
              </div>
              {/* Move grip (mobile) — screen-space so it stays a constant tap size at any zoom. */}
              {showMoveHandle && <MoveHandle controller={controller} theme={theme} />}
            </>
          )}
        </div>
        {/* NOT inside the pan/zoom transform above — `ctxMenu.sx/sy` are already screen
            (viewport-relative) coordinates (port of `Component#openCtxAt`'s `sx`/`sy`,
            MindFlow.dc.html:2794-2795), so this sits in the SAME untransformed box `.mf-ed-vp`
            itself occupies. */}
        <ContextMenu controller={controller} />
        {/* Same untransformed screen-coordinate box as `ContextMenu` above — `textCtx.sx/sy`
            are already viewport-relative (`NodeEditBox`'s `openTextCtx` call). */}
        <TextToolbar controller={controller} />
      </div>
    </div>
  );
}

/** Shown over the canvas background while the real doc loads (see `hydrating`) —
 * a subtle centered spinner instead of the placeholder tree. Uses SVG
 * `animateTransform` so it needs no CSS keyframes. */
function LoadingCanvas({ theme }: { theme: import('../theme').Theme }) {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
      <svg width={30} height={30} viewBox="0 0 50 50" aria-label="불러오는 중" role="img">
        <circle cx={25} cy={25} r={20} fill="none" stroke={theme.border} strokeWidth={5} />
        <circle cx={25} cy={25} r={20} fill="none" stroke={theme.accent} strokeWidth={5} strokeLinecap="round" strokeDasharray="31 126">
          <animateTransform attributeName="transform" type="rotate" from="0 25 25" to="360 25 25" dur="0.8s" repeatCount="indefinite" />
        </circle>
      </svg>
    </div>
  );
}

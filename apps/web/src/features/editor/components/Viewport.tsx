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
 * only applies the resulting CSS transform. Effective paint order (via per-layer
 * z-index, bottom→top): tree edges → nodes → zones (z 8) → floats/memos (z 10/20)
 * → free connector lines (z 25) — connectors sit on top so an arrow landing on a
 * memo isn't hidden behind it.
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
              the placeholder seed never flashes before the actual tree. On a load
              FAILURE, show an error+retry instead of the empty seed — the doc
              didn't load, so editing/saving it would risk clobbering the backend. */}
          {controller.loadError ? (
            <LoadErrorCanvas theme={theme} onRetry={controller.retryLoad} />
          ) : controller.hydrating ? (
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

/** Shown when the initial doc load FAILED — an error message + retry, instead of
 * the empty seed. Editing/saving stays blocked (see `canPersistDocRef`) so a
 * failed load can never let the empty canvas overwrite the real backend doc. */
function LoadErrorCanvas({ theme, onRetry }: { theme: import('../theme').Theme; onRetry: () => void }) {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24, textAlign: 'center' }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: theme.text }}>맵을 불러오지 못했어요</div>
      <div style={{ fontSize: 13, color: theme.subtext, maxWidth: 320, lineHeight: 1.6 }}>
        네트워크 문제로 저장된 내용을 불러오지 못했습니다. 데이터 보호를 위해 편집·저장을 잠시 멈췄어요. 다시 시도해 주세요.
      </div>
      <button
        type="button"
        onClick={onRetry}
        style={{ marginTop: 4, padding: '9px 18px', borderRadius: 10, border: 'none', background: theme.accent, color: theme.accentInk, fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
      >
        다시 시도
      </button>
    </div>
  );
}

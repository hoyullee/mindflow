import type { EditorController } from '../useEditorState';

interface PresenceLayerProps {
  controller: EditorController;
}

/**
 * Remote peers' live cursors — rendered INSIDE the same pan/zoom transform
 * group as the nodes/floats/lines (`Viewport.tsx`), since `usePresence`'s
 * `cursor` is already in canvas (untransformed) coordinates
 * (`useEditorState.reportPointerPosition` → `toCanvasPoint`). A small pointer
 * glyph + name label per peer, counter-scaled against the current zoom so the
 * label stays a constant on-screen size regardless of how far zoomed in/out
 * this tab is. Renders nothing when solo (`peers` is `[]`) — single-user, no-op.
 */
export function PresenceLayer({ controller }: PresenceLayerProps) {
  const { peers } = controller.presence;
  if (!peers.length) return null;
  const inv = 1 / (controller.zoom || 1);
  return (
    <>
      {peers.map((p) => {
        if (!p.cursor) return null;
        return (
          <div
            key={p.clientId}
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: p.cursor.x,
              top: p.cursor.y,
              transform: `scale(${inv})`,
              transformOrigin: '0 0',
              pointerEvents: 'none',
              zIndex: 90,
            }}
          >
            <svg width={20} height={20} viewBox="0 0 20 20" style={{ display: 'block', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.35))' }}>
              <path d="M2 1.5 L2 16.5 L6.2 12.7 L9 18.5 L11.6 17.2 L8.8 11.3 L14.5 11 Z" fill={p.user.color} stroke="#fff" strokeWidth={1} strokeLinejoin="round" />
            </svg>
            <div
              style={{
                position: 'absolute',
                left: 16,
                top: 14,
                background: p.user.color,
                color: '#fff',
                fontSize: 11,
                fontWeight: 700,
                lineHeight: 1.6,
                padding: '0 7px',
                borderRadius: 999,
                whiteSpace: 'nowrap',
                boxShadow: '0 1px 3px rgba(0,0,0,.3)',
                fontFamily: 'Pretendard, sans-serif',
              }}
            >
              {p.user.name}
            </div>
          </div>
        );
      })}
    </>
  );
}

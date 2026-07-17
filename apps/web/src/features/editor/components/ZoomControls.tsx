import type { EditorController } from '../useEditorState';
import { Minimap } from './Minimap';
import { useIsMobile } from '../../../hooks/useMediaQuery';

interface ZoomControlsProps {
  controller: EditorController;
  /** M6-mobile: true when a property panel is open. On mobile that panel is a
   * bottom sheet (max 55dvh) that would otherwise cover this bottom-right
   * cluster, so we lift the cluster just above the sheet. */
  panelOpen?: boolean;
}

/**
 * Bottom-right zoom controls + minimap — port of MindFlow.dc.html:406-427
 * (`notOutlineMode`'s panel: `showMinimap` + the zoom cluster). `showMinimap`
 * was a design-time prop in the original; this port exposes it as an in-app
 * toggle button next to the zoom controls instead (no props/config screen here).
 *
 * M6: on mobile the minimap shrinks (see `Minimap`'s `isMobile`) and every
 * button grows to a >=44px touch target (still visually compact via padding,
 * not a full 44px box, for the divider-separated zoom-percent readout).
 */
export function ZoomControls({ controller, panelOpen = false }: ZoomControlsProps) {
  const th = controller.theme;
  const isMobile = useIsMobile();
  // On mobile, the bottom-sheet property panel owns the lower screen; hide the
  // minimap/zoom cluster entirely while it's open (the selected object is
  // re-centered into the area above the sheet — see Editor). On desktop, or
  // with no panel, the cluster stays pinned bottom-right.
  if (isMobile && panelOpen) return null;
  const btnSize = isMobile ? 44 : 26;
  const btnStyle = {
    width: btnSize,
    height: btnSize,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    borderRadius: 7,
    background: 'transparent',
    color: th.text,
    fontSize: 16,
    cursor: 'pointer',
    fontFamily: 'inherit',
    padding: 0,
  } as const;

  return (
    <div
      style={{
        position: 'absolute',
        right: 16,
        bottom: 16,
        background: th.panel,
        border: `1px solid ${th.border}`,
        borderRadius: 12,
        boxShadow: '0 6px 22px rgba(0,0,0,.08)',
        zIndex: 15,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {controller.showMinimap && (
        <div style={{ padding: '6px 6px 0' }}>
          <Minimap controller={controller} isMobile={isMobile} />
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2, padding: '4px 6px' }}>
        <button
          type="button"
          className="mf-ed-btn"
          onClick={controller.toggleMinimap}
          title="미니맵 표시/숨기기"
          aria-pressed={controller.showMinimap}
          style={{ ...btnStyle, color: controller.showMinimap ? th.accent : th.text }}
        >
          <MinimapIcon />
        </button>
        {/* Mobile pinches to zoom, so the −/배율/＋ cluster is dropped there to
            keep the minimap control compact (leaving just 미니맵 토글 · 화면 맞춤). */}
        {!isMobile && (
          <>
            <div style={{ width: 1, height: 16, background: th.border, margin: '0 3px' }} />
            <button type="button" className="mf-ed-btn" onClick={controller.zoomOut} title="축소" style={btnStyle}>
              −
            </button>
            <div style={{ minWidth: 42, textAlign: 'center', fontSize: 11.5, fontWeight: 600, color: th.subtext }}>{controller.zoomPct}%</div>
            <button type="button" className="mf-ed-btn" onClick={controller.zoomIn} title="확대" style={btnStyle}>
              ＋
            </button>
          </>
        )}
        <div style={{ width: 1, height: 16, background: th.border, margin: '0 3px' }} />
        <button type="button" className="mf-ed-btn" onClick={controller.fitView} title="화면 맞춤" style={btnStyle}>
          <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 3H5a2 2 0 0 0-2 2v3" />
            <path d="M16 3h3a2 2 0 0 1 2 2v3" />
            <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
            <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function MinimapIcon() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x={3} y={4} width={18} height={16} rx={2} />
      <circle cx={8} cy={9} r={1.2} fill="currentColor" stroke="none" />
      <circle cx={15} cy={11} r={1.2} fill="currentColor" stroke="none" />
      <circle cx={11} cy={16} r={1.2} fill="currentColor" stroke="none" />
    </svg>
  );
}

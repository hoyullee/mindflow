import type { EditorController } from '../useEditorState';

interface ZoomControlsProps {
  controller: EditorController;
}

/**
 * Bottom-right zoom controls — port of the zoom cluster in
 * MindFlow.dc.html:413-427 (minus the minimap, which lands in Editor-b).
 */
export function ZoomControls({ controller }: ZoomControlsProps) {
  const th = controller.theme;
  const btnStyle = {
    width: 26,
    height: 26,
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2, padding: '4px 6px' }}>
        <button type="button" className="mf-ed-btn" onClick={controller.zoomOut} title="축소" style={btnStyle}>
          −
        </button>
        <div style={{ minWidth: 42, textAlign: 'center', fontSize: 11.5, fontWeight: 600, color: th.subtext }}>{controller.zoomPct}%</div>
        <button type="button" className="mf-ed-btn" onClick={controller.zoomIn} title="확대" style={btnStyle}>
          ＋
        </button>
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

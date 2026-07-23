import type { EditorController } from '../useEditorState';

interface ExportMenuProps {
  controller: EditorController;
  onDone: () => void;
}

/** Export dropdown — port of the `.mf-export` popover body (MindFlow.dc.html:125-133): PNG / JSON. */
export function ExportMenu({ controller, onDone }: ExportMenuProps) {
  const th = controller.uiTheme;
  const itemStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 9,
    padding: '9px 13px',
    fontSize: 13,
    cursor: 'pointer',
    color: th.text,
    borderRadius: 8,
    width: '100%',
    border: 'none',
    background: 'transparent',
    fontFamily: 'inherit',
    textAlign: 'left',
  } as const;

  return (
    <div
      className="mf-ed-exportmenu"
      style={{
        // Positioning/stacking is handled by the `AnchoredMenu` portal wrapper.
        width: '100%',
        boxSizing: 'border-box',
        background: th.panel,
        border: `1px solid ${th.border}`,
        borderRadius: 10,
        boxShadow: '0 10px 28px rgba(0,0,0,.16)',
        padding: 5,
      }}
    >
      <button
        type="button"
        className="mf-ed-btn"
        style={itemStyle}
        onClick={() => {
          controller.exportPNG();
          onDone();
        }}
      >
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <rect x={3} y={3} width={18} height={18} rx={2} />
          <circle cx={8.5} cy={8.5} r={1.5} />
          <polyline points="21 15 16 10 5 21" />
        </svg>
        PNG 이미지
      </button>
      <button
        type="button"
        className="mf-ed-btn"
        style={itemStyle}
        onClick={() => {
          controller.exportJSON();
          onDone();
        }}
      >
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        JSON 파일 (.json)
      </button>
    </div>
  );
}

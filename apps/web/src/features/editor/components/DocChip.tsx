import type { EditorController } from '../useEditorState';

interface DocChipProps {
  controller: EditorController;
}

/**
 * Top-left document chip — port of the home/title/save cluster
 * (MindFlow.dc.html:103-122). Home navigation works; title editing and the
 * save button are inert skeletons for this stage (Editor-b wires editing +
 * persistence + the dirty/saving/saved indicator).
 */
export function DocChip({ controller }: DocChipProps) {
  const th = controller.theme;
  return (
    <div
      style={{
        position: 'absolute',
        left: 16,
        top: 16,
        zIndex: 16,
        width: 236,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        background: th.panel,
        border: `1px solid ${th.border}`,
        borderRadius: 12,
        boxShadow: '0 6px 22px rgba(0,0,0,.10)',
        padding: '8px 10px',
      }}
    >
      <button
        type="button"
        className="mf-ed-btn"
        onClick={controller.goHome}
        title="홈으로"
        style={{
          width: 36,
          height: 36,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: `1px solid ${th.border}`,
          borderRadius: 9,
          background: th.panel2,
          color: th.text,
          cursor: 'pointer',
          fontFamily: 'inherit',
          padding: 0,
        }}
      >
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 10.5 12 3l9 7.5" />
          <path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" />
        </svg>
      </button>
      <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div
          title={controller.docTitle}
          style={{ fontSize: 13.5, fontWeight: 700, color: th.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.2 }}
        >
          {controller.docTitle}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, lineHeight: 1 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: '#3fae6a' }} />
          <span style={{ fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: th.subtext }}>저장됨</span>
        </div>
      </div>
      <button
        type="button"
        className="mf-ed-btn"
        disabled
        aria-disabled="true"
        title="저장 (다음 단계)"
        style={{
          width: 36,
          height: 36,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: 'none',
          borderRadius: 9,
          background: th.accent,
          color: th.accentInk,
          cursor: 'not-allowed',
          fontFamily: 'inherit',
          padding: 0,
          opacity: 0.55,
        }}
      >
        <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
          <polyline points="17 21 17 13 7 13 7 21" />
          <polyline points="7 3 7 8 15 8" />
        </svg>
      </button>
    </div>
  );
}

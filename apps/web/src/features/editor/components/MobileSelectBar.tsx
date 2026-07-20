import type { CSSProperties } from 'react';
import type { EditorController } from '../useEditorState';
import type { Theme } from '../theme';

interface MobileSelectBarProps {
  controller: EditorController;
  theme: Theme;
}

/**
 * Mobile-only floating action bar for the current single selection. On mobile,
 * a tap now just SELECTS an object (it no longer auto-opens the property bottom
 * sheet, which covered the canvas and panned the map). This compact bar is the
 * explicit follow-up: 편집(inline text) · 속성(open the sheet) · 삭제. It sits
 * above the bottom controls and is hidden while the sheet itself is open.
 */
export function MobileSelectBar({ controller, theme: th }: MobileSelectBarProps) {
  const sel = controller.selection;
  if (!sel) return null;

  const startEdit = (): void => {
    if (sel.kind === 'node') controller.startEditNode(sel.id);
    else if (sel.kind === 'float') controller.startEditFloat(sel.id);
    else if (sel.kind === 'line') controller.startEditLineLabel(sel.id);
    else if (sel.kind === 'zone') controller.startEditZoneLabel(sel.id);
  };

  const btn: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    minWidth: 56,
    height: 44,
    padding: '0 10px',
    border: 'none',
    borderRadius: 12,
    background: 'transparent',
    color: th.text,
    fontFamily: 'inherit',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
  };

  return (
    <div
      role="toolbar"
      aria-label="선택 동작"
      style={{
        position: 'fixed',
        left: '50%',
        transform: 'translateX(-50%)',
        bottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: 5,
        background: th.panel,
        border: `1px solid ${th.border}`,
        borderRadius: 16,
        boxShadow: '0 6px 22px rgba(0,0,0,.16)',
        zIndex: 22,
      }}
    >
      <button type="button" className="mf-ed-btn" style={btn} onClick={startEdit}>
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
        편집
      </button>
      <button type="button" className="mf-ed-btn" style={btn} onClick={controller.openProps}>
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <circle cx={12} cy={12} r={3} />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        속성
      </button>
      <button type="button" className="mf-ed-btn" style={{ ...btn, color: '#d92626' }} onClick={controller.deleteSelection}>
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
        삭제
      </button>
    </div>
  );
}

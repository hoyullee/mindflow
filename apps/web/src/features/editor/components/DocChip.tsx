import { useEffect, useRef } from 'react';
import type { EditorController } from '../useEditorState';

interface DocChipProps {
  controller: EditorController;
}

/**
 * Top-left document chip — port of the home/title/save cluster
 * (MindFlow.dc.html:103-122): home navigation, title editing
 * (`onTitleInput`/`commitTitle`), the save button (`saveNow`), and the
 * dirty/saving/saved indicator (`state.saveState`) are all wired (Editor-b).
 */
export function DocChip({ controller }: DocChipProps) {
  const th = controller.uiTheme;
  const dotColor = controller.saveState === 'saved' ? '#3fae6a' : controller.saveState === 'saving' ? '#e0b23c' : th.subtext;
  const label = controller.saveState === 'saved' ? '저장됨' : controller.saveState === 'saving' ? '저장 중…' : controller.saveState === 'unsaved' ? '저장 전' : '변경됨';

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
        {controller.editingTitle ? (
          <TitleEdit controller={controller} />
        ) : (
          <div
            title={controller.docTitle}
            onDoubleClick={controller.startEditTitle}
            style={{ fontSize: 13.5, fontWeight: 700, color: th.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.2, cursor: 'text' }}
          >
            {controller.docTitle}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, lineHeight: 1 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: dotColor }} />
          <span style={{ fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: th.subtext }}>{label}</span>
        </div>
        {controller.saveConflict && (
          <div
            role="alert"
            title="다른 기기/탭에서 먼저 저장되어 최신 버전을 기준으로 이어서 저장해요."
            onClick={controller.dismissSaveConflict}
            style={{ fontSize: 10.5, fontWeight: 600, color: '#c0532e', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
          >
            ⚠ 다른 곳에서 먼저 저장됨 (v{controller.saveConflict.currentVersion})
          </div>
        )}
      </div>
      <button
        type="button"
        className="mf-ed-btn"
        onClick={controller.saveNow}
        title="저장 (Ctrl+S)"
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
          cursor: 'pointer',
          fontFamily: 'inherit',
          padding: 0,
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

function TitleEdit({ controller }: { controller: EditorController }) {
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);
  return (
    <input
      ref={ref}
      className="mf-edit"
      defaultValue={controller.docTitle}
      maxLength={40}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          controller.commitTitle(e.currentTarget.value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          controller.cancelTitleEdit();
        }
      }}
      onBlur={(e) => controller.commitTitle(e.currentTarget.value)}
      style={{
        fontSize: 13.5,
        fontWeight: 700,
        color: controller.uiTheme.text,
        lineHeight: 1.2,
        width: '100%',
        border: 'none',
        borderBottom: `1.5px solid ${controller.uiTheme.accent}`,
        background: 'transparent',
        outline: 'none',
        padding: '0 0 1px',
        fontFamily: 'inherit',
        boxSizing: 'border-box',
      }}
    />
  );
}

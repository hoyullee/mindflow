import type { CSSProperties } from 'react';
import { useEffect, useRef } from 'react';
import type { Float } from '@mindflow/mindmap-core';
import { hexA } from '../theme';
import type { Theme } from '../theme';
import type { EditorController } from '../useEditorState';

interface FloatLayerProps {
  floats: Float[];
  theme: Theme;
  controller: EditorController;
}

/**
 * Free-floating memo cards — port of `Component#renderFloats`
 * (MindFlow.dc.html:1441-1510): selection ring, drag-to-move, resize handle,
 * fold/unfold toggle, and double-click/F2 text editing are wired (Editor-b).
 */
export function FloatLayer({ floats, theme: th, controller }: FloatLayerProps) {
  if (!floats.length) return null;
  return (
    <>
      {floats.map((f) => {
        // port of `MSEL.floats.includes(f.id)` — a marquee multi-selection rings every target.
        const selected = controller.multiGroups.floats.includes(f.id);
        const editing = controller.editingFloatId === f.id;
        const collapsed = !!f.collapsed;
        const fFpx = f.tsize === 's' ? 11.5 : f.tsize === 'l' ? 15.5 : 13;
        const boxStyle: CSSProperties = {
          position: 'absolute',
          left: f.x,
          top: f.y,
          width: f.w,
          minHeight: f.h || 44,
          background: f.bg ? f.bg : th.appBg === '#191512' ? '#3a2f22' : '#fff6cf',
          color: f.textColor || th.text,
          border: `1px solid ${f.bg ? hexA('#000000', 0.14) : th.appBg === '#191512' ? '#5a4a2f' : '#f0e3a0'}`,
          borderRadius: 8,
          padding: '9px 11px 9px 32px',
          fontFamily: 'Pretendard, sans-serif',
          fontSize: fFpx,
          fontWeight: f.bold ? 700 : 400,
          lineHeight: 1.55,
          boxShadow: selected ? `0 0 0 2px ${th.panel}, 0 0 0 4px ${hexA(th.accent, 0.55)}, 0 3px 10px rgba(0,0,0,.10)` : '0 3px 10px rgba(0,0,0,.10)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          boxSizing: 'border-box',
          zIndex: selected || editing ? 20 : 10,
          userSelect: 'none',
          cursor: 'grab',
        };
        if (collapsed && !editing) {
          boxStyle.minHeight = 38;
          boxStyle.whiteSpace = 'nowrap';
        }
        const shown = collapsed ? String(f.text || '').split('\n')[0] : f.text;
        return (
          <div
            key={f.id}
            style={boxStyle}
            onPointerDown={(e) => controller.beginFloatDrag(e, f.id)}
            onDoubleClick={(e) => {
              e.stopPropagation();
              controller.startEditFloat(f.id);
            }}
          >
            <div
              title={collapsed ? '펼치기' : '접기'}
              onPointerDown={(e) => {
                e.stopPropagation();
                controller.toggleFloatCollapse(f.id);
              }}
              style={{
                position: 'absolute',
                left: 6,
                top: 6,
                width: 20,
                height: 20,
                borderRadius: '50%',
                background: th.accent,
                color: th.accentInk,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12,
                fontWeight: 700,
                lineHeight: 1,
                userSelect: 'none',
                boxShadow: '0 1px 3px rgba(0,0,0,.2)',
                zIndex: 4,
                cursor: 'pointer',
              }}
            >
              {collapsed ? '＋' : '−'}
            </div>
            {editing ? (
              <FloatEditBox f={f} onCommit={(text) => controller.commitFloatText(f.id, text)} onCancel={controller.cancelFloatEdit} />
            ) : (
              <div
                style={{
                  pointerEvents: 'none',
                  minHeight: 18,
                  color: f.text ? 'inherit' : hexA(th.text, 0.4),
                  overflow: collapsed ? 'hidden' : undefined,
                  textOverflow: collapsed ? 'ellipsis' : undefined,
                  whiteSpace: collapsed ? 'nowrap' : undefined,
                }}
              >
                {shown || '메모 입력…'}
              </div>
            )}
            {/* resize handle only for a true single selection (port of `this.state.selFloat`,
                MindFlow.dc.html:1486 — hidden during a marquee multi-selection) */}
            {controller.selection?.kind === 'float' && controller.selection.id === f.id && !editing && (
              <div
                title="크기 조절"
                onPointerDown={(e) => controller.beginFloatResize(e, f.id)}
                style={{
                  position: 'absolute',
                  right: -6,
                  bottom: -6,
                  width: 13,
                  height: 13,
                  borderRadius: 4,
                  background: th.panel,
                  border: `2px solid ${th.accent}`,
                  cursor: 'nwse-resize',
                  zIndex: 6,
                  boxSizing: 'border-box',
                  boxShadow: '0 1px 4px rgba(0,0,0,.2)',
                }}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

function FloatEditBox({ f, onCommit, onCancel }: { f: Float; onCommit: (text: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);
  return (
    <textarea
      ref={ref}
      className="mf-edit"
      defaultValue={f.text}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
      onBlur={(e) => onCommit(e.currentTarget.value)}
      placeholder="메모 입력…"
      style={{
        display: 'block',
        width: '100%',
        minHeight: 18,
        border: 'none',
        background: 'transparent',
        color: 'inherit',
        font: 'inherit',
        outline: 'none',
        resize: 'vertical',
        padding: 0,
        cursor: 'text',
      }}
    />
  );
}

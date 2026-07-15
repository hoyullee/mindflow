import { useEffect, useRef } from 'react';
import { ROOT_ID } from '@mindflow/mindmap-core';
import { colorOf, descendants, outlineRows } from '../tree';
import type { EditorController } from '../useEditorState';

interface OutlineViewProps {
  controller: EditorController;
}

/**
 * Editable indented tree — port of `Component#renderOutline` (MindFlow.dc.html:1982-2046):
 * selection (click), rename (F2/double-click), Tab (add child), Enter (commit + add sibling,
 * or add child at the root), ↑/↓ (move the selection between rows), Delete (remove the subtree).
 */
export function OutlineView({ controller }: OutlineViewProps) {
  const { doc, theme: th } = controller;
  const nodes = doc.nodes;
  const rows = outlineRows(nodes);
  const treeCount = rows.filter((r) => !nodes[r.id]?.free).length;
  let freeHeaderShown = false;

  return (
    <div style={{ maxWidth: 780, margin: '0 auto', padding: '96px 36px 90px', fontFamily: 'Pretendard, sans-serif' }}>
      {rows.map(({ id, depth }) => {
        const n = nodes[id];
        if (!n) return null;
        const isRoot = id === ROOT_ID;
        const col = colorOf(id, nodes, th);
        const hasKids = n.children.length > 0;
        const showFreeHeader = !!n.free && !freeHeaderShown;
        if (showFreeHeader) freeHeaderShown = true;
        const showDivider = isRoot && treeCount > 0;
        const selected = controller.selection?.kind === 'node' && controller.selection.id === id;
        const editing = controller.outlineEditId === id;

        return (
          <div key={id}>
            {showFreeHeader && (
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: th.subtext, margin: '26px 0 8px', paddingLeft: 4 }}>
                개별 주제
              </div>
            )}
            <div
              onMouseDown={(e) => {
                e.stopPropagation();
                controller.selectNode(id);
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                controller.outlineStartEdit(id);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                minHeight: isRoot ? 44 : 36,
                margin: isRoot ? '0 0 10px' : '1px 0',
                padding: '4px 10px',
                paddingLeft: 10 + depth * 26,
                borderRadius: 9,
                cursor: 'default',
                background: selected ? `${th.accent}1a` : 'transparent',
                boxShadow: selected ? `inset 0 0 0 1.5px ${th.accent}8c` : 'none',
              }}
            >
              <div
                aria-hidden="true"
                onMouseDown={(e) => {
                  e.stopPropagation();
                  if (hasKids) controller.toggleCollapse(id);
                }}
                style={{
                  width: 20,
                  height: 20,
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: th.subtext,
                  fontSize: 10,
                  userSelect: 'none',
                  cursor: hasKids ? 'pointer' : 'default',
                  visibility: hasKids ? 'visible' : 'hidden',
                }}
              >
                {n.collapsed ? '▸' : '▾'}
              </div>
              <div style={{ width: isRoot ? 12 : 9, height: isRoot ? 12 : 9, borderRadius: '50%', background: isRoot ? th.accent : col, flexShrink: 0, marginRight: 10 }} />
              {n.emoji && <span style={{ marginRight: 6, fontSize: isRoot ? 17 : 14 }}>{n.emoji}</span>}
              {editing ? (
                <OutlineRowInput controller={controller} id={id} isRoot={isRoot} depth={depth} />
              ) : (
                <div
                  style={{
                    flex: '1 1 auto',
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    color: n.textColor || th.text,
                    fontSize: isRoot ? 19 : depth === 1 ? 15 : 14,
                    fontWeight: n.bold ? 800 : isRoot ? 800 : depth === 1 ? 600 : 500,
                  }}
                >
                  {(n.text || '').replace(/\n/g, ' ') || ' '}
                </div>
              )}
              {n.note && n.note.trim() && (
                <span title={n.note} style={{ flexShrink: 0, marginLeft: 8, display: 'flex', color: th.accent }}>
                  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
                  </svg>
                </span>
              )}
              {hasKids && n.collapsed && (
                <span style={{ flexShrink: 0, marginLeft: 8, fontSize: 11, color: th.subtext, background: th.panel2, border: `1px solid ${th.border}`, borderRadius: 999, padding: '1px 7px' }}>
                  {descendants(nodes, id).length}
                </span>
              )}
            </div>
            {showDivider && <div style={{ height: 1, background: th.border, margin: '0 0 12px' }} />}
          </div>
        );
      })}
      <div style={{ marginTop: 26, fontSize: 12, color: th.subtext, lineHeight: 1.7, paddingLeft: 4 }}>
        <b style={{ color: th.text }}>Tab</b> 자식 추가 · <b style={{ color: th.text }}>Enter</b> 형제 추가 · <b style={{ color: th.text }}>F2/더블클릭</b> 이름 편집 ·{' '}
        <b style={{ color: th.text }}>↑/↓</b> 이동 · <b style={{ color: th.text }}>Delete</b> 삭제
      </div>
    </div>
  );
}

interface OutlineRowInputProps {
  controller: EditorController;
  id: string;
  isRoot: boolean;
  depth: number;
}

/** The outline row's inline `<input>` editor — port of the `editing` branch of
 * `Component#renderOutline` (MindFlow.dc.html:2007-2022): Enter commits + adds a sibling
 * (skipped for the root), Tab commits + indents (Shift+Tab outdents), Escape COMMITS (not
 * cancels — matches the original exactly, unlike the map canvas's node editor). */
function OutlineRowInput({ controller, id, isRoot, depth }: OutlineRowInputProps) {
  const th = controller.theme;
  const n = controller.doc.nodes[id];
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);
  if (!n) return null;
  return (
    <input
      ref={ref}
      className="mf-edit"
      defaultValue={n.text || ''}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          const v = e.currentTarget.value;
          controller.outlineCommitEdit(id, v);
          if (!isRoot) controller.outlineAddSibling(id);
        } else if (e.key === 'Tab') {
          e.preventDefault();
          const v = e.currentTarget.value;
          controller.outlineCommitEdit(id, v);
          if (e.shiftKey) controller.outlineOutdent(id);
          else controller.outlineIndent(id);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          controller.outlineCommitEdit(id, e.currentTarget.value);
        }
      }}
      onBlur={(e) => controller.outlineCommitEdit(id, e.currentTarget.value)}
      style={{
        flex: '1 1 auto',
        minWidth: 0,
        border: 'none',
        borderBottom: `1.5px solid ${th.accent}`,
        background: 'transparent',
        color: n.textColor || th.text,
        fontFamily: 'inherit',
        fontSize: isRoot ? 19 : depth === 1 ? 15 : 14,
        fontWeight: n.bold ? 800 : isRoot ? 800 : depth === 1 ? 600 : 500,
        padding: '0 0 1px',
        outline: 'none',
      }}
    />
  );
}

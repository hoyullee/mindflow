import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import type { LayoutMode, Node, NodeMap } from '@mindflow/mindmap-core';
import { ROOT_ID } from '@mindflow/mindmap-core';
import { colorOf, descendants } from '../tree';
import { hexA } from '../theme';
import type { Theme } from '../theme';
import type { EditorController } from '../useEditorState';
import type { GeomMap } from '../types';

interface NodeLayerProps {
  nodes: NodeMap;
  geom: GeomMap;
  mode: LayoutMode;
  theme: Theme;
  controller: EditorController;
}

/**
 * Node boxes — port of the node half of `Component#renderCanvas`
 * (MindFlow.dc.html:1136-1265): selection ring, drag-to-move/detach,
 * double-click/F2 text editing, resize handle, and the collapse toggle are
 * all wired (Editor-b). Rich partial-run styling (bold/color on a text
 * *selection* within a node) and the drag-ghost→drop-target reattach gesture
 * remain out of scope (Editor-c).
 */
export function NodeLayer({ nodes, geom, mode, theme, controller }: NodeLayerProps) {
  const rootGeom = geom[ROOT_ID];
  const ghost = controller.dragGhost;
  const ghostGeom = ghost ? geom[ghost.id] : null;
  return (
    <>
      {Object.keys(geom).map((id) => {
        const n = nodes[id];
        const g = geom[id];
        if (!n || !g) return null;
        return <NodeBox key={id} id={id} node={n} g={g} nodes={nodes} mode={mode} theme={theme} rootX={rootGeom?.x ?? 0} controller={controller} />;
      })}
      {ghost && ghostGeom && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: ghost.x - ghostGeom.w / 2,
            top: ghost.y - ghostGeom.h / 2,
            width: ghostGeom.w,
            height: ghostGeom.h,
            borderRadius: 10,
            border: `2px dashed ${theme.accent}`,
            background: hexA(theme.accent, 0.1),
            opacity: 0.85,
            pointerEvents: 'none',
            zIndex: 40,
            boxSizing: 'border-box',
          }}
        />
      )}
    </>
  );
}

interface NodeBoxProps {
  id: string;
  node: Node;
  g: GeomMap[string];
  nodes: NodeMap;
  mode: LayoutMode;
  theme: Theme;
  rootX: number;
  controller: EditorController;
}

function NodeBox({ id, node: n, g, nodes, mode, theme: th, rootX, controller }: NodeBoxProps) {
  const depth = g.depth;
  const col = colorOf(id, nodes, th);
  // port of `MSEL.nodes.includes(v.id)` (MindFlow.dc.html:1138) — a marquee multi-selection
  // rings EVERY targeted node, not just a single `selection`.
  const selected = controller.multiGroups.nodes.includes(id);
  const editing = controller.editingNodeId === id;
  const attach = controller.attachTarget?.id === id;

  const boxStyle: CSSProperties = {
    position: 'absolute',
    left: g.x - g.w / 2,
    top: g.y - g.h / 2,
    width: g.w,
    height: g.h,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: n.emoji ? 7 : 0,
    borderRadius: depth === 0 ? 15 : depth === 1 ? 12 : 10,
    cursor: 'grab',
    userSelect: 'none',
    fontFamily: 'Pretendard, sans-serif',
    boxSizing: 'border-box',
    whiteSpace: 'pre-wrap',
    textAlign: 'center',
  };

  const userFill = n.fill || null;
  const userStroke = n.stroke || null;
  const fillA = n.fillA == null ? 1 : n.fillA;
  const strokeA = n.strokeA == null ? (depth >= 2 ? 0.5 : 1) : n.strokeA;
  const dFill = userFill || (depth === 0 ? th.accent : th.panel);
  const dStroke = userStroke || (depth === 0 ? th.accent : col);
  const fillCss = hexA(dFill, fillA);
  const strokeCss = hexA(dStroke, strokeA);

  if (depth === 0) {
    boxStyle.background = fillCss;
    boxStyle.color = th.accentInk;
    boxStyle.fontWeight = 700;
    boxStyle.fontSize = 20;
    boxStyle.padding = '0 24px';
    boxStyle.boxShadow = `0 6px 18px ${hexA(th.accent, 0.35)}`;
    if (userStroke) boxStyle.border = `2px solid ${strokeCss}`;
  } else if (depth === 1) {
    boxStyle.background = fillCss;
    boxStyle.color = th.text;
    boxStyle.fontWeight = 600;
    boxStyle.fontSize = 15;
    boxStyle.padding = '0 15px';
    boxStyle.border = `2px solid ${strokeCss}`;
    boxStyle.boxShadow = '0 3px 10px rgba(0,0,0,.06)';
  } else {
    boxStyle.background = fillCss;
    boxStyle.color = th.text;
    boxStyle.fontWeight = 500;
    boxStyle.fontSize = 14;
    boxStyle.padding = '0 13px';
    boxStyle.border = '1.5px solid ' + strokeCss;
    boxStyle.boxShadow = '0 2px 6px rgba(0,0,0,.04)';
  }

  if (selected) boxStyle.boxShadow = `0 0 0 2px ${th.panel}, 0 0 0 4px ${hexA(th.accent, 0.55)}, 0 6px 18px rgba(0,0,0,.12)`;
  // drop-target highlight while another node is being dragged over this one — port of
  // `Component#renderCanvas`'s `_attachHi` ring (MindFlow.dc.html:1158-1159).
  if (attach) boxStyle.boxShadow = `0 0 0 3px ${th.accent}, 0 0 0 7px ${hexA(th.accent, 0.25)}, 0 6px 18px rgba(0,0,0,.16)`;
  if (editing) boxStyle.zIndex = 70;

  const shape = n.shape || 'round';
  let shapeBg: ReactNode = null;
  if (shape === 'rect') boxStyle.borderRadius = 3;
  else if (shape === 'pill') boxStyle.borderRadius = 999;
  else if (shape === 'ellipse') boxStyle.borderRadius = '50%';
  else if (shape === 'underline') {
    boxStyle.background = 'transparent';
    boxStyle.border = 'none';
    boxStyle.borderRadius = 0;
    boxStyle.borderBottom = `3px solid ${hexA(userStroke || (depth === 0 ? th.accent : col), strokeA)}`;
    boxStyle.boxShadow = selected ? `0 3px 0 -1px ${hexA(th.accent, 0.9)}` : 'none';
    if (depth === 0) boxStyle.color = th.text;
  } else if (shape === 'hexagon' || shape === 'diamond' || shape === 'parallelogram') {
    boxStyle.background = 'transparent';
    boxStyle.border = 'none';
    boxStyle.borderRadius = 0;
    boxStyle.boxShadow = 'none';
    if (shape === 'parallelogram') boxStyle.padding = '0 22px';
    const polyFill = fillCss;
    const bw2 = depth >= 2 ? 1.5 : 2;
    boxStyle.color = depth === 0 ? th.accentInk : th.text;
    const W = g.w;
    const H = g.h;
    const pts =
      shape === 'hexagon'
        ? `${0.14 * W},0 ${0.86 * W},0 ${W},${0.5 * H} ${0.86 * W},${H} ${0.14 * W},${H} 0,${0.5 * H}`
        : shape === 'diamond'
          ? `${0.5 * W},0 ${W},${0.5 * H} ${0.5 * W},${H} 0,${0.5 * H}`
          : `${0.16 * W},0 ${W},0 ${0.84 * W},${H} 0,${H}`;
    shapeBg = (
      <svg
        width={W}
        height={H}
        style={{
          position: 'absolute',
          inset: 0,
          overflow: 'visible',
          zIndex: 0,
          pointerEvents: 'none',
          filter: selected ? 'drop-shadow(0 3px 8px rgba(0,0,0,.28))' : 'drop-shadow(0 2px 6px rgba(0,0,0,.18))',
        }}
      >
        {selected && <polygon points={pts} fill="none" stroke={hexA(th.accent, 0.55)} strokeWidth={bw2 + 6} strokeLinejoin="round" />}
        {selected && <polygon points={pts} fill="none" stroke={th.panel} strokeWidth={bw2 + 2} strokeLinejoin="round" />}
        <polygon points={pts} fill={polyFill} stroke={strokeCss} strokeWidth={bw2} strokeLinejoin="miter" />
      </svg>
    );
  }

  if (n.textColor) boxStyle.color = n.textColor;
  if (g.fpx) boxStyle.fontSize = g.fpx;
  if (g.fw) boxStyle.fontWeight = g.fw;

  const align = (n.align || 'center') as CSSProperties['textAlign'];
  const clipShape = shape === 'hexagon' || shape === 'diamond' || shape === 'parallelogram' || shape === 'ellipse' || shape === 'pill';
  const bodyWidth = clipShape ? Math.min(g.tw || g.w, g.w) : '100%';

  const textInner = editing ? (
    <NodeEditBox n={n} boxStyle={boxStyle} align={align} onCommit={(text) => controller.commitNodeText(id, text)} onCancel={controller.cancelNodeEdit} />
  ) : n.rich && n.rich.length ? (
    <span style={{ lineHeight: 1.35, flex: '1 1 auto', width: '100%', minWidth: 0, boxSizing: 'border-box', textAlign: align, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      {n.rich.map((r, ri) => (
        <span key={ri} style={{ fontWeight: r.b ? 800 : 'inherit', color: r.c || 'inherit' }}>
          {r.t}
        </span>
      ))}
    </span>
  ) : (
    <span style={{ lineHeight: 1.35, flex: '1 1 auto', width: '100%', minWidth: 0, boxSizing: 'border-box', textAlign: align, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{n.text}</span>
  );

  const hasKids = n.children.length > 0;
  const outSign = mode === 'down' ? 0 : g.x >= rootX ? 1 : -1;
  const toggleStyle: CSSProperties = {
    position: 'absolute',
    width: 20,
    height: 20,
    borderRadius: '50%',
    background: n.collapsed ? col : th.panel,
    color: n.collapsed ? '#fff' : col,
    border: `2px solid ${col}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 11,
    fontWeight: 700,
    lineHeight: 1,
    zIndex: 3,
    cursor: 'pointer',
  };
  if (mode === 'down') {
    toggleStyle.left = g.w / 2 - 10;
    toggleStyle.top = g.h - 4;
  } else if (outSign > 0) {
    toggleStyle.right = -11;
    toggleStyle.top = g.h / 2 - 10;
  } else {
    toggleStyle.left = -11;
    toggleStyle.top = g.h / 2 - 10;
  }

  const noteSign = mode === 'down' ? 1 : g.x >= rootX ? 1 : -1;
  const hasNote = !!n.note && n.note.trim().length > 0;
  const noteStyle: CSSProperties = {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: '50%',
    background: '#fff',
    color: th.accent,
    border: `1.5px solid ${th.accent}`,
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 9,
    lineHeight: 1,
    zIndex: 4,
    boxShadow: '0 1px 4px rgba(0,0,0,.18)',
    top: -8,
  };
  if (noteSign > 0) noteStyle.right = -7;
  else noteStyle.left = -7;

  return (
    <div
      style={boxStyle}
      data-node-id={id}
      data-depth={depth}
      onPointerDown={(e) => controller.beginNodeDrag(e, id)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        controller.startEditNode(id);
      }}
    >
      {shapeBg}
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center',
          width: bodyWidth,
          maxWidth: '100%',
          gap: n.emoji ? 7 : 0,
          pointerEvents: editing ? 'auto' : 'none',
        }}
      >
        {n.emoji && !editing && <span style={{ fontSize: depth === 0 ? 22 : 17, lineHeight: 1 }}>{n.emoji}</span>}
        {textInner}
      </div>
      {hasKids && (
        <div
          style={toggleStyle}
          onPointerDown={(e) => {
            e.stopPropagation();
            controller.toggleCollapse(id);
          }}
        >
          {n.collapsed ? String(descendants(nodes, id).length) : '−'}
        </div>
      )}
      {hasNote && (
        <div title={n.note} style={noteStyle} aria-hidden="true">
          <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke={th.accent} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
        </div>
      )}
      {/* resize handle only for a true single selection (port of `this.state.selectedId`,
          MindFlow.dc.html:1274 — not shown for a marquee multi-selection) */}
      {controller.selection?.kind === 'node' && controller.selection.id === id && !editing && (
        <div
          title="크기 조절 (더블클릭: 원래 크기)"
          onPointerDown={(e) => controller.beginNodeResize(e, id)}
          onDoubleClick={(e) => {
            e.stopPropagation();
            controller.resetNodeSize(id);
          }}
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
            zIndex: 80,
            boxSizing: 'border-box',
            boxShadow: '0 1px 4px rgba(0,0,0,.2)',
          }}
        />
      )}
    </div>
  );
}

interface NodeEditBoxProps {
  n: Node;
  boxStyle: CSSProperties;
  align: CSSProperties['textAlign'];
  onCommit: (text: string) => void;
  onCancel: () => void;
}

/** In-place node text editor — simplified `input`/`textarea` stand-in for the
 * original's rich `contentEditable` div (MindFlow.dc.html:1200-1224). Partial
 * bold/color runs within a single node's text selection (`applyPartial`) are
 * out of scope here (Editor-c); the whole node's plain text is editable. */
function NodeEditBox({ n, boxStyle, align, onCommit, onCancel }: NodeEditBoxProps) {
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
      defaultValue={n.text}
      rows={1}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          onCommit(e.currentTarget.value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
      onBlur={(e) => onCommit(e.currentTarget.value)}
      style={{
        border: 'none',
        background: 'transparent',
        color: 'inherit',
        font: 'inherit',
        fontWeight: boxStyle.fontWeight,
        textAlign: align,
        flex: '1 1 auto',
        width: '100%',
        minWidth: 0,
        maxWidth: '100%',
        boxSizing: 'border-box',
        outline: 'none',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        lineHeight: 1.35,
        resize: 'none',
        overflow: 'hidden',
        padding: 0,
        cursor: 'text',
      }}
    />
  );
}

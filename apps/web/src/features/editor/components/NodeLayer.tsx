import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import type { LayoutMode, Node, NodeMap } from '@mindflow/mindmap-core';
import { ROOT_ID } from '@mindflow/mindmap-core';
import { colorOf, descendants } from '../tree';
import { hexA } from '../theme';
import type { Theme } from '../theme';
import type { EditorController } from '../useEditorState';
import type { GeomMap } from '../types';
import { peersSelecting } from '../presenceSelection';
import { RemotePeerTag } from './RemotePeerTag';
import { runsToHtml } from '../richtextDom';

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
 * *selection* within a node, `NodeEditBox` + `TextToolbar.tsx`) is wired too;
 * the drag-ghost→drop-target reattach gesture remains out of scope here (that
 * one's Editor-c, unrelated to text editing).
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
  const resizing = controller.resizingNodeId === id;
  // While actively editing or resizing, this box grows but neighbours only get
  // magneted away on release — so lift it to the top layer meanwhile, so it
  // cleanly covers whatever it overlaps instead of the two texts mixing.
  const raised = editing || resizing;
  const attach = controller.attachTarget?.id === id;
  // presence: a remote peer's selection ring, distinct from `th.accent` above
  // (single-user/no-peers is a no-op — `peersSelecting` returns `[]`).
  const remoteSelectors = peersSelecting(controller.presence.peers, 'nodes', id);
  const remotePeer = remoteSelectors[0];

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
  // Above every other node box (default z ~auto) and the drag ghost (z 40) so the
  // active shape's opaque background hides any neighbour beneath it while it grows.
  if (raised) boxStyle.zIndex = 200;

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
        {remotePeer && <polygon points={pts} fill="none" stroke={hexA(remotePeer.user.color, 0.9)} strokeWidth={bw2 + 4} strokeLinejoin="round" />}
        <polygon points={pts} fill={polyFill} stroke={strokeCss} strokeWidth={bw2} strokeLinejoin="miter" />
      </svg>
    );
  }

  // presence: a remote peer's selection ring, layered onto whatever local
  // selected/attach boxShadow (if any) is already set above — polygon shapes
  // (hexagon/diamond/parallelogram) got their own ring drawn into `shapeBg`'s
  // SVG instead (no CSS box to shadow), so they're excluded here.
  if (remotePeer && shape !== 'hexagon' && shape !== 'diamond' && shape !== 'parallelogram') {
    const rc = hexA(remotePeer.user.color, 0.9);
    boxStyle.boxShadow = boxStyle.boxShadow && boxStyle.boxShadow !== 'none' ? `${boxStyle.boxShadow}, 0 0 0 3px ${rc}` : `0 0 0 3px ${rc}`;
  }

  if (n.textColor) boxStyle.color = n.textColor;
  if (g.fpx) boxStyle.fontSize = g.fpx;
  if (g.fw) boxStyle.fontWeight = g.fw;

  // 노드 이미지: 썸네일(위) + 내용(아래)의 세로 스택 — metrics.computeMetrics가
  // imgH+8만큼 박스를 미리 키워 두므로 여기선 배치만 바꾼다.
  const hasImg = !!(n.img && n.imgW && n.imgH);
  if (hasImg) boxStyle.flexDirection = 'column';

  const align = (n.align || 'center') as CSSProperties['textAlign'];
  const clipShape = shape === 'hexagon' || shape === 'diamond' || shape === 'parallelogram' || shape === 'ellipse' || shape === 'pill';
  const bodyWidth = clipShape ? Math.min(g.tw || g.w, g.w) : '100%';

  const textInner = editing ? (
    <NodeEditBox id={id} n={n} boxStyle={boxStyle} align={align} controller={controller} />
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
      {hasImg && (
        <img
          src={n.img}
          alt=""
          draggable={false}
          style={{ position: 'relative', zIndex: 1, width: n.imgW, height: n.imgH, objectFit: 'cover', borderRadius: 8, marginBottom: 8, pointerEvents: 'none', userSelect: 'none' }}
        />
      )}
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
      {/* Drop-target hint badge while another node is dragged over this one —
          tells the user how it will attach (자식/형제). Port of the
          `attach-badge` in `Component#renderCanvas` (MindFlow.dc.html:1246-1248). */}
      {attach && controller.attachTarget && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: '50%',
            top: -34,
            transform: 'translateX(-50%)',
            background: th.accent,
            color: th.accentInk,
            borderRadius: 7,
            padding: '4px 10px',
            fontSize: 11.5,
            fontWeight: 700,
            whiteSpace: 'nowrap',
            boxShadow: '0 2px 8px rgba(0,0,0,.25)',
            pointerEvents: 'none',
            zIndex: 100,
            fontFamily: 'Pretendard, sans-serif',
          }}
        >
          {controller.attachTarget.zone === 'child' ? '자식으로 연결' : '형제로 연결'}
        </div>
      )}
      {remotePeer && !editing && <RemotePeerTag color={remotePeer.user.color} name={remotePeer.user.name} style={{ left: 0, top: -22 }} />}
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
  id: string;
  n: Node;
  boxStyle: CSSProperties;
  align: CSSProperties['textAlign'];
  controller: EditorController;
}

/** In-place node text editor — a real `contentEditable` div, port of the original's rich
 * text box (MindFlow.dc.html:1200-1224): seeds its innerHTML from the node's existing
 * `rich` runs on mount (`runsToHtml`), focuses + selects all its content, and supports
 * partial bold/color styling on a text *selection* within it (`TextToolbar.tsx`,
 * `controller.applyPartial`) — a drag-selection inside this box opens that floating
 * toolbar (`checkSelectionToolbar` below). Enter (non-IME, non-shift) commits via
 * `commitNodeRichText`; Shift+Enter inserts a line break (the browser's own
 * `contentEditable` default, left un-intercepted); Escape cancels. */
function NodeEditBox({ id, n, boxStyle, align, controller }: NodeEditBoxProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = runsToHtml(n);
    controller.setRichEditorEl(el);
    // Seed the live box size from the initial content so an already-long node
    // opens at its correct size (and subsequent typing keeps it in sync).
    controller.updateNodeEditSize(id, el);
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    return () => controller.setRichEditorEl(null);
    // Mount-once (empty deps): this box only ever exists for the DURATION of one edit
    // session — `NodeBox` renders it exclusively while `editing` is true, so "on mount"
    // and "on entering edit mode" are the same moment here, unlike the original's single
    // persistent DOM node (reused across renders, hence its own `data-init`-keyed guard
    // to avoid re-seeding the innerHTML mid-edit, MindFlow.dc.html:1204-1210).
  }, []);

  /** Opens the floating partial-style toolbar near the current selection, if any —
   * called after every mouseup/keyup so a drag-selection (mouse) or a shift+arrow
   * selection (keyboard) both surface it. A collapsed selection (plain caret move) is a
   * no-op here; the toolbar was already closed by `TextToolbar`'s own outside-mousedown
   * listener when this mousedown/keydown started. */
  function checkSelectionToolbar(): void {
    const el = ref.current;
    if (!el) return;
    const ws = window.getSelection();
    if (!ws || ws.isCollapsed || !ws.rangeCount) return;
    if (!ws.anchorNode || !el.contains(ws.anchorNode)) return;
    // `Range#getBoundingClientRect` is unimplemented in jsdom (real browsers all support
    // it) — fall back to a zero rect rather than let a test environment crash here; the
    // toolbar still opens (just anchored at the viewport's own top-left in that case).
    const range = ws.getRangeAt(0);
    const rect = typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : { left: 0, top: 0, width: 0 };
    const vpEl = el.closest('.mf-ed-vp');
    const vpRect = vpEl && typeof vpEl.getBoundingClientRect === 'function' ? vpEl.getBoundingClientRect() : { left: 0, top: 0 };
    controller.openTextCtx(rect.left + rect.width / 2 - vpRect.left, rect.top - vpRect.top);
  }

  return (
    <div
      ref={ref}
      className="mf-edit mf-richedit"
      contentEditable
      suppressContentEditableWarning
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseUp={(e) => {
        e.stopPropagation();
        checkSelectionToolbar();
      }}
      onInput={() => controller.updateNodeEditSize(id, ref.current)}
      onKeyDown={(e) => {
        e.stopPropagation();
        const composing = e.nativeEvent.isComposing || e.keyCode === 229;
        if (e.key === 'Enter' && !composing && !e.shiftKey) {
          e.preventDefault();
          controller.commitNodeRichText(id, ref.current);
        } else if (e.key === 'Escape' && !composing) {
          e.preventDefault();
          controller.cancelNodeEdit();
        }
      }}
      onKeyUp={(e) => {
        e.stopPropagation();
        checkSelectionToolbar();
      }}
      onBlur={() => controller.commitNodeRichText(id, ref.current)}
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
        pointerEvents: 'auto',
        cursor: 'text',
        padding: 0,
      }}
    />
  );
}

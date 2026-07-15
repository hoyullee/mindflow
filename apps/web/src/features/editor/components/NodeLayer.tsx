import type { CSSProperties, ReactNode } from 'react';
import type { LayoutMode, Node, NodeMap } from '@mindflow/mindmap-core';
import { ROOT_ID } from '@mindflow/mindmap-core';
import { colorOf, descendants } from '../tree';
import { hexA } from '../theme';
import type { Theme } from '../theme';
import type { GeomMap } from '../types';

interface NodeLayerProps {
  nodes: NodeMap;
  geom: GeomMap;
  mode: LayoutMode;
  theme: Theme;
}

/**
 * Node boxes — port of the node half of `Component#renderCanvas`
 * (MindFlow.dc.html:1136-1265), minus selection/drag/edit/resize (Editor-b).
 * Shape/color/fill/stroke/textColor/bold/tsize/emoji/rich are all reproduced;
 * the collapse-count badge and note badge render as static visuals only (no
 * click handlers yet).
 */
export function NodeLayer({ nodes, geom, mode, theme }: NodeLayerProps) {
  const rootGeom = geom[ROOT_ID];
  return (
    <>
      {Object.keys(geom).map((id) => {
        const n = nodes[id];
        const g = geom[id];
        if (!n || !g) return null;
        return <NodeBox key={id} id={id} node={n} g={g} nodes={nodes} mode={mode} theme={theme} rootX={rootGeom?.x ?? 0} />;
      })}
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
}

function NodeBox({ id, node: n, g, nodes, mode, theme: th, rootX }: NodeBoxProps) {
  const depth = g.depth;
  const col = colorOf(id, nodes, th);

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
    cursor: 'default',
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
    boxStyle.border = `1.5px solid ${strokeCss}`;
    boxStyle.boxShadow = '0 2px 6px rgba(0,0,0,.04)';
  }

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
    boxStyle.boxShadow = 'none';
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
        style={{ position: 'absolute', inset: 0, overflow: 'visible', zIndex: 0, pointerEvents: 'none', filter: 'drop-shadow(0 2px 6px rgba(0,0,0,.18))' }}
      >
        <polygon points={pts} fill={polyFill} stroke={strokeCss} strokeWidth={bw2} strokeLinejoin="miter" />
      </svg>
    );
  }

  if (n.textColor) boxStyle.color = n.textColor;
  if (g.fpx) boxStyle.fontSize = g.fpx;
  if (g.fw) boxStyle.fontWeight = g.fw;

  const align = (n.align || 'center') as CSSProperties['textAlign'];
  const clipShape = shape === 'hexagon' || shape === 'diamond' || shape === 'parallelogram' || shape === 'ellipse' || shape === 'pill';

  const textInner = n.rich && n.rich.length ? (
    <span
      style={{ lineHeight: 1.35, flex: '1 1 auto', width: '100%', minWidth: 0, boxSizing: 'border-box', textAlign: align, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
    >
      {n.rich.map((r, ri) => (
        <span key={ri} style={{ fontWeight: r.b ? 800 : 'inherit', color: r.c || 'inherit' }}>
          {r.t}
        </span>
      ))}
    </span>
  ) : (
    <span style={{ lineHeight: 1.35, flex: '1 1 auto', width: '100%', minWidth: 0, boxSizing: 'border-box', textAlign: align, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      {n.text}
    </span>
  );

  const bodyWidth = clipShape ? Math.min(g.tw || g.w, g.w) : '100%';

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
    <div style={boxStyle} data-node-id={id} data-depth={depth}>
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
          pointerEvents: 'none',
        }}
      >
        {n.emoji && <span style={{ fontSize: depth === 0 ? 22 : 17, lineHeight: 1 }}>{n.emoji}</span>}
        {textInner}
      </div>
      {hasKids && (
        <div style={toggleStyle} aria-hidden="true">
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
    </div>
  );
}

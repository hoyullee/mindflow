import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import type { Line } from '@mindflow/mindmap-core';
import { cubicAt, portPoint } from '@mindflow/mindmap-core';
import type { PortSide } from '@mindflow/mindmap-core';
import { hexA } from '../theme';
import type { Theme } from '../theme';
import type { EditorController } from '../useEditorState';
import { peersSelecting } from '../presenceSelection';
import { RemotePeerTag } from './RemotePeerTag';

interface LineLayerProps {
  lines: Line[];
  theme: Theme;
  controller: EditorController;
}

const ARROW_SIZE = 13;
const PORT_SIDES: PortSide[] = ['top', 'bottom', 'left', 'right'];

/**
 * Free connector lines — port of `Component#renderLines`
 * (MindFlow.dc.html:1307-1386): click-to-select, drag-to-move, endpoint
 * handles, curvature handles, and double-click/F2 label editing are wired
 * (Editor-b). Endpoint anchor magnets (`a1`/`a2`, MindFlow.dc.html:1360-1362,
 * 1388-1402) are wired too: `controller.lineGeometry`/`resolveLine` resolve
 * each line through its anchor (if any) to the live node/float port, so an
 * anchored endpoint always renders where its target currently is; a small
 * filled dot marks an anchored endpoint, and while a `line-end` drag is near a
 * port, that box's 4 ports light up (the hovered one larger/accent-filled).
 */
export function LineLayer({ lines, theme: th, controller }: LineLayerProps) {
  const snapBox = controller.lineSnap ? controller.lineSnapBox : null;
  if (!lines.length && !snapBox) return null;
  const col = th.accent;
  const paths: ReactNode[] = [];
  const overlays: ReactNode[] = [];

  lines.forEach((l) => {
    const g = controller.lineGeometry(l);
    const { x: X1, y: Y1 } = g.P0;
    const { x: X2, y: Y2 } = g.P3;
    // port of `MSEL.lines.includes(l.id)` (MindFlow.dc.html:1315) — a marquee multi-selection
    // rings/halos every target, but the drag HANDLES below only ever show for a true single
    // selection (port of `this.state.selLine`, MindFlow.dc.html:1406 — never set while a
    // marquee multi-selection is active).
    const selected = controller.multiGroups.lines.includes(l.id);
    const showHandles = controller.selection?.kind === 'line' && controller.selection.id === l.id;
    const editing = controller.editingLineId === l.id;
    // presence: a remote peer's selection halo (see `NodeLayer`'s identical pattern).
    const remotePeer = peersSelecting(controller.presence.peers, 'lines', l.id)[0];
    const aStart = Math.atan2(Y1 - g.C1.y, X1 - g.C1.x);
    const aEnd = Math.atan2(Y2 - g.C2.y, X2 - g.C2.x);
    const head = (x: number, y: number, a: number): string => {
      const p1 = [x - ARROW_SIZE * Math.cos(a - 0.42), y - ARROW_SIZE * Math.sin(a - 0.42)];
      const p2 = [x - ARROW_SIZE * Math.cos(a + 0.42), y - ARROW_SIZE * Math.sin(a + 0.42)];
      return `${x},${y} ${p1[0]},${p1[1]} ${p2[0]},${p2[1]}`;
    };
    const trim = ARROW_SIZE * 0.72;
    const vX1 = l.startArrow ? X1 - Math.cos(aStart) * trim : X1;
    const vY1 = l.startArrow ? Y1 - Math.sin(aStart) * trim : Y1;
    const vX2 = l.endArrow ? X2 - Math.cos(aEnd) * trim : X2;
    const vY2 = l.endArrow ? Y2 - Math.sin(aEnd) * trim : Y2;
    const dv = `M ${vX1} ${vY1} C ${g.C1.x} ${g.C1.y} ${g.C2.x} ${g.C2.y} ${vX2} ${vY2}`;
    paths.push(
      <path
        key={`hit${l.id}`}
        d={dv}
        fill="none"
        stroke="transparent"
        strokeWidth={16}
        style={{ pointerEvents: 'stroke', cursor: 'grab' }}
        onPointerDown={(e) => controller.beginLineDrag(e, l.id)}
        onDoubleClick={(e) => {
          e.stopPropagation();
          controller.startEditLineLabel(l.id);
        }}
      />,
    );
    if (remotePeer) {
      paths.push(<path key={`remote${l.id}`} d={dv} fill="none" stroke={hexA(remotePeer.user.color, 0.55)} strokeWidth={7} strokeLinecap="round" style={{ pointerEvents: 'none' }} />);
    }
    paths.push(
      <path
        key={`v${l.id}`}
        d={dv}
        fill="none"
        stroke={l.color || col}
        strokeWidth={selected ? 3 : 2.2}
        strokeLinecap={l.startArrow || l.endArrow ? 'butt' : 'round'}
        strokeDasharray={l.dashed ? '7 7' : 'none'}
        style={{ pointerEvents: 'none' }}
      />,
    );
    if (l.startArrow) paths.push(<polygon key={`as${l.id}`} points={head(X1, Y1, aStart)} fill={l.color || col} style={{ pointerEvents: 'none' }} />);
    if (l.endArrow) paths.push(<polygon key={`ae${l.id}`} points={head(X2, Y2, aEnd)} fill={l.color || col} style={{ pointerEvents: 'none' }} />);
    // anchored endpoint dots (magnet indicator) — port of MindFlow.dc.html:1360-1362
    if (l.a1) paths.push(<circle key={`d1${l.id}`} cx={X1} cy={Y1} r={4} fill={l.color || col} style={{ pointerEvents: 'none' }} />);
    if (l.a2) paths.push(<circle key={`d2${l.id}`} cx={X2} cy={Y2} r={4} fill={l.color || col} style={{ pointerEvents: 'none' }} />);

    if (showHandles) {
      const handle = (x: number, y: number, key: string, onDown: (e: ReactPointerEvent) => void, title: string): ReactNode => (
        <circle key={key} cx={x} cy={y} r={6} fill={th.panel} stroke={th.accent} strokeWidth={2} style={{ pointerEvents: 'all', cursor: 'pointer' }} onPointerDown={onDown}>
          <title>{title}</title>
        </circle>
      );
      paths.push(handle(X1, Y1, `h1${l.id}`, (e) => controller.beginLineEndDrag(e, l.id, 1), '시작점'));
      paths.push(handle(X2, Y2, `h2${l.id}`, (e) => controller.beginLineEndDrag(e, l.id, 2), '끝점'));
      const c1p = cubicAt(g, 1 / 3);
      const c2p = cubicAt(g, 2 / 3);
      paths.push(
        <circle
          key={`hc1${l.id}`}
          cx={c1p.x}
          cy={c1p.y}
          r={5}
          fill={hexA(th.accent, 0.9)}
          stroke={th.panel}
          strokeWidth={1.5}
          style={{ pointerEvents: 'all', cursor: 'grab' }}
          onPointerDown={(e) => controller.beginLineCurveDrag(e, l.id, 1)}
        >
          <title>곡률 ①</title>
        </circle>,
      );
      paths.push(
        <circle
          key={`hc2${l.id}`}
          cx={c2p.x}
          cy={c2p.y}
          r={5}
          fill={hexA(th.accent, 0.9)}
          stroke={th.panel}
          strokeWidth={1.5}
          style={{ pointerEvents: 'all', cursor: 'grab' }}
          onPointerDown={(e) => controller.beginLineCurveDrag(e, l.id, 2)}
        >
          <title>곡률 ②</title>
        </circle>,
      );
    }

    const mp = cubicAt(g, 0.5);
    if (remotePeer && !editing) {
      overlays.push(
        <RemotePeerTag key={`remotetag${l.id}`} color={remotePeer.user.color} name={remotePeer.user.name} style={{ left: mp.x, top: mp.y - 20, transform: 'translate(-50%,-50%)' }} />,
      );
    }
    if (editing) {
      overlays.push(<LineLabelEdit key={`edit${l.id}`} l={l} x={mp.x} y={mp.y} theme={th} onCommit={(t) => controller.commitLineLabel(l.id, t)} onCancel={controller.cancelLineLabelEdit} />);
    } else if (l.label && l.label.trim()) {
      overlays.push(
        <div
          key={`lbl${l.id}`}
          onPointerDown={(e) => {
            e.stopPropagation();
            controller.selectLine(l.id);
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            controller.startEditLineLabel(l.id);
          }}
          style={{
            position: 'absolute',
            left: mp.x,
            top: mp.y,
            transform: 'translate(-50%,-50%)',
            background: th.panel,
            color: l.ltextColor || th.text,
            border: `1px solid ${hexA(l.color || col, 0.5)}`,
            borderRadius: 6,
            padding: '2px 7px',
            fontSize: l.lsize === 's' ? 10.5 : l.lsize === 'l' ? 14 : 12,
            fontWeight: l.lbold ? 800 : 600,
            fontFamily: 'Pretendard, sans-serif',
            whiteSpace: 'nowrap',
            boxShadow: '0 1px 4px rgba(0,0,0,.12)',
            zIndex: 7,
            cursor: 'pointer',
          }}
        >
          {l.label}
        </div>,
      );
    }
  });

  // port indicators on the box currently being snapped to (during a `line-end` drag) —
  // port of MindFlow.dc.html:1388-1402: 4 dots, the hovered side larger/accent-filled.
  const portDots: ReactNode[] = [];
  if (snapBox && controller.lineSnap) {
    const activeSide = controller.lineSnap.side;
    PORT_SIDES.forEach((side) => {
      const p = portPoint(snapBox, side);
      const on = activeSide === side;
      portDots.push(
        <div
          key={`port${side}`}
          style={{
            position: 'absolute',
            left: p.x - (on ? 7 : 5),
            top: p.y - (on ? 7 : 5),
            width: on ? 14 : 10,
            height: on ? 14 : 10,
            borderRadius: '50%',
            background: on ? th.accent : th.panel,
            border: `2px solid ${th.accent}`,
            boxShadow: '0 1px 4px rgba(0,0,0,.25)',
            zIndex: 14,
            boxSizing: 'border-box',
            pointerEvents: 'none',
          }}
        />,
      );
    });
  }

  return (
    <>
      <svg width={10} height={10} overflow="visible" style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none', zIndex: 6 }}>
        {paths}
      </svg>
      {overlays}
      {portDots}
    </>
  );
}

function LineLabelEdit({ l, x, y, theme, onCommit, onCancel }: { l: Line; x: number; y: number; theme: Theme; onCommit: (text: string) => void; onCancel: () => void }) {
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
      defaultValue={l.label || ''}
      maxLength={20}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault();
          if (e.key === 'Enter') onCommit(e.currentTarget.value);
          else onCancel();
        }
      }}
      onBlur={(e) => onCommit(e.currentTarget.value)}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        transform: 'translate(-50%,-50%)',
        background: theme.panel,
        color: theme.text,
        border: `1.5px solid ${theme.accent}`,
        borderRadius: 6,
        padding: '2px 7px',
        fontSize: 12,
        fontWeight: 600,
        fontFamily: 'Pretendard, sans-serif',
        outline: 'none',
        width: 90,
        boxSizing: 'border-box',
        zIndex: 8,
      }}
    />
  );
}

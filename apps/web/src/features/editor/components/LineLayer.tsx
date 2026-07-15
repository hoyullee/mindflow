import type { ReactNode } from 'react';
import type { Line } from '@mindflow/mindmap-core';
import { cubicAt, resolveLineGeometry } from '@mindflow/mindmap-core';
import { hexA } from '../theme';
import type { Theme } from '../theme';

interface LineLayerProps {
  lines: Line[];
  theme: Theme;
}

const ARROW_SIZE = 13;

/**
 * Free connector lines — port of `Component#renderLines`
 * (MindFlow.dc.html:1307-1386), minus selection/drag/curvature-handles/edit
 * (Editor-b). Curve geometry comes from `@mindflow/mindmap-core`'s
 * `resolveLineGeometry`/`cubicAt` (the anchored-endpoint magnet feature,
 * `a1`/`a2`, isn't part of the core `Line` model yet, so this renders plain
 * `x1,y1,x2,y2` endpoints).
 */
export function LineLayer({ lines, theme: th }: LineLayerProps) {
  if (!lines.length) return null;
  const col = th.accent;
  const paths: ReactNode[] = [];
  const labels: ReactNode[] = [];

  lines.forEach((l) => {
    const g = resolveLineGeometry(l);
    const { x: X1, y: Y1 } = g.P0;
    const { x: X2, y: Y2 } = g.P3;
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
        key={`v${l.id}`}
        d={dv}
        fill="none"
        stroke={l.color || col}
        strokeWidth={2.2}
        strokeLinecap={l.startArrow || l.endArrow ? 'butt' : 'round'}
        strokeDasharray={l.dashed ? '7 7' : 'none'}
      />,
    );
    if (l.startArrow) paths.push(<polygon key={`as${l.id}`} points={head(X1, Y1, aStart)} fill={l.color || col} />);
    if (l.endArrow) paths.push(<polygon key={`ae${l.id}`} points={head(X2, Y2, aEnd)} fill={l.color || col} />);

    if (l.label && l.label.trim()) {
      const mp = cubicAt(g, 0.5);
      labels.push(
        <div
          key={`lbl${l.id}`}
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
          }}
        >
          {l.label}
        </div>,
      );
    }
  });

  return (
    <>
      <svg width={10} height={10} overflow="visible" style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none', zIndex: 6 }}>
        {paths}
      </svg>
      {labels}
    </>
  );
}

import type { LayoutMode, NodeMap } from '@mindflow/mindmap-core';
import type { EdgeStyle } from '../tree';
import { colorOf } from '../tree';
import { buildEdgePath, edgeStrokeWidth } from '../edges';
import type { Theme } from '../theme';
import type { GeomMap } from '../types';

interface EdgeLayerProps {
  nodes: NodeMap;
  geom: GeomMap;
  mode: LayoutMode;
  edgeStyle: EdgeStyle;
  theme: Theme;
}

/**
 * Parent → child connector SVG — port of the tree-edge branch of
 * `Component#renderCanvas` (MindFlow.dc.html:1096-1133). Uses `buildEdgePath`
 * for the elbow/curve/straight path math (see `../edges.ts`).
 */
export function EdgeLayer({ nodes, geom, mode, edgeStyle, theme }: EdgeLayerProps) {
  const ids = Object.keys(geom);
  const edgeInX = (id: string): number => {
    const n = nodes[id];
    const g = geom[id];
    return n?.shape === 'parallelogram' && g ? g.w * 0.08 : 0;
  };

  const paths = ids.map((id) => {
    const n = nodes[id];
    const g = geom[id];
    if (!n || !g || !n.parent) return null;
    const p = geom[n.parent];
    if (!p) return null;
    const d = buildEdgePath(mode, edgeStyle, p, g, edgeInX(n.parent), edgeInX(id));
    const col = colorOf(id, nodes, theme);
    return (
      <path
        key={`e${id}`}
        d={d}
        stroke={col}
        strokeWidth={edgeStrokeWidth(g.depth)}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.85}
      />
    );
  });

  return (
    <svg width={10} height={10} overflow="visible" style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}>
      {paths}
    </svg>
  );
}

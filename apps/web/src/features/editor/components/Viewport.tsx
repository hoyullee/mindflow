import type { Doc } from '@mindflow/mindmap-core';
import type { EditorController } from '../useEditorState';
import { NodeLayer } from './NodeLayer';
import { EdgeLayer } from './EdgeLayer';
import { FloatLayer } from './FloatLayer';
import { LineLayer } from './LineLayer';
import { ZoneLayer } from './ZoneLayer';

interface ViewportProps {
  doc: Doc;
  controller: EditorController;
}

/**
 * The pan/zoom canvas — port of the `.mf-vp` viewport + `Component#renderCanvas`'s
 * outer transform group (MindFlow.dc.html:99-101, 1303-1304). Pan (background
 * drag) and zoom (wheel/pinch/buttons) live in `useEditorState`; this component
 * only applies the resulting CSS transform and stacks the render layers in the
 * original's z-order: zones → tree edges → nodes → free lines → floats.
 */
export function Viewport({ doc, controller }: ViewportProps) {
  const { theme, geom, layoutMode, edgeStyle, pan, zoom } = controller;

  return (
    <div style={{ position: 'relative', flex: '1 1 auto', overflow: 'hidden' }}>
      <div
        className="mf-ed-vp"
        ref={controller.setViewportEl}
        onPointerDown={controller.onBackgroundPointerDown}
        onContextMenu={(e) => e.preventDefault()}
        style={{
          position: 'absolute',
          inset: 0,
          cursor: 'default',
          backgroundColor: theme.canvasBg,
          backgroundImage: `radial-gradient(${theme.dot} 1.2px, transparent 1.2px)`,
          backgroundSize: '26px 26px',
          touchAction: 'none',
        }}
      >
        <div style={{ position: 'absolute', inset: 0 }}>
          <div style={{ position: 'absolute', left: 0, top: 0, transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})`, transformOrigin: '0 0' }}>
            <ZoneLayer zones={doc.zones} theme={theme} />
            <EdgeLayer nodes={doc.nodes} geom={geom} mode={layoutMode} edgeStyle={edgeStyle} theme={theme} />
            <NodeLayer nodes={doc.nodes} geom={geom} mode={layoutMode} theme={theme} />
            <LineLayer lines={doc.lines} theme={theme} />
            <FloatLayer floats={doc.floats} theme={theme} />
          </div>
        </div>
      </div>
    </div>
  );
}

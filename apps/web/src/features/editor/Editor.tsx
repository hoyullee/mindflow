import type { CSSProperties } from 'react';
import './editor.css';
import { useEditorState } from './useEditorState';
import { Toolbar } from './components/Toolbar';
import { DocChip } from './components/DocChip';
import { ZoomControls } from './components/ZoomControls';
import { Viewport } from './components/Viewport';
import { OutlineView } from './components/OutlineView';
import { PropertyPanel } from './components/PropertyPanel';
import { PresenceBar } from './components/PresenceBar';
import { useIsMobile } from '../../hooks/useMediaQuery';

/**
 * React port of `MindFlow.dc.html`'s editor — the mindmap canvas. This is the
 * M3-Editor-a slice: accurate document rendering, pan/zoom, and view/layout/
 * connector/theme switching, all driven by `@mindflow/mindmap-core`
 * (`layout`/`resolveLineGeometry`/`cubicAt`/`portPoint`/the `Doc` model).
 * Editor-b adds selection, text editing, structural add/delete, drag-move/
 * resize, the property panel, autosave + manual save, undo/redo, and export.
 * Editor-c adds marquee multi-select + its bulk property panel, the minimap,
 * an editable outline view, and drag-to-reparent (all still driven by
 * `useEditorState`).
 */
export function Editor() {
  const controller = useEditorState();
  const { doc, theme: th } = controller;
  const isMobile = useIsMobile();

  // Whether a property panel is currently shown (mirrors PropertyPanel's own
  // selection dispatch). On mobile that panel is a bottom sheet, so the
  // zoom/minimap cluster must lift above it — see ZoomControls' `panelOpen`.
  const mg = controller.multiGroups;
  const panelOpen =
    controller.selection?.kind === 'zone' ||
    (mg.nodes.length > 0 && !mg.lines.length && !mg.floats.length) ||
    (mg.lines.length > 0 && !mg.nodes.length && !mg.floats.length) ||
    (mg.floats.length > 0 && !mg.nodes.length && !mg.lines.length);

  // M6-mobile: use `100dvh` (dynamic viewport height) rather than `100vh` — on
  // mobile browsers `100vh` is the *large* viewport (ignores the address bar),
  // so a bottom-anchored element (the zoom/minimap cluster) ends up below the
  // fold, behind the browser chrome. `100dvh` tracks the visible viewport so
  // bottom-right controls stay on screen. Equals `100vh` on desktop.
  const rootStyle: CSSProperties = {
    height: '100dvh',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    background: th.appBg,
    color: th.text,
    fontFamily: 'Pretendard, system-ui, sans-serif',
    overflow: 'hidden',
    ...({
      '--app-bg': th.appBg,
      '--canvas-bg': th.canvasBg,
      '--panel': th.panel,
      '--panel2': th.panel2,
      '--border': th.border,
      '--text': th.text,
      '--subtext': th.subtext,
      '--accent': th.accent,
    } as CSSProperties),
  };

  return (
    <div style={rootStyle}>
      <Toolbar controller={controller} />

      <div style={{ position: 'relative', flex: '1 1 auto', overflow: 'hidden', display: 'flex' }}>
        {controller.view === 'map' ? (
          <>
            <Viewport doc={doc} controller={controller} />
            <DocChip controller={controller} />
            <PresenceBar controller={controller} />
            <PropertyPanel controller={controller} />
            <ZoomControls controller={controller} panelOpen={panelOpen} />
            {/* M6: this desktop mouse-gesture legend (우클릭/휠클릭/스크롤/핀치) doesn't
                apply to touch, and there's no room for it above a bottom-sheet
                property panel on narrow screens, so it's desktop-only. */}
            {!isMobile && (
              <div
                style={{
                  position: 'absolute',
                  left: 16,
                  bottom: 16,
                  fontSize: 11.5,
                  color: th.subtext,
                  background: th.panel,
                  border: `1px solid ${th.border}`,
                  borderRadius: 9,
                  padding: '7px 11px',
                  zIndex: 15,
                  lineHeight: 1.7,
                }}
              >
                <b style={{ color: th.text }}>좌드래그</b> 선택 · <b style={{ color: th.text }}>우클릭/휠클릭 드래그</b> 이동 ·{' '}
                <b style={{ color: th.text }}>더블클릭</b> 편집 · <b style={{ color: th.text }}>스크롤/핀치</b> 줌
              </div>
            )}
          </>
        ) : (
          <div className="mf-ed-outline" style={{ position: 'absolute', inset: 0, zIndex: 15, background: th.appBg, overflowY: 'auto' }}>
            <OutlineView controller={controller} />
          </div>
        )}
      </div>
    </div>
  );
}

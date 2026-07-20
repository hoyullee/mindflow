import { useEffect, type CSSProperties } from 'react';
import './editor.css';
import { useEditorState } from './useEditorState';
import { Toolbar } from './components/Toolbar';
import { DocChip } from './components/DocChip';
import { ZoomControls } from './components/ZoomControls';
import { Viewport } from './components/Viewport';
import { OutlineView } from './components/OutlineView';
import { PropertyPanel } from './components/PropertyPanel';
import { PresenceBar } from './components/PresenceBar';
import { MobileSelectBar } from './components/MobileSelectBar';
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
  const hasPanelSelection =
    controller.selection?.kind === 'zone' ||
    (mg.nodes.length > 0 && !mg.lines.length && !mg.floats.length) ||
    (mg.lines.length > 0 && !mg.nodes.length && !mg.floats.length) ||
    (mg.floats.length > 0 && !mg.nodes.length && !mg.lines.length);
  // On mobile the panel is a bottom sheet that only shows once explicitly opened
  // (`propsOpen`); on desktop it shows whenever there's a selection.
  const panelOpen = hasPanelSelection && (!isMobile || controller.propsOpen);

  // M6-mobile: the property sheet (55dvh) covers the lower screen, so re-center
  // the selected object into the area ABOVE it. This runs only when the sheet is
  // actually OPEN — selecting alone no longer pans the map (the reported "화면이
  //올라가는" jump). The minimap cluster is hidden meanwhile (ZoomControls).
  const sel = controller.selection;
  useEffect(() => {
    if (!isMobile || !sel || !controller.propsOpen) return;
    controller.centerObjectAboveSheet(sel.kind, sel.id, Math.round(window.innerHeight * 0.55));
  }, [isMobile, sel?.kind, sel?.id, controller.propsOpen]);

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
            {/* Mobile: a tap selects (no auto-sheet); this bar offers 편집/속성/삭제.
                Hidden once the sheet is open (it has its own close control below). */}
            {isMobile && controller.selection && !controller.propsOpen && <MobileSelectBar controller={controller} theme={th} />}
            {/* Close handle for the mobile property sheet — dismisses it WITHOUT
                deselecting, so the object stays selected (e.g. to then move it). */}
            {isMobile && controller.propsOpen && (
              <button
                type="button"
                aria-label="속성 닫기"
                onClick={controller.closeProps}
                style={{
                  position: 'fixed',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  bottom: 'calc(55dvh - 30px)',
                  width: 84,
                  height: 30,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 5,
                  border: `1px solid ${th.border}`,
                  borderBottom: 'none',
                  borderRadius: '12px 12px 0 0',
                  background: th.panel,
                  color: th.subtext,
                  fontFamily: 'inherit',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  zIndex: 26,
                }}
              >
                <span style={{ fontSize: 14 }}>⌄</span> 닫기
              </button>
            )}
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

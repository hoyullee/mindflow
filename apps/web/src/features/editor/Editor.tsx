import { useEffect, type CSSProperties } from 'react';
import './editor.css';
import { useEditorState } from './useEditorState';
import { Toolbar } from './components/Toolbar';
import { ShareModal } from './components/ShareModal';
import { DocChip } from './components/DocChip';
import { ZoomControls } from './components/ZoomControls';
import { Viewport } from './components/Viewport';
import { OutlineView } from './components/OutlineView';
import { PropertyPanel } from './components/PropertyPanel';
import { PresenceBar } from './components/PresenceBar';
import { SearchBar } from './components/SearchBar';
import { ShortcutHelp } from './components/ShortcutHelp';
import { MapUnavailable } from './components/MapUnavailable';
import { MobileSelectBar } from './components/MobileSelectBar';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { useUpdateGuard } from '../../pwa/updateGate';
import { useLinkModifier } from './richSpans';

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
  const { doc } = controller;
  // 시스템 크롬(루트 배경·제스처 범례·모바일 닫기 핸들 등)은 고정 uiTheme —
  // 문서 테마는 편집 영역(Viewport/아웃라인/미니맵 내용)만 칠한다.
  const th = controller.uiTheme;
  const isMobile = useIsMobile();

  // 새 배포 자동 적용 게이트. 에디터는 리로드로 잃는 게 많다(실행취소 기록·클립보드·
  // 선택·팬/줌) → 보고 있는 동안은 절대 자동 적용하지 않고(`defer`는 탭이 백그라운드일
  // 때만 적용), 텍스트를 입력하는 중이면 아예 막는다 — contentEditable의 미확정 글자는
  // 아직 문서에 없어서 저장으로도 지켜지지 않기 때문. 어느 경로든 적용 전에
  // `flushSave()`가 돌아 미저장 변경을 먼저 저장하고, 저장에 실패하면 리로드를 멈춘다.
  const isTypingInEditor = !!(
    controller.editingNodeId ||
    controller.editingFloatId ||
    controller.editingLineId ||
    controller.editingZoneId ||
    controller.editingTitle ||
    controller.outlineEditId
  );
  useUpdateGuard(isTypingInEditor ? 'block' : 'defer', controller.flushSave);

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
  // Ctrl/⌘ 를 누르고 있는 동안만 링크 위에 손가락 커서(`editor.css`).
  const linkMod = useLinkModifier();

  const rootStyle: CSSProperties = {
    height: '100dvh',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    background: th.appBg,
    color: th.text,
    fontFamily: "Pretendard, 'Pretendard-fallback', system-ui, sans-serif",
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

  // 열 수 없는 맵(권한이 없거나 본문이 다른 기기에만 있다) — 편집 도구를 아예 띄우지
  // 않는다. 예전엔 캔버스에만 안내를 얹어 툴바·메뉴·내보내기가 남아 있었다(제보:
  // "메뉴가 노출되어 우회가 되는 것 같다"). 볼 수 없는 문서에 도구를 보여줄 이유가 없다.
  if (controller.bodyMissing) return <MapUnavailable onRetry={controller.retryLoad} />;

  return (
    <div className={linkMod ? 'mf-ed-linkmod' : undefined} style={rootStyle}>
      <Toolbar controller={controller} />
      {/* 공유 모달 — 아웃라인 보기에서도 열 수 있어야 하므로 view 분기 밖에 둔다. */}
      <ShareModal controller={controller} />
      <ShortcutHelp controller={controller} />

      <div style={{ position: 'relative', flex: '1 1 auto', overflow: 'hidden', display: 'flex' }}>
        {controller.view === 'map' ? (
          <>
            <Viewport doc={doc} controller={controller} />
            <DocChip controller={controller} />
            <PresenceBar controller={controller} />
            <SearchBar controller={controller} />
            <PropertyPanel controller={controller} />
            {/* Mobile: a tap selects (no auto-sheet); this bar offers 편집/속성/삭제와
                전체 메뉴로 가는 메뉴(⋯). Hidden once the sheet is open (it has its own
                close control below).
                ⋯ 메뉴가 열려 있을 때는 바를 **그대로 둔다** — 메뉴가 바에 꼬리로
                붙어 "바에서 파생된" 것으로 읽혀야 하므로. 반면 길게 누르기로 연
                메뉴(anchor 없음)는 손가락 위치에 뜨므로 바를 숨겨 겹침을 피한다. */}
            {isMobile && controller.selection && !controller.propsOpen && (!controller.ctxMenu || !!controller.ctxMenu.anchor) && (
              <MobileSelectBar controller={controller} theme={th} />
            )}
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
          <div className="mf-ed-outline" style={{ position: 'absolute', inset: 0, zIndex: 15, background: controller.theme.appBg, overflowY: 'auto' }}>
            <OutlineView controller={controller} />
          </div>
        )}
      </div>
    </div>
  );
}

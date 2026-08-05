import { useEffect, type CSSProperties } from 'react';
import './editor.css';
import { useEditorState } from './useEditorState';
import type { SelectionKind } from './types';
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
import { VersionHistory } from './components/VersionHistory';
import { MapUnavailable } from './components/MapUnavailable';
import { FeedbackModal } from '../../components/FeedbackModal';
import { MobileSelectBar } from './components/MobileSelectBar';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { useKeyboardInset } from '../../hooks/useKeyboardInset';
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

  // 소프트 키보드 회피: 모바일에서 도형·메모의 텍스트를 편집하는 동안 키보드가
  // 올라오면, 그만큼을 "아래에서 가려진 높이"로 보고 편집 대상을 그 위로 옮긴다.
  // 브라우저는 키보드가 떠도 레이아웃 뷰포트(=`100dvh`)를 줄이지 않으므로 CSS로는
  // 알 수 없고(`useKeyboardInset`), 마침 속성 시트를 피할 때 쓰던 팬 계산이 그대로
  // 맞는다(가려진 높이만 다를 뿐) — `centerObjectAboveSheet`를 재사용한다.
  const kbInset = useKeyboardInset();
  const editKind: SelectionKind | null = controller.editingNodeId ? 'node' : controller.editingFloatId ? 'float' : null;
  const editId = controller.editingNodeId ?? controller.editingFloatId;
  useEffect(() => {
    if (!isMobile || !editKind || !editId || !kbInset) return;
    // iOS Safari는 포커스 시 레이아웃 뷰포트째 밀어 올린다 — 우리 좌표계(고정 배치 +
    // 캔버스 팬)가 통째로 어긋나므로 되돌리고, 우리가 직접 대상을 올린다.
    if (typeof window.scrollTo === 'function' && window.scrollY) window.scrollTo(0, 0);
    controller.centerObjectAboveSheet(editKind, editId, kbInset);
    controller.refreshTextCtxAnchor(); // 서식 툴바도 옮겨 간 박스를 따라간다
  }, [isMobile, editKind, editId, kbInset]);

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
    <div
      className={linkMod ? 'mf-ed-linkmod' : undefined}
      style={rootStyle}
      // 에디터 안에서는 브라우저 네이티브 드래그를 통째로 끈다 — 남아 있던 텍스트
      // 선택·링크·이미지 등 무엇이 근원이든, 그 위에서 드래그가 시작되면 화면
      // 일부를 반투명 스냅샷으로 끌고 다니는 고스트가 뜬다(제보: "브라우저 전체가
      // 이미지화되어 이동"). 파일 드롭(이미지 첨부)은 drop/dragover 쪽이라 무관하고,
      // 객체 이동은 전부 pointer 이벤트로 우리가 직접 그린다.
      onDragStartCapture={(e) => e.preventDefault()}
    >
      <Toolbar controller={controller} />
      {/* 공유 모달 — 아웃라인 보기에서도 열 수 있어야 하므로 view 분기 밖에 둔다. */}
      <ShareModal controller={controller} />
      <ShortcutHelp controller={controller} />
      <VersionHistory controller={controller} />
      {/* 피드백(사용자 의견 수집) — 보기/☰ 메뉴에서 연다. 에디터 테마를 따른다. */}
      <FeedbackModal open={controller.feedbackOpen} onClose={() => controller.setFeedbackOpen(false)} page="editor" theme={th} />

      <div style={{ position: 'relative', flex: '1 1 auto', overflow: 'hidden', display: 'flex' }}>
        {controller.view === 'map' ? (
          <>
            <Viewport doc={doc} controller={controller} />
            <DocChip controller={controller} />
            <PresenceBar controller={controller} />
            <SearchBar controller={controller} />
            {/* 보기 전용(#22): 속성 패널의 모든 조작이 문서 변이라 패널째 감춘다. */}
            {!controller.readOnly && <PropertyPanel controller={controller} />}
            {/* Mobile: a tap selects (no auto-sheet); this bar offers 편집/속성/삭제와
                전체 메뉴로 가는 메뉴(⋯). Hidden once the sheet is open (it has its own
                close control below).
                ⋯ 메뉴가 열려 있을 때는 바를 **그대로 둔다** — 메뉴가 바에 꼬리로
                붙어 "바에서 파생된" 것으로 읽혀야 하므로. 반면 길게 누르기로 연
                메뉴(anchor 없음)는 손가락 위치에 뜨므로 바를 숨겨 겹침을 피한다.
                텍스트 편집 중에도 숨긴다(요청) — 그때는 서식 툴바가 상시 떠 있어
                두 개의 떠 있는 도구 모음이 좁은 화면에서 겹치고, 이 바의 동작
                (하위/형제/삭제)은 편집을 끝낸 뒤에야 뜻이 통한다. */}
            {isMobile && !controller.readOnly && controller.selection && !controller.propsOpen && !controller.editingNodeId && !controller.editingFloatId && (!controller.ctxMenu || !!controller.ctxMenu.anchor) && (
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
            {/* 좌측 하단 피드백 버튼(사용자 선정 위치) — 예전 마우스 제스처 범례
                자리다. 범례는 단축키 도움말(?) 모달과 내용이 겹치는 정적 안내라
                이 자리를 피드백 진입점에 내줬다(GNB 아이콘은 어색하다는 제보로
                제거). 모바일은 이 구석이 없고 ☰ 메뉴 항목이 진입점. */}
            {!isMobile && (
              <button
                type="button"
                onClick={() => controller.setFeedbackOpen(true)}
                aria-label="피드백 보내기"
                title="피드백 보내기"
                className="mf-ed-btn"
                style={{
                  position: 'absolute',
                  left: 16,
                  bottom: 16,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                  fontSize: 12,
                  fontWeight: 600,
                  fontFamily: 'inherit',
                  color: th.subtext,
                  background: th.panel,
                  border: `1px solid ${th.border}`,
                  borderRadius: 999,
                  padding: '8px 13px',
                  zIndex: 15,
                  cursor: 'pointer',
                  boxShadow: '0 2px 8px rgba(0,0,0,.06)',
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                피드백 보내기
              </button>
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

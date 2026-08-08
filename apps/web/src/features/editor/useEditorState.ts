import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { Box, Doc, Float, Line, LineAnchor, LayoutMode, ListOp, Node, NodeMap, SizeOf, SnapCandidate, TextEdit, Zone } from '@mindflow/mindmap-core';
import { HistoryStack, ROOT_ID, collectImageRefs, collectInlineImages, isImageRef, replaceImageValues, applyListOp as applyListOpToText, applyAutoLinks, applyMarkdownShortcuts, applyPartialStyle, charsToRuns, cubicAt, isStyledRuns, findLineSnap, layout, resolveLineEndpoints, resolveLineGeometry, runsToChars, serializeDoc, shiftOffset, toMarkdown } from '@mindflow/mindmap-core';
import { domToRuns, linearize, liveEditValue } from './richtextDom';
import { recordVersion, versionDoc } from './versionHistory';
import { nodeTextAlign, renderListEdit } from './listLines';
import type { DocComment, ShareRole, ShareStore } from '../../adapters/ports';
import type { CollabStatus } from '../../collab/ports';
import { useBackend, useCommentStore, useDocStore, useShareStore, useSpaceStore } from '../../adapters/BackendContext';
import { useAuthUser } from '../../adapters/useAuthUser';
import { useProfileName } from '../../adapters/useProfileName';
import { useYjsDocSync } from '../../collab/useYjsDocSync';
import { usePresence, type UsePresenceResult } from '../../collab/usePresence';
import { EMPTY_PRESENCE_SELECTION, type PresenceSelection } from '../../collab/presence';
import { CanvasTextMeasurer, computeMetrics, measureFloatHeight } from './metrics';
import { attachImageFile, dataUrlToBlob, defaultFloatSize, firstImageFile, fitWithin } from './imageAttach';
import { inlineImagesForExport } from './imageExport';
import { useImageUrls, type ImageUrlMap } from './useImageUrls';
import { hasPendingDoc, hasStoredDoc, loadOrSeedDoc, markDocPending, saveDoc } from './storage';
import { newDocId, pushRecentEntry, rebindMovedDoc } from '../home/storage';
import { buildTemplateDoc } from '../../templates/mapTemplates';
import type { SpaceData } from '../home/types';
import { isPanButton } from './pointerButtons';
import { buildVisible, descendants, outlineRows } from './tree';
import type { EdgeStyle } from './tree';
import { nearestInDirection } from './navigation';
import { UI_THEME, themeKeyOf, themeOf } from './theme';
import type { Theme, ThemeKey } from './theme';
import { downloadFile } from './download';
import { exportPng } from './png';
import * as mutations from './mutations';
import { createIdFactory } from './mutations';
import { clipboardCount, collectClipboard, pasteClipboard, type ClipboardPayload, type PasteTarget } from './clipboard';
import type {
  AttachTarget,
  ContextMenuState,
  ContextSubState,
  GeomMap,
  HitResult,
  LineHandle,
  MarqueeRect,
  MultiSelection,
  NodeGeom,
  PanState,
  SaveState,
  Selection,
  SelectionKind,
  TextCtxState,
  ViewMode,
} from './types';

// State/interaction controller for the mindmap editor route — the React
// counterpart of `Component`'s state + drag/select/edit/save/undo methods
// (MindFlow.dc.html). Editor-a covered load/layout/pan/zoom/view/theme;
// Editor-b added selection, text editing, structural add/delete, drag-move/
// resize, the property-panel setters, autosave + manual save, undo/redo (via
// `@mindflow/mindmap-core`'s `HistoryStack`), and export. Editor-c added
// marquee multi-select + its bulk property panel, the minimap, editable
// outline view, and drag-to-reparent. A later revision added the right-click
// context menu (`ctxMenu`/`ctxSub`, MindFlow.dc.html:2775-2837, 3087-3170).
//
// This revision adds partial rich-text run styling: `NodeEditBox`
// (`components/NodeLayer.tsx`) is now a real `contentEditable` box (port of
// MindFlow.dc.html:1200-1224), its commit path is `commitNodeRichText`
// (below, port of `commitRichEdit`, MindFlow.dc.html:2629-2643, backed by
// `mutations.commitNodeRichText`), and the floating "B / color / 지우기"
// toolbar (`textCtx` below + `components/TextToolbar.tsx`) applies a style to
// the current DOM selection via `applyPartial` (below, port of
// `Component#applyPartial`'s char-model, MindFlow.dc.html:2701-2725 —
// `@mindflow/mindmap-core`'s `applyPartialStyle` does the actual char-run
// math; `applyPartial` here is just the DOM/Selection plumbing around it via
// `richtextDom.ts`'s `linearize`/`domToRuns`/`runsToHtml`/`setLinearSelection`).
// Unlike the original (which opens the toolbar from a right-click INSIDE an
// active selection), this port opens it directly off a drag-selection in the
// editor — see `TextToolbar.tsx`'s doc comment for the rationale.
//
// Line endpoint anchor magnets (`a1`/`a2`, MindFlow.dc.html:1728-1734,
// 2377-2454) are wired here: dragging a line endpoint near a node/float port
// snaps + anchors it (`findLineSnap`/`lineSnap` below); anchored endpoints are
// resolved every render via `resolveLine`/`lineGeometryOf` (`boxOfAnchor` looks
// up the live node/float box), so they automatically follow their target when
// it moves. `boxOfAnchor`/`resolveLine`/`snapCandidates` are shared by every
// line-geometry consumer (hit-testing, marquee, curve-drag, `LineLayer`,
// PNG export) so anchored lines behave consistently everywhere.

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2.4;
const FIT_PADDING = 90;
// Touch long-press → context menu (the touch equivalent of a right-click): a
// stationary press held this long opens the menu; moving more than the
// tolerance first cancels it (it's a pan).
/**
 * 공유 맵에서 실시간이 이만큼 끊겨 있으면 **편집을 멈춘다**.
 *
 * 짧은 끊김에는 멈추지 않는다: 자동 재접속이 5초 뒤 첫 시도를 하고, 그 사이의 편집은
 * 합류 시 CRDT diff로 서로에게 병합된다(연산 이력을 공유하는 같은 세션이므로). 반면
 * 오래 끊긴 채 양쪽이 편집하면 두 문서가 갈라지는데, 서버에는 CRDT 로그가 아니라
 * **최종 본문**만 저장되므로 나중에 저장한 쪽이 상대의 작업을 덮는다. 그 지점부터는
 * 계속 편집하게 두는 것이 오히려 손실이다.
 */
const COLLAB_PAUSE_AFTER_MS = 30_000;

const LONG_PRESS_MS = 500; // iOS·안드로이드의 길게 누르기와 같은 길이
/**
 * 길게 누르는 동안 허용하는 손가락 흔들림(px, **직선 거리**).
 *
 * 예전엔 |dx|+|dy| ≤ 10이었다 — 맨해튼 합이라 대각선 흔들림에 1.4배로 엄했고
 * (7,7)이면 실제로는 9.9px인데 취소됐다. 걷거나 차 안에서 누르면 그 정도는
 * 예사라 "길게 눌러도 메뉴가 안 뜬다"가 된다. 직선 거리로 바꾸고, 플랫폼의
 * 터치 슬롭(안드로이드 ~8dp)에 맞춰 14px로 넓혔다.
 */
const LONG_PRESS_MOVE_TOL = 14;

interface ViewportState {
  pan: PanState;
  zoom: number;
  vw: number;
  vh: number;
}

const INITIAL_VIEWPORT: ViewportState = { pan: { x: 0, y: 0 }, zoom: 1, vw: 1200, vh: 700 };

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function zoomAtState(state: ViewportState, nz: number, sx: number, sy: number): ViewportState {
  const z = state.zoom;
  const p = state.pan;
  const clamped = clamp(nz, MIN_ZOOM, MAX_ZOOM);
  const cx = (sx - p.x) / z;
  const cy = (sy - p.y) / z;
  return { ...state, zoom: clamped, pan: { x: sx - cx * clamped, y: sy - cy * clamped } };
}

/** The subset of `Doc` the undo/redo stack snapshots — port of `Component#takeSnap`
 * (MindFlow.dc.html:548-549): `themeKey` is intentionally excluded (the original's own asymmetry). */
interface Snapshot {
  nodes: NodeMap;
  floats: Float[];
  lines: Line[];
  zones: Zone[];
  layoutMode: LayoutMode;
  edgeStyle: EdgeStyle;
}

type ObjDrag =
  | { kind: 'root'; pointerId: number; startClientX: number; startClientY: number; startAnchor: PanState }
  /** Unified free/attached node drag — port of `Component#onMove`'s `d.type === 'node'` branch
   * (MindFlow.dc.html:1748-1755): ANY non-root node drags as a ghost + live drop-target
   * highlight; only on drop does the kind (free vs. attached) decide reattach/detach/move. */
  | {
      kind: 'node-move';
      id: string;
      pointerId: number;
      startClientX: number;
      startClientY: number;
      startGeomX: number;
      startGeomY: number;
      wasFree: boolean;
      excludeIds: Set<string>;
    }
  | { kind: 'node-resize'; id: string; pointerId: number; startClientX: number; startClientY: number; ow: number; oh: number;
      /** 드래그 시작 시점의 좌상단(문서 좌표) — 자유 도형은 이 점을 고정한다(아래 참고). */
      tlX: number; tlY: number; anchorable: boolean }
  | { kind: 'float'; id: string; pointerId: number; startClientX: number; startClientY: number; ox: number; oy: number }
  | { kind: 'float-resize'; id: string; pointerId: number; startClientX: number; startClientY: number; ow: number; oh: number }
  | { kind: 'zone'; id: string; pointerId: number; startClientX: number; startClientY: number; ox: number; oy: number }
  | { kind: 'zone-resize'; id: string; pointerId: number; startClientX: number; startClientY: number; ow: number; oh: number }
  | { kind: 'line-move'; id: string; pointerId: number; startClientX: number; startClientY: number; o: { x1: number; y1: number; x2: number; y2: number } }
  | { kind: 'line-end'; id: string; which: LineHandle; pointerId: number; startClientX: number; startClientY: number; ox: number; oy: number }
  | { kind: 'line-curve'; id: string; which: LineHandle; pointerId: number; startClientX: number; startClientY: number; oc: number; nx: number; ny: number }
  /** Multi-select group drag — port of `Component#startGroupDrag`/`onMove`'s `'group'` branch
   * (MindFlow.dc.html:1582-1594, 1706-1713). Only free-standing node roots are captured (see
   * `mutations.translateNodesBy`'s doc comment for why attached tree nodes can't be). */
  | {
      kind: 'group';
      pointerId: number;
      startClientX: number;
      startClientY: number;
      nodesOrig: Record<string, { x: number; y: number }>;
      floatsOrig: Record<string, { x: number; y: number }>;
      linesOrig: Record<string, { x1: number; y1: number; x2: number; y2: number }>;
    };

type BgDrag =
  | { kind: 'pan'; pointerId: number; sx: number; sy: number; startPan: PanState; moved: boolean; touch?: boolean }
  | { kind: 'marquee'; pointerId: number; startClientX: number; startClientY: number; x0: number; y0: number; moved: boolean };

function totalSelected(m: MultiSelection): number {
  return m.nodes.length + m.lines.length + m.floats.length;
}

export interface EditorController {
  doc: Doc;
  /** True until the initial backend load resolves when the mount seed was only a
   * placeholder — the canvas holds meanwhile so the empty default never flashes. */
  hydrating: boolean;
  /** 첫 센터링 + 폰트 측정 + 하이드레이션이 모두 끝나 캔버스를 보여도 되는
   * 상태. false인 동안 Viewport가 커튼(배경+스피너)으로 캔버스를 가려
   * 새로고침 시 좌상단 플래시→중앙 점프 깜빡임을 막는다. */
  canvasReady: boolean;
  /** The initial doc load FAILED (network/RLS). The canvas shows an error+retry
   * instead of the empty seed, and saving is blocked so nothing overwrites the
   * (unknown-state) backend doc. */
  loadError: boolean;
  /** 본문이 이 기기에도, 백엔드에도 없다(그러나 새로 만든 맵도 아니다) — 본문을 가진
   * 다른 기기가 아직 올리지 않은 맵이다. 빈 문서로 덮어쓰지 않도록 편집·저장을 멈추고
   * 안내 화면을 띄운다. */
  bodyMissing: boolean;
  /** Retry a failed initial load (reloads the editor route). */
  retryLoad: () => void;
  /** 문서 테마(`doc.themeKey`) — 편집 영역(캔버스·노드/커넥터·미니맵 내용·
   * 내보내기·색 스와치 값)에만 쓴다. 시스템 크롬은 `uiTheme`. */
  theme: Theme;
  /** 시스템 크롬(GNB·메뉴·독칩·속성패널 틀 등)의 고정 테마 — 문서 테마를
   * 바꿔도 변하지 않는다. */
  uiTheme: Theme;
  themeKey: ThemeKey;
  layoutMode: LayoutMode;
  edgeStyle: EdgeStyle;
  view: ViewMode;
  pan: PanState;
  zoom: number;
  zoomPct: number;
  vw: number;
  vh: number;
  geom: GeomMap;
  /** Measured (grown-to-fit) memo heights by float id — the real rendered box
   * height, since memos grow with their text past the stored `f.h`. */
  floatHeights: Record<string, number>;
  mapId: string | null;
  docTitle: string;

  setViewportEl: (el: HTMLDivElement | null) => void;
  setLayoutMode: (mode: LayoutMode) => void;
  setEdgeStyle: (s: EdgeStyle) => void;
  setThemeKey: (k: ThemeKey) => void;
  setView: (v: ViewMode) => void;

  onBackgroundPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  fitView: () => void;
  goHome: () => void;

  // ---- presence (M5.5: multi-user awareness — cursor/selection/identity) ----
  /** This tab's own identity + every OTHER connected peer's live cursor/
   * selection (`peers` is `[]` when solo — single-user, no-op rendering). */
  presence: UsePresenceResult;
  /** Reports the pointer's CLIENT (screen) position for presence — converts to
   * canvas coordinates internally (same space as `geom`) and throttles the
   * broadcast; call from the viewport's `onPointerMove`. */
  reportPointerPosition: (clientX: number, clientY: number) => void;
  /** Call from the viewport's `onPointerLeave`/`onPointerCancel` — reports "no
   * cursor" so peers don't see a stale last-known position after this tab's
   * pointer leaves the canvas. */
  clearPointerPosition: () => void;

  // ---- selection ----
  selection: Selection | null;
  selectNode: (id: string) => void;
  selectFloat: (id: string) => void;
  selectLine: (id: string) => void;
  selectZone: (id: string) => void;
  clearSelection: () => void;

  // ---- mobile property sheet ----
  // On mobile the property panel is a 55dvh bottom sheet. Selecting an object no
  // longer auto-opens it (that covered the canvas and panned the map on every
  // tap); the user opens it explicitly. `propsOpen` gates the sheet on mobile
  // and resets whenever the selection changes. (Desktop ignores this — the side
  // panel still shows on selection.)
  propsOpen: boolean;
  openProps: () => void;
  closeProps: () => void;

  // ---- multi-selection (marquee) — port of `Component#state.msel` ----
  multiSelection: MultiSelection | null;
  /** Always non-empty-safe: falls back to the single `selection` when there's no active
   * marquee group — the React-hook counterpart of `Component#msel()` (MindFlow.dc.html:1548). */
  multiGroups: MultiSelection;
  marquee: MarqueeRect | null;

  // ---- minimap ----
  showMinimap: boolean;
  toggleMinimap: () => void;
  panToCanvasPoint: (x: number, y: number) => void;
  /** 맵 안 텍스트 검색 바 열림 상태 — 툴바 버튼과 Ctrl/⌘+F가 함께 조작한다. */
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  /** 단축키 도움말 열림 상태 — `?` 키(비편집)와 보기/☰ 메뉴가 조작한다. */
  helpOpen: boolean;
  setHelpOpen: (open: boolean) => void;
  /** 피드백 보내기 모달(보기/☰ 메뉴). */
  feedbackOpen: boolean;
  setFeedbackOpen: (open: boolean) => void;

  // ---- 댓글(주제에 붙는 논의) ----
  /** 댓글 패널이 열려 있는가. */
  commentsOpen: boolean;
  /** 지금 댓글을 보고 있는 주제. 주제를 고르면 따라간다(패널이 대상 없이 뜨지 않게). */
  commentsNodeId: string;
  /** 패널을 연다(대상 주제를 함께 지정할 수 있다 — 노드 메뉴·배지 클릭). */
  openComments: (nodeId?: string) => void;
  closeComments: () => void;
  /** 이 문서의 댓글 전부(작성 순). 배지·패널이 함께 쓴다. */
  comments: DocComment[];
  /** 주제 id → 댓글 수 — 노드 배지가 읽는다. */
  commentCounts: Record<string, number>;
  /** 목록을 아직 불러오는 중인가(패널 스켈레톤용). */
  commentsLoading: boolean;
  addComment: (nodeId: string, body: string) => Promise<{ error?: string }>;
  removeComment: (commentId: string) => Promise<{ error?: string }>;
  /** 이 사람이 이 문서에 댓글을 쓸 수 있는가 — 소유자와 **초대받은 사람**만.
   * 링크 공유(0017)로 열었으면 서버가 댓글을 아예 내주지 않으므로 진입점도 감춘다
   * ("열리는 척하다 빈 목록"이 되지 않게). */
  canComment: boolean;
  /** 버전 기록 모달 열림 상태 — 편집/☰ 메뉴가 조작한다. */
  historyOpen: boolean;
  setHistoryOpen: (open: boolean) => void;
  /** 이 문서의 로컬 스냅샷 키(= 저장 대상 id) — 모달이 목록/본문 조회에 쓴다. */
  historyDocId: string;
  /** 스냅샷을 현재 문서로 복원 — undo 가능한 커밋이며, 복원 **직전 상태**도
   * 강제 스냅샷으로 먼저 남긴다(돌아올 길 보장). 실패(손상)면 false. */
  restoreVersion: (at: number) => boolean;
  /** 검색 일치 대상(전부) — NodeLayer/FloatLayer가 하이라이트 링을 그린다.
   * 검색 바가 계산해 내려 주고, 닫히면 `null`. */
  searchMarks: { nodes: Set<string>; floats: Set<string> } | null;
  setSearchMarks: (marks: { nodes: Set<string>; floats: Set<string> } | null) => void;
  centerObjectAboveSheet: (kind: SelectionKind, id: string, reserveBottomPx: number, reserveRightPx?: number) => void;

  // ---- drag-to-reparent drop target ----
  attachTarget: AttachTarget | null;

  // ---- outline view editing ----
  outlineEditId: string | null;
  outlineStartEdit: (id: string) => void;
  outlineCommitEdit: (id: string, text: string) => void;
  outlineAddChild: (id: string) => void;
  outlineAddSibling: (id: string) => void;
  outlineIndent: (id: string) => void;
  outlineOutdent: (id: string) => void;

  // ---- text editing ----
  editingNodeId: string | null;
  /** The node being resized (drag on its handle) — lifted to the top layer, like
   * `editingNodeId`, so it covers neighbours it grows over mid-drag. */
  resizingNodeId: string | null;
  editingFloatId: string | null;
  editingLineId: string | null;
  editingZoneId: string | null;
  editingTitle: boolean;
  startEditNode: (id: string) => void;
  commitNodeText: (id: string, text: string) => void;
  cancelNodeEdit: () => void;
  /** The node text box's own commit — port of `Component#commitRichEdit`
   * (MindFlow.dc.html:2629-2643): reads the live `contentEditable` DOM (`el`,
   * `NodeEditBox`'s own ref) via `domToRuns`, and writes BOTH `text` and the
   * partial-style `rich` runs in one step (unlike `commitNodeText` above,
   * which is plain-text-only and used by every OTHER text editor). */
  commitNodeRichText: (id: string, el: HTMLElement | null) => void;
  /** Re-measure the node being edited from its live `contentEditable` content so
   * the box grows/shrinks with the text as it's typed (WYSIWYG). Called on every
   * input in `NodeEditBox`. */
  updateNodeEditSize: (id: string, el: HTMLElement | null) => void;
  /** The floating partial-style toolbar's open state — port of
   * `Component#state.textCtx` (MindFlow.dc.html:2782, 3088-3099). `null` when
   * closed; only ever rendered while `editingNodeId` is also set. */
  textCtx: TextCtxState | null;
  /** Opens the toolbar at a screen (viewport-relative) point — called by
   * `NodeEditBox` when a drag-selection inside it becomes non-collapsed. */
  openTextCtx: (sx: number, sy: number) => void;
  /** 편집 대상이 화면에서 옮겨 간 뒤 서식 툴바를 그 위로 다시 붙인다(키보드 회피 팬). */
  refreshTextCtxAnchor: () => void;
  /** Port of the outside-click branch of the original's `_winDown` handler
   * for `textCtx` (MindFlow.dc.html:820) — also used on Escape/commit/cancel. */
  closeTextCtx: () => void;
  /** Registers (or clears, on unmount) the currently-focused rich-text
   * `contentEditable` element — this port's stand-in for the original's
   * `this._richEl` instance field (MindFlow.dc.html:1209), since a hooks-based
   * controller has no instance of its own to hang a ref off. `applyPartial`
   * reads from this. */
  setRichEditorEl: (el: HTMLDivElement | null) => void;
  /** 편집 박스의 현재 캐럿을 기억해 둔다 — 툴바 버튼이 쓸 최후의 기준점. */
  noteEditCaret: (el: HTMLElement) => void;
  /** Applies a partial style to the CURRENT DOM Selection inside the registered
   * rich editor — port of `Component#applyPartial` (MindFlow.dc.html:2701-2725).
   * DOM-only (rewrites the `contentEditable`'s innerHTML + restores the
   * selection); the actual doc/undo commit happens later, on blur/Enter, via
   * `commitNodeRichText` reading the same live DOM. */
  applyPartial: (kind: 'b' | 'i' | 's' | 'c' | 'link' | 'clear', val?: string | null) => void;
  /** 줄 단위 리스트 연산 — 글머리/번호 토글, 들여쓰기(Tab)/내어쓰기(Shift+Tab).
   * 편집 중인 노드 텍스트에만 적용된다(`richElRef`가 가리키는 박스). */
  applyListOp: (op: ListOp) => void;
  /** 편집 박스의 적용 대상 범위(선택, 없으면 전체) — 링크 입력창이 열 때 잡아 둔다. */
  selectionRange: () => { a: number; b: number } | null;
  /** 잡아 둔 범위에 부분 서식 적용(`applyPartial`의 명시적 범위 버전). */
  applyPartialRange: (a: number, b: number, kind: 'b' | 'i' | 's' | 'c' | 'link' | 'clear', val?: string | null) => void;
  /** 현재 선택에 걸린 링크 주소(없거나 섞였으면 null). */
  selectionLink: () => string | null;
  /** 링크 입력창이 열린 동안 편집 박스의 blur 커밋을 멈춘다. */
  pauseBlurCommit: (paused: boolean) => void;
  isBlurCommitPaused: () => boolean;
  /** 마커 안 Backspace가 만든 편집을 적용한다(빈 항목 통째 삭제 — `listBackspaceOp`). */
  applyListEdits: (edits: TextEdit[]) => void;
  startEditFloat: (id: string) => void;
  commitFloatText: (id: string, text: string) => void;
  /** 메모 rich 커밋 — 노드의 `commitNodeRichText`와 같은 훅(마크다운·자동 링크). */
  commitFloatRichText: (id: string, el: HTMLElement | null) => void;
  cancelFloatEdit: () => void;
  startEditLineLabel: (id: string) => void;
  commitLineLabel: (id: string, text: string) => void;
  cancelLineLabelEdit: () => void;
  startEditZoneLabel: (id: string) => void;
  commitZoneLabel: (id: string, text: string) => void;
  cancelZoneLabelEdit: () => void;
  startEditTitle: () => void;
  commitTitle: (text: string) => void;
  cancelTitleEdit: () => void;

  // ---- structural ----
  addChild: () => void;
  addSibling: () => void;
  deleteSelection: () => void;
  /** 현재 선택(단일/다중)을 클립보드에 담는다. 담을 게 없으면(루트만 선택 등)
   * `false`를 돌려주고 기존 클립보드는 그대로 둔다. */
  copySelection: () => boolean;
  /** 복사 후 원본을 즉시 삭제(캔버스 편집기 관례 — 붙여넣기 시점이 아니라 지금). */
  cutSelection: () => void;
  /** 클립보드 내용을 새 객체로 붙여넣는다. `at`(캔버스 좌표)이 있으면 그 지점에,
   * 없으면 선택된 노드의 자식으로, 그것도 아니면 뷰포트 중앙에. */
  pasteClipboardAt: (at?: { x: number; y: number }) => void;
  canPaste: boolean;
  clipboardSize: number;
  toggleCollapse: (id: string) => void;
  /** `at` (canvas coordinates) is only ever passed by the background context menu's
   * "추가" items (`ContextMenu.tsx`) — port of `Component#addFreeNode`/`addFloat`/
   * `addLine`/`addZone`'s `px != null` branch (MindFlow.dc.html:2122-2124, 2253-2256,
   * 2296-2298, 2455-2459): an explicit spot skips the center-of-viewport + stagger
   * placement entirely (stagger included), landing exactly where the right-click hit. */
  addFreeNodeAt: (at?: { x: number; y: number }) => void;
  addFloatAt: (at?: { x: number; y: number }) => void;
  addLineAt: (at?: { x: number; y: number }) => void;
  addZoneAt: (at?: { x: number; y: number }) => void;
  /** 파일 선택 다이얼로그를 띄워 이미지 플로트를 추가 (삽입 메뉴/배경 컨텍스트 메뉴). */
  promptAddImage: (at?: { x: number; y: number }) => void;
  /** 이미지 파일(붙여넣기/드롭/선택)을 리사이즈해 캔버스에 이미지 플로트로 추가. */
  addImageFloatFromFile: (file: File | Blob, at?: { x: number; y: number }) => Promise<void>;
  /** 파일 선택 다이얼로그로 노드 썸네일 이미지를 첨부/교체 (노드 우클릭 메뉴). */
  promptNodeImage: (id: string) => void;
  /** 노드 썸네일 이미지 제거. */
  clearNodeImage: (id: string) => void;

  // ---- node property setters ----
  setShape: (shape: string) => void;
  setColor: (hex: string | null) => void;
  setFill: (hex: string | null) => void;
  setStroke: (hex: string | null) => void;
  setFillAlpha: (a: number) => void;
  setStrokeAlpha: (a: number) => void;
  setTextColor: (hex: string | null) => void;
  toggleNodeBold: () => void;
  /** 전체 텍스트 기울임/취소선 토글(속성 패널 I·S 버튼) — 굵게와 같은 bulk 규칙(첫
   * 대상 기준), 구현은 rich 런 전체 적용(`mutations.toggleNodesRichStyle` 참고). */
  toggleNodeRichStyle: (key: 'i' | 's') => void;
  setNodeTsize: (v: 's' | 'm' | 'l') => void;
  setEmoji: (e: string) => void;
  clearEmoji: () => void;
  setNote: (text: string) => void;
  /** Port of `Component#setTextAlign` (MindFlow.dc.html:2773) — same bulk-aware pattern
   * as `setShape`/`toggleNodeBold`: applies to every `nodeTargetIds()` target. */
  setTextAlign: (v: 'left' | 'center' | 'right') => void;

  // ---- float property setters (bulk-aware: apply to `multiGroups.floats`,
  // port of `Component#applyFloatText`-backed setters, MindFlow.dc.html:2733-2737) ----
  setFloatBg: (hex: string | null) => void;
  toggleFloatBold: () => void;
  /** 메모 전체 기울임('i')/취소선('s') 토글 — 노드와 같은 whole-toggle 규칙. */
  toggleFloatRichStyle: (key: 'i' | 's') => void;
  setFloatTsize: (v: 's' | 'm' | 'l') => void;
  setFloatTextColor: (hex: string | null) => void;
  toggleFloatCollapse: (id: string) => void;
  deleteFloat: (id: string) => void;

  // ---- line property setters (bulk-aware: apply to `multiGroups.lines`, except
  // `setLineCurve`/rename which stay single-reference — port of `Component#applyLineText`-backed
  // setters + `setLineCurveN`, MindFlow.dc.html:2492, 2517-2528, 2738-2741) ----
  setLineDashed: (v: boolean) => void;
  setLineArrow: (which: LineHandle, v: boolean) => void;
  setLineCurve: (id: string, which: LineHandle, v: number) => void;
  toggleLineBold: () => void;
  setLineTsize: (v: 's' | 'm' | 'l') => void;
  setLineTextColor: (hex: string | null) => void;
  deleteLine: (id: string) => void;
  /** Resolves a line's on-screen endpoints, following `a1`/`a2` anchors to their live
   * node/float box — port of `Component#resolveLine` (MindFlow.dc.html:2414-2417). Use
   * this (not the line's raw `x1/y1/x2/y2`) for rendering/hit-testing so anchored lines
   * track their target as it moves. */
  resolveLine: (l: Line) => { x1: number; y1: number; x2: number; y2: number };
  /** The anchor-aware Bézier geometry (endpoints resolved + curvature applied) — what
   * `LineLayer` actually draws. */
  lineGeometry: (l: Line) => ReturnType<typeof resolveLineGeometry>;
  /** The line-end drag's current snap target (port of `Component#_snapHi`,
   * MindFlow.dc.html:1733) — null except mid-drag when a port is within range. Drives the
   * 4 port-indicator dots on the hovered node/float (MindFlow.dc.html:1388-1402). */
  lineSnap: LineAnchor | null;
  /** The live box for `lineSnap`'s target (already resolved — `LineLayer` doesn't need
   * its own node/float lookup to draw the port dots). */
  lineSnapBox: Box | null;

  // ---- zone property setters ----
  setZoneColor: (id: string, hex: string | null) => void;
  deleteZone: (id: string) => void;

  // ---- right-click context menu — port of `Component#state.ctxMenu`/`ctxSub`
  // (MindFlow.dc.html:2775-2837, 3087-3170) ----
  ctxMenu: ContextMenuState | null;
  ctxSub: ContextSubState | null;
  /** Wire to the viewport's `onContextMenu` — port of `Component#onCtxMenu`
   * (MindFlow.dc.html:2775-2791). */
  onContextMenu: (e: ReactMouseEvent<HTMLDivElement>) => void;
  /** Port of `Component#closeCtxMenu` (MindFlow.dc.html:2837) — also used by
   * `ContextMenu`'s own outside-click/Escape handling. */
  closeCtxMenu: () => void;
  /** 현재 선택의 컨텍스트 메뉴를 모바일 선택 바에 붙여서 연다 — 바의 '메뉴(⋯)'용.
   * `anchor`(바의 위/아래 변 + ⋯ 버튼 중심 x, `.mf-ed-vp` 기준)로 메뉴를 바에
   * 붙이고 꼬리를 그린다. 우클릭/길게 누르기 없이도 전체 메뉴에 닿게 한다. */
  openCtxMenuForSelection: (anchor: { x: number; top: number; bottom: number }) => void;
  /** Opens (or closes, if already open) the "텍스트 정렬 ▸" flyout, anchored to the
   * clicked row's `offsetTop` — port of the `alignParent` item's `onClick`
   * (MindFlow.dc.html:3120). */
  toggleCtxSub: (top: number) => void;

  // ---- drag / resize starters ----
  beginNodeDrag: (e: ReactPointerEvent, id: string) => void;
  beginNodeResize: (e: ReactPointerEvent, id: string) => void;
  resetNodeSize: (id: string) => void;
  beginFloatDrag: (e: ReactPointerEvent, id: string) => void;
  beginFloatResize: (e: ReactPointerEvent, id: string) => void;
  beginZoneDrag: (e: ReactPointerEvent, id: string) => void;
  beginZoneResize: (e: ReactPointerEvent, id: string) => void;
  beginLineDrag: (e: ReactPointerEvent, id: string) => void;
  beginLineEndDrag: (e: ReactPointerEvent, id: string, which: LineHandle) => void;
  beginLineCurveDrag: (e: ReactPointerEvent, id: string, which: LineHandle) => void;
  /** Start moving the current selection from a deliberate move-handle grip (mobile). */
  beginMoveSelected: (e: ReactPointerEvent) => void;
  dragGhost: { id: string; x: number; y: number } | null;
  /** 그룹(다중 선택) 드래그 중의 고스트 — 멤버들의 점선 윤곽이 (dx,dy)만큼 이동해
   * 보인다(단일 드래그의 `dragGhost`와 같은 모델). 실물은 드롭에서 한 번에 이동. */
  groupGhost: { dx: number; dy: number; nodes: string[]; floats: string[]; lines: string[] } | null;

  // ---- undo/redo/save/export ----
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  saveState: SaveState;
  saveNow: () => void;
  /** 리로드 직전 정리 — 대기 중인 자동저장을 flush 하고 "리로드해도 안전한가"를
   * 돌려준다. 새 버전 적용(`pwa/updateGate`)이 이걸 보고 진행/중단을 정한다. */
  flushSave: () => Promise<boolean>;
  /** Set when the last `DocStore.save()` lost an optimistic-lock race (another
   * tab/device saved first) — a place for the UI (`DocChip`) to tell the user,
   * per CLAUDE.md's M4 task brief ("충돌 시 사용자 고지 자리 마련"). */
  saveConflict: { currentVersion: number } | null;
  /** 이 맵이 **새 id로 옮겨졌다**(원래 id가 다른 계정의 문서였다). 배너로 한 번
   * 알리고 사용자가 닫으면 사라진다 — `moveToFreshId` 참고. */
  movedNotice: boolean;
  dismissMovedNotice: () => void;
  /** 이미지 관련 한 줄 알림(독칩 전광판). 지금 쓰는 두 경우 모두 **조용히 넘기면
   * 안 되는** 것들이다: 첨부 실물을 못 올려 본문에 인라인했을 때(협업 메시지 크기
   * 사고·DB 팽창이 되살아난다), 내보내기에 이미지를 다 담지 못했을 때(파일이
   * 반쪽인 걸 모른 채 보관하게 된다). */
  imageNotice: string | null;
  dismissImageNotice: () => void;
  dismissSaveConflict: () => void;
  exportJSON: () => void;
  exportPNG: () => void;
  /** 마크다운 개요(.md)로 내보낸다 — 코어 `toMarkdown`. */
  exportMarkdown: () => void;

  // ---- 공유 ----
  /** 공유 모달이 열려 있는가. */
  shareOpen: boolean;
  openShare: () => void;
  closeShare: () => void;
  /** 이 문서의 id — 공유 모달이 초대를 걸 대상. */
  docId: string;
  /** 초대 목록 창구(실제 접근 제어는 DB의 RLS). */
  shareStore: ShareStore;
  /** `'local'`(데모)인지 — 공유 모달이 "실제로는 공유되지 않는다"를 알려 줄 때 쓴다. */
  backendMode: 'local' | 'supabase';
  /** 실시간 협업 전송이 실제로 붙었는지(`collab/ports.ts`의 `CollabStatus`).
   * 조용히 죽지 않도록 UI가 이걸 보고 알려 준다. */
  collabStatus: CollabStatus;
  /** 이미지 참조 → 표시용 URL. 렌더러는 `displaySrc(img, imageUrls)`로 읽는다. */
  imageUrls: ImageUrlMap;
  /** 이 문서가 **실제로 공유돼 있는가**(초대 목록에 행이 있다). 실시간 연결이 끊겨도
   * 혼자 쓰는 맵에서는 알릴 이유가 없다 — 저장은 실시간 채널과 무관하다. */
  sharedDoc: boolean;
  /** **편집 차단(즉시)**: 공유된 맵인데 실시간이 끊겼다. 끊긴 동안의 편집은 재연결
   * 시 CRDT로 병합되지만 **같은 대상을 상대도 건드렸다면 한쪽이 사라진다**
   * (`mindmap-core`의 `crdt/divergence.test.ts`가 그 규칙을 고정한다: 같은 필드는
   * 한쪽만, 부모의 `children`도 한쪽 목록만, 삭제가 편집을 이긴다). 유실 가능성이
   * 있는 시간대에는 아예 편집을 만들지 않는 편이 안전하므로, 끊김을 알아차린 즉시
   * `commitDoc`에서 모든 문서 변이를 막고 배너로 알린다. 다시 붙으면 곧 풀린다. */
  collabBlocked: boolean;
  /** **오래 끊김**: 차단이 `COLLAB_PAUSE_AFTER_MS`를 넘겼다. 짧은 끊김은 배너로 충분하지만
   * 이쯤 되면 화면 전체로 알리고 새로고침을 안내한다(직전 문서는 버전 기록에 스냅샷). */
  collabPaused: boolean;
  /** **보기 전용**으로 초대된 공유 문서인가(#22). true면 편집 크롬을 감추고
   * 모든 문서 변이가 chokepoint(`commitDoc`)에서 차단된다. 진짜 게이트는 서버
   * RLS(0009 — view 초대는 SELECT만)다. */
  readOnly: boolean;
}

/**
 * 겹침 nudge용 박스 조회 팩토리 — 위치 규칙 하나로 모든 경우를 맞춘다: 어떤 id든
 * **최상위 조상**이 자유 루트라면, 그 루트가 geom 대비 옮겨 간 만큼(delta =
 * 후보 `cand`의 루트 위치 − geom의 루트 위치) 자기 geom 위치를 평행이동해 읽는다.
 * 루트 자신(delta 적용 = 후보 위치)과 그 **자식들**(같은 delta로 추종 — 자식을
 * 가진 자유 도형을 옮기면 서브트리 박스가 "새 루트 ~ 옛 자식"으로 늘어나 엉뚱한
 * 곳으로 튀던 제보의 원인)과 이번 패스에서 먼저 밀린 다른 자유 도형의 서브트리까지
 * 전부 이 규칙 하나로 맞는다. 트리(문서 루트) 노드는 delta 0 — geom 그대로.
 */
function nudgeBoxOf(cand: NodeMap, geom: Record<string, { x: number; y: number; w: number; h: number }>) {
  return (id: string): { x: number; y: number; w: number; h: number } | null => {
    const gg = geom[id];
    if (!gg) return null;
    // 최상위 조상까지 걸어 올라간다(손상 문서의 순환 대비 hop 상한).
    let r = id;
    for (let hop = 0; hop < 200 && cand[r]?.parent; hop++) r = cand[r]!.parent!;
    const rn = cand[r];
    if (rn && !rn.parent && r !== ROOT_ID) {
      const rg = geom[r];
      const dx = rg ? rn.x - rg.x : 0;
      const dy = rg ? rn.y - rg.y : 0;
      return { x: gg.x + dx, y: gg.y + dy, w: gg.w, h: gg.h };
    }
    return { x: gg.x, y: gg.y, w: gg.w, h: gg.h };
  };
}

function docSignature(d: Doc): string {
  try {
    return JSON.stringify([d.nodes, d.floats, d.lines, d.zones, d.layoutMode, d.themeKey, d.edgeStyle]);
  } catch {
    return '';
  }
}

/** Port of `Component#docTitle` (MindFlow.dc.html:605) — used as the export filename base. */
function safeDocTitle(doc: Doc, fallbackTitle: string): string {
  const raw = doc.nodes[ROOT_ID]?.text || fallbackTitle || '마인드맵';
  return raw.trim().replace(/[\\/:*?"<>|]/g, '_');
}

export function useEditorState(): EditorController {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const docStore = useDocStore();
  const shareStore = useShareStore();
  const commentStore = useCommentStore();
  const spaceStore = useSpaceStore();
  const backend = useBackend();
  const backendMode = backend.mode;
  const imageStore = backend.imageStore;
  const urlMapId = params.get('map') || null;
  /** 저장하려던 id가 **다른 계정의 문서**여서 새 id로 옮겨 간 경우의 새 id
   * (`DocStore.save`의 `idTaken` → `moveToFreshId` 참고). 이후의 저장·로컬 캐시·
   * 협업 채널은 전부 이 id를 쓴다. */
  const [movedId, setMovedId] = useState<string | null>(null);
  /** 새 id로 옮겨졌음을 한 번 알리는 배너 플래그(사용자가 닫을 때까지 유지). */
  const [movedNotice, setMovedNotice] = useState(false);
  const [imageNotice, setImageNotice] = useState<string | null>(null);
  const mapId = movedId ?? urlMapId;
  const docStoreId = mapId || 'default';
  const titleParam = params.get('title') ? decodeURIComponent(params.get('title') || '') : '';

  /** 첨부 실물을 올리는 함수 — `attachImageFile`에 넘긴다. 콜백 deps를 흔들지 않게
   * ref로 들고 있는다(문서 id가 바뀌어도 첨부 콜백을 새로 만들 이유가 없다). */
  const imageUploadRef = useRef<(blob: Blob, ext: string) => Promise<string | null>>(async () => null);
  imageUploadRef.current = (blob, ext) => imageStore.upload(docStoreId, blob, ext);

  /** 새로 만들기로 들어왔는가 — `newMapHref`만 `new=1`을 붙인다(홈의 기존 카드 링크
   * `mapHref`에는 없다). "행이 없다"를 새 맵과 **본문이 다른 기기에 있는 기존 맵**으로
   * 가르는 유일한 근거다(아래 `bodyMissing` 참고). */
  const isNewMapParam = params.get('new') === '1';
  /** 템플릿에서 만든 새 맵(`tpl=<id>`) — 빈 루트 대신 그 템플릿 문서로 시작한다.
   * 모르는 id면 `buildTemplateDoc`이 null이라 평범한 새 맵으로 떨어진다. */
  const [doc, setDoc] = useState<Doc>(() => loadOrSeedDoc(mapId, titleParam, buildTemplateDoc(params.get('tpl'))));
  /** 본문의 이미지 참조 → 표시용 URL(별도 저장소). 옛 문서의 데이터 URL은 참조가
   * 아니므로 여기 들어오지 않고 값 그대로 그려진다(`displaySrc`). */
  const imageUrls = useImageUrls(doc, imageStore);
  /** 마운트 시점에 이 기기에 본문이 있었는가. 로드가 끝난 뒤 판단해야 하므로 그때의
   * 값을 고정해 둔다(로드 중 캐시가 채워질 수 있다). */
  const hadLocalBodyRef = useRef(hasStoredDoc(mapId));
  // True while the mount-time doc is only a PLACEHOLDER seed (no local body) and a
  // backend `docStore.load` is still in flight — the canvas holds until it
  // resolves so the empty default never flashes before the real tree. Only gates
  // in backend (supabase) mode: local mode's seed IS authoritative (the store
  // reads the same localStorage), so it paints instantly with no spinner.
  const [hydrating, setHydrating] = useState(() => backendMode === 'supabase' && !hasStoredDoc(mapId));
  const [saveConflict, setSaveConflict] = useState<{ currentVersion: number } | null>(null);
  // connector style lives on the doc (persisted like layoutMode/themeKey); mirror
  // it into local state for rendering, seeded from the loaded doc.
  const [edgeStyle, setEdgeStyleState] = useState<EdgeStyle>(() => (doc.edgeStyle as EdgeStyle | undefined) ?? 'curve');
  const [view, setView] = useState<ViewMode>('map');
  const [viewport, setViewport] = useState<ViewportState>(INITIAL_VIEWPORT);
  // True once the ResizeObserver has reported the canvas's real on-screen size.
  // The initial centering waits for this so it centers against the actual
  // viewport, not the 1200×700 default (which on a phone put the root
  // off-screen). If ResizeObserver is unavailable (jsdom), start `true` so the
  // one-shot centering still runs with the default size, as before.
  const [measured, setMeasured] = useState<boolean>(typeof ResizeObserver === 'undefined');
  const [rootAnchor, setRootAnchor] = useState<PanState>({ x: 0, y: 0 });
  const [dragGhost, setDragGhost] = useState<{ id: string; x: number; y: number } | null>(null);
  const [groupGhost, setGroupGhost] = useState<{ dx: number; dy: number; nodes: string[]; floats: string[]; lines: string[] } | null>(null);

  const [selection, setSelectionState] = useState<Selection | null>(null);
  const [multiSelection, setMultiSelectionState] = useState<MultiSelection | null>(null);
  // Mobile-only: whether the property bottom sheet is open (see the interface
  // note). Reset to closed whenever the selection identity changes so a fresh
  // tap never re-covers the canvas — the user re-opens it per object.
  const [propsOpen, setPropsOpen] = useState(false);
  useEffect(() => {
    setPropsOpen(false);
  }, [selection?.kind, selection?.id]);
  const openProps = useCallback(() => setPropsOpen(true), []);
  const closeProps = useCallback(() => setPropsOpen(false), []);
  const [marquee, setMarquee] = useState<MarqueeRect | null>(null);
  const [attachTarget, setAttachTarget] = useState<AttachTarget | null>(null);
  const [showMinimap, setShowMinimap] = useState(true);
  const [outlineEditId, setOutlineEditId] = useState<string | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  // The node currently being resized (drag on its size handle). Like `editingNodeId`,
  // it's lifted to the top layer so its box cleanly covers any neighbour it grows
  // over mid-drag (the magnet only separates them on release).
  const [resizingNodeId, setResizingNodeId] = useState<string | null>(null);
  // Live box size for the node currently being edited, re-measured on each
  // keystroke from the `contentEditable`'s content (`updateNodeEditSize`). While
  // editing, `geom` uses this instead of the node's stale committed size, so the
  // box grows/shrinks WITH the text (WYSIWYG) instead of the text overflowing a
  // fixed box until commit re-lays-out. `null` = not measured yet (use committed).
  const [editLiveSize, setEditLiveSize] = useState<{ w: number; h: number; tw: number } | null>(null);
  const [editingFloatId, setEditingFloatId] = useState<string | null>(null);
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  // A doc with no local body yet has never been saved anywhere we know of —
  // start the chip at '저장 전', not a false '저장됨'. The initial load flips it:
  // an existing backend doc → 'saved', a confirmed brand-new map → the seed is
  // persisted immediately ('saving' → 'saved', now truthfully).
  const [saveState, setSaveStateState] = useState<SaveState>(() => (hasStoredDoc(mapId) ? 'saved' : 'unsaved'));
  const [, setHistoryTick] = useState(0);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const [ctxSub, setCtxSub] = useState<ContextSubState | null>(null);
  const [textCtx, setTextCtx] = useState<TextCtxState | null>(null);
  // This port's stand-in for `Component#_richEl` (MindFlow.dc.html:1209) — the
  // currently-mounted rich-text `contentEditable` element, registered by
  // `NodeEditBox` while it's the one rendered (`editingNodeId` is set to its id).
  const richElRef = useRef<HTMLDivElement | null>(null);
  /**
   * 편집 박스 안에서 **마지막으로 확인된 캐럿/선택**(값 좌표계).
   *
   * 서식 툴바의 버튼은 편집 박스 **밖**을 누르는 동작이라, 그 순간의
   * `window.getSelection()`을 그대로 믿을 수 없다 — 손가락 탭은 마우스와 달리
   * 선택을 옮기거나 지울 수 있고, 방금 다시 그린 DOM을 가리키는 낡은 Range가
   * 남기도 한다(제보: 폰에서 툴바 내어쓰기를 쓰면 엉뚱한 결과). 그래서 편집 중에
   * 계속 기록해 두고, 탭 시점의 선택이 쓸 수 없으면 이 값을 쓴다.
   */
  const lastEditSelRef = useRef<{ a: number; b: number } | null>(null);
  const setRichEditorEl = useCallback((el: HTMLDivElement | null) => {
    richElRef.current = el;
    if (!el) lastEditSelRef.current = null; // 편집 세션이 끝나면 기억도 버린다
  }, []);

  /** 편집 박스의 현재 선택을 값 좌표계로 기록한다(박스 안일 때만). */
  const noteEditCaret = useCallback((el: HTMLElement) => {
    const ws = window.getSelection();
    if (!ws || !ws.rangeCount) return;
    const rng = ws.getRangeAt(0);
    if (!el.contains(rng.startContainer) || !el.contains(rng.endContainer)) return;
    const lin = linearize(el, [
      { container: rng.startContainer, offset: rng.startOffset },
      { container: rng.endContainer, offset: rng.endOffset },
    ]);
    const live = liveEditValue(el);
    lastEditSelRef.current = {
      a: live.clamp(Math.min(lin.pos[0] ?? 0, lin.pos[1] ?? 0)),
      b: live.clamp(Math.max(lin.pos[0] ?? 0, lin.pos[1] ?? 0)),
    };
  }, []);

  const idFactory = useRef(createIdFactory()).current;

  // ---- DocStore version (optimistic lock) — `undefined` until the first
  // `load()`/`save()` tells us what the backend currently has. Local mode's
  // initial doc comes from the synchronous `loadOrSeedDoc` seed above (so the
  // very first paint never blocks on a promise); this effect then confirms
  // the version and — for a real backend — swaps in the actual remote doc
  // once it arrives (a no-op re-render for Local, since content is identical).
  //
  // `mountDocSigRef` guards against a race with the user editing before this
  // promise resolves: only ever overwrite `doc` here if it's STILL exactly
  // the mount-time seed (nothing edited yet) — otherwise an in-flight load
  // that resolves after an edit already landed would silently revert it. ----
  const docVersionRef = useRef<number | undefined>(undefined);
  const mountDocSigRef = useRef(docSignature(doc));
  // DATA-LOSS GUARD: never write to the backend until the initial `load()` has
  // RESOLVED. Until then we don't know the doc's real content/version, so the
  // synchronous empty seed (localStorage has no body in backend mode) could
  // otherwise be saved — with `prevVersion: undefined` that's a force-UPSERT
  // that would OVERWRITE the user's real map with an empty one. Stays false on a
  // load ERROR too (unknown backend state → refuse to persist, keep the map safe).
  const canPersistDocRef = useRef(false);
  const lastSavedSigRef = useRef(docSignature(doc));
  /**
   * 마지막으로 **상대에게서 받아** 적용한 문서 상태의 서명.
   *
   * 협업의 저장 책임 규칙: **편집한 쪽이 저장한다.** 받은 쪽은 그 상태를 저장하지
   * 않는다(중복 쓰기·버전 충돌·엉뚱한 `updated_by`의 원인). 상대가 저장하기 전에
   * 떠나면 남은 쪽이 인수한다(아래 피어 이탈 효과).
   */
  const remoteSigRef = useRef<string | null>(null);
  /**
   * 이 문서를 연 뒤 **한 번이라도 함께 편집했는가**(피어를 봤거나 원격 업데이트를 받음).
   *
   * 저장 충돌의 해석이 여기서 갈린다. 협업 세션에서는 내 문서가 상대의 편집과 CRDT로
   * 이미 수렴해 있으므로 충돌은 "누가 먼저 저장했나"일 뿐이다 — 새 버전 기준으로 다시
   * 쓰면 된다. "지금 붙어 있는가"가 아니라 "붙은 적이 있는가"인 이유: 상대가 저장 전에
   * 떠나 내가 **인수 저장**하는 순간에는 이미 접속자가 0인데, 그때 내 버전 기준은
   * 상대의 저장으로 낡아 있어 첫 시도가 반드시 충돌한다(실브라우저에서 확인 — 이걸
   * "다른 기기가 먼저 저장"으로 보면 인수 저장이 실패하고 경고까지 뜬다).
   */
  const collabSessionRef = useRef(false);
  const initialLoadRef = useRef<Promise<void>>(Promise.resolve());
  // The load effect below needs `persistDoc` (declared later, with the other save
  // handlers) to kick the brand-new-map seed save — bridged via a render-synced
  // ref so the effect's dep list stays [docStore, docStoreId, mapId] (a changing
  // callback identity must not re-run the initial load).
  const persistDocRef = useRef<() => Promise<void>>(async () => undefined);
  const [loadError, setLoadError] = useState(false);
  /**
   * 본문이 **어디에도 없다**: 백엔드에 행이 없고, 이 기기 로컬에도 없고, 새로 만든
   * 맵도 아니다 → 본문은 다른 기기에 있다. 빈 문서로 덮어쓰지 않도록 편집·저장을
   * 멈추고 안내한다(위 `!res` 분기 참고).
   */
  const [bodyMissing, setBodyMissing] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const p = docStore
      .load(docStoreId)
      .then((res) => {
        if (cancelled) return;
        // Whether the user has edited since mount — decided BEFORE the adopt
        // branch rewrites `mountDocSigRef`. While pristine, the save chip may be
        // corrected from here; after an edit the autosave flow owns it.
        const pristine = docSignature(docRef.current) === mountDocSigRef.current;
        if (res) {
          docVersionRef.current = res.version;
          // 오프라인에서 쓴 사본이 아직 안 올라갔다면(`markDocPending`) 서버 판은
          // **더 옛것**이다 — 채택하면 그 편집이 조용히 사라진다. 로컬을 지키고
          // 아래에서 곧바로 올린다.
          const localPending = hasPendingDoc(mapId);
          const adopt = !localPending && docSignature(docRef.current) === mountDocSigRef.current && docSignature(res.doc) !== mountDocSigRef.current;
          if (adopt) {
            setDoc(res.doc);
            setEdgeStyleState((res.doc.edgeStyle as EdgeStyle | undefined) ?? 'curve');
            // Re-baseline so the just-loaded doc isn't immediately re-saved, and so
            // a later in-flight edit doesn't get reverted by this same load.
            const sig = docSignature(res.doc);
            lastSavedSigRef.current = sig;
            mountDocSigRef.current = sig;
            // DATA-LOSS GUARD: rebase the undo/redo history onto the just-loaded
            // doc. The history baseline was seeded at mount from the empty
            // PLACEHOLDER (backend mode paints a spinner, not the seed, until this
            // load resolves), so without this reset the empty seed stays at the
            // bottom of the undo stack — one Undo past the first edit would restore
            // it and wipe the whole map. Port of dc's post-load history reset
            // (MindFlow.dc.html:862, the `_loadingDoc` branch).
            historyRef.current?.reset({
              nodes: res.doc.nodes,
              floats: res.doc.floats,
              lines: res.doc.lines,
              zones: res.doc.zones,
              layoutMode: res.doc.layoutMode,
              edgeStyle: (res.doc.edgeStyle as EdgeStyle | undefined) ?? 'curve',
            });
            setHistoryTick((t) => t + 1);
          }
          if (localPending) {
            // 못 올린 편집이 남아 있다 — 서버가 아는 판을 기준선으로 삼아 지금 올린다.
            // (로컬 사본은 그대로 두고, 성공하면 `persistDoc`이 pending 표시를 지운다.)
            lastSavedSigRef.current = docSignature(res.doc);
            canPersistDocRef.current = true;
            setSaveStateState('saving');
            void persistDocRef.current();
          } else {
            // Cache the backend truth locally: next open renders instantly (no
            // empty-seed flash/race) AND it's a recovery copy if a write goes wrong.
            try {
              saveDoc(mapId, res.doc);
            } catch {
              /* storage unavailable — non-fatal */
            }
            // The doc now mirrors the stored truth — clear a mount-time '저장 전'
            // (backend doc opened on a fresh device). Skipped after a mid-load
            // edit: the autosave flow already owns the chip then.
            if (pristine) setSaveStateState('saved');
          }
        } else {
          docVersionRef.current = undefined; // confirmed brand-new map (no row yet)
        }
        // 남의 문서를 **링크로** 열었는가(0017). 링크로 들어온 사람은 초대 목록에
        // 자기 행이 없어서 소유자와 구별되지 않는다 — 그러면 아래 권한 판별이
        // 'edit'로 남아 편집 UI를 내주고 저장만 서버에 거부당한다. 로드가 알려 주는
        // 소유 여부가 그 구별을 만든다(로컬/데모 모드는 undefined → 기존 동작).
        setLoadedNotMine(res?.ownedByMe === false);
        // A RESOLVED load (doc OR null) means we know the backend state → saving
        // is now safe.
        canPersistDocRef.current = true;
        setLoadError(false);
        if (!res) {
          // 행이 없다 ≠ 항상 새 맵이다. 홈의 **기존 카드**를 열었는데 행이 없고 이
          // 기기에 로컬 본문도 없다면, 그 본문은 **다른 기기에 있다**(백엔드에 올라가기
          // 전에 만들어진 맵). 여기서 빈 seed를 저장하면 그 빈 문서가 정본이 되고,
          // 본문을 가진 기기가 다음에 열 때 그것을 내려받아 **로컬 본문까지 덮는다.**
          // 그래서 이 경우엔 아무것도 쓰지 않고 안내만 한다.
          //
          // 구분 근거: 새로 만들기 링크만 `new=1`을 붙인다(`newMapHref`). 홈에서 기존
          // 카드를 여는 링크(`mapHref`)에는 없다.
          if (!isNewMapParam && !hadLocalBodyRef.current) {
            canPersistDocRef.current = false; // 편집·자동저장도 멈춘다(덮어쓰기 방지)
            setBodyMissing(true);
            return;
          }
          // Confirmed brand-new: persist the seed RIGHT AWAY (creation = the doc
          // exists, like the card already added to Home at 새로 만들기). This keeps
          // the chip truthful ('저장 전' → '저장 중…' → real '저장됨') and gives the
          // doc a body no matter how the user leaves (browser back / tab close
          // included), so the Home card previews the actual root node. Safe by
          // construction: no row exists, so nothing can be overwritten.
          setSaveStateState('saving');
          void persistDocRef.current();
        }
      })
      .catch(() => {
        if (cancelled) return;
        // Load FAILED (offline/RLS/transient): we do NOT know the backend state,
        // so we must NEVER persist — otherwise the empty seed could clobber the
        // real doc. Surface an error instead of silently showing an empty map.
        canPersistDocRef.current = false;
        setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setHydrating(false);
      });
    initialLoadRef.current = p;
    return () => {
      cancelled = true;
    };
  }, [docStore, docStoreId, mapId]);

  // ---- 공유 권한(#22): '보기 전용'으로 초대된 문서인가 ----
  // 판별 전 기본값은 'edit'(단독/소유 문서 무회귀). 잘못 판별돼도 위험하지 않다 —
  // 서버 RLS(0009)가 view 초대의 UPDATE를 거부하므로, 이 상태는 "고쳐지는 척하다
  // 저장은 안 되는" 화면을 만들지 않기 위한 클라이언트 어포던스다.
  const [accessRole, setAccessRole] = useState<ShareRole>('edit');
  /** 로드가 "내 문서가 아니다"라고 알려 준 상태(링크 공유 또는 초대). */
  const [loadedNotMine, setLoadedNotMine] = useState(false);
  // 초대 목록에 행이 있는가 = 남과 함께 쓰는 맵인가. 협업 연결 배지의 조건이다.
  const [sharedDoc, setSharedDoc] = useState(false);
  const readOnly = accessRole === 'view';
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;

  // ---- M5: real-time collaboration ----
  // Backs `doc` with a live Y.Doc (Supabase Realtime if configured, else
  // BroadcastChannel for same-browser multi-tab, else a no-op — see
  // `collab/factory.ts`). Local edits already flow through `setDoc`/`commitDoc`
  // above as normal; `useYjsDocSync` observes the resulting `doc` value and
  // mirrors it into the Y.Doc (and out to peers) as a diff, and merges
  // incoming remote updates straight into `doc` via `setDoc` (bypassing
  // `commitDoc`, so remote edits don't land on THIS tab's local undo stack —
  // see `useYjsDocSync`'s doc comment for the full rationale).
  // 초기 로드가 끝나기 전에는 붙지 않는다(빈 문자열 = 대기) — 공유받은 맵을 처음 여는
  // 기기는 이 기기에 본문이 없어 마운트 시 **빈 자리표시자**를 들고 있고, 그 상태로
  // 붙으면 상대의 진짜 문서와 병합돼 자리표시자가 일부 필드에서 이길 수 있다. 열 수
  // 없는 맵(`bodyMissing`/`loadError`)에서도 붙지 않는다 — 편집 자체를 멈춘 상태다.
  // 보기 전용 초대도 붙지 않는다 — 0009의 채널 **발신** 정책이 edit 초대에만 열려
  // 있고, Yjs 동기화 프로토콜(합류 SV 교환·15초 치유)은 양방향 발신을 전제한다.
  // 발신이 막힌 채 붙으면 증분 업데이트가 상대에서 영영 보류된다(#229의 교훈).
  // 뷰어는 저장된 최신 판을 열람한다(리로드하면 새 판).
  const collabDocId = hydrating || bodyMissing || loadError || readOnly ? '' : docStoreId;
  // 원격 문서가 도착하면 `edgeStyle` 로컬 미러도 함께 갱신한다 — 렌더(EdgeLayer)와
  // 스타일 드롭다운은 이 상태를 읽으므로, `setDoc`만 하면 상대가 바꾼 연결선 스타일이
  // 문서에는 있는데 화면에는 반영되지 않는다(제보: "연결선 스타일이 상대에게 안 보임").
  const onRemoteDoc = useCallback((d: Doc) => {
    // 이 상태를 만든 건 **상대**다. 아래 자동저장 효과가 그걸 알아야 한다 —
    // 받은 쪽이 같이 저장하면 같은 문서에 두 명이 써서 버전 레이스가 나고(제보:
    // "B가 편집했는데 소유자 A가 저장되고 B에게 충돌 경고"), `updated_by`도 실제로
    // 편집하지 않은 사람으로 찍힌다.
    remoteSigRef.current = docSignature(d);
    collabSessionRef.current = true;
    setDoc(d);
    setEdgeStyleState((d.edgeStyle as EdgeStyle | undefined) ?? 'curve');
  }, []);
  const { awareness, status: collabStatus } = useYjsDocSync(collabDocId, doc, onRemoteDoc);
  // 저장 경로가 "지금 실시간이 붙어 있는가"를 물어야 해서 ref로 미러링한다
  // (`persistDoc`의 충돌 해석 — 아래 주석 참고).
  const collabStatusRef = useRef(collabStatus);
  collabStatusRef.current = collabStatus;
  /** 공유 맵인데 실시간이 끊겼다 — **즉시** 편집을 막는다(위 인터페이스 주석 참고). */
  const collabBlocked = backendMode === 'supabase' && sharedDoc && collabStatus === 'offline';
  const collabBlockedRef = useRef(collabBlocked);
  collabBlockedRef.current = collabBlocked;
  // 공유 맵 + 실시간 끊김 = 지금 만든 편집이 상대 것과 갈라질 수 있다 → **즉시** 막는다.
  // (유예를 두면 그 시간만큼 유실 창이 열린다 — 실제 병합 규칙은 core의
  //  `crdt/divergence.test.ts` 참고.) 오래 끊기면 아래 타이머가 전체 안내로 승격한다.
  const [collabPaused, setCollabPaused] = useState(false);
  const collabPausedRef = useRef(false);
  collabPausedRef.current = collabPaused;

  // ---- presence (multi-user awareness on top of M5's document sync): cursor
  // position + selection + identity, broadcast via the SAME `Awareness`
  // instance `useYjsDocSync` connected above (Supabase Realtime/BroadcastChannel/
  // no-op — whichever `collab/factory.ts` picked). `authUser` resolves
  // asynchronously (a real Supabase session) or stays `null` (local/demo mode,
  // or before the session check resolves) — `usePresence` falls back to a
  // random "adjective+animal" guest identity in that case (`collab/identity.ts`).
  // 커서 이름표는 이메일이 아니라 **프로필명**(홈에서 바꾼 이름)을 쓴다. ----
  const authUser = useAuthUser();
  const profileName = useProfileName(authUser?.email ?? null, authUser?.name ?? null);
  const presence = usePresence(awareness, authUser?.email, profileName);
  const peerCount = presence.peers.length;
  if (peerCount > 0) collabSessionRef.current = true;

  // 내가 이 문서에 어떤 권한으로 초대됐는가 — 초대 목록에서 **내 행**을 읽는다.
  // RLS(0009)의 결: 초대받은 사람은 자기 행만 보이고, 소유자의 목록에 자기 행은
  // 없다(자기 자신은 초대할 수 없다 — ShareModal이 막는다) → 소유자는 'edit' 유지.
  // 조회 실패는 'edit'로 둔다: 진짜 게이트는 서버라 잘못돼도 저장이 거부될 뿐이다.
  const myShareEmail = (authUser?.email ?? '').trim().toLowerCase();
  useEffect(() => {
    let alive = true;
    setAccessRole('edit'); // 문서/계정이 바뀌면 판별 전까지 기존 동작
    setSharedDoc(false);
    if (!myShareEmail || !docStoreId) return;
    void (async () => {
      try {
        const rows = await shareStore.list(docStoreId);
        if (!alive) return;
        setSharedDoc(rows.length > 0);
        const mine = rows.find((r) => r.email === myShareEmail);
        if (mine) setAccessRole(mine.role);
        // 내 문서가 아닌데 초대 행도 없다 = **링크로 열었다**(0017) → 보기 전용.
        // 서버도 같은 판단을 한다(링크는 SELECT만 열고 UPDATE는 열지 않는다) —
        // 이건 "고쳐지는 척하다 저장은 안 되는" 화면을 막는 어포던스다.
        else if (loadedNotMine) setAccessRole('view');
      } catch {
        /* 판별 불가 — 편집 유지(서버가 최종 판단) */
      }
    })();
    return () => {
      alive = false;
    };
  }, [docStoreId, shareStore, myShareEmail, loadedNotMine]);

  // Broadcasts the LOCAL selection (single `selection` OR marquee `multiSelection`,
  // whichever is active — same precedence as `multiGroups` below, plus zones,
  // which `MultiSelection` itself doesn't carry) to peers whenever it changes.
  // Deliberately does NOT touch `doc`/undo — presence-only, per this feature's
  // task brief.
  useEffect(() => {
    const next: PresenceSelection = multiSelection
      ? { nodes: multiSelection.nodes, floats: multiSelection.floats, lines: multiSelection.lines, zones: [] }
      : selection
        ? {
            nodes: selection.kind === 'node' ? [selection.id] : [],
            floats: selection.kind === 'float' ? [selection.id] : [],
            lines: selection.kind === 'line' ? [selection.id] : [],
            zones: selection.kind === 'zone' ? [selection.id] : [],
          }
        : EMPTY_PRESENCE_SELECTION;
    presence.setSelection(next);
  }, [selection, multiSelection, presence]);

  const measurer = useMemo(() => new CanvasTextMeasurer(), []);
  // 웹폰트(Pretendard) 로드가 끝나면 1 올라간다 — 폰트 로드 전에는 fallback
  // 글꼴 폭으로 노드 박스가 측정되므로, 로드 완료 시점에 sizeOf의 정체성을
  // 갈아 레이아웃 전체를 실제 글꼴 기준으로 재측정한다(새로고침 직후 박스가
  // 미세하게 어긋나던 원인).
  const [fontTick, setFontTick] = useState(0);
  const sizeOf: SizeOf = useCallback(
    (node, depth) => {
      const m = computeMetrics(node, depth, measurer);
      return { w: m.w, h: m.h };
    },
    [measurer, fontTick],
  );

  const laidOutNodes = useMemo(() => layout(doc, doc.layoutMode, sizeOf, { rootAnchor }), [doc, sizeOf, rootAnchor]);

  const vis = useMemo(() => buildVisible(laidOutNodes), [laidOutNodes]);


  const geom = useMemo<GeomMap>(() => {
    const out: GeomMap = {};
    vis.forEach(({ id, depth }) => {
      const n = laidOutNodes[id];
      if (!n) return;
      const m = computeMetrics(n, depth, measurer);
      const g: NodeGeom = { ...m, x: n.x, y: n.y, depth };
      // While this node is being edited, size the box to the live text (kept
      // centered on the same x/y) so it tracks the content instead of overflowing
      // a stale committed box. `editLiveSize` is computeMetrics of the current
      // editor content, so it matches exactly what commit will produce.
      // `tw` (the text-body width) must track too: clip shapes (pill/ellipse/
      // hexagon/diamond/parallelogram) size the editable region to `tw`, not the
      // inflated box `w`, so without this the box grows while the text area stays
      // fixed and the text wraps mid-edit (fine on commit, wrong while typing).
      if (id === editingNodeId && editLiveSize) {
        g.w = editLiveSize.w;
        g.h = editLiveSize.h;
        g.tw = editLiveSize.tw;
      }
      out[id] = g;
    });
    return out;
  }, [vis, laidOutNodes, measurer, editingNodeId, editLiveSize]);

  // Memo cards grow with their text (a `min-height` box), so their ACTUAL height
  // usually exceeds the stored `f.h`. Measure it (port of the original's `_floatH`)
  // so line-anchor snapping/ports, hit-testing and marquee use the real box, not a
  // fixed 44px one.
  const floatHeights = useMemo<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    doc.floats.forEach((f) => {
      out[f.id] = measureFloatHeight(f, measurer);
    });
    return out;
  }, [doc.floats, measurer]);

  const theme = themeOf(doc.themeKey);

  // ---- multi-selection groups — port of `Component#msel()` (MindFlow.dc.html:1548-1556):
  // falls back to the single `selection` when there's no active marquee group, so every
  // bulk-aware setter below (`nodeTargetIds`/`floatTargetIds`/`lineTargetIds`) behaves
  // identically to the pre-Editor-c single-select path when nothing is marquee-selected. ----
  const multiGroups = useMemo<MultiSelection>(() => {
    if (multiSelection) return multiSelection;
    return {
      nodes: selection?.kind === 'node' ? [selection.id] : [],
      lines: selection?.kind === 'line' ? [selection.id] : [],
      floats: selection?.kind === 'float' ? [selection.id] : [],
    };
  }, [multiSelection, selection]);
  const nodeTargetIds = useCallback((): string[] => multiGroups.nodes.filter((id) => doc.nodes[id]), [multiGroups, doc.nodes]);
  const floatTargetIds = useCallback((): string[] => multiGroups.floats.filter((id) => doc.floats.some((f) => f.id === id)), [multiGroups, doc.floats]);
  const lineTargetIds = useCallback((): string[] => multiGroups.lines.filter((l) => doc.lines.some((x) => x.id === l)), [multiGroups, doc.lines]);

  // ---- refs mirroring the latest state, used by handlers/effects that must
  // stay stable across renders (mount-once pointer listeners, useCallback'd
  // commitDoc) so they never read a stale closure ----
  const docRef = useRef(doc);
  useEffect(() => {
    docRef.current = doc;
  }, [doc]);

  // Record the opened map as "recently opened" the moment the editor loads it —
  // regardless of HOW it was opened (Home click, a direct link, a mobile tap, a
  // freshly created map). Recording used to happen ONLY on a Home card
  // double-click, so opens via any other path (common on mobile) never landed
  // in "최근 항목". Keyed by the DOC ID (this editor session's storage id — the
  // Home card's docId for doc-backed maps, `mapId(title)` for docId-less ones,
  // both of which Home's recent resolution matches), so same-titled maps in
  // different spaces each get their own entry and a rename can't orphan it.
  useEffect(() => {
    if (mapId) pushRecentEntry(mapId);
  }, [mapId]);
  const edgeStyleRef = useRef(edgeStyle);
  useEffect(() => {
    edgeStyleRef.current = edgeStyle;
  }, [edgeStyle]);
  const viewportRef = useRef(viewport);
  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);
  const geomRef = useRef(geom);
  useEffect(() => {
    geomRef.current = geom;
  }, [geom]);
  const floatHeightsRef = useRef(floatHeights);
  useEffect(() => {
    floatHeightsRef.current = floatHeights;
  }, [floatHeights]);
  // Measured memo height: `floatBoxH` for event handlers (reads the ref, as fresh
  // as the last commit — same contract as `geomRef`); `floatBoxHLive` for the
  // render-time anchor path (reads this render's memo directly). Both fall back to
  // the stored `f.h` if a measurement isn't ready yet.
  const floatBoxH = (f: Float): number => floatHeightsRef.current[f.id] ?? f.h ?? 44;
  const floatBoxHLive = (f: Float): number => floatHeights[f.id] ?? f.h ?? 44;
  // Ids of the free shapes to magnet clear of overlap once the current interaction
  // settles (set on text-commit / create / paste; consumed by the nudge effect).
  // 붙여넣기는 한 번에 여러 자유 도형을 만들 수 있어 목록이다 — 순서대로 처리하며
  // 뒤의 도형은 앞의 도형이 옮겨 간 자리를 본다(reflow 패스와 같은 규칙).
  // `nudgeTick` re-triggers that effect for interactions that don't otherwise
  // change `doc.nodes` on release.
  const pendingNudgeRef = useRef<string[] | null>(null);
  // Set when a tree STRUCTURAL change (e.g. a drag-reparent) re-lays out the
  // tree: every free shape must then be pushed clear of the new tree, since the
  // tree layout ignores free shapes (port of `applyFreeNudge`-over-all-frees,
  // MindFlow.dc.html:2155). Consumed by the reflow-nudge effect once geom settles.
  // `anchor`(있으면)는 **움직이지 않는 기준**이다 — 크기 조절 확정처럼 사용자가
  // 방금 자리·크기를 정한 도형은 그대로 두고 겹친 나머지가 밀려나야 한다(제보).
  // 남들이 다 비켜도 anchor가 여전히 겹치면(움직일 수 없는 트리와 겹침) 그때만
  // anchor 자신이 비켜난다.
  const pendingReflowNudgeRef = useRef<{ anchor?: string } | null>(null);
  const [nudgeTick, setNudgeTick] = useState(0);
  const multiSelectionRef = useRef(multiSelection);
  useEffect(() => {
    multiSelectionRef.current = multiSelection;
  }, [multiSelection]);
  // Synchronous mirror of the single selection — read by the touch drag/move-
  // handle logic (mobile object move) which must decide on `pointerdown`, before
  // a render flushes.
  const selectionRef = useRef(selection);
  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);

  // ---- line endpoint anchor magnets (a1/a2) — port of the `_geom`/float-box lookups
  // `Component#lineTargetBox`/`findSnap`/`resolveEnd` share (MindFlow.dc.html:2377-2454).
  //
  // Two box lookups, deliberately: `boxOfAnchor` (ref-based) is for EVENT HANDLERS
  // (hit-testing/marquee/curve-drag-start/line-end-drag-start below) — those run between
  // renders, once this render has already committed and its `geomRef.current`-syncing
  // effect has flushed, so the ref is exactly as fresh as `geom` itself there. `boxOfAnchorLive`
  // (this render's `geom`/`doc` closures, no ref) is for RENDER-TIME resolution — exposed on
  // the controller as `resolveLine`/`lineGeometry` for `LineLayer` to call WHILE rendering.
  // Using the ref there would be WRONG: `geomRef.current` only updates in a `useEffect` that
  // runs AFTER commit, so reading it during THIS render (e.g. right after a node/float move
  // just changed `geom`) would render one commit stale — an anchored line's magnet would lag
  // a frame behind the node it's supposedly following. ----

  /** Port of `Component#lineTargetBox` (MindFlow.dc.html:2377-2390) — event-handler version. */
  function boxOfAnchor(anchor: LineAnchor): Box | null {
    if (anchor.kind === 'node') {
      const g = geomRef.current[anchor.id];
      return g ? { cx: g.x, cy: g.y, hw: g.w / 2, hh: g.h / 2 } : null;
    }
    const f = docRef.current.floats.find((x) => x.id === anchor.id);
    if (!f) return null;
    const h = floatBoxH(f);
    return { cx: f.x + f.w / 2, cy: f.y + h / 2, hw: f.w / 2, hh: h / 2 };
  }

  /** Resolves a line's on-screen endpoints, following any anchor's live target box —
   * port of `Component#resolveLine` (MindFlow.dc.html:2414-2417) — event-handler version
   * (used at drag START, where the box only needs to be as fresh as the last commit). */
  function resolveLine(l: Line): { x1: number; y1: number; x2: number; y2: number } {
    return resolveLineEndpoints(l, boxOfAnchor);
  }

  /** Same as `boxOfAnchor`, but reads THIS render's `geom`/`doc` directly (no ref) — for the
   * render-time path (`lineGeometryLive`, exposed as `controller.lineGeometry`). */
  function boxOfAnchorLive(anchor: LineAnchor): Box | null {
    if (anchor.kind === 'node') {
      const g = geom[anchor.id];
      return g ? { cx: g.x, cy: g.y, hw: g.w / 2, hh: g.h / 2 } : null;
    }
    const f = doc.floats.find((x) => x.id === anchor.id);
    if (!f) return null;
    const h = floatBoxHLive(f);
    return { cx: f.x + f.w / 2, cy: f.y + h / 2, hw: f.w / 2, hh: h / 2 };
  }

  /** Render-time counterpart of `resolveLine` — exposed as `controller.resolveLine`. */
  function resolveLineLive(l: Line): { x1: number; y1: number; x2: number; y2: number } {
    return resolveLineEndpoints(l, boxOfAnchorLive);
  }

  /** The anchor-aware Bézier geometry for a line — feeds `resolveLineLive`'s resolved
   * endpoints into `resolveLineGeometry` alongside the line's curvature. Exposed as
   * `controller.lineGeometry`, what `LineLayer` actually draws every render. */
  function lineGeometryLive(l: Line) {
    return resolveLineGeometry({ ...l, ...resolveLineLive(l) });
  }

  /** Event-handler counterpart of `lineGeometryLive` — used by hit-testing/marquee/
   * curve-drag-start below, where reading through the ref is correct (see the block
   * comment above). */
  function lineGeometryOf(l: Line) {
    return resolveLineGeometry({ ...l, ...resolveLine(l) });
  }

  /** Every node/float box offered up as a line-endpoint snap target — port of
   * `Component#findSnap`'s candidate scan (MindFlow.dc.html:2451-2452). */
  function snapCandidates(): SnapCandidate[] {
    const out: SnapCandidate[] = [];
    const g = geomRef.current;
    for (const id in g) {
      const gg = g[id];
      if (gg) out.push({ kind: 'node', id, box: { cx: gg.x, cy: gg.y, hw: gg.w / 2, hh: gg.h / 2 } });
    }
    docRef.current.floats.forEach((f) => {
      const h = floatBoxH(f);
      out.push({ kind: 'float', id: f.id, box: { cx: f.x + f.w / 2, cy: f.y + h / 2, hw: f.w / 2, hh: h / 2 } });
    });
    return out;
  }

  /** The line-end drag's current snap target, for the port-indicator dots on the
   * hovered box — port of `Component#_snapHi` (MindFlow.dc.html:1733, 1390-1402). Only
   * ever non-null while a `line-end` drag is live. */
  const [lineSnap, setLineSnap] = useState<LineAnchor | null>(null);
  const lineSnapBox = lineSnap ? boxOfAnchorLive(lineSnap) : null;

  // ---- undo/redo history (@mindflow/mindmap-core HistoryStack) ----
  const historyRef = useRef<HistoryStack<Snapshot> | null>(null);
  if (historyRef.current === null) {
    historyRef.current = new HistoryStack<Snapshot>({ now: () => Date.now() });
  }
  const historyInitRef = useRef(false);
  useEffect(() => {
    if (historyInitRef.current) return;
    historyInitRef.current = true;
    historyRef.current!.reset({ nodes: doc.nodes, floats: doc.floats, lines: doc.lines, zones: doc.zones, layoutMode: doc.layoutMode, edgeStyle });
    // deliberately empty deps: only the initial (mount-time) doc/edgeStyle matter here
  }, []);

  /** Commits a doc mutation and records an undo/redo step when it actually changed
   * something — the React-hook counterpart of `Component#recordHistory`
   * (MindFlow.dc.html:551), driven explicitly per-action instead of a
   * `componentDidUpdate` diff (this hook has no equivalent lifecycle to diff against). */
  const commitDoc = useCallback((updater: (d: Doc) => Doc, continuous = false) => {
    if (readOnlyRef.current) return; // 보기 전용(#22) — 모든 문서 변이의 chokepoint
    // 공유 맵인데 실시간이 끊겼다 — 지금 만드는 편집은 상대 것과 갈라질 수 있고,
    // 병합에서 한쪽이 조용히 사라진다(core `crdt/divergence.test.ts`). 그래서 유예
    // 없이 즉시 막는다. 화면은 배너(짧은 끊김)나 전용 안내(오래 끊김)로 알린다.
    if (collabBlockedRef.current) return;
    setDoc((prev) => {
      const next = updater(prev);
      const changed =
        next.nodes !== prev.nodes || next.floats !== prev.floats || next.lines !== prev.lines || next.zones !== prev.zones || next.layoutMode !== prev.layoutMode;
      if (changed) {
        historyRef.current!.record(
          { nodes: next.nodes, floats: next.floats, lines: next.lines, zones: next.zones, layoutMode: next.layoutMode, edgeStyle: edgeStyleRef.current },
          continuous,
        );
        setHistoryTick((t) => t + 1);
      }
      return changed ? next : prev;
    });
  }, []);

  /**
   * 직전 커밋의 **일부**로 취급되는 정규화(겹침 밀어내기)를 반영한다 — 화면과
   * undo 기준점(`HistoryStack.amend`)을 함께 갱신하되 새 undo 단계는 만들지
   * 않는다. 예전엔 밀어내기를 plain `setDoc`(기록 없음)으로 적용했는데, 그러면
   * 다음 커밋이 **밀어내기 전**(겹친) 좌표를 기준점으로 스택에 밀어 넣어 undo가
   * 그 겹친 자리로 도형을 되돌렸다(제보 ③ — "undo 시 다른 좌표로 옮겨지며 겹침").
   */
  const amendDoc = useCallback((updater: (d: Doc) => Doc) => {
    if (readOnlyRef.current) return;
    setDoc((prev) => {
      const next = updater(prev);
      const changed =
        next.nodes !== prev.nodes || next.floats !== prev.floats || next.lines !== prev.lines || next.zones !== prev.zones || next.layoutMode !== prev.layoutMode;
      if (changed) {
        historyRef.current!.amend({ nodes: next.nodes, floats: next.floats, lines: next.lines, zones: next.zones, layoutMode: next.layoutMode, edgeStyle: edgeStyleRef.current });
      }
      return changed ? next : prev;
    });
  }, []);

  function applySnapshot(snap: Snapshot): void {
    setDoc((prev) => ({ ...prev, nodes: snap.nodes, floats: snap.floats, lines: snap.lines, zones: snap.zones, layoutMode: snap.layoutMode, edgeStyle: snap.edgeStyle }));
    setEdgeStyleState(snap.edgeStyle);
    setSelectionState(null);
    setMultiSelectionState(null);
    setOutlineEditId(null);
    setEditingNodeId(null);
    setEditingFloatId(null);
    setEditingLineId(null);
    setEditingZoneId(null);
    setEditingTitle(false);
    setTextCtx(null);
    setHistoryTick((t) => t + 1);
  }

  const undo = useCallback(() => {
    if (editingNodeId || editingFloatId || editingTitle) return; // native undo inside editors (matches original's guard)
    const snap = historyRef.current!.undo();
    if (snap) applySnapshot(snap);
  }, [editingNodeId, editingFloatId, editingTitle]);

  const redo = useCallback(() => {
    if (editingNodeId || editingFloatId || editingTitle) return;
    const snap = historyRef.current!.redo();
    if (snap) applySnapshot(snap);
  }, [editingNodeId, editingFloatId, editingTitle]);

  // ---- viewport sizing ----
  const viewportElRef = useRef<HTMLDivElement | null>(null);
  const setViewportEl = useCallback((el: HTMLDivElement | null) => {
    viewportElRef.current = el;
  }, []);

  useEffect(() => {
    const el = viewportElRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      setMeasured(true);
      setViewport((prev) => (prev.vw === w && prev.vh === h ? prev : { ...prev, vw: w || prev.vw, vh: h || prev.vh }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [viewportElRef.current]);

  /** Client (screen) coordinates → canvas (untransformed, pan/zoom-independent) coordinates —
   * port of `Component#toCanvas` (MindFlow.dc.html:1661). Shared by the marquee/pan background
   * drag and the object drag/reattach machinery below. */
  function toCanvasPoint(clientX: number, clientY: number, vp: ViewportState): { x: number; y: number } {
    const el = viewportElRef.current;
    const r = el ? el.getBoundingClientRect() : { left: 0, top: 0 };
    // Defensive: some event sources (e.g. a `PointerEvent`-less DOM implementation) can hand back
    // a non-finite `clientX`/`clientY` — never let that leak into rendered coordinates as `NaN`.
    const cx = Number.isFinite(clientX) ? clientX : 0;
    const cy = Number.isFinite(clientY) ? clientY : 0;
    return { x: (cx - r.left - vp.pan.x) / vp.zoom, y: (cy - r.top - vp.pan.y) / vp.zoom };
  }

  // ---- right-click context menu — port of `Component#onCtxMenu`/`openCtxAt`/`hitTestAll`
  // (MindFlow.dc.html:2775-2837). `pendingCtxRef`/`suppressCtxRef` replicate the original's
  // `_pendingCtx`/`_suppressCtx` fields: on macOS the browser's `contextmenu` event fires
  // at MOUSEDOWN (while a drag is still live), so opening has to be deferred to `pointerup`
  // and only actually happens if the pointer never moved (a right-click-drag = pan, so a
  // MOVED right-drag must not also pop the menu); elsewhere `contextmenu` fires at mouseup,
  // by which point the drag already ended, so `_suppressCtx` instead marks "a pan drag JUST
  // ended with movement" for a brief window so the menu doesn't reopen there either.
  // `objDragMovedRef` is this port's stand-in for the original's per-drag `d.moved` field on
  // `objDragRef`'s (node/float/zone/line/group) variants, which don't carry one of their own
  // (see `startObjDrag` below, next to `objDragRef`'s declaration). ----
  const pendingCtxRef = useRef<{ x: number; y: number } | null>(null);
  const suppressCtxRef = useRef(0);
  // Timestamp (ms) until which the next compatibility `click` after a touch
  // tap-select is swallowed — see the tap branch of `onUp` and the guard effect.
  const suppressGhostClickRef = useRef(0);
  const objDragMovedRef = useRef(false);

  /** Port of `Component#hitTestAll` (MindFlow.dc.html:2815-2836): what a canvas point lands
   * on, checked in the SAME priority order as the original (float > zone > line > node) —
   * this is a pure coordinate hit-test against the current doc/geometry, independent of
   * which DOM element the browser's `contextmenu` event actually targeted (matches the
   * original: a right-click doesn't even reach `onZoneDown`'s `e.button !== 0` guard, so
   * this is the ONLY way the menu learns what was clicked). */
  function hitTestAll(p: { x: number; y: number }): HitResult | null {
    const d = docRef.current;
    for (const f of d.floats) {
      const h = floatBoxH(f);
      if (p.x >= f.x && p.x <= f.x + f.w && p.y >= f.y && p.y <= f.y + h) return { kind: 'float', id: f.id };
    }
    for (const z of d.zones) {
      if (p.x >= z.x && p.x <= z.x + z.w && p.y >= z.y - 16 && p.y <= z.y + z.h) return { kind: 'zone', id: z.id };
    }
    for (const l of d.lines) {
      const geo = lineGeometryOf(l);
      for (let t = 0; t <= 1.0001; t += 0.04) {
        const bp = cubicAt(geo, t);
        if (Math.hypot(p.x - bp.x, p.y - bp.y) < 10) return { kind: 'line', id: l.id };
      }
    }
    const g = geomRef.current;
    for (const id in g) {
      const gg = g[id];
      if (!gg) continue;
      const pad = 4;
      if (p.x >= gg.x - gg.w / 2 - pad && p.x <= gg.x + gg.w / 2 + pad && p.y >= gg.y - gg.h / 2 - pad && p.y <= gg.y + gg.h / 2 + pad) return { kind: 'node', id };
    }
    return null;
  }

  /** Port of `Component#openCtxAt` (MindFlow.dc.html:2792-2813): hit-tests the right-clicked
   * canvas point, selects whatever it landed on (mirroring a plain click's selection-setting
   * side effect), and opens the matching menu `kind`. A right-click on an object that's already
   * part of an active multi-selection keeps the WHOLE group selected and opens the `'multi'`
   * menu instead (port of the `curM`/`inSel` check, MindFlow.dc.html:2797-2802). */
  function openCtxAt(clientX: number, clientY: number): void {
    // 보기 전용(#22): 메뉴 항목이 전부 변이(추가·삭제·정렬)라 열 것이 없다.
    if (readOnlyRef.current) return;
    // 다른 메뉴가 올라오면 서식 툴바는 내린다 — 편집 세션 동안 상시 노출로
    // 바뀐 뒤(아래 openTextCtx 주석), 두 팝업이 겹치지 않게 하는 유일한 규칙.
    setTextCtx(null);
    const vp = viewportRef.current;
    const p = toCanvasPoint(clientX, clientY, vp);
    const el = viewportElRef.current;
    const r = el ? el.getBoundingClientRect() : { left: 0, top: 0 };
    const sx = clientX - r.left;
    const sy = clientY - r.top;
    const hit = hitTestAll(p);
    const ms = multiSelectionRef.current;
    if (ms && totalSelected(ms) > 1 && hit) {
      const inSel = (hit.kind === 'node' && ms.nodes.includes(hit.id)) || (hit.kind === 'float' && ms.floats.includes(hit.id)) || (hit.kind === 'line' && ms.lines.includes(hit.id));
      if (inSel) {
        setCtxSub(null);
        setCtxMenu({ kind: 'multi', sx, sy, cx: p.x, cy: p.y });
        return;
      }
    }
    if (hit && hit.kind === 'node') {
      setSelectionState({ kind: 'node', id: hit.id });
      setMultiSelectionState(null);
      setEditingFloatId(null);
      setCtxSub(null);
      setCtxMenu({ kind: 'node', sx, sy, cx: p.x, cy: p.y });
    } else if (hit && hit.kind === 'float') {
      setSelectionState({ kind: 'float', id: hit.id });
      setMultiSelectionState(null);
      setCtxSub(null);
      setCtxMenu({ kind: 'float', sx, sy, cx: p.x, cy: p.y });
    } else if (hit && hit.kind === 'line') {
      setSelectionState({ kind: 'line', id: hit.id });
      setMultiSelectionState(null);
      setCtxSub(null);
      setCtxMenu({ kind: 'line', sx, sy, cx: p.x, cy: p.y });
    } else if (hit && hit.kind === 'zone') {
      setSelectionState({ kind: 'zone', id: hit.id });
      setMultiSelectionState(null);
      setEditingFloatId(null);
      setCtxSub(null);
      setCtxMenu({ kind: 'zone', sx, sy, cx: p.x, cy: p.y });
    } else {
      setCtxSub(null);
      setCtxMenu({ kind: 'bg', sx, sy, cx: p.x, cy: p.y });
    }
  }

  /**
   * 현재 선택에 해당하는 컨텍스트 메뉴를 지정한 화면 좌표에 연다 — 모바일
   * `MobileSelectBar`의 "더보기(⋯)"가 쓰는 진입점. 우클릭이 없는 터치에서도
   * 길게 누르기를 몰라도 전체 메뉴에 닿을 수 있게 한다. 히트 테스트 없이 이미
   * 잡혀 있는 선택을 그대로 쓴다는 점만 `openCtxAt`과 다르다.
   * `sx`/`sy`는 `.mf-ed-vp` 박스 기준(= 바가 쓰는 좌표계와 동일).
   */
  const openCtxMenuForSelection = useCallback((anchor: { x: number; top: number; bottom: number }) => {
    if (readOnlyRef.current) return; // 보기 전용(#22) — openCtxAt과 같은 이유
    setTextCtx(null); // 우클릭 메뉴와 동일 — 다른 메뉴가 뜨면 서식 툴바는 내린다
    const vp = viewportRef.current;
    const sx = anchor.x;
    const sy = anchor.bottom;
    const cx = (sx - vp.pan.x) / vp.zoom;
    const cy = (sy - vp.pan.y) / vp.zoom;
    const ms = multiSelectionRef.current;
    const s = selectionRef.current;
    setCtxSub(null);
    if (ms && totalSelected(ms) > 1) {
      setCtxMenu({ kind: 'multi', sx, sy, cx, cy, anchor });
      return;
    }
    setCtxMenu({ kind: s ? s.kind : 'bg', sx, sy, cx, cy, anchor });
  }, []);

  /** 편집 중인 박스(노드·메모) 위에 서식 툴바를 앉힐 뷰포트 기준 좌표.
   * `NodeEditBox`/`FloatEditBox`가 마운트에서 쓰는 계산과 같은 규칙이며,
   * 편집 중이 아니면 `null`(richElRef는 편집 박스가 살아 있는 동안만 채워진다). */
  const textCtxAnchor = useCallback((): TextCtxState | null => {
    const ed = richElRef.current;
    if (!ed || !ed.isConnected) return null;
    const box = ed.closest('[data-node-id],[data-float-id]') as HTMLElement | null;
    const vpEl = ed.closest('.mf-ed-vp');
    if (box && vpEl && typeof box.getBoundingClientRect === 'function' && typeof vpEl.getBoundingClientRect === 'function') {
      const br = box.getBoundingClientRect();
      const vr = vpEl.getBoundingClientRect();
      return { sx: br.left + br.width / 2 - vr.left, sy: br.top - vr.top };
    }
    return { sx: 0, sy: 60 }; // rect를 못 읽는 환경(jsdom) — 위치만 폴백
  }, []);

  /** 편집 대상이 화면에서 옮겨 간 뒤(키보드 회피 팬 등) 서식 툴바를 그 위로 다시
   * 붙인다. 팬은 상태 변경이라 DOM rect는 다음 페인트에 갱신되므로 rAF 뒤에 잰다. */
  const refreshTextCtxAnchor = useCallback(() => {
    const apply = (): void => {
      const a = textCtxAnchor();
      if (a) setTextCtx(a);
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(apply);
    else apply();
  }, [textCtxAnchor]);

  const closeCtxMenu = useCallback(() => {
    setCtxMenu(null);
    setCtxSub(null);
    // 편집 세션이 계속이면 서식 툴바를 되살린다 — 툴바는 편집 중 상시 노출이
    // 계약인데(NodeEditBox 마운트에서 열림), 우클릭 메뉴가 열리며 내려간 뒤
    // (openCtxAt의 setTextCtx(null)) 메뉴만 닫히면 편집은 그대로인데 툴바가
    // 돌아오지 않았다(제보).
    const a = textCtxAnchor();
    if (a) setTextCtx(a);
  }, [textCtxAnchor]);

  const toggleCtxSub = useCallback((top: number) => {
    setCtxSub((prev) => (prev ? null : { top }));
  }, []);

  /** Port of `Component#onCtxMenu` (MindFlow.dc.html:2775-2791), minus the rich-text-selection
   * `textCtx` branch (out of scope — see this file's top-of-module doc comment). */
  const onContextMenu = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    // 텍스트를 편집 중인 박스 안에서 온 요청은 **플랫폼에 맡긴다**(preventDefault도
    // 하지 않는다). 모바일에서 텍스트를 선택하는 제스처는 길게 누르기인데, 그게
    // 브라우저의 `contextmenu`로 올라와 캔버스 메뉴를 열어 버렸다 — 선택 바는
    // 사라지고(Editor.tsx: anchor 없는 메뉴는 바를 숨긴다) 메뉴 팝업만 남았다(제보).
    // 데스크톱에서도 텍스트 필드 위의 우클릭은 기기의 편집 메뉴(붙여넣기·맞춤법)가
    // 맞다 — 편집 중 서식은 상시 노출되는 서식 툴바가 이미 맡고 있다.
    const t = e.target as HTMLElement | null;
    if (t && typeof t.closest === 'function' && t.closest('.mf-richedit, input, textarea')) return;
    e.preventDefault();
    if (suppressCtxRef.current && Date.now() - suppressCtxRef.current < 300) {
      suppressCtxRef.current = 0;
      return;
    }
    if (dragRef.current || objDragRef.current) {
      pendingCtxRef.current = { x: e.clientX, y: e.clientY };
      return;
    }
    openCtxAt(e.clientX, e.clientY);
  }, []);

  // ---- presence: local pointer -> canvas coordinates -> throttled broadcast
  // (`usePresence.setCursor` does the actual throttling) — reuses the SAME
  // `toCanvasPoint` conversion as the marquee/drag machinery above, so a
  // remote cursor renders in exactly the space `PresenceLayer` (inside the
  // pan/zoom transform group) expects. ----
  const reportPointerPosition = useCallback(
    (clientX: number, clientY: number) => {
      presence.setCursor(toCanvasPoint(clientX, clientY, viewportRef.current));
    },
    [presence.setCursor],
  );
  const clearPointerPosition = useCallback(() => {
    presence.setCursor(null);
  }, [presence.setCursor]);

  // ---- fit-to-view (initial load + whenever a layout switch requests it) ----
  const pendingFitRef = useRef(true);
  const fitView = useCallback(() => {
    setViewport((prev) => {
      const ids = Object.keys(geom);
      if (!ids.length) return prev;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      ids.forEach((id) => {
        const g = geom[id];
        if (!g) return;
        minX = Math.min(minX, g.x - g.w / 2);
        maxX = Math.max(maxX, g.x + g.w / 2);
        minY = Math.min(minY, g.y - g.h / 2);
        maxY = Math.max(maxY, g.y + g.h / 2);
      });
      const bw = Math.max(1, maxX - minX);
      const bh = Math.max(1, maxY - minY);
      let z = Math.min((prev.vw - FIT_PADDING) / bw, (prev.vh - FIT_PADDING) / bh, 1.25);
      z = Math.max(MIN_ZOOM, z);
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      return { ...prev, zoom: z, pan: { x: prev.vw / 2 - cx * z, y: prev.vh / 2 - cy * z } };
    });
  }, [geom]);

  // Initial view (and re-view after a layout switch): center the ROOT node in
  // the viewport at a zoom that fits the whole map. The dc original + `fitView`
  // center the content's bounding-box midpoint, which for a one-sided layout
  // (right/down) leaves the root off to one edge; the product wants the top
  // shape front-and-center on entry, so we pan to the root specifically while
  // still scaling to fit everything. Falls back to the bbox center if the root
  // somehow isn't laid out.
  const centerOnRoot = useCallback(() => {
    setViewport((prev) => {
      const ids = Object.keys(geom);
      if (!ids.length) return prev;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      ids.forEach((id) => {
        const g = geom[id];
        if (!g) return;
        minX = Math.min(minX, g.x - g.w / 2);
        maxX = Math.max(maxX, g.x + g.w / 2);
        minY = Math.min(minY, g.y - g.h / 2);
        maxY = Math.max(maxY, g.y + g.h / 2);
      });
      const rootG = geom[ROOT_ID];
      const cx = rootG ? rootG.x : (minX + maxX) / 2;
      const cy = rootG ? rootG.y : (minY + maxY) / 2;
      // Zoom so the farthest content on either side of the root still fits when
      // the root is centered (half the viewport must cover the larger half-span
      // from the root), so nothing clips off an edge. Capped at 1.25×.
      const halfW = Math.max(cx - minX, maxX - cx, 1);
      const halfH = Math.max(cy - minY, maxY - cy, 1);
      let z = Math.min((prev.vw - FIT_PADDING) / (2 * halfW), (prev.vh - FIT_PADDING) / (2 * halfH), 1.25);
      z = Math.max(MIN_ZOOM, z);
      return { ...prev, zoom: z, pan: { x: prev.vw / 2 - cx * z, y: prev.vh / 2 - cy * z } };
    });
  }, [geom]);

  // 첫 센터링(fit)이 적용됐는지 — 커튼(CanvasCurtain) 해제 조건의 절반.
  // 레이아웃 이펙트인 이유: 센터링 pan/zoom이 "페인트 전에" 반영돼야
  // 좌상단(pan 0,0)에 그려졌다 중앙으로 점프하는 프레임이 없다.
  const [initialFitDone, setInitialFitDone] = useState(false);
  const initialFitDoneRef = useRef(false);
  useLayoutEffect(() => {
    if (!pendingFitRef.current) return;
    if (!measured) return; // wait for the real canvas size before the first center
    if (!Object.keys(geom).length) return;
    if (viewport.vw <= 0 || viewport.vh <= 0) return;
    pendingFitRef.current = false;
    centerOnRoot();
    initialFitDoneRef.current = true;
    setInitialFitDone(true);
  }, [geom, viewport.vw, viewport.vh, measured, centerOnRoot]);

  // 웹폰트 로드 정착 여부 — 커튼 해제 조건의 나머지 절반. 폰트가 로드되면
  // fontTick으로 전체 재측정하고, 아직 커튼이 내려가 있으면(공개 전) 재센터링
  // 까지 걸어 "정확한 글꼴 + 정중앙" 상태로 첫 공개가 되게 한다. 폰트가 오래
  // 걸려도 캔버스를 무한정 가리지 않도록 1초 상한.
  const [fontsSettled, setFontsSettled] = useState(false);
  useEffect(() => {
    let alive = true;
    const settle = (): void => {
      if (alive) setFontsSettled(true);
    };
    const fonts = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts;
    if (!fonts?.ready || typeof fonts.ready.then !== 'function') {
      settle(); // jsdom 등 FontFaceSet 미지원 환경
      return;
    }
    const cap = window.setTimeout(settle, 1000);
    void fonts.ready.then(() => {
      if (!alive) return;
      window.clearTimeout(cap);
      setFontTick((t) => t + 1);
      if (!initialFitDoneRef.current) pendingFitRef.current = true;
      settle();
    });
    return () => {
      alive = false;
      window.clearTimeout(cap);
    };
  }, []);

  // 캔버스 공개 준비 완료: 첫 fit이 페인트 전에 반영됐고, 폰트 측정이 정착했고,
  // 백엔드 하이드레이션도 끝난 상태. 이전에는 이 준비 과정이 그대로 보여서
  // 새로고침 때 좌상단 플래시→점프 깜빡임이 생겼다 — 이제 CanvasCurtain이
  // 준비될 때까지 캔버스를 가린다.
  const canvasReady = initialFitDone && fontsSettled && !hydrating;

  const setLayoutMode = useCallback(
    (mode: LayoutMode) => {
      pendingFitRef.current = true;
      commitDoc((prev) => (prev.layoutMode === mode ? prev : { ...prev, layoutMode: mode }));
    },
    [commitDoc],
  );

  const setEdgeStyle = useCallback((s: EdgeStyle) => {
    setEdgeStyleState(s);
    // Persist on the doc too (it's a serialized field now) so autosave picks it
    // up — `docSignature` includes `edgeStyle`, so this dirties the doc.
    setDoc((prev) => (prev.edgeStyle === s ? prev : { ...prev, edgeStyle: s }));
    const d = docRef.current;
    historyRef.current!.record({ nodes: d.nodes, floats: d.floats, lines: d.lines, zones: d.zones, layoutMode: d.layoutMode, edgeStyle: s }, false);
    setHistoryTick((t) => t + 1);
  }, []);

  const setThemeKey = useCallback((key: ThemeKey) => {
    // themeKey is intentionally NOT part of the undo snapshot (matches the
    // original's own asymmetry, MindFlow.dc.html:549) — plain state update.
    setDoc((prev) => (prev.themeKey === key ? prev : { ...prev, themeKey: key }));
  }, []);

  // ---- pan (background drag, right/middle button) + marquee (left button) + zoom (wheel / pinch)
  // — port of `Component#onBgDown` (MindFlow.dc.html:1650-1660): left-button background drag is a
  // rubber-band selection; right/middle-button drag pans (matches the bottom-left hint text). ----
  const dragRef = useRef<BgDrag | null>(null);
  const marqueeRectRef = useRef<MarqueeRect | null>(null);
  const pinchRef = useRef<{ dist: number; zoom: number; cx: number; cy: number } | null>(null);
  const activePointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  // Touch-only: on a phone, a one-finger press on an object records the object
  // here and lets the press bubble to the background pan handler instead of
  // selecting/dragging the object immediately. A drag then pans the canvas; a
  // no-move release (a tap) selects this object (see the pan branch of `onUp`).
  // This is why zoom/pan gestures that happen to start on an object no longer
  // grab it. Cleared at the end of every background gesture.
  const pendingTapRef = useRef<Selection | null>(null);
  // Touch long-press timer (see LONG_PRESS_MS): a stationary one-finger hold
  // opens the context menu like a desktop right-click.
  const longPressRef = useRef<{ timer: ReturnType<typeof setTimeout>; x0: number; y0: number } | null>(null);
  const cancelLongPress = (): void => {
    if (longPressRef.current) {
      clearTimeout(longPressRef.current.timer);
      longPressRef.current = null;
    }
  };

  const onBackgroundPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (activePointers.current.size === 2) {
      const pts = Array.from(activePointers.current.values());
      const [a, b] = pts;
      if (a && b) {
        const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        setViewport((prev) => {
          pinchRef.current = { dist, zoom: prev.zoom, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
          return prev;
        });
      }
      dragRef.current = null;
      marqueeRectRef.current = null;
      pendingTapRef.current = null; // a two-finger pinch is a zoom, not a tap-select
      cancelLongPress(); // …nor a long-press
      setMarquee(null);
      return;
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* not implemented in some environments (e.g. jsdom) — non-fatal */
    }
    // Middle/right-mouse OR a single-finger TOUCH drag pans. Touch has no
    // right-click and panning to navigate matters far more than rubber-band
    // selection on a phone, so a one-finger drag moves the canvas (two fingers
    // pinch-zoom, handled above); mouse keeps left=marquee / right·middle=pan.
    const isTouch = e.pointerType === 'touch';
    if (e.button === 1 || e.button === 2 || isTouch) {
      setViewport((prev) => {
        dragRef.current = { kind: 'pan', pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, startPan: prev.pan, moved: false, touch: isTouch };
        return prev;
      });
      if (isTouch) {
        // Arm the long-press: if the finger stays put for LONG_PRESS_MS, open
        // the context menu at the press point (right-click equivalent) and drop
        // the pending pan/tap so the finger-lift neither pans nor selects.
        const px = e.clientX;
        const py = e.clientY;
        cancelLongPress();
        const timer = setTimeout(() => {
          longPressRef.current = null;
          dragRef.current = null;
          pendingTapRef.current = null;
          // 짧은 진동으로 "지금 걸렸다"를 알린다 — 네이티브 길게 누르기의 감각이고,
          // 메뉴가 손가락 아래에서 뜨므로 시각만으로는 알아채기 늦다. iOS 사파리는
          // vibrate가 없어 조용히 넘어간다(기능 감지).
          try {
            navigator.vibrate?.(12);
          } catch {
            /* 지원하지 않는 기기 — 무시 */
          }
          openCtxAt(px, py);
        }, LONG_PRESS_MS);
        longPressRef.current = { timer, x0: px, y0: py };
      }
      return;
    }
    const vp = viewportRef.current;
    const p = toCanvasPoint(e.clientX, e.clientY, vp);
    dragRef.current = { kind: 'marquee', pointerId: e.pointerId, startClientX: e.clientX, startClientY: e.clientY, x0: p.x, y0: p.y, moved: false };
    marqueeRectRef.current = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    setMarquee(marqueeRectRef.current);
  }, []);

  useEffect(() => {
    function onMove(e: PointerEvent): void {
      if (activePointers.current.has(e.pointerId)) {
        activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }
      // moving past the tolerance turns the gesture into a pan → not a long-press
      if (longPressRef.current) {
        const lp = longPressRef.current;
        if (Math.hypot(e.clientX - lp.x0, e.clientY - lp.y0) > LONG_PRESS_MOVE_TOL) cancelLongPress();
      }
      if (activePointers.current.size === 2 && pinchRef.current) {
        const pts = Array.from(activePointers.current.values());
        const [a, b] = pts;
        if (!a || !b) return;
        const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const pinch = pinchRef.current;
        const nz = (pinch.zoom * dist) / pinch.dist;
        setViewport((prev) => zoomAtState(prev, nz, pinch.cx, pinch.cy));
        return;
      }
      const d = dragRef.current;
      if (!d || d.pointerId !== e.pointerId) return;
      if (d.kind === 'pan') {
        const dx = e.clientX - d.sx;
        const dy = e.clientY - d.sy;
        // port of `Component#onMove`'s pan branch's `if (Math.abs(dx)+Math.abs(dy)>3) d.moved = true`
        // (MindFlow.dc.html:1716) — gates whether a right-click-drag suppresses the context menu.
        if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
        setViewport((prev) => ({ ...prev, pan: { x: d.startPan.x + dx, y: d.startPan.y + dy } }));
        return;
      }
      // marquee
      d.moved = d.moved || Math.abs(e.clientX - d.startClientX) + Math.abs(e.clientY - d.startClientY) > 4;
      const p = toCanvasPoint(e.clientX, e.clientY, viewportRef.current);
      marqueeRectRef.current = { x0: d.x0, y0: d.y0, x1: p.x, y1: p.y };
      setMarquee(marqueeRectRef.current);
    }
    function onUp(e: PointerEvent): void {
      activePointers.current.delete(e.pointerId);
      if (activePointers.current.size < 2) pinchRef.current = null;
      cancelLongPress(); // a release before the hold elapsed is a tap, not a long-press
      const d = dragRef.current;
      if (!d || d.pointerId !== e.pointerId) return;
      dragRef.current = null;
      // deferred right-click menu (macOS fires `contextmenu` at mousedown, while `dragRef`/
      // `objDragRef` is still live): open now, but only if the pointer never moved — port of
      // `Component#onUp`'s generic `_pendingCtx`/`_suppressCtx` handling (MindFlow.dc.html:1778-1780).
      if (d.kind === 'pan' && d.moved) suppressCtxRef.current = Date.now();
      if (pendingCtxRef.current) {
        const pc = pendingCtxRef.current;
        pendingCtxRef.current = null;
        if (!d.moved) openCtxAt(pc.x, pc.y);
      }
      if (d.kind === 'pan') {
        // A no-move TOUCH tap selects on release (touch uses pan for one-finger
        // drag; a press that started on an object stashed it in `pendingTapRef`).
        // Tap on an object → select it; tap on empty background → deselect. A
        // press that MOVED was a pan gesture, so it selects nothing. Mouse
        // right/middle click keeps the original behavior (no deselect — it may
        // be opening the context menu).
        const tap = pendingTapRef.current;
        pendingTapRef.current = null;
        if (d.touch && !d.moved) {
          // Swallow the trailing compatibility mouse `click` the browser fires
          // after a touch tap: it lands at the tap point, which the freshly-
          // opened bottom-sheet property panel may now cover — otherwise it
          // "ghost-clicks" a panel control (e.g. auto-expands the first
          // section). See the capture-phase click guard below.
          suppressGhostClickRef.current = Date.now() + 500;
          if (tap) {
            setSelectionState(tap);
            setMultiSelectionState(null);
            setEditingNodeId(null);
            setEditingFloatId(null);
          } else {
            setSelectionState(null);
            setMultiSelectionState(null);
          }
        }
        return;
      }
      const mq = marqueeRectRef.current;
      marqueeRectRef.current = null;
      setMarquee(null);
      if (!d.moved || !mq) {
        setSelectionState(null);
        setMultiSelectionState(null);
        return;
      }
      const rx0 = Math.min(mq.x0, mq.x1);
      const rx1 = Math.max(mq.x0, mq.x1);
      const ry0 = Math.min(mq.y0, mq.y1);
      const ry1 = Math.max(mq.y0, mq.y1);
      const hit = (cx: number, cy: number, hw: number, hh: number): boolean => cx + hw >= rx0 && cx - hw <= rx1 && cy + hh >= ry0 && cy - hh <= ry1;
      const nodes: string[] = [];
      const g = geomRef.current;
      for (const id in g) {
        const gg = g[id];
        if (gg && hit(gg.x, gg.y, gg.w / 2, gg.h / 2)) nodes.push(id);
      }
      const floats: string[] = [];
      docRef.current.floats.forEach((f) => {
        const h = floatBoxH(f); // measured memo height (port of `_floatH`)
        if (hit(f.x + f.w / 2, f.y + h / 2, f.w / 2, h / 2)) floats.push(f.id);
      });
      const lines: string[] = [];
      docRef.current.lines.forEach((l) => {
        // sample the cubic bezier: select if ANY part of the line is inside the rect
        // (matches `Component#onUp`'s marquee branch, MindFlow.dc.html:1841-1851)
        const geo = lineGeometryOf(l);
        let hitLine = false;
        for (let t = 0; t <= 1.0001; t += 0.05) {
          const bp = cubicAt(geo, t);
          if (bp.x >= rx0 && bp.x <= rx1 && bp.y >= ry0 && bp.y <= ry1) {
            hitLine = true;
            break;
          }
        }
        if (hitLine) lines.push(l.id);
      });
      if (!nodes.length && !floats.length && !lines.length) {
        setSelectionState(null);
        setMultiSelectionState(null);
      } else {
        setSelectionState(null);
        setMultiSelectionState({ nodes, lines, floats });
        setEditingNodeId(null);
        setEditingFloatId(null);
      }
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      cancelLongPress();
    };
  }, []);

  // Ghost-click guard: after a touch tap-select (see `onUp`), the browser fires
  // one compatibility `click` at the tap point ~immediately. The property panel
  // that just opened (mobile bottom sheet) can sit under that point, so the
  // click would activate a panel control unintentionally. Swallow that single
  // click in the capture phase, once, within the short window.
  useEffect(() => {
    const onClickCapture = (e: MouseEvent): void => {
      if (suppressGhostClickRef.current && Date.now() < suppressGhostClickRef.current) {
        suppressGhostClickRef.current = 0;
        e.stopPropagation();
        e.preventDefault();
      }
    };
    window.addEventListener('click', onClickCapture, true);
    return () => window.removeEventListener('click', onClickCapture, true);
  }, []);

  // native (non-passive) wheel listener — mirrors `Component#onWheel`
  // (MindFlow.dc.html:1857-1876): ctrl/meta+wheel or pinch = zoom at cursor,
  // trackpad two-finger scroll = pan, plain wheel = zoom.
  useEffect(() => {
    const el = viewportElRef.current;
    if (!el) return;
    const handler = (e: WheelEvent): void => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * 0.011);
        setViewport((prev) => zoomAtState(prev, prev.zoom * factor, sx, sy));
        return;
      }
      const isTrackpad = e.deltaMode === 0 && (e.deltaX !== 0 || (Math.abs(e.deltaY) < 40 && !Number.isInteger(e.deltaY)) || Math.abs(e.deltaY) < 16);
      if (isTrackpad) {
        setViewport((prev) => ({ ...prev, pan: { x: prev.pan.x - e.deltaX, y: prev.pan.y - e.deltaY } }));
        return;
      }
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      setViewport((prev) => zoomAtState(prev, prev.zoom * factor, sx, sy));
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [viewportElRef.current]);

  const zoomIn = useCallback(() => {
    setViewport((prev) => zoomAtState(prev, prev.zoom * 1.2, prev.vw / 2, prev.vh / 2));
  }, []);
  const zoomOut = useCallback(() => {
    setViewport((prev) => zoomAtState(prev, prev.zoom / 1.2, prev.vw / 2, prev.vh / 2));
  }, []);

  // ---- save (manual + debounced autosave) — port of `saveDoc`/`scheduleAutoSave`/`saveNow`
  // (MindFlow.dc.html:537-543, 598-602), M4: routed through `DocStore.save()` with
  // `docVersionRef` as the optimistic-lock token instead of a raw `localStorage.setItem` ----
  const autosaveTimerRef = useRef<number | undefined>(undefined);
  const savingTimerRef = useRef<number | undefined>(undefined);

  /** Writes the current doc via `DocStore.save()`. On a version conflict (another
   * tab/device saved first), adopts the server's version as the new base — so the
   * NEXT save attempt targets the right row — and surfaces `saveConflict` so the UI
   * has a place to tell the user (`DocChip`'s banner); this is intentionally NOT a
   * full merge/reload flow (out of scope here, see CLAUDE.md's M4 task brief). */
  /**
   * 문서를 **새 id로 옮겨 저장**한다 — 원래 id가 다른 계정의 문서일 때의 복구 경로
   * (`DocStore.save`의 `idTaken`).
   *
   * 어쩌다 남의 id를 쓰게 되나: 옛 방식 카드는 `docId` 없이 `map=m<제목해시>`로 열린다
   * (`mapHref`의 폴백). 그래서 **다른 계정이 같은 제목**을 쓰면 id가 똑같아진다. 공유가
   * 해제됐는데 이 브라우저에 본문 캐시가 남은 경우도 같은 자리에 온다.
   *
   * 하는 일: 새 랜덤 id로 INSERT → 성공하면 이후 저장·로컬 캐시·협업 채널을 그 id로
   * 돌리고(`movedId`), 주소창도 바꿔(`?map=`) 새로고침해도 이어지게 하며, 홈 카드가
   * 옛 id를 계속 가리켜 같은 충돌을 되풀이하지 않도록 워크스페이스를 재바인딩한다
   * (`rebindMovedDoc`). 사용자 내용은 그대로 살아남는다.
   */
  const moveToFreshId = useCallback(
    async (title: string): Promise<void> => {
      const from = docStoreId;
      const to = newDocId();
      const res = await docStore.save(to, docRef.current, { title });
      if (!res.ok) {
        // 새 id마저 실패(네트워크 등) — dirty로 두고 다음 틱에 다시 시도한다.
        setSaveStateState('dirty');
        return;
      }
      docVersionRef.current = res.version;
      lastSavedSigRef.current = docSignature(docRef.current);
      setMovedId(to);
      try {
        saveDoc(to, docRef.current);
      } catch {
        /* storage unavailable — non-fatal */
      }
      // 주소창 교체(히스토리에 남기지 않는다 — 뒤로 가기가 죽은 id로 돌아가면 안 된다).
      const next = new URLSearchParams(window.location.search);
      next.set('map', to);
      next.delete('new');
      navigate({ pathname: '/editor', search: `?${next.toString()}` }, { replace: true });
      // 홈 카드 재바인딩 — 실패해도 저장 자체는 이미 성공했으므로 조용히 넘어간다.
      try {
        const ws = await spaceStore.load();
        if (ws) {
          const rebound = rebindMovedDoc({ spaces: ws.spaces as SpaceData[], mapFolders: ws.mapFolders, recent: ws.recent }, from, to);
          if (rebound !== ws) await spaceStore.save({ ...ws, ...rebound });
        }
      } catch {
        /* 워크스페이스 갱신 실패 — 다음 홈 방문에서 카드가 옛 id를 가리킬 뿐 */
      }
      setSaveConflict(null);
      setSaveStateState('saved');
      setMovedNotice(true);
    },
    [docStore, docStoreId, navigate, spaceStore],
  );
  /** `persistDoc`이 자신보다 먼저 선언돼야 해서 두는 렌더 동기 브리지. */
  const moveToFreshIdRef = useRef(moveToFreshId);
  moveToFreshIdRef.current = moveToFreshId;

  const persistDoc = useCallback(async (): Promise<void> => {
    // DATA-LOSS GUARD: refuse to write until the initial load resolved (see
    // `canPersistDocRef`). Prevents the empty mount seed from overwriting a real
    // backend doc while its `load()` is still in flight or has failed.
    if (!canPersistDocRef.current) return;
    // 보기 전용(#22): 변이 자체가 차단돼 저장할 것도 없지만, 판별 전의 짧은 창에서
    // 생긴 변경이 남의 문서에 쓰기를 시도하지 않도록 여기서도 막는다(RLS가 어차피
    // 거부하지만 42501 소음을 만들 이유가 없다).
    if (readOnlyRef.current) return;
    const title = safeDocTitle(docRef.current, titleParam);
    // 협업 중 충돌은 한 번 조용히 다시 쓴다(아래 conflict 분기 참고) — 그래서 루프다.
    for (let attempt = 0; attempt < 2; attempt++) {
    const result = await docStore.save(docStoreId, docRef.current, { prevVersion: docVersionRef.current, title });
    if (result.ok) {
      docVersionRef.current = result.version;
      lastSavedSigRef.current = docSignature(docRef.current);
      // Keep the local recovery copy in sync with every successful save.
      try {
        saveDoc(mapId, docRef.current);
        markDocPending(mapId, false); // 서버와 같아졌다 — 못 올린 편집 표시를 지운다
      } catch {
        /* storage unavailable — non-fatal */
      }
      // 버전 히스토리 스냅샷 — 저장이 **성공한** 본문만 기록한다(versionHistory.ts).
      try {
        recordVersion(docStoreId, docRef.current);
      } catch {
        /* 히스토리는 부가 기능 — 실패해도 저장 흐름을 막지 않는다 */
      }
      setSaveStateState('saved');
      setSaveConflict(null);
      return;
    } else if (result.reason === 'conflict') {
      docVersionRef.current = result.currentVersion;
      // **협업 중이면 경고가 아니다.** 같이 붙어 있는 사람이 있다는 건 내 문서가
      // 그 사람의 편집과 이미 CRDT로 수렴해 있다는 뜻이고, 충돌은 그저 "둘이 거의
      // 동시에 저장했다"는 사실이다. 새 버전을 기준으로 같은(수렴된) 내용을 한 번
      // 더 쓰고 조용히 넘어간다 — "다른 기기/탭에서 먼저 저장됨" 배너는 같은 세션의
      // 상대를 남의 기기로 오해하게 만든다(제보).
      //
      // **다만 그 전제는 실시간이 붙어 있을 때만 성립한다.** 채널이 끊긴 채 양쪽이
      // 편집하면 두 문서는 수렴하지 않고 갈라진다 — 그 상태에서 조용히 덮어쓰면
      // 상대의 편집이 경고도 없이 사라진다(질문으로 드러난 구멍). 끊겨 있으면
      // 충돌은 진짜 충돌이므로 덮어쓰지 않고 배너로 알린다.
      const live = collabStatusRef.current === 'connected' || collabStatusRef.current === 'connected-insecure';
      if (collabSessionRef.current && live && attempt === 0) continue;
      setSaveConflict({ currentVersion: result.currentVersion });
      setSaveStateState('saved');
      return;
    } else if (result.reason === 'idTaken') {
      // 그 id는 **다른 계정의 문서**다(RLS가 가려서 `load()`는 빈 결과였다).
      // 계속 그 id로 쓰면 남의 행을 건드리는 요청이 자동저장마다 반복된다 —
      // 새 id로 옮겨 우리 내용을 살린다(아래 `moveToFreshId`).
      await moveToFreshIdRef.current(title);
      return;
    } else {
      // 저장 실패(오프라인·일시 오류) — 이 기기에는 남긴다. 다음에 열 때 서버의 옛
      // 판에 덮이지 않도록 '아직 못 올림' 표시를 함께 남긴다(로드 분기의 `localPending`).
      try {
        saveDoc(mapId, docRef.current);
        markDocPending(mapId, true);
      } catch {
        /* storage unavailable — non-fatal */
      }
      setSaveStateState('dirty'); // keep dirty so the next autosave/Ctrl+S tick retries
      return;
    }
    }
  }, [docStore, docStoreId, titleParam, mapId]);

  /** 다시 온라인이 되면 못 올린 편집을 바로 올린다 — 편집을 멈춘 채 연결이 돌아오면
   * 다음 자동저장 계기(=다음 편집)가 없어 영영 대기 상태로 남았다. */
  useEffect(() => {
    const onOnline = (): void => {
      if (!canPersistDocRef.current || readOnlyRef.current) return;
      const sig = docSignature(docRef.current);
      if (sig === lastSavedSigRef.current) return; // 올릴 게 없다
      if (sig === remoteSigRef.current) return; // 상대가 만든 상태 — 그쪽이 저장한다(#320)
      setSaveStateState('saving');
      void persistDoc();
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [persistDoc]);
  // Render-synced bridge for the initial-load effect's brand-new seed save
  // (declared up there, before this callback exists).
  persistDocRef.current = persistDoc;

  useEffect(() => {
    const sig = docSignature(doc);
    if (sig === lastSavedSigRef.current) return;
    // 상대가 만든 상태는 **상대가** 저장한다(`remoteSigRef`). 내 화면의 저장 표시도
    // 건드리지 않는다 — 내가 저장할 게 아니므로 "저장 안 됨"으로 보일 이유가 없다.
    // 내가 손을 대면 서명이 달라져 곧바로 아래 정상 경로를 탄다.
    if (sig === remoteSigRef.current) return;
    setSaveStateState('dirty');
    window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = window.setTimeout(() => {
      setSaveStateState('saving');
      window.clearTimeout(savingTimerRef.current);
      savingTimerRef.current = window.setTimeout(() => {
        void persistDoc();
      }, 250);
    }, 900);
    return () => window.clearTimeout(autosaveTimerRef.current);
  }, [doc, persistDoc]);

  /**
   * 공유 맵 + 실시간 끊김이 유예를 넘기면 **전체 안내**로 승격한다(붙는 즉시 푼다).
   *
   * 멈추기 직전에 지금 문서를 **이 기기의 버전 기록에 강제로 남긴다** — 새로고침하면
   * 서버 판(상대가 저장한 것일 수 있다)으로 돌아가므로, 끊긴 동안 쓴 내용을 되찾을
   * 길을 남겨 두는 것이다(안내 문구가 그 경로를 알려 준다).
   */
  useEffect(() => {
    if (!collabBlocked) {
      setCollabPaused(false);
      return;
    }
    const t = window.setTimeout(() => {
      try {
        recordVersion(docStoreId, docRef.current, { force: true });
      } catch {
        /* 기록은 부가 — 실패해도 멈춤 자체는 해야 한다 */
      }
      setCollabPaused(true);
    }, COLLAB_PAUSE_AFTER_MS);
    return () => window.clearTimeout(t);
  }, [collabBlocked, docStoreId]);

  /**
   * **옛 문서 이전**: 본문에 인라인된 이미지를 별도 저장소로 옮기고 그 자리를
   * 참조로 바꾼다(core `replaceImageValues`).
   *
   * 왜 여는 김에 하는가: 이미 만들어 둔 맵들이 이 변경의 이득(저장량·실시간 전송량)을
   * 하나도 못 받기 때문이다. 한 번 열면 그 뒤로는 가볍다.
   *
   * 안전장치 — 실패해도 문서는 온전하다(올라간 것만 참조로 바뀌고 나머지는 인라인
   * 그대로). 보기 전용은 하지 않고(남의 문서를 고칠 수 없다), 문서당 한 번만 시도한다.
   * 두 사람이 동시에 열어 각자 올리면 CRDT가 한쪽 참조를 고르고 다른 실물은 남는다 —
   * 화면은 정상이고 남은 파일은 문서를 영구 삭제할 때 함께 지워진다.
   */
  const imageMigratedRef = useRef('');
  useEffect(() => {
    if (hydrating || readOnly || !docStoreId) return;
    if (imageMigratedRef.current === docStoreId) return;
    const inline = collectInlineImages(docRef.current);
    if (!inline.length) return;
    imageMigratedRef.current = docStoreId;
    void (async () => {
      const byDataUrl: Record<string, string> = {};
      for (const item of inline) {
        if (byDataUrl[item.dataUrl]) continue; // 같은 이미지가 여러 곳에 붙어 있을 수 있다
        const blob = dataUrlToBlob(item.dataUrl);
        if (!blob) continue;
        const ref = await imageStore.upload(docStoreId, blob, blob.type.includes('png') ? 'png' : 'jpg');
        if (ref) byDataUrl[item.dataUrl] = ref;
      }
      if (!Object.keys(byDataUrl).length) return; // 저장소가 없거나(로컬 모드) 전부 실패
      commitDoc((d) => replaceImageValues(d, byDataUrl));
    })();
  }, [hydrating, readOnly, docStoreId, imageStore, commitDoc]);

  // 다른 문서로 넘어가면 협업 세션 기억을 지운다 — 이 맵에서 함께 편집한 적이 없다면
  // 충돌은 다시 "다른 기기/탭이 먼저 저장"으로 읽어야 한다.
  useEffect(() => {
    collabSessionRef.current = false;
    remoteSigRef.current = null;
  }, [docStoreId]);

  /**
   * 마지막 상대가 떠났을 때, 아직 저장되지 않은 **상대의 편집**을 내가 인수해 저장한다.
   *
   * 평소엔 편집한 쪽이 0.9초 뒤 저장하므로 여기서 할 일이 없다(서명이 같아 그냥
   * 지나간다). 상대가 저장 전에 창을 닫거나 네트워크가 끊긴 채 사라진 경우에만
   * 실제로 쓴다 — 그 내용이 아무 곳에도 남지 않는 것을 막는 안전망이다.
   */
  const prevPeerCountRef = useRef(0);
  useEffect(() => {
    const had = prevPeerCountRef.current;
    prevPeerCountRef.current = peerCount;
    if (peerCount > 0 || had === 0) return;
    if (docSignature(docRef.current) === lastSavedSigRef.current) return;
    setSaveStateState('saving');
    void persistDoc();
  }, [peerCount, persistDoc]);

  const saveNow = useCallback(() => {
    window.clearTimeout(autosaveTimerRef.current);
    window.clearTimeout(savingTimerRef.current);
    setSaveStateState('saving');
    savingTimerRef.current = window.setTimeout(() => {
      void persistDoc();
    }, 200);
  }, [persistDoc]);

  /**
   * **닫기·전환 직전 강제 저장.** 자동저장은 0.9초 뒤에 도는데, 그 사이에 탭을 닫으면
   * 마지막 편집이 아무 곳에도 남지 않았다(단독 사용도 마찬가지 — 협업 수리(#320)의
   * 남은 한계로 적어 뒀던 것).
   *
   * 두 신호를 쓴다:
   * - `visibilitychange`(hidden): 탭 전환·최소화·닫기 시작 시점. **페이지가 아직
   *   살아 있어** 평범한 네트워크 저장이 끝까지 간다 — 실제 저장은 여기서 일어난다.
   * - `pagehide`: 마지막 순간. 네트워크 요청은 끊길 수 있으므로 **동기 localStorage
   *   복구본**을 먼저 남기고(항상 성공한다) 서버 저장도 한 번 던진다.
   *
   * 상대가 만든 상태(`remoteSigRef`)는 여기서도 저장하지 않는다 — 저장은 편집한
   * 쪽 책임이고(#320), 탭 전환마다 남의 편집을 내 이름으로 저장하면 카드의 수정자가
   * 틀린다.
   */
  const flushOnHide = useCallback(() => {
    if (!canPersistDocRef.current || readOnlyRef.current) return;
    const sig = docSignature(docRef.current);
    if (sig === lastSavedSigRef.current) return; // 저장할 게 없다
    if (sig === remoteSigRef.current) return; // 상대가 만든 상태 — 그쪽이 저장한다
    // 예약된 자동저장은 취소한다(같은 내용을 두 번 쓰지 않게).
    window.clearTimeout(autosaveTimerRef.current);
    window.clearTimeout(savingTimerRef.current);
    try {
      saveDoc(mapId, docRef.current); // 동기 — 네트워크가 끊겨도 이 기기엔 남는다
    } catch {
      /* storage unavailable — non-fatal */
    }
    void persistDoc();
  }, [persistDoc, mapId]);

  useEffect(() => {
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') flushOnHide();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flushOnHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flushOnHide);
    };
  }, [flushOnHide]);

  /** 버전 기록의 스냅샷을 현재 문서로 복원한다(`versionHistory.ts`). undo 가능한
   * 커밋이고, 복원 직전의 현재 상태를 **강제 스냅샷**으로 먼저 남겨 돌아올 길을
   * 보장한다. 이후 자동저장이 복원본을 저장한다. */
  const restoreVersion = useCallback(
    (at: number): boolean => {
      const snap = versionDoc(docStoreId, at);
      if (!snap) return false;
      try {
        recordVersion(docStoreId, docRef.current, { force: true });
      } catch {
        /* 부가 기능 — 복원 자체는 계속 */
      }
      commitDoc(() => snap);
      setHistoryOpen(false);
      return true;
    },
    [docStoreId, commitDoc],
  );

  /**
   * **곧 페이지가 리로드될 때**(새 버전 적용 — `pwa/updateGate`) 호출하는 정리 훅.
   * 대기 중인 자동저장을 즉시 flush 하고 "리로드해도 안전한가"를 돌려준다.
   *
   * `false`면 호출자가 리로드를 멈춘다. 저장이 실패했거나(오프라인·충돌) 초기
   * 로드가 아직/영영 끝나지 않아 `persistDoc`이 no-op인 상태라면 — 지금 리로드하는
   * 순간 편집분이 백엔드에도 로컬 복구본에도 남지 않기 때문이다(로컬 복구본은
   * 저장 성공 시에만 갱신된다, `persistDoc` 참고).
   */
  const flushSave = useCallback(async (): Promise<boolean> => {
    window.clearTimeout(autosaveTimerRef.current);
    window.clearTimeout(savingTimerRef.current);
    // 이미 저장된 내용 그대로면 쓰기 없이 통과 — 리로드마다 불필요한 백엔드 쓰기를 만들지 않는다.
    if (docSignature(docRef.current) === lastSavedSigRef.current) return true;
    // goHome과 같은 이유로 초기 로드를 먼저 기다린다(그 전에는 persistDoc이 no-op).
    await initialLoadRef.current;
    await persistDoc();
    return canPersistDocRef.current && docSignature(docRef.current) === lastSavedSigRef.current;
  }, [persistDoc]);

  const dismissSaveConflict = useCallback(() => setSaveConflict(null), []);
  const dismissMovedNotice = useCallback(() => setMovedNotice(false), []);
  const dismissImageNotice = useCallback(() => setImageNotice(null), []);

  const goHome = useCallback(() => {
    window.clearTimeout(autosaveTimerRef.current);
    window.clearTimeout(savingTimerRef.current);
    // Persist AFTER the initial load resolves — `persistDoc` no-ops until then
    // (`canPersistDocRef`), so awaiting the load both prevents the empty seed
    // from overwriting the backend AND doesn't drop a last-second edit made
    // while the load was still in flight. Navigation isn't blocked on it.
    void initialLoadRef.current.then(() => persistDoc());
    navigate('/home');
  }, [navigate, persistDoc]);

  // ---- selection ----
  const selectNode = useCallback((id: string) => {
    setSelectionState({ kind: 'node', id });
    setMultiSelectionState(null);
  }, []);
  const selectFloat = useCallback((id: string) => {
    setSelectionState({ kind: 'float', id });
    setMultiSelectionState(null);
  }, []);
  const selectLine = useCallback((id: string) => {
    setSelectionState({ kind: 'line', id });
    setMultiSelectionState(null);
  }, []);
  const selectZone = useCallback((id: string) => {
    setSelectionState({ kind: 'zone', id });
    setMultiSelectionState(null);
  }, []);
  /** Clears BOTH the single selection and any active marquee multi-selection — the
   * React-hook counterpart of `Component#clearAllSel` (MindFlow.dc.html:1581), also used
   * for the plain Escape/background-click "deselect everything" gesture. */
  const clearSelection = useCallback(() => {
    setSelectionState(null);
    setMultiSelectionState(null);
  }, []);

  // ---- arrow-key node navigation — port of `Component#navigate`/`#selectAndReveal`
  // (MindFlow.dc.html:2058-2094). `selectAndReveal` selects a node and pans it into
  // view when it lands off-screen (80px margin); `navigateNodes` picks the nearest
  // node in the pressed direction via the original's directional-cone scoring. ----
  const selectAndReveal = useCallback(
    (id: string) => {
      selectNode(id);
      const g = geomRef.current[id];
      if (!g) return;
      setViewport((prev) => {
        const sx = g.x * prev.zoom + prev.pan.x;
        const sy = g.y * prev.zoom + prev.pan.y;
        const m = 80;
        let nx = prev.pan.x;
        let ny = prev.pan.y;
        let need = false;
        if (sx < m) {
          nx = prev.pan.x + (m - sx);
          need = true;
        } else if (sx > prev.vw - m) {
          nx = prev.pan.x - (sx - (prev.vw - m));
          need = true;
        }
        if (sy < m) {
          ny = prev.pan.y + (m - sy);
          need = true;
        } else if (sy > prev.vh - m) {
          ny = prev.pan.y - (sy - (prev.vh - m));
          need = true;
        }
        return need ? { ...prev, pan: { x: nx, y: ny } } : prev;
      });
    },
    [selectNode],
  );
  const navigateNodes = useCallback(
    (fromId: string | null, dir: 'up' | 'down' | 'left' | 'right') => {
      const g = geomRef.current;
      const ids = Object.keys(g);
      if (!ids.length) return;
      // no current node selection → land on root (matches the dc original)
      if (!fromId || !g[fromId]) {
        const target = g[ROOT_ID] ? ROOT_ID : ids[0];
        if (target) selectAndReveal(target);
        return;
      }
      // Pick the nearest node in the pressed direction, measured relative to the
      // SELECTED node (see `nearestInDirection` for the tightened directional cone
      // that keeps a diagonal sibling from stealing an axis-aligned move).
      const best = nearestInDirection(g, fromId, dir);
      if (best) selectAndReveal(best);
    },
    [selectAndReveal],
  );

  const isKind = (kind: SelectionKind): string | null => (selection && selection.kind === kind ? selection.id : null);

  // ---- text editing ----
  const startEditNode = useCallback((id: string) => {
    setSelectionState({ kind: 'node', id });
    setMultiSelectionState(null);
    if (readOnlyRef.current) return; // 보기 전용 — 선택까지만, 편집 세션은 열지 않는다
    setEditingNodeId(id);
    setEditLiveSize(null);
    setTextCtx(null);
  }, []);
  /** Re-measure the node being edited from its live `contentEditable` content and
   * store the result so the box tracks the text as the user types (WYSIWYG). Runs
   * on every input in `NodeEditBox`; uses the same `computeMetrics` the commit/layout
   * path uses, so the editing box size matches the committed size exactly. */
  const updateNodeEditSize = useCallback(
    (id: string, el: HTMLElement | null) => {
      if (!el) return;
      const base = docRef.current.nodes[id];
      if (!base) return;
      const depth = geomRef.current[id]?.depth ?? (id === ROOT_ID ? 0 : 1);
      // `keepTrailing` — 끝에 만든 빈 줄도 세어야 **줄바꿈하는 순간** 도형이 커진다
      // (제보: 줄을 바꿔도 다음 글자를 칠 때에야 커졌다). 편집 박스는 빈 마지막 줄에
      // placeholder `<br>`를 하나 더 두므로, 하나를 접는 이 모드가 곧 실제 값이다.
      const parsed = domToRuns(el, true);
      const liveNode: Node = { ...base, text: parsed.text, rich: parsed.rich };
      // `emptyAsIs` — 편집 중 빈 박스가 플레이스홀더('주제') 폭으로 부풀지 않게.
      const m = computeMetrics(liveNode, depth, measurer, { emptyAsIs: true });
      setEditLiveSize((prev) => (prev && prev.w === m.w && prev.h === m.h && prev.tw === m.tw ? prev : { w: m.w, h: m.h, tw: m.tw }));
    },
    [measurer],
  );
  const commitNodeText = useCallback(
    (id: string, text: string) => {
      commitDoc((d) => ({ ...d, nodes: mutations.commitNodeText(d.nodes, id, text) }));
      setEditingNodeId(null);
    },
    [commitDoc],
  );
  /** Port of `Component#commitRichEdit` (MindFlow.dc.html:2629-2643) — reads the live
   * `contentEditable` DOM (`el`) via `domToRuns` and commits BOTH `text` and `rich`
   * in one `commitDoc` step. `el` is `null` when the box unmounted out from under the
   * commit (matches the original's own `if (!el) { ...; return; }` guard). */
  const commitNodeRichText = useCallback(
    (id: string, el: HTMLElement | null) => {
      if (!el) {
        setEditingNodeId(null);
        setEditLiveSize(null);
        setTextCtx(null);
        return;
      }
      const parsed = domToRuns(el);
      // 마크다운 단축 문법(**굵게**, *기울임*, ~~취소선~~)을 커밋 시 서식으로 변환.
      // 편집 중에는 마커가 그대로 보이고(예측 가능), 확정하는 순간 정리된다.
      const md = applyMarkdownShortcuts(parsed);
      // 타이핑한 URL을 링크로 — 마크다운 단축 문법과 같은 자리(커밋 시 한 번).
      // 편집 중 실시간으로 걸면 반쯤 친 주소가 링크가 됐다 풀렸다 하며 캐럿·IME가 흔들린다.
      const base = md ?? parsed;
      const finalText = applyAutoLinks(base) ?? base;
      commitDoc((d) => ({ ...d, nodes: mutations.commitNodeRichText(d.nodes, id, finalText.text, finalText.rich) }));
      setEditingNodeId(null);
      setEditLiveSize(null);
      setTextCtx(null);
      // 커진 박스가 이웃과 겹칠 수 있다 — 자유 도형은 자기가 비켜나고(단일 마그넷),
      // **트리 노드**는 움직일 수 없으니 개별(자유) 도형들이 밀려난다(리플로우 —
      // 자식 추가 직후의 이름 확정이 바로 이 경로다).
      if (docRef.current.nodes[id]?.parent) {
        pendingReflowNudgeRef.current = {};
        setNudgeTick((t) => t + 1);
      } else {
        pendingNudgeRef.current = [id];
      }
    },
    [commitDoc],
  );
  const cancelNodeEdit = useCallback(() => {
    setEditingNodeId(null);
    setEditLiveSize(null);
    setTextCtx(null);
  }, []);

  // ---- floating partial-style toolbar ----
  const openTextCtx = useCallback((sx: number, sy: number) => setTextCtx({ sx, sy }), []);
  const closeTextCtx = useCallback(() => setTextCtx(null), []);
  /** Port of `Component#applyPartial` (MindFlow.dc.html:2701-2725) — DOM-only (see the
   * interface doc comment above): reads the registered rich editor's CURRENT Selection
   * + DOM content (not `doc.nodes[id].rich`, which is stale mid-edit — the box's
   * `contentEditable` innerHTML is only ever seeded once, on mount, same as the original's
   * `data-init` guard), applies the style via `@mindflow/mindmap-core`'s `applyPartialStyle`,
   * rewrites the innerHTML, and restores the selection so consecutive style clicks on the
   * same span keep working. */
  /** 편집 중인 노드의 텍스트 정렬 — 리스트 행을 그 정렬대로 놓기 위해 필요하다.
   * 편집 박스는 노드 박스(`data-node-id`) 안에 있으므로 DOM에서 되짚는다. */
  const editedNodeAlign = useCallback((ed: HTMLElement): 'left' | 'center' | 'right' => {
    // 메모(플로트) 편집 박스는 항상 좌측 정렬이다(커밋 렌더와 동일).
    if (ed.closest('[data-float-id]')) return 'left';
    const id = (ed.closest('[data-node-id]') as HTMLElement | null)?.dataset.nodeId;
    const n = id ? docRef.current.nodes[id] : undefined;
    // `nodeTextAlign`으로 **렌더와 같은 기본값**을 쓴다 — 날것의 `n.align`을 쓰면
    // 정렬을 지정하지 않은 노드에서 undefined(=좌측)가 되어, 들여쓰기 직후
    // 리스트 묶음만 왼쪽으로 튀었다(제보).
    return n ? nodeTextAlign(n) : 'center';
  }, []);

  /** 편집 박스의 현재 선택을 **적용 대상 범위**로 — 선택이 없으면(캐럿만) 전체.
   * 툴바가 편집 세션 동안 상시 노출되므로, 선택 없이 누른 버튼이 아무 일도 안
   * 하면 죽은 것처럼 보인다(B/I/S와 같은 규칙). */
  const selectionRange = useCallback((): { a: number; b: number } | null => {
    const ed = richElRef.current;
    if (!ed) return null;
    const ws = window.getSelection();
    if (!ws || !ws.rangeCount) return null;
    const rng = ws.getRangeAt(0);
    // 선택이 편집 박스 **밖**이면(예: 링크 주소 입력창에 포커스) 범위가 없다 —
    // 밖의 컨테이너를 `linearize`에 넣으면 엉뚱한 오프셋이 나온다.
    if (!ed.contains(rng.startContainer) || !ed.contains(rng.endContainer)) return null;
    const lin = linearize(ed, [
      { container: rng.startContainer, offset: rng.startOffset },
      { container: rng.endContainer, offset: rng.endOffset },
    ]);
    // `liveEditValue` — 오프셋(linearize)과 값의 좌표계를 맞춘다(placeholder `<br>` 한 칸).
    const v = liveEditValue(ed);
    const a0 = v.clamp(Math.min(lin.pos[0] ?? 0, lin.pos[1] ?? 0));
    const b0 = v.clamp(Math.max(lin.pos[0] ?? 0, lin.pos[1] ?? 0));
    if (a0 !== b0) return { a: a0, b: b0 };
    return v.text.length ? { a: 0, b: v.text.length } : null;
  }, []);

  /** 지정한 범위에 부분 서식을 적용한다. 링크 입력처럼 **선택이 잠시 사라지는**
   * UI는 열 때 범위를 잡아 두고 이 함수로 적용한다. */
  const applyPartialRange = useCallback((a: number, b: number, kind: 'b' | 'i' | 's' | 'c' | 'link' | 'clear', val?: string | null) => {
    const ed = richElRef.current;
    if (!ed || a === b) return;
    // 값도 같은 규칙으로 읽는다 — 아니면 끝에 만들어 둔 빈 줄이 서식 한 번에 사라진다.
    const parsed = liveEditValue(ed);
    const next = applyPartialStyle(parsed, a, b, kind, val ?? null);
    // 리스트 줄이 있으면 편집 중 구조([마커|내용] 행)를 유지한 채 다시 그린다 —
    // 평범한 `runsToHtml`만 쓰면 서식 한 번 적용에 리스트 모양이 풀려 버린다.
    renderListEdit(ed, next, editedNodeAlign(ed), Math.min(a, b), Math.max(a, b));
  }, []);

  const applyPartial = useCallback(
    (kind: 'b' | 'i' | 's' | 'c' | 'link' | 'clear', val?: string | null) => {
      const r = selectionRange();
      if (r) applyPartialRange(r.a, r.b, kind, val);
    },
    [selectionRange, applyPartialRange],
  );

  /** 지금 선택(또는 캐럿 앞뒤)에 걸린 링크 주소 — 없거나 섞여 있으면 `null`.
   * 링크 입력창의 초기값과 "링크 제거" 노출 판단에 쓴다. */
  const selectionLink = useCallback((): string | null => {
    const ed = richElRef.current;
    if (!ed) return null;
    const ws = window.getSelection();
    if (!ws || !ws.rangeCount) return null;
    const rng = ws.getRangeAt(0);
    const lin = linearize(ed, [
      { container: rng.startContainer, offset: rng.startOffset },
      { container: rng.endContainer, offset: rng.endOffset },
    ]);
    const v = liveEditValue(ed);
    const a = v.clamp(Math.min(lin.pos[0] ?? 0, lin.pos[1] ?? 0));
    const b = v.clamp(Math.max(lin.pos[0] ?? 0, lin.pos[1] ?? 0));
    const chars = runsToChars(v);
    if (a === b) return (chars[a - 1]?.href || chars[a]?.href || null) ?? null;
    const seg = chars.slice(a, b);
    const first = seg[0]?.href || null;
    return first && seg.every((c) => (c.href || null) === first) ? first : null;
  }, []);

  /** 링크 주소 입력창이 열려 있는 동안은 편집 박스의 blur 커밋을 멈춘다 —
   * 입력창으로 포커스가 넘어가는 순간 편집이 끝나 버리면 링크를 걸 수가 없다. */
  const blurCommitPausedRef = useRef(false);
  const pauseBlurCommit = useCallback((paused: boolean) => {
    blurCommitPausedRef.current = paused;
  }, []);
  const isBlurCommitPaused = useCallback(() => blurCommitPausedRef.current, []);

  /**
   * 줄 단위 리스트 연산(글머리·번호 토글, 들여쓰기·내어쓰기) — 툴바 버튼과
   * Tab/Shift+Tab이 함께 쓴다. 규칙은 코어 `applyListOp`가 단일 소스이고, 여기선
   * 그 편집 목록을 **char-model에 그대로 splice** 해 부분 서식(rich 런)을 보존한
   * 뒤 리스트 구조로 다시 그린다(`applyPartial`과 같은 재료).
   */
  /** 편집 박스의 현재 선택 범위를 읽어 `make`가 만든 편집을 char-model에 적용하고
   * 다시 그린다 — 리스트 연산(`applyListOp`)과 마커 안 Backspace(`applyListEdits`)의
   * 공용 몸통. 편집은 char-model에 splice하므로 부분 서식이 보존된다. */
  const withEditorSelection = useCallback((make: (text: string, a: number, b: number) => TextEdit[]) => {
    const ed = richElRef.current;
    if (!ed) return;
    // 값과 오프셋은 **같은 좌표계**여야 한다(`liveEditValue` — 편집 박스의
    // placeholder `<br>` 하나만큼 `linearize`가 더 세는 것을 값 길이로 자른다).
    const live = liveEditValue(ed);
    // 지금 선택이 편집 박스 **안**이면 그것이 정본. 밖이거나(툴바를 탭한 손가락이
    // 선택을 옮겼다) 낡은 Range면 편집 중 기록해 둔 마지막 캐럿으로 되돌아간다 —
    // 그것마저 없으면 아무것도 하지 않는다(엉뚱한 줄을 고치느니 무동작이 낫다).
    const ws = window.getSelection();
    const rng = ws && ws.rangeCount ? ws.getRangeAt(0) : null;
    const inBox = !!rng && ed.contains(rng.startContainer) && ed.contains(rng.endContainer);
    let a: number;
    let b: number;
    if (inBox && rng) {
      const lin = linearize(ed, [
        { container: rng.startContainer, offset: rng.startOffset },
        { container: rng.endContainer, offset: rng.endOffset },
      ]);
      a = live.clamp(Math.min(lin.pos[0] ?? 0, lin.pos[1] ?? 0));
      b = live.clamp(Math.max(lin.pos[0] ?? 0, lin.pos[1] ?? 0));
    } else {
      const remembered = lastEditSelRef.current;
      if (!remembered) return;
      a = live.clamp(remembered.a);
      b = live.clamp(remembered.b);
    }
    const parsed = { text: live.text, rich: live.rich };
    const edits = make(parsed.text, a, b);
    if (!edits.length) return;
    const chars = runsToChars(parsed);
    // 뒤에서부터 적용해야 앞 편집의 인덱스가 밀리지 않는다. 삽입 글자는 무서식
    // (마커·들여쓰기는 늘 평문 — 커밋 후 렌더도 마커를 평문으로 그린다).
    [...edits]
      .sort((x, y) => y.at - x.at)
      .forEach((e) => chars.splice(e.at, e.remove, ...Array.from(e.insert).map((ch) => ({ ch, b: false, c: null }))));
    const runs = charsToRuns(chars).filter((r) => r.t);
    const next = { text: chars.map((c) => c.ch).join(''), rich: isStyledRuns(runs) ? runs : null };
    renderListEdit(ed, next, editedNodeAlign(ed), shiftOffset(a, edits), shiftOffset(b, edits));
  }, []);

  const applyListOp = useCallback(
    (op: ListOp) => withEditorSelection((text, a, b) => applyListOpToText(text, a, b, op)),
    [withEditorSelection],
  );

  /** 마커 안 Backspace가 만든 편집(빈 항목 통째 삭제)을 그대로 적용한다. */
  const applyListEdits = useCallback((edits: TextEdit[]) => withEditorSelection(() => edits), [withEditorSelection]);

  const startEditFloat = useCallback((id: string) => {
    setSelectionState({ kind: 'float', id });
    setMultiSelectionState(null);
    if (readOnlyRef.current) return; // 보기 전용 — 선택까지만
    // 이미지 플로트에는 편집할 텍스트가 없다 — 더블클릭/F2는 선택까지만.
    if (docRef.current.floats.find((f) => f.id === id)?.img) return;
    setEditingFloatId(id);
  }, []);
  const commitFloatText = useCallback(
    (id: string, text: string) => {
      commitDoc((d) => ({ ...d, floats: mutations.updateFloatItem(d.floats, id, { text }) }));
      setEditingFloatId(null);
    },
    [commitDoc],
  );
  /** 메모 rich 커밋 — `commitNodeRichText`와 같은 훅(마크다운 단축 → URL 자동 링크)
   * 을 태우고 `text`+`rich`를 함께 저장한다. 평문이면 `rich`는 `null`. */
  const commitFloatRichText = useCallback(
    (id: string, el: HTMLElement | null) => {
      setTextCtx(null);
      if (!el) {
        setEditingFloatId(null);
        return;
      }
      const parsed = domToRuns(el);
      const md = applyMarkdownShortcuts(parsed);
      const base = md ?? parsed;
      const finalText = applyAutoLinks(base) ?? base;
      commitDoc((d) => ({ ...d, floats: mutations.updateFloatItem(d.floats, id, { text: finalText.text, rich: finalText.rich }) }));
      setEditingFloatId(null);
    },
    [commitDoc],
  );
  const cancelFloatEdit = useCallback(() => {
    setEditingFloatId(null);
    setTextCtx(null);
  }, []);

  const startEditLineLabel = useCallback((id: string) => {
    setSelectionState({ kind: 'line', id });
    setMultiSelectionState(null);
    if (readOnlyRef.current) return; // 보기 전용 — 선택까지만
    setEditingLineId(id);
  }, []);
  const commitLineLabel = useCallback(
    (id: string, text: string) => {
      commitDoc((d) => ({ ...d, lines: mutations.updateLineItem(d.lines, id, { label: (text || '').slice(0, 20) }) }));
      setEditingLineId(null);
    },
    [commitDoc],
  );
  const cancelLineLabelEdit = useCallback(() => setEditingLineId(null), []);

  const startEditZoneLabel = useCallback((id: string) => {
    setSelectionState({ kind: 'zone', id });
    setMultiSelectionState(null);
    if (readOnlyRef.current) return; // 보기 전용 — 선택까지만
    setEditingZoneId(id);
  }, []);
  const commitZoneLabel = useCallback(
    (id: string, text: string) => {
      commitDoc((d) => ({ ...d, zones: mutations.updateZoneItem(d.zones, id, { label: String(text || '').slice(0, 24) }) }));
      setEditingZoneId(null);
    },
    [commitDoc],
  );
  const cancelZoneLabelEdit = useCallback(() => setEditingZoneId(null), []);

  const startEditTitle = useCallback(() => {
    if (readOnlyRef.current) return; // 보기 전용 — 제목도 문서의 일부다
    setEditingTitle(true);
  }, []);
  // Duplicate names are fully allowed (XMind-style) — identity is the doc id,
  // so a rename never needs to check other maps' titles. (An unchanged/empty
  // edit falls through to `commitRootTitle`, which restores the fallback when
  // text is blank.)
  const commitTitle = useCallback(
    (text: string) => {
      commitDoc((d) => ({ ...d, nodes: mutations.commitRootTitle(d.nodes, text, titleParam) }));
      setEditingTitle(false);
    },
    [commitDoc, titleParam],
  );
  const cancelTitleEdit = useCallback(() => setEditingTitle(false), []);

  // ---- structural ----
  const addChild = useCallback(() => {
    const id = isKind('node');
    if (!id || readOnlyRef.current) return; // 보기 전용: commitDoc이 no-op이라 새 id가 생기지 않는다 — 유령 편집 세션 방지
    const newId = idFactory('x');
    commitDoc((d) => ({ ...d, nodes: mutations.addChildNode(d.nodes, id, newId) }));
    setSelectionState({ kind: 'node', id: newId });
    setEditingNodeId(newId);
    // 새 자식으로 트리가 커지며 개별(자유) 도형 위에 얹힐 수 있다(제보) — 리파런트/
    // 노드 붙여넣기와 같은 리플로우 밀어내기. 편집 세션이 열려 있는 동안은 effect가
    // 대기했다가 이름 확정(편집 종료) 후 최종 크기로 민다.
    pendingReflowNudgeRef.current = {};
    setNudgeTick((t) => t + 1);
  }, [selection, commitDoc]);

  const addSibling = useCallback(() => {
    const id = isKind('node');
    if (!id || readOnlyRef.current) return; // addChild와 같은 이유
    const newId = idFactory('x');
    commitDoc((d) => {
      const next = mutations.addSiblingNode(d.nodes, id, newId);
      if (next) return { ...d, nodes: next };
      return { ...d, nodes: mutations.addChildNode(d.nodes, ROOT_ID, newId) };
    });
    setSelectionState({ kind: 'node', id: newId });
    setEditingNodeId(newId);
    pendingReflowNudgeRef.current = {}; // addChild와 같은 이유
    setNudgeTick((t) => t + 1);
  }, [selection, commitDoc]);

  const deleteSelection = useCallback(() => {
    // multi-select bulk delete — port of `Component#deleteMulti` (MindFlow.dc.html:1595-1610):
    // every targeted node's subtree + every targeted line/float, in one undo step.
    if (multiSelection && totalSelected(multiSelection) > 1) {
      const ms = multiSelection;
      commitDoc((d) => ({
        ...d,
        nodes: mutations.deleteNodesMulti(d.nodes, ms.nodes),
        lines: d.lines.filter((l) => !ms.lines.includes(l.id)),
        floats: d.floats.filter((f) => !ms.floats.includes(f.id)),
      }));
      setMultiSelectionState(null);
      setSelectionState(null);
      setEditingNodeId(null);
      setEditingFloatId(null);
      return;
    }
    if (!selection) return;
    if (selection.kind === 'node') {
      if (selection.id === ROOT_ID) return;
      const id = selection.id;
      commitDoc((d) => {
        const res = mutations.deleteNodeSubtree(d.nodes, id);
        if (!res) return d;
        setSelectionState({ kind: 'node', id: res.nextSelected });
        return { ...d, nodes: res.nodes };
      });
      setEditingNodeId(null);
    } else if (selection.kind === 'float') {
      commitDoc((d) => ({ ...d, floats: mutations.removeFloatItem(d.floats, selection.id) }));
      setSelectionState(null);
      setEditingFloatId(null);
    } else if (selection.kind === 'line') {
      commitDoc((d) => ({ ...d, lines: mutations.removeLineItem(d.lines, selection.id) }));
      setSelectionState(null);
    } else if (selection.kind === 'zone') {
      commitDoc((d) => ({ ...d, zones: mutations.removeZoneItem(d.zones, selection.id) }));
      setSelectionState(null);
      setEditingZoneId(null);
    }
  }, [selection, multiSelection, commitDoc]);

  // ---- 복사 / 잘라내기 / 붙여넣기 ----
  // 클립보드 내용은 세션 메모리(ref)에 — 자세한 근거는 `clipboard.ts` 상단 참고.
  // 담긴 개수만 state로 따로 들고 있다: 메뉴의 '붙여넣기' 노출 여부는 렌더에
  // 반영돼야 하는데, ref 값 변화는 리렌더를 일으키지 않기 때문이다.
  const clipboardRef = useRef<ClipboardPayload | null>(null);
  const [clipboardSize, setClipboardSize] = useState(0);

  const copySelection = useCallback(() => {
    const clip = collectClipboard(docRef.current, selectionRef.current, multiSelectionRef.current);
    if (!clip) return false; // 복사할 게 없으면(루트만 선택 등) 기존 클립보드를 지우지 않는다
    clipboardRef.current = clip;
    setClipboardSize(clipboardCount(clip));
    return true;
  }, []);

  /** 잘라내기 = 복사 + 즉시 원본 삭제(캔버스 편집기 관례 — 붙여넣기 시점이 아니라 지금). */
  const cutSelection = useCallback(() => {
    if (!copySelection()) return;
    deleteSelection();
  }, [copySelection, deleteSelection]);

  const pasteClipboardAt = useCallback(
    (at?: { x: number; y: number }) => {
      const clip = clipboardRef.current;
      if (!clip) return;
      // 대상: 명시된 좌표 > 선택된 노드(자식으로) > 뷰포트 중앙
      let target: PasteTarget;
      if (at) {
        target = { kind: 'point', ...at };
      } else if (selectionRef.current?.kind === 'node') {
        target = { kind: 'node', id: selectionRef.current.id };
      } else {
        const vp = viewportRef.current;
        target = { kind: 'point', x: (vp.vw / 2 - vp.pan.x) / vp.zoom, y: (vp.vh / 2 - vp.pan.y) / vp.zoom };
      }
      // 결과는 updater **밖**에서 계산한다. 예전엔 updater 안에서 res를 채우고
      // "동기 실행"을 믿었는데, React의 즉시 평가(eager evaluation)는 같은
      // 핸들러에서 앞선 setState(컨텍스트 메뉴 닫기 등)가 큐를 채우면 **건너뛴다**
      // — 그 경로에서 붙여넣기는 되는데 선택·후처리가 통째로 빠졌다(잠복 버그,
      // 겹침 마그넷을 붙이다 발견). docRef는 이 시점의 최신 문서다.
      if (readOnlyRef.current) return;
      const out = pasteClipboard(docRef.current, clip, target, idFactory);
      if (!out) return;
      commitDoc(() => out.doc);
      setSelectionState(out.selection);
      setMultiSelectionState(out.multi);
      setEditingNodeId(null);
      setEditingFloatId(null);
      // 붙여넣은 **자유 도형**은 겹치지 않는 자리로 마그넷(제보 — 원본에서 24px만
      // 어긋난 채 겹쳐 보였다). 노드의 자식으로 붙은 경우는 레이아웃이 자리를
      // 정하므로 해당 없음(아래 필터의 `!parent`가 거른다). 메모/선/영역은 원래
      // 자유 겹침 허용이라 그대로(도형-도형만 자동 정리 — overlap.ts 상단 규칙).
      const pastedIds = out.multi ? out.multi.nodes : out.selection?.kind === 'node' ? [out.selection.id] : [];
      // `docRef`는 커밋 렌더 후에야 갱신되므로, updater가 돌려준 새 문서에서 읽는다.
      const freeRoots = pastedIds.filter((id) => {
        const n = out.doc.nodes[id];
        return !!n && !n.parent;
      });
      if (freeRoots.length) pendingNudgeRef.current = freeRoots;
      // 노드의 **자식으로** 붙은 경우: 트리가 새 자식 주위로 재배치되며 자유 도형
      // 위에 얹힐 수 있다(제보 ① — 리파런트/디태치와 같은 상황). 리플로우 패스로
      // 자유 도형들을 새 트리에서 밀어낸다.
      if (pastedIds.some((id) => !!out.doc.nodes[id]?.parent)) {
        pendingReflowNudgeRef.current = {};
        setNudgeTick((t) => t + 1);
      }
    },
    [commitDoc, idFactory],
  );

  const toggleCollapse = useCallback(
    (id: string) => {
      commitDoc((d) => ({ ...d, nodes: mutations.toggleCollapseNode(d.nodes, id) }));
    },
    [commitDoc],
  );

  const addFreeNodeAt = useCallback(
    (at?: { x: number; y: number }) => {
      // an explicit `at` (the bg context menu's "도형 추가") lands EXACTLY there, no stagger —
      // port of `Component#addFreeNode`'s `px != null` branch (MindFlow.dc.html:2122-2128).
      let cx: number;
      let cy: number;
      if (at) {
        cx = at.x;
        cy = at.y;
      } else {
        const vp = viewportRef.current;
        const stagger = (Object.keys(docRef.current.nodes).length % 6) * 20;
        cx = (vp.vw / 2 - vp.pan.x) / vp.zoom + stagger;
        cy = (vp.vh / 2 - vp.pan.y) / vp.zoom - 130 + stagger;
      }
      const newId = idFactory('x');
      commitDoc((d) => ({ ...d, nodes: mutations.addFreeShapeNode(d.nodes, newId, cx, cy) }));
      setSelectionState({ kind: 'node', id: newId });
      setMultiSelectionState(null);
      setEditingNodeId(newId);
      // separate it from any shape it was staggered on top of, once its edit ends
      pendingNudgeRef.current = [newId];
    },
    [commitDoc, idFactory],
  );

  const addFloatAt = useCallback(
    (at?: { x: number; y: number }) => {
      // port of `Component#addFloat`'s `px != null` branch (MindFlow.dc.html:2253-2258): an
      // explicit spot is used as-is (no `-90/+150` viewport-center offset, no stagger).
      let cx: number;
      let cy: number;
      if (at) {
        cx = at.x;
        cy = at.y;
      } else {
        const vp = viewportRef.current;
        const stagger = (docRef.current.floats.length % 6) * 22;
        cx = (vp.vw / 2 - vp.pan.x) / vp.zoom - 90 + stagger;
        cy = (vp.vh / 2 - vp.pan.y) / vp.zoom + 150 + stagger;
      }
      const newId = idFactory('f');
      commitDoc((d) => ({ ...d, floats: mutations.addFloatItem(d.floats, newId, cx, cy) }));
      setSelectionState({ kind: 'float', id: newId });
      setMultiSelectionState(null);
      setEditingFloatId(newId);
    },
    [commitDoc, idFactory],
  );

  /**
   * 별도 저장소를 **쓸 수 있는 모드인데도** 참조가 아니라 데이터 URL이 나왔다면
   * 업로드가 실패한 것이다(용량 초과·권한·네트워크). 예전엔 그대로 본문에 인라인하고
   * 조용히 넘어갔는데, 그러면 실시간 메시지 크기 사고(#335)와 DB 팽창이 되살아나는
   * 데다 **아무도 그 사실을 모른다.** 한 번 알린다.
   *
   * 로컬/데모 모드는 인라인이 정상이라 알리지 않는다.
   */
  const noteIfInlined = useCallback(
    (src: string) => {
      if (backendMode !== 'supabase') return;
      if (isImageRef(src)) return;
      setImageNotice('이미지를 저장소에 올리지 못해 맵 본문에 담았어요 — 잠시 뒤 다시 첨부해 주세요');
    },
    [backendMode],
  );

  /** 이미지 파일 → (리사이즈/재인코딩) → 이미지 플로트 커밋. `at`은 캔버스 좌표의
   * 원하는 중심점(드롭 위치/컨텍스트 메뉴 클릭점); 없으면 뷰포트 중앙. */
  const addImageFloatFromFile = useCallback(
    async (file: File | Blob, at?: { x: number; y: number }) => {
      const attached = await attachImageFile(file, imageUploadRef.current);
      if (!attached) return; // 이미지가 아니거나 디코드 실패 — 조용히 무시
      noteIfInlined(attached.src);
      const { w, h } = defaultFloatSize(attached.natW, attached.natH);
      let cx: number;
      let cy: number;
      if (at) {
        cx = at.x - w / 2;
        cy = at.y - h / 2;
      } else {
        const vp = viewportRef.current;
        cx = (vp.vw / 2 - vp.pan.x) / vp.zoom - w / 2;
        cy = (vp.vh / 2 - vp.pan.y) / vp.zoom - h / 2;
      }
      const newId = idFactory('f');
      commitDoc((d) => ({ ...d, floats: mutations.addImageFloatItem(d.floats, newId, Math.round(cx), Math.round(cy), attached.src, w, h) }));
      setSelectionState({ kind: 'float', id: newId });
      setMultiSelectionState(null);
    },
    [commitDoc, idFactory],
  );

  const promptAddImage = useCallback(
    (at?: { x: number; y: number }) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = () => {
        const f = input.files?.[0];
        if (f) void addImageFloatFromFile(f, at);
      };
      input.click();
    },
    [addImageFloatFromFile],
  );

  /** 노드 썸네일: 표시 크기는 긴 변 180px로 비율 고정 (metrics가 박스를 키움). */
  const attachNodeImageFromFile = useCallback(
    async (id: string, file: File | Blob) => {
      const attached = await attachImageFile(file, imageUploadRef.current);
      if (!attached) return;
      noteIfInlined(attached.src);
      const disp = fitWithin(attached.natW, attached.natH, 180);
      commitDoc((d) => ({ ...d, nodes: mutations.setNodeImage(d.nodes, id, attached.src, disp.w, disp.h) }));
    },
    [commitDoc],
  );

  const promptNodeImage = useCallback(
    (id: string) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = () => {
        const f = input.files?.[0];
        if (f) void attachNodeImageFromFile(id, f);
      };
      input.click();
    },
    [attachNodeImageFromFile],
  );

  const clearNodeImage = useCallback(
    (id: string) => {
      commitDoc((d) => ({ ...d, nodes: mutations.clearNodeImage(d.nodes, id) }));
    },
    [commitDoc],
  );

  // 클립보드 이미지 붙여넣기 → 뷰포트 중앙에 이미지 플로트. 텍스트 입력 중
  // (노드/메모 편집, 검색창 등)의 붙여넣기는 그대로 통과시킨다.
  useEffect(() => {
    const isTextEntry = (t: EventTarget | null): boolean => {
      const el = t as HTMLElement | null;
      return !!el?.closest?.('input, textarea, [contenteditable="true"], [contenteditable=""]');
    };
    const onPaste = (e: ClipboardEvent) => {
      if (isTextEntry(e.target)) return;
      const file = firstImageFile(e.clipboardData);
      if (!file) return;
      e.preventDefault();
      void addImageFloatFromFile(file);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [addImageFloatFromFile]);

  // 파일 드래그앤드롭 → 드롭한 캔버스 지점에 이미지 플로트.
  useEffect(() => {
    const el = viewportElRef.current;
    if (!el) return;
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      const file = firstImageFile(e.dataTransfer);
      if (!file) return;
      e.preventDefault();
      void addImageFloatFromFile(file, toCanvasPoint(e.clientX, e.clientY, viewportRef.current));
    };
    el.addEventListener('dragover', onDragOver);
    el.addEventListener('drop', onDrop);
    return () => {
      el.removeEventListener('dragover', onDragOver);
      el.removeEventListener('drop', onDrop);
    };
  }, [addImageFloatFromFile, viewportElRef.current]);

  const addLineAt = useCallback(
    (at?: { x: number; y: number }) => {
      // port of `Component#addLine`'s `px != null` branch (MindFlow.dc.html:2455-2459): the
      // `off` stagger is skipped entirely when an explicit spot is given.
      let cx: number;
      let cy: number;
      let off = 0;
      if (at) {
        cx = at.x;
        cy = at.y;
      } else {
        const vp = viewportRef.current;
        cx = (vp.vw / 2 - vp.pan.x) / vp.zoom;
        cy = (vp.vh / 2 - vp.pan.y) / vp.zoom;
        off = (docRef.current.lines.length % 5) * 22;
      }
      const newId = idFactory('l');
      commitDoc((d) => ({ ...d, lines: mutations.addLineItem(d.lines, newId, cx - 90, cy + off, cx + 90, cy + off) }));
      setSelectionState({ kind: 'line', id: newId });
      setMultiSelectionState(null);
    },
    [commitDoc, idFactory],
  );

  const addZoneAt = useCallback(
    (at?: { x: number; y: number }) => {
      // port of `Component#addZone`'s `px != null` branch (MindFlow.dc.html:2296-2298): an
      // explicit spot is used as-is (no `-170/-110` viewport-center offset).
      let cx: number;
      let cy: number;
      if (at) {
        cx = at.x;
        cy = at.y;
      } else {
        const vp = viewportRef.current;
        cx = (vp.vw / 2 - vp.pan.x) / vp.zoom - 170;
        cy = (vp.vh / 2 - vp.pan.y) / vp.zoom - 110;
      }
      const newId = idFactory('z');
      commitDoc((d) => ({ ...d, zones: mutations.addZoneItem(d.zones, newId, cx, cy) }));
      setSelectionState({ kind: 'zone', id: newId });
      setMultiSelectionState(null);
    },
    [commitDoc, idFactory],
  );

  // ---- node property setters — bulk-aware (port of `nodeTargets()`-driven setters,
  // MindFlow.dc.html:2545-2555, 2730-2731): with a single node selected, `nodeTargetIds()`
  // is just `[selection.id]`, so this is behavior-identical to the pre-Editor-c single-select
  // path; with a marquee multi-selection active, the same setter applies to every target. ----
  const setShape = useCallback((shape: string) => commitDoc((d) => ({ ...d, nodes: mutations.setNodesField(d.nodes, nodeTargetIds(), 'shape', shape) })), [nodeTargetIds, commitDoc]);
  const setColor = useCallback((hex: string | null) => commitDoc((d) => ({ ...d, nodes: mutations.setNodesField(d.nodes, nodeTargetIds(), 'color', hex) })), [nodeTargetIds, commitDoc]);
  const setFill = useCallback((hex: string | null) => commitDoc((d) => ({ ...d, nodes: mutations.setNodesField(d.nodes, nodeTargetIds(), 'fill', hex) })), [nodeTargetIds, commitDoc]);
  const setStroke = useCallback((hex: string | null) => commitDoc((d) => ({ ...d, nodes: mutations.setNodesField(d.nodes, nodeTargetIds(), 'stroke', hex) })), [nodeTargetIds, commitDoc]);
  const setFillAlpha = useCallback((a: number) => commitDoc((d) => ({ ...d, nodes: mutations.setNodesField(d.nodes, nodeTargetIds(), 'fillA', a) }), true), [nodeTargetIds, commitDoc]);
  const setStrokeAlpha = useCallback((a: number) => commitDoc((d) => ({ ...d, nodes: mutations.setNodesField(d.nodes, nodeTargetIds(), 'strokeA', a) }), true), [nodeTargetIds, commitDoc]);
  const setTextColor = useCallback((hex: string | null) => commitDoc((d) => ({ ...d, nodes: mutations.setNodesField(d.nodes, nodeTargetIds(), 'textColor', hex) })), [nodeTargetIds, commitDoc]);
  const toggleNodeBold = useCallback(() => commitDoc((d) => ({ ...d, nodes: mutations.toggleNodesBold(d.nodes, nodeTargetIds()) })), [nodeTargetIds, commitDoc]);
  const toggleNodeRichStyle = useCallback((key: 'i' | 's') => commitDoc((d) => ({ ...d, nodes: mutations.toggleNodesRichStyle(d.nodes, nodeTargetIds(), key) })), [nodeTargetIds, commitDoc]);
  const setNodeTsize = useCallback(
    (v: 's' | 'm' | 'l') => commitDoc((d) => ({ ...d, nodes: mutations.setNodesField(d.nodes, nodeTargetIds(), 'tsize', v === 'm' ? undefined : v) })),
    [nodeTargetIds, commitDoc],
  );
  const setEmoji = useCallback((e: string) => commitDoc((d) => ({ ...d, nodes: mutations.toggleNodesEmoji(d.nodes, nodeTargetIds(), e) })), [nodeTargetIds, commitDoc]);
  const clearEmoji = useCallback(() => commitDoc((d) => ({ ...d, nodes: mutations.setNodesField(d.nodes, nodeTargetIds(), 'emoji', '') })), [nodeTargetIds, commitDoc]);
  // note stays single-selection-only (the panel only renders it under `singleNodeSel`), matching
  // the original's own `onNoteInput` binding directly to `this.state.selectedId` (MindFlow.dc.html:3085).
  const setNote = useCallback(
    (text: string) => {
      const id = isKind('node');
      if (id) commitDoc((d) => ({ ...d, nodes: mutations.setNodeField(d.nodes, id, 'note', text) }));
    },
    [selection, commitDoc],
  );
  // port of `Component#setTextAlign` (MindFlow.dc.html:2773) — the context menu's "텍스트 정렬"
  // flyout (`ContextMenu.tsx`) is its only caller; bulk-aware like `setShape` above.
  const setTextAlign = useCallback(
    (v: 'left' | 'center' | 'right') => commitDoc((d) => ({ ...d, nodes: mutations.setNodesField(d.nodes, nodeTargetIds(), 'align', v) })),
    [nodeTargetIds, commitDoc],
  );

  // ---- float property setters — bulk-aware style setters (port of `Component#applyFloatText`-backed
  // setters, MindFlow.dc.html:2733-2737) + per-instance actions (toggleFloatCollapse/deleteFloat stay
  // single-id: they act on the specific float box clicked, not the whole selection). ----
  const setFloatBg = useCallback((hex: string | null) => commitDoc((d) => ({ ...d, floats: mutations.updateFloatItems(d.floats, floatTargetIds(), { bg: hex ?? undefined }) })), [floatTargetIds, commitDoc]);
  const toggleFloatBold = useCallback(() => {
    const ids = floatTargetIds();
    const first = ids[0];
    if (!first) return;
    const cur = !!docRef.current.floats.find((f) => f.id === first)?.bold;
    commitDoc((d) => ({ ...d, floats: mutations.updateFloatItems(d.floats, ids, { bold: !cur }) }));
  }, [floatTargetIds, commitDoc]);
  /** 메모 전체 기울임/취소선 토글 — 노드 `toggleNodeRichStyle`의 플로트 짝. */
  const toggleFloatRichStyle = useCallback(
    (key: 'i' | 's') => commitDoc((d) => ({ ...d, floats: mutations.toggleFloatsRichStyle(d.floats, floatTargetIds(), key) })),
    [floatTargetIds, commitDoc],
  );
  const setFloatTsize = useCallback(
    (v: 's' | 'm' | 'l') => commitDoc((d) => ({ ...d, floats: mutations.updateFloatItems(d.floats, floatTargetIds(), { tsize: v === 'm' ? undefined : v }) })),
    [floatTargetIds, commitDoc],
  );
  const setFloatTextColor = useCallback(
    (hex: string | null) => commitDoc((d) => ({ ...d, floats: mutations.updateFloatItems(d.floats, floatTargetIds(), { textColor: hex ?? undefined }) })),
    [floatTargetIds, commitDoc],
  );
  const toggleFloatCollapse = useCallback(
    (id: string) => commitDoc((d) => ({ ...d, floats: mutations.updateFloatItem(d.floats, id, { collapsed: !d.floats.find((f) => f.id === id)?.collapsed }) })),
    [commitDoc],
  );
  const deleteFloat = useCallback(
    (id: string) => {
      commitDoc((d) => ({ ...d, floats: mutations.removeFloatItem(d.floats, id) }));
      setSelectionState(null);
      setEditingFloatId(null);
    },
    [commitDoc],
  );

  // ---- line property setters — bulk-aware style setters (port of `Component#applyLineText`-backed
  // setters, MindFlow.dc.html:2738-2741) except `setLineCurve` (single-reference only, matching the
  // original's own `setLineCurveN(selL.id, ...)`, MindFlow.dc.html:3078-3079) and `deleteLine` (per-id). ----
  const setLineDashed = useCallback((v: boolean) => commitDoc((d) => ({ ...d, lines: mutations.updateLineItems(d.lines, lineTargetIds(), { dashed: v }) })), [lineTargetIds, commitDoc]);
  const setLineArrow = useCallback(
    (which: LineHandle, v: boolean) => commitDoc((d) => ({ ...d, lines: mutations.updateLineItems(d.lines, lineTargetIds(), which === 1 ? { startArrow: v } : { endArrow: v }) })),
    [lineTargetIds, commitDoc],
  );
  const setLineCurve = useCallback(
    (id: string, which: LineHandle, v: number) => {
      const clamped = Math.max(-500, Math.min(500, v));
      commitDoc((d) => ({ ...d, lines: mutations.updateLineItem(d.lines, id, which === 2 ? { c2: clamped } : { c1: clamped }) }), true);
    },
    [commitDoc],
  );
  const toggleLineBold = useCallback(() => {
    const ids = lineTargetIds();
    const first = ids[0];
    if (!first) return;
    const cur = !!docRef.current.lines.find((l) => l.id === first)?.lbold;
    commitDoc((d) => ({ ...d, lines: mutations.updateLineItems(d.lines, ids, { lbold: !cur }) }));
  }, [lineTargetIds, commitDoc]);
  const setLineTsize = useCallback(
    (v: 's' | 'm' | 'l') => commitDoc((d) => ({ ...d, lines: mutations.updateLineItems(d.lines, lineTargetIds(), { lsize: v === 'm' ? undefined : v }) })),
    [lineTargetIds, commitDoc],
  );
  const setLineTextColor = useCallback(
    (hex: string | null) => commitDoc((d) => ({ ...d, lines: mutations.updateLineItems(d.lines, lineTargetIds(), { ltextColor: hex ?? undefined }) })),
    [lineTargetIds, commitDoc],
  );
  const deleteLine = useCallback(
    (id: string) => {
      commitDoc((d) => ({ ...d, lines: mutations.removeLineItem(d.lines, id) }));
      setSelectionState(null);
    },
    [commitDoc],
  );

  // ---- zone property setters ----
  const setZoneColor = useCallback((id: string, hex: string | null) => commitDoc((d) => ({ ...d, zones: mutations.updateZoneItem(d.zones, id, { color: hex }) })), [commitDoc]);
  const deleteZone = useCallback(
    (id: string) => {
      commitDoc((d) => ({ ...d, zones: mutations.removeZoneItem(d.zones, id) }));
      setSelectionState(null);
      setEditingZoneId(null);
    },
    [commitDoc],
  );

  const resetNodeSize = useCallback((id: string) => commitDoc((d) => ({ ...d, nodes: mutations.resetNodeSize(d.nodes, id) })), [commitDoc]);

  // ---- minimap — port of `Component#renderMinimap`/`#minimapCenterTo` (MindFlow.dc.html:1512-1539).
  // `showMinimap` was a design-time prop in the original (`this.props.showMinimap`); this port
  // exposes it as an in-app toggle next to the zoom controls instead (no props/config screen here). ----
  const toggleMinimap = useCallback(() => setShowMinimap((v) => !v), []);
  const [searchOpen, setSearchOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  // ---- 댓글 ────────────────────────────────────────────────────────────────
  // 본문(jsonb)이 아니라 별도 테이블(0020)에 산다 — 논의는 본문과 수명이 다르고
  // (버전을 되돌려도 남아야 한다), 본문에 넣으면 CRDT 병합 대상이 되어 끊긴 채
  // 양쪽이 달면 한쪽이 사라진다(#332).
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentsNodeId, setCommentsNodeId] = useState<string>(ROOT_ID);
  const [comments, setComments] = useState<DocComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  // 링크로 연 사람(초대 행이 없는 남의 문서)에게는 서버가 댓글을 내주지 않는다 —
  // 링크는 누구에게나 전달될 수 있는데 댓글은 내부 논의라 본문과 같은 무게로
  // 다룰 수 없다(0020의 select 정책). 진입점부터 감춘다.
  const canComment = !(loadedNotMine && !sharedDoc);

  /** 서버에서 목록을 다시 읽는다. 댓글은 실시간 채널을 타지 않으므로(본문이 아니다)
   * 열 때마다 새로 읽는 것이 상대의 새 댓글을 보는 유일한 길이다. */
  const reloadComments = useCallback(async () => {
    if (!docStoreId || !canComment) {
      setComments([]);
      return;
    }
    setCommentsLoading(true);
    try {
      setComments(await commentStore.list(docStoreId));
    } catch {
      setComments([]);
    } finally {
      setCommentsLoading(false);
    }
  }, [commentStore, docStoreId, canComment]);

  // 마운트/문서 전환 시 한 번 — 배지(주제별 개수)는 패널을 열지 않아도 보여야 한다.
  useEffect(() => {
    if (hydrating) return; // 본문이 아직 없으면 대상 주제도 없다
    void reloadComments();
  }, [reloadComments, hydrating]);

  // 주제를 고르면 패널이 따라간다 — 열어 둔 채 다른 주제를 눌렀는데 남의 댓글이
  // 그대로 떠 있으면 어느 주제의 논의인지 알 수 없다. 주제가 아닌 것(메모·선·영역)을
  // 고르거나 선택을 해제하면 보던 주제를 그대로 둔다.
  useEffect(() => {
    if (selection?.kind === 'node') setCommentsNodeId(selection.id);
  }, [selection?.kind, selection?.id]);

  const commentCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    comments.forEach((c) => {
      counts[c.nodeId] = (counts[c.nodeId] ?? 0) + 1;
    });
    return counts;
  }, [comments]);

  const openComments = useCallback(
    (nodeId?: string) => {
      if (nodeId) setCommentsNodeId(nodeId);
      setCommentsOpen(true);
      // 모바일에서는 속성 시트와 댓글이 둘 다 바텀 시트다 — 겹치지 않게 하나만 남긴다.
      setPropsOpen(false);
      void reloadComments();
    },
    [reloadComments],
  );
  const closeComments = useCallback(() => setCommentsOpen(false), []);

  const addComment = useCallback(
    async (nodeId: string, body: string) => {
      const res = await commentStore.add(docStoreId, nodeId, body);
      if (!res.error) await reloadComments();
      return res;
    },
    [commentStore, docStoreId, reloadComments],
  );
  const removeComment = useCallback(
    async (commentId: string) => {
      const res = await commentStore.remove(docStoreId, commentId);
      if (!res.error) await reloadComments();
      return res;
    },
    [commentStore, docStoreId, reloadComments],
  );
  const [searchMarks, setSearchMarks] = useState<{ nodes: Set<string>; floats: Set<string> } | null>(null);

  const panToCanvasPoint = useCallback((cx: number, cy: number) => {
    setViewport((prev) => ({ ...prev, pan: { x: prev.vw / 2 - cx * prev.zoom, y: prev.vh / 2 - cy * prev.zoom } }));
  }, []);

  /** Canvas-space center of a single selected object (or null if it's gone). */
  const objectCanvasCenter = useCallback((kind: SelectionKind, id: string): { x: number; y: number } | null => {
    if (kind === 'node') {
      const g = geomRef.current[id];
      return g ? { x: g.x, y: g.y } : null;
    }
    if (kind === 'float') {
      const f = docRef.current.floats.find((x) => x.id === id);
      return f ? { x: f.x + f.w / 2, y: f.y + floatBoxH(f) / 2 } : null;
    }
    if (kind === 'zone') {
      const z = docRef.current.zones.find((x) => x.id === id);
      return z ? { x: z.x + z.w / 2, y: z.y + z.h / 2 } : null;
    }
    const l = docRef.current.lines.find((x) => x.id === id);
    return l ? cubicAt(lineGeometryOf(l), 0.5) : null; // line midpoint
  }, []);

  /** Center the selected object in the canvas area ABOVE a bottom-anchored
   * property sheet (mobile). `reserveBottomPx` is how much of the viewport the
   * sheet may cover; the object is centered in the remaining top region so it's
   * never hidden behind the sheet. Zoom is unchanged. */
  const centerObjectAboveSheet = useCallback(
    (kind: SelectionKind, id: string, reserveBottomPx: number, reserveRightPx = 0) => {
      const c = objectCanvasCenter(kind, id);
      if (!c) return;
      setViewport((prev) => {
        const reserve = Math.min(Math.max(0, reserveBottomPx), prev.vh * 0.85);
        const targetY = Math.max(prev.vh * 0.14, (prev.vh - reserve) / 2);
        // 가로 폰의 사이드 시트는 **오른쪽**을 덮는다 — 가려진 폭만큼 왼쪽으로 당긴다.
        const reserveX = Math.min(Math.max(0, reserveRightPx), prev.vw * 0.85);
        const targetX = (prev.vw - reserveX) / 2;
        return { ...prev, pan: { x: targetX - c.x * prev.zoom, y: targetY - c.y * prev.zoom } };
      });
    },
    [objectCanvasCenter],
  );

  // ---- outline view editing — ports of `Component#outlineAdd`/`#outlineIndent`/`#outlineOutdent`
  // (MindFlow.dc.html:1944-1980). Tab/Enter mirror `addChild`/`addSibling`'s tree mutation but land
  // the new node in `outlineEditId` (the outline's own edit-mode flag) rather than `editingNodeId`
  // (the map canvas's), matching the original's separate `outlineEdit` state. ----
  const outlineStartEdit = useCallback((id: string) => {
    setSelectionState({ kind: 'node', id });
    setMultiSelectionState(null);
    if (readOnlyRef.current) return; // 보기 전용 — 선택까지만
    setOutlineEditId(id);
  }, []);
  const outlineCommitEdit = useCallback(
    (id: string, text: string) => {
      commitDoc((d) => ({ ...d, nodes: mutations.commitNodeText(d.nodes, id, text) }));
      setOutlineEditId(null);
      // 캔버스 텍스트 확정과 같은 규칙 — 커진 트리는 자유 도형을 밀어내고,
      // 자유 도형은 자기가 비켜난다(맵으로 돌아왔을 때 겹침 방지).
      if (docRef.current.nodes[id]?.parent) {
        pendingReflowNudgeRef.current = {};
        setNudgeTick((t) => t + 1);
      } else {
        pendingNudgeRef.current = [id];
      }
    },
    [commitDoc],
  );
  const outlineAddChild = useCallback(
    (id: string) => {
      if (readOnlyRef.current) return; // 보기 전용 — addChild와 같은 이유
      const newId = idFactory('x');
      commitDoc((d) => ({ ...d, nodes: mutations.addChildNode(d.nodes, id, newId) }));
      setSelectionState({ kind: 'node', id: newId });
      setOutlineEditId(newId);
      pendingReflowNudgeRef.current = {}; // 캔버스 addChild와 같은 이유(맵으로 돌아왔을 때 겹침 방지)
      setNudgeTick((t) => t + 1);
    },
    [commitDoc, idFactory],
  );
  const outlineAddSibling = useCallback(
    (id: string) => {
      if (readOnlyRef.current) return; // 보기 전용 — addChild와 같은 이유
      const newId = idFactory('x');
      commitDoc((d) => {
        const next = mutations.addSiblingNode(d.nodes, id, newId);
        if (next) return { ...d, nodes: next };
        return { ...d, nodes: mutations.addChildNode(d.nodes, ROOT_ID, newId) };
      });
      setSelectionState({ kind: 'node', id: newId });
      setOutlineEditId(newId);
      pendingReflowNudgeRef.current = {}; // 캔버스 addChild와 같은 이유
      setNudgeTick((t) => t + 1);
    },
    [commitDoc, idFactory],
  );
  const outlineIndent = useCallback((id: string) => commitDoc((d) => ({ ...d, nodes: mutations.outlineIndentNode(d.nodes, id) })), [commitDoc]);
  const outlineOutdent = useCallback((id: string) => commitDoc((d) => ({ ...d, nodes: mutations.outlineOutdentNode(d.nodes, id) })), [commitDoc]);

  // ---- object drag/resize (node-move/float-move/float-resize/zone-move/zone-resize/
  // line-move/line-end/line-curve/node-resize/group) — port of `Component#onMove`'s
  // per-type branches (MindFlow.dc.html:1665-1759). `node-move` unifies free/attached
  // node dragging behind a ghost + live drop-target highlight (Editor-c); `group`
  // handles a marquee multi-selection's shared drag (Editor-c). ----
  const objDragRef = useRef<ObjDrag | null>(null);

  /** Starts a new object drag — resets `objDragMovedRef` (this port's per-drag `d.moved`
   * stand-in, since `ObjDrag`'s variants don't carry their own field) alongside setting
   * `objDragRef.current`, so the context-menu machinery above always sees "not yet moved"
   * for a drag that JUST started, even if a previous drag left it `true`. */
  function startObjDrag(d: ObjDrag): void {
    objDragMovedRef.current = false;
    objDragRef.current = d;
  }

  /** Drop-target scan under the drag ghost's canvas point — port of `Component#findAttachTarget`
   * (MindFlow.dc.html:1761-1773). `exclude` keeps a dragged node from being dropped onto itself
   * or one of its own descendants (would create a cycle). */
  function findAttachTarget(p: { x: number; y: number }, exclude: Set<string>): AttachTarget | null {
    const g = geomRef.current;
    for (const id in g) {
      if (exclude.has(id)) continue;
      const gg = g[id];
      if (!gg) continue;
      const pad = 10;
      if (p.x >= gg.x - gg.w / 2 - pad && p.x <= gg.x + gg.w / 2 + pad && p.y >= gg.y - gg.h / 2 - pad && p.y <= gg.y + gg.h / 2 + pad) {
        const rel = (p.y - (gg.y - gg.h / 2)) / gg.h;
        const zone: AttachTarget['zone'] = id === ROOT_ID ? 'child' : rel < 0.25 ? 'above' : rel > 0.75 ? 'below' : 'child';
        return { id, zone };
      }
    }
    return null;
  }

  useEffect(() => {
    function onMove(e: PointerEvent): void {
      const d = objDragRef.current;
      if (!d) return;
      // any actual pointermove while a drag is live counts as "moved" for the context-menu's
      // deferred-open check (see `objDragMovedRef`'s declaration, above `dragRef`).
      objDragMovedRef.current = true;
      const vp = viewportRef.current;
      const dx = (e.clientX - d.startClientX) / vp.zoom;
      const dy = (e.clientY - d.startClientY) / vp.zoom;
      switch (d.kind) {
        case 'root':
          setRootAnchor({ x: d.startAnchor.x + dx, y: d.startAnchor.y + dy });
          break;
        case 'node-move': {
          const p = toCanvasPoint(e.clientX, e.clientY, vp);
          // 그랩 오프셋 보존: 고스트는 '시작 중심 + 포인터 이동량'을 따른다.
          // 커서에 중심을 스냅하면 가장자리를 잡은 도형이 잡는 순간 확 튀고,
          // 1px만 움직여도 의도보다 크게 이동해 버린다. 부착 대상 탐지는
          // 원본처럼 커서 지점 기준을 유지한다(가리키는 곳에 붙는 게 자연스러움).
          setDragGhost({ id: d.id, x: d.startGeomX + dx, y: d.startGeomY + dy });
          setAttachTarget(findAttachTarget(p, d.excludeIds));
          break;
        }
        case 'group': {
          // 단일 도형 드래그와 같은 모델(요청): 실물은 그대로 두고 **점선 고스트**만
          // 커서를 따라온다. 실제 이동은 놓는 순간 한 번에 커밋된다(onUp) — undo도
          // 한 단계가 된다. 예전엔 매 이동마다 문서를 커밋해 멤버 전부가 실시간으로
          // 끌려다녔다.
          setGroupGhost({ dx, dy, nodes: Object.keys(d.nodesOrig), floats: Object.keys(d.floatsOrig), lines: Object.keys(d.linesOrig) });
          break;
        }
        case 'node-resize': {
          const wantW = Math.max(40, d.ow + dx);
          const wantH = d.oh + dy;
          commitDoc((doc0) => {
            const n0 = doc0.nodes[d.id];
            if (!n0) return doc0;
            // 텍스트가 요구하는 최소 높이로 바닥을 깐다 — 이게 없으면 끄는 동안
            // 글자가 박스를 삐져나온다.
            //
            // 바닥을 재는 폭은 `min(현재 폭, 시작 폭)`이다. 폭을 **넓히는** 동안
            // 시작 폭으로 고정하는 이유: 넓히면 줄 수가 줄어 최소 높이가 한 줄씩
            // 낮아지는데, 그 계단을 그대로 따르면 높이가 뚝뚝 떨어진다(제보된
            // "위아래로 튐" — 214 → 194 → 174). 넓힌 박스에는 줄어든 텍스트가
            // 어차피 들어가므로 바닥을 낮추지 않아도 안전하다.
            // 반대로 **좁힐** 때는 현재 폭으로 재야 늘어난 줄 수를 담는다.
            // ch를 뺀 사본으로 재야 "높이 지정 없이 텍스트가 요구하는 높이"가 나온다.
            const probe: Node = { ...n0, cw: Math.min(wantW, d.ow) };
            delete probe.ch;
            const depth = geomRef.current[d.id]?.depth ?? 0;
            const floor = computeMetrics(probe, depth, measurer);
            const next = mutations.resizeNode(doc0.nodes, d.id, wantW, Math.max(wantH, floor.h));
            // 좌상단 고정: 노드는 x/y가 **중심**이라 크기만 바꾸면 좌우·위아래로 똑같이
            // 벌어진다 — 잡고 있는 우하단이 아니라 반대편이 움직여, 메모·영역(x/y가
            // 좌상단이라 저절로 고정됨)과 움직임이 달랐다(제보: 다들 조금씩 다름).
            // 시작 시점의 좌상단을 그대로 유지하도록 중심을 다시 계산해 맞춘다.
            const nn = next[d.id];
            if (nn && d.anchorable) {
              const m2 = computeMetrics(nn, depth, measurer);
              next[d.id] = { ...nn, x: d.tlX + m2.w / 2, y: d.tlY + m2.h / 2 };
            }
            return { ...doc0, nodes: next };
          }, true);
          break;
        }
        case 'float':
          commitDoc((doc0) => ({ ...doc0, floats: mutations.updateFloatItem(doc0.floats, d.id, { x: d.ox + dx, y: d.oy + dy }) }), true);
          break;
        case 'float-resize': {
          // 이미지 플로트는 비율 고정: 가로 드래그만 반영하고 높이는 원래
          // 종횡비(oh/ow)를 따라간다. 메모는 기존처럼 자유 리사이즈.
          const isImage = !!docRef.current.floats.find((f) => f.id === d.id)?.img;
          const patch = isImage
            ? (() => {
                const w = Math.max(60, Math.round(d.ow + dx));
                return { w, h: Math.max(24, Math.round((w * d.oh) / Math.max(1, d.ow))) };
              })()
            : { w: Math.max(120, Math.round(d.ow + dx)), h: Math.max(44, Math.round(d.oh + dy)) };
          commitDoc((doc0) => ({ ...doc0, floats: mutations.updateFloatItem(doc0.floats, d.id, patch) }), true);
          break;
        }
        case 'zone':
          commitDoc((doc0) => ({ ...doc0, zones: mutations.updateZoneItem(doc0.zones, d.id, { x: d.ox + dx, y: d.oy + dy }) }), true);
          break;
        case 'zone-resize':
          commitDoc(
            (doc0) => ({ ...doc0, zones: mutations.updateZoneItem(doc0.zones, d.id, { w: Math.max(160, Math.round(d.ow + dx)), h: Math.max(100, Math.round(d.oh + dy)) }) }),
            true,
          );
          break;
        case 'line-move':
          commitDoc(
            (doc0) => ({ ...doc0, lines: mutations.updateLineItem(doc0.lines, d.id, { x1: d.o.x1 + dx, y1: d.o.y1 + dy, x2: d.o.x2 + dx, y2: d.o.y2 + dy }) }),
            true,
          );
          break;
        case 'line-end': {
          // port of `Component#onMove`'s `d.type === 'line-end'` branch (MindFlow.dc.html:1728-1735):
          // track the raw cursor point, but also probe for a nearby port to snap/anchor to — the raw
          // x/y are ALWAYS stored too (the anchor is what actually drives the rendered position; raw
          // stays as the detached fallback/last-dropped-spot).
          const rawX = d.ox + dx;
          const rawY = d.oy + dy;
          const snap = findLineSnap(rawX, rawY, snapCandidates());
          setLineSnap(snap);
          const patch = d.which === 1 ? { x1: rawX, y1: rawY, a1: snap } : { x2: rawX, y2: rawY, a2: snap };
          commitDoc((doc0) => ({ ...doc0, lines: mutations.updateLineItem(doc0.lines, d.id, patch) }), true);
          break;
        }
        case 'line-curve': {
          // on-curve handle moves at ~4/9 of the control-point offset at t=1/3 → scale to track the cursor (MindFlow.dc.html:1740)
          const proj = (dx * d.nx + dy * d.ny) * 2.25;
          const clamped = Math.max(-500, Math.min(500, d.oc + proj));
          commitDoc((doc0) => ({ ...doc0, lines: mutations.updateLineItem(doc0.lines, d.id, d.which === 2 ? { c2: clamped } : { c1: clamped }) }), true);
          break;
        }
        default:
          break;
      }
    }
    function onUp(e: PointerEvent): void {
      const d = objDragRef.current;
      if (!d) return;
      objDragRef.current = null;
      // deferred right-click menu (macOS): see the identical block in the background
      // drag's `onUp`, above — this covers a right-click that landed on a NODE/FLOAT/
      // ZONE/LINE (their `begin*Drag` starters don't filter by button, matching the
      // original's `onNodeDown`/`onFloatDown`/`onLineDown`, so a right-mousedown on one
      // of them starts an `objDrag`, not a background pan).
      if (pendingCtxRef.current) {
        const pc = pendingCtxRef.current;
        pendingCtxRef.current = null;
        if (!objDragMovedRef.current) openCtxAt(pc.x, pc.y);
      }
      // clear the snap-target port indicators — port of `Component#onUp`'s
      // `if (d && d.type === 'line-end') { this._snapHi = null; ... }` (MindFlow.dc.html:1824).
      if (d.kind === 'line-end') setLineSnap(null);
      if (d.kind === 'node-resize') {
        setResizingNodeId(null); // drop it back to its normal layer
        if (objDragMovedRef.current) {
          // 크기 확정으로 이웃과 겹치면 **겹친 개별(자유) 도형들이 밀려난다**(제보).
          // 크기를 조절한 도형은 사용자가 방금 자리·크기를 정한 것이므로 anchor로
          // 고정하고 나머지가 비켜난다 — 트리 노드를 키운 경우도 이 경로 하나로
          // 해결된다(트리는 어차피 움직일 수 없어 상대만 밀 수 있다). anchor가
          // 자유 도형인데 트리와 겹치면 그때만 자신이 비켜난다(effect의 폴백).
          // Resize commits during the drag, so `doc.nodes` doesn't change on
          // release — bump `nudgeTick` to re-run the nudge effect.
          pendingReflowNudgeRef.current = { anchor: d.id };
          setNudgeTick((t) => t + 1);
        }
      }
      if (d.kind === 'node-move') {
        const vp = viewportRef.current;
        const p = toCanvasPoint(e.clientX, e.clientY, vp);
        setDragGhost(null);
        setAttachTarget(null);
        // How far the POINTER actually travelled (not how off-centre the grab was).
        // A click — or sub-threshold jitter — that never dragged must only select
        // (done on pointerdown), never move/detach/reattach. Without this, clicking a
        // wide node's edge alone clears the `dist > 40` detach gate below (dist is
        // measured from the node's CENTRE to the cursor), yanking it out of the tree.
        const moveDist = Math.hypot(e.clientX - d.startClientX, e.clientY - d.startClientY) / (vp.zoom || 1);
        const target = moveDist >= 4 ? findAttachTarget(p, d.excludeIds) : null;
        // 드롭 좌표도 고스트와 동일하게 그랩 오프셋 보존 — 놓는 순간 중심이
        // 커서로 점프하지 않고, 드래그 중 보이던 자리에 그대로 내려앉는다.
        const dropX = d.startGeomX + (e.clientX - d.startClientX) / (vp.zoom || 1);
        const dropY = d.startGeomY + (e.clientY - d.startClientY) / (vp.zoom || 1);
        if (moveDist < 4) {
          // pure click — nothing to commit
        } else if (target) {
          // dropped onto another node → reparent (port of `Component#onUp`'s
          // `if (a) { this.attachFreeNode(d.id, a.id, a.zone); return; }`, MindFlow.dc.html:1786)
          commitDoc((doc0) => {
            const next = mutations.reattachNode(doc0.nodes, d.id, target.id, target.zone);
            return next ? { ...doc0, nodes: next } : doc0;
          });
          // the tree re-lays out around the new child/sibling → push every free
          // shape clear of it once the new geom settles (the layout ignores frees).
          pendingReflowNudgeRef.current = {};
          setNudgeTick((t) => t + 1);
        } else {
          const dist = Math.hypot(dropX - d.startGeomX, dropY - d.startGeomY); // = 포인터 이동량 (그랩 오프셋 무관)
          if (d.wasFree) {
            // 이동 커밋만 하고 마그넷은 **layout effect**(pendingNudge)에 맡긴다.
            // 예전엔 여기서 인라인으로 nudge까지 했는데(한 커밋 = 깜빡임 방지),
            // 그 시점의 geom은 이동 **전** 레이아웃이라 **자식을 가진** 자유 도형의
            // 서브트리 박스가 "새 루트 위치 ~ 옛 자식 위치"로 늘어난 엉터리가 됐다
            // (제보: 하위 도형이 있으면 엉뚱한 좌표로 튀고 하위가 겹친 채 남음 —
            // 아래 detach 주석이 이미 문서화한 함정과 같은 것). nudge가 layout
            // effect(페인트 전)로 옮겨진 지금은 다음 렌더의 **새 레이아웃 geom**으로
            // 재도 깜빡임이 없다.
            if (dist > 0.5) {
              commitDoc((doc0) => ({ ...doc0, nodes: mutations.moveFreeNode(doc0.nodes, d.id, dropX, dropY) }));
              pendingNudgeRef.current = [d.id];
            }
          } else if (dist > 40) {
            // dragged clear of the tree → detach to a free shape at the drop point
            // (MindFlow.dc.html:1791-1797). 마그넷은 아래 리플로우 패스가 새 geom으로
            // 처리한다(인라인 nudge는 위와 같은 낡은-geom 함정 — 제거).
            commitDoc((doc0) => {
              const next = mutations.detachNodeToFree(doc0.nodes, d.id, dropX, dropY);
              return { ...doc0, nodes: next };
            });
            // Detaching removes the node from its parent → the tree RE-LAYS OUT, and
            // the just-detached shape's subtree only gets its real laid-out footprint
            // once `layout()` runs (a node with children can't be nudged correctly by
            // the immediate pass above: its children still carry stale tree geometry,
            // so their bounding box is wrong). Re-run the full free-shape nudge once
            // the new geom settles — the same post-reflow pass reattach uses — so the
            // detached shape (and any bystander free shapes the reflow disturbed) end
            // up clear of every node. Port of dc's `detachNode` → `applyFreeNudge`
            // (MindFlow.dc.html:2164-2171), which nudges AFTER the layout, not before.
            pendingReflowNudgeRef.current = {};
            setNudgeTick((t) => t + 1);
          }
          // small move, no target: snap back — nothing to commit (matches MindFlow.dc.html:1799)
        }
      } else if (d.kind === 'group') {
        setGroupGhost(null);
        // 고스트 모델(onMove 참고): 실제 이동은 여기서 **한 번에** 커밋된다.
        const vp = viewportRef.current;
        const gdx = (e.clientX - d.startClientX) / (vp.zoom || 1);
        const gdy = (e.clientY - d.startClientY) / (vp.zoom || 1);
        if (objDragMovedRef.current && (Math.abs(gdx) > 0.5 || Math.abs(gdy) > 0.5)) {
          commitDoc((doc0) => ({
            ...doc0,
            nodes: mutations.translateNodesBy(doc0.nodes, d.nodesOrig, gdx, gdy),
            floats: mutations.translateFloatsBy(doc0.floats, d.floatsOrig, gdx, gdy),
            lines: mutations.translateLinesBy(doc0.lines, d.linesOrig, gdx, gdy),
          }));
          if (d.nodesOrig[ROOT_ID]) {
            // the root moved as part of the group → remember its new spot as the pinned
            // anchor (matches the single-drag branch, MindFlow.dc.html:1816-1819)
            const ro = d.nodesOrig[ROOT_ID]!;
            setRootAnchor({ x: ro.x + gdx, y: ro.y + gdy });
          }
          // 그룹으로 옮긴 자유 도형들도 단일 드롭과 같은 마그넷을 받는다(제보 —
          // 예전엔 그룹 이동만 밀어내기 없이 겹친 채 놓였다). 움직인 건 그룹이므로
          // 그룹 멤버들이 비켜난다(구경꾼은 그대로). 멤버끼리는 드래그 전에 이미
          // 안 겹쳤고 함께 평행이동했으므로 서로 겹칠 일이 없다.
          const movedFrees = Object.keys(d.nodesOrig).filter((id) => id !== ROOT_ID);
          if (movedFrees.length) {
            pendingNudgeRef.current = movedFrees;
            setNudgeTick((t) => t + 1);
          }
        }
      }
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [commitDoc]);

  // Magnet the JUST-moved shape(s) clear of overlap. Only the shapes whose ids are
  // parked in `pendingNudgeRef` (set on drop / text-commit / create / paste) are
  // nudged — never the ones they landed on — so a stationary shape stays put (only
  // the shapes the user acted on move). Runs once the interaction settles (not
  // mid-edit / mid-drag). Applied via `setDoc` (a normalization, not an undoable
  // action — matching the original's plain `setState` in `resolveOverlapFree`).
  //
  // **layout effect + 이 render의 `geom`**인 이유(제보: 밀려날 때 깜빡임): 일반
  // effect는 페인트 **뒤**에 돌아 겹친 자리가 한 프레임 그려진 다음 옮겨진다.
  // layout effect의 setDoc은 페인트 전에 동기 재렌더를 일으키므로 겹친 프레임이
  // 화면에 나가지 않는다. geomRef는 일반 effect에서 갱신돼 여기선 낡았을 수 있어
  // 렌더 스코프의 `geom`(방금 계산된 값)을 직접 읽는다.
  useLayoutEffect(() => {
    const targets = pendingNudgeRef.current;
    if (!targets || !targets.length) return;
    if (editingNodeId || editingFloatId || editingZoneId || editingLineId) return;
    if (objDragRef.current || dragRef.current) return;
    pendingNudgeRef.current = null;
    let nodes = doc.nodes;
    for (const target of targets) {
      const n = nodes[target];
      if (!n || n.parent) continue; // gone, or reattached into the tree — nothing to separate
      // 위치 규칙은 `nudgeBoxOf` 하나로 — 자유 루트(와 그 서브트리)는 진행 중인
      // 후보 `nodes`가 말하는 곳으로 평행이동해 읽는다(붙여넣기처럼 여럿을 연달아
      // 밀 때 뒤의 도형이 앞의 도형이 **옮겨 간** 자리를 봐야 한다).
      nodes = mutations.nudgeFreeNode(nodes, target, nudgeBoxOf(nodes, geom));
    }
    if (nodes !== doc.nodes) amendDoc((prev) => (prev.nodes === doc.nodes ? { ...prev, nodes } : prev));
  }, [doc.nodes, geom, nudgeTick, editingNodeId, editingFloatId, editingZoneId, editingLineId]);

  // After a reparent (drag-attach) re-lays out the tree, push EVERY free shape
  // clear of the new tree (and of each other) — the tree layout doesn't know
  // about free shapes, so a reflow can land a tree node on top of one. Port of
  // `applyFreeNudge` over all free roots (MindFlow.dc.html:2155). Runs once geom
  // settles (like the single-shape nudge above) so `geomRef` holds the NEW tree
  // positions; applied as a normalization (plain `setDoc`, not undoable).
  // layout effect + 렌더 스코프 `geom` — 위의 단일 nudge effect와 같은 이유
  // (겹친 프레임이 페인트되기 전에 밀어낸다 — 깜빡임 제거).
  useLayoutEffect(() => {
    const req = pendingReflowNudgeRef.current;
    if (!req) return;
    // 편집 가드는 **자유 루트를 편집 중일 때만** — 이 패스의 movers가 자유
    // 루트들이라, 편집 중인 자유 루트가 밀리면 편집 박스째 움직인다. 반면
    // **트리 노드** 편집(자식 추가 직후의 이름 입력이 바로 이 경우)은 편집
    // 대상이 movers가 아니므로 안전하고, 여기서 기다리면 이름을 다 입력할
    // 때까지 겹친 화면이 유지된다(제보: "추가하면 옆 도형과 겹쳐진다" —
    // 지난 수리가 확정 시점으로 미룬 것이 원인). 추가 즉시 placeholder
    // 크기로 밀고, 확정 시 커밋 훅이 다시 리플로우를 걸어 최종 크기로 민다.
    const editingFreeRoot = !!editingNodeId && !doc.nodes[editingNodeId]?.parent;
    if (editingFreeRoot || editingFloatId || editingZoneId || editingLineId) return;
    if (objDragRef.current || dragRef.current) return;
    pendingReflowNudgeRef.current = null;
    const freeRoots = Object.keys(doc.nodes).filter((id) => id !== ROOT_ID && !doc.nodes[id]?.parent);
    if (!freeRoots.length) return;
    // anchor(크기 조절을 확정한 도형)는 움직이지 않는다 — 겹친 쪽이 밀려난다.
    const anchor = req.anchor && freeRoots.includes(req.anchor) ? req.anchor : null;
    const movers = anchor ? freeRoots.filter((id) => id !== anchor) : freeRoots;
    let nodes = doc.nodes;
    // 위치 규칙은 `nudgeBoxOf` 하나로 — 먼저 밀린 자유 도형의 서브트리까지
    // 후보 `nodes` 기준으로 평행이동해 읽는다.
    for (const fid of movers) {
      nodes = mutations.nudgeFreeNode(nodes, fid, nudgeBoxOf(nodes, geom));
    }
    // 폴백: 남들이 다 비켰는데도 anchor가 여전히 겹치면(움직일 수 없는 **트리**와
    // 겹친 경우뿐이다 — 자유 도형들은 위에서 전부 비켜났다) 그때만 anchor가 비켜난다.
    if (anchor) nodes = mutations.nudgeFreeNode(nodes, anchor, nudgeBoxOf(nodes, geom));
    if (nodes !== doc.nodes) amendDoc((prev) => (prev.nodes === doc.nodes ? { ...prev, nodes } : prev));
  }, [doc.nodes, geom, nudgeTick, editingNodeId, editingFloatId, editingZoneId, editingLineId]);

  function capturePointer(e: ReactPointerEvent): void {
    try {
      (e.target as Element).setPointerCapture?.(e.pointerId);
    } catch {
      /* not implemented in some environments (e.g. jsdom) — non-fatal */
    }
  }

  /** Starts a shared multi-select drag — port of `Component#startGroupDrag` (MindFlow.dc.html:1582-1594).
   * Triggered from `beginNodeDrag`/`beginFloatDrag`/`beginLineDrag` when the grabbed item is part of
   * an active marquee selection with more than one total member (matches the original's
   * `this.state.msel && cur.X.includes(id) && this.mselTotal(cur) > 1` guard). */
  function beginGroupDrag(e: ReactPointerEvent, groups: MultiSelection): void {
    e.stopPropagation();
    capturePointer(e);
    const d = docRef.current;
    const nodesOrig: Record<string, { x: number; y: number }> = {};
    groups.nodes.forEach((id) => {
      const n = d.nodes[id];
      // only free-standing roots carry a meaningful x/y in this port (see
      // `mutations.translateNodesBy`'s doc comment) — attached tree nodes stay put.
      if (n && n.free && !n.parent) nodesOrig[id] = { x: n.x, y: n.y };
    });
    const floatsOrig: Record<string, { x: number; y: number }> = {};
    groups.floats.forEach((id) => {
      const f = d.floats.find((x) => x.id === id);
      if (f) floatsOrig[id] = { x: f.x, y: f.y };
    });
    const linesOrig: Record<string, { x1: number; y1: number; x2: number; y2: number }> = {};
    groups.lines.forEach((id) => {
      const l = d.lines.find((x) => x.id === id);
      if (l) linesOrig[id] = { x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2 };
    });
    startObjDrag({ kind: 'group', pointerId: e.pointerId, startClientX: e.clientX, startClientY: e.clientY, nodesOrig, floatsOrig, linesOrig });
  }

  // Touch object-move (option A): a press on the ALREADY-selected object starts a
  // real move drag instead of deferring to a tap/pan — so on mobile you tap to
  // select, then drag it to move it (matches Keynote/Figma "select then drag").
  // Everything else on touch still defers (see each `pendingTapRef` guard).
  const isSelectedSingle = (kind: Selection['kind'], id: string): boolean => {
    const s = selectionRef.current;
    return !!s && s.kind === kind && s.id === id;
  };

  const beginNodeDrag = useCallback(
    (e: ReactPointerEvent, id: string) => {
      if (isPanButton(e)) return; // 우클릭·휠클릭 = 화면 이동 (배경으로 흘려보낸다)
      // Touch: defer to a tap. Don't select/drag on press — record the target
      // and let the press bubble to the background so a drag pans and a no-move
      // release selects (see `pendingTapRef`). Mouse keeps press-to-select+drag.
      // Exception: an already-selected node → start a move drag (option A).
      if (e.pointerType === 'touch' && !isSelectedSingle('node', id)) {
        pendingTapRef.current = { kind: 'node', id };
        return;
      }
      const ms = multiSelectionRef.current;
      if (ms && ms.nodes.includes(id) && totalSelected(ms) > 1) {
        beginGroupDrag(e, ms);
        return;
      }
      e.stopPropagation();
      capturePointer(e);
      const n = docRef.current.nodes[id];
      if (!n) return;
      setSelectionState({ kind: 'node', id });
      setMultiSelectionState(null);
      if (id === ROOT_ID) {
        // 최상위 부모(루트)는 **이동 불가**. 예전엔 여기서 'root' 드래그를 시작해
        // `rootAnchor`가 움직이며 맵 전체가 끌려다녔다 — 트리의 기준점이라 실수로
        // 밀리면 되돌리기 어렵다. 선택만 하고 드래그는 시작하지 않는다.
        // (마퀴 그룹 드래그는 `beginGroupDrag`가 `n.free && !n.parent`만 담으므로
        //  루트를 애초에 포함하지 않는다 — 여기만 막으면 경로가 모두 닫힌다.)
      } else {
        const g = geomRef.current[id];
        const excludeIds = new Set<string>([id, ...descendants(docRef.current.nodes, id)]);
        startObjDrag({
          kind: 'node-move',
          id,
          pointerId: e.pointerId,
          startClientX: e.clientX,
          startClientY: e.clientY,
          startGeomX: g?.x ?? n.x,
          startGeomY: g?.y ?? n.y,
          wasFree: !!n.free,
          excludeIds,
        });
      }
    },
    [rootAnchor],
  );

  const beginNodeResize = useCallback((e: ReactPointerEvent, id: string) => {
    if (isPanButton(e)) return; // 우클릭·휠클릭 = 화면 이동 (배경으로 흘려보낸다)
    e.stopPropagation();
    e.preventDefault();
    const g = geomRef.current[id];
    if (!g) return;
    setResizingNodeId(id);
    // 자유 도형(free 루트)만 자기 x/y를 갖는다 — 트리에 붙은 노드는 layout이 위치를
    // 정하므로 여기서 손댈 수 없다(메모·영역은 애초에 x/y가 좌상단이라 손댈 필요 없음).
    const rn = docRef.current.nodes[id];
    const anchorable = !!rn && !!rn.free && !rn.parent;
    startObjDrag({
      kind: 'node-resize', id, pointerId: e.pointerId, startClientX: e.clientX, startClientY: e.clientY,
      ow: g.w, oh: g.h, tlX: g.x - g.w / 2, tlY: g.y - g.h / 2, anchorable,
    });
  }, []);

  const beginFloatDrag = useCallback((e: ReactPointerEvent, id: string) => {
    if (isPanButton(e)) return; // 우클릭·휠클릭 = 화면 이동 (배경으로 흘려보낸다)
    if (e.pointerType === 'touch' && !isSelectedSingle('float', id)) {
      pendingTapRef.current = { kind: 'float', id };
      return;
    }
    const ms = multiSelectionRef.current;
    if (ms && ms.floats.includes(id) && totalSelected(ms) > 1) {
      beginGroupDrag(e, ms);
      return;
    }
    e.stopPropagation();
    capturePointer(e);
    const f = docRef.current.floats.find((x) => x.id === id);
    if (!f) return;
    setSelectionState({ kind: 'float', id });
    setMultiSelectionState(null);
    startObjDrag({ kind: 'float', id, pointerId: e.pointerId, startClientX: e.clientX, startClientY: e.clientY, ox: f.x, oy: f.y });
  }, []);

  const beginFloatResize = useCallback((e: ReactPointerEvent, id: string) => {
    if (isPanButton(e)) return; // 우클릭·휠클릭 = 화면 이동 (배경으로 흘려보낸다)
    e.stopPropagation();
    e.preventDefault();
    const f = docRef.current.floats.find((x) => x.id === id);
    if (!f) return;
    startObjDrag({ kind: 'float-resize', id, pointerId: e.pointerId, startClientX: e.clientX, startClientY: e.clientY, ow: f.w, oh: floatBoxH(f) });
  }, []);

  const beginZoneDrag = useCallback((e: ReactPointerEvent, id: string) => {
    if (isPanButton(e)) return; // 우클릭·휠클릭 = 화면 이동 (배경으로 흘려보낸다)
    if (e.pointerType === 'touch' && !isSelectedSingle('zone', id)) {
      pendingTapRef.current = { kind: 'zone', id };
      return;
    }
    e.stopPropagation();
    capturePointer(e);
    const z = docRef.current.zones.find((x) => x.id === id);
    if (!z) return;
    setSelectionState({ kind: 'zone', id });
    setMultiSelectionState(null);
    startObjDrag({ kind: 'zone', id, pointerId: e.pointerId, startClientX: e.clientX, startClientY: e.clientY, ox: z.x, oy: z.y });
  }, []);

  const beginZoneResize = useCallback((e: ReactPointerEvent, id: string) => {
    if (isPanButton(e)) return; // 우클릭·휠클릭 = 화면 이동 (배경으로 흘려보낸다)
    e.stopPropagation();
    e.preventDefault();
    const z = docRef.current.zones.find((x) => x.id === id);
    if (!z) return;
    startObjDrag({ kind: 'zone-resize', id, pointerId: e.pointerId, startClientX: e.clientX, startClientY: e.clientY, ow: z.w, oh: z.h });
  }, []);

  const beginLineDrag = useCallback((e: ReactPointerEvent, id: string) => {
    if (isPanButton(e)) return; // 우클릭·휠클릭 = 화면 이동 (배경으로 흘려보낸다)
    if (e.pointerType === 'touch' && !isSelectedSingle('line', id)) {
      pendingTapRef.current = { kind: 'line', id };
      return;
    }
    const ms = multiSelectionRef.current;
    if (ms && ms.lines.includes(id) && totalSelected(ms) > 1) {
      beginGroupDrag(e, ms);
      return;
    }
    e.stopPropagation();
    capturePointer(e);
    const l = docRef.current.lines.find((x) => x.id === id);
    if (!l) return;
    setSelectionState({ kind: 'line', id });
    setMultiSelectionState(null);
    startObjDrag({ kind: 'line-move', id, pointerId: e.pointerId, startClientX: e.clientX, startClientY: e.clientY, o: { x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2 } });
  }, []);

  // Move-handle drag (option B): a deliberate grip on the current selection that
  // starts its move drag on pointerdown. Dispatches to the same `begin*Drag` as a
  // direct grab — the object is already selected, so those start the drag even on
  // touch (see `isSelectedSingle`). Gives mobile a discoverable "grab here to
  // move" affordance alongside dragging the object body directly.
  const beginMoveSelected = useCallback(
    (e: ReactPointerEvent) => {
      if (isPanButton(e)) return; // 우클릭·휠클릭 = 화면 이동 (배경으로 흘려보낸다)
      const s = selectionRef.current;
      if (!s) return;
      if (s.kind === 'node') beginNodeDrag(e, s.id);
      else if (s.kind === 'float') beginFloatDrag(e, s.id);
      else if (s.kind === 'zone') beginZoneDrag(e, s.id);
      else if (s.kind === 'line') beginLineDrag(e, s.id);
    },
    [beginNodeDrag, beginFloatDrag, beginZoneDrag, beginLineDrag],
  );

  const beginLineEndDrag = useCallback((e: ReactPointerEvent, id: string, which: LineHandle) => {
    if (isPanButton(e)) return; // 우클릭·휠클릭 = 화면 이동 (배경으로 흘려보낸다)
    e.stopPropagation();
    capturePointer(e);
    const l = docRef.current.lines.find((x) => x.id === id);
    if (!l) return;
    setSelectionState({ kind: 'line', id });
    // start from the RESOLVED point (port of `Component#onLineEndDown`'s `this.resolveEnd(l, which)`,
    // MindFlow.dc.html:2482) so a drag that begins on an already-anchored endpoint tracks the
    // cursor from where it's actually rendered, not a possibly-stale raw x/y.
    const ep = resolveLine(l);
    const ox = which === 1 ? ep.x1 : ep.x2;
    const oy = which === 1 ? ep.y1 : ep.y2;
    startObjDrag({ kind: 'line-end', id, which, pointerId: e.pointerId, startClientX: e.clientX, startClientY: e.clientY, ox, oy });
  }, []);

  const beginLineCurveDrag = useCallback((e: ReactPointerEvent, id: string, which: LineHandle) => {
    if (isPanButton(e)) return; // 우클릭·휠클릭 = 화면 이동 (배경으로 흘려보낸다)
    e.stopPropagation();
    capturePointer(e);
    const l = docRef.current.lines.find((x) => x.id === id);
    if (!l) return;
    const g = lineGeometryOf(l);
    startObjDrag({
      kind: 'line-curve',
      id,
      which,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      oc: which === 2 ? g.c2 : g.c1,
      nx: g.nx,
      ny: g.ny,
    });
  }, []);

  // ---- keyboard shortcuts — port of `Component#onKey` (MindFlow.dc.html:2838-2905):
  // the map-view branch (Editor-b), plus the outline-view branch and the multi-select
  // (marquee) Delete/Escape branch (Editor-c). ----
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      const target = e.target as HTMLElement | null;
      const inEditable = !!(target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable));
      if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        saveNow();
        return;
      }
      // Ctrl/⌘+F = 맵 안 검색 — 브라우저 페이지 찾기 대신 우리 검색 바를 연다
      // (캔버스 텍스트는 페이지 찾기로 못 찾는다). 이미 열려 있으면 입력창이
      // 다시 포커스를 가져간다(SearchBar의 open 이펙트).
      if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F') && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      // `?` = 단축키 도움말 — 글자를 입력 중일 때는 그냥 물음표다.
      if (e.key === '?' && !inEditable && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setHelpOpen(true);
        return;
      }

      if (view === 'outline') {
        if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
          e.preventDefault();
          undo();
          return;
        }
        if ((e.metaKey || e.ctrlKey) && ((e.key === 'y' || e.key === 'Y') || (e.shiftKey && (e.key === 'z' || e.key === 'Z')))) {
          e.preventDefault();
          redo();
          return;
        }
        if (inEditable) return; // the row's own <input> handles Tab/Enter/F2/Escape itself
        const id = selection?.kind === 'node' ? selection.id : null;
        if (e.key === 'Tab') {
          e.preventDefault();
          if (id) outlineAddChild(id);
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          if (id) {
            if (id !== ROOT_ID) outlineAddSibling(id);
            else outlineAddChild(id);
          }
          return;
        }
        if (e.key === 'F2') {
          e.preventDefault();
          if (id) setOutlineEditId(id);
          return;
        }
        if ((e.key === 'Delete' || e.key === 'Backspace') && id && id !== ROOT_ID) {
          e.preventDefault();
          deleteSelection();
          return;
        }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const rows = outlineRows(docRef.current.nodes);
          if (!rows.length) return;
          const idx = rows.findIndex((r) => r.id === id);
          const next = e.key === 'ArrowUp' ? Math.max(0, idx - 1) : Math.min(rows.length - 1, idx + 1);
          const row = rows[idx < 0 ? 0 : next];
          if (row) selectNode(row.id);
          return;
        }
        return;
      }

      if (inEditable) return;
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && ((e.key === 'y' || e.key === 'Y') || (e.shiftKey && (e.key === 'z' || e.key === 'Z')))) {
        e.preventDefault();
        redo();
        return;
      }
      // 복사/잘라내기/붙여넣기 — macOS는 Cmd(metaKey), 그 외는 Ctrl.
      // `inEditable` 가드를 이미 지난 지점이라 텍스트 편집 중의 네이티브 복사/붙여넣기는
      // 그대로 살아 있다. 한글 IME가 켜져 있으면 e.key가 자모로 올 수 있어 물리 키
      // (e.code)도 함께 본다.
      if (e.metaKey || e.ctrlKey) {
        const k = e.key.toLowerCase();
        if (k === 'c' || e.code === 'KeyC') {
          e.preventDefault();
          copySelection();
          return;
        }
        if (k === 'x' || e.code === 'KeyX') {
          e.preventDefault();
          cutSelection();
          return;
        }
        if (k === 'v' || e.code === 'KeyV') {
          e.preventDefault();
          pasteClipboardAt();
          return;
        }
        // 전체 선택 — 캔버스의 모든 객체를 다중 선택한다(마인드맵 관례).
        // preventDefault가 본질이다: 가로채지 않으면 브라우저가 **페이지 텍스트
        // 전체**를 선택하고, 그 선택 위에서 드래그를 시작하는 순간 화면 전체를
        // 반투명 스냅샷으로 끌고 다니는 네이티브 드래그가 발동한다(제보 —
        // "브라우저 전체가 이미지화되어 이동"). 루트는 제외(이동·삭제 불가 기준점,
        // 마퀴와 같은 규칙).
        if (k === 'a' || e.code === 'KeyA') {
          e.preventDefault();
          const d = docRef.current;
          const allNodes = Object.keys(d.nodes).filter((id) => id !== ROOT_ID);
          const allFloats = d.floats.map((f) => f.id);
          const allLines = d.lines.map((l) => l.id);
          if (allNodes.length + allFloats.length + allLines.length > 0) {
            setSelectionState(null);
            setMultiSelectionState({ nodes: allNodes, floats: allFloats, lines: allLines });
          }
          return;
        }
      }
      // multi-select (marquee) — port of the `this.state.msel && this.mselTotal() > 1` early-return
      // branch (MindFlow.dc.html:2878-2882), checked BEFORE the single-`selection` branches below.
      if (multiSelection && totalSelected(multiSelection) > 1) {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          deleteSelection();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          clearSelection();
        }
        return;
      }
      // arrow keys move the node selection to the nearest neighbour in that direction
      // (port of the dc original's final `else if` arrow block). Only meaningful with a
      // node — or nothing — selected; float/line/zone selections are handled by their own
      // branches below and don't navigate.
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (!selection || selection.kind === 'node') {
          e.preventDefault();
          const dir = e.key === 'ArrowUp' ? 'up' : e.key === 'ArrowDown' ? 'down' : e.key === 'ArrowLeft' ? 'left' : 'right';
          navigateNodes(selection?.kind === 'node' ? selection.id : null, dir);
          return;
        }
      }
      if (!selection) return;
      if (selection.kind === 'node') {
        if (e.key === 'F2') {
          e.preventDefault();
          startEditNode(selection.id);
        } else if (e.key === 'Tab') {
          e.preventDefault();
          addChild();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          addSibling();
        } else if ((e.key === 'Delete' || e.key === 'Backspace') && selection.id !== ROOT_ID) {
          e.preventDefault();
          deleteSelection();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          clearSelection();
        }
      } else if (selection.kind === 'float') {
        if (e.key === 'F2' || e.key === 'Enter') {
          e.preventDefault();
          startEditFloat(selection.id);
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          deleteSelection();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          clearSelection();
        }
      } else if (selection.kind === 'line') {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          deleteSelection();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          clearSelection();
        }
      } else if (selection.kind === 'zone') {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          deleteSelection();
        } else if (e.key === 'F2' || e.key === 'Enter') {
          e.preventDefault();
          startEditZoneLabel(selection.id);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          clearSelection();
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  // ---- export (port of exportJSON/exportOutline/exportPNG, MindFlow.dc.html:613-771) ----
  const exportJSON = useCallback(() => {
    // 실물은 Storage에 있고 본문에는 참조만 있다 — 내보내는 파일은 **그 자체로
    // 완결**돼야 하므로 이미지를 다시 담는다(`imageExport.ts`의 doc comment 참고).
    void (async () => {
      const { doc: full, missing } = await inlineImagesForExport(doc, imageStore);
      downloadFile(`${safeDocTitle(doc, titleParam)}.json`, JSON.stringify(serializeDoc(full), null, 2), 'application/json');
      if (missing > 0) setImageNotice(`이미지 ${missing}장을 내보내기 파일에 담지 못했어요 — 연결을 확인하고 다시 시도해 주세요`);
    })();
  }, [doc, titleParam]);
  const exportPNG = useCallback(() => {
    void (async () => {
      // 아직 URL을 못 받은 참조가 있으면 **여기서 받아서** 그린다. 예전엔 렌더 시점의
      // `imageUrls`만 썼고, 그게 의존성 배열에도 없어서 맵을 열자마자 내보내면 URL이
      // 도착하기 전의 빈 표로 그려졌다 — 사진 자리가 통째로 빈 상자였다(제보).
      const refs = collectImageRefs(doc).filter((r) => !imageUrls[r]);
      const extra = refs.length ? await imageStore.resolve(refs) : {};
      const { missingImages } = await exportPng(doc, geom, theme, safeDocTitle(doc, titleParam), { ...imageUrls, ...extra });
      if (missingImages > 0) setImageNotice(`이미지 ${missingImages}장을 PNG에 담지 못했어요 — 연결을 확인하고 다시 시도해 주세요`);
    })();
  }, [doc, geom, theme, titleParam, imageUrls, imageStore]);
  /** 마크다운 개요로 내보낸다(코어 `toMarkdown`). 무손실 백업은 JSON이고, 이건 다른
   * 도구로 옮기거나 사람이 읽는 용도다 — 가져오기가 이 형식을 되읽는다(노트·자유
   * 도형·메모까지, `parseOutline` 참고). */
  const exportMarkdown = useCallback(() => {
    downloadFile(`${safeDocTitle(doc, titleParam)}.md`, toMarkdown(doc), 'text/markdown');
  }, [doc, titleParam]);

  const docTitle = laidOutNodes[ROOT_ID]?.text || titleParam || '새 마인드맵';

  return {
    doc,
    hydrating,
    canvasReady,
    loadError,
    bodyMissing,
    retryLoad: () => {
      if (typeof window !== 'undefined') window.location.reload();
    },
    theme,
    uiTheme: UI_THEME,
    themeKey: themeKeyOf(doc.themeKey),
    layoutMode: doc.layoutMode,
    edgeStyle,
    view,
    pan: viewport.pan,
    zoom: viewport.zoom,
    zoomPct: Math.round(viewport.zoom * 100),
    vw: viewport.vw,
    vh: viewport.vh,
    geom,
    floatHeights,
    mapId,
    docTitle,
    setViewportEl,
    setLayoutMode,
    setEdgeStyle,
    setThemeKey,
    setView,
    onBackgroundPointerDown,
    zoomIn,
    zoomOut,
    fitView,
    goHome,

    presence,
    reportPointerPosition,
    clearPointerPosition,

    selection,
    selectNode,
    selectFloat,
    selectLine,
    selectZone,
    clearSelection,

    propsOpen,
    openProps,
    closeProps,

    multiSelection,
    multiGroups,
    marquee,

    showMinimap,
    toggleMinimap,
    panToCanvasPoint,
    searchOpen,
    setSearchOpen,
    helpOpen,
    setHelpOpen,
    feedbackOpen,
    setFeedbackOpen,
    commentsOpen,
    commentsNodeId,
    openComments,
    closeComments,
    comments,
    commentCounts,
    commentsLoading,
    addComment,
    removeComment,
    canComment,
    historyOpen,
    setHistoryOpen,
    historyDocId: docStoreId,
    restoreVersion,
    searchMarks,
    setSearchMarks,
    centerObjectAboveSheet,

    attachTarget,

    outlineEditId,
    outlineStartEdit,
    outlineCommitEdit,
    outlineAddChild,
    outlineAddSibling,
    outlineIndent,
    outlineOutdent,

    editingNodeId,
    resizingNodeId,
    editingFloatId,
    editingLineId,
    editingZoneId,
    editingTitle,
    startEditNode,
    commitNodeText,
    commitNodeRichText,
    updateNodeEditSize,
    cancelNodeEdit,
    textCtx,
    openTextCtx,
    refreshTextCtxAnchor,
    closeTextCtx,
    setRichEditorEl,
    noteEditCaret,
    applyPartial,
    applyListOp,
    applyListEdits,
    selectionRange,
    applyPartialRange,
    selectionLink,
    pauseBlurCommit,
    isBlurCommitPaused,
    startEditFloat,
    commitFloatText,
    commitFloatRichText,
    cancelFloatEdit,
    startEditLineLabel,
    commitLineLabel,
    cancelLineLabelEdit,
    startEditZoneLabel,
    commitZoneLabel,
    cancelZoneLabelEdit,
    startEditTitle,
    commitTitle,
    cancelTitleEdit,

    addChild,
    addSibling,
    deleteSelection,
    copySelection,
    cutSelection,
    pasteClipboardAt,
    /** 붙여넣을 내용이 있는지 — 메뉴에 '붙여넣기'를 노출할지 판단용. */
    canPaste: clipboardSize > 0,
    /** 클립보드에 담긴 객체 수 — 메뉴 라벨("붙여넣기 (N개)")용. */
    clipboardSize,
    toggleCollapse,
    addFreeNodeAt,
    addFloatAt,
    addLineAt,
    addZoneAt,
    promptAddImage,
    addImageFloatFromFile,
    promptNodeImage,
    clearNodeImage,

    setShape,
    setColor,
    setFill,
    setStroke,
    setFillAlpha,
    setStrokeAlpha,
    setTextColor,
    toggleNodeBold,
    toggleNodeRichStyle,
    setNodeTsize,
    setEmoji,
    clearEmoji,
    setNote,
    setTextAlign,

    setFloatBg,
    toggleFloatBold,
    toggleFloatRichStyle,
    setFloatTsize,
    setFloatTextColor,
    toggleFloatCollapse,
    deleteFloat,

    setLineDashed,
    setLineArrow,
    setLineCurve,
    toggleLineBold,
    setLineTsize,
    setLineTextColor,
    deleteLine,
    resolveLine: resolveLineLive,
    lineGeometry: lineGeometryLive,
    lineSnap,
    lineSnapBox,

    setZoneColor,
    deleteZone,

    ctxMenu,
    ctxSub,
    onContextMenu,
    closeCtxMenu,
    openCtxMenuForSelection,
    toggleCtxSub,

    beginNodeDrag,
    beginNodeResize,
    resetNodeSize,
    beginFloatDrag,
    beginFloatResize,
    beginZoneDrag,
    beginZoneResize,
    beginLineDrag,
    beginLineEndDrag,
    beginLineCurveDrag,
    beginMoveSelected,
    dragGhost,
    groupGhost,

    canUndo: historyRef.current.canUndo(),
    canRedo: historyRef.current.canRedo(),
    undo,
    redo,
    saveState,
    saveNow,
    flushSave,
    saveConflict,
    movedNotice,
    dismissMovedNotice,
    imageNotice,
    dismissImageNotice,
    dismissSaveConflict,
    exportJSON,
    exportPNG,
    exportMarkdown,
    shareOpen,
    openShare: () => setShareOpen(true),
    closeShare: () => setShareOpen(false),
    docId: docStoreId,
    shareStore,
    backendMode,
    readOnly,
    collabStatus,
    imageUrls,
    sharedDoc,
    collabBlocked,
    collabPaused,
  };
}

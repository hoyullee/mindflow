import type { NodeMetrics } from './metrics';

/** A visible node's resolved on-screen box — layout position + metrics. */
export interface NodeGeom extends NodeMetrics {
  x: number;
  y: number;
  depth: number;
}

export type GeomMap = Record<string, NodeGeom>;

export type ViewMode = 'map' | 'outline';

export interface PanState {
  x: number;
  y: number;
}

/** What the property panel (and Delete/F2/Tab/Enter) currently targets.
 * `'stroke'`는 화이트보드의 그리기 획(M4) — 글자도 자식도 없어 편집·리스트 경로에는
 * 등장하지 않고 선택·이동·색/굵기·삭제만 받는다. */
export type SelectionKind = 'node' | 'float' | 'line' | 'zone' | 'stroke';

export interface Selection {
  kind: SelectionKind;
  id: string;
}

/** Doc-chip save indicator — port of `Component#state.saveState` (MindFlow.dc.html:502). */
/** `unsaved` = 아직 어디에도 저장된 적 없는 문서(새 맵 진입 직후, 초기 로드
 * 확정 전) — '저장됨'이 거짓말이 되지 않도록 별도 상태로 구분한다. 신규 확정
 * 시 시드가 즉시 1회 저장되므로 보통 순식간에 `saving → saved`로 넘어간다. */
export type SaveState = 'saved' | 'dirty' | 'saving' | 'unsaved';

/** Which endpoint/curvature handle a line drag targets — 1 = start, 2 = end. */
export type LineHandle = 1 | 2;

/** Marquee (rubber-band) multi-selection — port of `Component#state.msel`
 * (MindFlow.dc.html:577, 1548-1556): zones are intentionally excluded, matching
 * the original (zones are never part of `msel`).
 *
 * `strokes`는 화이트보드의 그리기 획(요청: "드래그해서 그리기 객체를 선택").
 * post-dc 추가라 dc 원본에는 없다 — 필수 필드로 둔 이유는, 옵셔널이면 새로
 * 만드는 자리마다 조용히 빠져 "화면엔 선택됐는데 삭제가 안 되는" 유령 상태가
 * 생기기 때문이다(1개짜리 다중 선택에서 이미 겪은 함정). */
export interface MultiSelection {
  nodes: string[];
  lines: string[];
  floats: string[];
  strokes: string[];
}

/** In-progress marquee rectangle, in canvas (untransformed) coordinates. */
export interface MarqueeRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The drop target a dragged node is currently hovering — port of `Component#_attachHi`
 * (MindFlow.dc.html:1752, `findAttachTarget`'s return shape). */
export interface AttachTarget {
  id: string;
  zone: 'child' | 'above' | 'below';
}

/** What a right-click hit-tested — port of `Component#hitTestAll`'s return shape
 * (MindFlow.dc.html:2815-2836). Priority mirrors the visual stacking: float > zone > line > node.
 * 획(`'stroke'`)은 **맨 마지막**이다 — 잉크는 객체 위에 그려지지만(#411), 시각
 * 순서를 그대로 따르면 하이라이터로 덮은 메모가 통째로 안 잡힌다. 잉크는 보통
 * 빈 자리에 있어 마지막 순서로도 충분히 집힌다. */
export interface HitResult {
  kind: 'node' | 'float' | 'line' | 'zone' | 'stroke';
  id: string;
}

/** The right-click context menu's kind — port of `Component#state.ctxMenu.kind`
 * (MindFlow.dc.html:2792-2813): which object (if any) the click landed on, resolved
 * BEFORE the menu opens (`openCtxAt` also selects that object as a side effect,
 * except for `'bg'`/`'multi'`, matching the original). */
export type ContextMenuKind = 'node' | 'float' | 'line' | 'zone' | 'stroke' | 'multi' | 'bg';

/** Right-click context menu state — port of `Component#state.ctxMenu`
 * (MindFlow.dc.html:2792-2813, 3101-3146). `sx/sy` are screen (viewport-relative)
 * coordinates used to position the menu; `cx/cy` are canvas (untransformed)
 * coordinates, used by the `'bg'` kind's "추가" items to place the new object at
 * the exact spot that was right-clicked. */
export interface ContextMenuState {
  kind: ContextMenuKind;
  sx: number;
  sy: number;
  cx: number;
  cy: number;
  /** 모바일 선택 바의 '메뉴(⋯)'에서 열렸을 때만 채워진다 — 바에서 뻗어 나온
   * 팝오버처럼 보이도록 바의 위/아래 변과 ⋯ 버튼의 중심 x를 넘겨받아, 메뉴를
   * 바에 붙여 놓고 그쪽을 가리키는 꼬리(caret)를 그린다. 우클릭/길게 누르기로
   * 열렸을 때는 없음(클릭 지점에 그대로 뜬다). 좌표계는 `.mf-ed-vp` 기준. */
  anchor?: { x: number; top: number; bottom: number };
}

/** The "텍스트 정렬 ▸" flyout submenu's own open/position state — port of
 * `Component#state.ctxSub` (MindFlow.dc.html:3120, 3149-3155). `top` is the
 * parent row's `offsetTop`, used to vertically anchor the flyout next to it. */
export interface ContextSubState {
  top: number;
}

/** The floating partial-style toolbar's open/position state — port of
 * `Component#state.textCtx` (MindFlow.dc.html:2782, 3088-3099). `sx/sy` are
 * screen (viewport-relative) coordinates, same space as `ContextMenuState`'s
 * `sx/sy`. The original opens this from a right-click INSIDE an active text
 * selection; this port opens it directly off a drag-selection inside the
 * node editor instead (a more natural gesture for mouse AND touch — see
 * `TextToolbar.tsx`'s doc comment). */
export interface TextCtxState {
  sx: number;
  sy: number;
}

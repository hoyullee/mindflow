// Pure data-model types for the MindFlow document.
//
// These mirror the JSON shapes the original dc prototype
// (`MindFlow.dc.html`) reads/writes via `serializeDoc()` / `loadDoc()` —
// see `packages/mindmap-core/test/fixtures/README.md` for the fixture-backed
// schema description this file is derived from.
//
// Scope note (M1a): this file intentionally does NOT model layout-only
// concerns beyond passthrough fields. `side` is written by `_layout`
// (MindFlow.dc.html:977) but nodes may already carry it in a previously
// laid-out, persisted doc, so it is typed here as an optional passthrough
// field even though M1a does not compute it.

import type { PortSide } from './geometry';

/** The three layout algorithms the original app supports (MindFlow.dc.html:496,522-523 default 'radial'). */
export type LayoutMode = 'radial' | 'right' | 'down';

/** Connector (edge) rendering style — the Style menu's 연결선 option
 * (MindFlow.dc.html:463, 1097). Persisted with the doc, like `layoutMode`. */
export type EdgeStyle = 'curve' | 'elbow' | 'straight';

/**
 * One styled text run inside a node's rich-text body.
 * Observed shape: `{ t: text, b?: bold, c?: color }` (MindFlow.dc.html:2612, 2646, 2727).
 *
 * `i`(기울임)·`s`(취소선)는 post-dc 순수 추가(마크다운 서식 지원) — 원본에는
 * 없던 키라서 **true일 때만** 직렬화에 실린다(runs 재구성 시 생략 — charsToRuns
 * 참고). 옛 문서/골든과의 무회귀, CRDT(제네릭 필드 통과) 모두 그대로다.
 */
export interface RichRun {
  t: string;
  b?: boolean;
  c?: string | null;
  /** 기울임 (`*x*`/`_x_`). */
  i?: boolean;
  /** 취소선 (`~~x~~`). */
  s?: boolean;
  /** 하이퍼링크 대상 — post-dc 순수 추가. **값이 있을 때만** 직렬화에 실린다
   * (`i`/`s`와 같은 규칙). 저장 전에 `normalizeUrl`을 통과한 값만 들어오므로
   * `http`/`https`/`mailto` 스킴만 존재한다(`javascript:` 등은 차단). */
  href?: string;
  /** 인라인 멘션 대상 이메일 — post-dc 순수 추가. 표시 글자는 `t`("@이름")이고
   * 이 필드는 알림·강조의 근거다. **값이 있을 때만** 직렬화에 실린다(`href`와
   * 같은 규칙 — 옛 문서·골든·CRDT 무회귀). */
  m?: string;
}

/**
 * A mind-map node (tree node, or a "free" standalone shape when `free: true`).
 *
 * Required fields observed on every node in `serializeDoc()` output
 * (MindFlow.dc.html:491, 505, 534): id/text/emoji/parent/children/collapsed/color/x/y.
 * Everything else is optional styling/content state set by various mutators
 * throughout the controller (see the mapping table in the M1a extraction report).
 */
export interface Node {
  id: string;
  text: string;
  emoji: string;
  parent: string | null;
  children: string[];
  collapsed: boolean;
  color: string | null;
  x: number;
  y: number;

  /** Marks a standalone ("free") shape not part of the root tree (MindFlow.dc.html:101 fixture, 1081). */
  free?: boolean;
  /** Rich-text runs; `null` clears back to plain `text` (MindFlow.dc.html:2612, 2727). */
  rich?: RichRun[] | null;
  bold?: boolean;
  /** Font-size override: 's' small / 'l' large (MindFlow.dc.html:2731 setNodeTsize, render 689/919/2978). */
  tsize?: 's' | 'l';
  shape?: string;
  align?: string;
  fill?: string | null;
  stroke?: string | null;
  fillA?: number;
  strokeA?: number;
  textColor?: string | null;
  note?: string;
  /** User-resized width/height override, cleared via `delete` when unset (MindFlow.dc.html:1620, 1674-1675). */
  cw?: number;
  ch?: number;
  /**
   * 노드 이미지(post-dc 확장): 텍스트 위에 표시되는 썸네일의 데이터 URL과
   * 표시 크기(px, 첨부 시 비율 유지로 계산). `sizeOf` 구현(웹 metrics)이
   * `imgW`/`imgH`만큼 박스를 키우므로 레이아웃은 자동 반영된다. 셋은 항상
   * 함께 설정/해제된다. 직렬화·CRDT는 passthrough(순수 추가).
   */
  img?: string;
  imgW?: number;
  imgH?: number;
  /** Which side of the root a node landed on; written by `_layout`, out of scope for M1a. */
  side?: 'L' | 'R';
}

export type NodeMap = Record<string, Node>;

/** A free-floating memo card (MindFlow.dc.html:2258). */
export interface Float {
  id: string;
  x: number;
  y: number;
  w: number;
  text: string;

  /** User-resized height (MindFlow.dc.html:1681 float-resize drag). */
  h?: number;
  /** Collapsed memo (MindFlow.dc.html:2284 toggleFloatCollapse, render 644). */
  collapsed?: boolean;
  /** Background color override (MindFlow.dc.html:2737 setFloatBg). */
  bg?: string;
  /** Bold text (MindFlow.dc.html:2734 toggleFloatBold). */
  bold?: boolean;
  /** Text color override (MindFlow.dc.html:2736 setFloatTextColor). */
  textColor?: string;
  /** Font-size override: 's' small / 'l' large (MindFlow.dc.html:2735 setFloatTsize). */
  tsize?: 's' | 'l';
  /**
   * Image float (post-dc extension, not in the original prototype): a data
   * URL. When set the float renders as an image card (w×h box, aspect kept
   * by the editor) instead of a memo — text/collapse/bold styling fields are
   * ignored by renderers. Stored inline in the doc (client-side resized at
   * attach time) so save/sync/offline/export all work unchanged; absent on
   * every pre-existing doc, so serialization stays a pure passthrough.
   */
  img?: string;
  /**
   * 이미지 플로트의 짧은 제목(post-dc 순수 추가, 화이트보드 요청) — 이미지
   * 아래 한 줄 캡션으로 그려진다. `img`가 없는 메모 플로트에서는 무시된다.
   * 값이 있을 때만 존재(직렬화·CRDT 제네릭 통과 — 옛 문서 무회귀).
   */
  caption?: string;
  /**
   * 부분 리치텍스트 런(post-dc 순수 추가) — 노드의 `Node.rich`와 같은 모델을
   * 메모에 이식한 것. `text`와 항상 같은 문자열로 합쳐지는 런 배열이고, 서식이
   * 있을 때만 존재한다(평문 메모는 `null`/부재 — 옛 문서·직렬화·CRDT 모두
   * 제네릭 통과라 무회귀).
   */
  rich?: RichRun[] | null;
}

/**
 * A free connector line's "magnetic" endpoint anchor — port of the shape
 * `findSnap()`/`onLineEndDown` build and `resolveEnd()` consumes
 * (MindFlow.dc.html:2403-2419, 2442-2454): which target (a tree/free node's
 * `_geom` box, or a float's box) an endpoint is pinned to, and optionally
 * which of its 4 ports (side). `side` is omitted for legacy anchors that
 * predate the port system — `resolveEnd` falls back to a border-point toward
 * the other end for those (MindFlow.dc.html:2408-2412).
 */
export interface LineAnchor {
  kind: 'node' | 'float';
  id: string;
  side?: PortSide;
}

/** A connector line between arbitrary points/nodes (MindFlow.dc.html:2460). */
export interface Line {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  startArrow: boolean;
  endArrow: boolean;
  dashed: boolean;
  c1: number;
  c2: number;
  label: string;

  /** Line color override; falls back to theme accent (MindFlow.dc.html:701 render). */
  color?: string;
  /** Legacy single-curvature field, migrated into c1/c2 on read (MindFlow.dc.html:1743, 2421-2422). */
  curve?: number;
  /** Label text color override (MindFlow.dc.html:2741 setLineTextColor). */
  ltextColor?: string;
  /** Bold label (MindFlow.dc.html:2739 toggleLineBold). */
  lbold?: boolean;
  /** Label font-size override: 's' small / 'l' large (MindFlow.dc.html:2740 setLineTsize). */
  lsize?: 's' | 'l';
  /**
   * Magnetic anchor for endpoint 1/2 — `x1/y1`/`x2/y2` remain the raw
   * last-dropped coordinates (used when unanchored, or as a fallback when the
   * anchor target vanishes); when set, the endpoint's actual on-screen
   * position is resolved from the target box instead (`resolveEnd`,
   * MindFlow.dc.html:2403-2412). `null` explicitly means "detached" (a drag
   * that ended away from any port), distinct from `undefined` (never
   * anchored) — both render as a plain raw-coordinate endpoint.
   */
  a1?: LineAnchor | null;
  a2?: LineAnchor | null;
}

/** A background grouping rectangle (MindFlow.dc.html:2300). */
export interface Zone {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  color: string | null;
}

/**
 * 자유 그리기 획(화이트보드 M4, post-dc 순수 추가) — 펜을 떼는 순간 확정되는
 * **원자 값**이다: 그린 뒤 내용이 공동 편집되는 일이 없다(지워지거나 남거나 둘뿐).
 * 그래서 CRDT에서 획 하나가 통째로 하나의 항목이고, 배열 충돌의 여지가 없다.
 * `pts`는 `[x0,y0,x1,y1,…]` 평탄 배열 — 문서(JSON)와 CRDT 양쪽에서 콤팩트하다.
 */
export interface Stroke {
  id: string;
  pts: number[];
  color: string;
  /** 선 굵기(px, 캔버스 단위). */
  w: number;
  /**
   * 하이라이터(형광펜) 획 — **true일 때만** 직렬화·CRDT 전파(`kind`·`Float.caption`과
   * 같은 규칙이라 기존 저장본·골든은 바이트 하나 안 변한다). 값 자체는 "무엇으로
   * 그렸는가"만 말하고, 반투명·곱하기 합성 같은 **표현은 소비처가 정한다**
   * (에디터 렌더·PNG/SVG/PDF·홈 썸네일이 각자 자기 매체의 방식으로).
   */
  hl?: boolean;
}

/**
 * 스티커 반응·투표(post-dc 순수 추가, 화이트보드 회고용).
 *
 * **한 사람의 한 표가 하나의 항목**이다 — 획(`Stroke`)과 같은 원자 값 설계이고,
 * 이유도 같다: CRDT에서 배열·객체 필드는 통째로 LWW라(중첩 Y.Map이 아니다) 표를
 * `{ [email]: n }` 같은 **한 값**에 담으면, 끊긴 채 두 사람이 동시에 누를 때 한쪽
 * 표가 통째로 사라진다(#332). 항목으로 두면 추가·삭제가 각각 병합돼 표가 합쳐진다.
 *
 * `target`은 대상 객체의 id(메모·주제 불문 — id가 문서 안에서 유일하다, 댓글과
 * 같은 규칙). `by`는 누른 사람의 식별자(로그인 이메일, 없으면 로컬 표시자)라
 * **한 사람이 같은 대상·같은 이모지에 한 번만** 누른 것으로 셀 수 있다.
 */
export interface Reaction {
  id: string;
  target: string;
  by: string;
  /** 표시 이름(스냅샷) — 누가 눌렀는지 툴팁에 쓴다. 없으면 by를 쓴다. */
  byName?: string;
  /** 이모지 한 글자. 점 투표는 약속된 한 글자(`VOTE_EMOJI`)를 쓴다. */
  emoji: string;
}

/** 점 투표에 쓰는 약속된 이모지 — 반응과 같은 모델이되 렌더만 점+개수로 다르다. */
export const VOTE_EMOJI = '\u25CF';

/**
 * 문서 종류(post-dc 순수 추가). `'board'` = 화이트보드 — 트리(nodes) 없이
 * 메모·이미지 플로트만 자유 배치하는 보드(`nodes`는 빈 객체). 부재 = 기존
 * 마인드맵. 값이 `'board'`일 때만 직렬화·CRDT 전파되므로(`RichRun.href`와
 * 같은 규칙) 기존 문서·골든 픽스처는 바이트 하나 변하지 않는다.
 */
export type DocKind = 'map' | 'board' | 'kanban';

/**
 * 칸반 열 — 문서 종류 `'kanban'`에서만 쓰인다.
 *
 * 열의 **순서**는 배열 순서(`Doc.columns`)다: 열은 자주 바뀌지 않고, CRDT에서도
 * 엔티티 목록(Y.Array)으로 병합되므로 카드처럼 정밀한 순서 값이 필요 없다.
 */
export interface KanbanColumn {
  id: string;
  title: string;
  /** 열 머리 색(없으면 테마 기본). */
  color?: string | null;
}

/**
 * 칸반 카드.
 *
 * 순서는 열 안에서 **`pos` 분수 인덱스**다(두 이웃의 중간값을 준다). 배열로 들면
 * 끊긴 채 두 사람이 카드를 옮길 때 한쪽 순서가 통째로 사라지는데(#332의 배열 필드
 * 한계), `pos`는 카드 자신의 **필드**라 서로 다른 카드를 옮기면 둘 다 살아남는다.
 */
export interface KanbanCard {
  id: string;
  /** 소속 열 id — 열이 사라지면 그 카드도 함께 지운다(앱이 정리). */
  col: string;
  /** 열 안 순서(작을수록 위). 이웃 사이 중간값으로 끼워 넣는다. */
  pos: number;
  text: string;
  /** 부분 서식 — 메모·주제와 같은 rich 런 모델을 그대로 쓴다. */
  rich?: RichRun[];
  /** 카드 배경(없으면 기본). */
  bg?: string | null;
}

/**
 * The full serializable document, matching `serializeDoc()` 1:1
 * (MindFlow.dc.html:534-536).
 */
export interface Doc {
  v: 1;
  nodes: NodeMap;
  floats: Float[];
  lines: Line[];
  zones: Zone[];
  layoutMode: LayoutMode;
  themeKey: string;
  /** Connector style. Optional so hand-built `Doc` literals need not set it;
   * `serializeDoc`/`parseDoc` always normalize it to a concrete value. */
  edgeStyle?: EdgeStyle;
  /** 문서 종류 — `'board'`일 때만 존재(위 {@link DocKind} 참고). */
  kind?: DocKind;
  /** 자유 그리기 획들(화이트보드 M4) — **비어 있지 않을 때만** 직렬화·CRDT 전파
   * (`kind`와 같은 규칙 — 골든·기존 저장본 무변경). */
  strokes?: Stroke[];
  /** 스티커 반응·투표 — 획과 같은 규칙(비어 있지 않을 때만 직렬화·전파). */
  reactions?: Reaction[];
  /** 칸반 열 — `kind === 'kanban'`일 때만(다른 종류에서는 없다). */
  columns?: KanbanColumn[];
  /** 칸반 카드 — 열과 같은 규칙. */
  cards?: KanbanCard[];
}

/**
 * The root node id is a fixed constant in the original app
 * (`this.rootId = 'root'`, MindFlow.dc.html:467) — it is never persisted or
 * derived, just hardcoded once at construction time.
 */
export const ROOT_ID = 'root';

/** Default layoutMode applied when a loaded doc omits it (MindFlow.dc.html:496, 522-523). */
export const DEFAULT_LAYOUT_MODE: LayoutMode = 'radial';

/** Default connector style when a loaded doc omits it (MindFlow.dc.html:497, 524). */
export const DEFAULT_EDGE_STYLE: EdgeStyle = 'curve';

/** Default themeKey applied when a loaded doc omits it (MindFlow.dc.html:495, 522). */
export const DEFAULT_THEME_KEY = 'coral';

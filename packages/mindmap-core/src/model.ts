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
  /**
   * 아래 셋은 **공책**(`DocKind` `'note'`)의 본문 서식이다 — 밑줄 · 인라인 코드 ·
   * 형광펜 색. 맵·보드의 노드에는 이 서식을 넣는 길이 없지만 런 타입을 갈라 두지
   * 않는다: 같은 글을 두 모델로 들면 마크다운 변환·검색·CRDT 병합이 두 벌이 된다.
   *
   * `href`와 **같은 규칙**으로 값이 있을 때만 직렬화에 실리므로, 이 셋이 생겨도
   * 기존 맵 저장본과 골든 픽스처는 바이트 하나 변하지 않는다.
   */
  u?: boolean;
  /** 인라인 코드(고정폭). `b`/`i`와 겹쳐 쓸 수 있다. */
  k?: boolean;
  /** 형광펜 — 약속된 색 키(`noteHighlightColor`가 실제 색으로 바꾼다). */
  hl?: string;
  /**
   * **날짜 칩** — 이 런이 가리키는 날짜(`YYYY-MM-DD`). 공책 본문의 인라인 날짜다.
   *
   * 표시 글자는 `t`(`8월 27일 목`)이고 이 필드는 **뜻**이다 — 호버하면 그날 일정을
   * 보여 주고, 요일 계산·일정 조회가 전부 이 값으로 돈다. 멘션(`m`)이 표시 글자와
   * 이메일을 갈라 든 것과 **같은 결**이다: 글자는 사람이 읽는 것이고 필드는 기계가
   * 읽는 것이라, 표기 규칙이 바뀌어도 가리키는 날은 변하지 않는다.
   *
   * `href`와 같은 규칙으로 **값이 있을 때만** 직렬화에 실린다.
   */
  dt?: string;
  /**
   * **문서 안 페이지 링크** — `"<docId>:<pageId>"`.
   *
   * `href`에 담지 않는 이유가 중요하다: `href`는 저장 전에 `normalizeUrl`을 지나
   * `http`/`https`/`mailto`만 남는다(`javascript:` 차단 장치가 거기 걸려 있다).
   * 앱 안의 이동을 담으려고 그 화이트리스트를 넓히면 **그 방어가 함께 헐거워진다**.
   * 공책에 이미 있는 문서 링크 블록(`NoteBlock.docId`)과 같은 결로, 주소가 아니라
   * **가리키는 것의 id**를 든다.
   */
  pg?: string;
  /**
   * **본문 댓글이 걸린 자리** — 그 스레드의 id(형광 표시 `comment mark`, 스펙 6절).
   *
   * 글자 서식이 아니라 **바깥 것을 가리키는 표식**이다(`m`·`dt`·`pg`와 같은 갈래).
   * 스레드 자체 — 누가 무엇을 썼고 해결했는가 — 는 본문이 아니라 댓글 저장소에
   * 있다(0020의 설계 메모: 댓글은 본문과 수명이 다르고, CRDT 병합 대상이 되면
   * 안 된다). 본문이 드는 것은 **어디에 걸렸는가**뿐이라, 글을 고치면 표식이
   * 글자를 따라가고 글이 통째로 지워지면 표식도 함께 사라진다.
   *
   * 그래서 「서식 지우기」는 이것을 **걷지 않는다** — 댓글은 서식이 아니고, 걷으면
   * 스레드가 말없이 자리를 잃는다(`applyPartialStyle`의 `clear` 주석).
   */
  cm?: string;
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
 * 메모·이미지 플로트만 자유 배치하는 보드(`nodes`는 빈 객체). `'kanban'` = 열과
 * 카드. `'note'` = **공책** — 캔버스가 아니라 **페이지 여러 장의 글**이다
 * (`nodes`·`floats`가 비고 {@link NotePage} 목록이 본문이다). 부재 = 기존
 * 마인드맵. 값이 기본이 아닐 때만 직렬화·CRDT 전파되므로(`RichRun.href`와
 * 같은 규칙) 기존 문서·골든 픽스처는 바이트 하나 변하지 않는다.
 */
export type DocKind = 'map' | 'board' | 'kanban' | 'note';

/* ── 공책 ───────────────────────────────────────────────────────────────────
 * 문서 종류 `'note'`. 다른 셋과 근본적으로 다른 점 하나: **캔버스가 아니다.**
 * 좌표도 줌도 없고, 한 문서(=공책 한 권) 안에 **페이지 여러 장**이 순서대로 있고
 * 페이지가 블록의 목록이다. 그래서 `nodes`·`floats`·`lines`·`zones`는 빈 채로 남고
 * 레이아웃 알고리즘도 지나지 않는다.
 */

/**
 * 블록 종류. **한 번에 다 적어 두는 이유**: 직렬화 모양이 곧 저장본이라, 나중에
 * 종류를 더하면 옛 공책을 읽는 길을 또 만들어야 한다. 렌더·편집이 아직 닿지 않는
 * 종류가 있어도(2판 몫) 모델은 여기서 확정한다 — 만드는 길이 없으면 문서에 들어갈
 * 일도 없으므로 안전하고, 그때 형식을 갈아엎지 않아도 된다.
 */
export type NoteBlockKind =
  | 'p'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'ul'
  | 'ol'
  | 'ck'
  | 'q'
  | 'code'
  | 'hr'
  | 'table'
  | 'link'
  | 'callout'
  | 'toggle'
  | 'img';

/** 콜아웃 어조 — 디자인의 `주의 · 결정 · 질문`. */
export type NoteCalloutTone = 'warn' | 'decide' | 'ask';

/** 표지 스케치 — 디자인의 `SKETCHES`. */
export type NoteSketch = 'grid' | 'list' | 'clip' | 'bulb' | 'chart' | 'none';

/** 목록·체크리스트의 한 항목. */
export interface NoteListItem {
  id: string;
  runs: RichRun[];
  /** 체크리스트(`'ck'`)에서만 뜻이 있다 — 켜짐 여부. */
  done?: boolean;
  /**
   * **항목의 들여쓰기 단계**(없으면 0. Tab·Shift+Tab으로 바꾼다).
   *
   * 블록에도 `indent`가 있지만 그것은 **목록 전체**를 미는 값이다 — 목록 안에서
   * 항목 하나만 한 단계 들이는 것은 여기다(문서 편집기의 몸에 익은 Tab이 하는 일).
   * 마커도 이 값을 따라 갈린다(`listMarkers`): `•`→`◦`→`▪`, `1.`→`a.`→`i.`.
   */
  indent?: number;
}

/**
 * 페이지 본문의 한 덩이.
 *
 * 종류마다 쓰는 칸이 다르다(전부 선택) — 한 인터페이스로 두는 것은 블록 목록이
 * **한 배열**이어야 순서를 다루기 쉽고, 종류별 유니온으로 가르면 순서 바꾸기·
 * 종류 바꾸기가 타입 분기 덩어리가 되기 때문이다. 어느 칸을 보는지는
 * `noteBlockShape`가 한곳에서 답한다.
 */
/**
 * 본문에 편 보드의 **보기 상태**(`NoteBlock.embed`) — 종류마다 쓰는 칸이 다르다.
 *
 * 값이 통째로 없으면 기본은 **펼친 보기**(`lg`)다: 한 줄 링크로는 "그 보드의 지금
 * 상태"를 알 수 없고, 본문에 붙이는 이유가 그것이기 때문이다(스펙 §1).
 */
export interface NoteEmbedView {
  /** `lg` 펼침(기본) · `sm` 한 줄 카드. */
  size?: 'sm' | 'lg';
  /** 칸반 — 보고 있는 열의 차례(0부터)와 「내 카드만」. */
  kanban?: { col: number; mine: boolean };
  /** 마인드맵 — 개요/맵과 펼쳐 둔 가지의 차례들. */
  mindmap?: { view: 'outline' | 'map'; open: number[] };
  /** 화이트보드 — 고른 프레임의 차례(0 = 전체)와 창 높이. */
  whiteboard?: { frame: number; height: 's' | 'm' | 'l' };
}

export interface NoteBlock {
  id: string;
  kind: NoteBlockKind;
  /** 문단·제목·인용·코드·콜아웃·토글 머리의 본문. */
  runs?: RichRun[];
  /** `ul`·`ol`·`ck`의 항목들. */
  items?: NoteListItem[];
  /**
   * 번호 목록이 **몇 번부터** 시작하는가(`ol`에서만, 없으면 1).
   *
   * 본문에서 `3.`을 치고 띄어쓰면 3번부터 매겨진다(요청) — 앞 목록에서 이어 쓰는
   * 흔한 경우를 위한 값이다. 1이면 적지 않는다(기본값은 문서에 남기지 않는다).
   */
  start?: number;
  /**
   * `table` — 행 × 칸. **모든 칸이 같은 보통 칸**이다(요청) — 예전에는 첫 행을
   * 머리글로 진하게 세웠는데, 표를 목록으로 쓰는 경우가 더 많아 첫 줄만 다르게
   * 보이는 것이 오히려 잘못 읽혔다. 마크다운으로 내보낼 때만 첫 행을 헤더 줄로
   * 적는다(그 문법에 헤더가 필수라서이지, 모델에 머리가 있어서가 아니다).
   */
  rows?: RichRun[][][];
  /** `table` — **열별 가로 정렬**(없으면 왼쪽). 길이가 열 수보다 짧아도 된다. */
  colAlign?: ('left' | 'center' | 'right')[];
  /**
   * `table` — **행별 가로 정렬**. 행을 골라 정렬을 거는 길이 생기면서 필요해졌다(제보).
   *
   * 한 칸이 두 규칙에 걸릴 수 있다(그 행에도, 그 열에도 값이 있다). 그때는 **행이
   * 이긴다** — 행은 대개 "이 한 줄만 가운데로"처럼 **예외를 만들려고** 거는 것이고,
   * 열은 그 칸 전체의 성격(숫자는 오른쪽)을 말하는 기본값이기 때문이다.
   * 읽는 쪽은 `rowAlign[r] ?? colAlign[c] ?? 'left'` 하나로 정한다.
   */
  rowAlign?: ('left' | 'center' | 'right')[];
  /**
   * `table` — **손으로 정한 열 너비**(px). 없으면 글에 맞춰 브라우저가 정한다.
   *
   * 한 열만 끌어도 **전체를 적는다**: 고정 레이아웃(`table-layout: fixed`)으로 넘어가는
   * 순간 나머지 열도 값을 가져야 하고, 그러지 않으면 손대지 않은 열이 제멋대로 줄어든다.
   */
  colW?: number[];
  /** `table` — **손으로 정한 행 높이**(px, 최소값). 글이 길면 그보다 커진다. */
  rowH?: number[];
  /**
   * `table` — **채움색**(키 → hex). 칠하지 않은 표에는 이 칸 자체가 없다(저장본 무변화).
   *
   * 키는 네 가지다 — `c{행}:{열}`(칸 하나) · `r{행}`(행 전체) · `k{열}`(열 전체) ·
   * `all`(표 전체). 읽을 때는 **좁은 것이 이긴다**(칸 > 행 > 열 > 전체 — `fillAt`).
   * 행·열·전체를 한 키로 두는 이유는 그 색이 "이 행의 색"이라는 뜻을 잃지 않기
   * 때문이다: 칸마다 풀어 적으면 나중에 열을 하나 더할 때 새 칸만 비어 남는다.
   *
   * 2차원 배열이 아니라 **성긴 표**인 이유: 대개 몇 칸만 칠하고, 행·열을 넣고 빼도
   * 키만 옮기면 되기 때문이다(그 옮기는 일은 `shiftFills`가 함께 한다). 옛 저장본의
   * 접두사 없는 `"행:열"`도 칸으로 읽고, 다음에 칠할 때 새 형식으로 옮겨 적는다.
   */
  fills?: Record<string, string>;
  /** `link` — 이 앱의 다른 문서 id(마인드맵·화이트보드·칸반). */
  docId?: string;
  /**
   * `link` — **본문에 편 보드의 보기 상태**(보드 임베드 스펙 §2).
   *
   * 왜 문서에 저장하나: 고른 열·펼친 가지·프레임은 "이 글이 무엇을 가리키는가"의
   * 일부다 — 회의록에 칸반을 붙인 사람은 대개 **그 열**을 보여 주려고 붙인다.
   * 그래서 다른 사람이 열어도 같은 보기가 되도록 블록에 남긴다.
   *
   * 반대로 **남기지 않는 것**: 화이트보드의 팬·줌 자리(세션 한정 — 문서에 적으면
   * 남의 화면이 내가 굴린 자리로 끌려간다)와 드래그 중 상태.
   *
   * 보드의 **내용은 복사하지 않는다** — 언제나 원본을 다시 읽는다.
   */
  embed?: NoteEmbedView;
  /** `img` — 이미지 참조(`mfimg:<경로>` 또는 데이터 URL. 맵의 규칙과 같다). */
  src?: string;
  /**
   * `img` — **손으로 정한 너비**(px). 없으면 단 폭에 맞춘다(그림의 원래 폭이 상한).
   *
   * 높이를 함께 적지 않는 이유: 비율은 그림이 들고 있고, 우리가 두 값을 적으면 다른
   * 화면 폭에서 찌그러진다. 폭만 적고 높이는 `auto`로 둔다(표의 `colW`와 같은 결).
   */
  imgW?: number;
  /** `callout`의 어조. */
  tone?: NoteCalloutTone;
  /** `toggle`이 펼쳐져 있는가(문서에 저장되는 기본 상태). */
  open?: boolean;
  /** 가로 정렬(없으면 왼쪽). */
  align?: 'left' | 'center' | 'right';
  /** 들여쓰기 단계(없으면 0). */
  indent?: number;
}

/**
 * 공책 안의 한 페이지. **글의 단위**이고, 스페이스 카드에 보이는 것은 이 페이지들의
 * 첫 줄이다(디자인의 공책 카드가 그렇게 그려진다).
 */
export interface NotePage {
  id: string;
  title: string;
  blocks: NoteBlock[];
  /** 페이지 태그(공책 표지의 태그와 **별개** — 페이지마다 다를 수 있다). */
  tag?: string | null;
  /** 이 페이지가 가리키는 문서 id — 디자인의 "연결 보드". */
  linkedDocId?: string | null;
  /** 마지막 수정 시각(ISO). 목록의 `18분 전`이 이 값에서 나온다. */
  updatedAt?: string;
  /** 마지막으로 고친 사람의 표시 이름. */
  updatedBy?: string;
}

/**
 * 공책 표지 — 색 · 스케치 · 태그.
 *
 * 태그를 표지에 함께 두는 이유는 디자인이 그렇게 엮어 두었기 때문이다: **태그가
 * 있으면 태그별 기본 표지 색과 스케치가 정해지고**, 사용자가 직접 고르면 그 값이
 * 이긴다(`noteCoverColor`·`noteCoverSketch`가 그 우선순위를 판단한다).
 */
export interface NoteCover {
  /** 공책 태그(`'회의록'` 등). 빈 문자열은 "태그 없음"이라는 **명시적** 선택이다. */
  tag?: string | null;
  /** 사용자가 직접 고른 표지 색(없으면 태그 기본). */
  color?: string | null;
  /** 사용자가 직접 고른 스케치(없으면 태그 기본). */
  sketch?: NoteSketch | null;
  /**
   * 본문 단을 **창 너비에 맞출지**(요청) — 없거나 `false`면 지금까지처럼 700px
   * 가운데 정렬이다.
   *
   * 왜 표지(`cover`)에 두나: 이것은 페이지가 아니라 **공책 한 권**의 읽기 설정이고
   * (한 권 안에서 장마다 폭이 달라지면 넘길 때마다 글이 출렁인다), 공책의 문서 단위
   * 값을 담는 자루가 여기 하나뿐이다. 값이 없을 때가 기본이라 옛 문서도 그대로다.
   */
  wide?: boolean;
  /**
   * **이 공책에서 만든 태그 이름들**(요청) — 지금 어느 페이지도 쓰고 있지 않아도
   * 고르개에 남는다.
   *
   * 왜 필요한가: 태그는 페이지에 적히는 글자일 뿐이라(`NotePage.tag`) 고르개의
   * 목록을 "기본 여섯 + 실제로 쓰인 것"으로 만들고 있었다. 그러면 애써 만든 태그를
   * 한 페이지에서 떼는 순간 **그 태그 자체가 사라진다**(제보). 표지에 두는 이유는
   * `wide`와 같다 — 페이지가 아니라 **공책 한 권**의 것이고, 공책 단위 값을 담는
   * 자루가 여기 하나뿐이다. 없을 때가 기본이라 옛 문서도 그대로다.
   */
  tags?: string[];
}

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
  /** 열 **배경**(없으면 테마 기본) — 머리 점 색(`color`)과 따로 고른다. */
  bg?: string | null;
}

/**
 * 칸반 **분류**(태그) — 문서가 들고 있는 목록.
 *
 * 카드의 `tag`는 이름 문자열이고, 그 이름이 여기 있으면 목록에 뜨고 색도 지정할 수
 * 있다. 목록을 문서에 두는 이유: 카드에만 있으면 **그 태그를 쓰는 카드를 다 지운
 * 순간 분류도 사라진다**(직접 만든 분류가 조용히 없어진다). 색은 선택 — 없으면
 * 이름에서 정한다(`kanbanMeta.tagColor`).
 */
export interface KanbanTag {
  id: string;
  name: string;
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
  /**
   * 분류(디자인 원본의 "태그") — 이름 하나. 색은 저장하지 않고 **이름에서 정한다**
   * (테마 팔레트 인덱스로 결정적 매핑, `apps/web`의 `kanbanMeta`): 색을 함께 들면
   * 테마를 바꿨을 때 카드마다 옛 색이 남고, 같은 이름이 문서마다 다른 색이 된다.
   */
  tag?: string;
  /** 시작일 — `YYYY-MM-DD`. 있으면 타임라인 막대가 이 날부터 그려진다(없으면 오늘부터). */
  start?: string;
  /** 기한 — `YYYY-MM-DD`(로컬 날짜). 표시 문구·지남 판정은 화면이 정한다. */
  due?: string;
  /** 담당자 이메일 — 공유 참가자(0011)에서 고른다. */
  owner?: string;
  /** 담당자 표시 이름 **스냅샷**(댓글 `author_name`과 같은 이유 — 클라이언트는
   * 남의 `profiles`를 못 읽는다). 이름을 바꾸면 옛 카드는 옛 이름을 유지한다. */
  ownerName?: string;
  /** 긴급 표시 — 카드에 붉은 배지가 붙는다. */
  flagged?: boolean;
}

/**
 * The full serializable document, matching `serializeDoc()` 1:1
 * (MindFlow.dc.html:534-536).
 */
/** 캔버스 위의 댓글 핀 — 자리(문서 좌표)만 든다. 말은 서버 `comments` 표에. */
export interface CommentPin {
  id: string;
  x: number;
  y: number;
}

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
  /**
   * 캔버스에 꽂는 **댓글 핀**(Figma 방식) — 획과 같은 규칙으로 비어 있지 않을 때만
   * 직렬화·전파한다.
   *
   * 핀은 **자리만** 들고 있고 말은 서버 `comments` 표에 그대로 남는다(핀 id가
   * 대상 id). 그래서 서버는 한 줄도 바뀌지 않고, 본문이 오갈 때 댓글 내용이
   * 딸려 다니지도 않는다. 댓글이 하나도 없는 핀은 앱이 지운다(빈 핀은 뜻이 없다).
   */
  commentPins?: CommentPin[];
  /** 칸반 열 — `kind === 'kanban'`일 때만(다른 종류에서는 없다). */
  columns?: KanbanColumn[];
  /** 칸반 카드 — 열과 같은 규칙. */
  cards?: KanbanCard[];
  /** 칸반 분류 목록 — 열·카드와 같은 규칙(칸반일 때만). */
  tags?: KanbanTag[];
  /**
   * 공책 페이지 — `kind === 'note'`일 때만(칸반 열·카드와 같은 규칙).
   *
   * **비어 있지 않다**: 페이지가 없는 공책은 열 것이 없으므로, 만들 때 한 장을
   * 함께 만들고 마지막 한 장은 지우지 못하게 한다(디자인도 그렇게 막는다 —
   * "공책에는 페이지가 한 장 이상 있어야 해요").
   */
  pages?: NotePage[];
  /** 공책 표지(색·스케치·태그) — 페이지와 같은 규칙. */
  cover?: NoteCover;
  /**
   * 사용자가 **직접 고른 태그 점 색**(`태그 이름 → hex`).
   *
   * 없으면 색은 이름에서 나온다(`noteTagColor`의 기본 여섯 + 이름 해시 팔레트).
   * 여기 적히는 것은 사람이 고른 것뿐이라, 이 칸이 비어 있는 문서는 지금까지와
   * 한 글자도 다르지 않다. 태그 자체는 여전히 페이지에 적히는 **글자**이고 이
   * 표는 그 글자의 겉모습만 덮어쓴다 — 태그를 지우는 개념이 없으므로 이름이
   * 바뀌면 옛 이름의 색이 남지만, 쓰이지 않는 항목 몇 개는 해가 없다.
   */
  tagColors?: Record<string, string>;
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

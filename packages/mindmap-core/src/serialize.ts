// Serialization core — ports of `serializeDoc()` / `loadDoc()` / `cloneNodes()`
// from `MindFlow.dc.html`. Pure, no localStorage: callers own persistence.

import type { Doc, DocKind, EdgeStyle, Float, KanbanCard, KanbanColumn, KanbanTag, Line, LayoutMode, NodeMap, Reaction, Stroke, Zone, CommentPin } from './model';
import { DEFAULT_EDGE_STYLE, DEFAULT_LAYOUT_MODE, DEFAULT_THEME_KEY } from './model';

/**
 * The subset of app state `serializeDoc()` reads from (MindFlow.dc.html:534-536).
 * `zones` is nullable here because the original reads `this.state.zones || []`
 * (some older/legacy states may not have a `zones` array yet).
 */
export interface SerializableState {
  nodes: NodeMap;
  floats: Float[];
  lines: Line[];
  zones?: Zone[] | null;
  layoutMode: LayoutMode;
  themeKey: string;
  edgeStyle?: EdgeStyle | null;
  kind?: DocKind | null;
  strokes?: Stroke[] | null;
  commentPins?: CommentPin[] | null;
  reactions?: Reaction[] | null;
  columns?: KanbanColumn[] | null;
  cards?: KanbanCard[] | null;
  tags?: KanbanTag[] | null;
}

/**
 * Port of `Component#serializeDoc` (MindFlow.dc.html:534-536).
 *
 * Note the original does not deep-clone: it returns direct references to
 * live state arrays/objects. This function preserves that behavior — callers
 * who need an isolated snapshot should clone before mutating further.
 */
export function serializeDoc(state: SerializableState): Doc {
  return {
    v: 1,
    nodes: state.nodes,
    floats: state.floats,
    lines: state.lines,
    zones: state.zones ?? [],
    layoutMode: state.layoutMode,
    themeKey: state.themeKey,
    edgeStyle: state.edgeStyle ?? DEFAULT_EDGE_STYLE,
    // 문서 종류는 'board'일 때만 기록한다 — edgeStyle처럼 항상 쓰면 골든
    // 픽스처와 기존 저장본이 전부 갈리므로, RichRun.href의 "값이 있을 때만"
    // 규칙을 따른다(기본값 = 마인드맵).
    ...(state.kind === 'board' || state.kind === 'kanban' ? { kind: state.kind } : {}),
    // 칸반 열·카드 — 칸반 문서에서만(다른 종류의 저장본은 한 글자도 달라지지 않는다).
    ...(state.kind === 'kanban' ? { columns: state.columns ?? [], cards: state.cards ?? [], tags: state.tags ?? [] } : {}),
    // 그리기 획 — 비어 있지 않을 때만(kind와 같은 규칙: 골든·기존 저장본 무변경).
    ...(state.strokes && state.strokes.length ? { strokes: state.strokes } : {}),
    ...(state.commentPins && state.commentPins.length ? { commentPins: state.commentPins } : {}),
    // 반응·투표 — 획과 같은 규칙(비어 있지 않을 때만).
    ...(state.reactions && state.reactions.length ? { reactions: state.reactions } : {}),
  };
}

/**
 * Port of `Component#loadDoc` (MindFlow.dc.html:792-808), minus the
 * localStorage read and `this.setState` merge (which required pre-existing
 * component state to fall back on). Since a pure function has no prior
 * state to merge into, missing optional arrays default to `[]` and missing
 * `layoutMode`/`themeKey` fall back to the same constants `buildInitial()`
 * uses for a fresh document (MindFlow.dc.html:495-496, 522-523).
 *
 * Returns `null` when `raw` is not an object or has no truthy `nodes` field,
 * mirroring the original's `if (!d || !d.nodes) return false;` guard
 * (MindFlow.dc.html:795).
 *
 * Open question (see M1a report): the original also reads `d.needsLayout`
 * (MindFlow.dc.html:804) to decide whether to run `_layout` once after an
 * import. That flag is not part of the `Doc` schema (README) and is a
 * layout-milestone concern, so it is intentionally NOT reproduced here.
 */
export function parseDoc(raw: unknown): Doc | null {
  if (raw === null || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  if (!d.nodes) return null;

  const nodes = d.nodes as NodeMap;
  const floats = Array.isArray(d.floats) ? (d.floats as Float[]) : [];
  const lines = Array.isArray(d.lines) ? (d.lines as Line[]) : [];
  const zones = Array.isArray(d.zones) ? (d.zones as Zone[]) : [];
  const layoutMode = (d.layoutMode as LayoutMode | undefined) || DEFAULT_LAYOUT_MODE;
  const themeKey = (d.themeKey as string | undefined) || DEFAULT_THEME_KEY;
  const edgeStyle = (d.edgeStyle as EdgeStyle | undefined) || DEFAULT_EDGE_STYLE;

  return {
    v: 1,
    nodes,
    floats,
    lines,
    zones,
    layoutMode,
    themeKey,
    edgeStyle,
    ...(d.kind === 'board' ? { kind: 'board' as const } : {}),
    ...(d.kind === 'kanban'
      ? {
          kind: 'kanban' as const,
          columns: Array.isArray(d.columns) ? (d.columns as KanbanColumn[]) : [],
          // 소속 열이 사라진 카드는 버린다(열 삭제가 어디선가 반쪽으로 끝났어도
          // 화면에 뜨지 않는 유령이 남지 않게 — 읽는 쪽에서 정규화한다).
          cards: (Array.isArray(d.cards) ? (d.cards as KanbanCard[]) : []).filter((c) =>
            (Array.isArray(d.columns) ? (d.columns as KanbanColumn[]) : []).some((col) => col.id === c.col),
          ),
          tags: Array.isArray(d.tags) ? (d.tags as KanbanTag[]) : [],
        }
      : {}),
    ...(Array.isArray(d.strokes) && d.strokes.length ? { strokes: d.strokes as Stroke[] } : {}),
    ...(Array.isArray(d.commentPins) && d.commentPins.length ? { commentPins: d.commentPins as CommentPin[] } : {}),
    ...(Array.isArray(d.reactions) && d.reactions.length ? { reactions: d.reactions as Reaction[] } : {}),
  };
}

/**
 * Port of `Component#cloneNodes` (MindFlow.dc.html:884):
 * `() => { const o = {}; const n = this.state.nodes; for (const k in n) o[k] = { ...n[k], children: [...n[k].children] }; return o; }`
 *
 * This is a SHALLOW per-node clone: only the top-level node object and its
 * `children` array are copied. Nested structures such as `rich` runs are
 * NOT deep-cloned — they remain shared references with the input, exactly
 * as in the original.
 */
export function cloneNodes(nodes: NodeMap): NodeMap {
  const out: NodeMap = {};
  for (const id in nodes) {
    const n = nodes[id];
    if (!n) continue;
    out[id] = { ...n, children: [...n.children] };
  }
  return out;
}

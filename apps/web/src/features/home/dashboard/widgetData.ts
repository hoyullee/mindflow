/**
 * 위젯 본문 데이터 — 문서의 직렬화 본문(썸네일 프리페치와 같은 `previewDocs`
 * 문자열)에서 위젯이 그릴 만큼만 뽑아낸다.
 *
 * 칸반은 **실물을 그대로** 넘긴다(제보: 위젯이 실제 칸반 에디터와 달라 보이면
 * 안 된다) — 열·카드·분류·테마 키를 원형으로 넘기고, 화면은 에디터의 그
 * 부품(`CardFace`/`cardBase`/열 스펙)에 이 값을 그대로 붓는다. 여기서 문구나
 * 색으로 미리 접으면 접은 만큼 에디터와 어긋난다(예전 미니 렌더가 그랬다).
 * 진행 바·발치 아바타만 위젯 틀의 몫이라 여기서 계산한다(`boardProgress` —
 * 에디터 보드 머리의 같은 규칙).
 *
 * 맵·화이트보드는 여기서 지표(노드/메모 수)만 만들고, 화면은 홈 카드와 같은
 * 실렌더(`realPreview`)가 그린다 — 위젯이 실제 문서와 다르게 보이면 안 된다(제보).
 *
 * 화면(DOM)을 모른다 — DashboardView가 이 값들을 그린다.
 */

import type { Doc, Float, KanbanCard, KanbanColumn, KanbanTag, Node as CoreNode } from '@mindflow/mindmap-core';
import { ROOT_ID } from '@mindflow/mindmap-core';
import { themeOf } from '../../editor/theme';
import { boardProgress } from '../../editor/kanbanMeta';
import { colorForSeed } from '../../../collab/identity';

export type WidgetKind = 'kanban' | 'mind' | 'board';

export interface WidgetKanban {
  kind: 'kanban';
  /** 에디터가 그리는 실물 그대로 — 위젯은 이 값을 에디터의 카드·열 부품에 붓는다. */
  columns: KanbanColumn[];
  cards: KanbanCard[];
  tags: KanbanTag[];
  /** 문서의 테마 키 — 색은 전부 이 테마에서 온다(에디터가 그 문서를 그릴 때 쓰는
   * 바로 그 팔레트). 홈 다크 테마의 CSS 변수를 쓰면 밝은 열 위에 밝은 글자가 얹힌다. */
  themeKey: string;
  /** 진행 바 구간 — 에디터 보드 머리의 그 줄(완료부터 왼쪽에서, 열 색 그대로.
   * 첫 열은 빈 트랙 — `boardProgress` 규칙 그대로). */
  segments: { pct: number; color: string }[];
  /** 발치 아바타 — 카드에 적힌 담당들(중복 없이, 최대 4). */
  avatars: { label: string; color: string }[];
  done: { done: number; total: number } | null;
}

export interface WidgetMind {
  kind: 'mind';
  nodeCount: number;
}

export interface WidgetBoard {
  kind: 'board';
  noteTotal: number;
}

export type WidgetData = WidgetKanban | WidgetMind | WidgetBoard;

/** 직렬화 본문 → 위젯 데이터. 파싱 실패·빈 문서는 null(위젯이 폴백 문구를 그린다). */
export function widgetDataOf(raw: string | null | undefined): WidgetData | null {
  if (!raw) return null;
  let d: Partial<Doc> & { kind?: string };
  try {
    d = JSON.parse(raw) as Partial<Doc> & { kind?: string };
  } catch {
    return null;
  }
  if (!d || typeof d !== 'object') return null;

  if (d.kind === 'kanban') {
    const columns = Array.isArray(d.columns) ? (d.columns as KanbanColumn[]) : [];
    const cards = Array.isArray(d.cards) ? (d.cards as KanbanCard[]) : [];
    if (!columns.length) return null;
    const themeKey = (d as { themeKey?: string }).themeKey ?? 'coral';
    const th = themeOf(themeKey);
    const tags = Array.isArray(d.tags) ? (d.tags as KanbanTag[]) : [];
    const progress = boardProgress(columns, cards, th.palette);
    const owners = new Map<string, { label: string; color: string }>();
    cards.forEach((k) => {
      const key = k.owner || k.ownerName;
      if (!key || !k.ownerName || owners.has(key)) return;
      owners.set(key, { label: k.ownerName.slice(-2), color: colorForSeed(key) });
    });
    return {
      kind: 'kanban',
      columns,
      cards,
      tags,
      themeKey,
      segments: progress.segments.map((s) => ({ pct: s.pct, color: s.color })),
      avatars: Array.from(owners.values()).slice(0, 4),
      done: cards.length ? { done: progress.done, total: progress.total } : null,
    };
  }

  const nodes = (d.nodes || {}) as Record<string, CoreNode>;
  if (nodes[ROOT_ID]) {
    return { kind: 'mind', nodeCount: Object.keys(nodes).length };
  }

  // 루트 없는 문서 = 화이트보드. 메모(이미지 제외)가 하나라도 있어야 그릴 게 있다.
  const floats = Array.isArray(d.floats) ? (d.floats as Float[]) : [];
  const memos = floats.filter((f) => !f.img);
  const strokes = Array.isArray((d as { strokes?: unknown[] }).strokes) ? ((d as { strokes?: unknown[] }).strokes as unknown[]) : [];
  if (!memos.length && !floats.length && !strokes.length) return null;
  return { kind: 'board', noteTotal: memos.length };
}

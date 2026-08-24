/**
 * 위젯 본문 데이터 — 문서의 직렬화 본문(썸네일 프리페치와 같은 `previewDocs`
 * 문자열)에서 위젯이 그릴 만큼만 뽑아낸다. 디자인 원본은 목업 데이터를 그렸지만
 * 여기서는 **실제 문서**가 그 틀에 들어간다.
 *
 * 화면(DOM)을 모른다 — DashboardView가 이 값들을 디자인의 위젯 템플릿에 붓는다.
 */

import type { Doc, Float, KanbanCard, KanbanColumn, Node as CoreNode } from '@mindflow/mindmap-core';
import { ROOT_ID, cardsInColumn } from '@mindflow/mindmap-core';

export type WidgetKind = 'kanban' | 'mind' | 'board';

export interface WidgetKanbanCard {
  id: string;
  title: string;
  tag: string | null;
  /** 담당 표시(이름 뒤 두 글자) — 없으면 null. */
  who: string | null;
  due: string | null;
  comments: number;
}

export interface WidgetKanbanColumn {
  id: string;
  name: string;
  count: number;
  cards: WidgetKanbanCard[];
  /** 접힌 수("+N개 더") — 0이면 전부 보이는 중. */
  more: number;
}

export interface WidgetKanban {
  kind: 'kanban';
  columns: WidgetKanbanColumn[];
  /** 진행 바 구간(왼쪽부터) — 열 순서 그대로, 카드 수 비율. */
  bar: { pct: number; colIndex: number }[];
  owners: string[];
  done: { done: number; total: number } | null;
}

export interface WidgetMind {
  kind: 'mind';
  root: string;
  branches: string[];
  /** 가지 총수(표시보다 많으면 위젯이 "+N"을 말할 수 있게). */
  branchTotal: number;
  nodeCount: number;
}

export interface WidgetBoardNote {
  text: string;
  /** 문서 좌표를 0..1로 정규화한 위치/폭 — 위젯이 %로 편다. */
  l: number;
  t: number;
  w: number;
  bg: string | null;
}

export interface WidgetBoard {
  kind: 'board';
  notes: WidgetBoardNote[];
  noteTotal: number;
}

export type WidgetData = WidgetKanban | WidgetMind | WidgetBoard;

function firstLine(text: string): string {
  const line = (text || '').split('\n').find((l) => l.trim()) || '';
  return line.trim();
}

/** 직렬화 본문 → 위젯 데이터. 파싱 실패·빈 문서는 null(위젯이 폴백 문구를 그린다).
 *  `maxCards`/`maxBranches`/`maxNotes`는 크기(행 수)에 따라 위젯이 정해 넘긴다. */
export function widgetDataOf(raw: string | null | undefined, opts: { maxCards: number; maxBranches: number; maxNotes: number }): WidgetData | null {
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
    const cols = columns.map((c, i) => {
      const mine = cardsInColumn(cards, c.id);
      const visible = mine.slice(0, opts.maxCards);
      return {
        id: c.id,
        name: c.title,
        count: mine.length,
        more: Math.max(0, mine.length - visible.length),
        colIndex: i,
        cards: visible.map((k) => ({
          id: k.id,
          title: firstLine(k.text),
          tag: k.tag || null,
          who: k.ownerName ? k.ownerName.slice(-2) : null,
          due: k.due || null,
          comments: 0,
        })),
      };
    });
    const total = cards.length || 1;
    const owners = Array.from(new Set(cards.map((k) => k.ownerName).filter((n): n is string => !!n))).slice(0, 4);
    // 마지막 열 = 완료(에디터 진행률과 같은 규칙, #448) — "N/M done" 표기용.
    const lastCol = columns[columns.length - 1];
    const doneCount = lastCol ? cardsInColumn(cards, lastCol.id).length : 0;
    return {
      kind: 'kanban',
      columns: cols,
      bar: columns.map((c, i) => ({ pct: (cardsInColumn(cards, c.id).length / total) * 100, colIndex: i })),
      owners,
      done: cards.length ? { done: doneCount, total: cards.length } : null,
    };
  }

  const nodes = (d.nodes || {}) as Record<string, CoreNode>;
  const root = nodes[ROOT_ID];
  if (root) {
    const branches = (root.children || [])
      .map((id) => nodes[id])
      .filter((n): n is CoreNode => !!n)
      .map((n) => firstLine(n.text || ''));
    return {
      kind: 'mind',
      root: firstLine(root.text || '') || '마인드맵',
      branches: branches.slice(0, opts.maxBranches),
      branchTotal: branches.length,
      nodeCount: Object.keys(nodes).length,
    };
  }

  // 루트 없는 문서 = 화이트보드. 메모(이미지 제외)를 문서 좌표 그대로 정규화한다.
  const floats = Array.isArray(d.floats) ? (d.floats as Float[]) : [];
  const memos = floats.filter((f) => !f.img);
  if (!memos.length) return null;
  const W = 200; // 폭 어림값(측정 없이) — 경계 계산용
  const minX = Math.min(...memos.map((f) => f.x));
  const maxX = Math.max(...memos.map((f) => f.x + (f.w || W)));
  const minY = Math.min(...memos.map((f) => f.y));
  const maxY = Math.max(...memos.map((f) => f.y + 90));
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  return {
    kind: 'board',
    notes: memos.slice(0, opts.maxNotes).map((f) => ({
      text: firstLine(f.text || ''),
      l: (f.x - minX) / spanX,
      t: (f.y - minY) / spanY,
      w: Math.min(0.48, Math.max(0.16, (f.w || W) / spanX)),
      bg: f.bg || null,
    })),
    noteTotal: memos.length,
  };
}

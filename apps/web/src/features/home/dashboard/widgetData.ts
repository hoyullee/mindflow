/**
 * 위젯 본문 데이터 — 문서의 직렬화 본문(썸네일 프리페치와 같은 `previewDocs`
 * 문자열)에서 위젯이 그릴 만큼만 뽑아낸다.
 *
 * 칸반은 **에디터의 시각 규칙을 그대로** 계산해 넘긴다(제보: 위젯이 실제 칸반
 * 보드처럼 보여야 한다) — 면 층·열 색·분류 색·기한 문구·아바타 색이 전부
 * `kanbanMeta`/`identity`의 **같은 함수**에서 나오므로 위젯과 에디터가 어긋날
 * 길이 없다. 색의 기준은 그 문서의 테마(`themeOf(d.themeKey)`) — 에디터가 그
 * 문서를 그릴 때 쓰는 바로 그 팔레트다.
 *
 * 맵·화이트보드는 여기서 지표(노드/메모 수)만 만들고, 화면은 홈 카드와 같은
 * 실렌더(`realPreview`)가 그린다 — 위젯이 실제 문서와 다르게 보이면 안 된다(제보).
 *
 * 화면(DOM)을 모른다 — DashboardView가 이 값들을 디자인의 위젯 템플릿에 붓는다.
 */

import type { Doc, Float, KanbanCard, KanbanColumn, KanbanTag, Node as CoreNode } from '@mindflow/mindmap-core';
import { ROOT_ID, cardsInColumn } from '@mindflow/mindmap-core';
import { hexA, themeOf } from '../../editor/theme';
import { boardProgress, boardSurface, columnBg, columnColor, dueLabel, dueTone, innerLine, tagColor, tagInk } from '../../editor/kanbanMeta';
import { colorForSeed } from '../../../collab/identity';

export type WidgetKind = 'kanban' | 'mind' | 'board';

export interface WidgetKanbanCard {
  id: string;
  title: string;
  tag: string | null;
  /** 분류 배지 색 — 에디터와 같은 `tagColor`/`tagInk` 규칙. */
  tagBg: string | null;
  tagFg: string | null;
  /** 기한 표시 문구(에디터의 `dueLabel` — "오늘"/"내일"/"9월 1일"). */
  due: string | null;
  /** 기한 톤 — 완료(마지막) 열의 카드는 지나도 붉지 않다(#448). */
  dueTone: 'over' | 'soon' | 'normal';
  /** 담당 표시(이름 뒤 두 글자) — 없으면 null. */
  who: string | null;
  /** 담당 아바타 색 — 접속자 커서와 같은 시드(`colorForSeed`). */
  whoColor: string | null;
}

export interface WidgetKanbanColumn {
  id: string;
  name: string;
  count: number;
  /** 열 머리의 점 색 — 지정이 없으면 열 순서대로 팔레트(에디터 규칙). */
  dot: string;
  /** 열 배경 — 사용자가 고른 색이 있으면 그것(에디터 `columnBg`). */
  bg: string;
  cards: WidgetKanbanCard[];
  /** 접힌 수("+N개 더") — 0이면 전부 보이는 중. */
  more: number;
}

export interface WidgetKanban {
  kind: 'kanban';
  columns: WidgetKanbanColumn[];
  /** 진행 바 구간 — 에디터 보드 머리의 그 줄(완료부터 왼쪽에서, 열 색 그대로.
   * 첫 열은 빈 트랙 — `boardProgress` 규칙 그대로). */
  segments: { pct: number; color: string }[];
  /** 진행 바의 빈 트랙 색. */
  track: string;
  /** 발치 아바타 — 카드에 적힌 담당들(중복 없이, 최대 4). */
  avatars: { label: string; color: string }[];
  done: { done: number; total: number } | null;
  /** 위젯 몸통의 면 층·글자색 — 에디터 보드 화면과 같은 계산(`boardSurface`/
   * `innerLine` + 그 테마의 잉크). 홈 다크 테마의 CSS 변수를 쓰면 밝은 열 위에
   * 밝은 글자가 얹히므로, 색은 전부 **문서 테마**에서 온다. */
  surface: { board: string; line: string; card: string; ink: string; subInk: string };
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

function firstLine(text: string): string {
  const line = (text || '').split('\n').find((l) => l.trim()) || '';
  return line.trim();
}

/** 직렬화 본문 → 위젯 데이터. 파싱 실패·빈 문서는 null(위젯이 폴백 문구를 그린다).
 *  `maxCards`는 크기(행 수)에 따라 위젯이 정해 넘긴다. */
export function widgetDataOf(raw: string | null | undefined, opts: { maxCards: number }): WidgetData | null {
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
    const th = themeOf((d as { themeKey?: string }).themeKey ?? 'coral');
    const tags = Array.isArray(d.tags) ? (d.tags as KanbanTag[]) : [];
    const lastId = columns[columns.length - 1]?.id;
    const cols = columns.map((c, i) => {
      const mine = cardsInColumn(cards, c.id);
      const visible = mine.slice(0, opts.maxCards);
      return {
        id: c.id,
        name: c.title,
        count: mine.length,
        dot: columnColor(c, i, th.palette),
        bg: columnBg(c, th),
        more: Math.max(0, mine.length - visible.length),
        cards: visible.map((k) => {
          const tc = k.tag ? tagColor(k.tag, th.palette, tags) : null;
          return {
            id: k.id,
            title: firstLine(k.text),
            tag: k.tag || null,
            tagBg: tc ? hexA(tc, 0.16) : null,
            tagFg: tc ? tagInk(tc, th.text) : null,
            due: k.due ? dueLabel(k.due) : null,
            dueTone: k.due && c.id !== lastId ? dueTone(k.due) : ('normal' as const),
            who: k.ownerName ? k.ownerName.slice(-2) : null,
            whoColor: k.ownerName || k.owner ? colorForSeed(k.owner || k.ownerName || '') : null,
          };
        }),
      };
    });
    const progress = boardProgress(columns, cards, th.palette);
    const owners = new Map<string, { label: string; color: string }>();
    cards.forEach((k) => {
      const key = k.owner || k.ownerName;
      if (!key || !k.ownerName || owners.has(key)) return;
      owners.set(key, { label: k.ownerName.slice(-2), color: colorForSeed(key) });
    });
    return {
      kind: 'kanban',
      columns: cols,
      segments: progress.segments.map((s) => ({ pct: s.pct, color: s.color })),
      track: innerLine(th),
      avatars: Array.from(owners.values()).slice(0, 4),
      done: cards.length ? { done: progress.done, total: progress.total } : null,
      surface: { board: boardSurface(th), line: innerLine(th), card: th.panel, ink: th.text, subInk: th.subtext },
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

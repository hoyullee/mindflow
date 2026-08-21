// 칸반 — 열과 카드의 순수 규칙(문서 종류 `'kanban'`).
//
// **순서는 `pos` 분수 인덱스**다: 카드를 옮기면 새 이웃 둘의 중간값을 준다.
// 배열(`cardIds: string[]`)로 들지 않는 이유는 협업이다 — 끊긴 채 두 사람이
// 각자 카드를 옮기면 배열 필드는 한쪽이 통째로 사라진다(#332에서 확인). `pos`는
// 카드 자신의 필드라 서로 다른 카드를 옮기면 둘 다 살아남고, 같은 카드를 옮기면
// 한 값만 남는다(그건 어느 방식이든 마찬가지다).

import type { KanbanCard, KanbanColumn } from './model';

/** 새 카드를 맨 아래에 놓을 때의 간격 — 값 자체에 뜻은 없다(순서만 본다). */
const POS_STEP = 1024;

/** 이 열의 카드들 — 순서(`pos`)대로. 같으면 id로 갈라 결과가 흔들리지 않게 한다. */
export function cardsInColumn(cards: KanbanCard[], colId: string): KanbanCard[] {
  return cards.filter((c) => c.col === colId).sort((a, b) => a.pos - b.pos || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * `index` 자리에 끼울 때 줄 `pos` — 위아래 이웃의 중간값.
 *
 * 맨 위면 첫 카드보다 한 칸 작게, 맨 아래면 마지막보다 한 칸 크게. 빈 열은 0.
 * 중간값이 이웃과 구분되지 않을 만큼 촘촘해지면(부동소수 한계) 호출부가
 * `renumberColumn`으로 정리한다.
 */
export function posForIndex(cards: KanbanCard[], colId: string, index: number): number {
  const list = cardsInColumn(cards, colId);
  if (!list.length) return 0;
  const i = Math.max(0, Math.min(index, list.length));
  if (i === 0) return (list[0] as KanbanCard).pos - POS_STEP;
  if (i === list.length) return (list[list.length - 1] as KanbanCard).pos + POS_STEP;
  const before = (list[i - 1] as KanbanCard).pos;
  const after = (list[i] as KanbanCard).pos;
  return (before + after) / 2;
}

/** 이웃 사이가 너무 촘촘해졌는가(분수 인덱스가 바닥난 신호). */
export function needsRenumber(cards: KanbanCard[], colId: string): boolean {
  const list = cardsInColumn(cards, colId);
  for (let i = 1; i < list.length; i++) {
    const gap = (list[i] as KanbanCard).pos - (list[i - 1] as KanbanCard).pos;
    if (!(gap > 1e-6)) return true;
  }
  return false;
}

/** 한 열의 `pos`를 0, 1024, 2048 …로 다시 매긴다(순서는 그대로). */
export function renumberColumn(cards: KanbanCard[], colId: string): KanbanCard[] {
  const order = new Map(cardsInColumn(cards, colId).map((c, i) => [c.id, i * POS_STEP]));
  return cards.map((c) => (order.has(c.id) ? { ...c, pos: order.get(c.id) as number } : c));
}

/** 카드를 그 열의 `index` 자리로 옮긴 목록(같은 열 안 이동도 같은 경로). */
export function moveCard(cards: KanbanCard[], cardId: string, toCol: string, index: number): KanbanCard[] {
  const card = cards.find((c) => c.id === cardId);
  if (!card) return cards;
  // 자기 자신을 뺀 목록에서 자리를 정해야 "지금 있는 자리" 때문에 한 칸씩 밀리지 않는다.
  const without = cards.filter((c) => c.id !== cardId);
  const pos = posForIndex(without, toCol, index);
  const next = cards.map((c) => (c.id === cardId ? { ...c, col: toCol, pos } : c));
  return needsRenumber(next, toCol) ? renumberColumn(next, toCol) : next;
}

/** 열을 지우면 그 안의 카드도 함께 사라진다(고아 카드를 남기지 않는다). */
export function removeColumn(columns: KanbanColumn[], cards: KanbanCard[], colId: string): { columns: KanbanColumn[]; cards: KanbanCard[] } {
  return { columns: columns.filter((c) => c.id !== colId), cards: cards.filter((c) => c.col !== colId) };
}

/** 열을 `to` 자리로 옮긴 목록(열 순서는 배열 순서). */
export function moveColumn(columns: KanbanColumn[], colId: string, to: number): KanbanColumn[] {
  const from = columns.findIndex((c) => c.id === colId);
  if (from < 0) return columns;
  const next = [...columns];
  const [moved] = next.splice(from, 1);
  if (!moved) return columns;
  next.splice(Math.max(0, Math.min(to, next.length)), 0, moved);
  return next;
}

/** 빈 칸반 문서의 열 셋 — 새 보드가 열자마자 쓸 수 있게. */
export const DEFAULT_KANBAN_COLUMNS: readonly string[] = ['할 일', '진행 중', '완료'];

/**
 * 모든 열의 카드를 **기한순**으로 다시 놓는다(요청: 배경 메뉴 '전체 기한순 정렬').
 *
 * 기한이 없는 카드는 **뒤로** 모은다 — 날짜가 빠른 일부터 보이는 게 목적이고,
 * 정하지 않은 카드가 위로 올라오면 그 목적이 깨진다. 같은 기한(또는 둘 다 없음)
 * 끼리는 **지금 순서를 지킨다**(안정 정렬) — 손으로 잡아 둔 순서를 이유 없이
 * 흔들지 않는다.
 *
 * 열 소속은 건드리지 않고 `pos`만 다시 매긴다. 카드를 옮기는 것과 같은 규칙이라
 * 협업·undo·저장이 기존 경로 그대로다.
 */
export function sortColumnsByDue(cards: KanbanCard[], colIds: readonly string[]): KanbanCard[] {
  const pos = new Map<string, number>();
  for (const colId of colIds) {
    cardsInColumn(cards, colId)
      // `cardsInColumn`이 이미 현재 순서로 준다 → 그 위에서 안정 정렬.
      .map((c, i) => ({ c, i }))
      .sort((a, b) => {
        const da = a.c.due ?? '';
        const db = b.c.due ?? '';
        if (da !== db) {
          if (!da) return 1; // 기한 없음은 뒤로
          if (!db) return -1;
          return da < db ? -1 : 1; // YYYY-MM-DD는 문자열 비교가 곧 날짜 비교
        }
        return a.i - b.i;
      })
      .forEach(({ c }, i) => pos.set(c.id, i * POS_STEP));
  }
  return cards.map((c) => (pos.has(c.id) ? { ...c, pos: pos.get(c.id) as number } : c));
}

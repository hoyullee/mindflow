// 칸반 — 열과 카드의 순수 규칙(문서 종류 `'kanban'`).
//
// **순서는 `pos` 분수 인덱스**다: 카드를 옮기면 새 이웃 둘의 중간값을 준다.
// 배열(`cardIds: string[]`)로 들지 않는 이유는 협업이다 — 끊긴 채 두 사람이
// 각자 카드를 옮기면 배열 필드는 한쪽이 통째로 사라진다(#332에서 확인). `pos`는
// 카드 자신의 필드라 서로 다른 카드를 옮기면 둘 다 살아남고, 같은 카드를 옮기면
// 한 값만 남는다(그건 어느 방식이든 마찬가지다).

import type { KanbanCard, KanbanColumn, RichRun } from './model';
import { applyAutoLinks, applyMarkdownShortcuts } from './richtext';

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

/** 카드 곁정보의 부분 수정 — 값이 `null`/빈 값이면 **그 필드를 지운다**. */
export interface CardMetaPatch {
  tag?: string | null;
  start?: string | null;
  due?: string | null;
  owner?: { email: string; name: string } | null;
  flagged?: boolean;
}

/**
 * 카드의 곁정보(분류·시작일·기한·담당·긴급)를 고친 **새 배열**을 돌려준다.
 *
 * 규칙이 하나뿐이어야 하는 이유: 이 편집은 에디터의 카드 상세와 홈의 일정 화면
 * 두 곳에서 일어난다(일정 화면은 문서를 열지 않고 저장까지 한다). 예전에는 에디터
 * 컨트롤러 안에 인라인으로 있었고, 그대로 두면 두 벌이 되어 언젠가 어긋난다.
 *
 * - **값이 비면 키를 지운다** — 빈 필드가 CRDT로 계속 오가지 않게.
 * - 담당은 이메일과 이름 스냅샷이 **늘 함께** 움직인다(갈라지면 "이름만 남은 담당자").
 * - 분류 이름은 24자로 자른다(에디터의 기존 상한).
 */
export function patchCardMeta(cards: readonly KanbanCard[], id: string, patch: CardMetaPatch): KanbanCard[] {
  return cards.map((c) => {
    if (c.id !== id) return c;
    const next: KanbanCard = { ...c };
    if ('tag' in patch) {
      if (patch.tag) next.tag = patch.tag.slice(0, 24);
      else delete next.tag;
    }
    if ('start' in patch) {
      if (patch.start) next.start = patch.start;
      else delete next.start;
    }
    if ('due' in patch) {
      if (patch.due) next.due = patch.due;
      else delete next.due;
    }
    if ('owner' in patch) {
      if (patch.owner) {
        next.owner = patch.owner.email;
        next.ownerName = patch.owner.name;
      } else {
        delete next.owner;
        delete next.ownerName;
      }
    }
    if ('flagged' in patch) {
      if (patch.flagged) next.flagged = true;
      else delete next.flagged;
    }
    return next;
  });
}

/**
 * 기간(시작일~기한)을 **통째로 며칠 옮긴다** — 일정 화면에서 기간 바를 끌 때.
 * 시작일이 없으면 기한만 옮긴다(하루짜리). 날짜는 로컬 `YYYY-MM-DD` 문자열.
 */
export function shiftCardDates(card: Pick<KanbanCard, 'due' | 'start'>, days: number): { due?: string; start?: string } {
  const move = (iso: string | undefined): string | undefined => {
    if (!iso) return undefined;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return undefined;
    const d = new Date(+m[1]!, +m[2]! - 1, +m[3]! + days);
    return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;
  };
  const due = move(card.due);
  const start = move(card.start);
  return { ...(due ? { due } : {}), ...(start ? { start } : {}) };
}

/**
 * 카드 글자를 확정할 때의 규칙 — 마크다운 단축(`**굵게**`·`*기울임*`·`~~취소선~~`)을
 * 걷어 서식으로 바꾸고, 타이핑한 URL을 링크로 만든다.
 *
 * 카드 편집기는 평범한 textarea라 **입력은 늘 평문**이다. 그래서 이전 `rich`는 버리고
 * 이 글자에서 다시 만든다 — 화면에 보이던 글자가 곧 값이라는 계약이 지켜진다(보이지
 * 않는 옛 서식이 유령처럼 남지 않는다).
 *
 * 에디터의 카드 상세와 홈 일정 화면의 상세 팝업이 **같은 규칙**을 쓴다.
 */
export function cardTextValue(text: string): { text: string; rich: RichRun[] | null } {
  const trimmed = text.trim();
  const md = applyMarkdownShortcuts({ text: trimmed, rich: null });
  const base = md ?? { text: trimmed, rich: null };
  return applyAutoLinks(base) ?? base;
}

/** 카드 글자를 바꾼 **새 배열**. 빈 글자는 무시한다(카드를 지우는 것은 별도 동작이다). */
export function patchCardText(cards: readonly KanbanCard[], id: string, text: string): KanbanCard[] {
  const out = cardTextValue(text);
  if (!out.text) return cards.slice();
  return cards.map((c) => {
    if (c.id !== id) return c;
    const next: KanbanCard = { ...c, text: out.text };
    if (out.rich) next.rich = out.rich;
    else delete next.rich; // 평문이면 키를 지운다(빈 서식을 흘리지 않게)
    return next;
  });
}

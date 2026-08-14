// 칸반 카드 드래그 — "지금 포인터가 어느 열의 몇 번째를 가리키는가"를 정하는
// 순수 계산. DOM은 호출부가 재서 사각형 목록으로 넘긴다(그래야 테스트에서
// 브라우저 없이도 규칙을 검증할 수 있다).

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ColumnHit {
  id: string;
  rect: Rect;
  /** 그 열의 카드들 — 화면에 보이는 순서(위→아래). */
  cards: { id: string; rect: Rect }[];
}

export interface DropTarget {
  colId: string;
  index: number;
}

/**
 * 포인터가 가리키는 드롭 자리.
 *
 * 열은 **가로 위치**로 고른다(세로는 열 머리·빈 바닥까지 포함해 넉넉히 본다 —
 * 카드가 없는 열의 아무 데나 놓아도 그 열에 들어가야 한다). 열 안 자리는 카드의
 * **중심**을 넘었는지로 정한다(가장자리에 살짝 걸친 것만으로 순서가 바뀌면 손이
 * 흔들린다 — 코어 `columnInsertIndex`와 같은 규칙).
 *
 * 어느 열에도 닿지 않으면 `null`(드롭해도 아무 일이 없다).
 */
export function dropTargetAt(columns: ColumnHit[], x: number, y: number, draggingId: string): DropTarget | null {
  const col = columns.find((c) => x >= c.rect.left && x <= c.rect.right);
  if (!col) return null;
  const others = col.cards.filter((c) => c.id !== draggingId);
  let index = 0;
  for (const c of others) {
    if (y < (c.rect.top + c.rect.bottom) / 2) break;
    index += 1;
  }
  return { colId: col.id, index };
}

/** 삽입 위치 선을 그릴 화면 좌표(카드 사이의 한가운데). */
export function dropIndicator(columns: ColumnHit[], target: DropTarget, draggingId: string): { left: number; width: number; top: number } | null {
  const col = columns.find((c) => c.id === target.colId);
  if (!col) return null;
  const others = col.cards.filter((c) => c.id !== draggingId);
  const left = col.rect.left + 10;
  const width = Math.max(20, col.rect.right - col.rect.left - 20);
  if (!others.length) return { left, width, top: col.rect.top + 8 };
  const i = Math.max(0, Math.min(target.index, others.length));
  const top = i === 0 ? (others[0] as { rect: Rect }).rect.top - 4 : (others[i - 1] as { rect: Rect }).rect.bottom + 4;
  return { left, width, top };
}

/**
 * 열 머리를 끌 때 놓일 자리(열 목록에서의 index).
 *
 * 카드와 같은 규칙 — 열의 **중심**을 넘어야 자리가 바뀐다. 끌고 있는 열은 계산에서
 * 빼므로 "지금 있는 자리" 때문에 한 칸씩 밀리지 않는다(코어 `moveColumn`이 받는
 * index도 자기 자신을 뺀 목록 기준이다).
 */
export function columnDropIndex(columns: ColumnHit[], x: number, draggingId: string): number {
  const others = columns.filter((c) => c.id !== draggingId);
  let index = 0;
  for (const c of others) {
    if (x < (c.rect.left + c.rect.right) / 2) break;
    index += 1;
  }
  return index;
}

/** 열 사이에 그릴 세로 선의 화면 좌표. 열이 하나도 없으면 null. */
export function columnDropIndicator(columns: ColumnHit[], index: number, draggingId: string): { left: number; top: number; height: number } | null {
  const others = columns.filter((c) => c.id !== draggingId);
  if (!others.length) return null;
  const i = Math.max(0, Math.min(index, others.length));
  const ref = (i === 0 ? others[0] : others[i - 1]) as ColumnHit;
  const left = i === 0 ? ref.rect.left - 8 : ref.rect.right + 8;
  return { left, top: ref.rect.top, height: ref.rect.bottom - ref.rect.top };
}

/** 가장자리에 가까우면 스크롤할 양(px) — 화면 밖 열·카드로 끌고 갈 수 있게. */
export function edgeScroll(pos: number, min: number, max: number, zone = 60, speed = 14): number {
  if (pos < min + zone) return -speed;
  if (pos > max - zone) return speed;
  return 0;
}

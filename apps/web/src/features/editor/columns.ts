// 열 모드 프레임(칸반) — 프레임 안의 카드를 **세로로 쌓는** 순수 계산.
//
// 설계의 뿌리는 협업이다: 순서를 `cardIds: string[]` 같은 배열로 저장하면 끊긴 채
// 두 사람이 카드를 옮길 때 한쪽 순서가 통째로 사라진다(#332에서 확인한 배열 필드의
// 한계). 그래서 **y 좌표가 곧 순서**다 — 카드는 원래부터 좌표를 갖고 있고, 좌표는
// 필드 단위로 병합되므로 두 사람이 다른 카드를 옮기면 둘 다 살아남는다.
//
// 프레임 소속은 여기서 정하지 않는다(`frames.ts` — 중심이 사각형 안이면 소속).
// 이 파일은 "이미 이 열에 속한 카드들을 어디에 놓을 것인가"만 답한다.

/** 열 안쪽 여백 / 카드 사이 간격(캔버스 단위). */
export const COLUMN_PAD = 16;
export const COLUMN_GAP = 12;
/** 카드 최소 폭 — 메모 크기 조절의 최소값과 같다(더 좁아지면 글자가 뭉갠다). */
const MIN_CARD_W = 120;

export interface ColumnRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ColumnCard {
  id: string;
  x: number;
  y: number;
  w: number;
  /** 측정된 표시 높이 — 폭에 따라 달라지므로 호출부가 재서 넘긴다. */
  h: number;
}

export interface CardSlot {
  x: number;
  y: number;
  w: number;
}

/** 이 열에서 카드가 가질 폭. */
export function columnCardWidth(rect: ColumnRect): number {
  return Math.max(MIN_CARD_W, Math.round(rect.w - COLUMN_PAD * 2));
}

/** 지금 y 순서대로(같으면 원래 순서) 정렬한 카드 목록. */
function ordered(cards: ColumnCard[]): ColumnCard[] {
  return cards.map((c, i) => ({ c, i })).sort((a, b) => a.c.y - b.c.y || a.i - b.i).map((v) => v.c);
}

/**
 * 카드들이 놓일 자리 — 위에서부터 차례로 쌓고 폭을 열에 맞춘다.
 *
 * 결정적(같은 입력 → 같은 출력)이고 **멱등**이다: 이미 맞춰진 열을 다시 계산해도
 * 값이 그대로라 호출부가 "달라졌을 때만 커밋"하면 무한 루프가 생기지 않는다.
 */
export function columnLayout(rect: ColumnRect, cards: ColumnCard[]): Record<string, CardSlot> {
  const w = columnCardWidth(rect);
  const x = Math.round(rect.x + COLUMN_PAD);
  const out: Record<string, CardSlot> = {};
  let y = Math.round(rect.y + COLUMN_PAD);
  ordered(cards).forEach((c) => {
    out[c.id] = { x, y, w };
    y += Math.round(c.h) + COLUMN_GAP;
  });
  return out;
}

/**
 * 이 y(카드 위쪽 기준)에 놓으면 **몇 번째**인가 — 드래그 중 삽입 위치 표시와
 * 놓았을 때의 순서를 같은 규칙으로 정한다. 카드의 **중심**을 넘어서야 그 카드
 * 뒤로 간다(가장자리에 살짝 걸친 것만으로 순서가 바뀌면 손이 흔들린다).
 */
export function columnInsertIndex(cards: ColumnCard[], y: number, movingId?: string): number {
  const list = ordered(cards).filter((c) => c.id !== movingId);
  let i = 0;
  for (const c of list) {
    if (y < c.y + c.h / 2) break;
    i += 1;
  }
  return i;
}

/** 삽입 위치 선을 그릴 y — 카드 사이(간격의 한가운데)에 놓는다. */
export function columnInsertY(rect: ColumnRect, cards: ColumnCard[], index: number, movingId?: string): number {
  const list = ordered(cards).filter((c) => c.id !== movingId);
  if (!list.length) return rect.y + COLUMN_PAD;
  if (index <= 0) return (list[0] as ColumnCard).y - COLUMN_GAP / 2;
  const prev = list[Math.min(index, list.length) - 1] as ColumnCard;
  return prev.y + prev.h + COLUMN_GAP / 2;
}

/**
 * 끌고 있는 카드를 그 자리(y)에 끼워 넣은 뒤의 자리들 — 드롭 순간 순서를 정하는
 * 데 쓴다. 끼워 넣기는 **y만** 임시로 바꿔 `columnLayout`에 넘기는 것으로 끝난다
 * (순서가 좌표이므로 별도 배열이 필요 없다는 설계의 이점).
 */
export function columnLayoutWithInsert(rect: ColumnRect, cards: ColumnCard[], movingId: string, insertIndex: number): Record<string, CardSlot> {
  const others = ordered(cards).filter((c) => c.id !== movingId);
  const moving = cards.find((c) => c.id === movingId);
  if (!moving) return columnLayout(rect, cards);
  const idx = Math.max(0, Math.min(insertIndex, others.length));
  const seq = [...others.slice(0, idx), moving, ...others.slice(idx)];
  // 자리 순서를 y로 표현해 다시 넘긴다(1, 2, 3 … 은 상대 순서만 뜻한다).
  return columnLayout(
    rect,
    seq.map((c, i) => ({ ...c, y: i })),
  );
}

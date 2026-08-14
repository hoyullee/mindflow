import { describe, expect, it } from 'vitest';
import { columnDropIndex, columnDropIndicator, dropIndicator, dropTargetAt, edgeScroll } from './kanbanDrag';
import type { ColumnHit } from './kanbanDrag';

const rect = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });

// 열 둘: c1(0~300), c2(320~620). c1에 카드 둘(각 높이 40, 사이 8).
const columns: ColumnHit[] = [
  {
    id: 'c1',
    rect: rect(0, 0, 300, 800),
    cards: [
      { id: 'a', rect: rect(10, 50, 290, 90) },
      { id: 'b', rect: rect(10, 98, 290, 138) },
    ],
  },
  { id: 'c2', rect: rect(320, 0, 620, 800), cards: [] },
];

describe('칸반 카드 드래그 — 드롭 자리', () => {
  it('열은 가로 위치로 고른다 — 카드가 없는 열의 아무 데나 놓아도 그 열이다', () => {
    expect(dropTargetAt(columns, 400, 700, 'a')).toEqual({ colId: 'c2', index: 0 });
    expect(dropTargetAt(columns, 150, 700, 'x')).toEqual({ colId: 'c1', index: 2 });
  });

  it('열 안 자리는 카드의 **중심**을 넘어야 바뀐다', () => {
    expect(dropTargetAt(columns, 150, 60, 'x')).toEqual({ colId: 'c1', index: 0 }); // a의 중심(70) 앞
    expect(dropTargetAt(columns, 150, 80, 'x')).toEqual({ colId: 'c1', index: 1 }); // a의 중심 뒤
    expect(dropTargetAt(columns, 150, 130, 'x')).toEqual({ colId: 'c1', index: 2 }); // b의 중심(118) 뒤
  });

  it('끌고 있는 카드는 자리 계산에서 빠진다(자기 자리 때문에 밀리지 않게)', () => {
    // a를 끌고 b의 중심 위에 있으면 → b 앞(0번)
    expect(dropTargetAt(columns, 150, 100, 'a')).toEqual({ colId: 'c1', index: 0 });
  });

  it('어느 열에도 닿지 않으면 null', () => {
    expect(dropTargetAt(columns, 700, 100, 'a')).toBeNull();
  });

  it('삽입 선은 카드 사이(또는 빈 열의 위쪽)에 그린다', () => {
    expect(dropIndicator(columns, { colId: 'c1', index: 0 }, 'x')).toMatchObject({ top: 46 });
    expect(dropIndicator(columns, { colId: 'c1', index: 1 }, 'x')).toMatchObject({ top: 94 });
    expect(dropIndicator(columns, { colId: 'c2', index: 0 }, 'x')).toMatchObject({ top: 8 });
    expect(dropIndicator(columns, { colId: 'gone', index: 0 }, 'x')).toBeNull();
  });

  it('가장자리에 가까우면 스크롤 방향을 돌려준다', () => {
    expect(edgeScroll(10, 0, 1000)).toBeLessThan(0);
    expect(edgeScroll(990, 0, 1000)).toBeGreaterThan(0);
    expect(edgeScroll(500, 0, 1000)).toBe(0);
  });
});

describe('칸반 열 드래그 — 놓일 자리', () => {
  it('열의 **중심**을 넘어야 자리가 바뀐다 (끌고 있는 열은 계산에서 뺀다)', () => {
    // c1(0~300) c2(320~620). c1을 끌고 있으면 후보는 c2 하나뿐이다.
    expect(columnDropIndex(columns, 100, 'c1')).toBe(0); // c2의 중심(470) 앞
    expect(columnDropIndex(columns, 500, 'c1')).toBe(1); // c2의 중심 뒤
    // c2를 끌고 있으면 후보는 c1.
    expect(columnDropIndex(columns, 100, 'c2')).toBe(0);
    expect(columnDropIndex(columns, 200, 'c2')).toBe(1);
  });

  it('세로 선은 후보 열의 왼쪽/오른쪽 바깥에 그린다', () => {
    expect(columnDropIndicator(columns, 0, 'c1')).toMatchObject({ left: 312, top: 0, height: 800 });
    expect(columnDropIndicator(columns, 1, 'c1')).toMatchObject({ left: 628 });
    expect(columnDropIndicator([], 0, 'c1')).toBeNull();
  });
});

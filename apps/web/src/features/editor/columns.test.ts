import { describe, expect, it } from 'vitest';
import { COLUMN_GAP, COLUMN_PAD, columnCardWidth, columnInsertIndex, columnInsertY, columnLayout, columnLayoutWithInsert } from './columns';

const RECT = { x: 100, y: 200, w: 320, h: 600 };
const card = (id: string, y: number, h = 80) => ({ id, x: 0, y, w: 200, h });

describe('열 모드 프레임(칸반) 배치', () => {
  it('카드를 위에서부터 쌓고 폭을 열에 맞춘다', () => {
    const slots = columnLayout(RECT, [card('a', 250), card('b', 400)]);
    const w = columnCardWidth(RECT); // 320 - 16*2
    expect(w).toBe(288);
    expect(slots.a).toEqual({ x: 116, y: 216, w });
    expect(slots.b).toEqual({ x: 116, y: 216 + 80 + COLUMN_GAP, w });
  });

  it('순서는 **y 좌표**가 정한다 — 배열을 저장하지 않는다', () => {
    // b가 위에 있으면 b가 먼저다.
    const slots = columnLayout(RECT, [card('a', 500), card('b', 300)]);
    expect(slots.b!.y).toBeLessThan(slots.a!.y);
  });

  it('멱등 — 이미 맞춰진 열을 다시 계산해도 값이 그대로다', () => {
    const cards = [card('a', 250), card('b', 400)];
    const first = columnLayout(RECT, cards);
    const settled = cards.map((c) => ({ ...c, y: first[c.id]!.y, w: first[c.id]!.w }));
    expect(columnLayout(RECT, settled)).toEqual(first);
  });

  it('카드 높이가 제각각이어도 간격이 일정하다', () => {
    const slots = columnLayout(RECT, [card('a', 250, 60), card('b', 400, 140), card('c', 500, 40)]);
    expect(slots.b!.y - (slots.a!.y + 60)).toBe(COLUMN_GAP);
    expect(slots.c!.y - (slots.b!.y + 140)).toBe(COLUMN_GAP);
  });

  it('좁은 열에서도 카드가 최소 폭 아래로 내려가지 않는다', () => {
    expect(columnCardWidth({ ...RECT, w: 80 })).toBe(120);
  });

  it('삽입 위치는 카드의 **중심**을 넘어야 바뀐다', () => {
    const cards = [card('a', 216, 80), card('b', 308, 80)]; // a: 216~296, b: 308~388
    expect(columnInsertIndex(cards, 200)).toBe(0); // a 위
    expect(columnInsertIndex(cards, 250)).toBe(0); // a의 중심(256) 앞
    expect(columnInsertIndex(cards, 260)).toBe(1); // a의 중심 뒤
    expect(columnInsertIndex(cards, 400)).toBe(2); // 맨 아래
  });

  it('끌고 있는 카드는 삽입 위치 계산에서 빠진다(자기 자리 때문에 밀리지 않게)', () => {
    const cards = [card('a', 216, 80), card('m', 308, 80)];
    expect(columnInsertIndex(cards, 220, 'm')).toBe(0);
  });

  it('삽입 선은 카드 사이(간격 한가운데)에 그린다', () => {
    const cards = [card('a', 216, 80), card('b', 308, 80)];
    expect(columnInsertY(RECT, cards, 0)).toBe(216 - COLUMN_GAP / 2);
    expect(columnInsertY(RECT, cards, 1)).toBe(216 + 80 + COLUMN_GAP / 2);
    // 빈 열은 안쪽 여백 자리에.
    expect(columnInsertY(RECT, [], 0)).toBe(RECT.y + COLUMN_PAD);
  });

  it('끼워 넣은 뒤의 자리 — 그 순서대로 다시 쌓인다', () => {
    const cards = [card('a', 216, 80), card('b', 308, 80), card('m', 900, 60)];
    const slots = columnLayoutWithInsert(RECT, cards, 'm', 1);
    expect(slots.a!.y).toBeLessThan(slots.m!.y);
    expect(slots.m!.y).toBeLessThan(slots.b!.y);
    // 간격은 그대로.
    expect(slots.m!.y - (slots.a!.y + 80)).toBe(COLUMN_GAP);
    expect(slots.b!.y - (slots.m!.y + 60)).toBe(COLUMN_GAP);
  });
});

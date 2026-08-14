import { describe, expect, it } from 'vitest';
import type { KanbanCard, KanbanColumn } from './model';
import { cardsInColumn, moveCard, moveColumn, needsRenumber, posForIndex, removeColumn, renumberColumn } from './kanban';
import { parseDoc, serializeDoc } from './serialize';
import * as Y from 'yjs';
import { applyDocToYDoc, applyUpdate, docToYDoc, encodeStateAsUpdate, yDocToDoc } from './crdt';

const card = (id: string, col: string, pos: number): KanbanCard => ({ id, col, pos, text: id });
const cols: KanbanColumn[] = [
  { id: 'c1', title: '할 일' },
  { id: 'c2', title: '진행 중' },
];

describe('칸반 — 카드 순서(pos 분수 인덱스)', () => {
  const cards = [card('a', 'c1', 0), card('b', 'c1', 1024), card('z', 'c2', 0)];

  it('열 안 카드는 pos 순서다', () => {
    expect(cardsInColumn(cards, 'c1').map((c) => c.id)).toEqual(['a', 'b']);
    expect(cardsInColumn(cards, 'c2').map((c) => c.id)).toEqual(['z']);
  });

  it('가운데에 끼우면 이웃의 중간값을 받는다', () => {
    expect(posForIndex(cards, 'c1', 1)).toBe(512);
    expect(posForIndex(cards, 'c1', 0)).toBeLessThan(0); // 맨 위
    expect(posForIndex(cards, 'c1', 2)).toBeGreaterThan(1024); // 맨 아래
    expect(posForIndex(cards, 'nope', 0)).toBe(0); // 빈 열
  });

  it('다른 열로 옮기면 소속과 자리가 함께 바뀐다', () => {
    const next = moveCard(cards, 'a', 'c2', 0);
    const a = next.find((c) => c.id === 'a')!;
    expect(a.col).toBe('c2');
    expect(cardsInColumn(next, 'c2').map((c) => c.id)).toEqual(['a', 'z']);
    expect(cardsInColumn(next, 'c1').map((c) => c.id)).toEqual(['b']);
  });

  it('같은 열 안에서 순서를 바꾼다 — 자기 자리 때문에 한 칸 밀리지 않는다', () => {
    const next = moveCard(cards, 'b', 'c1', 0);
    expect(cardsInColumn(next, 'c1').map((c) => c.id)).toEqual(['b', 'a']);
    // 맨 아래로 되돌리기
    const back = moveCard(next, 'b', 'c1', 1);
    expect(cardsInColumn(back, 'c1').map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('사이가 촘촘해지면 다시 매긴다', () => {
    const tight = [card('a', 'c1', 0), card('b', 'c1', 1e-9)];
    expect(needsRenumber(tight, 'c1')).toBe(true);
    const fixed = renumberColumn(tight, 'c1');
    expect(cardsInColumn(fixed, 'c1').map((c) => c.pos)).toEqual([0, 1024]);
    expect(needsRenumber(fixed, 'c1')).toBe(false);
  });

  it('열을 지우면 그 안의 카드도 함께 사라진다', () => {
    const out = removeColumn(cols, cards, 'c1');
    expect(out.columns.map((c) => c.id)).toEqual(['c2']);
    expect(out.cards.map((c) => c.id)).toEqual(['z']);
  });

  it('열 순서는 배열 순서 — 옮기면 그대로 자리가 바뀐다', () => {
    expect(moveColumn(cols, 'c2', 0).map((c) => c.id)).toEqual(['c2', 'c1']);
    expect(moveColumn(cols, 'nope', 0)).toBe(cols);
  });
});

describe('칸반 — 직렬화', () => {
  const base = { nodes: {}, floats: [], lines: [], zones: [], layoutMode: 'right' as const, themeKey: 'white' };

  it('칸반 문서만 열·카드를 싣는다 — 다른 종류의 저장본은 그대로', () => {
    const kanban = serializeDoc({ ...base, kind: 'kanban', columns: cols, cards: [card('a', 'c1', 0)] });
    expect(kanban.kind).toBe('kanban');
    expect(kanban.columns).toHaveLength(2);
    expect(kanban.cards).toHaveLength(1);

    const map = serializeDoc({ ...base, columns: cols, cards: [card('a', 'c1', 0)] });
    expect(map.kind).toBeUndefined();
    expect(map.columns).toBeUndefined();
    expect(map.cards).toBeUndefined();
  });

  it('저장 → 다시 읽기 왕복', () => {
    const doc = serializeDoc({ ...base, kind: 'kanban', columns: cols, cards: [card('a', 'c1', 0), card('b', 'c1', 1024)] });
    const round = parseDoc(JSON.parse(JSON.stringify(doc)));
    expect(round).toEqual(doc);
  });

  it('카드 메타(분류·기한·담당·긴급)가 왕복한다 — 없는 필드는 저장본에도 없다', () => {
    const meta = { ...card('a', 'c1', 0), tag: '개발', due: '2026-08-20', owner: 'me@ex.com', ownerName: '지수', flagged: true };
    const doc = serializeDoc({ ...base, kind: 'kanban', columns: cols, cards: [meta, card('b', 'c1', 1024)] });
    const round = parseDoc(JSON.parse(JSON.stringify(doc)))!;
    expect(round.cards![0]).toEqual(meta);
    // 값이 없는 카드는 키 자체가 없다(빈 필드를 흘리지 않는다 — CRDT·저장본 무게).
    expect(Object.keys(round.cards![1]!).sort()).toEqual(['col', 'id', 'pos', 'text']);
  });

  it('분류 목록(tags)도 함께 실린다 — 카드가 다 지워져도 분류는 남는다', () => {
    const tags = [{ id: 't1', name: '개발', color: '#3f8fd0' }, { id: 't2', name: '리서치' }];
    const doc = serializeDoc({ ...base, kind: 'kanban', columns: cols, cards: [], tags });
    expect(doc.tags).toEqual(tags);
    expect(parseDoc(JSON.parse(JSON.stringify(doc)))!.tags).toEqual(tags);
    // 칸반이 아닌 문서에는 실리지 않는다.
    expect(serializeDoc({ ...base, tags }).tags).toBeUndefined();
  });

  it('소속 열이 없는 카드는 읽을 때 버린다(유령 방지)', () => {
    const raw = { v: 1, nodes: {}, floats: [], lines: [], zones: [], layoutMode: 'right', themeKey: 'white', kind: 'kanban', columns: cols, cards: [card('a', 'c1', 0), card('ghost', 'gone', 0)] };
    const round = parseDoc(raw)!;
    expect(round.cards!.map((c) => c.id)).toEqual(['a']);
  });
});

describe('칸반 — 협업(CRDT)', () => {
  const doc = (columns: KanbanColumn[], cards: KanbanCard[]) => ({
    v: 1 as const,
    nodes: {},
    floats: [],
    lines: [],
    zones: [],
    layoutMode: 'right' as const,
    themeKey: 'white',
    kind: 'kanban' as const,
    columns,
    cards,
  });

  it('열·카드가 Y.Doc을 왕복한다', () => {
    const d = doc(cols, [card('a', 'c1', 0), card('b', 'c2', 0)]);
    const y = docToYDoc(d);
    const back = yDocToDoc(y);
    expect(back.kind).toBe('kanban');
    expect(back.columns).toEqual(cols);
    expect(back.cards).toEqual(d.cards);
  });

  it('갈라진 두 사람이 **다른 카드**를 옮기면 둘 다 살아남는다', () => {
    const start = doc(cols, [card('a', 'c1', 0), card('b', 'c1', 1024)]);
    const A = docToYDoc(start);
    const B = new Y.Doc();
    applyUpdate(B, encodeStateAsUpdate(A));

    // A는 a를 두 번째 열로, B는 b를 두 번째 열로 — 서로 모르는 채.
    const aDoc = yDocToDoc(A);
    applyDocToYDoc(A, { ...aDoc, cards: moveCard(aDoc.cards!, 'a', 'c2', 0) }, aDoc);
    const bDoc = yDocToDoc(B);
    applyDocToYDoc(B, { ...bDoc, cards: moveCard(bDoc.cards!, 'b', 'c2', 0) }, bDoc);

    // 재연결
    applyUpdate(A, encodeStateAsUpdate(B));
    applyUpdate(B, encodeStateAsUpdate(A));
    const merged = yDocToDoc(A);
    expect(yDocToDoc(B)).toEqual(merged); // 수렴
    expect(cardsInColumn(merged.cards!, 'c2').map((c) => c.id).sort()).toEqual(['a', 'b']); // 둘 다 옮겨졌다
    expect(cardsInColumn(merged.cards!, 'c1')).toHaveLength(0);
  });
});

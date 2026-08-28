import { describe, expect, it } from 'vitest';
import type { KanbanCard, KanbanColumn } from './model';
import { cardsInColumn, moveCard, moveColumn, needsRenumber, patchCardMeta, posForIndex, removeColumn, renumberColumn, shiftCardDates, sortColumnsByDue } from './kanban';
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

  it('카드 메타(분류·시작일·기한·담당·긴급)가 왕복한다 — 없는 필드는 저장본에도 없다', () => {
    const meta = { ...card('a', 'c1', 0), tag: '개발', start: '2026-08-10', due: '2026-08-20', owner: 'me@ex.com', ownerName: '지수', flagged: true };
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

describe('sortColumnsByDue — 전체 기한순 정렬(요청)', () => {
  const cards: KanbanCard[] = [
    { id: 'a', col: 'c1', pos: 0, text: 'A', due: '2026-09-02' },
    { id: 'b', col: 'c1', pos: 1024, text: 'B' },
    { id: 'c', col: 'c1', pos: 2048, text: 'C', due: '2026-08-30' },
    { id: 'd', col: 'c1', pos: 3072, text: 'D' },
    { id: 'e', col: 'c2', pos: 0, text: 'E', due: '2026-12-01' },
    { id: 'f', col: 'c2', pos: 1024, text: 'F', due: '2026-08-01' },
  ];

  it('빠른 기한이 위로, 기한 없는 카드는 뒤로 — 같은 값끼리는 지금 순서를 지킨다', () => {
    const next = sortColumnsByDue(cards, ['c1', 'c2']);
    expect(cardsInColumn(next, 'c1').map((c) => c.id)).toEqual(['c', 'a', 'b', 'd']);
    expect(cardsInColumn(next, 'c2').map((c) => c.id)).toEqual(['f', 'e']);
  });

  it('열 소속·내용은 그대로다 — pos만 바뀐다', () => {
    const next = sortColumnsByDue(cards, ['c1', 'c2']);
    for (const before of cards) {
      const after = next.find((c) => c.id === before.id) as KanbanCard;
      expect({ ...after, pos: 0 }).toEqual({ ...before, pos: 0 });
    }
  });

  it('목록에 없는 열의 카드는 손대지 않는다', () => {
    const next = sortColumnsByDue(cards, ['c1']);
    expect(next.filter((c) => c.col === 'c2')).toEqual(cards.filter((c) => c.col === 'c2'));
  });
});

// 카드 곁정보 편집·기간 이동 — 에디터 카드 상세와 홈 일정 화면이 **같은 규칙**을 쓴다
// (일정 화면은 문서를 열지 않고 저장까지 하므로, 규칙이 두 벌이면 언젠가 어긋난다).
describe('patchCardMeta / shiftCardDates', () => {
  const c1 = (over: Partial<KanbanCard> = {}): KanbanCard => ({ id: 'k1', col: 'c1', pos: 1, text: '카드', ...over });

  it('값이 비면 그 필드를 지운다(빈 필드가 CRDT로 오가지 않게)', () => {
    const before = [c1({ tag: '개발', due: '2026-08-20', start: '2026-08-18', owner: 'a@b.c', ownerName: '민', flagged: true })];
    const after = patchCardMeta(before, 'k1', { tag: null, due: null, start: null, owner: null, flagged: false });
    expect(after[0]).toEqual({ id: 'k1', col: 'c1', pos: 1, text: '카드' });
  });

  it('담당은 이메일과 이름이 늘 함께 움직인다', () => {
    const after = patchCardMeta([c1()], 'k1', { owner: { email: 'a@b.c', name: '민' } });
    expect(after[0]).toMatchObject({ owner: 'a@b.c', ownerName: '민' });
    const cleared = patchCardMeta(after, 'k1', { owner: null });
    expect('owner' in cleared[0]!).toBe(false);
    expect('ownerName' in cleared[0]!).toBe(false);
  });

  it('건드리지 않은 필드와 다른 카드는 그대로(원본 불변)', () => {
    const before = [c1({ tag: '개발', due: '2026-08-20' }), c1({ id: 'k2', tag: '기획' })];
    const after = patchCardMeta(before, 'k1', { due: '2026-08-25' });
    expect(after[0]).toMatchObject({ tag: '개발', due: '2026-08-25' });
    expect(after[1]).toBe(before[1]);
    expect(before[0]!.due).toBe('2026-08-20');
  });

  it('분류 이름은 24자로 자른다', () => {
    const after = patchCardMeta([c1()], 'k1', { tag: 'x'.repeat(40) });
    expect(after[0]!.tag!.length).toBe(24);
  });

  it('기간은 시작일·기한을 함께 옮긴다(하루짜리는 기한만)', () => {
    expect(shiftCardDates({ due: '2026-08-20', start: '2026-08-18' }, 3)).toEqual({ due: '2026-08-23', start: '2026-08-21' });
    expect(shiftCardDates({ due: '2026-08-20' }, -5)).toEqual({ due: '2026-08-15' });
    // 달·해를 넘어도 로컬 날짜로 정확히
    expect(shiftCardDates({ due: '2026-12-30' }, 3)).toEqual({ due: '2027-01-02' });
    expect(shiftCardDates({ due: 'bad' }, 1)).toEqual({});
  });
});

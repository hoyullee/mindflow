import { describe, expect, it } from 'vitest';
import type { Doc, KanbanCard, KanbanColumn, NoteBlock } from '@mindflow/mindmap-core';
import {
  boardDocIdFromUrl,
  embedFrames,
  embedKindOf,
  embedRuleLabel,
  embedSize,
  fitFrame,
  kanbanCards,
  kanbanStats,
  kanbanView,
  mergeEmbed,
  mindmapView,
  moveKanbanCard,
  outlineOf,
  whiteboardView,
  zoomAt,
} from './noteEmbed';

const block = (embed?: NoteBlock['embed']): NoteBlock => ({ id: 'b1', kind: 'link', ...(embed ? { embed } : {}) }) as NoteBlock;

const col = (id: string, title: string): KanbanColumn => ({ id, title } as KanbanColumn);
const card = (id: string, c: string, pos: number, owner?: string): KanbanCard => ({ id, col: c, pos, text: id, ...(owner ? { owner } : {}) });

const kanbanDoc = (): Doc =>
  ({
    kind: 'kanban',
    columns: [col('a', '할 일'), col('b', '진행 중'), col('c', '완료')],
    cards: [card('k1', 'a', 1, 'me@x.com'), card('k2', 'a', 2), card('k3', 'b', 1, 'me@x.com'), card('k4', 'c', 1)],
  }) as Doc;

describe('embed 기본값', () => {
  it('embed가 없는 옛 블록은 펼침이다 — 본문에 붙이는 이유가 "지금 상태"라서', () => {
    expect(embedSize(block())).toBe('lg');
    expect(embedSize(block({ size: 'sm' }))).toBe('sm');
  });

  it('kind가 없는 옛 문서는 마인드맵으로 읽는다(직렬화 기본값과 같다)', () => {
    expect(embedKindOf({} as Doc)).toBe('map');
    expect(embedKindOf({ kind: 'kanban' } as Doc)).toBe('kanban');
  });

  it('배지는 "여기서 되는 일" — 칸반이라도 편집 권한이 없으면 보기 전용', () => {
    expect(embedRuleLabel('kanban', true)).toBe('열 이동만');
    // 「보기 전용」은 달지 않는다(요청) — 되는 일이 따로 있을 때만 배지가 뜬다.
    expect(embedRuleLabel('kanban', false)).toBe('');
    expect(embedRuleLabel('map', true)).toBe('');
    expect(embedRuleLabel('board', true)).toBe('');
  });

  it('칸반 기본 열은 두 번째(진행 중) — 열이 하나뿐이면 첫 열', () => {
    expect(kanbanView(block(), [col('a', '할 일'), col('b', '진행 중')]).col).toBe(1);
    expect(kanbanView(block(), [col('a', '할 일')]).col).toBe(0);
  });

  it('저장된 열이 사라졌으면(열 삭제) 기본으로 되돌아간다 — 빈 목록을 그리지 않는다', () => {
    expect(kanbanView(block({ kanban: { col: 7, mine: false } }), [col('a', 'A'), col('b', 'B')]).col).toBe(1);
  });

  it('마인드맵·화이트보드 기본값', () => {
    // 맵이 기본이다(요청) — 본문에 맵을 붙이는 사람이 보여 주려는 것은 그 생김새다.
    expect(mindmapView(block())).toEqual({ view: 'map', open: [0, 1] });
    expect(mindmapView({ embed: { mindmap: { view: 'outline', open: [] } } })).toEqual({ view: 'outline', open: [] });
    expect(whiteboardView(block())).toEqual({ frame: 0, height: 'm' });
  });
});

describe('mergeEmbed', () => {
  it('안쪽 칸을 덮어쓰지 않고 겹친다 — 「내 카드만」만 뒤집어도 고른 열이 산다', () => {
    const next = mergeEmbed({ kanban: { col: 2, mine: false } }, { kanban: { mine: true } });
    expect(next.kanban).toEqual({ col: 2, mine: true });
  });

  it('종류가 다른 칸은 건드리지 않는다', () => {
    const next = mergeEmbed({ mindmap: { view: 'map', open: [3] } }, { size: 'sm' });
    expect(next).toEqual({ mindmap: { view: 'map', open: [3] }, size: 'sm' });
  });
});

describe('칸반 셈', () => {
  it('막대는 언제나 전체 기준이고 탭의 수만 걸러진다', () => {
    const all = kanbanStats(kanbanDoc(), { mine: false, me: 'me@x.com' });
    expect(all.cols.map((c) => c.count)).toEqual([2, 1, 1]);
    expect(all.total).toBe(4);
    expect(all.done).toBe(1);

    const mine = kanbanStats(kanbanDoc(), { mine: true, me: 'me@x.com' });
    expect(mine.cols.map((c) => c.count)).toEqual([1, 1, 0]);
    expect(mine.cols.map((c) => c.total)).toEqual([2, 1, 1]);
    expect(mine.total).toBe(4);
  });

  it('카드는 pos 순서로 여섯 장까지 — 나머지는 more로 센다', () => {
    const doc = { kind: 'kanban', columns: [col('a', 'A')], cards: [8, 7, 6, 5, 4, 3, 2, 1].map((n) => card(`k${n}`, 'a', n)) } as Doc;
    const got = kanbanCards(doc, { col: 0, mine: false, me: '' });
    expect(got.cards.map((c) => c.id)).toEqual(['k1', 'k2', 'k3', 'k4', 'k5', 'k6']);
    expect(got.more).toBe(2);
  });

  it('카드를 옮기면 그 열의 끝에 놓인다', () => {
    const doc = kanbanDoc();
    const next = moveKanbanCard(doc, 'k1', 2);
    expect(next.cards?.find((c) => c.id === 'k1')?.col).toBe('c');
    expect(next.cards?.find((c) => c.id === 'k1')?.pos).toBe(2);
  });

  it('같은 열이면 문서를 그대로 돌려준다 — 값이 같으면 저장도 하지 않는다', () => {
    const doc = kanbanDoc();
    expect(moveKanbanCard(doc, 'k1', 0)).toBe(doc);
    expect(moveKanbanCard(doc, '없는카드', 1)).toBe(doc);
  });
});

describe('마인드맵 개요', () => {
  const mapDoc = (): Doc =>
    ({
      nodes: {
        r: { id: 'r', text: '중심', parent: null, children: ['a', 'b'], x: 0, y: 0 },
        a: { id: 'a', text: '가지 A', parent: 'r', children: ['a1'], x: 0, y: 0 },
        a1: { id: 'a1', text: '자식', parent: 'a', children: ['a2'], x: 0, y: 0 },
        a2: { id: 'a2', text: '손자', parent: 'a1', children: [], x: 0, y: 0 },
        b: { id: 'b', text: '가지 B', parent: 'r', children: [], x: 0, y: 0 },
        f: { id: 'f', text: '떠 있는 메모', parent: null, children: [], free: true, x: 0, y: 0 },
      },
    }) as unknown as Doc;

  it('뿌리와 가지, 그 아래 **자손 전부**를 깊이와 함께 준다(요청)', () => {
    const o = outlineOf(mapDoc());
    expect(o.root?.text).toBe('중심');
    expect(o.branches.map((b) => b.text)).toEqual(['가지 A', '가지 B']);
    // 펼치면 **아래 전부**를 준다(요청) — 손자까지, 깊이를 달고.
    expect(o.branches[0]?.children.map((c) => `${c.depth}:${c.text}`)).toEqual(['1:자식', '2:손자']);
    expect(o.branches[0]?.count).toBe(2);
  });

  it('자유 노드는 줄기가 아니라 개요에 넣지 않는다', () => {
    expect(outlineOf(mapDoc()).branches.some((b) => b.text === '떠 있는 메모')).toBe(false);
  });

  it('빈 맵은 뿌리 없음', () => {
    expect(outlineOf({ nodes: {} } as Doc)).toEqual({ root: null, branches: [] });
  });
});

describe('화이트보드 창', () => {
  it('첫 칩은 언제나 「전체」이고 그 상자가 모든 것을 감싼다', () => {
    const doc = {
      floats: [{ x: 10, y: 20, w: 100, h: 50 }],
      zones: [{ id: 'z1', label: '회의', x: 200, y: 0, w: 300, h: 200 }],
      nodes: {},
    } as unknown as Doc;
    const frames = embedFrames(doc);
    expect(frames[0]).toMatchObject({ id: '', label: '전체', x: 10, y: 0 });
    expect(frames[0]?.w).toBe(490);
    expect(frames[1]).toMatchObject({ id: 'z1', label: '회의' });
  });

  it('빈 보드도 폭·높이가 0이 아니다 — 맞춤이 나눗셈에서 무너지지 않게', () => {
    const frames = embedFrames({ floats: [], zones: [], nodes: {} } as unknown as Doc);
    expect(frames[0]?.w).toBeGreaterThan(0);
    expect(frames[0]?.h).toBeGreaterThan(0);
  });

  it('맞춤은 프레임 가운데를 창 가운데로 오게 하고 배율은 20~250%로 묶는다', () => {
    const cam = fitFrame({ id: '', label: '전체', x: 0, y: 0, w: 100, h: 100 }, { w: 400, h: 300 });
    expect(cam.z).toBeLessThanOrEqual(2.5);
    expect(cam.x + 50 * cam.z).toBeCloseTo(200, 5);
    expect(cam.y + 50 * cam.z).toBeCloseTo(150, 5);
  });

  it('확대는 창 가운데를 붙든다', () => {
    const before = { x: 0, y: 0, z: 1 };
    const after = zoomAt(before, 1.1, { w: 200, h: 100 });
    // 확대 전후로 창 가운데에 보이던 보드 좌표가 같다.
    expect((100 - after.x) / after.z).toBeCloseTo((100 - before.x) / before.z, 5);
    expect(zoomAt({ x: 0, y: 0, z: 2.4 }, 1.1, { w: 200, h: 100 }).z).toBe(2.5);
  });
});

describe('붙여넣은 주소', () => {
  const origin = 'https://geurio.com';

  it('우리 보드 주소면 문서 id를 뽑는다(상대·절대 모두)', () => {
    expect(boardDocIdFromUrl('/editor?map=abc', origin)).toBe('abc');
    expect(boardDocIdFromUrl('https://geurio.com/editor?map=abc#x', origin)).toBe('abc');
    expect(boardDocIdFromUrl('  /editor?map=abc  ', origin)).toBe('abc');
  });

  it('남의 사이트·다른 길·글이 섞인 것은 아니다 — 평범한 링크로 둔다', () => {
    expect(boardDocIdFromUrl('https://example.com/editor?map=abc', origin)).toBe('');
    expect(boardDocIdFromUrl('/home?map=abc', origin)).toBe('');
    expect(boardDocIdFromUrl('여기 보세요 /editor?map=abc', origin)).toBe('');
    expect(boardDocIdFromUrl('/editor', origin)).toBe('');
    expect(boardDocIdFromUrl('', origin)).toBe('');
  });
});

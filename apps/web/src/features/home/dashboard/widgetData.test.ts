import { describe, expect, it } from 'vitest';
import { widgetDataOf } from './widgetData';

const OPTS = { maxCards: 2, maxBranches: 4, maxNotes: 6 };

describe('widgetDataOf', () => {
  it('못 읽는 본문·빈 값은 null(위젯이 폴백 문구를 그린다)', () => {
    expect(widgetDataOf(null, OPTS)).toBeNull();
    expect(widgetDataOf('not json', OPTS)).toBeNull();
    expect(widgetDataOf('"scalar"', OPTS)).toBeNull();
    // 루트도 메모도 열도 없는 문서
    expect(widgetDataOf(JSON.stringify({ nodes: {}, floats: [] }), OPTS)).toBeNull();
  });

  it('칸반: 열별 카드·"+N개 더"·진행 바·done(마지막 열 = 완료)', () => {
    const raw = JSON.stringify({
      kind: 'kanban',
      columns: [
        { id: 'c1', title: '할 일' },
        { id: 'c2', title: '완료' },
      ],
      cards: [
        { id: 'k1', col: 'c1', pos: 1, text: '첫 줄\n둘째 줄', tag: '개발', ownerName: '이호율', due: '2026-09-01' },
        { id: 'k2', col: 'c1', pos: 2, text: 'b' },
        { id: 'k3', col: 'c1', pos: 3, text: 'c' },
        { id: 'k4', col: 'c2', pos: 1, text: 'd' },
      ],
    });
    const d = widgetDataOf(raw, OPTS);
    expect(d?.kind).toBe('kanban');
    if (d?.kind !== 'kanban') return;
    expect(d.columns.map((c) => c.name)).toEqual(['할 일', '완료']);
    expect(d.columns[0]).toMatchObject({ count: 3, more: 1 }); // maxCards 2 → 하나 접힘
    expect(d.columns[0]!.cards[0]).toMatchObject({ title: '첫 줄', tag: '개발', who: '호율', due: '2026-09-01' });
    expect(d.bar.map((s) => Math.round(s.pct))).toEqual([75, 25]);
    expect(d.done).toEqual({ done: 1, total: 4 });
  });

  it('마인드맵: 루트 글자 + 1단계 가지(표시 수 제한·총수 별도)', () => {
    const raw = JSON.stringify({
      nodes: {
        root: { id: 'root', text: '분기 계획', children: ['a', 'b', 'c', 'd', 'e'] },
        a: { id: 'a', text: '가지 A', children: [] },
        b: { id: 'b', text: '가지 B', children: [] },
        c: { id: 'c', text: '가지 C', children: [] },
        d: { id: 'd', text: '가지 D', children: [] },
        e: { id: 'e', text: '가지 E', children: [] },
      },
    });
    const d = widgetDataOf(raw, OPTS);
    expect(d?.kind).toBe('mind');
    if (d?.kind !== 'mind') return;
    expect(d.root).toBe('분기 계획');
    expect(d.branches).toEqual(['가지 A', '가지 B', '가지 C', '가지 D']); // maxBranches 4
    expect(d.branchTotal).toBe(5);
    expect(d.nodeCount).toBe(6);
  });

  it('화이트보드: 메모(이미지 제외)를 0..1 좌표로 정규화한다', () => {
    const raw = JSON.stringify({
      nodes: {},
      floats: [
        { id: 'f1', x: 0, y: 0, w: 100, text: '왼쪽 위' },
        { id: 'f2', x: 100, y: 100, w: 100, text: '오른쪽 아래' },
        { id: 'f3', x: 50, y: 50, img: 'mfimg:doc/x.webp' },
      ],
    });
    const d = widgetDataOf(raw, OPTS);
    expect(d?.kind).toBe('board');
    if (d?.kind !== 'board') return;
    expect(d.noteTotal).toBe(2); // 이미지 플로트는 제외
    expect(d.notes[0]).toMatchObject({ text: '왼쪽 위', l: 0, t: 0 });
    expect(d.notes[1]!.l).toBeGreaterThan(0.4);
    expect(d.notes[1]!.t).toBeGreaterThan(0.4);
  });
});

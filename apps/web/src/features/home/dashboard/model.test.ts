import { describe, expect, it } from 'vitest';
import { DASH_CAP, DASH_SIZES, coerceDashboards, moveInList, nextDashName, parseSize, sizesFor } from './model';

describe('dashboard model', () => {
  it('coerceDashboards: 배열이 아니면/모양이 어긋난 항목은 조용히 버린다', () => {
    expect(coerceDashboards(undefined)).toEqual([]);
    expect(coerceDashboards('junk')).toEqual([]);
    expect(coerceDashboards({ spaces: [] })).toEqual([]);
    // id 없는 대시보드·docId 없는 위젯은 버리고, 나머지는 살린다
    const out = coerceDashboards([
      { id: 'd1', name: '이번 주', items: [{ id: 'w1', docId: 'doc1', size: '2x2' }, { id: 'w2' }, 'junk'] },
      { name: '이름뿐' },
      null,
    ]);
    expect(out).toEqual([{ id: 'd1', name: '이번 주', items: [{ id: 'w1', docId: 'doc1', size: '2x2' }] }]);
  });

  it('coerceDashboards: 모르는 크기는 2x2로, 위젯은 CAP까지 자른다', () => {
    const items = Array.from({ length: DASH_CAP + 3 }, (_, i) => ({ id: `w${i}`, docId: `doc${i}`, size: i === 0 ? '9x9' : '1x1' }));
    const [d] = coerceDashboards([{ id: 'd1', name: 'n', items }]);
    expect(d!.items.length).toBe(DASH_CAP);
    expect(d!.items[0]!.size).toBe('2x2');
    expect(d!.items[1]!.size).toBe('1x1');
  });

  it('nextDashName: "대시보드" → "대시보드 2" → 겹치지 않는 첫 번호', () => {
    expect(nextDashName([])).toBe('대시보드');
    expect(nextDashName([{ id: 'a', name: '대시보드', items: [] }])).toBe('대시보드 2');
    expect(
      nextDashName([
        { id: 'a', name: '대시보드', items: [] },
        { id: 'b', name: '대시보드 2', items: [] },
      ]),
    ).toBe('대시보드 3');
  });

  it('moveInList: 한 칸 이동, 범위를 벗어나면 같은 참조 그대로', () => {
    const list = ['a', 'b', 'c'];
    expect(moveInList(list, 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveInList(list, 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveInList(list, 0, 3)).toBe(list);
    expect(moveInList(list, -1, 0)).toBe(list);
    expect(moveInList(list, 1, 1)).toBe(list);
  });

  it('sizesFor: 칸반은 3×2 아래를 내주지 않고, 맵·보드는 전부', () => {
    expect(sizesFor('kanban')).toEqual(['3x2', '4x2', '3x3', '4x3']);
    expect(sizesFor('map')).toEqual([...DASH_SIZES]);
    expect(sizesFor('board')).toEqual([...DASH_SIZES]);
  });

  it('parseSize: "CxR"을 [C,R]로, 못 읽으면 2×2로', () => {
    expect(parseSize('3x2')).toEqual([3, 2]);
    expect(parseSize('1x1')).toEqual([1, 1]);
    expect(parseSize('garbage')).toEqual([2, 2]);
  });
});

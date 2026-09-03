import { describe, expect, it } from 'vitest';
import { DASH_CAP, DASH_COLS, DASH_ROWS_MAX, DASH_SIZES, calWidgetMode, coerceDashboards, isCalItem, isValidSize, moveInList, parseSize, sizesFor } from './model';

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


  it('일정 위젯은 문서를 가리키지 않는다 — `kind`로 구별하고 옛 항목은 문서로 읽는다', () => {
    const out = coerceDashboards([
      {
        id: 'd1',
        name: 'n',
        items: [
          { id: 'w1', docId: 'doc1', size: '2x2' }, // 옛 블롭: kind가 없으면 문서
          { id: 'w2', kind: 'cal', size: '4x3' },
          { id: 'w3', kind: 'cal' }, // 크기가 없으면 2x2
          { id: 'w4', kind: 'cal', size: '9x9' }, // 격자를 넘으면 2x2
          { id: 'w5', size: '2x2' }, // 문서도 일정도 아니면 버린다
        ],
      },
    ]);
    expect(out[0]!.items).toEqual([
      { id: 'w1', docId: 'doc1', size: '2x2' },
      { id: 'w2', kind: 'cal', size: '4x3' },
      { id: 'w3', kind: 'cal', size: '2x2' },
      { id: 'w4', kind: 'cal', size: '2x2' },
    ]);
    expect(isCalItem(out[0]!.items[1]!)).toBe(true);
    expect(isCalItem(out[0]!.items[0]!)).toBe(false);
  });

  it('크기가 보기를 정한다 — 4×3 월간, 3×3 달력만, 1×3 목록+미니, 2×2 주간, 그보다 작으면 목록', () => {
    expect(calWidgetMode(4, 3)).toBe('month');
    expect(calWidgetMode(4, 4)).toBe('month');
    // 3열은 옆 패널을 넣을 폭이 없다 — 달력만(요청)
    expect(calWidgetMode(3, 3)).toBe('month-only');
    expect(calWidgetMode(3, 4)).toBe('month-only');
    // 한 열 + 높이 = 이번 주 마감 + 미니 달력(요청)
    expect(calWidgetMode(1, 4)).toBe('list-mini');
    expect(calWidgetMode(1, 3)).toBe('list-mini');
    expect(calWidgetMode(4, 2)).toBe('week');
    expect(calWidgetMode(2, 2)).toBe('week');
    expect(calWidgetMode(3, 2)).toBe('week');
    expect(calWidgetMode(2, 1)).toBe('list');
    expect(calWidgetMode(1, 1)).toBe('list');
    expect(calWidgetMode(1, 2)).toBe('list');
    // 일정은 1×1부터 놓을 수 있다(목록으로도 뜻이 통한다)
    expect(sizesFor('cal')).toEqual([...DASH_SIZES]);
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
    expect(sizesFor('kanban')).toEqual(['3x2', '4x2', '3x3', '4x3', '3x4', '4x4', '3x5', '4x5']);
    expect(sizesFor('map')).toEqual([...DASH_SIZES]);
    expect(sizesFor('board')).toEqual([...DASH_SIZES]);
  });

  it('parseSize: "CxR"을 [C,R]로, 못 읽으면 2×2로', () => {
    expect(parseSize('3x2')).toEqual([3, 2]);
    expect(parseSize('1x1')).toEqual([1, 1]);
    expect(parseSize('garbage')).toEqual([2, 2]);
  });

  it('5행까지 놓을 수 있다(요청) — 격자를 넘는 값은 잘린다', () => {
    expect(DASH_SIZES).toContain('4x4');
    // 달력 위젯의 월간 + 옆 패널이 그만한 높이를 실제로 쓴다(요청 — 3×5·4×5).
    expect(DASH_SIZES).toContain('3x5');
    expect(DASH_SIZES).toContain('4x5');
    expect(parseSize('4x5')).toEqual([4, 5]);
    expect(parseSize('9x9')).toEqual([DASH_COLS, DASH_ROWS_MAX]);
    expect(isValidSize('4x5')).toBe(true);
    expect(isValidSize('4x6')).toBe(false);
    expect(isValidSize('5x4')).toBe(false);
    expect(isValidSize('2x2 ')).toBe(false);
    expect(isValidSize(22)).toBe(false);
  });

  it('모서리 드래그가 만든 조합(선택지에 없는 2×3)도 그대로 복원된다', () => {
    // 예전엔 선택지 목록 membership으로 검증해 다음 로드에서 2×2로 되돌아갔다.
    const [d] = coerceDashboards([{ id: 'd1', name: '보드', items: [{ id: 'w1', docId: 'doc-a', size: '2x3' }, { id: 'w2', docId: 'doc-b', size: '7x1' }] }]);
    expect(d!.items[0]!.size).toBe('2x3');
    expect(d!.items[1]!.size).toBe('2x2'); // 격자를 넘는 값은 기본값으로
  });
});

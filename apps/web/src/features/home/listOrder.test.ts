import { describe, expect, it } from 'vitest';
import { moveInList } from './listOrder';

describe('moveInList', () => {
  it('한 칸 이동, 범위를 벗어나면 같은 참조 그대로', () => {
    const list = ['a', 'b', 'c'];
    expect(moveInList(list, 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveInList(list, 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveInList(list, 0, 3)).toBe(list);
    expect(moveInList(list, -1, 0)).toBe(list);
    expect(moveInList(list, 1, 1)).toBe(list);
  });
});

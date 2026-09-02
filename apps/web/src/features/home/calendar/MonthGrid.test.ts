import { describe, expect, it } from 'vitest';
import { cellCapacity } from './MonthGrid';

// 칸에 칩을 몇 줄 그릴 수 있는가 — 제보 #1의 뿌리(예전에는 고정 2줄이라 칸이 커도
// `+N개 더`가 떴다). 격자가 실측한 칸 높이를 이 함수가 줄 수로 바꾼다.

describe('월 격자 칸 용량(cellCapacity)', () => {
  it('칸이 커지면 더 많은 줄이 들어간다', () => {
    const small = cellCapacity(86, false); // 최소 높이
    const big = cellCapacity(160, false);
    expect(big).toBeGreaterThan(small);
    expect(small).toBeGreaterThanOrEqual(2);
  });

  it('아주 낮은 칸에서도 한 줄은 남긴다 — 0줄은 `+N개 더`조차 그릴 수 없다', () => {
    expect(cellCapacity(20, false)).toBe(1);
    expect(cellCapacity(0, true)).toBe(1);
  });

  it('폰은 칩이 작아 같은 높이에 더 들어간다', () => {
    expect(cellCapacity(120, true)).toBeGreaterThanOrEqual(cellCapacity(120, false));
  });
});

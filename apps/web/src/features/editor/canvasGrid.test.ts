import { describe, expect, it } from 'vitest';
import { GRID_UNIT, dotGrid } from './canvasGrid';

describe('dotGrid — 배경 도트 격자', () => {
  it('배율 1에서는 문서 단위 그대로 (한 칸마다 하나)', () => {
    const g = dotGrid(1);
    expect(g.cell).toBe(GRID_UNIT);
    expect(g.step).toBe(1);
  });

  it('확대하면 간격·반지름이 함께 커진다 (실제 비율)', () => {
    const g = dotGrid(2.4);
    expect(g.cell).toBeCloseTo(GRID_UNIT * 2.4, 5);
    expect(g.step).toBe(1);
    expect(g.radius).toBeCloseTo(1.2 * 2.4, 5);
  });

  it('축소에서 간격이 너무 좁아지면 격자 단계를 건너뛴다 (얼룩 방지)', () => {
    const g = dotGrid(0.25); // 26*0.25 = 6.5px → 네 칸마다 하나 = 26px
    expect(g.step).toBe(4);
    expect(g.cell).toBeCloseTo(26, 5);
    expect(g.cell).toBeGreaterThanOrEqual(14);
  });

  it('건너뛰는 배수는 2의 거듭제곱 — 남는 도트는 문서 격자 위에 그대로 선다', () => {
    for (const z of [0.05, 0.1, 0.2, 0.3, 0.4, 0.6, 0.9, 1.6, 3]) {
      const { cell, step } = dotGrid(z);
      expect(Math.log2(step) % 1).toBe(0);
      expect(cell).toBeGreaterThanOrEqual(14);
    }
  });

  it('반지름은 하한 0.8px — 축소에서 도트가 사라지지 않는다', () => {
    expect(dotGrid(0.1).radius).toBe(0.8);
    expect(dotGrid(4).radius).toBeLessThanOrEqual(3.2);
  });
});

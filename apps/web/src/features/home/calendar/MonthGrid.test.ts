import { describe, expect, it } from 'vitest';
import { cellCapacity } from './MonthGrid';

// 칸에 칩을 몇 줄 그릴 수 있는가 — 제보의 뿌리(예전에는 고정 2줄이라 칸이 커도
// `+N개 더`가 떴고, 그 뒤에도 모든 줄을 칩 높이로 세어 한 줄을 놓쳤다).
// 격자가 실측한 칸 높이를 이 함수가 줄 수로 바꾼다.

describe('월 격자 칸 용량(cellCapacity)', () => {
  it('칸이 커지면 더 많은 줄이 들어간다', () => {
    const small = cellCapacity(86, false); // 최소 높이
    const big = cellCapacity(160, false);
    expect(big.rows).toBeGreaterThan(small.rows);
    expect(small.rows).toBeGreaterThanOrEqual(2);
  });

  it('아주 낮은 칸에서도 한 줄은 남긴다 — 0줄은 `+N개 더`조차 그릴 수 없다', () => {
    expect(cellCapacity(20, false)).toEqual({ rows: 1, withMore: 1 });
    expect(cellCapacity(0, true)).toEqual({ rows: 1, withMore: 1 });
  });

  it('폰은 칩이 작아 같은 높이에 더 들어간다', () => {
    expect(cellCapacity(120, true).rows).toBeGreaterThanOrEqual(cellCapacity(120, false).rows);
  });

  // 라이브 실측: 격자 715px / 6주 = 칸 119.17px. 안쪽 여백 11 + 숫자 줄 20 + 간격 2 +
  // 격자선 1 = 34를 빼면 85.17px이 칩 몫이다.
  //   · 칩만 n줄  = 23n − 2  → 3줄 67 ✓ / 4줄 90 ✗
  //   · n줄 + 접힘 = 23n + 13 → 3줄 82 ✓
  // 그래서 접을 때도 **3줄을 그릴 수 있다** — 예전 식은 2줄만 그리고 한 줄을 버렸다.
  it('접힘 표시가 붙는 줄 수를 따로 센다 — `+N개 더` 줄은 칩보다 낮다(제보)', () => {
    const cap = cellCapacity(715 / 6, false);
    expect(cap.rows).toBe(3);
    expect(cap.withMore).toBe(3);
  });

  it('픽셀 예산을 넘기지 않는다 — 접힘 줄을 붙여도 칸 안이다', () => {
    for (const h of [86, 95, 104, 110, 119, 130, 141, 160, 180]) {
      const cap = cellCapacity(h, false);
      const avail = h - (20 + 2 + 11 + 1);
      // 칩만 그릴 때 / 접힘 표시를 붙일 때, 둘 다 칸 안에 들어가야 한다.
      if (cap.rows > 1) expect(23 * cap.rows - 2).toBeLessThanOrEqual(avail);
      if (cap.withMore > 1) expect(23 * cap.withMore + 13).toBeLessThanOrEqual(avail);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { centerInside, idsInFrame, innermostFrameFor } from './frames';

const F = { x: 0, y: 0, w: 400, h: 300 };

describe('프레임 소속 판정(그릇)', () => {
  it('중심이 안이면 소속 — 가장자리에 걸쳐도 중심이 밖이면 아니다', () => {
    expect(centerInside(F, { x: 100, y: 100, w: 80, h: 40 })).toBe(true);
    // 왼쪽으로 크게 삐져나와 중심이 프레임 밖
    expect(centerInside(F, { x: -70, y: 100, w: 80, h: 40 })).toBe(false);
    // 경계에 정확히 걸치면 안쪽
    expect(centerInside(F, { x: 360, y: 100, w: 80, h: 40 })).toBe(true);
  });

  it('담고 있는 것들의 id를 돌려준다', () => {
    const boxes = [
      { id: 'a', x: 10, y: 10, w: 100, h: 50 },
      { id: 'b', x: 500, y: 10, w: 100, h: 50 }, // 밖
      { id: 'c', x: 300, y: 200, w: 60, h: 60 },
    ];
    expect(idsInFrame(F, boxes)).toEqual(['a', 'c']);
  });

  it('겹친 프레임 중에는 가장 안쪽(작은) 것을 고른다', () => {
    const frames = [
      { id: 'outer', x: 0, y: 0, w: 800, h: 600 },
      { id: 'inner', x: 100, y: 100, w: 200, h: 150 },
    ];
    expect(innermostFrameFor(frames, { x: 150, y: 150, w: 40, h: 20 })).toBe('inner');
    expect(innermostFrameFor(frames, { x: 500, y: 400, w: 40, h: 20 })).toBe('outer');
    expect(innermostFrameFor(frames, { x: 900, y: 900, w: 40, h: 20 })).toBeNull();
  });
});

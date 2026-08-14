import { describe, expect, it } from 'vitest';
import { centerInside, fullyInside, idsInFrame, innermostFrameAt, innermostFrameFor } from './frames';

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

describe('겹친 프레임 — 완전 포함만 담고, 안쪽이 위', () => {
  const big = { id: 'zb', x: -320, y: -260, w: 620, h: 420 };
  const small = { id: 'zs', x: -200, y: -160, w: 240, h: 160 };

  it('중심 규칙은 **서로가 서로를 담는다** — 그래서 프레임끼리는 쓸 수 없다', () => {
    // 제보의 배치 그대로: 큰 프레임의 중심이 작은 프레임 안에 들어간다.
    expect(centerInside(big, small)).toBe(true);
    expect(centerInside(small, big)).toBe(true);
  });

  it('완전 포함은 한쪽으로만 성립한다 — 계층이 언제나 한 방향', () => {
    expect(fullyInside(big, small)).toBe(true);
    expect(fullyInside(small, big)).toBe(false);
  });

  it('부분 겹침은 서로 담지 않는다(형제)', () => {
    const a = { id: 'pa', x: 0, y: 0, w: 200, h: 200 };
    const b = { id: 'pb', x: 60, y: 60, w: 200, h: 200 };
    // 중심 규칙으로는 둘 다 참이었다.
    expect(centerInside(a, b)).toBe(true);
    expect(centerInside(b, a)).toBe(true);
    // 완전 포함으로는 둘 다 거짓.
    expect(fullyInside(a, b)).toBe(false);
    expect(fullyInside(b, a)).toBe(false);
  });

  it('겹친 프레임 중 가장 안쪽(작은) 것을 집는다 — 배열 순서와 무관하게', () => {
    // 큰 것이 나중에 만들어져 배열 뒤에 있어도 작은 것이 이긴다.
    expect(innermostFrameAt([small, big], -100, -100)).toBe('zs');
    expect(innermostFrameAt([big, small], -100, -100)).toBe('zs');
    // 작은 영역 밖·큰 영역 안이면 큰 것.
    expect(innermostFrameAt([small, big], 200, 100)).toBe('zb');
    // 어디에도 없으면 null.
    expect(innermostFrameAt([small, big], 9999, 9999)).toBeNull();
    // 라벨 알약이 위로 튀어나온 만큼은 위쪽으로 넉넉히 잡는다.
    expect(innermostFrameAt([big], -300, -270, 16)).toBe('zb');
    expect(innermostFrameAt([big], -300, -270)).toBeNull();
  });
});

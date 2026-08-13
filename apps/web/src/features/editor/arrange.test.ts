import { describe, expect, it } from 'vitest';
import { alignGuides, arrangeDeltas, minTargets } from './arrange';

const B = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

describe('정렬·분배 계산', () => {
  const boxes = {
    a: B(0, 0, 100, 40), //  0..100
    b: B(200, 60, 60, 80), // 200..260
    c: B(400, 200, 40, 20), // 400..440
  };

  it('좌측 정렬 — 선택 전체의 왼쪽 끝에 맞춘다(그 자체는 안 움직인다)', () => {
    const d = arrangeDeltas(boxes, 'left');
    expect(d.a).toEqual({ dx: 0, dy: 0 });
    expect(d.b).toEqual({ dx: -200, dy: 0 });
    expect(d.c).toEqual({ dx: -400, dy: 0 });
  });

  it('우측 정렬 — 오른쪽 끝(440)에 맞춘다', () => {
    const d = arrangeDeltas(boxes, 'right');
    expect(d.a!.dx).toBe(340); // 0+100 → 440
    expect(d.b!.dx).toBe(180); // 200+60 → 440
    expect(d.c!.dx).toBe(0);
  });

  it('가운데 정렬 — 선택 상자의 중심(220)에 맞춘다', () => {
    const d = arrangeDeltas(boxes, 'hcenter');
    expect(d.a!.dx).toBe(170); // 중심 50 → 220
    expect(d.b!.dx).toBe(-10); // 중심 230 → 220
    expect(d.c!.dx).toBe(-200); // 중심 420 → 220
    // 세로는 건드리지 않는다.
    expect(d.a!.dy).toBe(0);
  });

  it('위/아래/세로 가운데도 같은 규칙', () => {
    expect(arrangeDeltas(boxes, 'top').c).toEqual({ dx: 0, dy: -200 });
    expect(arrangeDeltas(boxes, 'bottom').a!.dy).toBe(180); // 0+40 → 220
    // 세로 중심 = (0..220)의 가운데 = 110
    expect(arrangeDeltas(boxes, 'vcenter').a!.dy).toBe(90); // 중심 20 → 110
  });

  it('가로 분배 — 양 끝은 고정, 사이 간격이 균등해진다', () => {
    const d = arrangeDeltas(boxes, 'hspace');
    expect(d.a).toEqual({ dx: 0, dy: 0 });
    expect(d.c).toEqual({ dx: 0, dy: 0 });
    // span 440, 폭 합 200 → 간격 (440-200)/2 = 120. b는 100+120 = 220에 온다.
    expect(d.b).toEqual({ dx: 20, dy: 0 });
    const moved = { ...boxes, b: { ...boxes.b, x: boxes.b.x + d.b!.dx } };
    const gap1 = moved.b.x - (moved.a.x + moved.a.w);
    const gap2 = moved.c.x - (moved.b.x + moved.b.w);
    expect(gap1).toBe(gap2);
  });

  it('세로 분배도 같은 규칙(간격 균등)', () => {
    const d = arrangeDeltas(boxes, 'vspace');
    const moved = Object.fromEntries(Object.entries(boxes).map(([k, b]) => [k, { ...b, y: b.y + d[k]!.dy }]));
    const gap1 = moved.b!.y - (moved.a!.y + moved.a!.h);
    const gap2 = moved.c!.y - (moved.b!.y + moved.b!.h);
    expect(gap1).toBeCloseTo(gap2, 6);
  });

  it('정렬은 2개, 분배는 3개부터 — 모자라면 아무것도 옮기지 않는다', () => {
    expect(minTargets('left')).toBe(2);
    expect(minTargets('hspace')).toBe(3);
    expect(arrangeDeltas({ a: B(0, 0, 10, 10) }, 'left')).toEqual({});
    expect(arrangeDeltas({ a: B(0, 0, 10, 10), b: B(50, 0, 10, 10) }, 'hspace')).toEqual({});
  });

  it('정렬은 멱등 — 한 번 맞춘 뒤 다시 눌러도 그대로다', () => {
    const d1 = arrangeDeltas(boxes, 'left');
    const moved = Object.fromEntries(Object.entries(boxes).map(([k, b]) => [k, { ...b, x: b.x + d1[k]!.dx }]));
    const d2 = arrangeDeltas(moved, 'left');
    Object.values(d2).forEach((d) => expect(d).toEqual({ dx: 0, dy: 0 }));
  });
});

describe('스마트 가이드(맞춤 안내선)', () => {
  const tol = 6;
  // 기준이 되는 이웃: x 100..300, y 100..200 (중심 200/150)
  const other = B(100, 100, 200, 100);

  it('왼쪽 끝이 가까우면 붙고, 그 자리에 세로 안내선이 뜬다', () => {
    const r = alignGuides(B(104, 400, 80, 40), [other], tol);
    expect(r.x).toBe(100);
    expect(r.y).toBe(400); // 세로는 걸린 게 없다
    const g = r.guides.find((x) => x.axis === 'x')!;
    expect(g.at).toBe(100);
    // 안내선은 끌고 있는 상자와 이웃을 잇는 만큼 길다.
    expect(g.from).toBe(100);
    expect(g.to).toBe(440);
    expect(r.guides.some((x) => x.axis === 'y')).toBe(false);
  });

  it('중심끼리도 맞는다 — 가로·세로 동시에', () => {
    // 중심 (200,150)에 3px 어긋난 상자
    const r = alignGuides(B(200 - 40 + 3, 150 - 20 - 2, 80, 40), [other], tol);
    expect(r.x + 40).toBe(200);
    expect(r.y + 20).toBe(150);
    expect(r.guides.map((g) => g.axis).sort()).toEqual(['x', 'y']);
  });

  it('허용치 밖이면 붙지 않는다(안내선도 없다)', () => {
    const r = alignGuides(B(112, 400, 80, 40), [other], tol);
    expect(r.x).toBe(112);
    expect(r.guides).toEqual([]);
  });

  it('여러 이웃이 같은 선에 있으면 안내선이 그만큼 길어진다', () => {
    const far = B(100, 600, 60, 40); // 같은 x=100
    const r = alignGuides(B(103, 300, 80, 40), [other, far], tol);
    expect(r.x).toBe(100);
    const g = r.guides.find((x) => x.axis === 'x')!;
    expect(g.from).toBe(100); // other의 위
    expect(g.to).toBe(640); // far의 아래
  });

  it('가장 가까운 선을 고른다 — 오른쪽 끝이 더 가까우면 그쪽', () => {
    // 상자 오른쪽(x+80)이 300(이웃 오른쪽)에서 2px, 왼쪽은 100에서 218px
    const r = alignGuides(B(218, 400, 80, 40), [other], tol);
    expect(r.x + 80).toBe(300);
  });
});

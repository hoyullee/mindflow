import { describe, expect, it } from 'vitest';
import { arrangeDeltas, minTargets } from './arrange';

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

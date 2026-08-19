import { describe, expect, it } from 'vitest';
import { THEMES, canvasWash } from './theme';

// 캔버스 방사형 그라데이션(canvasWash) — 기본 캔버스 두 벌은 디자인 원본
// `Geurio 마인드맵 리디자인`의 스톱 색 **그대로**여야 한다(요청: 색상 완전 동일).
describe('canvasWash', () => {
  const DESIGN = 'radial-gradient(1200px 700px at 62% 46%, #fffdfb 0%, #fdf7f2 55%, #fbf2eb 100%)';

  it('코랄 맵 캔버스는 디자인 원본 스톱 그대로', () => {
    expect(canvasWash(THEMES.coral.canvasBg)).toBe(DESIGN);
  });

  it('화이트(화이트보드 기본) 캔버스도 디자인 원본 스톱 그대로 — 흰색 믹스면 그라데이션이 보이지 않는다', () => {
    expect(canvasWash(THEMES.white.canvasBg)).toBe(DESIGN);
  });

  it('다른 밝은 테마는 자기 canvasBg에서 파생한다(팔레트와 부딪히지 않게)', () => {
    const w = canvasWash(THEMES.ocean.canvasBg);
    expect(w).toContain('1200px 700px at 62% 46%');
    expect(w).toContain(`${THEMES.ocean.canvasBg} 100%`); // 가장자리 = 오션 캔버스색
    expect(w).not.toContain('#fbf2eb'); // 원본의 따뜻한 가장자리색이 아니다
  });

  it('다크는 아주 옅게만 밝힌다(잿빛으로 바래지 않게)', () => {
    const w = canvasWash(THEMES.dark.canvasBg);
    expect(w).toContain(`${THEMES.dark.canvasBg} 100%`);
    expect(w).not.toContain('#fffdfb');
  });
});

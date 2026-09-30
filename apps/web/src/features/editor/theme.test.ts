import { describe, expect, it } from 'vitest';
import { THEMES, UI_THEME, canvasWash } from './theme';

// 캔버스 방사형 그라데이션(canvasWash) — 기본 캔버스 두 벌은 디자인 원본
// `Geurio 마인드맵 리디자인`의 스톱 색 **그대로**여야 한다(요청: 색상 완전 동일).
describe('canvasWash', () => {
  const DESIGN = 'radial-gradient(1200px 700px at 62% 46%, #fffdfb 0%, #fdf7f2 55%, #fbf2eb 100%)';

  it('코랄 맵·화이트(화이트보드 기본) 캔버스는 **단색 `#F7FBF1`**(요청 — 옛 따뜻한 그라데이션이 아니다)', () => {
    expect(THEMES.coral.canvasBg).toBe('#f7fbf1');
    expect(THEMES.white.canvasBg).toBe('#f7fbf1');
    for (const k of ['coral', 'white'] as const) {
      const w = canvasWash(THEMES[k].canvasBg);
      expect(w).toBe('linear-gradient(#f7fbf1, #f7fbf1)');
      expect(w).not.toContain('#fbf2eb');
    }
  });

  it('옛 캔버스 값(`#f5ece5`·`#ffffff`)이 넘어오면 원본 스톱 그대로 — 홈 썸네일 등 옛 호출부', () => {
    expect(canvasWash('#f5ece5')).toBe(DESIGN);
    expect(canvasWash('#ffffff')).toBe(DESIGN);
  });

  it('앱 껍데기(`UI_THEME`)의 가라앉은 면은 옛 색을 지킨다 — 캔버스 색이 팝업까지 물들지 않게', () => {
    expect(UI_THEME.canvasBg).toBe('#f5ece5');
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

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { CSS_MENU_TONE, MENU_GLYPH_W, MENU_PAD, MENU_RADIUS, MENU_ROW_H, MENU_TOUCH_ROW_H, menuRowStyle } from './menuDesign';

/** 저장소 어디서 실행하든 파일을 찾는다(apps/web 기준 / 루트 기준). */
function read(rel: string): string {
  const f = [`src/${rel}`, `apps/web/src/${rel}`].find((x) => existsSync(x));
  if (!f) throw new Error(`not found: ${rel}`);
  return readFileSync(f, 'utf8');
}

describe('우클릭 메뉴 디자인 — 앱에 한 벌(요청)', () => {
  it('기준값은 칸반 카드 메뉴의 값이다', () => {
    expect([MENU_ROW_H, MENU_TOUCH_ROW_H, MENU_RADIUS, MENU_PAD, MENU_GLYPH_W]).toEqual([38, 44, 14, 6, 17]);
    const row = menuRowStyle(CSS_MENU_TONE);
    expect(row.fontSize).toBe(13.5);
    expect(row.fontWeight).toBe(500);
    expect(row.gap).toBe(11);
    expect(row.borderRadius).toBe(9);
    expect(row.padding).toBe('0 11px');
    // 손가락은 44px 터치 타깃(앱 전체가 지켜 온 규칙).
    expect(menuRowStyle(CSS_MENU_TONE, { touch: true }).minHeight).toBe(44);
    // 위험 행은 경고색 글자, 비활성은 흐린 글자.
    expect(menuRowStyle(CSS_MENU_TONE, { danger: true }).color).toBe(CSS_MENU_TONE.danger);
    expect(menuRowStyle(CSS_MENU_TONE, { disabled: true }).cursor).toBe('not-allowed');
  });

  /**
   * 드리프트 가드 — 세 우클릭 메뉴(캔버스·칸반·홈/일정)가 이 모듈을 **쓴다**.
   * 값을 그 자리에 다시 적으면 그 순간 네 번째 디자인이 생긴다(제보의 뿌리).
   */
  it('세 메뉴가 공용 모듈을 쓰고 각자 행 스타일을 다시 적지 않는다', () => {
    const files = [
      'features/editor/components/ContextMenu.tsx',
      'features/editor/components/KanbanCardMenu.tsx',
      'features/home/components/HomeContextMenu.tsx',
    ];
    for (const f of files) {
      const src = read(f);
      expect(src).toContain('menuDesign');
      expect(src).toContain('menuRowStyle');
      // 행 hover는 공용 클래스가 칠한다(인라인 background는 클래스를 이긴다).
      expect(src).toContain('mf-menu-row');
    }
  });

  it('hover 규칙은 인라인 스타일을 이긴다(!important) — 세 메뉴가 같은 반응을 얻는다', () => {
    const css = read('components/menu.css');
    const rule = css.slice(css.indexOf('.mf-menu-row:hover'));
    expect(rule).toContain('background: var(--mf-menu-hover) !important');
    expect(rule).toContain('color: var(--mf-menu-hover-ink) !important');
    // 키보드로 겨눈 행(Radix `data-highlighted`)도 같은 모양이다.
    expect(rule).toContain("[data-highlighted]");
  });
});

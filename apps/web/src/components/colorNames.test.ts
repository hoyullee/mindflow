import { describe, expect, it } from 'vitest';
import { colorName, swatchNames } from './colorNames';
import { THEMES } from '../features/editor/theme';

// 색 고르기 칸은 글자 없는 동그라미다 — 이름이 없으면 스크린리더가 "버튼"이라고만
// 읽고, hex를 넣으면 "샵 이 비 이 비 이 비"가 된다. 이름은 표가 아니라 hex에서
// 계산하므로(테마를 늘려도 따라온다) 계산 규칙 자체를 여기서 지킨다.
describe('colorName', () => {
  it('무채색은 검정·회색·흰색으로 — 색조를 붙이지 않는다', () => {
    expect(colorName('#000000')).toBe('검정');
    expect(colorName('#ffffff')).toBe('흰색');
    expect(colorName('#8e8e8e')).toBe('회색');
    expect(colorName('#3a3a3a')).toBe('진한 회색');
  });

  it('어두운 주황 계열은 갈색이다 — "진한 주황"이라 부르면 아무도 갈색인 줄 모른다', () => {
    expect(colorName('#9a6b44')).toBe('갈색');
    expect(colorName('#33281f')).toBe('진한 갈색');
  });

  it('밝은 노랑은 "황금"이 아니라 노랑이다(형광펜 색)', () => {
    expect(colorName('#ffe14d')).toBe('노랑');
    // 어둡고 탁한 노랑만 황금.
    expect(colorName('#e0a53c')).toBe('황금');
  });

  it('중간 보라를 남색이라 읽지 않는다(색조 칸에서 남색을 뺀 이유)', () => {
    expect(colorName('#8a6bd1')).toBe('보라');
  });

  it('잘못된 값에도 죽지 않는다 — 이름이 없으면 칸을 고를 수 없다', () => {
    expect(colorName('')).toBeTruthy();
    expect(colorName('stripped')).toBeTruthy();
  });
});

describe('swatchNames', () => {
  it('같은 묶음에서 이름이 겹치면 **행 순서**로 번호를 붙인다', () => {
    // 모노 테마는 색조가 없어 회색이 여럿 — 번호가 없으면 구별이 불가능하다.
    const names = swatchNames(['#3a3a3a', '#565656', '#727272']);
    expect(names).toEqual(['진한 회색 1', '진한 회색 2', '진한 회색 3']);
  });

  it('겹치지 않는 이름에는 번호를 붙이지 않는다', () => {
    expect(swatchNames(['#d92626', '#2f7fd6'])).toEqual(['빨강', '파랑']);
  });

  it('어떤 테마의 팔레트든 칸이 **전부 구별된다** — 같은 이름이 남으면 고를 수 없다', () => {
    for (const [key, th] of Object.entries(THEMES)) {
      const rows = [th.palette, [th.panel, th.text, ...th.palette]];
      for (const row of rows) {
        const names = swatchNames(row);
        expect(new Set(names).size, `${key}: ${names.join(', ')}`).toBe(row.length);
        for (const n of names) expect(n.trim().length, `${key}: 빈 이름`).toBeGreaterThan(0);
      }
    }
  });
});

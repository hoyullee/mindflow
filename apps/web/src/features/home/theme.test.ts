import { beforeEach, describe, expect, it } from 'vitest';
import { applyHomeTheme, homeThemeKeyOf, homeThemeVars, HOME_THEMES, HOME_THEME_KEYS, loadHomeThemeCache, saveHomeThemeCache } from './theme';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('style');
});

describe('home theme', () => {
  it('기본 테마(코랄)의 색은 테마 기능 이전과 같다 — 고르지 않은 사람의 홈은 그대로', () => {
    // 이 값들이 home.css의 `:root` 기본값이자, 변수화 전 인라인 스타일에 박혀 있던 색이다.
    expect(homeThemeVars('coral')).toEqual({
      '--mf-accent': '#f0663f',
      '--mf-accent-rgb': '240,102,63',
      '--mf-accent-soft': '#fdeee7',
      '--mf-accent-strong': '#d9542f',
      '--mf-accent-mute': '#f2c4b3',
      '--mf-bg': '#fbf6f2',
      '--mf-sunken': '#f5ece5',
      '--mf-panel2': '#faf3ee',
      '--mf-border': '#ecdfd5',
      '--mf-border-soft': '#f0e6dd',
    });
  });

  it('테마마다 같은 변수 집합을 채운다 (빠진 변수 = 앞 테마의 색이 남는 것)', () => {
    const keys = Object.keys(homeThemeVars('coral')).sort();
    for (const k of HOME_THEME_KEYS) {
      expect(Object.keys(homeThemeVars(k)).sort()).toEqual(keys);
      for (const v of Object.values(homeThemeVars(k))) expect(v).toBeTruthy();
    }
  });

  it('accentRgb는 accent와 같은 색이다 (rgba(var(--mf-accent-rgb),…) 글로우가 강조색과 어긋나지 않게)', () => {
    for (const k of HOME_THEME_KEYS) {
      const t = HOME_THEMES[k];
      const [r, g, b] = t.accentRgb.split(',').map(Number);
      expect(`#${[r, g, b].map((n) => n!.toString(16).padStart(2, '0')).join('')}`).toBe(t.accent);
    }
  });

  it('저장된 값이 이상하면 기본 테마로 떨어진다', () => {
    expect(homeThemeKeyOf('ocean')).toBe('ocean');
    expect(homeThemeKeyOf('dark')).toBe('coral'); // 홈에는 다크가 없다(중립색이 아직 고정)
    expect(homeThemeKeyOf(undefined)).toBe('coral');
    expect(homeThemeKeyOf(null)).toBe('coral');
    expect(homeThemeKeyOf(7)).toBe('coral');
  });

  it('applyHomeTheme이 문서 루트에 변수를 입힌다', () => {
    applyHomeTheme('forest');
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--mf-accent')).toBe(HOME_THEMES.forest.accent);
    expect(root.style.getPropertyValue('--mf-bg')).toBe(HOME_THEMES.forest.bg);
    applyHomeTheme('grape');
    expect(root.style.getPropertyValue('--mf-accent')).toBe(HOME_THEMES.grape.accent);
  });

  it('캐시는 왕복하고, 손상된 값은 기본으로 읽는다', () => {
    expect(loadHomeThemeCache()).toBe('coral');
    saveHomeThemeCache('ocean');
    expect(loadHomeThemeCache()).toBe('ocean');
    localStorage.setItem('mf_home_theme', '{{망가진 값');
    expect(loadHomeThemeCache()).toBe('coral');
  });
});

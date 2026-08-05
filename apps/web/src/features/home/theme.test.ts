import { beforeEach, describe, expect, it } from 'vitest';
import { applyHomeTheme, homeThemeKeyOf, homeThemeVars, HOME_THEMES, HOME_THEME_KEYS, loadHomeThemeCache, saveHomeThemeCache } from './theme';

/** 상대 밝기(0=검정, 1=흰색) — 다크가 정말 "뒤집혔는지"를 값으로 확인하기 위한 헬퍼. */
function lum(hex: string): number {
  const c = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

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
      '--mf-accent-ink': '#ffffff',
      '--mf-bg': '#fbf6f2',
      '--mf-sunken': '#f5ece5',
      '--mf-panel': '#ffffff',
      '--mf-panel2': '#faf3ee',
      '--mf-panel-veil': 'rgba(255,255,255,0.92)',
      '--mf-panel-grey': '#fbf8f5',
      '--mf-overlay-veil': 'rgba(251,246,242,0.92)',
      '--mf-border': '#ecdfd5',
      '--mf-border-soft': '#f0e6dd',
      '--mf-hairline': '#f2e9e1',
      '--mf-scroll': '#d9c8ba',
      '--mf-skel-sheen': 'rgba(255,255,255,.55)',
      '--mf-text': '#33281f',
      '--mf-subtext': '#7c6d60',
      '--mf-muted': '#9c8b7e',
      '--mf-faint': '#b6a596',
      '--mf-faint2': '#c9b8a9',
      '--mf-danger': '#d64545',
      '--mf-danger-soft': '#fdecec',
      '--mf-danger-bg': '#fdf4f2',
      '--mf-danger-line': '#f3d9d4',
      '--mf-danger-mute': '#e7b9b3',
      '--mf-info': '#3f8fd0',
      '--mf-star': '#e0a53c',
      '--mf-hover-bright': '0.97',
      '--mf-success': '#2f9e63',
      '--mf-success-soft': '#e9f4ee',
      '--mf-success-ink': '#1e7a3a',
    });
  });

  it('다크는 면뿐 아니라 글자·상태색까지 뒤집는다 (배경만 어두워지면 흰 패널에 검은 글씨가 남는다)', () => {
    const light = HOME_THEMES.coral;
    const dark = HOME_THEMES.dark;
    expect(dark.dark).toBe(true);
    // 면은 어둡고 글자는 밝다 — 두 축이 함께 뒤집혔는지 밝기로 확인한다.
    expect(lum(dark.bg)).toBeLessThan(0.2);
    expect(lum(dark.panel)).toBeLessThan(0.2);
    expect(lum(dark.text)).toBeGreaterThan(0.8);
    expect(lum(dark.panel)).toBeLessThan(lum(light.panel));
    expect(lum(dark.text)).toBeGreaterThan(lum(light.text));
    // 글자 계단(진함→흐림)은 다크에서도 같은 방향으로 유지된다.
    const ramp = [dark.text, dark.subtext, dark.muted, dark.faint, dark.faint2].map(lum);
    for (let i = 1; i < ramp.length; i++) expect(ramp[i]!).toBeLessThan(ramp[i - 1]!);
    // 강조색 위 글자는 밝은 테마의 흰색 대신 어두운 잉크(코랄 위 대비 확보).
    expect(lum(dark.accentInk)).toBeLessThan(0.2);
    // 활성 행 글자는 어두운 면에서 **밝아져야** 한다(밝은 테마는 반대로 진해진다).
    expect(lum(dark.accentStrong)).toBeGreaterThan(lum(dark.accent));
    expect(lum(light.accentStrong)).toBeLessThan(lum(light.accent));
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
    expect(homeThemeKeyOf('dark')).toBe('dark');
    expect(homeThemeKeyOf('sunset')).toBe('coral'); // 없는 테마
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

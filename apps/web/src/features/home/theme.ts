/**
 * 홈 색상 테마 — 사용자가 고르는 홈 화면의 색.
 *
 * 에디터는 이미 문서별 테마(`features/editor/theme.ts`의 `THEMES`)를 갖고 있고,
 * 홈은 코랄 한 벌로 고정돼 있었다. 두 화면이 같은 이름·같은 색을 쓰도록 **에디터
 * 팔레트를 그대로 재사용**한다 — 홈에서 "오션"을 고른 사람이 에디터에서 만나는
 * "오션"과 같은 파랑이다.
 *
 * **다크는 제외한다.** 홈의 중립색(글자 `#33281f`, 패널 `#fff`, 보조문자 등 170여
 * 곳)은 아직 하드코딩이라 배경만 어둡게 바꾸면 흰 패널 위 검은 글씨가 그대로 남는다.
 * 여기서 다루는 건 **밝은 테마 다섯 벌**뿐이고, 다크는 중립색까지 변수화한 뒤의
 * 별건이다.
 *
 * 색은 CSS 변수로 내려 보낸다(`applyHomeTheme`) — 홈의 색은 대부분 인라인 스타일에
 * 박혀 있어서, 변수 한 겹을 끼우면 컴포넌트를 건드리지 않고 한 번에 갈아 끼울 수 있다.
 */

import { THEMES } from '../editor/theme';

export type HomeThemeKey = 'coral' | 'ocean' | 'forest' | 'grape' | 'mono';

export const HOME_THEME_KEYS: HomeThemeKey[] = ['coral', 'ocean', 'forest', 'grape', 'mono'];

export const DEFAULT_HOME_THEME: HomeThemeKey = 'coral';

/** 홈이 쓰는 색 한 벌. `accent*`는 강조색 계열, 나머지는 면·경계 계열. */
export interface HomeTheme {
  key: HomeThemeKey;
  label: string;
  /** 강조색(버튼·선택 테두리·아이콘). */
  accent: string;
  /** `rgba(var(--mf-accent-rgb),.18)` 형태로 쓰기 위한 "r,g,b" 문자열. */
  accentRgb: string;
  /** 강조색의 옅은 배경(활성 행·빈 상태 아이콘 칩) — 흰색에 강조색 12%. */
  accentSoft: string;
  /** 강조색의 진한 변형(링크 hover·활성 행 글자) — 강조색에 검정 12%. */
  accentStrong: string;
  /** 비활성 버튼의 강조색(누를 수 없음을 색으로) — 흰색에 강조색 45%. */
  accentMute: string;
  /** 페이지 배경. */
  bg: string;
  /** 가라앉은 면(최근 항목 트레이). */
  sunken: string;
  /** 살짝 뜬 면(hover 배경·입력창). */
  panel2: string;
  /** 경계선. */
  border: string;
  /** 옅은 구분선 — 경계선에 흰색 20%. */
  borderSoft: string;
}

/**
 * 다섯 벌. `accent`/`bg`/`sunken`/`panel2`/`border`는 에디터 팔레트에서 그대로 가져오고,
 * 파생 4색은 아래 규칙으로 계산한 값을 적어 둔다(런타임 색 연산 없음 — 값이 눈에 보이는
 * 편이 검토하기 쉽다):
 *   accentSoft   = mix(accent, #fff, 12%)
 *   accentStrong = mix(accent, #000, 12%)
 *   accentMute   = mix(accent, #fff, 45%)
 *   borderSoft   = mix(border, #fff, 20%)
 * 단 **코랄의 파생색은 오늘 쓰이던 값 그대로** 고정한다(기본 테마는 이번 변경 전후로
 * 색이 한 톤도 달라지지 않게 — 계산값과는 1~5 정도 차이가 난다).
 */
export const HOME_THEMES: Record<HomeThemeKey, HomeTheme> = {
  coral: {
    key: 'coral',
    label: THEMES.coral.label,
    accent: THEMES.coral.accent, // #f0663f
    accentRgb: '240,102,63',
    accentSoft: '#fdeee7',
    accentStrong: '#d9542f',
    accentMute: '#f2c4b3',
    bg: THEMES.coral.appBg,
    sunken: THEMES.coral.canvasBg,
    panel2: THEMES.coral.panel2,
    border: THEMES.coral.border,
    borderSoft: '#f0e6dd',
  },
  ocean: {
    key: 'ocean',
    label: THEMES.ocean.label,
    accent: THEMES.ocean.accent, // #2f7fd6
    accentRgb: '47,127,214',
    accentSoft: '#e6f0fa',
    accentStrong: '#2970bc',
    accentMute: '#a1c5ed',
    bg: THEMES.ocean.appBg,
    sunken: THEMES.ocean.canvasBg,
    panel2: THEMES.ocean.panel2,
    border: THEMES.ocean.border,
    borderSoft: '#e0e9f2',
  },
  forest: {
    key: 'forest',
    label: THEMES.forest.label,
    accent: THEMES.forest.accent, // #2f9e63
    accentRgb: '47,158,99',
    accentSoft: '#e6f3ec',
    accentStrong: '#298b57',
    accentMute: '#a1d3b9',
    bg: THEMES.forest.appBg,
    sunken: THEMES.forest.canvasBg,
    panel2: THEMES.forest.panel2,
    border: THEMES.forest.border,
    borderSoft: '#ddebe2',
  },
  grape: {
    key: 'grape',
    label: THEMES.grape.label,
    accent: THEMES.grape.accent, // #7d5bd0
    accentRgb: '125,91,208',
    accentSoft: '#efebf9',
    accentStrong: '#6e50b7',
    accentMute: '#c5b5ea',
    bg: THEMES.grape.appBg,
    sunken: THEMES.grape.canvasBg,
    panel2: THEMES.grape.panel2,
    border: THEMES.grape.border,
    borderSoft: '#e6dff2',
  },
  mono: {
    key: 'mono',
    label: THEMES.mono.label,
    accent: THEMES.mono.accent, // #2b2b2b
    accentRgb: '43,43,43',
    accentSoft: '#e6e6e6',
    accentStrong: '#262626',
    accentMute: '#a0a0a0',
    bg: THEMES.mono.appBg,
    sunken: THEMES.mono.canvasBg,
    panel2: THEMES.mono.panel2,
    border: THEMES.mono.border,
    borderSoft: '#e3e3e3',
  },
};

/** 저장된 값(워크스페이스 블롭·localStorage — 남이 쓴 값일 수 있다)을 유효한 키로. */
export function homeThemeKeyOf(v: unknown): HomeThemeKey {
  return typeof v === 'string' && (HOME_THEME_KEYS as string[]).includes(v) ? (v as HomeThemeKey) : DEFAULT_HOME_THEME;
}

/** 테마 → CSS 변수 이름/값 쌍. 순수 함수(테스트·SSR 안전). */
export function homeThemeVars(key: HomeThemeKey): Record<string, string> {
  const t = HOME_THEMES[homeThemeKeyOf(key)];
  return {
    '--mf-accent': t.accent,
    '--mf-accent-rgb': t.accentRgb,
    '--mf-accent-soft': t.accentSoft,
    '--mf-accent-strong': t.accentStrong,
    '--mf-accent-mute': t.accentMute,
    '--mf-bg': t.bg,
    '--mf-sunken': t.sunken,
    '--mf-panel2': t.panel2,
    '--mf-border': t.border,
    '--mf-border-soft': t.borderSoft,
  };
}

/** 이 기기의 마지막 선택 — 첫 페인트를 위한 캐시.
 *
 * 정본은 워크스페이스 블롭(`SpaceStore`, 기기 간 동기화)이지만 그건 네트워크를 타므로
 * 도착 전 한 프레임이 기본 코랄로 그려진다. 부팅 때 이 캐시를 먼저 입혀 그 깜빡임을
 * 없애고, 서버 값이 오면 그때 맞춘다. */
const CACHE_KEY = 'mf_home_theme';

export function loadHomeThemeCache(): HomeThemeKey {
  try {
    return homeThemeKeyOf(localStorage.getItem(CACHE_KEY));
  } catch {
    return DEFAULT_HOME_THEME;
  }
}

export function saveHomeThemeCache(key: HomeThemeKey): void {
  try {
    localStorage.setItem(CACHE_KEY, key);
  } catch {
    /* 사파리 프라이빗 등 저장 불가 — 다음 진입에서 서버 값으로 복구된다 */
  }
}

/** 문서 루트에 변수를 입힌다. 홈 밖(에디터·로그인)은 이 변수를 참조하지 않으므로
 * 루트에 둬도 영향이 없고, 홈 진입 전에(부팅 시) 미리 입혀 둘 수 있다. */
export function applyHomeTheme(key: HomeThemeKey): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const vars = homeThemeVars(key);
  for (const name in vars) root.style.setProperty(name, vars[name]!);
}

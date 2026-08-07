/**
 * 홈 색상 테마 — 사용자가 고르는 홈 화면의 색.
 *
 * 에디터는 이미 문서별 테마(`features/editor/theme.ts`의 `THEMES`)를 갖고 있고,
 * 홈은 코랄 한 벌로 고정돼 있었다. 두 화면이 같은 이름·같은 색을 쓰도록 **에디터
 * 팔레트를 그대로 재사용**한다 — 홈에서 "오션"을 고른 사람이 에디터에서 만나는
 * "오션"과 같은 파랑이다.
 *
 * 색은 CSS 변수로 내려 보낸다(`applyHomeTheme`) — 홈의 색은 대부분 인라인 스타일에
 * 박혀 있어서, 변수 한 겹을 끼우면 컴포넌트를 건드리지 않고 한 번에 갈아 끼울 수 있다.
 *
 * 변수는 두 무리다:
 * - **면·경계·강조색**: 테마마다 다르다(에디터 팔레트에서 가져온다).
 * - **글자·상태색**: 밝은 테마 다섯 벌은 같은 값을 쓰고(`LIGHT_INK`), 다크만 뒤집는다.
 *   글자색까지 변수로 뽑아 둔 덕에 다크 테마가 성립한다 — 이걸 하드코딩으로 두면
 *   배경만 어두워지고 흰 패널에 검은 글씨가 그대로 남는다.
 */

import { hexA, THEMES } from '../editor/theme';

export type HomeThemeKey = 'coral' | 'ocean' | 'forest' | 'grape' | 'mono' | 'dark';

export const HOME_THEME_KEYS: HomeThemeKey[] = ['coral', 'ocean', 'forest', 'grape', 'mono', 'dark'];

export const DEFAULT_HOME_THEME: HomeThemeKey = 'coral';

/** 홈이 쓰는 색 한 벌. */
export interface HomeTheme {
  key: HomeThemeKey;
  label: string;
  /** 어두운 테마인가 — 미리보기 칩처럼 "면이 어둡다"를 알아야 하는 UI가 쓴다. */
  dark: boolean;

  // ── 강조색 계열 ──
  /** 강조색(버튼·선택 테두리·아이콘). */
  accent: string;
  /** `rgba(var(--mf-accent-rgb),.18)` 형태로 쓰기 위한 "r,g,b" 문자열. */
  accentRgb: string;
  /** 강조색의 옅은 배경(활성 행·빈 상태 아이콘 칩). */
  accentSoft: string;
  /** 활성 행 글자·링크 hover — 밝은 테마는 더 진하게, 다크는 더 밝게. */
  accentStrong: string;
  /** 비활성 1차 버튼(누를 수 없음을 색으로). */
  accentMute: string;
  /** 강조색 **위**의 글자색. */
  accentInk: string;

  // ── 면·경계 ──
  /** 페이지 배경. */
  bg: string;
  /** 가라앉은 면(최근 항목 트레이·스켈레톤). */
  sunken: string;
  /** 카드·패널·모달의 면. */
  panel: string;
  /** 살짝 뜬 면(hover 배경·입력창). */
  panel2: string;
  /** 썸네일 위에 뜨는 반투명 패널(☆·☰ 버튼). */
  panelVeil: string;
  /** 비활성(회색) 카드의 면. */
  panelGrey: string;
  /** 전체 화면 로더의 반투명 막. */
  overlayVeil: string;
  /** 경계선. */
  border: string;
  /** 옅은 구분선. */
  borderSoft: string;
  /** 아주 옅은 구분선(모달 머리·꼬리). */
  hairline: string;
  /** 스크롤바 손잡이. */
  scroll: string;
  /** 스켈레톤의 훑고 지나가는 빛. */
  skelSheen: string;

  // ── 글자 ──
  /** 본문 글자. */
  text: string;
  /** 보조 글자(메뉴 행·설명문). */
  subtext: string;
  /** 더 옅은 글자(구획 라벨). */
  muted: string;
  /** 흐린 글자(비활성·부가 정보). */
  faint: string;
  /** 가장 흐린 글자(빈 안내). */
  faint2: string;

  // ── 상태색 ──
  danger: string;
  /** 위험 아이콘 칩의 면. */
  dangerSoft: string;
  /** 위험 행의 면(칩보다 옅다). */
  dangerBg: string;
  /** 위험 행의 경계. */
  dangerLine: string;
  /** 비활성 위험 버튼(문구 게이트를 아직 통과 못 한 회원 탈퇴). */
  dangerMute: string;
  /** 정보(공유받음처럼 "내 것이 아닌 출처"). */
  info: string;
  /** 즐겨찾기 별의 금색. */
  star: string;
  /** `.btn:hover`의 밝기 필터 — 밝은 테마는 살짝 어둡게, 다크는 살짝 밝게(어두운
   * 면에서 더 어두워지면 반응이 아니라 사라지는 것처럼 보인다). */
  hoverBright: string;
  success: string;
  successSoft: string;
  /** 성공 칩 **위**의 글자. */
  successInk: string;
}

/** 밝은 테마 다섯 벌이 공유하는 글자·상태색. 면·경계·강조색만 테마마다 다르다. */
const LIGHT_INK = {
  dark: false,
  accentInk: '#ffffff',
  panel: '#ffffff',
  panelGrey: '#fbf8f5',
  hairline: '#f2e9e1',
  scroll: '#d9c8ba',
  skelSheen: 'rgba(255,255,255,.55)',
  text: '#33281f',
  subtext: '#7c6d60',
  muted: '#9c8b7e',
  faint: '#b6a596',
  faint2: '#c9b8a9',
  danger: '#d64545',
  dangerSoft: '#fdecec',
  dangerBg: '#fdf4f2',
  dangerLine: '#f3d9d4',
  dangerMute: '#e7b9b3',
  info: '#3f8fd0',
  star: '#e0a53c',
  hoverBright: '0.97',
  success: '#2f9e63',
  successSoft: '#e9f4ee',
  successInk: '#1e7a3a',
} as const;

/**
 * 여섯 벌. `accent`/`bg`/`sunken`/`panel2`/`border`는 에디터 팔레트에서 그대로 가져오고,
 * 파생 4색은 아래 규칙으로 계산한 값을 적어 둔다(런타임 색 연산 없음 — 값이 눈에 보이는
 * 편이 검토하기 쉽다):
 *   accentSoft   = mix(accent, #fff, 12%)      // 다크는 패널에 18% 섞는다
 *   accentStrong = mix(accent, #000, 12%)      // 다크는 흰색 22% (어두운 면에서 밝아져야 한다)
 *   accentMute   = mix(accent, #fff, 45%)      // 다크는 패널 50%
 *   borderSoft   = mix(border, #fff, 20%)      // 다크는 패널 50%
 * 단 **코랄의 파생색은 오늘 쓰이던 값 그대로** 고정한다(기본 테마는 색이 한 톤도 달라지지
 * 않게 — 계산값과는 1~5 정도 차이가 난다).
 */
export const HOME_THEMES: Record<HomeThemeKey, HomeTheme> = {
  coral: {
    key: 'coral',
    label: THEMES.coral.label,
    ...LIGHT_INK,
    accent: THEMES.coral.accent, // #f0663f
    accentRgb: '240,102,63',
    accentSoft: '#fdeee7',
    accentStrong: '#d9542f',
    accentMute: '#f2c4b3',
    bg: THEMES.coral.appBg,
    sunken: THEMES.coral.canvasBg,
    panel2: THEMES.coral.panel2,
    panelVeil: hexA(LIGHT_INK.panel, 0.92),
    overlayVeil: hexA(THEMES.coral.appBg, 0.92),
    border: THEMES.coral.border,
    borderSoft: '#f0e6dd',
  },
  ocean: {
    key: 'ocean',
    label: THEMES.ocean.label,
    ...LIGHT_INK,
    accent: THEMES.ocean.accent, // #2f7fd6
    accentRgb: '47,127,214',
    accentSoft: '#e6f0fa',
    accentStrong: '#2970bc',
    accentMute: '#a1c5ed',
    bg: THEMES.ocean.appBg,
    sunken: THEMES.ocean.canvasBg,
    panel2: THEMES.ocean.panel2,
    panelVeil: hexA(LIGHT_INK.panel, 0.92),
    overlayVeil: hexA(THEMES.ocean.appBg, 0.92),
    border: THEMES.ocean.border,
    borderSoft: '#e0e9f2',
  },
  forest: {
    key: 'forest',
    label: THEMES.forest.label,
    ...LIGHT_INK,
    accent: THEMES.forest.accent, // #2f9e63
    accentRgb: '47,158,99',
    accentSoft: '#e6f3ec',
    accentStrong: '#298b57',
    accentMute: '#a1d3b9',
    bg: THEMES.forest.appBg,
    sunken: THEMES.forest.canvasBg,
    panel2: THEMES.forest.panel2,
    panelVeil: hexA(LIGHT_INK.panel, 0.92),
    overlayVeil: hexA(THEMES.forest.appBg, 0.92),
    border: THEMES.forest.border,
    borderSoft: '#ddebe2',
  },
  grape: {
    key: 'grape',
    label: THEMES.grape.label,
    ...LIGHT_INK,
    accent: THEMES.grape.accent, // #7d5bd0
    accentRgb: '125,91,208',
    accentSoft: '#efebf9',
    accentStrong: '#6e50b7',
    accentMute: '#c5b5ea',
    bg: THEMES.grape.appBg,
    sunken: THEMES.grape.canvasBg,
    panel2: THEMES.grape.panel2,
    panelVeil: hexA(LIGHT_INK.panel, 0.92),
    overlayVeil: hexA(THEMES.grape.appBg, 0.92),
    border: THEMES.grape.border,
    borderSoft: '#e6dff2',
  },
  mono: {
    key: 'mono',
    label: THEMES.mono.label,
    ...LIGHT_INK,
    accent: THEMES.mono.accent, // #2b2b2b
    accentRgb: '43,43,43',
    accentSoft: '#e6e6e6',
    accentStrong: '#262626',
    accentMute: '#a0a0a0',
    bg: THEMES.mono.appBg,
    sunken: THEMES.mono.canvasBg,
    panel2: THEMES.mono.panel2,
    panelVeil: hexA(LIGHT_INK.panel, 0.92),
    overlayVeil: hexA(THEMES.mono.appBg, 0.92),
    border: THEMES.mono.border,
    borderSoft: '#e3e3e3',
  },
  /**
   * 다크. 밝은 다섯 벌과 달리 **글자·상태색까지 뒤집는다** — 면만 어둡게 하면 흰 패널에
   * 검은 글씨가 남는다. 글자 계단(text→subtext→muted→faint→faint2)은 밝은 테마의
   * "점점 옅어진다"를 그대로 뒤집어 "점점 어두워진다"로 둔다.
   * 상태색은 어두운 면에서 죽지 않게 한 단계 밝히고, 그 위 글자(successInk)는 더 밝게.
   */
  dark: {
    key: 'dark',
    label: THEMES.dark.label,
    dark: true,
    accent: THEMES.dark.accent, // #f0663f
    accentRgb: '240,102,63',
    accentSoft: '#4a2d20',
    accentStrong: '#f38869',
    accentMute: '#8b432c',
    accentInk: THEMES.dark.accentInk, // #1b1712
    bg: THEMES.dark.appBg,
    sunken: THEMES.dark.canvasBg,
    panel: THEMES.dark.panel,
    panel2: THEMES.dark.panel2,
    panelVeil: hexA(THEMES.dark.panel, 0.92),
    panelGrey: THEMES.dark.canvasBg,
    overlayVeil: hexA(THEMES.dark.appBg, 0.92),
    border: THEMES.dark.border,
    borderSoft: '#302921',
    hairline: '#322a22',
    scroll: '#4a3f34',
    skelSheen: 'rgba(255,255,255,.06)',
    text: THEMES.dark.text, // #f3ece4
    subtext: '#c0b3a4',
    muted: THEMES.dark.subtext, // #a99e90
    faint: '#8d8275',
    faint2: '#776d61',
    danger: '#f06a6a',
    dangerSoft: '#3a2422',
    dangerBg: '#2e211f',
    dangerLine: '#4a2e2b',
    dangerMute: '#7a3b38',
    info: '#5fa8e8',
    star: '#e8bd57',
    hoverBright: '1.12',
    success: '#4cbf82',
    successSoft: '#22392c',
    successInk: '#7fd8a5',
  },
};

/** 저장된 값(워크스페이스 블롭·localStorage — 남이 쓴 값일 수 있다)을 유효한 키로. */
export function homeThemeKeyOf(v: unknown): HomeThemeKey {
  return typeof v === 'string' && (HOME_THEME_KEYS as string[]).includes(v) ? (v as HomeThemeKey) : DEFAULT_HOME_THEME;
}

/**
 * 홈이 **에디터와 함께 쓰는 모달**(공유·피드백)에 넘기는 색 7종.
 *
 * 그 모달들은 인라인 스타일로 그려지므로 홈의 CSS 변수를 스스로 읽지 못한다 —
 * 에디터가 `uiTheme`를 넘기듯 홈도 자기 테마에서 같은 모양의 값을 만들어 넘긴다.
 * `canvasBg`(모달 안 가라앉은 행)는 홈의 `sunken`인데, 그 값은 다크에서 에디터의
 * `canvasBg` 바로 그것이다(두 테마 표가 같은 팔레트에서 나온다).
 */
export function homeModalTheme(key: HomeThemeKey): {
  panel: string;
  text: string;
  subtext: string;
  border: string;
  accent: string;
  accentInk: string;
  canvasBg: string;
} {
  const t = HOME_THEMES[homeThemeKeyOf(key)];
  return { panel: t.panel, text: t.text, subtext: t.subtext, border: t.border, accent: t.accent, accentInk: t.accentInk, canvasBg: t.sunken };
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
    '--mf-accent-ink': t.accentInk,
    '--mf-bg': t.bg,
    '--mf-sunken': t.sunken,
    '--mf-panel': t.panel,
    '--mf-panel2': t.panel2,
    '--mf-panel-veil': t.panelVeil,
    '--mf-panel-grey': t.panelGrey,
    '--mf-overlay-veil': t.overlayVeil,
    '--mf-border': t.border,
    '--mf-border-soft': t.borderSoft,
    '--mf-hairline': t.hairline,
    '--mf-scroll': t.scroll,
    '--mf-skel-sheen': t.skelSheen,
    '--mf-text': t.text,
    '--mf-subtext': t.subtext,
    '--mf-muted': t.muted,
    '--mf-faint': t.faint,
    '--mf-faint2': t.faint2,
    '--mf-danger': t.danger,
    '--mf-danger-soft': t.dangerSoft,
    '--mf-danger-bg': t.dangerBg,
    '--mf-danger-line': t.dangerLine,
    '--mf-danger-mute': t.dangerMute,
    '--mf-info': t.info,
    '--mf-star': t.star,
    '--mf-hover-bright': t.hoverBright,
    '--mf-success': t.success,
    '--mf-success-soft': t.successSoft,
    '--mf-success-ink': t.successInk,
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

/** 문서 루트에 변수를 입힌다. 홈 밖(에디터·로그인·랜딩)은 이 변수를 참조하지 않으므로
 * 루트에 둬도 영향이 없고, 홈 진입 전에(부팅 시) 미리 입혀 둘 수 있다.
 *
 * 예외가 하나 있다: 로더(`LoadingOverlay`)는 홈과 로그인이 함께 쓰는데, 홈에서만
 * 테마를 따라야 하므로 홈이 막 색을 **프롭으로** 넘긴다(로그인은 기본값 유지). */
export function applyHomeTheme(key: HomeThemeKey): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const vars = homeThemeVars(key);
  for (const name in vars) root.style.setProperty(name, vars[name]!);
}

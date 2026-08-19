// Theme palette — ported verbatim from `MindFlow.dc.html`'s `this.THEMES`
// (constructor, ~MindFlow.dc.html:476-483). Six named themes; each supplies
// the CSS custom properties the original wires onto `rootStyle` plus a node
// color `palette` used by `colorOf()` (see `tree.ts`).

export interface Theme {
  label: string;
  appBg: string;
  canvasBg: string;
  panel: string;
  panel2: string;
  border: string;
  dot: string;
  text: string;
  subtext: string;
  accent: string;
  accentInk: string;
  palette: string[];
}

export type ThemeKey = 'coral' | 'ocean' | 'forest' | 'grape' | 'dark' | 'mono' | 'white';

export const THEMES: Record<ThemeKey, Theme> = {
  coral: {
    label: '코랄',
    appBg: '#fbf6f2',
    canvasBg: '#f5ece5',
    panel: '#ffffff',
    panel2: '#faf3ee',
    border: '#ecdfd5',
    dot: '#e6d8cd',
    text: '#33281f',
    subtext: '#9c8b7e',
    accent: '#f0663f',
    accentInk: '#ffffff',
    palette: ['#f0663f', '#f0913f', '#e0b23c', '#8fb257', '#3fae9e', '#3f8fd0', '#8a6bd1', '#d0568f', '#d92626'],
  },
  ocean: {
    label: '오션',
    appBg: '#f2f6fb',
    canvasBg: '#eaf1f8',
    panel: '#ffffff',
    panel2: '#eef4fa',
    border: '#d8e3ef',
    dot: '#d5e1ef',
    text: '#22303f',
    subtext: '#8496a8',
    accent: '#2f7fd6',
    accentInk: '#ffffff',
    palette: ['#2f7fd6', '#37a5c9', '#3fb59a', '#6bb85a', '#e0a53c', '#e07b4a', '#8a6bd1', '#d0568f', '#d92626'],
  },
  forest: {
    label: '포레스트',
    appBg: '#f2f8f4',
    canvasBg: '#e9f3ec',
    panel: '#ffffff',
    panel2: '#eef6f0',
    border: '#d5e6db',
    dot: '#d3e6d9',
    text: '#24352b',
    subtext: '#86a291',
    accent: '#2f9e63',
    accentInk: '#ffffff',
    palette: ['#2f9e63', '#5aab45', '#9aae3c', '#c99a3c', '#3fae9e', '#3f8fd0', '#8a6bd1', '#d0568f', '#d92626'],
  },
  grape: {
    label: '그레이프',
    appBg: '#f6f3fb',
    canvasBg: '#efe9f7',
    panel: '#ffffff',
    panel2: '#f3eefa',
    border: '#e0d7ef',
    dot: '#e0d5f0',
    text: '#2f2740',
    subtext: '#978aad',
    accent: '#7d5bd0',
    accentInk: '#ffffff',
    palette: ['#7d5bd0', '#a45bd0', '#d05fb0', '#d0568f', '#e07b4a', '#e0b23c', '#3fae9e', '#3f8fd0', '#d92626'],
  },
  dark: {
    label: '다크',
    appBg: '#191512',
    canvasBg: '#201b16',
    panel: '#262019',
    panel2: '#2e2720',
    border: '#3a3128',
    dot: '#332b23',
    text: '#f3ece4',
    subtext: '#a99e90',
    accent: '#f0663f',
    accentInk: '#1b1712',
    palette: ['#f0804f', '#f0b04f', '#e8cf5a', '#9fce6a', '#4fc9b6', '#5fa8e8', '#a98be8', '#e87bb0', '#ff4d4d'],
  },
  mono: {
    label: '모노',
    appBg: '#f4f4f4',
    canvasBg: '#ececec',
    panel: '#ffffff',
    panel2: '#f3f3f3',
    border: '#dcdcdc',
    dot: '#dedede',
    text: '#202020',
    subtext: '#8a8a8a',
    accent: '#2b2b2b',
    accentInk: '#ffffff',
    palette: ['#3a3a3a', '#565656', '#727272', '#8e8e8e', '#4a4a4a', '#616161', '#787878', '#909090', '#d92626'],
  },
  // 화이트 — 배경이 순백인 테마(요청). 화이트보드의 기본값이지만 마인드맵에서도
  // 고를 수 있다. 도형 기본 채움(panel)이 캔버스와 같은 흰색이어도 **테두리가
  // 가지 색**이라 도형은 또렷하게 보인다(Miro·Whimsical류의 흰 캔버스와 같은 결).
  // 도트는 흰 바탕에서 얼룩지지 않는 중립 회색.
  white: {
    label: '화이트',
    appBg: '#ffffff',
    canvasBg: '#ffffff',
    panel: '#ffffff',
    panel2: '#f6f7f8',
    border: '#e4e6ea',
    dot: '#e6e6e6',
    text: '#1f2328',
    subtext: '#8b9199',
    accent: '#2f7fd6',
    accentInk: '#ffffff',
    palette: ['#2f7fd6', '#e0663f', '#3fae9e', '#8a6bd1', '#8fb257', '#e0a53c', '#d0568f', '#4a5568', '#d92626'],
  },
};

export const THEME_KEYS = Object.keys(THEMES) as ThemeKey[];

/** 시스템 크롬(GNB·메뉴·독칩·속성패널 틀·줌/미니맵 프레임 등)의 고정 테마.
 * 문서 테마(`doc.themeKey`)는 편집 영역 — 캔버스 배경·노드/커넥터 색·미니맵
 * 내용·내보내기 — 에만 적용되고, 크롬은 항상 이 팔레트로 그린다. */
export const UI_THEME: Theme = THEMES.coral;

/** Port of `Component#theme()` (MindFlow.dc.html:880) — falls back to coral for unknown keys. */
export function themeOf(key: string | undefined | null): Theme {
  return (key && THEMES[key as ThemeKey]) || THEMES.coral;
}

/** The valid theme key for `key`, falling back to the default when unrecognized. */
export function themeKeyOf(key: string | undefined | null): ThemeKey {
  return key && (THEME_KEYS as string[]).includes(key) ? (key as ThemeKey) : 'coral';
}

/** 두 색을 섞는다(`t`=0이면 `a`, 1이면 `b`) — 테마마다 정확한 값을 더 적어 두는
 * 대신 **관계**로 만든다(예: 칸반 바닥 = 앱 배경을 패널 쪽으로 살짝 민 색). */
export function mixHex(a: string, b: string, t: number): string {
  const parse = (h: string): [number, number, number] => {
    const c = h.replace('#', '');
    return [parseInt(c.substring(0, 2), 16), parseInt(c.substring(2, 4), 16), parseInt(c.substring(4, 6), 16)];
  };
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  const mix = (x: number, y: number): string =>
    Math.round(x + (y - x) * t)
      .toString(16)
      .padStart(2, '0');
  return `#${mix(ar, br)}${mix(ag, bg)}${mix(ab, bb)}`;
}

/**
 * 캔버스 배경의 **방사형 그라데이션**(디자인 원본 `Geurio 마인드맵 리디자인` —
 * `radial-gradient(1200px 700px at 62% 46%, #FFFDFB, #FDF7F2 55%, #FBF2EB)`).
 *
 * 기본 캔버스 두 벌 — 코랄 맵(#f5ece5)과 화이트/화이트보드(#ffffff) — 은 원본
 * **스톱 색을 그대로** 쓴다(요청: 색상 완전 동일). 파생식(canvasBg + 흰색 믹스)
 * 으로는 채널별 비가 달라 정확히 같은 색이 나오지 않고, 순백 캔버스는 흰색에
 * 흰색을 섞는 셈이라 그라데이션이 아예 보이지 않았다(화이트보드 제보의 원인).
 *
 * 나머지 테마는 기존 파생 그대로 — 오션·포레스트에 원본의 따뜻한 색을 그대로
 * 얹으면 팔레트와 부딪히고, 어두운 캔버스(다크)는 흰색을 크게 섞으면 잿빛으로
 * 바래므로 아주 옅게만 밝힌다.
 */
export function canvasWash(canvasBg: string): string {
  const key = canvasBg.toLowerCase();
  if (key === '#f5ece5' || key === '#ffffff') {
    return 'radial-gradient(1200px 700px at 62% 46%, #fffdfb 0%, #fdf7f2 55%, #fbf2eb 100%)';
  }
  const c = canvasBg.replace('#', '');
  const lum = (parseInt(c.substring(0, 2), 16) * 0.2126 + parseInt(c.substring(2, 4), 16) * 0.7152 + parseInt(c.substring(4, 6), 16) * 0.0722) / 255;
  const [t0, t1] = lum < 0.5 ? [0.08, 0.04] : [0.8, 0.45];
  return `radial-gradient(1200px 700px at 62% 46%, ${mixHex(canvasBg, '#ffffff', t0)} 0%, ${mixHex(canvasBg, '#ffffff', t1)} 55%, ${canvasBg} 100%)`;
}

/** Port of `Component#hexA` (MindFlow.dc.html:883). */
export function hexA(hex: string, a: number): string {
  const c = hex.replace('#', '');
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

// 색 하나에 **사람이 알아듣는 이름**을 붙인다 — 스와치의 접근 이름·툴팁.
//
// 왜 필요한가: 색 고르기 칸은 글자가 없는 동그라미라, 예전엔 스크린리더가 "버튼"
// 이라고만 읽었다(보드 도구 막대는 hex를 읽어 "샵 이 비 이 비 이 비"였다). 눈으로
// 못 보는 사용자에게는 어느 칸이 무슨 색인지 알 길이 아예 없었다.
//
// **표를 두지 않고 hex에서 계산한다.** 팔레트는 테마마다 다르고(6벌 × 9색), 사용자가
// 고른 색·문서에 저장된 색도 이름이 필요하다. 손으로 지은 이름표를 두면 테마를
// 늘릴 때마다 함께 고쳐야 하는 '미러 표'가 되고, 이 프로젝트가 여러 번 데인 자리다.

/** 색조 경계(°) → 이름. 경계는 "이 값 **미만**"이다. */
const HUES: [number, string][] = [
  [10, '빨강'],
  [22, '주홍'],
  [37, '주황'],
  [50, '황금'],
  [66, '노랑'],
  [86, '연두'],
  [152, '초록'],
  [186, '청록'],
  [204, '하늘'],
  [250, '파랑'],
  // 남색은 색조 칸으로 두지 않는다 — 250~265를 남색으로 잡아 보니 `#8a6bd1`(중간
  // 보라)까지 "남색"으로 읽혔다. 진짜 남색은 어두운 파랑이라 "진한 파랑"으로 나온다.
  [290, '보라'],
  [320, '자주'],
  [346, '분홍'],
  [361, '빨강'],
];

/** hex → [색조 0..360, 채도 0..1, 밝기 0..1]. 잘못된 값은 무채색으로 본다. */
function hsl(hex: string): [number, number, number] {
  const c = /^#?([0-9a-f]{6})$/i.exec(hex.trim())?.[1];
  if (!c) return [0, 0, 0.5];
  const r = parseInt(c.slice(0, 2), 16) / 255;
  const g = parseInt(c.slice(2, 4), 16) / 255;
  const b = parseInt(c.slice(4, 6), 16) / 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  const d = mx - mn;
  if (!d) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return [h, s, l];
}

/**
 * 색 이름 한 개. 예: `#f0663f` → `주홍`, `#33281f` → `진한 갈색`, `#fff6cf` → `연한 노랑`.
 *
 * 규칙 셋: 채도가 거의 없으면 무채색(검정·회색·흰색), 주황 계열이 어두우면 **갈색**
 * (`#9a6b44`를 "진한 주황"이라 부르면 아무도 갈색인 줄 모른다), 그 밖에는 색조
 * 이름에 밝기 수식어를 붙인다.
 */
export function colorName(hex: string): string {
  const [h, s, l] = hsl(hex);
  if (s < 0.12) {
    if (l < 0.18) return '검정';
    if (l > 0.92) return '흰색';
    return l < 0.5 ? '진한 회색' : '회색';
  }
  // 주황 계열이 어두우면 갈색, 노란 계열이 밝으면 그냥 노랑 — `#ffe14d`(형광 노랑)를
  // "황금"이라 부르면 아무도 못 알아본다. 황금은 어둡고 탁한 노랑에만 쓴다.
  const bucket = HUES.find(([m]) => h < m)?.[1] ?? '빨강';
  const base = h >= 10 && h < 50 && l < 0.45 ? '갈색' : bucket === '황금' && l > 0.6 ? '노랑' : bucket;
  if (l > 0.78) return `연한 ${base}`;
  if (l < 0.35 && base !== '갈색') return `진한 ${base}`;
  if (l < 0.28) return `진한 ${base}`;
  return base;
}

/**
 * 한 묶음의 이름들 — **같은 행에서 이름이 겹치지 않게** 만든다.
 *
 * 색조를 잘게 갈라도 겹치는 곳이 남는다(모노 테마는 일곱 칸이 전부 회색이다).
 * 겹치면 밝은 것부터 번호를 붙인다 — 예쁘진 않지만 "회색"이 일곱 개인 것보다
 * 낫다: 사용자가 칸을 **구별**할 수 있어야 고를 수 있다.
 */
export function swatchNames(hexes: readonly string[]): string[] {
  const names = hexes.map(colorName);
  const count = new Map<string, number>();
  for (const n of names) count.set(n, (count.get(n) ?? 0) + 1);
  // 번호는 **행에 놓인 순서**로 붙인다 — 화살표로 훑는 순서와 같아야 "회색 3"을
  // 듣고 어디쯤인지 알 수 있다(밝기 순으로 붙였더니 첫 칸이 "진한 회색 6"이었다).
  const rank = new Map<number, number>();
  const seen = new Map<string, number>();
  names.forEach((n, i) => {
    if ((count.get(n) ?? 0) < 2) return;
    const order = (seen.get(n) ?? 0) + 1;
    seen.set(n, order);
    rank.set(i, order);
  });
  return names.map((n, i) => (rank.has(i) ? `${n} ${rank.get(i)}` : n));
}

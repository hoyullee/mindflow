/**
 * 로그인 화면의 색·글꼴 토큰 — 디자인 원본(`Geurio 로그인 리디자인.dc.html`)의
 * 값을 그대로 옮긴 것. 원본이 인라인 헥스로 쓰던 값을 한곳에 모아, 네 단계
 * (로그인·가입·비밀번호 찾기·인증)와 오른쪽 미리보기가 같은 값을 쓴다.
 *
 * 앱 테마(홈·에디터의 6벌)를 따르지 않는 이유: 로그인은 **로그인하기 전** 화면이라
 * 그 사람이 고른 테마를 알 길이 없다(테마는 계정에 딸린 값이다).
 */
export const AUTH = {
  pageBg: '#FDFAF7',
  dot: 'rgba(199,186,172,.34)',
  /** 본문 잉크(제목) */
  ink: '#2E2A26',
  /** 입력 글자·카드 본문 */
  ink2: '#3A352F',
  /** 필드 라벨 */
  label: '#4A443D',
  /** 설명문 */
  sub: '#8A8078',
  /** 보조 링크·비활성 글자 */
  faint: '#A29B90',
  /** 더 옅은 보조(카운트다운·힌트) */
  faint2: '#B7ACA1',
  /** 가장 옅은(저작권 표기) */
  faint3: '#C3B8AC',
  /** 필드·버튼 테두리 */
  border: '#E6DCD1',
  /** 구분선 */
  borderSoft: '#EFE5DB',
  /** 카드 내부 경계 */
  line: '#F3E9E0',
  /** 필드·카드 면 */
  field: '#FFFDFB',
  /** 호버 면 */
  hover: '#FBF3EE',
  accent: '#EE6B45',
  /** 링크·강조 글자 */
  accentDeep: '#C9512A',
  accentIcon: '#D0562F',
  /** 아직 누를 수 없는 제출 버튼 */
  accentMute: '#E8B7A4',
  accentSoft: '#FBEDE6',
  accentBorder: '#F0D8CA',
  /** 확인 표시(코드 전송 안내) */
  ok: '#7CA84A',
  /** eyebrow(Sign in / Verify …) */
  eyebrow: '#B09183',
  mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
} as const;

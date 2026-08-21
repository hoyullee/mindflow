/** 완료 화면의 체크 — 원과 체크가 **한 SVG**인 아이콘이다(요청).
 *
 * 예전에는 CSS로 그린 옅은 원 안에 체크 획만 얹었는데, 그러면 원과 체크가 서로
 * 다른 두 물건이라 굵기·여백이 어긋나 "아이콘"으로 읽히지 않았다. 지금은 옅은
 * 면·테두리 원·체크를 한 그림으로 그려 어느 크기에서도 비율이 유지된다.
 * 색은 홈 테마의 성공색(`--mf-success`)을 따라 다크에서도 성립한다.
 */
export function DoneCheck({ size = 40 }: { size?: number }) {
  return (
    <svg
      data-done-check
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
      style={{ flexShrink: 0, display: 'block' }}
    >
      <circle cx="20" cy="20" r="19" fill="var(--mf-success-soft)" />
      <circle cx="20" cy="20" r="14.5" stroke="var(--mf-success)" strokeWidth="1.8" />
      <path d="m13.8 20.3 4.2 4.2 8.2-8.8" stroke="var(--mf-success)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

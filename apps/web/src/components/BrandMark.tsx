/**
 * The Geurio brand glyph — a monoline spiral converging on a dot ("생각이
 * 중심으로 모인다", with an abstract nod to the G of Geurio/그리오). Glyph
 * only, no background: call sites keep their own coral/translucent boxes.
 *
 * `size`는 **감싼 박스의 크기**다 — 글리프는 그 안에서 63%를 차지하도록
 * 그려지므로(아이콘 스크립트의 `GLYPH_NATURAL_RATIO`와 같은 값), 같은 크기의
 * 코랄 박스에 넣으면 앱 아이콘·파비콘·로그인 헤더의 PNG와 **같은 그림**이다.
 * 예전에는 호출부가 이 값을 "글리프 크기"로 보고 자기 박스보다 작게 넘겼는데,
 * 그러면 63%가 한 번 더 줄어 글리프가 박스의 38%밖에 차지하지 않아 앱 아이콘과
 * 나란히 놓으면 다른 로고처럼 보였다(제보). 그래서 `size = 박스 크기`다.
 *
 * Geometry is shared VERBATIM with `apps/web/scripts/generate-icons.mjs`
 * (source of truth for the PWA/favicon/native icon pipeline) — 값이 갈리면
 * `BrandMark.test.tsx`가 잡는다(세 스크립트까지 함께 본다).
 */
export function BrandMark({ size = 26, color = '#fff' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <path
        d="M 50 22 A 28 28 0 1 0 78 50 A 20 20 0 0 0 58 32 A 13 13 0 0 0 45 45"
        fill="none"
        stroke={color}
        strokeWidth={7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="47" cy="52" r="6" fill={color} />
    </svg>
  );
}

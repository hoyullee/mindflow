interface LoadingOverlayProps {
  message: string;
  /**
   * Skip the 180ms fade-in and cover the screen from the very first painted
   * frame. Use when the action ALSO mutates what's behind the overlay (Home's
   * "새로 만들기" inserts the new card): during a fade the still-transparent
   * overlay would let that insertion flash into view.
   */
  instant?: boolean;
  /**
   * 화면을 덮는 막의 색. 기본은 밝은 크림(로그인) — 홈은 자기 색상 테마를 넘겨
   * 다크에서 밝은 막이 번쩍이지 않게 한다. 로더는 두 화면이 함께 쓰는 부품이라
   * 홈의 CSS 변수를 여기서 직접 읽지 않는다(로그인까지 따라오면 안 된다).
   */
  veil?: string;
  /** 막 위 글자색 — `veil`과 같은 이유로 프롭이다(다크 홈에서 어두운 막 위에
   * 어두운 글자가 남지 않게). */
  ink?: string;
  subInk?: string;
  /** 스피너 색(테두리 진한 쪽·연한 쪽) — 기본은 브랜드 코럴이라 로그인에서는
   * 아무것도 넘기지 않아도 된다. 홈은 지금 테마의 강조색을 넘겨 대시보드 런치의
   * 스피너와 같은 색이 된다(테마를 바꾸면 로더도 함께 바뀐다). */
  accent?: string;
  accentSoft?: string;
}

/**
 * 전체 화면 로딩 오버레이 — 로그인·가입, 홈의 새로 만들기·맵 열기·로그아웃 등.
 *
 * 표시는 **회전 스피너 하나**로 통일했다(요청). 예전에는 dc 원본의 "코어 +
 * 가지" 마인드맵 애니메이션이었는데, 같은 앱 안에서 대시보드 런치·업데이트
 * 적용은 스피너라 로딩의 모양이 화면마다 갈렸다 — 사용자가 고른 쪽이 스피너다.
 */
export function LoadingOverlay({
  message,
  instant = false,
  veil = 'rgba(251,246,242,.92)',
  ink = '#33281f',
  subInk = '#9c8b7e',
  accent = '#f0663f',
  accentSoft = 'rgba(240,102,63,.22)',
}: LoadingOverlayProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        inset: 0,
        background: veil,
        backdropFilter: 'blur(6px)',
        zIndex: 200,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        ...(instant ? null : { animation: 'mf-ov-in .18s ease-out' }),
      }}
    >
      {/* 대시보드 런치·업데이트 적용과 같은 링(34px·2.5px·0.7s) — 앱 안의 로딩
          표시가 한 모양이다. */}
      <span
        aria-hidden="true"
        data-loader-spinner
        style={{
          width: 34,
          height: 34,
          borderRadius: 999,
          border: `2.5px solid ${accentSoft}`,
          borderTopColor: accent,
          animation: 'mf-spin .7s linear infinite',
          display: 'block',
        }}
      />
      <div style={{ marginTop: 18, fontSize: 15, fontWeight: 700, color: ink }}>{message}</div>
      <div style={{ marginTop: 6, fontSize: 12.5, color: subInk }}>잠시만 기다려 주세요</div>
    </div>
  );
}

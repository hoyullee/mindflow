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
   * 어두운 글자가 남지 않게). 로고 애니메이션은 브랜드 색이라 두 화면 공통. */
  ink?: string;
  subInk?: string;
}

/**
 * Ports the `<sc-if value="{{ loaderVisible }}">` block from Login.dc.html —
 * the mindmap "core + branches" loading animation.
 */
export function LoadingOverlay({ message, instant = false, veil = 'rgba(251,246,242,.92)', ink = '#33281f', subInk = '#9c8b7e' }: LoadingOverlayProps) {
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
      <div style={{ position: 'relative', width: 150, height: 110 }}>
        <div
          style={{
            position: 'absolute',
            left: 75,
            top: 55,
            width: 38,
            height: 38,
            margin: '-19px 0 0 -19px',
            borderRadius: '50%',
            background: '#f0663f',
            boxShadow: '0 6px 18px rgba(240,102,63,.4)',
            animation: 'mf-core 1.6s ease-in-out infinite',
          }}
        />
        {[-32, 28, 148, 212].map((deg, i) => (
          <div
            key={deg}
            style={{
              position: 'absolute',
              left: 75,
              top: 55,
              width: 44,
              height: 3,
              borderRadius: 2,
              background: '#f2a488',
              transformOrigin: 'left center',
              transform: `rotate(${deg}deg)`,
              animation: 'mf-stem 1.6s ease-in-out infinite',
              animationDelay: `${i * 0.15}s`,
            }}
          />
        ))}
        {[
          { left: 110, top: 31 },
          { left: 109, top: 69 },
          { left: 26, top: 26 },
          { left: 28, top: 73 },
        ].map((pos, i) => (
          <div
            key={`${pos.left}-${pos.top}`}
            style={{
              position: 'absolute',
              left: pos.left,
              top: pos.top,
              width: 16,
              height: 16,
              borderRadius: '50%',
              background: '#fff',
              border: '3px solid #f0663f',
              boxSizing: 'border-box',
              animation: 'mf-branch 1.6s ease-in-out infinite',
              animationDelay: `${i * 0.15}s`,
            }}
          />
        ))}
      </div>
      <div style={{ marginTop: 22, fontSize: 15, fontWeight: 700, color: ink }}>{message}</div>
      <div style={{ marginTop: 6, fontSize: 12.5, color: subInk }}>잠시만 기다려 주세요</div>
    </div>
  );
}

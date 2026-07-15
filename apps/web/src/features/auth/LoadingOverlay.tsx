interface LoadingOverlayProps {
  message: string;
}

/**
 * Ports the `<sc-if value="{{ loaderVisible }}">` block from Login.dc.html —
 * the mindmap "core + branches" loading animation.
 */
export function LoadingOverlay({ message }: LoadingOverlayProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(251,246,242,.92)',
        backdropFilter: 'blur(6px)',
        zIndex: 200,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        animation: 'mf-ov-in .18s ease-out',
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
      <div style={{ marginTop: 22, fontSize: 15, fontWeight: 700, color: '#33281f' }}>{message}</div>
      <div style={{ marginTop: 6, fontSize: 12.5, color: '#9c8b7e' }}>잠시만 기다려 주세요</div>
    </div>
  );
}

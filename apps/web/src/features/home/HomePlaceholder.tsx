/**
 * Temporary landing page for the authenticated `/home` route.
 * Home.dc.html is ported to React in the next milestone.
 */
export function HomePlaceholder() {
  return (
    <main
      style={{
        minHeight: '100vh',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        fontFamily: 'Pretendard, system-ui, sans-serif',
        background: '#fbf6f2',
        color: '#33281f',
      }}
    >
      <h1 style={{ margin: 0 }}>홈 (곧 이식 예정)</h1>
      <p style={{ color: '#9c8b7e', margin: 0 }}>Home.dc.html 이식은 다음 단계에서 진행됩니다.</p>
    </main>
  );
}

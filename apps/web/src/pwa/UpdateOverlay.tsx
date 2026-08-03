/**
 * 업데이트 적용 중 전체 화면 dim 오버레이(요청) — 적용 절차(저장 flush →
 * skipWaiting → 리로드)가 도는 동안 홈/에디터 어디서든 화면 전체를 덮어
 * **다른 영역 클릭을 막고**, 중앙에 로딩 표시를 보여 준다. 절차가 짧게는 수백
 * ms, 저장이 느리면 수 초까지 걸리는데 그 사이의 클릭은 리로드로 사라질
 * 편집을 만들 수 있다.
 *
 * `UpdatePrompt`가 전 화면에 하나씩 마운트되므로 여기서 렌더하면 어느 화면이든
 * 덮인다. z-index는 앱의 어떤 모달(≤400)·토스트보다 위.
 */
export function UpdateOverlay({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div
      role="alert"
      aria-busy="true"
      aria-label="업데이트 적용 중"
      data-update-overlay
      // 오버레이가 곧 클릭 방패다 — 아래로 아무 이벤트도 통과시키지 않는다.
      onPointerDown={(e) => e.preventDefault()}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        background: 'rgba(30, 20, 14, 0.45)',
        backdropFilter: 'blur(1.5px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'wait',
      }}
    >
      <style>{'@keyframes mf-upd-spin { to { transform: rotate(360deg); } }'}</style>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 14,
          padding: '26px 34px',
          borderRadius: 16,
          background: '#ffffff',
          boxShadow: '0 18px 60px rgba(0,0,0,.25)',
          fontFamily: "Pretendard, 'Pretendard-fallback', system-ui, sans-serif",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 34,
            height: 34,
            borderRadius: '50%',
            border: '3.5px solid #f3e3d9',
            borderTopColor: '#f0663f',
            animation: 'mf-upd-spin .8s linear infinite',
          }}
        />
        <div style={{ fontSize: 14.5, fontWeight: 700, color: '#33281f' }}>새 버전을 적용하고 있어요…</div>
        <div style={{ fontSize: 12, color: '#9c8b7e', marginTop: -8 }}>잠시만 기다려 주세요. 곧 새로고침됩니다.</div>
      </div>
    </div>
  );
}

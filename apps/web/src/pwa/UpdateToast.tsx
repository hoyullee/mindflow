/**
 * "새 버전이 준비됐어요" 토스트 — 서비스워커가 새 앱 셸을 받아 대기 중일 때 뜬다.
 *
 * 이 파일은 **표현만** 담당한다(서비스워커 의존 없음) — SW 연결은 `UpdatePrompt`가
 * 하고, 여기는 순수 props라 테스트에서 그대로 렌더할 수 있다.
 *
 * 자동 새로고침을 하지 않는 이유: 에디터가 열려 있는 동안 페이지가 저절로 다시
 * 로드되면 편집 흐름이 끊긴다. 적용 시점을 사용자가 고르게 한다.
 */
interface UpdateToastProps {
  visible: boolean;
  /** 새 버전 적용(대기 중인 SW 활성화 + 리로드). */
  onRefresh: () => void;
  /** 이번 세션에서는 숨긴다(다음 방문에 다시 안내). */
  onDismiss: () => void;
}

export function UpdateToast({ visible, onRefresh, onDismiss }: UpdateToastProps) {
  if (!visible) return null;

  return (
    <div
      // polite: 편집 중 포커스를 훔치지 않고 스크린리더에 알린다.
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        // 화면 하단 중앙. 에디터의 우하단 미니맵/줌 클러스터와 좌하단 제스처
        // 범례를 피해 가운데에 두고, `dvh`가 아니라 bottom 고정으로 모바일
        // 주소창 변화에도 안전하게 붙인다.
        left: '50%',
        transform: 'translateX(-50%)',
        bottom: 'max(16px, env(safe-area-inset-bottom))',
        zIndex: 300, // LoadingOverlay(200)·모달(220)보다 위 — 어디서든 보이도록
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        maxWidth: 'calc(100vw - 24px)',
        padding: '10px 10px 10px 16px',
        background: '#33281f',
        color: '#fff',
        borderRadius: 14,
        boxShadow: '0 10px 30px rgba(0,0,0,.28)',
        fontFamily: "Pretendard, 'Pretendard-fallback', system-ui, sans-serif",
        fontSize: 13.5,
        fontWeight: 600,
        animation: 'mf-toast-in .18s ease-out',
      }}
    >
      <span style={{ whiteSpace: 'nowrap' }}>새 버전이 준비됐어요</span>
      <button
        type="button"
        onClick={onRefresh}
        style={{
          flexShrink: 0,
          height: 34,
          padding: '0 14px',
          border: 'none',
          borderRadius: 10,
          background: '#f0663f',
          color: '#fff',
          fontFamily: 'inherit',
          fontSize: 13,
          fontWeight: 700,
          cursor: 'pointer',
        }}
      >
        새로고침
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="나중에"
        title="나중에"
        style={{
          flexShrink: 0,
          width: 34,
          height: 34,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: 'none',
          borderRadius: 10,
          background: 'transparent',
          color: 'rgba(255,255,255,.72)',
          cursor: 'pointer',
        }}
      >
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12" />
          <path d="M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}

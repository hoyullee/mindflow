import { toastShellStyle } from './toastShell';

/**
 * "새 버전이 준비됐어요" 토스트 — 서비스워커가 새 앱 셸을 받아 대기 중일 때 뜬다.
 *
 * 이 파일은 **표현만** 담당한다(서비스워커 의존 없음) — SW 연결과 적용 시점 판단은
 * `UpdatePrompt`/`updateGate`가 하고, 여기는 순수 props라 테스트에서 그대로 렌더할
 * 수 있다.
 *
 * 이 토스트가 뜨는 상황 자체가 좁다: 잃을 게 없는 화면은 조용히 자동 적용되고
 * (`updateGate` 참고), 입력·편집 중이라 리로드가 실제로 방해가 되는 순간에만
 * 사용자에게 시점을 맡긴다.
 */
interface UpdateToastProps {
  visible: boolean;
  /** 새 버전 적용(대기 중인 SW 활성화 + 리로드). */
  onRefresh: () => void;
  /** 이번 세션에서는 숨긴다(다음 방문에 다시 안내). */
  onDismiss: () => void;
  /** 적용 직전 저장이 실패해 리로드를 멈춘 상태 — 그냥 넘어가면 편집분이 사라진다. */
  saveBlocked?: boolean;
  /** 적용 진행 중 — 저장(네트워크)이 끼어 있어 몇 초 걸릴 수 있다. */
  applying?: boolean;
}

export function UpdateToast({ visible, onRefresh, onDismiss, saveBlocked = false, applying = false }: UpdateToastProps) {
  if (!visible) return null;

  // 진행 중임을 반드시 보여 준다 — 눌러도 화면이 그대로면 사용자는 버튼이
  // 고장 났다고 읽고 계속 누른다(제보된 "새로고침이 안 눌린다"의 절반은 이것).
  const label = applying ? '적용 중…' : saveBlocked ? '다시 시도' : '새로고침';

  return (
    <div
      // polite: 편집 중 포커스를 훔치지 않고 스크린리더에 알린다.
      role="status"
      aria-live="polite"
      style={{
        ...toastShellStyle,
        gap: 10,
        padding: '10px 10px 10px 16px',
        fontSize: 13.5,
        fontWeight: 600,
      }}
    >
      <span style={{ whiteSpace: 'nowrap' }}>
        {saveBlocked ? '변경사항을 저장하지 못했어요' : '새 버전이 준비됐어요'}
      </span>
      <button
        type="button"
        onClick={onRefresh}
        disabled={applying}
        aria-busy={applying}
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
          cursor: applying ? 'default' : 'pointer',
          opacity: applying ? 0.72 : 1,
        }}
      >
        {label}
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

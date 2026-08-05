import { toastShellStyle } from './toastShell';
import type { InstallHintMode } from './installHint';

/**
 * "홈 화면에 추가" 안내 카드 — 표현만 담당한다(판단은 `installHint.ts`).
 *
 * 새 버전 토스트와 **같은 껍데기·같은 자리**를 쓴다(화면 하단 중앙). 둘이 동시에
 * 뜨는 일은 드물고, 그때는 새 버전 토스트(zIndex 300)가 위에 온다 — 리로드가
 * 걸린 쪽이 더 급하다.
 */
interface InstallHintProps {
  mode: InstallHintMode;
  /** 안드로이드: 브라우저 설치 프롬프트를 띄운다. */
  onInstall: () => void;
  onDismiss: () => void;
}

export function InstallHint({ mode, onInstall, onDismiss }: InstallHintProps) {
  if (!mode) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        ...toastShellStyle,
        // 가운데 정렬(`left:50%` + translate)은 폭을 정하지 않으면 **뷰포트의 절반**
        // 안에서만 줄어들어 문구가 두 줄로 접힌다(실측). 이 안내는 모바일 전용이라
        // 양옆을 고정한 바로 편다.
        left: 12,
        right: 12,
        transform: 'none',
        maxWidth: 'none',
        zIndex: 290,
        gap: 10,
        padding: '11px 12px 11px 14px',
        alignItems: 'center',
      }}
    >
      <AppIcon />
      <div style={{ flex: '1 1 auto', fontSize: 13, lineHeight: 1.45, minWidth: 0 }}>
        <div style={{ fontWeight: 700 }}>홈 화면에 추가하면 앱처럼 열려요</div>
        {mode === 'ios' && (
          <div style={{ opacity: 0.75, fontSize: 12, marginTop: 2 }}>
            아래 <ShareIcon /> 공유 → &lsquo;홈 화면에 추가&rsquo;
          </div>
        )}
      </div>
      {mode === 'prompt' && (
        <button
          type="button"
          onClick={onInstall}
          style={{
            flexShrink: 0,
            height: 34,
            padding: '0 14px',
            border: 'none',
            borderRadius: 10,
            background: '#fff',
            color: '#33281f',
            fontFamily: 'inherit',
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          추가
        </button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="안내 닫기"
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
          color: 'rgba(255,255,255,.7)',
          fontFamily: 'inherit',
          fontSize: 16,
          cursor: 'pointer',
        }}
      >
        ✕
      </button>
    </div>
  );
}

/** 앱 마크 자리 — 코럴 둥근 사각(브랜드 색)으로 "설치 대상"임을 가리킨다. */
function AppIcon() {
  return (
    <div
      aria-hidden="true"
      style={{ flexShrink: 0, width: 30, height: 30, borderRadius: 8, background: '#e2603c', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3v12" />
        <polyline points="8 11 12 15 16 11" />
        <path d="M5 19h14" />
      </svg>
    </div>
  );
}

/** iOS 공유 글리프(위로 향한 화살표 + 상자) — 사용자가 눌러야 할 그 버튼. */
function ShareIcon() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: '-1px' }}>
      <path d="M12 16V4" />
      <polyline points="8 7 12 3 16 7" />
      <path d="M6 12H5a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7a1 1 0 0 0-1-1h-1" />
    </svg>
  );
}

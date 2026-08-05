import { toastShellStyle } from '../pwa/toastShell';

/**
 * "오프라인" 알림 바(홈). 에디터는 문서 칩이 같은 사실을 저장 상태와 함께 말하므로
 * 여기(목록 화면)에만 둔다 — 목록에는 그 자리가 없다.
 *
 * 설치 안내(`InstallHint`)와 같은 자리를 쓰지만 이쪽이 위(zIndex 295)다. 실제로는
 * 겹치지 않는다: 오프라인이면 설치 안내를 띄우지 않는다(Home).
 */
interface OfflineBarProps {
  visible: boolean;
}

export function OfflineBar({ visible }: OfflineBarProps) {
  if (!visible) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        ...toastShellStyle,
        left: 12,
        right: 12,
        transform: 'none',
        maxWidth: 'none',
        zIndex: 295,
        gap: 10,
        padding: '11px 14px',
        alignItems: 'center',
        fontSize: 13,
      }}
    >
      <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
        <path d="M1 1l22 22" />
        <path d="M16.7 13.7A5 5 0 0 0 13 12.3" />
        <path d="M19.8 10.7A10 10 0 0 0 15.5 8.3" />
        <path d="M5 12.5a10 10 0 0 1 5-2.4" />
        <path d="M8.5 16a5 5 0 0 1 2-1.2" />
        <line x1="12" y1="20" x2="12.01" y2="20" />
      </svg>
      <div style={{ flex: '1 1 auto', minWidth: 0, lineHeight: 1.45 }}>
        <span style={{ fontWeight: 700 }}>오프라인이에요</span>
        <span style={{ opacity: 0.75 }}> · 연결되면 자동으로 다시 불러와요</span>
      </div>
    </div>
  );
}

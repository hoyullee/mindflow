import { useEffect } from 'react';
import { toastShellStyle } from './toastShell';

/**
 * "최신 버전으로 업데이트됐어요" — 새 버전이 **적용된 뒤** 새로 뜬 페이지에서 한 번 알린다.
 *
 * 조용히 적용됐든(랜딩·약관·홈), 토스트에서 눌러 적용됐든, 옆 탭이 적용해 이 탭이
 * 덩달아 리로드됐든 경로와 무관하게 같은 알림이 뜬다 — "리로드된 이유"를 알려 주는 게
 * 목적이라 원인이 무엇이든 사용자에게는 같은 사실이다.
 *
 * 물어보는 게 아니라 **알리는** 것이므로 버튼이 없고 스스로 사라진다. 확인을 요구하는
 * `UpdateToast`(적용 시점을 고르는 쪽)와 역할이 다르다.
 */

/** 스스로 사라지기까지. 읽기에 충분하고 방해되지 않는 정도. */
const AUTO_HIDE_MS = 4000;

interface UpdateAppliedNoticeProps {
  visible: boolean;
  /** 스스로 사라질 때 호출 — 부모가 상태를 내린다. */
  onDone: () => void;
}

export function UpdateAppliedNotice({ visible, onDone }: UpdateAppliedNoticeProps) {
  useEffect(() => {
    if (!visible) return;
    const timer = window.setTimeout(onDone, AUTO_HIDE_MS);
    return () => window.clearTimeout(timer);
  }, [visible, onDone]);

  if (!visible) return null;

  return (
    <div
      // polite: 편집 중이라도 포커스를 훔치지 않는다(알림일 뿐이다).
      role="status"
      aria-live="polite"
      style={{ ...toastShellStyle, gap: 9, padding: '10px 16px', fontSize: 13.5, fontWeight: 600 }}
    >
      <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#7fd18f" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 6 9 17l-5-5" />
      </svg>
      <span style={{ whiteSpace: 'nowrap' }}>최신 버전으로 업데이트됐어요</span>
    </div>
  );
}

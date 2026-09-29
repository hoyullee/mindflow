// 피드백 **떠 있는 단추** — 화면 오른쪽 아래(스펙: 홈·LNB 변경 7).
//
// 예전에는 LNB 맨 아래 항목이었다. 옮긴 이유: 바닥 자리는 이제 프로필 카드가 쓰고, 피드백은
// "어느 화면을 보다가도" 떠오르는 생각이라 목록 속 한 줄보다 늘 같은 자리에 떠 있는 편이
// 찾기 쉽다(에디터가 이미 화면 구석의 상시 단추로 연다 — 두 화면이 같은 문법).
//
// **모달이 떠 있으면 비켜 선다**(스펙): 설정·공유·문서 링크 같은 팝업의 막 위에 단추가
// 떠 있으면 그 팝업의 일부처럼 보이고, 눌러도 막이 가로챈다. 어느 모달이 떠 있는지는
// 모달 껍데기가 센다(`useAnyModalOpen`) — 여기서 모달 이름을 늘어놓으면 새 모달이 생길
// 때마다 빠뜨린다.

import { useAnyModalOpen } from '../../../components/Modal';

export function FeedbackFab({ onOpen, hidden = false }: { onOpen: () => void; hidden?: boolean }) {
  const modalOpen = useAnyModalOpen();
  if (modalOpen || hidden) return null;
  return (
    <button type="button" className="mf-feedback-fab" data-feedback-fab aria-label="피드백 보내기" title="피드백 보내기" onClick={onOpen}>
      {/* 말풍선(둥근 사각 + 왼쪽 아래 꼬리) 안에 글줄 둘 — 스펙의 패스 그대로. */}
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.4 3.3a.6.6 0 0 1-1-.5V17A2.5 2.5 0 0 1 4 14.5z" />
        <path d="M8.5 9h7M8.5 12.5h4.5" />
      </svg>
    </button>
  );
}

import type { CSSProperties } from 'react';

/**
 * 새 버전 관련 알림 두 개(`UpdateToast` = 적용 시점을 묻는 쪽, `UpdateAppliedNotice` =
 * 적용됐다고 알리는 쪽)가 **같은 자리에 같은 모양으로** 뜨도록 공유하는 껍데기.
 *
 * 위치 근거(원래 `UpdateToast`에 있던 것): 화면 하단 중앙 — 에디터의 우하단
 * 미니맵/줌 클러스터와 좌하단 제스처 범례를 피한다. `dvh`가 아니라 bottom 고정으로
 * 모바일 주소창 변화에도 안전하게 붙는다. zIndex는 LoadingOverlay(200)·모달(220)보다
 * 위 — 어느 화면에서든 보여야 한다.
 */
export const toastShellStyle: CSSProperties = {
  position: 'fixed',
  left: '50%',
  transform: 'translateX(-50%)',
  bottom: 'max(16px, env(safe-area-inset-bottom))',
  zIndex: 300,
  display: 'flex',
  alignItems: 'center',
  maxWidth: 'calc(100vw - 24px)',
  background: '#33281f',
  color: '#fff',
  borderRadius: 14,
  boxShadow: '0 10px 30px rgba(0,0,0,.28)',
  fontFamily: "Pretendard, 'Pretendard-fallback', system-ui, sans-serif",
  animation: 'mf-toast-in .18s ease-out',
};

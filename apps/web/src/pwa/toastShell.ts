import type { CSSProperties } from 'react';

/**
 * 화면 **하단 중앙에 떠 있는 알림**들이 같은 자리·같은 모양으로 뜨도록 공유하는 껍데기.
 * 소비처 셋: `UpdateToast`(새 버전을 적용할까) · `UpdateAppliedNotice`(적용됐다) ·
 * `ReminderToast`(일정 알림).
 *
 * 위치 근거: 화면 하단 중앙 — 에디터의 우하단 미니맵/줌 묶음을 피한다. `dvh`가 아니라
 * bottom 고정으로 모바일 주소창 변화에도 안전하게 붙는다. zIndex는 LoadingOverlay(200)·
 * 모달(220)보다 위 — 어느 화면에서든 보여야 한다.
 *
 * **하단 도구 막대와 겹치지 않게**: 에디터(맵·화이트보드)는 하단 중앙에 도구 막대를
 * 두므로, 그 막대가 떠 있는 동안 이 알림은 그만큼 위로 올라앉는다. 그 값을 이 모듈이
 * 계산하지 않는 이유는 막대가 있는지·얼마나 높은지는 **에디터만 알기** 때문이다 —
 * 막대가 `documentElement`에 이 변수를 내려 주고(`BOTTOM_BAR_VAR`) 여기서는 더한다.
 * 토스트는 body에 붙는 fixed 요소라 에디터 루트의 상속을 받을 수 없어서 그 자리가
 * `documentElement`다(`--mf-titlebar`와 같은 방식).
 */
export const BOTTOM_BAR_VAR = '--mf-bottom-bar';

export const toastShellStyle: CSSProperties = {
  position: 'fixed',
  left: '50%',
  transform: 'translateX(-50%)',
  bottom: `calc(max(16px, env(safe-area-inset-bottom)) + var(${BOTTOM_BAR_VAR}, 0px))`,
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

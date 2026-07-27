import { useRegisterSW } from 'virtual:pwa-register/react';
import { UpdateToast } from './UpdateToast';

/**
 * 서비스워커 업데이트를 감시해 {@link UpdateToast}를 띄우는 얇은 연결층.
 *
 * 배경: 앱 셸(JS/CSS/HTML)이 SW에 프리캐시되므로, 새로 배포해도 이미 방문한
 * 브라우저는 **옛 번들**을 계속 실행한다. `registerType: 'prompt'`(vite.config)로
 * 새 SW를 대기 상태로 두고, 여기서 사용자에게 적용 시점을 물어본다 —
 * 에디터가 열린 채 페이지가 저절로 리로드되면 편집이 끊기므로 자동 적용은 하지 않는다.
 *
 * 이 파일만 `virtual:pwa-register/react`(vite-plugin-pwa가 만들어 주는 가상 모듈)에
 * 의존한다. 그래서 화면 로직은 `UpdateToast`에 두어 테스트에서 가상 모듈 없이
 * 그대로 렌더할 수 있게 분리했다.
 */

/** 열어 둔 탭에서도 배포를 놓치지 않도록 주기적으로 새 버전을 확인(1시간). */
const UPDATE_CHECK_MS = 60 * 60 * 1000;

export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      // 장시간 열어 둔 편집 세션(브라우저가 스스로 확인하지 않을 수 있음) 대비.
      setInterval(() => {
        void registration.update();
      }, UPDATE_CHECK_MS);
    },
  });

  return (
    <UpdateToast
      visible={needRefresh}
      // true = 대기 중인 SW에 skipWaiting을 보내고 페이지를 다시 로드한다.
      onRefresh={() => void updateServiceWorker(true)}
      onDismiss={() => setNeedRefresh(false)}
    />
  );
}

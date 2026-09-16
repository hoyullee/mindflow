import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';
import { initNativeShell } from './platform/nativeShell';
import { applyHomeTheme, loadHomeThemeCache } from './features/home/theme';
import { captureDesktopAuthToken } from './features/auth/desktopGoogle';

// 빌드 스탬프(`__BUILD_AT__`/`__BUILD_SHA__`, vite.config.ts의 `define`)는 여기서
// **찍지 않는다**(요청: 콘솔에서 제거). "어느 빌드가 떠 있는가"는 여전히 필요한
// 물음이지만 — PWA가 업데이트를 미루는 동안 이전 번들로 테스트하는 일이 실제로
// 있었다(협업 버그 제보 중 절반이 그랬다) — 이제 답이 제품 안에 두 곳 있다:
// **설정 › 버전 확인** 화면(빌드 시각 + 커밋 7자)과 피드백의 `meta.build`/`meta.sha`.
// 즉 진단 수단이 사라진 것이 아니라 콘솔에서 화면으로 옮겨 갔다. 그래서 매 로드마다
// 한 줄을 찍을 이유가 없어졌다 — 콘솔은 **문제가 있을 때만** 말한다(남아 있는
// `console.warn`들이 그 몫이다).

// 홈 색상 테마 — 이 기기의 마지막 선택을 **렌더 전에** 입힌다. 정본은 워크스페이스
// 블롭이지만 그건 네트워크를 타므로, 캐시를 먼저 입혀야 홈이 기본 코랄로 한 프레임
// 그려졌다 바뀌는 깜빡임이 없다(도착하면 그 값으로 맞춘다 — features/home/theme.ts).
applyHomeTheme(loadHomeThemeCache());

// 설치형 앱의 Google 로그인 핸드오프(`/auth/desktop#…refresh_token=…`) — 앱에 넘길
// 갱신 토큰을 읽고 **주소창·방문 기록에서 토큰을 치운다**.
//
// ⚠️ 한때 이 호출이 "클라이언트보다 먼저 돌아서" 브라우저에 세션이 서지 않는다고
// 적혀 있었는데 **그 순서는 성립하지 않는다**: ESM은 위의 `import`들을 이 본문보다
// 먼저 평가하고, 그 안에서 `BackendContext`가 이미 클라이언트를 만든다. 계정이
// 뒤섞인 제보의 원인이 그것이었다. 세션을 막는 것은 이제 순서가 아니라 성질이다 —
// 심부름꾼 경로에서는 클라이언트가 URL을 아예 보지 않는다(`isAuthCourierPath`).
// 그래서 이 호출은 언제 돌아도 되고, 늦어도 계정을 뒤섞지 않는다.
captureDesktopAuthToken();

const el = document.getElementById('root');
if (!el) throw new Error('#root not found');

createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// M7: no-op on the web (isNativePlatform() is false outside the Capacitor
// shell) — sets StatusBar color/style + Keyboard resize mode when running as
// the wrapped native app. Fire-and-forget; never blocks first paint.
void initNativeShell();

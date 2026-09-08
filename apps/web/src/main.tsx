import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';
import { initNativeShell } from './platform/nativeShell';
import { applyHomeTheme, loadHomeThemeCache } from './features/home/theme';
import { captureDesktopAuthCode } from './features/auth/desktopGoogle';

// 어느 빌드가 떠 있는지 — PWA가 업데이트를 미루는 동안 이전 번들로 테스트하는 일이
// 실제로 있었다(협업 버그 제보 중 절반이 그랬다). vite.config.ts의 `define` 참고.
declare const __BUILD_AT__: string;
declare const __BUILD_SHA__: string;
const buildAt = typeof __BUILD_AT__ === 'string' ? __BUILD_AT__ : 'dev';
const buildSha = typeof __BUILD_SHA__ === 'string' && __BUILD_SHA__ ? __BUILD_SHA__ : 'dev';
console.info(`[geurio] build ${buildAt} (${buildSha})`);

// 홈 색상 테마 — 이 기기의 마지막 선택을 **렌더 전에** 입힌다. 정본은 워크스페이스
// 블롭이지만 그건 네트워크를 타므로, 캐시를 먼저 입혀야 홈이 기본 코랄로 한 프레임
// 그려졌다 바뀌는 깜빡임이 없다(도착하면 그 값으로 맞춘다 — features/home/theme.ts).
applyHomeTheme(loadHomeThemeCache());

// 설치형 앱의 Google 로그인 핸드오프(`/auth/desktop?code=…`) — 그 인가 코드는
// **앱의** PKCE verifier로만 교환되므로 브라우저 클라이언트가 손대면(그것도
// 실패하면서 주소에서 지운다) 앱에 넘길 것이 없어진다. Supabase 클라이언트가
// 만들어지기 전인 **여기서** 낚아채 주소에서 치운다 — 그 경로가 아니면 아무 일도
// 하지 않으므로 평범한 웹 로그인은 그대로다(features/auth/desktopGoogle.ts).
captureDesktopAuthCode();

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

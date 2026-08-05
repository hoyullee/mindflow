import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';
import { initNativeShell } from './platform/nativeShell';
import { applyHomeTheme, loadHomeThemeCache } from './features/home/theme';

// 어느 빌드가 떠 있는지 — PWA가 업데이트를 미루는 동안 이전 번들로 테스트하는 일이
// 실제로 있었다(협업 버그 제보 중 절반이 그랬다). vite.config.ts의 `define` 참고.
declare const __BUILD_AT__: string;
console.info(`[geurio] build ${typeof __BUILD_AT__ === 'string' ? __BUILD_AT__ : 'dev'}`);

// 홈 색상 테마 — 이 기기의 마지막 선택을 **렌더 전에** 입힌다. 정본은 워크스페이스
// 블롭이지만 그건 네트워크를 타므로, 캐시를 먼저 입혀야 홈이 기본 코랄로 한 프레임
// 그려졌다 바뀌는 깜빡임이 없다(도착하면 그 값으로 맞춘다 — features/home/theme.ts).
applyHomeTheme(loadHomeThemeCache());

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

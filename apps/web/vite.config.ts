import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { pwaManifest } from './src/pwa/manifest';

/**
 * 루트(`/`)를 JS 없이 렌더되는 정적 랜딩으로 서빙하기 위한 빌드 스왑.
 *
 * Google 브랜드 인증 크롤러는 JS를 실행하지 않아 SPA 셸을 "빈 페이지"로
 * 판정한다. Vercel `rewrites`로 `/`를 landing.html로 보내는 첫 시도는
 * 실패했는데, rewrites는 파일시스템 매칭 **다음**이라 `/`가 항상 실존하는
 * index.html(SPA 셸)에 먼저 잡히기 때문. 그래서 산출물 자체를 바꾼다:
 *
 *   dist/index.html  = public/landing.html (정적 랜딩 — 크롤러·최초 방문)
 *   dist/app.html    = SPA 셸 (vercel.json의 캐치올 리라이트 대상)
 *
 * writeBundle 시점에 실행되어 VitePWA의 closeBundle(SW 생성)보다 먼저
 * 끝난다 — 프리캐시 매니페스트가 스왑된 내용/리비전을 정확히 담고,
 * `navigateFallback: '/app.html'`이 오프라인 앱 셸을 유지한다.
 */
function landingRootSwap(): Plugin {
  let outDir = 'dist';
  return {
    name: 'geurio:landing-root-swap',
    // `apply: 'build'`를 쓰면 안 된다 — preview는 command='serve'로 설정을
    // 해석해서 플러그인이 통째로 빠지고, 아래 configurePreviewServer
    // 미들웨어가 사라진다. writeBundle은 어차피 빌드에서만 불린다.
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    writeBundle() {
      const spaShell = path.join(outDir, 'index.html');
      copyFileSync(spaShell, path.join(outDir, 'app.html'));
      // 소스(public/)에서 직접 읽는다 — vite의 publicDir 복사 순서와 무관.
      writeFileSync(spaShell, readFileSync(path.resolve(__dirname, 'public/landing.html'), 'utf8'));
    },
    // `vite preview`는 vercel.json을 모르므로 같은 라우팅을 여기서 재현한다:
    // 확장자 없는 경로(SPA 라우트)는 app.html로, `/`와 실존 파일은 그대로.
    // 이게 없으면 preview의 SPA 폴백이 index.html(=랜딩)을 서빙해 /login이
    // 랜딩으로 떠버린다 — 실브라우저 검증이 프로덕션과 어긋나게 된다.
    configurePreviewServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = (req.url ?? '').split('?')[0] ?? '';
        if (url !== '/' && url !== '/index.html' && !path.extname(url)) req.url = '/app.html';
        next();
      });
    },
  };
}

// M6: PWA (installable + offline app shell). Manifest fields per CLAUDE.md's
// M6 spec; icons/font are self-hosted under public/ (see
// scripts/generate-icons.mjs and src/index.css) so the app installs and works
// offline without any external network request (CDN-blocked environments
// included).
export default defineConfig({
  plugins: [
    react(),
    landingRootSwap(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'favicon-32x32.png', 'favicon-16x16.png', 'icons/apple-touch-icon.png'],
      manifest: pwaManifest,
      workbox: {
        // App shell (JS/CSS/HTML/icons/font) is precached; localStorage (the
        // local-mode data layer) is what makes the app *functional* offline —
        // Workbox only needs to get the shell itself to load without a network.
        //
        // M4's Supabase mode (`src/adapters/supabase/*`) calls a different
        // origin (the configured Supabase project URL) for auth/doc-store —
        // Workbox's `navigateFallback` only ever intercepts same-origin
        // *navigation* (full-page-load) requests, and no `runtimeCaching`
        // route is registered here, so those cross-origin XHR/fetch calls are
        // never touched by the service worker (not cached, not stale — just
        // not intercepted at all). Nothing extra to configure for that case.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,ico}'],
        // SPA 셸이 app.html로 옮겨졌다(landingRootSwap 참고) — 기본값
        // index.html은 이제 정적 랜딩이라 오프라인 내비게이션 폴백으로
        // 쓰면 앱 대신 마케팅 페이지가 떠버린다.
        navigateFallback: '/app.html',
      },
      devOptions: {
        // Lets `pnpm dev` exercise the SW/manifest without a production build.
        enabled: true,
        type: 'module',
      },
    }),
  ],
  test: {
    environment: 'jsdom',
  },
});

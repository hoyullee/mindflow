import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { pwaManifest } from './src/pwa/manifest';

// M6: PWA (installable + offline app shell). Manifest fields per CLAUDE.md's
// M6 spec; icons/font are self-hosted under public/ (see
// scripts/generate-icons.mjs and src/index.css) so the app installs and works
// offline without any external network request (CDN-blocked environments
// included).
export default defineConfig({
  plugins: [
    react(),
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

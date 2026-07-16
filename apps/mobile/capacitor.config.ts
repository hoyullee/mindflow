import type { CapacitorConfig } from '@capacitor/cli';

// M7: this package is the Capacitor *shell* only — it has no application code
// of its own. `webDir` points at `apps/web`'s Vite build output (a sibling
// package in the pnpm workspace), so the native (Android/iOS) projects
// generated here embed the same static bundle that ships as the PWA. This is
// "bundled" mode (not the Capacitor "server URL" live-reload mode): the
// WebView loads local files copied into the native project via `cap sync`.
//
// Build order matters: `apps/web` must be built (`pnpm --filter @mindflow/web
// build`) *before* `cap sync`/`cap copy` runs here, otherwise `webDir` is
// stale or missing. See the root `build:mobile` script and README.md.
const config: CapacitorConfig = {
  appId: 'com.mindflow.app',
  appName: 'MindFlow',
  webDir: '../web/dist',
  // Static bundle wrapping, not a remote/dev server URL.
  server: {
    androidScheme: 'https',
  },
  plugins: {
    // Matches <meta name="theme-color" content="#f0663f"> in apps/web/index.html.
    // Also (re-)applied at runtime from apps/web/src/platform/nativeShell.ts so
    // it stays correct even if this config drifts from what's actually synced.
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#f0663f',
      overlaysWebView: false,
    },
    Keyboard: {
      resize: 'body',
    },
    // launchAutoHide: false — the splash stays up until the web app explicitly
    // calls SplashScreen.hide() (apps/web/src/platform/nativeShell.ts), so it
    // covers app-shell boot instead of racing a fixed timer.
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: '#ffffff',
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
    },
  },
};

export default config;

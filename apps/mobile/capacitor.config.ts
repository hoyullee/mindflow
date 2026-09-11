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
  appName: 'Geurio',
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
    // 일정 알림(3단계) — OS가 예약을 들고 있어 앱이 닫혀 있어도 뜬다.
    //
    // `smallIcon`은 **반드시 흰 글리프 + 투명 배경**이어야 한다: 안드로이드는 이
    // 아이콘의 색을 버리고 알파만 남겨 자기 색으로 칠하므로, 지정하지 않아 런처
    // 아이콘(코랄 사각형)이 쓰이면 상태 표시줄에 흰 네모만 뜬다. 전용 자산은
    // `scripts/generate-native-assets.mjs`가 만든다(`ic_stat_geurio`).
    // iOS는 앱 아이콘을 쓰므로 이 값과 무관하다.
    LocalNotifications: {
      smallIcon: 'ic_stat_geurio',
      iconColor: '#f0663f',
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

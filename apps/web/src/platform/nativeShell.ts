// M7: native chrome for the Capacitor app shell — status bar color/style and
// keyboard resize behavior. Called once from `main.tsx` at startup.
// `isNativePlatform()` is false for every browser/PWA/test build, so the
// dynamic imports below never execute outside the native shell (nothing to
// regress on the web).
import { isNativePlatform } from './nativeBridge';

// Matches <meta name="theme-color" content="#f0663f"> (index.html) and the
// `StatusBar` entry in apps/mobile/capacitor.config.ts — kept in sync here so
// it's still correct even if the config drifts from what's actually synced
// into the native project, or on platforms/versions that don't read the
// config file's plugin defaults.
const THEME_COLOR = '#f0663f';

export async function initNativeShell(): Promise<void> {
  if (!isNativePlatform()) return;

  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setBackgroundColor({ color: THEME_COLOR });
    // Dark background -> light (white) status bar icons/text.
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setOverlaysWebView({ overlay: false });
  } catch (err) {
    // Best-effort chrome only — never block app startup on it.
    console.error('[mindflow] StatusBar init failed', err);
  }

  try {
    const { Keyboard, KeyboardResize } = await import('@capacitor/keyboard');
    // Resize the web view's body (not the whole window) when the keyboard
    // opens, so the fixed topbar/toolbars in Editor/Home don't get pushed
    // off-screen while a node's text is being edited.
    await Keyboard.setResizeMode({ mode: KeyboardResize.Body });
  } catch (err) {
    console.error('[mindflow] Keyboard init failed', err);
  }
}

// M7 (Capacitor app-store shell, see apps/mobile/): platform-gated native
// helpers for the parts of the web app that benefit from a real native API
// when running inside the wrapped Android/iOS shell — file export via native
// Share/Filesystem instead of an anchor-tag download, plus (in
// `nativeShell.ts`) StatusBar/Keyboard chrome.
//
// This module is imported unconditionally by the web app (so the same build
// runs standalone in a browser *and* inside the Capacitor WebView), but every
// native SDK call is:
//   1. gated behind `isNativePlatform()` (false in every ordinary browser,
//      including jsdom in tests — `Capacitor.getPlatform()` returns `'web'`
//      there), and
//   2. behind a dynamic `import()`, so the plugin JS is only ever fetched
//      (and its native bridge only ever touched) when actually running
//      inside the native shell. In a plain browser/PWA/test build this file
//      only ever executes the `@capacitor/core` import (a tiny, DOM-free
//      "web implementation" package with no native dependency) — nothing
//      else here changes web behavior.
import { Capacitor } from '@capacitor/core';

/** True only when running inside the Capacitor-wrapped native app (Android/iOS), never in a browser/PWA. */
export function isNativePlatform(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    // Defensive: never let platform detection itself break the web app.
    return false;
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const CHUNK = 0x8000; // avoid call-stack blowups from String.fromCharCode(...hugeArray) on large PNGs
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Writes `data` to the app's native cache directory and opens the native
 * Share sheet (AirDrop/Files/Drive/... on iOS, the Android share sheet) so
 * the user can save or send the exported file — there is no anchor-tag
 * download inside a native WebView. Only called when `isNativePlatform()`
 * is true; throws on failure so the caller can fall back to the web path.
 */
export async function shareFileNative(name: string, data: string | Blob, mime?: string): Promise<void> {
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([
    import('@capacitor/filesystem'),
    import('@capacitor/share'),
  ]);
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'text/plain;charset=utf-8' });
  const base64 = await blobToBase64(blob);
  const { uri } = await Filesystem.writeFile({
    path: name,
    data: base64,
    directory: Directory.Cache,
  });
  await Share.share({ title: name, url: uri });
}

/**
 * Shared entry point for every export path (JSON/Markdown/PNG in the editor,
 * JSON in the home doc list): try the native Share/Filesystem flow when
 * running in the app shell, otherwise (or if the native flow throws) run
 * `webFallback` — the pre-existing anchor-tag `URL.createObjectURL` download.
 * Fire-and-forget by design (matches the pre-existing `downloadFile(): void`
 * call sites) — errors are logged, never thrown, and always resolve to the
 * web fallback so export never silently does nothing.
 */
export function downloadOrShare(name: string, data: string | Blob, mime: string | undefined, webFallback: () => void): void {
  if (!isNativePlatform()) {
    webFallback();
    return;
  }
  shareFileNative(name, data, mime).catch((err: unknown) => {
    console.error('[mindflow] native share failed, falling back to browser download', err);
    webFallback();
  });
}

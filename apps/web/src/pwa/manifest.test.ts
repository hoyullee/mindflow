import { describe, expect, it } from 'vitest';
import { pwaManifest } from './manifest';

// M6: locks down the Web App Manifest fields the mobile-strategy spec calls
// for (name/short_name/description, brand colors, standalone display, ko
// lang, any orientation) plus the icon set (192/512 + maskable). A build-time
// check (`pnpm build` -> `dist/manifest.webmanifest`) confirms Workbox/
// vite-plugin-pwa actually emit this; this test is the fast, offline
// "did someone accidentally drop a required field" guard.
describe('pwaManifest', () => {
  it('has the required identity fields', () => {
    expect(pwaManifest.name).toBe('Geurio');
    expect(pwaManifest.short_name).toBe('Geurio');
    expect(pwaManifest.description).toBeTruthy();
    expect(pwaManifest.lang).toBe('ko');
  });

  it('matches the app brand colors', () => {
    expect(pwaManifest.theme_color).toBe('#f0663f');
    expect(pwaManifest.background_color).toBe('#fbf6f2');
  });

  it('is installable as a standalone app in any orientation', () => {
    expect(pwaManifest.display).toBe('standalone');
    expect(pwaManifest.orientation).toBe('any');
    expect(pwaManifest.start_url).toBe('/');
    expect(pwaManifest.scope).toBe('/');
  });

  it('declares 192/512 icons plus a maskable variant', () => {
    const icons = pwaManifest.icons ?? [];
    expect(icons.some((i) => i.sizes === '192x192' && !i.purpose)).toBe(true);
    expect(icons.some((i) => i.sizes === '512x512' && !i.purpose)).toBe(true);
    expect(icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable')).toBe(true);
    icons.forEach((icon) => {
      expect(icon.src.startsWith('/')).toBe(true);
      expect(icon.type).toBe('image/png');
    });
  });
});

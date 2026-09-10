import { readFileSync } from 'node:fs';
import path from 'node:path';
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
    // '/home', not '/': the root is the public marketing landing — an
    // installed app must launch straight into the user's documents.
    expect(pwaManifest.start_url).toBe('/home');
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

  /**
   * 앱의 id — 없으면 브라우저가 `start_url`을 쓰므로 값은 지금과 같지만, 명시해
   * 두면 앞으로 `start_url`을 바꿔도 같은 앱으로 남는다(바뀌면 중복 설치가 생긴다).
   */
  it('앱 id를 명시한다', () => {
    expect(pwaManifest.id).toBe('/home');
  });
});

/**
 * 루트(`/`)는 빌드 후 `public/landing.html`로 통째로 덮어써진다
 * (vite.config `landingRootSwap`) — vite-plugin-pwa가 SPA 셸에 주입한 매니페스트
 * 링크가 거기엔 오지 않는다. 그런데 대부분의 사용자가 처음 닿는 페이지가 바로 거기라,
 * 링크가 없으면 브라우저가 그 페이지를 "설치할 수 없는 사이트"로 본다(제보 조사 중
 * 발견 — 실제로 빠져 있었다).
 */
describe('정적 랜딩(루트)도 설치 가능해야 한다', () => {
  const html = readFileSync(path.resolve(__dirname, '../../public/landing.html'), 'utf8');

  it('매니페스트를 건다', () => {
    expect(html).toContain('rel="manifest"');
    expect(html).toContain('/manifest.webmanifest');
  });

  it('테마 색과 애플 터치 아이콘도 함께 (설치 화면·iOS 홈 화면 표시)', () => {
    expect(html).toContain('name="theme-color"');
    expect(html).toContain('rel="apple-touch-icon"');
  });
});

/**
 * 폰트는 **프리로드하지 않는다.** 콘솔 경고("preloaded ... but not used within a
 * few seconds")가 제보로 왔고, 지우기로 결정한 근거는 측정이었다: 이 파일은 2MB이고
 * 프리로드는 `load` 이벤트를 막아 스로틀 A/B에서 load가 대략 **두 배**가 됐다
 * (10Mbps 3295→1741ms · 3Mbps 10376→4988ms · 1.5Mbps 20418→9707ms).
 *
 * 정렬이 틀어지는 것은 프리로드가 아니라 `Pretendard-fallback`(ascent/descent
 * 오버라이드)이 막는다 — 그 face의 존재 이유가 그것이다. 그래서 이 테스트는 두
 * 가지를 함께 못박는다: 프리로드가 없다는 것과, **그 폴백이 여전히 있다는 것**
 * (폴백을 지우면 프리로드 없이는 진짜로 글자가 튄다).
 */
describe('폰트 로딩 계약', () => {
  const shell = readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
  const css = readFileSync(path.resolve(__dirname, '../index.css'), 'utf8');

  it('앱 셸에 폰트 프리로드가 없다', () => {
    expect(shell).not.toMatch(/rel="preload"/);
    expect(shell).not.toContain('PretendardVariable.woff2');
  });

  it('대신 metric-matched 폴백과 swap이 교체 순간을 지킨다', () => {
    expect(css).toContain("font-family: 'Pretendard-fallback'");
    expect(css).toMatch(/ascent-override:\s*95\.21%/);
    expect(css).toMatch(/descent-override:\s*24\.12%/);
    expect(css).toMatch(/font-display:\s*swap/);
  });
});

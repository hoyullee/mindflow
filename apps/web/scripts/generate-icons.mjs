// M6 (PWA): generates every app icon from a single vector definition so there's
// no external asset (image editor, downloaded PNG, etc.) to keep in sync. Run
// with `node scripts/generate-icons.mjs` whenever the mark changes; outputs are
// committed under `public/` (see CLAUDE.md — self-hosted, no CDN at runtime).
//
// The mark mirrors the in-app logo (Login/Editor topbar, legal pages — see
// apps/web/src/components/BrandMark.tsx): a coral rounded square (`#f0663f`)
// with a white monoline spiral converging on a dot — "생각이 중심으로 모인다"
// (and an abstract nod to the "G" of Geurio/그리오). Drawn from geometric SVG
// primitives (three arcs + a dot, no text glyph) so the render is 100%
// deterministic — it doesn't depend on which system fonts happen to be
// installed on the machine running this script (dev laptop vs CI).
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '..', 'public');

const CORAL = '#f0663f';

/**
 * The spiral glyph, in a fixed 0..100 coordinate space: three shrinking arcs
 * winding counter-clockwise from the top into the centre, ending on a filled
 * dot. Natural extent (incl. the stroke) is ~63 units, so `contentRatio`
 * scales relative to that. Shared verbatim with the in-app
 * `BrandMark` component and the mobile native-assets script — keep in sync.
 */
const GLYPH_PATH = 'M 50 22 A 28 28 0 1 0 78 50 A 20 20 0 0 0 58 32 A 13 13 0 0 0 45 45';
const GLYPH_DOT = { cx: 47, cy: 52, r: 6 };
const GLYPH_STROKE = 7;
const GLYPH_NATURAL_RATIO = 0.63;

/**
 * @param {number} size full square output size
 * @param {object} opts
 * @param {number} [opts.cornerRadiusRatio] rounded-square corner radius as a fraction of `size` (0 = full-bleed square, for maskable/apple icons where the OS applies its own mask)
 * @param {number} [opts.contentRatio] the spiral glyph's bounding box as a fraction of `size` (smaller = more safe-zone padding, for maskable icons)
 */
function markSvg(size, { cornerRadiusRatio = 0.22, contentRatio = 0.63 } = {}) {
  const r = 100 * cornerRadiusRatio;
  const k = (contentRatio / GLYPH_NATURAL_RATIO).toFixed(4);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  <rect x="0" y="0" width="100" height="100" rx="${r}" ry="${r}" fill="${CORAL}"/>
  <g transform="translate(50 50) scale(${k}) translate(-50 -50)">
    <path d="${GLYPH_PATH}" fill="none" stroke="#ffffff" stroke-width="${GLYPH_STROKE}" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${GLYPH_DOT.cx}" cy="${GLYPH_DOT.cy}" r="${GLYPH_DOT.r}" fill="#ffffff"/>
  </g>
</svg>`;
}

async function writePng(svg, size, filePath) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(filePath);
  console.log('wrote', path.relative(process.cwd(), filePath));
}

async function main() {
  await mkdir(path.join(outDir, 'icons'), { recursive: true });

  // Standard (non-maskable) app icons — rounded square, matches the in-app mark.
  const icon192 = markSvg(192);
  const icon512 = markSvg(512);
  await writePng(icon192, 192, path.join(outDir, 'icons', 'pwa-192x192.png'));
  await writePng(icon512, 512, path.join(outDir, 'icons', 'pwa-512x512.png'));

  // Maskable icon: full-bleed background (the OS applies its own corner/circle
  // mask, so `cornerRadiusRatio: 0` avoids "double rounding") with the spiral
  // shrunk to fit Android's ~80%-diameter safe zone.
  const maskable512 = markSvg(512, { cornerRadiusRatio: 0, contentRatio: 0.42 });
  await writePng(maskable512, 512, path.join(outDir, 'icons', 'maskable-512x512.png'));

  // Apple touch icon: iOS applies its own rounded-rect mask, so this is also
  // full-bleed (no corner radius baked in) at the recommended 180x180.
  const apple180 = markSvg(180, { cornerRadiusRatio: 0, contentRatio: 0.5 });
  await writePng(apple180, 180, path.join(outDir, 'icons', 'apple-touch-icon.png'));

  // Google OAuth 브랜드 인증용 앱 로고: the consent-screen "App logo" upload
  // requires exactly 120×120. Served from /brand/ so it's downloadable from
  // the deployed site when filling in the console form.
  await mkdir(path.join(outDir, 'brand'), { recursive: true });
  await writePng(markSvg(120), 120, path.join(outDir, 'brand', 'geurio-logo-120.png'));

  // OG(Open Graph) 공유 카드 1200×630 — 링크를 카톡/슬랙/트위터에 붙였을 때
  // 뜨는 미리보기. 폰트 글리프를 쓰지 않는 이 스크립트의 원칙대로 텍스트 없이
  // 브랜드 마크 + BrandPanel풍 장식 노드로만 구성한다(제목/설명 텍스트는
  // og:title/og:description 메타가 담당).
  const OG_W = 1200;
  const OG_H = 630;
  const k = (0.63 / GLYPH_NATURAL_RATIO).toFixed(4); // 자연 크기 그대로
  const ogSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_W}" height="${OG_H}" viewBox="0 0 ${OG_W} ${OG_H}">
  <rect width="${OG_W}" height="${OG_H}" fill="${CORAL}"/>
  <g fill="none" stroke="#ffffff" stroke-width="4" opacity="0.16">
    <rect x="120" y="120" width="150" height="74" rx="22"/>
    <rect x="90" y="430" width="150" height="74" rx="22"/>
    <rect x="960" y="150" width="150" height="74" rx="22"/>
    <rect x="930" y="440" width="150" height="74" rx="22"/>
  </g>
  <g opacity="0.16" stroke="#ffffff" stroke-width="4" fill="none">
    <path d="M 460 315 C 340 315 320 190 270 160"/>
    <path d="M 460 315 C 340 315 300 440 240 465"/>
    <path d="M 740 315 C 860 315 900 220 960 190"/>
    <path d="M 740 315 C 860 315 890 450 930 475"/>
  </g>
  <g transform="translate(430 145) scale(3.4)">
    <g transform="translate(50 50) scale(${k}) translate(-50 -50)">
      <path d="${GLYPH_PATH}" fill="none" stroke="#ffffff" stroke-width="${GLYPH_STROKE}" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${GLYPH_DOT.cx}" cy="${GLYPH_DOT.cy}" r="${GLYPH_DOT.r}" fill="#ffffff"/>
    </g>
  </g>
</svg>`;
  await mkdir(path.join(outDir, 'og'), { recursive: true });
  await sharp(Buffer.from(ogSvg)).resize(OG_W, OG_H).png().toFile(path.join(outDir, 'og', 'og-image.png'));
  console.log('wrote', path.relative(process.cwd(), path.join(outDir, 'og', 'og-image.png')));

  // Favicon: a small PNG (works everywhere, unlike .ico, without extra deps)
  // plus a scalable SVG for browsers that support `<link rel="icon" ... svg>`.
  const favSvg = markSvg(64);
  await writeFile(path.join(outDir, 'favicon.svg'), favSvg);
  await writePng(favSvg, 32, path.join(outDir, 'favicon-32x32.png'));
  await writePng(favSvg, 16, path.join(outDir, 'favicon-16x16.png'));

  console.log('Icons generated.');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

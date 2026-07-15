// M6 (PWA): generates every app icon from a single vector definition so there's
// no external asset (image editor, downloaded PNG, etc.) to keep in sync. Run
// with `node scripts/generate-icons.mjs` whenever the mark changes; outputs are
// committed under `public/` (see CLAUDE.md — self-hosted, no CDN at runtime).
//
// The mark mirrors the in-app logo (Login/Home/Editor topbar): a coral rounded
// square (`#f0663f`) with a bold white "M". The "M" is drawn as a stroked
// polyline (not a text glyph) so the render is 100% deterministic — it doesn't
// depend on which system fonts happen to be installed on the machine running
// this script (dev laptop vs CI).
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '..', 'public');

const CORAL = '#f0663f';

/**
 * @param {number} size full square viewBox size
 * @param {object} opts
 * @param {number} [opts.cornerRadiusRatio] rounded-square corner radius as a fraction of `size` (0 = full-bleed square, for maskable/apple icons where the OS applies its own mask)
 * @param {number} [opts.contentRatio] the "M" glyph's bounding box as a fraction of `size` (smaller = more safe-zone padding, for maskable icons)
 */
function markSvg(size, { cornerRadiusRatio = 0.22, contentRatio = 0.56 } = {}) {
  const r = size * cornerRadiusRatio;
  const s = size * contentRatio; // "M" bounding box side
  const cx = size / 2;
  const cy = size / 2;
  const stroke = s * 0.22;
  const halfS = s / 2;
  // Valley point sits a bit below vertical-center (a slightly "open" M, matching
  // the in-app wordmark's visual weight) rather than a symmetric V.
  const valleyY = cy - halfS + s * 0.62;
  const points = [
    [cx - halfS, cy + halfS], // bottom-left
    [cx - halfS, cy - halfS], // top-left
    [cx, valleyY], // middle valley
    [cx + halfS, cy - halfS], // top-right
    [cx + halfS, cy + halfS], // bottom-right
  ]
    .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)
    .join(' ');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect x="0" y="0" width="${size}" height="${size}" rx="${r}" ry="${r}" fill="${CORAL}"/>
  <polyline points="${points}" fill="none" stroke="#ffffff" stroke-width="${stroke.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>
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
  // mask, so `cornerRadiusRatio: 0` avoids "double rounding") with the "M"
  // shrunk to fit Android's ~80%-diameter safe zone.
  const maskable512 = markSvg(512, { cornerRadiusRatio: 0, contentRatio: 0.42 });
  await writePng(maskable512, 512, path.join(outDir, 'icons', 'maskable-512x512.png'));

  // Apple touch icon: iOS applies its own rounded-rect mask, so this is also
  // full-bleed (no corner radius baked in) at the recommended 180x180.
  const apple180 = markSvg(180, { cornerRadiusRatio: 0, contentRatio: 0.5 });
  await writePng(apple180, 180, path.join(outDir, 'icons', 'apple-touch-icon.png'));

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

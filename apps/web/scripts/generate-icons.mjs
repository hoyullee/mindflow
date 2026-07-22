// M6 (PWA): generates every app icon from a single vector definition so there's
// no external asset (image editor, downloaded PNG, etc.) to keep in sync. Run
// with `node scripts/generate-icons.mjs` whenever the mark changes; outputs are
// committed under `public/` (see CLAUDE.md — self-hosted, no CDN at runtime).
//
// The mark mirrors the in-app logo (Login/Home/Editor topbar): a coral rounded
// square (`#f0663f`) with a bold white "G" (Geurio). The "G" is drawn from
// geometric SVG primitives (an arc + a straight bar, no text glyph) so the
// render is 100% deterministic — it doesn't depend on which system fonts happen
// to be installed on the machine running this script (dev laptop vs CI).
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
 * @param {number} [opts.contentRatio] the "G" glyph's bounding box as a fraction of `size` (smaller = more safe-zone padding, for maskable icons)
 */
function markSvg(size, { cornerRadiusRatio = 0.22, contentRatio = 0.58 } = {}) {
  const r = size * cornerRadiusRatio;
  const s = size * contentRatio; // "G" bounding box side
  const cx = size / 2;
  const cy = size / 2;
  const R = s / 2; // glyph radius
  const stroke = s * 0.2;
  // A monoline "G": a near-full ring left open on the right, plus a horizontal
  // bar cutting in from the lower opening to the centre (the crossbar that makes
  // a "G" read as a G and not a "C"). Angles measured with y pointing down, 0° =
  // +x (right); the opening is the ±40° wedge straddling the +x axis.
  const at = (deg) => {
    const a = deg * (Math.PI / 180);
    return [cx + R * Math.cos(a), cy + R * Math.sin(a)];
  };
  const [ux, uy] = at(-40); // upper opening (top-right)
  const [lx, ly] = at(40); // lower opening (bottom-right)
  const barY = ly; // crossbar sits at the lower opening's height
  const barX = cx - R * 0.02; // reaches just past centre
  // Ring: from the upper opening, sweep the LONG way (large-arc, counter-
  // clockwise) around through top/left/bottom to the lower opening; then the
  // crossbar runs left to the centre.
  const d = `M ${ux.toFixed(2)} ${uy.toFixed(2)} A ${R.toFixed(2)} ${R.toFixed(2)} 0 1 0 ${lx.toFixed(2)} ${ly.toFixed(2)} L ${barX.toFixed(2)} ${barY.toFixed(2)}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect x="0" y="0" width="${size}" height="${size}" rx="${r}" ry="${r}" fill="${CORAL}"/>
  <path d="${d}" fill="none" stroke="#ffffff" stroke-width="${stroke.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>
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

  // Google OAuth 브랜드 인증용 앱 로고: the consent-screen "App logo" upload
  // requires exactly 120×120. Served from /brand/ so it's downloadable from
  // the deployed site when filling in the console form.
  await mkdir(path.join(outDir, 'brand'), { recursive: true });
  await writePng(markSvg(120), 120, path.join(outDir, 'brand', 'geurio-logo-120.png'));

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

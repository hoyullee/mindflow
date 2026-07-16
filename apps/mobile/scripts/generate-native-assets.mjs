// M7-icons: generates the MindFlow-branded native launcher icons + splash
// screens for the Capacitor Android/iOS projects, replacing the default
// Capacitor placeholder assets that `cap add android`/`cap add ios` scaffold.
//
// Like `apps/web/scripts/generate-icons.mjs`, everything here is drawn as a
// pure, deterministic SVG (no external image asset, no network fetch) and
// rasterized with `sharp` — running this script twice produces byte-identical
// output, so it's safe to commit and re-run whenever the mark changes.
//
// `markSvg()` below is a **duplicate** of the mark defined in
// apps/web/scripts/generate-icons.mjs (source of truth: that file — keep the
// two in sync if the in-app logo ever changes) with one addition: a
// `transparentBg` option, needed for Android's adaptive-icon *foreground*
// layer, which must be just the white "M" on a transparent background (the
// coral fill is a separate `<background>` color layer, see
// `ic_launcher_background.xml`).
//
// Run with `node apps/mobile/scripts/generate-native-assets.mjs` (or
// `pnpm --filter @mindflow/mobile run generate:native-assets`) whenever the
// mark changes; outputs are committed (android/ and ios/ are already
// committed native projects, see apps/mobile/README.md).
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.join(__dirname, '..');
const androidRes = path.join(mobileRoot, 'android', 'app', 'src', 'main', 'res');
const iosAssets = path.join(mobileRoot, 'ios', 'App', 'App', 'Assets.xcassets');

const CORAL = '#f0663f';
const SPLASH_BG = '#ffffff';

/**
 * Duplicate of apps/web/scripts/generate-icons.mjs's `markSvg` — source of
 * truth: apps/web/scripts/generate-icons.mjs. Draws the MindFlow mark (a
 * coral rounded square with a bold white "M" polyline) as pure SVG.
 *
 * @param {number} size full square viewBox size
 * @param {object} opts
 * @param {number} [opts.cornerRadiusRatio] rounded-square corner radius as a fraction of `size` (0 = full-bleed square, for OS-masked icons: Android round/legacy full-bleed variants, iOS AppIcon)
 * @param {number} [opts.contentRatio] the "M" glyph's bounding box as a fraction of `size` (smaller = more safe-zone padding, e.g. Android adaptive-icon foreground)
 * @param {boolean} [opts.transparentBg] omit the coral background rect entirely (just the white "M" polyline) — used for the Android adaptive-icon foreground layer, whose coral fill instead comes from `@color/ic_launcher_background`
 */
function markSvg(size, { cornerRadiusRatio = 0.22, contentRatio = 0.56, transparentBg = false } = {}) {
  const r = size * cornerRadiusRatio;
  const s = size * contentRatio; // "M" bounding box side
  const cx = size / 2;
  const cy = size / 2;
  const stroke = s * 0.22;
  const halfS = s / 2;
  const valleyY = cy - halfS + s * 0.62;
  const points = [
    [cx - halfS, cy + halfS],
    [cx - halfS, cy - halfS],
    [cx, valleyY],
    [cx + halfS, cy - halfS],
    [cx + halfS, cy + halfS],
  ]
    .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)
    .join(' ');

  const bgRect = transparentBg
    ? ''
    : `<rect x="0" y="0" width="${size}" height="${size}" rx="${r}" ry="${r}" fill="${CORAL}"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${bgRect}
  <polyline points="${points}" fill="none" stroke="#ffffff" stroke-width="${stroke.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}

async function markPngBuffer(size, opts) {
  return sharp(Buffer.from(markSvg(size, opts))).resize(size, size).png().toBuffer();
}

async function writePng(buffer, filePath) {
  await sharp(buffer).png().toFile(filePath);
  console.log('wrote', path.relative(mobileRoot, filePath));
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`bad hex color: ${hex}`);
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16), alpha: 1 };
}

/** White (or `bg`) canvas of `width`x`height` with the rounded-square mark centered, sized to ~`markRatio` of the shorter side. */
async function splashBuffer(width, height, { bg = SPLASH_BG, markRatio = 0.32 } = {}) {
  const markSize = Math.round(Math.min(width, height) * markRatio);
  const mark = await markPngBuffer(markSize);
  const left = Math.round((width - markSize) / 2);
  const top = Math.round((height - markSize) / 2);
  return sharp({
    create: { width, height, channels: 4, background: hexToRgb(bg) },
  })
    .composite([{ input: mark, left, top }])
    .png()
    .toBuffer();
}

// ── Android ──────────────────────────────────────────────────────────────

const ANDROID_DENSITIES = [
  { dir: 'mipmap-mdpi', legacy: 48, foreground: 108 },
  { dir: 'mipmap-hdpi', legacy: 72, foreground: 162 },
  { dir: 'mipmap-xhdpi', legacy: 96, foreground: 216 },
  { dir: 'mipmap-xxhdpi', legacy: 144, foreground: 324 },
  { dir: 'mipmap-xxxhdpi', legacy: 192, foreground: 432 },
];

async function generateAndroidLauncherColor() {
  const filePath = path.join(androidRes, 'values', 'ic_launcher_background.xml');
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">${CORAL}</color>
</resources>
`;
  await writeFile(filePath, xml, 'utf8');
  console.log('wrote', path.relative(mobileRoot, filePath));
}

async function generateAndroidIcons() {
  await generateAndroidLauncherColor();

  for (const { dir, legacy, foreground } of ANDROID_DENSITIES) {
    const densityDir = path.join(androidRes, dir);

    // Legacy (pre-API26) launcher icon: full mark (coral rounded square + white M).
    const legacyIcon = await markPngBuffer(legacy);
    await writePng(legacyIcon, path.join(densityDir, 'ic_launcher.png'));

    // Legacy round variant: the OS masks this to a circle, so it must be
    // full-bleed (no corner radius baked in, or the corners would show as
    // background behind the circular mask on some launchers).
    const roundIcon = await markPngBuffer(legacy, { cornerRadiusRatio: 0, contentRatio: 0.5 });
    await writePng(roundIcon, path.join(densityDir, 'ic_launcher_round.png'));

    // Adaptive-icon foreground: white "M" only, transparent background (the
    // coral fill comes from the sibling <background> color layer), shrunk to
    // fit the ~66dp/108dp safe zone so it isn't clipped by the OS mask shape.
    const fgIcon = await markPngBuffer(foreground, { contentRatio: 0.4, transparentBg: true });
    await writePng(fgIcon, path.join(densityDir, 'ic_launcher_foreground.png'));
  }
}

async function generateAndroidSplash() {
  const splashDirs = [
    'drawable',
    'drawable-land-hdpi',
    'drawable-land-mdpi',
    'drawable-land-xhdpi',
    'drawable-land-xxhdpi',
    'drawable-land-xxxhdpi',
    'drawable-port-hdpi',
    'drawable-port-mdpi',
    'drawable-port-xhdpi',
    'drawable-port-xxhdpi',
    'drawable-port-xxxhdpi',
  ];

  for (const dir of splashDirs) {
    const filePath = path.join(androidRes, dir, 'splash.png');
    // Preserve whatever dimensions are already there (per-density/orientation
    // targets Capacitor scaffolded) rather than hardcoding a size table.
    const { width, height } = await sharp(await readFile(filePath)).metadata();
    if (!width || !height) throw new Error(`could not read dimensions of ${filePath}`);
    const buffer = await splashBuffer(width, height);
    await writePng(buffer, filePath);
  }
}

// ── iOS ──────────────────────────────────────────────────────────────────

async function generateIosIcon() {
  // iOS applies its own rounded-rect mask, so this is full-bleed (no corner
  // radius baked in), matching the web app's Apple touch icon convention.
  const buffer = await markPngBuffer(1024, { cornerRadiusRatio: 0, contentRatio: 0.5 });
  const filePath = path.join(iosAssets, 'AppIcon.appiconset', 'AppIcon-512@2x.png');
  await writePng(buffer, filePath);
}

async function generateIosSplash() {
  const size = 2732;
  const buffer = await splashBuffer(size, size);
  const files = ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png'];
  for (const name of files) {
    await writePng(buffer, path.join(iosAssets, 'Splash.imageset', name));
  }
}

async function main() {
  await generateAndroidIcons();
  await generateAndroidSplash();
  await generateIosIcon();
  await generateIosSplash();
  console.log('Native icons/splash generated.');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

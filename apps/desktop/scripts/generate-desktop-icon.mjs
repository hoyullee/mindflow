// 설치 파일의 앱 아이콘. PWA·모바일과 **같은 벡터 정의**에서 만든다 — 외부
// 이미지 파일을 들고 다니지 않으므로 마크가 바뀌면 세 스크립트를 함께 돌리면
// 되고, 시스템 폰트에 의존하지 않아 어느 기계에서 돌려도 같은 그림이 나온다.
//
//   node scripts/generate-desktop-icon.mjs
//
// 산출물 둘:
//   build/icon.png        1024 — electron-builder가 이 한 장에서 Windows `.ico`와
//                         macOS `.icns`를 스스로 만든다(512 이상이면 된다)
//   build/appx/*.png      MSIX(Microsoft Store) 타일 4종. **없으면 electron-builder가
//                         자기 샘플 아트를 대신 넣는다** — 남의 로고가 설치본에
//                         실리는 셈이라 반드시 만든다.
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '..', 'build');

const CORAL = '#f0663f';
// apps/web/scripts/generate-icons.mjs · apps/mobile/scripts/generate-native-assets.mjs
// 와 같은 지오메트리 — 중심으로 감기는 세 호 + 점(모노라인 소용돌이).
const GLYPH_PATH = 'M 50 22 A 28 28 0 1 0 78 50 A 20 20 0 0 0 58 32 A 13 13 0 0 0 45 45';
const GLYPH_DOT = { cx: 47, cy: 52, r: 6 };
const GLYPH_STROKE = 7;

/** 소용돌이 글리프만 — 배경 없이, 100×100 좌표계 안에서. */
function glyph() {
  return `<path d="${GLYPH_PATH}" fill="none" stroke="#ffffff" stroke-width="${GLYPH_STROKE}" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="${GLYPH_DOT.cx}" cy="${GLYPH_DOT.cy}" r="${GLYPH_DOT.r}" fill="#ffffff"/>`;
}

function markSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  <rect x="0" y="0" width="100" height="100" rx="22" ry="22" fill="${CORAL}"/>
  ${glyph()}
</svg>`;
}

/**
 * MSIX 타일 — 정사각도, 넓은 타일도 **글리프를 늘리지 않고 가운데** 둔다
 * (Wide310x150을 정사각 아이콘에서 리사이즈하면 마크가 찌그러진다).
 * 타일은 Windows가 자기 모서리 처리를 하므로 라운드를 굽지 않는다(full-bleed).
 */
function tileSvg(w, h) {
  const side = Math.min(w, h) * 0.62; // 안전 여백을 남긴 글리프 크기
  const k = side / 100;
  const x = (w - side) / 2;
  const y = (h - side) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect x="0" y="0" width="${w}" height="${h}" fill="${CORAL}"/>
  <g transform="translate(${x} ${y}) scale(${k})">
    ${glyph()}
  </g>
</svg>`;
}

async function writePng(svg, w, h, file) {
  await sharp(Buffer.from(svg)).resize(w, h).png().toFile(file);
  console.log('wrote', path.relative(process.cwd(), file));
}

await mkdir(outDir, { recursive: true });
await writePng(markSvg(1024), 1024, 1024, path.join(outDir, 'icon.png'));

// MSIX 타일. 이름은 electron-builder가 찾는 그대로여야 한다(AppxTarget의
// `vendorAssetsForDefaultAssets`) — 하나라도 이름이 틀리면 그 자리에 샘플 아트가 들어간다.
const appxDir = path.join(outDir, 'appx');
await mkdir(appxDir, { recursive: true });
for (const [name, w, h] of [
  ['StoreLogo.png', 50, 50],
  ['Square44x44Logo.png', 44, 44],
  ['Square150x150Logo.png', 150, 150],
  ['Wide310x150Logo.png', 310, 150],
]) {
  await writePng(tileSvg(w, h), w, h, path.join(appxDir, name));
}

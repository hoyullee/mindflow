// 설치 파일의 앱 아이콘. PWA·모바일과 **같은 벡터 정의**에서 만든다 — 외부
// 이미지 파일을 들고 다니지 않으므로 마크가 바뀌면 세 스크립트를 함께 돌리면
// 되고, 시스템 폰트에 의존하지 않아 어느 기계에서 돌려도 같은 그림이 나온다.
//
//   node scripts/generate-desktop-icon.mjs
//
// 산출물은 `build/icon.png`(1024) 하나다 — electron-builder가 이 한 장에서
// Windows `.ico`와 macOS `.icns`를 스스로 만든다(512 이상이면 된다).
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

function markSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  <rect x="0" y="0" width="100" height="100" rx="22" ry="22" fill="${CORAL}"/>
  <path d="${GLYPH_PATH}" fill="none" stroke="#ffffff" stroke-width="${GLYPH_STROKE}" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="${GLYPH_DOT.cx}" cy="${GLYPH_DOT.cy}" r="${GLYPH_DOT.r}" fill="#ffffff"/>
</svg>`;
}

await mkdir(outDir, { recursive: true });
const file = path.join(outDir, 'icon.png');
await sharp(Buffer.from(markSvg(1024))).resize(1024, 1024).png().toFile(file);
console.log('wrote', path.relative(process.cwd(), file));

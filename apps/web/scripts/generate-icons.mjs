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

  // OG(Open Graph) 공유 카드 1200×630 — 링크를 카톡/슬랙/트위터에 붙였을 때 뜨는
  // 미리보기.
  //
  // v2: 제품이 마인드맵 하나에서 **셋**(마인드맵·화이트보드·칸반)으로 늘었는데
  // 예전 카드는 가지 뻗은 마인드맵만 보여 줬다. 랜딩 v2가 "정리하는 방법은 하나가
  // 아니에요"라고 말하는 것과 어긋나서, 세 보기를 나란히 놓은 구성으로 바꾼다.
  //
  // **글자를 쓰지 않는 원칙은 그대로다** — 이 스크립트는 폰트 글리프에 기대지 않아야
  // 어느 기계에서 돌려도 같은 그림이 나온다(개발 노트북 vs CI). 그래서 세 종류를
  // 알아보게 하는 일은 **실루엣**이 맡는다: 가지 뻗은 트리 / 스티커·잉크 / 열과 카드.
  // 제목·설명 문구는 og:title·og:description 메타가 담당한다.
  //
  // 각 카드의 강조색은 앱이 이미 쓰는 **문서 종류색**(홈 카드 배지의 점 —
  // `--mf-doc-map`/`-board`/`-kanban`)이라, 공유 카드에서 본 색이 앱 안에서 같은
  // 뜻으로 다시 나타난다.
  const OG_W = 1200;
  const OG_H = 630;
  const k = (0.63 / GLYPH_NATURAL_RATIO).toFixed(4); // 자연 크기 그대로
  const CARD = '#fffdfb';
  const INK = '#33281f';
  const KIND = { map: '#d9482b', board: '#3f9e6a', kanban: '#8a63d2' };
  /** 카드 한 장(그림자 + 흰 면 + 종류색 머리띠) — 안쪽 그림은 `body`가 채운다. */
  const ogCard = (x, y, w, h, accent, body) => `
    <g>
      <rect x="${x + 4}" y="${y + 10}" width="${w}" height="${h}" rx="26" fill="#b83f1e" opacity="0.30"/>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="26" fill="${CARD}"/>
      <rect x="${x + 24}" y="${y + 22}" width="58" height="8" rx="4" fill="${accent}"/>
      ${body}
    </g>`;

  // 세 그림은 모두 **내용 상자**(가로 272 · 세로 200) 안에 그린다 — 카드 안쪽 여백
  // 24, 머리띠 아래에서 시작. 카드 밖으로 삐져나오면 모서리에서 잘린다.
  const BOX_W = 272;

  // ① 마인드맵 — 중심 노드에서 가지가 뻗는다.
  const mapBody = `
    <g fill="none" stroke="${INK}" stroke-opacity="0.28" stroke-width="3">
      <path d="M 84 100 C 56 100 52 56 30 48"/>
      <path d="M 84 100 C 56 100 52 100 30 100"/>
      <path d="M 84 100 C 56 100 52 148 30 156"/>
      <path d="M 188 100 C 216 100 220 66 242 58"/>
      <path d="M 188 100 C 216 100 220 138 242 146"/>
    </g>
    <g>
      <rect x="84" y="80" width="104" height="42" rx="14" fill="${KIND.map}"/>
      <rect x="100" y="95" width="72" height="12" rx="6" fill="#ffffff" opacity="0.9"/>
      <g fill="#ffffff" stroke="${INK}" stroke-opacity="0.26" stroke-width="2.5">
        <rect x="0" y="32" width="64" height="32" rx="11"/>
        <rect x="0" y="84" width="64" height="32" rx="11"/>
        <rect x="0" y="140" width="64" height="32" rx="11"/>
        <rect x="${BOX_W - 64}" y="42" width="64" height="32" rx="11"/>
        <rect x="${BOX_W - 64}" y="130" width="64" height="32" rx="11"/>
      </g>
    </g>`;

  // ② 화이트보드 — 자유롭게 붙인 스티커와 손으로 그은 잉크.
  const boardBody = `
    <g stroke="${INK}" stroke-opacity="0.2" stroke-width="2.5">
      <rect x="4" y="8" width="118" height="72" rx="10" fill="#fff2b8"/>
      <rect x="146" y="44" width="112" height="66" rx="10" fill="#ffe0d3"/>
      <rect x="36" y="106" width="124" height="60" rx="10" fill="#d8efe1"/>
    </g>
    <g fill="${INK}" opacity="0.26">
      <rect x="20" y="26" width="76" height="9" rx="4.5"/>
      <rect x="20" y="45" width="54" height="9" rx="4.5"/>
      <rect x="162" y="62" width="70" height="9" rx="4.5"/>
      <rect x="52" y="124" width="84" height="9" rx="4.5"/>
    </g>
    <path d="M 158 158 C 190 138 208 178 246 152" fill="none" stroke="${KIND.board}" stroke-width="7" stroke-linecap="round"/>`;

  // ③ 칸반 — 단계로 나뉜 열과 그 안에 쌓인 카드.
  const kanbanCol = (cx, dot, cards) => `
    <g>
      <rect x="${cx}" y="8" width="82" height="176" rx="12" fill="#f7f2ec"/>
      <circle cx="${cx + 16}" cy="28" r="5" fill="${dot}"/>
      <rect x="${cx + 28}" y="23" width="34" height="9" rx="4.5" fill="${INK}" opacity="0.26"/>
      ${cards.map((cy, i) => `<rect x="${cx + 10}" y="${cy}" width="62" height="${i === 0 ? 34 : 28}" rx="8" fill="#ffffff" stroke="${INK}" stroke-opacity="0.16" stroke-width="2"/>`).join('')}
    </g>`;
  const kanbanBody = `
    ${kanbanCol(0, KIND.kanban, [46, 90, 128])}
    ${kanbanCol(95, '#e0a53c', [46, 90])}
    ${kanbanCol(190, KIND.board, [46])}`;

  const CARD_W = 320;
  const CARD_H = 292;
  const CARD_Y = 268;
  const CARD_X = [92, 440, 788];
  /** 내용 상자의 원점 — 카드 왼쪽에서 24, 머리띠(y+22..30) 아래로 34. */
  const bodyAt = (x, body) => `<g transform="translate(${x + 24} ${CARD_Y + 64})">${body}</g>`;
  const ogSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_W}" height="${OG_H}" viewBox="0 0 ${OG_W} ${OG_H}">
  <defs>
    <radialGradient id="ogGlow" cx="0.5" cy="0.12" r="0.85">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.16"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${OG_W}" height="${OG_H}" fill="${CORAL}"/>
  <rect width="${OG_W}" height="${OG_H}" fill="url(#ogGlow)"/>
  <g transform="translate(515 52) scale(1.7)">
    <g transform="translate(50 50) scale(${k}) translate(-50 -50)">
      <path d="${GLYPH_PATH}" fill="none" stroke="#ffffff" stroke-width="${GLYPH_STROKE}" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${GLYPH_DOT.cx}" cy="${GLYPH_DOT.cy}" r="${GLYPH_DOT.r}" fill="#ffffff"/>
    </g>
  </g>
  ${ogCard(CARD_X[0], CARD_Y, CARD_W, CARD_H, KIND.map, bodyAt(CARD_X[0], mapBody))}
  ${ogCard(CARD_X[1], CARD_Y, CARD_W, CARD_H, KIND.board, bodyAt(CARD_X[1], boardBody))}
  ${ogCard(CARD_X[2], CARD_Y, CARD_W, CARD_H, KIND.kanban, bodyAt(CARD_X[2], kanbanBody))}
</svg>`;
  // 파일 이름에 판(v2)을 담는다 — 슬랙·카카오·트위터는 스크랩한 카드를 **URL로**
  // 캐시하므로, 같은 경로에 그림만 바꾸면 한동안 옛 카드가 계속 뜬다. 경로가
  // 바뀌면 다음 스크랩부터 곧바로 새 카드다(이미 올라간 글은 그쪽이 저장해 둔
  // 사본을 계속 쓴다 — 그건 어느 쪽이든 같다).
  const OG_FILE = 'og-card-v2.png';
  await mkdir(path.join(outDir, 'og'), { recursive: true });
  await sharp(Buffer.from(ogSvg)).resize(OG_W, OG_H).png().toFile(path.join(outDir, 'og', OG_FILE));
  console.log('wrote', path.relative(process.cwd(), path.join(outDir, 'og', OG_FILE)));

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

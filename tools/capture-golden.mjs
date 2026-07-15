// Regenerate golden fixtures from the original dc prototype.
//
// These fixtures are behavior baselines for the mindmap-core (M1) extraction
// — see packages/mindmap-core/test/fixtures/README.md.
//
// Requirements:
//   - Playwright installed (npm i -D playwright) and a Chromium available.
//   - Set PW_CHROMIUM to a Chromium executable if not using Playwright's own,
//     e.g. PW_CHROMIUM=/opt/pw-browsers/chromium-*/chrome-linux/chrome
//   - Run from the repo root:  node tools/capture-golden.mjs
//
// It serves the repo root over HTTP, drives MindFlow.dc.html headlessly, and
// writes packages/mindmap-core/test/fixtures/{input,golden}/*.
//
// NOTE: layout-*.json coordinates depend on text measurement (font). See the
// R1 caveat in the fixtures README before asserting exact pixel parity.

import { chromium } from 'playwright';
import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(REPO, 'packages/mindmap-core/test/fixtures');
const PORT = 8132;
const T = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };

const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const d = await readFile(path.join(REPO, p));
    res.setHeader('Content-Type', T[path.extname(p)] || 'application/octet-stream');
    res.end(d);
  } catch { res.statusCode = 404; res.end('404'); }
});
await new Promise((r) => server.listen(PORT, r));
await mkdir(path.join(OUT, 'golden'), { recursive: true });
await mkdir(path.join(OUT, 'input'), { recursive: true });

const N = (id, text, emoji, parent, children, extra = {}) =>
  ({ id, text, emoji, parent, children, collapsed: false, color: null, x: 0, y: 0, ...extra });
const DOC = {
  v: 1,
  nodes: {
    root: N('root', '제품 로드맵', '🎯', null, ['c1', 'c2', 'c3']),
    c1: N('c1', '리서치', '', 'root', ['g1', 'g2'], { color: '#3f8fd0' }),
    c2: N('c2', '디자인', '', 'root', ['g3']),
    c3: N('c3', '개발', '', 'root', []),
    g1: N('g1', '사용자 인터뷰', '🗣️', 'c1', []),
    g2: N('g2', '경쟁 분석', '', 'c1', []),
    g3: N('g3', '와이어프레임', '', 'c2', [], { bold: true }),
    free1: N('free1', '메모용 도형', '', null, [], { free: true, rich: null, x: 260, y: -160 }),
  },
  floats: [{ id: 'flt1', x: -260, y: 160, w: 200, text: '주간 회고 메모' }],
  lines: [{ id: 'ln1', x1: -120, y1: 40, x2: 120, y2: 40, startArrow: false, endArrow: true, dashed: true, c1: 0, c2: 0, label: '흐름' }],
  zones: [{ id: 'zn1', x: -320, y: -220, w: 300, h: 180, label: '1분기', color: null }],
  layoutMode: 'radial',
  themeKey: 'coral',
};
await writeFile(path.join(OUT, 'input', 'doc-mixed.json'), JSON.stringify(DOC, null, 2));

const launchOpts = {
  headless: true,
  args: ['--ignore-certificate-errors', '--no-sandbox'],
  ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } } : {}),
  ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
};
const b = await chromium.launch(launchOpts);
const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1400, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();

await page.goto(`http://localhost:${PORT}/MindFlow.dc.html?map=golden&new=1`, { waitUntil: 'load' });
await page.waitForTimeout(2000);
await page.evaluate((doc) => localStorage.setItem('mindflow_doc_golden', JSON.stringify(doc)), DOC);
await page.goto(`http://localhost:${PORT}/MindFlow.dc.html?map=golden`, { waitUntil: 'load' });
await page.waitForTimeout(2500);

const readDoc = () => page.evaluate(() => { const r = localStorage.getItem('mindflow_doc_golden'); return r ? JSON.parse(r) : null; });

await page.keyboard.press('Control+s'); await page.waitForTimeout(600);
await writeFile(path.join(OUT, 'golden', 'serialize-roundtrip.json'), JSON.stringify(await readDoc(), null, 2));

for (const [key, label] of [['radial', '방사형'], ['right', '오른쪽'], ['down', '조직도']]) {
  const styleBtn = await page.$('button[title^="맵 스타일"]');
  if (styleBtn) { await styleBtn.click(); await page.waitForTimeout(300); }
  await page.evaluate((lbl) => {
    const el = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === lbl);
    if (el) el.click();
  }, label);
  await page.waitForTimeout(700);
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  await page.keyboard.press('Control+s'); await page.waitForTimeout(600);
  await writeFile(path.join(OUT, 'golden', `layout-${key}.json`), JSON.stringify(await readDoc(), null, 2));
}

async function grab(triggerLabel, outName) {
  const exp = await page.$('button[title="내보내기"]');
  if (exp) { await exp.click(); await page.waitForTimeout(300); }
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 8000 }).catch(() => null),
    page.evaluate((lbl) => {
      const el = [...document.querySelectorAll('div,button')].find((n) => n.textContent.trim().startsWith(lbl) && n.className.includes('mf-btn'));
      if (el) el.click();
    }, triggerLabel),
  ]);
  if (dl) await dl.saveAs(path.join(OUT, 'golden', outName));
}
await grab('텍스트 개요', 'outline.md');
await grab('MindFlow 파일', 'export.json');

await b.close();
server.close();
console.log('golden fixtures regenerated in', OUT);

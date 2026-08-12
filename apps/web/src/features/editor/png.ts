// PNG export — simplified web-layer port of `Component#exportSVGString` +
// `#exportPNG` (MindFlow.dc.html:638-771). 장면 순회(레이어 순서·기하·서식)는
// `exportScene.ts`의 `paintScene` 하나를 SVG 내보내기와 **공유**하고, 이 파일은
// 캔버스 준비(크기·스케일·이미지 프리디코드)와 래스터 산출(PNG 다운로드 / PDF용
// 캔버스 반환)만 맡는다. Canvas is a rendering concern, so this lives in the web
// layer, not `@mindflow/mindmap-core`.
//
// In environments without a real `CanvasRenderingContext2D` (e.g. jsdom in
// unit tests), this is a no-op — matching `metrics.ts`'s `CanvasTextMeasurer`
// fallback philosophy: never throw, just skip the unavailable capability.

import type { Doc, Node } from '@mindflow/mindmap-core';
import { layout } from '@mindflow/mindmap-core';
import { buildVisible } from './tree';
import type { Theme } from './theme';
import { CanvasTextMeasurer, computeMetrics } from './metrics';
import type { GeomMap, NodeGeom } from './types';
import { downloadFile } from './download';
import { displaySrc, type ImageUrlMap } from './useImageUrls';
import { CanvasPainter, computeSceneBounds, paintScene, sceneFloatBox, type Measure, type SceneFloatBox } from './exportScene';

/** Best-effort canvas 2D context — returns `null` when unavailable (headless/test env). */
function get2dContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  try {
    const ctx = canvas.getContext('2d');
    return ctx && typeof ctx.fillRect === 'function' ? ctx : null;
  } catch {
    return null;
  }
}

/** 데이터 URL을 디코드된 이미지 엘리먼트로 (실패 시 null — 해당 자리에는 폴백 박스). */
function loadImageEl(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    // 별도 저장소의 이미지는 **다른 출처**다. CORS 없이 그리면 캔버스가 오염돼
    // `toBlob`이 통째로 실패한다(내보내기가 아무 파일도 안 만든다) — 그러면 사진
    // 하나 때문에 맵 전체를 못 내보낸다. Supabase Storage는 CORS를 허용한다.
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export interface PngExportResult {
  /**
   * 그리지 못한 이미지 수(URL을 못 받았거나 로드에 실패한 것). 0이 아니면 호출부가
   * 알린다 — 사진 자리에 빈 상자만 남은 파일을 **모른 채** 보관하는 일이 없게.
   */
  missingImages: number;
}

export interface RenderedExportCanvas {
  canvas: HTMLCanvasElement;
  /** 장면 좌표계 크기(CSS px) — 래스터는 `scale`배로 더 크다. */
  cssW: number;
  cssH: number;
  missingImages: number;
}

/**
 * 문서 전체를 오프스크린 캔버스에 그린다 — PNG와 PDF(JPEG 임베드)가 같은 래스터를
 * 쓴다. jsdom처럼 캔버스 2D가 없으면 `null`(호출부는 조용히 no-op).
 */
export async function renderExportCanvas(doc: Doc, geom: GeomMap, theme: Theme, imageUrls: ImageUrlMap = {}): Promise<RenderedExportCanvas | null> {
  const ids = Object.keys(geom).filter((id) => doc.nodes[id]);
  // 화이트보드(트리 없는 문서)도 메모·이미지가 있으면 내보낼 것이 있다 —
  // 경계 계산(computeSceneBounds)과 같은 기준으로 완화.
  if (!ids.length && !doc.floats.length && !doc.zones.length && !doc.lines.length && !(doc.strokes ?? []).length) return null;

  const canvas = document.createElement('canvas');
  const ctx = get2dContext(canvas);
  if (!ctx) return null; // headless env (e.g. jsdom) — no-op, nothing to rasterize with

  const measure: Measure = (text, font) => {
    ctx.font = font;
    return ctx.measureText(text).width;
  };

  // Pre-measure memos up front so both the export bounds and the draw pass use
  // the same grown-to-fit height (measuring needs the `ctx`, so this must run
  // BEFORE the canvas is resized — that resets ctx state, not the stored numbers).
  const fBoxes = new Map<string, SceneFloatBox>();
  doc.floats.forEach((f) => fBoxes.set(f.id, sceneFloatBox(measure, f, doc.kind === 'board')));

  // 이미지 프리디코드 — canvas 2D `drawImage`는 디코드 완료된 엘리먼트가
  // 필요하므로 그리기 전에 전부 로드해 둔다(데이터 URL이라 즉시).
  const images = new Map<string, HTMLImageElement>();
  let missingImages = 0;
  await Promise.all([
    ...doc.floats
      .filter((f) => f.img)
      .map(async (f) => {
        const src = displaySrc(f.img, imageUrls);
        const el = src ? await loadImageEl(src) : null;
        if (el) images.set(`f:${f.id}`, el);
        else missingImages++;
      }),
    ...ids
      .filter((id) => doc.nodes[id]?.img)
      .map(async (id) => {
        const src = displaySrc(doc.nodes[id]!.img, imageUrls);
        const el = src ? await loadImageEl(src) : null;
        if (el) images.set(`n:${id}`, el);
        else missingImages++;
      }),
  ]);

  const bounds = computeSceneBounds(doc, geom, fBoxes);
  if (!bounds) return null;
  const { x0, y0, w: W, h: H } = bounds;

  const scale = Math.min(2, 6000 / Math.max(W, H));
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  ctx.scale(scale, scale);
  ctx.translate(-x0, -y0);

  paintScene(new CanvasPainter(ctx, images), { doc, geom, theme, measure, bounds, fBoxes });
  return { canvas, cssW: W, cssH: H, missingImages };
}

export async function exportPng(doc: Doc, geom: GeomMap, theme: Theme, filename: string, imageUrls: ImageUrlMap = {}): Promise<PngExportResult> {
  const rendered = await renderExportCanvas(doc, geom, theme, imageUrls);
  if (!rendered || typeof rendered.canvas.toBlob !== 'function') return { missingImages: 0 };
  rendered.canvas.toBlob((blob) => {
    if (blob) downloadFile(`${filename}.png`, blob);
  }, 'image/png');
  return { missingImages: rendered.missingImages };
}

/**
 * Lay a bare `Doc` out with the same `layout` + `computeMetrics` the editor
 * uses — Home's export path has no live editor geometry. PNG·SVG·PDF의 홈
 * 변형들이 공유한다.
 */
export function layoutDocGeom(doc: Doc): { doc: Doc; geom: GeomMap } {
  const measurer = new CanvasTextMeasurer();
  const sizeOf = (node: Node, depth: number) => {
    const m = computeMetrics(node, depth, measurer);
    return { w: m.w, h: m.h };
  };
  const laid = layout(doc, doc.layoutMode, sizeOf, { rootAnchor: { x: 0, y: 0 } });
  const geom: GeomMap = {};
  buildVisible(laid).forEach(({ id, depth }) => {
    const n = laid[id];
    if (!n) return;
    const m = computeMetrics(n, depth, measurer);
    const g: NodeGeom = { ...m, x: n.x, y: n.y, depth };
    geom[id] = g;
  });
  return { doc: { ...doc, nodes: laid }, geom };
}

/**
 * Render a full-quality PNG straight from a `Doc` (no live editor state) — lays
 * it out with the same `layout` + `computeMetrics` the editor uses, then draws
 * via `exportPng`. Used by Home so a card download is the real map, not a
 * rasterized thumbnail (which cropped text).
 */
export async function exportDocPng(doc: Doc, theme: Theme, filename: string, imageUrls: ImageUrlMap = {}): Promise<PngExportResult> {
  const laid = layoutDocGeom(doc);
  return await exportPng(laid.doc, laid.geom, theme, filename, imageUrls);
}

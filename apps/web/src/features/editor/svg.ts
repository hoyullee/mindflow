// SVG export — `exportScene.ts`의 같은 장면 순회를 SVG 문자열로 산출한다(PNG와
// 레이어 순서·기하·서식이 구조적으로 동일). 벡터라 확대해도 깨지지 않고 Figma·
// Inkscape·브라우저에서 그대로 열린다.
//
// 이미지: 호출부가 **데이터 URL로 인라인한 문서**를 넘긴다(`inlineImagesForExport`
// — JSON 내보내기와 같은 규칙). 서명 URL을 그대로 심으면 파일이 자족적이지 않고
// 몇 시간 뒤 만료돼 깨진다. 인라인되지 못한 참조(`mfimg:…`)는 `displaySrc`가
// 거르므로 그 자리는 비고, 몇 장인지 `missingImages`로 알린다.
//
// 텍스트: 좌표는 전부 측정 기반 절대값(세그 단위 x)이라 Pretendard가 없는 시스템
// 에서도 레이아웃이 재계산되지 않는다 — 글리프 폭 차이만 남는다(`exportScene.ts`의
// SVG_FONT_FAMILY 참고). 측정은 브라우저=캔버스, jsdom=근사 폴백이라 이 파일은
// 단위 테스트에서도 실제 문자열을 만든다.

import type { Doc } from '@mindflow/mindmap-core';
import type { Theme } from './theme';
import { CanvasTextMeasurer } from './metrics';
import type { GeomMap } from './types';
import { downloadFile } from './download';
import { displaySrc } from './useImageUrls';
import { computeSceneBounds, paintScene, sceneFloatBox, SvgPainter, type Measure, type SceneFloatBox } from './exportScene';
import { layoutDocGeom, type PngExportResult } from './png';

export interface BuiltSvg {
  svg: string;
  missingImages: number;
}

/** 문서 전체를 완성된 SVG 문서 문자열로 — 순수 산출이라 테스트가 구조를 검증한다. */
export function buildSvgString(doc: Doc, geom: GeomMap, theme: Theme): BuiltSvg | null {
  const measurer = new CanvasTextMeasurer();
  const measure: Measure = (text, font) => measurer.measure(text, font);

  const fBoxes = new Map<string, SceneFloatBox>();
  doc.floats.forEach((f) => fBoxes.set(f.id, sceneFloatBox(measure, f, doc.kind === 'board')));
  const bounds = computeSceneBounds(doc, geom, fBoxes);
  if (!bounds) return null;

  // 그릴 수 있는 값(data:/http(s):/blob:)만 심는다 — 남은 참조는 자리만 비운다.
  const images = new Map<string, string>();
  let missingImages = 0;
  doc.floats
    .filter((f) => f.img)
    .forEach((f) => {
      const src = displaySrc(f.img, {});
      if (src) images.set(`f:${f.id}`, src);
      else missingImages++;
    });
  Object.keys(geom)
    .filter((id) => doc.nodes[id]?.img)
    .forEach((id) => {
      const src = displaySrc(doc.nodes[id]!.img, {});
      if (src) images.set(`n:${id}`, src);
      else missingImages++;
    });

  const p = new SvgPainter(images);
  paintScene(p, { doc, geom, theme, measure, bounds, fBoxes });
  return { svg: p.svg(bounds.x0, bounds.y0, bounds.w, bounds.h), missingImages };
}

export function exportSvg(doc: Doc, geom: GeomMap, theme: Theme, filename: string): PngExportResult {
  const built = buildSvgString(doc, geom, theme);
  if (!built) return { missingImages: 0 };
  downloadFile(`${filename}.svg`, built.svg, 'image/svg+xml;charset=utf-8');
  return { missingImages: built.missingImages };
}

/** 홈 카드용 — 저장된 `Doc`을 에디터와 같은 레이아웃으로 펼친 뒤 내보낸다. */
export function exportDocSvg(doc: Doc, theme: Theme, filename: string): PngExportResult {
  const laid = layoutDocGeom(doc);
  return exportSvg(laid.doc, laid.geom, theme, filename);
}

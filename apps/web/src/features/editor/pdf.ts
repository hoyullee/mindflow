// PDF export — PNG과 **같은 캔버스 래스터**(`renderExportCanvas`, 2배 스케일)를
// JPEG(DCTDecode)로 임베드한 **단일 페이지 PDF**를 의존성 없이 직접 조립한다.
//
// 왜 벡터 PDF가 아닌가: PDF에 텍스트를 벡터로 넣으려면 한글 폰트(Pretendard)
// 서브셋을 만들어 임베드해야 한다 — 폰트 파서 의존성과 수 MB 자산이 붙고, 실패
// 모드(누락 글리프)도 늘어난다. 이 기능의 용도(인쇄·공유·첨부)에는 2배 래스터가
// 충분하고, 벡터가 필요한 사용자는 SVG 내보내기가 있다. 페이지 크기는 A4 맞춤이
// 아니라 **장면 크기 그대로**(1 CSS px = 0.75 pt) — 마인드맵은 가로로 넓어 고정
// 용지에 맞추면 여백/잘림 판단을 우리가 대신하게 된다. 인쇄 대화상자가 어차피
// 용지에 맞춰 축소해 준다.
//
// JPEG인 이유: 캔버스 PNG는 RGBA라 PDF 이미지 스트림에 그대로 못 넣고(알파는
// SMask 분리 필요) 재인코딩이 필요한데, 배경(theme.canvasBg)을 이미 불투명하게
// 칠하므로 알파를 잃을 것이 없다 — q0.95면 텍스트 가장자리도 온전하다.

import type { Doc } from '@mindflow/mindmap-core';
import type { Theme } from './theme';
import type { GeomMap } from './types';
import { downloadFile } from './download';
import type { ImageUrlMap } from './useImageUrls';
import { layoutDocGeom, renderExportCanvas, type PngExportResult } from './png';

const fnum = (n: number): string => String(Math.round(n * 100) / 100);

/**
 * JPEG 한 장을 페이지에 꽉 채운 단일 페이지 PDF 바이트 — 순수 함수(테스트가 xref
 * 오프셋의 바이트 정확성까지 검증한다).
 *
 * @param jpeg   JPEG 파일 바이트(캔버스 `toBlob('image/jpeg')` 산출)
 * @param imgW/H JPEG 픽셀 크기(래스터 스케일 포함)
 * @param ptW/H  페이지 크기(포인트) — 이미지가 이 크기로 늘어난다
 */
export function buildPdfFromJpeg(jpeg: Uint8Array, imgW: number, imgH: number, ptW: number, ptH: number): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let len = 0;
  const push = (part: string | Uint8Array): void => {
    const b = typeof part === 'string' ? enc.encode(part) : part;
    chunks.push(b);
    len += b.length;
  };

  // 헤더 + 바이너리 표식 주석(4바이트 이상의 상위비트 문자 — 전송 도구가 텍스트로
  // 오인하지 않게 하는 관례. UTF-8 인코딩된 ÿ 두 자 = 0xC3 0xBF ×2, 전부 ≥ 0x80).
  push('%PDF-1.4\n%ÿÿ\n');

  const offsets: number[] = []; // 1-based object byte offsets
  const beginObj = (n: number, dict: string): void => {
    offsets[n] = len;
    push(`${n} 0 obj\n${dict}\n`);
  };
  const endObj = (): void => push('endobj\n');

  beginObj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  endObj();
  beginObj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  endObj();
  beginObj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fnum(ptW)} ${fnum(ptH)}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  endObj();
  beginObj(4, `<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`);
  push('stream\n');
  push(jpeg);
  push('\nendstream\n');
  endObj();
  const content = `q\n${fnum(ptW)} 0 0 ${fnum(ptH)} 0 0 cm\n/Im0 Do\nQ`;
  beginObj(5, `<< /Length ${content.length} >>`);
  push(`stream\n${content}\nendstream\n`);
  endObj();

  const xrefAt = len;
  // xref 항목은 정확히 20바이트("nnnnnnnnnn ggggg n \n") — 스펙 고정 폭.
  push('xref\n0 6\n0000000000 65535 f \n');
  for (let i = 1; i <= 5; i++) push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);

  const out = new Uint8Array(len);
  let at = 0;
  chunks.forEach((c) => {
    out.set(c, at);
    at += c.length;
  });
  return out;
}

export async function exportPdf(doc: Doc, geom: GeomMap, theme: Theme, filename: string, imageUrls: ImageUrlMap = {}): Promise<PngExportResult> {
  const rendered = await renderExportCanvas(doc, geom, theme, imageUrls);
  if (!rendered || typeof rendered.canvas.toBlob !== 'function') return { missingImages: 0 }; // headless env — no-op
  const blob = await new Promise<Blob | null>((resolve) => rendered.canvas.toBlob(resolve, 'image/jpeg', 0.95));
  if (!blob) return { missingImages: rendered.missingImages };
  const jpeg = new Uint8Array(await blob.arrayBuffer());
  // 1 CSS px = 0.75 pt (96dpi → 72pt) — 화면 100%와 같은 물리 크기, 래스터는 2배라 192dpi.
  const pdf = buildPdfFromJpeg(jpeg, rendered.canvas.width, rendered.canvas.height, rendered.cssW * 0.75, rendered.cssH * 0.75);
  downloadFile(`${filename}.pdf`, new Blob([pdf.buffer as ArrayBuffer], { type: 'application/pdf' }), 'application/pdf');
  return { missingImages: rendered.missingImages };
}

/** 홈 카드용 — 저장된 `Doc`을 에디터와 같은 레이아웃으로 펼친 뒤 내보낸다. */
export async function exportDocPdf(doc: Doc, theme: Theme, filename: string, imageUrls: ImageUrlMap = {}): Promise<PngExportResult> {
  const laid = layoutDocGeom(doc);
  return await exportPdf(laid.doc, laid.geom, theme, filename, imageUrls);
}

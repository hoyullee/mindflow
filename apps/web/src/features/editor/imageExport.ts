// 내보내는 파일에 이미지를 **다시 담는다**.
//
// 본문에는 이미지 참조(`mfimg:<docId>/<uuid>`)만 있고 실물은 Storage에 있다. 그대로
// 내보내면 두 가지가 깨진다:
//   ① 내보낸 JSON이 **자족적이지 않다** — 예전엔 파일 하나로 완결됐는데, 참조만 든
//      파일은 그 계정·그 문서에 접근할 수 있어야만 이미지가 보인다.
//   ② **가져오면 이미지가 안 보인다** — 가져오기는 새 문서 id로 저장하는데, 참조
//      경로의 첫 조각은 **원본 문서 id**이고 Storage 정책이 그걸로 권한을 판단한다.
//
// 그래서 내보낼 때 실물을 받아 데이터 URL로 되돌린다. 가져오는 쪽은 손댈 게 없다 —
// 데이터 URL이 든 문서를 열면 에디터의 기존 자동 이전이 **새 문서 폴더로** 올려 준다.

import type { Doc } from '@mindflow/mindmap-core';
import { collectImageRefs, replaceImageValues } from '@mindflow/mindmap-core';
import type { ImageStore } from '../../adapters/ports';

/** 서명 URL의 바이트를 데이터 URL로. 실패하면 `null`(그 이미지는 참조로 남는다). */
async function fetchAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export interface InlinedForExport {
  doc: Doc;
  /** 담지 못한 이미지 수 — 0이 아니면 호출부가 알린다(조용히 빠뜨리지 않게). */
  missing: number;
}

/**
 * 문서의 이미지 참조를 실물 데이터 URL로 바꾼 **사본**을 만든다. 참조가 없으면
 * (텍스트만인 맵, 로컬/데모 모드) 네트워크를 타지 않고 원본을 그대로 돌려준다.
 *
 * 받지 못한 이미지는 참조로 남는다 — 텍스트까지 못 내보내는 것보다 낫고, 몇 장이
 * 빠졌는지는 `missing`으로 알린다.
 */
export async function inlineImagesForExport(doc: Doc, imageStore: ImageStore): Promise<InlinedForExport> {
  const refs = collectImageRefs(doc);
  if (!refs.length) return { doc, missing: 0 };
  const urls = await imageStore.resolve(refs);
  const byValue: Record<string, string> = {};
  await Promise.all(
    refs.map(async (ref) => {
      const url = urls[ref];
      if (!url) return;
      const dataUrl = await fetchAsDataUrl(url);
      if (dataUrl) byValue[ref] = dataUrl;
    }),
  );
  return { doc: replaceImageValues(doc, byValue), missing: refs.length - Object.keys(byValue).length };
}

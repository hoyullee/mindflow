// 이미지 첨부 파이프라인 — 파일(File/Blob) → 문서 인라인용 데이터 URL.
//
// 저장 전략: 이미지는 Supabase Storage 같은 별도 저장소가 아니라 **문서 JSON
// 안에 데이터 URL로 인라인**된다(`Float.img`). 그래서 저장·동기화·실시간
// 협업·오프라인·PNG 내보내기가 전부 기존 문서 경로 그대로 동작한다. 대신
// 첨부 시점에 반드시 여기서 다운스케일/재인코딩해 용량을 억제한다 —
// localStorage(데모 모드) 쿼터와 CRDT 업데이트 크기가 직접적인 제약.

/** 긴 변 상한(px). 초과하면 비율 유지 다운스케일. */
export const MAX_IMAGE_DIM = 1024;
/** 캔버스에 놓일 때의 기본 표시 너비(px, 문서 좌표). */
export const DEFAULT_IMAGE_FLOAT_WIDTH = 260;
/** 인코딩 결과가 이보다 크면 품질을 한 단계 낮춰 재시도. */
const SOFT_BYTE_LIMIT = 600 * 1024;

/** 비율을 유지한 채 긴 변이 `max` 이하가 되는 정수 치수. 순수 함수(테스트 대상). */
export function fitWithin(w: number, h: number, max: number): { w: number; h: number } {
  if (w <= 0 || h <= 0) return { w: 1, h: 1 };
  const scale = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

/** 표시 기본 크기: 문서 좌표에서 너비 DEFAULT_IMAGE_FLOAT_WIDTH, 높이는 비율 추종. */
export function defaultFloatSize(natW: number, natH: number): { w: number; h: number } {
  const w = Math.min(DEFAULT_IMAGE_FLOAT_WIDTH, Math.max(1, natW));
  return { w, h: Math.max(1, Math.round((w * natH) / Math.max(1, natW))) };
}

export interface AttachedImage {
  /** 인라인 저장용 데이터 URL (다운스케일/재인코딩 완료본). */
  src: string;
  /** 인코딩된 이미지의 실제 픽셀 치수. */
  natW: number;
  natH: number;
}

function isImageFile(file: File | Blob): boolean {
  return typeof file.type === 'string' && file.type.startsWith('image/');
}

function loadBitmap(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image decode failed'));
    };
    img.src = url;
  });
}

/**
 * 파일을 디코드→다운스케일→데이터 URL로 인코딩한다. 이미지가 아니거나
 * 디코드에 실패하면 `null` (호출부는 조용히 무시 — 붙여넣기/드롭에는 이미지
 * 아닌 파일도 섞여 들어온다).
 *
 * 포맷 선택: PNG 원본은 투명도를 보존해야 하므로 PNG로, 그 외(JPEG/WebP/...)
 * 는 JPEG(q=0.85)로 인코딩. 결과가 SOFT_BYTE_LIMIT을 넘으면 품질을 낮춰 한 번
 * 재시도한다(PNG는 치수를 한 단계 더 줄임).
 */
export async function attachImageFile(file: File | Blob): Promise<AttachedImage | null> {
  if (!isImageFile(file)) return null;
  let img: HTMLImageElement;
  try {
    img = await loadBitmap(file);
  } catch {
    return null;
  }
  const natural = { w: img.naturalWidth || img.width, h: img.naturalHeight || img.height };
  if (!natural.w || !natural.h) return null;

  const keepPng = file.type === 'image/png';
  const draw = (dim: { w: number; h: number }): string | null => {
    const canvas = document.createElement('canvas');
    canvas.width = dim.w;
    canvas.height = dim.h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, dim.w, dim.h);
    return keepPng ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.85);
  };

  let dim = fitWithin(natural.w, natural.h, MAX_IMAGE_DIM);
  let src = draw(dim);
  if (!src) return null;
  if (src.length > SOFT_BYTE_LIMIT) {
    // 데이터 URL 길이 ≈ 바이트*4/3 — 초과 시 한 단계 더 압축해 재시도
    if (keepPng) {
      dim = fitWithin(dim.w, dim.h, Math.round(MAX_IMAGE_DIM / 2));
      src = draw(dim) ?? src;
    } else {
      const canvas = document.createElement('canvas');
      canvas.width = dim.w;
      canvas.height = dim.h;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, dim.w, dim.h);
        src = canvas.toDataURL('image/jpeg', 0.7);
      }
    }
  }
  return { src, natW: dim.w, natH: dim.h };
}

/** 붙여넣기/드롭 이벤트의 항목들 중 첫 이미지 파일을 꺼낸다. */
export function firstImageFile(dt: DataTransfer | null): File | null {
  if (!dt) return null;
  for (const item of Array.from(dt.items ?? [])) {
    if (item.kind === 'file') {
      const f = item.getAsFile();
      if (f && isImageFile(f)) return f;
    }
  }
  for (const f of Array.from(dt.files ?? [])) {
    if (isImageFile(f)) return f;
  }
  return null;
}

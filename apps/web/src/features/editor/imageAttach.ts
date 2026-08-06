// 이미지 첨부 파이프라인 — 파일(File/Blob) → 다운스케일·재인코딩 → 별도 저장소.
//
// 저장 전략: 실물은 Storage에 올리고 본문에는 **참조만** 남긴다(core `image.ts`).
// 저장소가 없거나 업로드가 실패하면 예전처럼 본문에 데이터 URL로 인라인한다 —
// 데모 모드·오프라인에서도 첨부는 언제나 성공해야 하기 때문이다.
//
// 어느 쪽이든 여기서 반드시 줄여서 내보낸다. 무료 플랜에서 먼저 닿는 한도가
// **저장 용량이 아니라 전송량**이라, 한 장의 바이트 수가 곧 수용 인원이다.

/**
 * 긴 변 상한(px). 초과하면 비율 유지 다운스케일.
 *
 * **1024 → 2048로 올렸다(제보: 삽입한 이미지가 깨져 보인다).** 1024는 이미지가
 * 문서 본문에 base64로 인라인되던 시절의 값이다 — 그때는 한 장의 크기가 곧
 * localStorage 쿼터이자 CRDT 업데이트 크기였다. 이제 실물은 Storage에 있으므로
 * 그 제약이 없다.
 *
 * 2048인 이유: 표시 크기는 문서 좌표 기준(메모 기본 260 / 노드 180)이지만 실제로
 * 화면에 찍히는 픽셀은 **표시 크기 × 캔버스 줌 × 기기 픽셀비**다. 기본 크기를 최대
 * 줌(MAX_ZOOM 2.4)으로 2배 화면에서 보면 260 × 2.4 × 2 = 1248이고, 2048이면 메모를
 * 기본보다 **1.6배 키워 놓고** 최대 줌으로 봐도 원본 픽셀이 모자라지 않는다.
 * 더 키우지 않는 이유는 전송량이다(2048 스크린샷 130KB / 사진 63KB 실측).
 */
export const MAX_IMAGE_DIM = 2048;
/** 캔버스에 놓일 때의 기본 표시 너비(px, 문서 좌표). */
export const DEFAULT_IMAGE_FLOAT_WIDTH = 260;
/**
 * 인코딩 결과(데이터 URL 길이)가 이보다 크면 한 단계 더 줄여 재시도.
 *
 * **600KB → 1.5MB로 올렸다.** 이 경로는 "너무 큰 이미지"를 막는 안전판인데, 값이
 * 낮으면 **평범한 스크린샷에서도 발동해 화질을 떨어뜨린다** — 예전에는 1024px PNG
 * 스크린샷이 이 한계를 넘어 치수를 **512px로 반토막** 냈고, 그게 "삽입한 이미지가
 * 깨져 보인다"의 정체였다. WebP로 인코딩하는 지금은 2048px 스크린샷이 130KB,
 * 사진이 63KB(실측)라 정상 이미지에서는 사실상 발동하지 않는다.
 */
const SOFT_BYTE_LIMIT = 1_500 * 1024;

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
  /**
   * 본문 `img`에 넣을 값 — 별도 저장소에 올라갔으면 **참조**(`mfimg:…`), 아니면
   * 예전처럼 데이터 URL. 어느 쪽이든 문자열 한 개라 모델·직렬화·CRDT는 그대로다.
   */
  src: string;
  /** 인코딩된 이미지의 실제 픽셀 치수. */
  natW: number;
  natH: number;
}

/** 실물을 올리고 참조를 돌려준다. `null`이면 호출부가 본문에 인라인한다. */
export type ImageUploader = (blob: Blob, ext: string) => Promise<string | null>;

/** 데이터 URL → Blob. `fetch(dataUrl)`는 환경에 따라 막혀 있어 직접 푼다. */
export function dataUrlToBlob(dataUrl: string): Blob | null {
  const comma = dataUrl.indexOf(',');
  if (!dataUrl.startsWith('data:') || comma < 0) return null;
  const meta = dataUrl.slice(5, comma);
  const type = meta.split(';')[0] || 'application/octet-stream';
  try {
    const bin = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type });
  } catch {
    return null;
  }
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
 * 포맷은 `pickImageFormat`이 고른다(WebP 우선). 결과가 SOFT_BYTE_LIMIT을 넘으면
 * 품질을 낮춰 한 번 재시도한다(무손실 PNG는 치수를 한 단계 더 줄임).
 */
export interface ImageFormat {
  mime: string;
  ext: string;
  /** `undefined` = 무손실(품질 손잡이 없음). */
  quality?: number;
  /** 결과가 너무 클 때 한 단계 낮춰 다시 인코딩할 품질. */
  retryQuality?: number;
}

/**
 * 어떤 포맷으로 인코딩할지. 순수 함수(테스트 대상).
 *
 * **WebP를 우선**한다 — 같은 체감 화질에서 JPEG보다 30~50% 작고, JPEG과 달리
 * 투명도까지 지원해서 PNG 원본도 무손실을 포기하지 않고 받아 준다. 바이트 수가
 * 곧 저장 용량이자 전송량이므로 이 선택 하나가 실질 수용 인원을 좌우한다.
 *
 * 지원하지 않는 브라우저(옛 사파리 등)에서는 예전 규칙 그대로 — 투명도가 필요한
 * PNG는 PNG로, 나머지는 JPEG로.
 */
export function pickImageFormat(fileType: string, webpSupported: boolean): ImageFormat {
  if (webpSupported) return { mime: 'image/webp', ext: 'webp', quality: 0.85, retryQuality: 0.7 };
  if (fileType === 'image/png') return { mime: 'image/png', ext: 'png' };
  return { mime: 'image/jpeg', ext: 'jpg', quality: 0.85, retryQuality: 0.7 };
}

/** 이 브라우저의 canvas가 WebP로 인코딩할 수 있는가(한 번만 재고 기억한다). */
let webpSupport: boolean | null = null;
export function canvasSupportsWebp(): boolean {
  if (webpSupport !== null) return webpSupport;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    // 지원하지 않으면 브라우저가 조용히 PNG로 돌려준다 — 결과 문자열로 판별한다.
    webpSupport = canvas.toDataURL('image/webp').startsWith('data:image/webp');
  } catch {
    webpSupport = false;
  }
  return webpSupport;
}

export async function attachImageFile(file: File | Blob, upload?: ImageUploader): Promise<AttachedImage | null> {
  if (!isImageFile(file)) return null;
  let img: HTMLImageElement;
  try {
    img = await loadBitmap(file);
  } catch {
    return null;
  }
  const natural = { w: img.naturalWidth || img.width, h: img.naturalHeight || img.height };
  if (!natural.w || !natural.h) return null;

  const fmt = pickImageFormat(file.type, canvasSupportsWebp());
  const draw = (dim: { w: number; h: number }, quality = fmt.quality): string | null => {
    const canvas = document.createElement('canvas');
    canvas.width = dim.w;
    canvas.height = dim.h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, dim.w, dim.h);
    return quality === undefined ? canvas.toDataURL(fmt.mime) : canvas.toDataURL(fmt.mime, quality);
  };

  let dim = fitWithin(natural.w, natural.h, MAX_IMAGE_DIM);
  let src = draw(dim);
  if (!src) return null;
  if (src.length > SOFT_BYTE_LIMIT) {
    // 데이터 URL 길이 ≈ 바이트*4/3 — 초과 시 한 단계 더 압축해 재시도.
    // 무손실(PNG)은 품질 손잡이가 없으니 치수를 줄인다.
    if (fmt.quality === undefined) {
      dim = fitWithin(dim.w, dim.h, Math.round(MAX_IMAGE_DIM / 2));
      src = draw(dim) ?? src;
    } else {
      src = draw(dim, fmt.retryQuality) ?? src;
    }
  }
  // 여기까지가 예전과 같다(다운스케일/재인코딩된 데이터 URL). 별도 저장소가 있으면
  // 그 실물을 올리고 본문에는 **참조만** 남긴다 — 실패하면 인라인으로 폴백하므로
  // 첨부 자체는 언제나 성공한다(오프라인·정책 미적용 서버에서도).
  if (upload) {
    const blob = dataUrlToBlob(src);
    if (blob) {
      const ref = await upload(blob, fmt.ext);
      if (ref) return { src: ref, natW: dim.w, natH: dim.h };
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

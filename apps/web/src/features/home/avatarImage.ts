// 프로필 이미지 준비 — 고른 파일을 **정사각 256px**로 줄여 올릴 수 있는 형태로.
//
// 왜 손보나: 아바타가 그려지는 가장 큰 자리는 56px(설정 모달)이고 대부분 24~36px다.
// 원본 사진(수 MB)을 그대로 올리면 저장량·전송량을 이유 없이 태우고, 접속자 목록처럼
// 아바타가 여럿 뜨는 화면에서 특히 낭비다. 256px은 2배 화면의 가장 큰 자리(112px)를
// 덮는다.
//
// 잘라내기는 **가운데 정사각**이다 — 사람 얼굴은 대개 가운데 있고, 자르는 자리를
// 고르는 UI는 이 요청의 범위를 넘는다(원본 비율을 그대로 눌러 담으면 얼굴이 찌그러진다).

import { canvasSupportsWebp } from '../editor/imageAttach';

export const AVATAR_SIZE = 256;
/** 이보다 크면 품질을 한 단계 낮춰 다시 뽑는다(느린 회선의 접속자 목록을 지킨다). */
const SOFT_BYTES = 120 * 1024;

/** 파일을 아바타로 쓸 수 있게 다듬는다. 실패는 사용자 문구로 돌려준다. */
export async function prepareAvatar(file: File): Promise<{ blob?: Blob; error?: string }> {
  if (!file.type.startsWith('image/')) return { error: '이미지 파일만 올릴 수 있어요.' };
  let bitmap: HTMLImageElement;
  try {
    bitmap = await loadImage(file);
  } catch {
    return { error: '이미지를 읽지 못했어요.' };
  }
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { error: '이미지를 처리하지 못했어요.' };
  const side = Math.min(bitmap.naturalWidth || AVATAR_SIZE, bitmap.naturalHeight || AVATAR_SIZE);
  const sx = ((bitmap.naturalWidth || side) - side) / 2;
  const sy = ((bitmap.naturalHeight || side) - side) / 2;
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);

  // 투명도를 지키려면 webp(지원되면)나 png — 아바타는 원형으로 잘려 보이므로
  // 배경이 투명한 로고를 올리는 경우가 있다.
  const type = canvasSupportsWebp() ? 'image/webp' : 'image/png';
  let blob = await toBlob(canvas, type, 0.9);
  if (blob && blob.size > SOFT_BYTES && type === 'image/webp') {
    const smaller = await toBlob(canvas, type, 0.75);
    if (smaller && smaller.size < blob.size) blob = smaller;
  }
  return blob ? { blob } : { error: '이미지를 처리하지 못했어요.' };
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('decode failed'));
    };
    img.src = url;
  });
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
}

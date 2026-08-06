// 첨부 이미지 하나를 그린다 — 참조든 옛 데이터 URL이든 같은 자리에서.
//
// 참조(`mfimg:…`)는 별도 저장소를 가리키고 URL 발급이 비동기라, 아직 못 받은
// 동안에는 **같은 크기의 자리표시자**를 그린다. 크기는 문서에 있으므로(`imgW`/
// `imgH`, 플로트는 `w`/`h`) 늦게 도착한 이미지가 레이아웃을 밀지 않는다 —
// 자리표시자가 사진으로 바뀔 뿐이다(홈 썸네일의 회색 자리표시자와 같은 관례).

import type { CSSProperties } from 'react';
import { displaySrc, type ImageUrlMap } from '../useImageUrls';

interface AttachedImgProps {
  img: string | undefined;
  urls: ImageUrlMap;
  style: CSSProperties;
}

export function AttachedImg({ img, urls, style }: AttachedImgProps) {
  const src = displaySrc(img, urls);
  if (!src) {
    return (
      <div
        data-image-placeholder="true"
        aria-hidden="true"
        style={{ ...style, background: 'rgba(0,0,0,.06)', border: '1px solid rgba(0,0,0,.05)' }}
      />
    );
  }
  return <img src={src} alt="" draggable={false} style={style} />;
}

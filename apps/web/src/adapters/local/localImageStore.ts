// 로컬/데모 모드의 `ImageStore` — 별도 저장소가 없다.
//
// `upload`가 `null`을 돌려주면 호출부(`imageAttach`)는 예전처럼 **본문에 데이터
// URL로 인라인**한다. 데모 모드는 어차피 혼자 쓰고 localStorage에만 남으므로
// 그게 맞는 동작이고, 덕분에 스토리지 없이도 이미지 첨부가 그대로 된다.
//
// `resolve`는 빈 결과를 돌려준다 — 로컬 모드 문서에는 참조가 아예 없기 때문이다
// (혹시 참조가 섞인 문서를 열면 이미지는 자리표시자로 보인다. 그 문서는 원래
// 서버 계정의 것이라 이 기기에서 실물을 볼 방법이 없다).

import type { ImageStore } from '../ports';

export class LocalImageStore implements ImageStore {
  async upload(): Promise<string | null> {
    return null;
  }

  async resolve(): Promise<Record<string, string>> {
    return {};
  }

  async removeForDoc(): Promise<void> {
    /* 실물이 없다 — 지울 것도 없다 */
  }
}

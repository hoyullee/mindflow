<!-- backend.md §7 — 색인: ../backend.md -->
## 7. 홈 썸네일 본문 (0012 `preview_doc`, 0032) — egress 절감

- **왜**: 이미지 첨부는 (0016 이전) 문서 `data` jsonb 안에 base64 data URL로
  인라인이라, 홈 썸네일이 문서 전문을 받으면 카드마다 수백 KB~수 MB가 실려
  옵니다(무료 5GB/월 egress 잠식). `preview_doc(doc_id)` RPC는 `nodes.*.img` /
  `floats[].img`의 **인라인 데이터**만 `'stripped'`로 바꾼 본문을 돌려줍니다 —
  크기 필드는 유지돼 박스 계산이 변하지 않고, 그 자리는 회색 자리표시자입니다.
- **0032 — 참조는 남긴다**: 0016부터 이미지 실물은 Storage에 있고 본문에는
  `mfimg:<경로>` 참조(50바이트)만 남습니다. 0012는 값이 문자열이기만 하면 전부
  지웠기 때문에 아끼는 전송량은 0인데 **썸네일이 영영 자리표시자**였습니다(제보).
  0032는 `like 'data:%'`인 값만 떼므로 참조가 그대로 오고, 클라이언트가 서명 URL을
  발급해 카드·위젯에 실제 이미지를 그립니다.
  - 전송량은 클라이언트에서 두 겹으로 묶습니다: **화면에 닿은 카드**의 문서만
    발급받고(`useVisibleOnce` — `content-visibility: auto`는 렌더만 건너뛸 뿐
    화면 밖 카드의 이미지도 내려받는다는 것을 실측으로 확인), 발급한 서명 URL은
    기기에 캐시해 재방문에 같은 문자열을 씁니다(`imageUrlCache.ts` — 토큰이
    바뀌면 브라우저 캐시가 통째로 빗나갑니다).
  - **더 줄여야 하면**: 업로드 때 작은 썸네일 사본을 함께 올려 미리보기가 그걸
    쓰는 것이 다음 수순입니다(Storage 이미지 변환은 유료 플랜 기능).
- **보안**: security **invoker**(기본) — `documents`의 SELECT RLS(내 문서 또는
  공유받은 문서, 0009)가 그대로 적용됩니다. `authenticated`에게만 execute.
- **캐시**: 클라이언트는 `(id, version, updatedAt)` 키의 localStorage 캐시
  (`apps/web/src/adapters/previewBodyCache.ts`)로 같은 판을 재방문할 때 네트워크를
  건너뜁니다. `version`은 낙관적 잠금 카운터라 저장마다 증가 → 동시 편집에서 남이
  저장해도 다음 홈 진입의 `list()`가 새 판을 알려 재다운로드됩니다. 유일성이 깨질
  수 있는 단 하나의 경로(prevVersion 없는 강제 저장 — version 1 재설정)는 서버
  트리거가 항상 새로 찍는 `updated_at`이 캐시 키에 함께 있어 잡습니다.
- **배포**: GitHub 연동 자동 마이그레이션으로 적용됩니다(수동 절차 불필요).
  RPC가 아직 없는 서버에서는 클라이언트가 전문 `load()`로 폴백하므로 순서에
  안전합니다(콘솔에 `[geurio] preview_doc RPC 실패` 경고만 남음).

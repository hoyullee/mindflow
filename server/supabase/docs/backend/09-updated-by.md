<!-- backend.md §9 — 색인: ../backend.md -->
## 9. 마지막 수정자 (0015 `documents.updated_by` + `document_editors`)

홈 맵 카드 하단이 "수정일 · 3시간 전 · 홍길동"이 됩니다. 공동 편집(0009)이 실사용에
들어가면서 "이 맵을 마지막으로 건드린 사람"이 정보가 됐기 때문입니다.

- **표시 규칙**: 마지막 저장자가 **내가 아닐 때만** 이름을 붙입니다. 혼자 쓰는
  사람은 카드마다 자기 이름이 반복돼 정보가 아니라 잡음이 되고, 그런 사용자는
  이름 조회 요청 자체가 나가지 않습니다(왕복 0회).
- **스탬프**: `documents.updated_by uuid`를 **서버 트리거**(`set_updated_by`)가
  `auth.uid()`로 찍습니다 — `updated_at`과 같은 이유로, 클라이언트가 보내는 값이면
  남의 이름으로 위장할 수 있습니다. 편집자가 탈퇴하면 `on delete set null`로
  이름만 사라지고 문서는 남습니다.
- **이름 해석**: `document_editors(doc_ids text[])` RPC. 클라이언트는 `auth.users`도
  남의 `profiles`(RLS `profiles_select_own`)도 읽을 수 없어, 0010
  `share_participants`와 같은 SECURITY DEFINER 조인이 필요합니다. DEFINER는 RLS를
  우회하므로 가드를 직접 겁니다 — **내가 소유했거나 나에게 공유된 문서만**, 그리고
  **마지막 저장자가 나 자신이면 아무것도 돌려주지 않습니다**. 이름 우선순위는 앱의
  프로필명 규칙과 같고(`profiles.display_name` → OAuth full_name/name → 이메일
  로컬 파트) **이메일 전체는 절대 내려가지 않습니다**.
- **비용**: 칼럼 하나(uuid) + 홈 로드당 왕복 1회(대상이 있을 때만, 페이로드는
  이름 몇 개). 실시간 트래픽·저장량 영향 없음.
- **배포**: GitHub 연동 자동 마이그레이션. 0015 이전 행은 `updated_by`가 비어 있어
  한 번 저장되기 전까지 이름이 표시되지 않고, RPC가 아직 없는 서버에서는 어댑터가
  조용히 `{}`로 떨어집니다(순서에 안전 — 이름만 안 보입니다).
- **확인 SQL**(Studio): `select id, title, updated_at, updated_by from documents order by updated_at desc limit 20;`
- **검증**: 트리거와 RPC는 로컬 Postgres에 0001/0009/0010/0015를 실제로 적용해 확인했습니다
  (`auth.uid()`/`auth.jwt()`를 GUC로 대체한 하네스). 기대 동작 네 가지가 그대로 나옵니다 —
  ① insert 시 만든 사람으로 스탬프, ② 공유받은 편집자의 update 시 그 사람으로 바뀜,
  ③ 소유자가 물으면 편집자의 프로필명이 나옴, ④ **자기 자신·제3자에게는 아무 행도 없음**.
- **이름이 안 보일 때 어디를 보나**: 브라우저 콘솔.
  `[geurio] document_editors RPC 실패` = 조회 자체가 실패(정책/미배포),
  `[geurio] documents.updated_by 없음` = 마이그레이션 대기,
  둘 다 없으면 **보여 줄 이름이 없는 것**(마지막 저장자가 나이거나 `updated_by`가 아직 빈 옛 행).
  옛 문서는 0015 적용 후 **한 번 저장되면** 그때부터 이름이 붙습니다.

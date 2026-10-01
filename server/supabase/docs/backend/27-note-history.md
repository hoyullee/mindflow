<!-- backend.md §27 — 색인: ../backend.md -->
## 27. 공책 페이지별 기록 (0048 `note_history`) — 누가·언제·무엇을 + 페이지 스냅샷

공책 우측의 「기록」 패널이 그리는 타임라인입니다. 예전 `versionHistory.ts`는 **이 기기
localStorage의 스냅샷**이라 누가 바꿨는지 몰랐고, 같이 쓰는 공책에서는 남의 편집을 볼
길이 없었습니다. 그래서 서버에 둡니다. 항목 하나 = 그 시점의 **페이지 스냅샷** + 한 줄
요약(+ 문구 수정이면 전·후 글).

- **스키마**: `note_history(id uuid pk, document_id → documents on delete cascade, page_id,
  at, actor_id → auth.users on delete set null default auth.uid(), actor_name·actor_color·
  actor_avatar(행위 시점 스냅샷), kind, summary, diff jsonb, anchor, snapshot jsonb not
  null)`. `kind`는 check로 열 가지(`create`·`edit`·`insert`·`delete`·`move`·`restore`·
  `checklist`·`table`·`tag`·`rename`). 인덱스 `(document_id, page_id, at desc)`가 목록
  질의와 보관 트리거를 함께 받친다.
- **왜 본문 밖의 표인가**: 댓글(§13)과 같다 — 기록은 본문과 수명이 다르고(되돌려도
  "되돌렸다"는 기록은 남아야 한다), 본문은 자동저장마다 통째로 오가는 값이라 스냅샷을
  안에 넣으면 저장마다 같이 실려 간다. `page_id`는 본문 안의 키라 FK를 걸 수 없고,
  페이지가 지워져도 기록은 남는다(되돌릴 길이므로).
- **RLS** (전부 `to authenticated` — 빼면 PUBLIC이라 anon에게 열린다. `revoke all … from anon`이
  이중 잠금):

  | 동작 | 누가 |
  | --- | --- |
  | SELECT | `owns_document` 또는 `shared_with_me(…,'view')` — 링크 공유(0017)로 온 사람은 제외(댓글과 같다) |
  | INSERT | `actor_id = auth.uid()` 이고 (소유자 또는 `shared_with_me(…,'edit')`) — **보기 전용은 못 쓴다** |
  | UPDATE | 내 항목만(`using actor_id = auth.uid()`), `with check`에서 편집 권한을 다시 본다 |
  | DELETE | 정책 없음 — 클라이언트는 지우지 못한다 |

  `actor_id`는 칼럼 기본값(`auth.uid()`)이 찍으므로 클라이언트가 보내지 않는다 — 남의
  이름으로 기록을 위조할 길이 없다. UPDATE를 RPC로 좁히지 않은 이유: 한 행이 전부 "내
  것"이라 `document_shares.role`처럼 스스로 권한을 올릴 칼럼이 없다(`actor_id`·
  `document_id`를 옮기는 UPDATE는 `with check`가 막는다).
- **보관**: **최근 30일은 전부, 그 이전은 (문서, 페이지)마다 하루 1개**(그날의 마지막
  항목, 날 경계는 `Asia/Seoul`). cron 없이 **AFTER INSERT 트리거**
  `note_history_prune()`(security definer)가 새 항목이 들어온 그 페이지만 정리한다 —
  안 쓰는 페이지는 늘지도 않는다. 정리가 실패해도 기록 저장은 막지 않고
  `raise warning 'note_history_prune failed: …'`만 남긴다(**라이브에서 기록은 되는데
  옛 것이 안 줄면 Logs에서 이 줄을 찾는다**). 개수 상한은 두지 않았다.
- **클라이언트**: `NoteHistoryStore` 포트(`adapters/ports.ts`, `Backend.noteHistory?`는
  선택 필드). Supabase 어댑터 `SupabaseNoteHistoryStore`(`list`는 `at desc`로
  `limit+1`건을 읽어 `hasMore`를 계산, `before`는 `at < ISO`), 로컬/데모
  `LocalNoteHistoryStore`(`mindflow_nhist_<docId>` — 같은 보관 규칙 + 2,000,000자 크기
  가드, 저장소 실패에 던지지 않음). 화면은 `useNoteHistoryStore()`를 쓴다 — 필드가
  비어 있는 Backend(테스트·옛 조립)에서는 모듈 하나를 공유하는 로컬 판으로 물러난다.
  어댑터는 **던진다**(호출자가 잡아 기록 실패를 건너뛴다).
- **배포**: GitHub 연동 자동 마이그레이션(main 머지). Edge Function 없음 — 손으로 할
  단계가 없다. 프런트가 먼저 나가 테이블이 아직 없으면 어댑터가 던지고, 호출자가
  잡으므로 편집은 영향 없이 기록만 비어 있다.
- **확인**: 두 계정으로 공책을 같이 편집하고 한쪽에서 기록 패널을 열었을 때 다른 사람의
  이름으로 항목이 보이면 됩니다. SQL로는
  `select actor_name, kind, summary, at from note_history order by at desc limit 20;`.
- **개인정보**: 행위자 이름·아바타 URL과 지난 본문(스냅샷)이 서버에 남는다. 문서 본문·
  댓글(`author_name`)과 같은 범주(서비스 콘텐츠, §3 Supabase 위탁)라 `/privacy`의 구조는
  그대로다. 다만 두 가지는 방침 문구와 맞춰 볼 만하다 — ① **탈퇴해도 남의 문서에 남긴
  편집 기록의 이름 스냅샷은 남는다**(`actor_id`만 null — 댓글과 같은 절충, 내 문서의
  기록은 문서와 함께 cascade로 지워진다) ② 보관 기간(30일 전부 + 이후 하루 1개).

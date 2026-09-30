<!-- backend.md §14b — 색인: ../backend.md -->
## 14b. 본문 인라인 멘션 알림 (0023)

주제/메모 본문의 `@멘션`(rich 런 `m`=이메일)이 **새로 생긴** 저장에만 `doc_mention`
알림을 만든다. 0022와 같은 원칙 — 클라이언트는 알림을 못 만들고, documents UPDATE
트리거가 old/new 본문의 멘션 이메일 **집합 차이**만 알린다. 수신자는 그 문서의
소유자·초대자만(임의 이메일 스팸 차단), 자기 멘션 제외, 미확인 동일 알림이 있으면
생략(undo/CRDT 재등장 중복 억제). 마이그레이션은 GitHub 연동 자동 배포.

### 14b-1. 멘션 알림이 안 올 때 진단 순서

1. **멘션이 실제로 걸렸는가** — 캔버스에서 "@이름"이 **밑줄 없는 파란 글자**로
   보여야 멘션이다. 자동완성 리스트에서 **선택**해야 걸리고, 손으로 `@이름`을
   그냥 타이핑한 것은 평문이라 알림이 가지 않는다(댓글 멘션과 같은 규칙).
2. **0023이 서버에 적용됐는가** — SQL Editor에서:
   ```sql
   select tgname from pg_trigger
    where tgrelid = 'public.documents'::regclass and tgname = 'trg_notify_doc_mentions';
   ```
   빈 결과면 미적용이다. 첫 판 0023이 칼럼명 오류로 실패해 **그 뒤 자동 배포가
   계속 실패 중**일 수 있다(대시보드 → GitHub 연동 배포 이력 확인). 그 경우
   `supabase/migrations/0023_doc_mentions.sql`(수리판) 내용을 SQL Editor에 그대로
   붙여넣어 실행하면 된다 — 전부 create or replace / drop if exists라 **몇 번을
   실행해도 안전**하다. 단, 이력이 어긋났으면 이후 새 마이그레이션이 0023에서
   또 걸릴 수 있으니 `supabase migration repair --status applied 0023`으로 이력을
   맞춰 둔다.
3. **동작 확인** — 멘션 저장 뒤:
   ```sql
   select kind, recipient, doc_title, created_at from public.notifications
    order by created_at desc limit 5;
   ```
   `doc_mention` 행이 생기면 서버는 정상 — 이후는 상대 홈의 벨(마운트/탭 복귀/
   열 때 갱신)이 읽는다.

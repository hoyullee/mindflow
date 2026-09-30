<!-- backend.md §3 — 색인: ../backend.md -->
## 3. 보안 노트

- **anon key는 공개되어도 안전합니다** (클라이언트 번들에 포함되는 것이 정상 — RLS가
  실제 접근 제어를 담당). `apps/web/.env.example`에는 이 키만 등장합니다.
- **service_role 키는 절대로 클라이언트/이 리포에 넣지 않습니다.** 서버 전용 관리 작업
  (예: `seed.sql`의 `auth.admin.createUser` 대체 스크립트)이 필요하면 별도의 서버리스
  함수/CI 시크릿으로만 다루세요.
- 모든 `documents` 접근은 `owner = auth.uid()` RLS 정책으로 강제됩니다
  (`migrations/0001_init.sql`) — 클라이언트 어댑터(`SupabaseDocStore`)가 실수로
  `WHERE owner = ...`를 빼먹어도 다른 사용자의 문서가 노출되지 않습니다(방어 심층화).
- 비밀번호는 Supabase Auth가 해시/저장을 전담합니다(이 리포는 평문 비밀번호를 절대
  저장하지 않습니다 — `SupabaseAuth`는 `supabase-js`의 `signInWithPassword`/`signUp`에
  그대로 위임).
- 레이트리밋: Supabase Auth는 기본적으로 로그인/가입 시도에 자체 레이트리밋을 적용합니다
  (프로젝트 설정에서 조정 가능). 이 리포는 별도의 애플리케이션 레벨 레이트리밋을 추가하지
  않았습니다 — 필요 시 Supabase Edge Function 또는 API 게이트웨이 레벨에서 추가하세요.

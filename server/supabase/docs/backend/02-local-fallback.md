<!-- backend.md §2 — 색인: ../backend.md -->
## 2. 로컬 폴백 (기본 동작)

`VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` 중 하나라도 없으면 `createBackend()`는
**항상** `LocalAuth`/`LocalDocStore`를 선택합니다 — 즉:

- 새로 체크아웃한 리포, CI, `.env` 없는 로컬 개발 모두 **에러 없이** 기존 데모 동작
  그대로 실행됩니다(로그인은 즉시 통과, 문서는 `localStorage`의 `mindflow_doc_<id>`에
  저장).
- `/home`, `/editor` 라우트의 인증 가드(`App.tsx`의 `RequireAuth`)도 Local 모드에서는
  완전히 우회됩니다 — 데모를 막지 않습니다.
- 이 폴백 자체가 이 작업의 핵심 요구사항입니다: "env-게이트 + 로컬 폴백으로 앱이 절대
  깨지지 않게".

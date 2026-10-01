# MindFlow 백엔드 — Supabase 프로비저닝 가이드 (M4)

이 문서는 `apps/web`이 데모(localStorage) 대신 실제 Supabase 백엔드를 쓰도록 켜는 절차를
설명합니다. **이 개발 환경에는 실제 Supabase 프로젝트가 없습니다** — 아래 절차는 사람이
실제 Supabase 콘솔/CLI로 수행해야 하는 단계이며, 이 리포의 테스트는 전부 모의(in-memory/
mocked) 어댑터로 검증되었습니다(라이브 호출 없음).

**이 문서는 색인입니다.** 섹션마다 파일이 따로 있고(`backend/`), 코드·마이그레이션·changelog의
「`backend.md` §N」 참조는 아래 표에서 그 번호로 찾아 들어갑니다. 섹션 번호는 바꾸지 않습니다
(참조가 번호로 걸려 있다). 새 섹션은 `backend/NN-slug.md`로 만들고 표에 한 줄을 더합니다.

| § | 내용 | 크기 |
|---|---|---|
| §1 | [프로비저닝 체크리스트 (사람이 할 일)](backend/01-provisioning.md) | 4KB |
| §1b | [Google OAuth 로그인 — 상세 설정 절차 (검증 완료)](backend/01b-google-oauth-login.md) | 3KB |
| §1c | [로컬 개발 PC에서 실 백엔드 연결 (Windows 포함)](backend/01c-local-dev.md) | 2KB |
| §1d | [GIS 직접 연동 — 동의 화면의 supabase.co 표시 제거](backend/01d-gis-direct.md) | 3KB |
| §1e | [이메일 회원가입 인증 (커스텀 SMTP + OTP 템플릿)](backend/01e-email-signup.md) | 7KB |
| §2 | [로컬 폴백 (기본 동작)](backend/02-local-fallback.md) | 1KB |
| §3 | [보안 노트](backend/03-security.md) | 1KB |
| §4 | [알려진 스코프 컷 (M4 시점)](backend/04-scope-cuts.md) | 2KB |
| §5 | [Yjs/CRDT 도입 지점 (2단계, 설계만)](backend/05-yjs-crdt.md) | 1KB |
| §6 | [문서 공유 (0009) — 사람 사이의 실시간 공동 편집](backend/06-document-shares.md) | 7KB |
| §7 | [홈 썸네일 본문 (0012 `preview_doc`, 0032) — egress 절감](backend/07-preview-doc.md) | 3KB |
| §8 | [사용자 피드백 (0014 `feedback`) — insert 전용 우편함](backend/08-feedback.md) | 1KB |
| §9 | [마지막 수정자 (0015 `documents.updated_by` + `document_editors`)](backend/09-updated-by.md) | 3KB |
| §10 | [첨부 이미지 (0016 Storage 버킷 `map-images`)](backend/10-map-images.md) | 5KB |
| §11 | [링크 공유 (0017 `documents.link_role`)](backend/11-link-share.md) | 4KB |
| §12 | [초대 알림 (0019 `seen_at` + Edge Function `share-invite`)](backend/12-invite-notify.md) | 3KB |
| §13 | [주제 댓글 (0020 `document_comments`)](backend/13-comments.md) | 5KB |
| §14 | [알림 우편함 (0022 `notifications`) — 홈 알림 센터](backend/14-notifications.md) | 3KB |
| §14b | [본문 인라인 멘션 알림 (0023)](backend/14b-doc-mentions.md) | 2KB |
| §15 | [세션 정책 (로그인 유지·동시 로그인)](backend/15-session-policy.md) | 6KB |
| §16 | [로그인 수단 (0029 `my_signin_methods` + 연동/비밀번호 설정)](backend/16-signin-methods.md) | 8KB |
| §17 | [프로필 이미지 (0031 `profiles.avatar_url` + Storage 버킷 `avatars`)](backend/17-avatars.md) | 5KB |
| §18 | [Geurio 일정 (0033 `calendar_events`) — 일정 화면의 두 번째 원천](backend/18-calendar-events.md) | 5KB |
| §19 | [구글 캘린더 연동 (PR5 겹치기 + PR6 쓰기) — 서버 없는 연동](backend/19-google-calendar.md) | 47KB |
| §20 | [홈 부트스트랩 (0036 `home_bootstrap`) + documents SELECT 역할 한정 (0037)](backend/20-home-bootstrap.md) | 4KB |
| §21 | [설치형 데스크톱 앱의 Google 로그인 (Supabase 리다이렉트 한 줄)](backend/21-desktop-google-login.md) | 6KB |
| §22 | [일정 알림 (0038 `calendar_events.reminder_minutes`) — 서버는 보내지 않는다](backend/22-reminders.md) | 16KB |
| §23 | [멘션 메일 (0039 + Edge Function `notify-digest`) — 안 보내는 쪽이 본체](backend/23-mention-mail.md) | 11KB |
| §24 | [멘션 웹 푸시 (0040 `push_subscriptions` + Edge Function `notify-push`)](backend/24-web-push.md) | 8KB |
| §24c | [설치형 앱의 멘션 배너 — 푸시 없이 같은 일을 한다](backend/24c-desktop-mention-banner.md) | 6KB |
| §24b | [처음 배포할 때 실제로 걸린 것들 (2026-09-15 실측)](backend/24b-first-deploy-notes.md) | 5KB |
| §25 | [공책 태그 판 (0042 `note_tags`) — 계정에 딸린 한 벌](backend/25-note-tags.md) | 3KB |
| §26 | [Jira 연결 (0044 `jira_credentials`·`user_tool_prefs` + Edge Function `jira`) — 도구 · 작업 현황](backend/26-jira.md) | 5KB |
| §27 | [공책 페이지별 기록 (0048 `note_history`) — 누가·언제·무엇을 + 페이지 스냅샷](backend/27-note-history.md) | 4KB |

---

## 0. 아키텍처 요약

- `apps/web/src/adapters/ports.ts` — `AuthProvider`/`DocStore` 인터페이스. 앱의 모든
  기능(`features/auth`, `features/home`, `features/editor`)은 이 포트만 알고, 구체
  어댑터를 직접 import하지 않습니다.
- `apps/web/src/adapters/local/` — `LocalAuth`/`LocalDocStore`: localStorage 기반 데모.
  env 미설정 시 기본값. 기존 `mindflow_doc_<id>`/`mf_recent` 키 스킴 그대로.
- `apps/web/src/adapters/supabase/` — `SupabaseAuth`/`SupabaseDocStore`: 실제 Postgres +
  Auth. `@supabase/supabase-js` 사용.
- `apps/web/src/adapters/factory.ts`의 `createBackend()` — env 변수 두 개가 모두 있으면
  Supabase, 하나라도 없으면 Local을 선택합니다. `apps/web/src/adapters/BackendContext.tsx`가
  이를 React Context로 앱 전체에 주입합니다(`App.tsx`의 `<BackendProvider>`).
- `supabase/migrations/0001_init.sql` — `profiles`/`documents` 테이블 + RLS.
  `profiles.display_name`은 LNB 프로필 표시 이름으로 쓰입니다(`SupabaseAuth.getProfileName`/
  `setProfileName`이 본인 행을 조회/업서트, RLS로 소유자 스코프). 가입 시 트리거가
  이메일 로컬파트로 초기화하고, 사용자가 "프로필명 변경"하면 여기에 저장돼 캐시 삭제·
  다기기에서도 유지됩니다. env 미설정(로컬 모드)에선 브라우저 localStorage에만 캐시.
- `supabase/migrations/0004_workspaces.sql` — `workspaces` 테이블(사용자당 1행,
  스페이스/폴더 구조를 `data` JSONB로 저장) + RLS. 사용자별 저장이라 로그인하는 모든
  기기에서 스페이스가 동일하게 보입니다(`SupabaseSpaceStore`). 미적용 시 스페이스는
  기기별 localStorage(`LocalSpaceStore`)로만 유지됩니다.
- `supabase/migrations/0005_delete_account.sql` — 회원 탈퇴용 `delete_account()` RPC.
  클라이언트 키로는 `auth.users`를 지울 수 없어, 로그인 사용자가 호출하는 SECURITY
  DEFINER 함수로 노출합니다. 자기 자신(`auth.uid()`)의 `auth.users` 행을 삭제하며,
  `on delete cascade` FK로 `profiles`/`documents`/`workspaces`가 함께 삭제됩니다
  (`SupabaseAuth.deleteAccount()`가 호출). 미적용 시 로컬/데모 모드는 브라우저의
  MindFlow 저장소를 비우는 것으로 폴백합니다.
- `supabase/migrations/0007_security_advisor.sql` — Security Advisor 경고 정리.
  `set_updated_at`에 `search_path` 고정, 트리거 전용 함수(`handle_new_user`/
  `set_updated_at`)의 직접 EXECUTE 권한 회수(트리거는 권한과 무관하게 발화하므로
  회원가입 자동 프로필 생성은 무영향). 남는 경고 2건은 SQL 대상이 아닙니다: ①
  `delete_account`의 "인증 사용자 실행 가능"은 회원 탈퇴 기능상 의도된 것(`auth.uid()`
  가드로 본인만) ② "Leaked Password Protection Disabled"는 대시보드 Auth 설정 토글
  (Authentication → Sign In / Providers → *Leaked password protection*, HaveIBeenPwned
  대조)로 켭니다.
- `supabase/migrations/0008_email_is_registered.sql` — 비밀번호 찾기용
  `email_is_registered(text)` RPC. `resetPasswordForEmail`은 이메일 열거 방지로 가입
  여부와 무관하게 성공을 돌려줘, 미가입 주소에도 "코드 보냈어요"가 뜨고 메일은 오지
  않았습니다(제보). 이를 막으려 전송 전 가입 여부를 조회하는 SECURITY DEFINER 함수로,
  `auth.users` 존재 여부만 불리언으로 반환합니다(anon/authenticated 실행 허용 — 로그인
  전 흐름이라 anon 필요, `SupabaseAuth.isEmailRegistered()`가 호출). **트레이드오프**:
  이메일 열거를 의도적으로 허용합니다(가입 여부 노출) — 미가입 안내 UX를 위한 결정이며
  다른 정보는 반환하지 않습니다. 미적용 시 RPC 오류→`null`(불명)로 폴백해 기존처럼 전송을
  진행합니다.
- `supabase/migrations/0013_email_signin_providers.sql` — 회원가입용
  `email_signin_providers(text)` RPC. **제보**: Google로 가입한 이메일로 이메일
  회원가입을 시도하면 가입이 진행되는 듯 인증번호 화면까지 넘어가는데 코드는 오지
  않았습니다. `auth.signUp`이 이메일 열거 방지로 이미 가입된 주소에도 성공을 돌려주기
  때문입니다(메일 미발송, 유일한 단서는 `identities`가 빈 배열인 가짜 user). 이 함수는
  가입 시도 **전에** 그 이메일의 로그인 수단(`{google}`/`{email}`/`{}`)을 조회해,
  이미 가입된 계정이면 어떻게 가입했는지까지 안내하고 막는 데 씁니다
  (`SupabaseAuth.emailSignInProviders()`가 호출, anon 실행 허용). 트레이드오프는 0008과
  동일(이메일 열거 허용 — 공급자 이름 외 정보는 반환하지 않음). 미적용 시 RPC 오류→`null`
  (불명)로 폴백하지만, 어댑터가 `identities: []`를 감지해 "이미 가입된 이메일"로 막으므로
  인증 코드 화면으로 넘어가지는 않습니다.
- **반대 방향도 막습니다(제보)**: ① 이메일로 A@…를 가입한 뒤 ② 같은 주소로 Google
  로그인을 하면, Supabase가 **같은 이메일의 Google 신원을 그 계정에 자동 연결**해
  한 계정에 로그인 수단이 둘 붙었습니다(동일 이메일·인증된 계정의 기본 동작이며
  대시보드 토글이 없습니다). 사용자가 만들지 않은 두 번째 출입구이므로 위 이메일
  가입 차단과 **대칭**으로 거절합니다 — 규칙은 `features/auth/googleLink.ts` 한 곳:
  세션의 `app_metadata`에서 **이번 로그인 수단**(`provider`)이 google이고 **연결된
  수단**(`providers`)에 email이 있으면 거절. 그래서 두 수단이 이미 연결된 계정의
  주인이 **비밀번호로** 들어오는 것은 막지 않습니다(막으면 계정을 잃습니다).
  거절 지점은 진입 경로마다 다릅니다:
  - **GIS 토큰 방식**(`signInWithIdToken`): 교환 **전에** ID 토큰의 `email` 클레임으로
    `email_signin_providers`를 물어 이메일 전용 계정이면 교환하지 않습니다(연결 자체가
    생기지 않습니다 — 가장 깨끗한 차단). 토큰을 못 읽거나 RPC 확인 불가면 막지 않고
    교환 뒤 아래 안전망이 받습니다.
  - **리다이렉트 방식**(`signInWithOAuth`, 현재 로그인 버튼): 돌아온 시점에 이미 세션이
    있어 **사전 확인이 불가능**합니다. 문지기(`RequireAuth`)가 그 세션을 보고 거절
    (로그아웃 + 로그인 화면 안내)합니다. **한계**: DB에는 연결된 신원이 남습니다 —
    로그인 문이 닫히는 것이고, 신원 해제(unlink)는 하지 않습니다.
- 마이그레이션은 표준 위치 **`supabase/migrations/`**(+ 루트 `supabase/config.toml`)에
  둡니다 — Supabase의 GitHub 연동이 이 경로를 찾아, `main`(프로덕션 브랜치) 머지 시
  새 마이그레이션을 자동 적용하고 PR마다 프리뷰 DB 브랜치를 만듭니다(아래 §1a).

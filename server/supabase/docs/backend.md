# MindFlow 백엔드 — Supabase 프로비저닝 가이드 (M4)

이 문서는 `apps/web`이 데모(localStorage) 대신 실제 Supabase 백엔드를 쓰도록 켜는 절차를
설명합니다. **이 개발 환경에는 실제 Supabase 프로젝트가 없습니다** — 아래 절차는 사람이
실제 Supabase 콘솔/CLI로 수행해야 하는 단계이며, 이 리포의 테스트는 전부 모의(in-memory/
mocked) 어댑터로 검증되었습니다(라이브 호출 없음).

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
- 마이그레이션은 표준 위치 **`supabase/migrations/`**(+ 루트 `supabase/config.toml`)에
  둡니다 — Supabase의 GitHub 연동이 이 경로를 찾아, `main`(프로덕션 브랜치) 머지 시
  새 마이그레이션을 자동 적용하고 PR마다 프리뷰 DB 브랜치를 만듭니다(아래 §1a).

## 1. 프로비저닝 체크리스트 (사람이 할 일)

1. **Supabase 프로젝트 생성** — https://supabase.com/dashboard 에서 새 프로젝트 생성
   (리전은 사용자 지리에 가까운 곳). 프로젝트가 준비되면 다음을 확인해 둡니다:
   - `Project Settings → API`의 **Project URL**과 **anon public key**
   - `Authentication → Providers`에서 Email(기본 활성)과 필요 시 **Google** OAuth를
     활성화 (Google Cloud Console에서 OAuth 클라이언트 ID/secret 발급 후 등록,
     redirect URI는 Supabase가 제공하는 `https://<project>.supabase.co/auth/v1/callback`)
   - `Authentication → URL Configuration`에 앱의 실제 배포 URL(예:
     `https://your-app.example.com`)을 **Site URL**/**Redirect URLs**에 등록 —
     `SupabaseAuth`의 `signInWithOAuth`/`sendPasswordReset`이 `window.location.origin`
     기준으로 `/home`, `/login` 리다이렉트 URL을 구성합니다(`adapters/supabase/supabaseAuth.ts`).
2. **마이그레이션 적용** — 아래 중 하나:
   ```bash
   # Supabase CLI (권장)
   supabase link --project-ref <project-ref>
   supabase db push

   # 또는 psql 직접 연결 (마이그레이션을 순서대로 모두 적용)
   psql "$DATABASE_URL" -f supabase/migrations/0001_init.sql
   psql "$DATABASE_URL" -f supabase/migrations/0002_documents_id_text.sql
   psql "$DATABASE_URL" -f supabase/migrations/0003_documents_owner_default.sql
   psql "$DATABASE_URL" -f supabase/migrations/0004_workspaces.sql
   psql "$DATABASE_URL" -f supabase/migrations/0005_delete_account.sql
   psql "$DATABASE_URL" -f supabase/migrations/0006_profile_name_from_oauth.sql
   psql "$DATABASE_URL" -f supabase/migrations/0007_security_advisor.sql
   ```
   `server/supabase/seed/seed.sql`은 선택 사항(로컬 개발용 샘플 문서 1건 삽입 — 실제
   `auth.users` id로 치환 필요, 파일 내 주석 참고).
   > 모든 마이그레이션은 `create ... if not exists` / `drop policy if exists` +
   > `create policy` / 가드된 `do $$` 블록으로 **재실행 안전(idempotent)** 하게
   > 작성되어 있어, 이미 수동 적용된 DB에 GitHub 연동이 다시 push해도 오류 없이
   > 통과합니다(같은 정책/트리거를 재생성만 함).

### 1a. GitHub 연동 (선택 — 마이그레이션 자동 배포)

Supabase 대시보드의 **Integrations → GitHub**로 이 레포를 연결하면:
- `main` 머지 시 `supabase/migrations/`의 새 마이그레이션을 프로덕션 DB에 자동 적용.
- PR마다 격리된 프리뷰 DB 브랜치 생성(스키마 변경을 프로덕션과 분리 검증).

연동은 레포 루트의 `supabase/config.toml` + `supabase/migrations/`를 기준으로 동작하며,
이 레포는 그 표준 구조를 따릅니다(`config.toml`의 `project_id`는 프로젝트 ref로,
공개 값이며 비밀이 아님).

**이미 수동 적용한 DB에서 연동을 처음 켤 때**: 연동은 원격 `supabase_migrations.schema_migrations`
기록과 비교하는데, 수동 적용은 그 기록을 남기지 않으므로 0001~0004를 다시 push하려
합니다. 위 idempotent 설계 덕분에 그대로 두어도 무해하게 통과합니다. 재실행 자체를 건너뛰고
싶다면 CLI로 한 번만 기록을 맞추세요:
```bash
supabase migration repair --status applied 0001 0002 0003 0004
```
3. **env 설정** — `apps/web/.env.example`을 복사해 `apps/web/.env.local`(또는 배포
   플랫폼의 환경변수)에 실제 값 채우기:
   ```
   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon public key>
   ```
   **`.env.local`은 커밋하지 않습니다** (`.gitignore`에 `*.env.local`/`.env*.local` 포함
   여부를 확인하세요 — 아직 없다면 추가하세요).
4. **재시작/재빌드** — Vite는 `VITE_*` env를 빌드 타임에 정적으로 치환하므로, env를
   바꾼 뒤에는 `pnpm --filter @mindflow/web dev`(또는 `build`)를 새로 시작해야 반영됩니다.
5. **확인** — 앱을 열어 `/login`에서 실제 이메일로 가입 → (프로젝트 설정에 따라) 이메일
   확인 링크 클릭 → 로그인 → `/home`에서 맵을 만들고 새로고침해도 유지되는지 확인.
   Supabase 콘솔의 `Table Editor → documents`에서 실제 행이 생기는지 확인하세요.

## 1b. Google OAuth 로그인 — 상세 설정 절차 (검증 완료)

> 2026-07 실제 설정으로 검증된 절차. 코드는 이미 구현되어 있어(포트
> `signInWithOAuth('google')` → `SupabaseAuth` → 로그인 화면의 "Google 계정으로
> 계속하기" 버튼) **아래 콘솔 설정만 하면 동작**합니다.

### ① Google Cloud Console (console.cloud.google.com)

1. **새 프로젝트** 생성 (예: `Geurio`) — 이후 모든 설정 전에 상단 드롭다운에서
   이 프로젝트가 선택돼 있는지 확인 (다른 프로젝트에 설정하는 게 최다 실수).
2. **API 및 서비스 → OAuth 동의 화면** (최근 UI에선 "Google Auth Platform"):
   - 앱 이름 `Geurio`, 지원/연락처 이메일, 대상(Audience)은 **외부(External)**
   - 범위(Scopes)는 기본값 그대로 (email/profile은 추가 설정 불필요)
   - **테스트 사용자**에 로그인 테스트할 구글 계정 추가 — 테스트 모드에선
     등록된 계정만 로그인 가능 (미등록 계정은 "액세스 차단됨")
3. **사용자 인증 정보 → OAuth 클라이언트 ID** 생성:
   - 유형: **웹 애플리케이션** (Capacitor 앱도 Supabase 경유라 이거 하나면 됨)
   - 승인된 자바스크립트 원본: 비워도 됨
   - **승인된 리디렉션 URI** (가장 중요 — 반드시 복사-붙여넣기):
     Supabase 대시보드 `Authentication → Sign In / Providers → Google` 화면에
     표시되는 **Callback URL** 그대로:
     `https://<project-ref>.supabase.co/auth/v1/callback`
     (한 글자만 달라도 `redirect_uri_mismatch` — 끝 슬래시 금지, https 확인)
4. 발급된 **Client ID**(`...apps.googleusercontent.com`)와 **Client Secret**
   (`GOCSPX-...`) 복사. Secret은 Supabase 대시보드에만 붙여넣고 코드/커밋 금지.

### ② Supabase 대시보드

1. `Authentication → Sign In / Providers → Google` 활성화 → Client ID/Secret
   붙여넣기 → Save
2. `Authentication → URL Configuration`:
   - **Site URL** = 배포 도메인
   - **Redirect URLs**에 `https://<배포도메인>/home` 과 로컬 개발용
     `http://localhost:5173/home` 추가 — 코드의 `redirectTo`가 `{origin}/home`
     이라 허용 목록에 있어야 통과

### ③ 동작 방식 (코드 쪽, 참고)

- **가입/로그인 구분 없음** — 최초 OAuth 로그인 시 Supabase가 계정을 자동 생성.
- **`prompt=select_account`** 를 항상 전달(`supabaseAuth.ts`) — 없으면 최초
  동의 후 구글이 계정 선택 없이 즉시 로그인해 계정 전환이 불가능해짐.
- **실명/아바타**: 세션 `user_metadata`(full_name/avatar_url)가 프로필 UI에
  반영됨. `profiles.display_name` 기본값도 구글 실명을 따르도록 마이그레이션
  0006이 트리거를 갱신 + 기존 OAuth 사용자를 백필(직접 개명한 프로필은 보존).
- **일반 사용자 오픈 시**: 동의 화면을 테스트 모드에서 **게시(Publish)** 로 전환
  (email/profile 기본 범위만 쓰므로 별도 심사 없음).

## 1c. 로컬 개발 PC에서 실 백엔드 연결 (Windows 포함)

1. **Node LTS + pnpm**: `node -v`(20/22 권장) 확인 후 `corepack enable`
   (또는 `npm i -g pnpm@10`). 리포의 `packageManager: pnpm@10.33.0`이 버전을
   고정하므로 corepack이 첫 실행 때 정확한 버전을 받음(`Y`로 승인).
   - Windows에서 `pnpm.ps1 ... 스크립트를 실행할 수 없으므로` 에러 →
     `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` 한 번 실행.
   - `corepack enable`이 EPERM → 관리자 PowerShell에서 한 번 실행.
2. **env 파일**: `apps/web/.env.example`을 복사해 **`apps/web/.env.local`**
   생성(리포 루트 아님!) 후 값 채우기 — 둘 다 있어야 Supabase 모드:
   ```
   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<publishable key>
   ```
   - 키는 `Project Settings → API Keys`의 **Publishable key**
     (`sb_publishable_...`) — 신형 키 이름이며 레거시 `anon` 키와 동등.
     변수명은 역사적 이유로 `ANON_KEY` 그대로. **`sb_secret_...`은 절대 금지.**
   - 메모장이 `.env.local.txt`로 저장하는 함정 주의. 값에 따옴표/공백 금지.
3. **코어 선빌드** (fresh clone 1회):
   `pnpm --filter @mindflow/mindmap-core build`
   — `apps/web`은 코어의 `dist/`를 참조하므로, 없으면
   `Failed to resolve entry for package "@mindflow/mindmap-core"` 에러.
4. `pnpm install` → `pnpm -C apps/web dev` → `http://localhost:5173`.
   env 파일을 고쳤다면 dev 서버 재시작 필수(시작 시 1회만 읽음).

### 트러블슈팅

| 증상 | 원인/해결 |
| --- | --- |
| 구글 버튼 클릭 시 구글 화면 없이 즉시 로그인 | env 미적용 = 데모 모드. 프로필 이메일이 `demo-google@mindflow.local`이면 확정. §1c-2/4 점검 |
| `redirect_uri_mismatch` | ①-3 리디렉션 URI가 Supabase Callback URL과 불일치 |
| `액세스 차단됨: 확인되지 않은 앱` | 테스트 사용자 미등록(①-2) 또는 게시 필요 |
| env가 안 읽힘 | 파일 위치(`apps/web/`)·이름(`.txt` 없음)·재시작 여부, 콘솔에서 `import.meta.env.VITE_SUPABASE_URL` 확인 |
| `Failed to resolve entry ... mindmap-core` | 코어 미빌드 — §1c-3 |


## 1d. GIS 직접 연동 — 동의 화면의 supabase.co 표시 제거

> 문제: §1b의 리다이렉트 흐름은 구글 동의 화면에 콜백 도메인
> `<project-ref>.supabase.co`를 노출한다(우리 소유가 아니라 브랜드 인증도 불가).
> 해결: 로그인 페이지가 **Google Identity Services(GIS) 공식 버튼**을 우리
> 도메인에서 직접 렌더 → 받은 ID 토큰을 `auth.signInWithIdToken()`으로 교환.
> OAuth 교환 전체가 우리 origin에서 일어나 supabase.co가 등장하지 않는다.

### 활성 조건과 폴백 (코드 쪽)

- `VITE_GOOGLE_CLIENT_ID`(①-4의 **Client ID** — Secret 아님!)가 설정되고
  Supabase 모드일 때만 GIS 버튼이 뜬다. 미설정/데모 모드/스크립트 차단(광고
  차단기·오프라인)이면 **기존 리다이렉트 버튼으로 자동 폴백** — 로그인이 깨지는
  일은 없고, 동의 화면에 supabase.co가 보이는 원래 동작으로 돌아갈 뿐이다.
  (`features/auth/GoogleSignInButton.tsx` / `googleIdentity.ts`)
- nonce 재사용 방지: GIS에는 SHA-256 해시를, Supabase에는 원본 nonce를 전달
  (Supabase가 재해시해 토큰 클레임과 대조).
- Supabase 대시보드 쪽 추가 설정은 **없음** — 토큰 audience 검증에 쓰는 Client
  ID는 §1b-②에서 이미 등록한 값 그대로다.

### 콘솔 설정 (사람이 할 일)

1. Google Cloud Console → 사용자 인증 정보 → 기존 OAuth 클라이언트 →
   **승인된 JavaScript 원본** 추가(GIS 필수 — ①-3의 "비워도 됨"은 리다이렉트
   흐름 한정):
   - `https://geurio.com` (+ `https://www.geurio.com` 사용 시 함께)
   - `http://localhost:5173` 과 `http://localhost` (로컬 개발용 — 구글 권고)
   - 기존 **승인된 리디렉션 URI는 지우지 말 것** (폴백 흐름이 계속 사용)
2. env에 Client ID 추가 — 로컬 `apps/web/.env.local`과 Vercel(Settings →
   Environment Variables) 양쪽:
   ```
   VITE_GOOGLE_CLIENT_ID=<...>.apps.googleusercontent.com
   ```
   Client ID는 공개값(모든 번들에 포함)이라 커밋 외 노출은 무해. Secret은 여전히
   Supabase 대시보드 전용.

### 브랜드 인증 (동의 화면에 "Geurio" 표시)

GIS 적용 후 동의 화면은 우리 origin(geurio.com)을 표시한다. 도메인 대신 앱
이름이 표시되게 하려면 브랜드 인증까지:

1. [Search Console](https://search.google.com/search-console)에서 `geurio.com`
   소유 확인(DNS TXT — Vercel에서 도메인 구입 시 Vercel DNS에 추가).
2. Google Auth Platform → **Branding**: 앱 이름 `Geurio`, 로고
   (배포 사이트의 `/brand/geurio-logo-120.png`, 120×120), 홈페이지
   `https://geurio.com`, 개인정보처리방침 `https://geurio.com/privacy`,
   이용약관 `https://geurio.com/terms`, 승인된 도메인 `geurio.com`.
3. 게시(Publish) 후 로고 업로드가 트리거하는 **인증 제출** — email/profile
   범위만 쓰므로 브랜드 확인만 받으면 됨(며칠~수 주, 보완 요청은 이메일로 옴).

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

## 4. 알려진 스코프 컷 (M4 시점)

- **비밀번호 재설정(`resetPw`)은 Supabase 모드에서도 여전히 클라이언트 시뮬레이션입니다.**
  `sendReset()`은 실제로 `auth.sendPasswordReset(email)`을 호출해 이메일을 보내지만,
  이후 "6자리 코드 확인 → 새 비밀번호 저장" 단계는 실제 Supabase 복구 세션
  (`verifyOtp('recovery')` → `updatePassword`)을 사용하지 않습니다 — 실제 프로젝트로
  라이브 검증할 수 없는 이 환경에서 정확한 흐름(매직링크 vs OTP, 리다이렉트 파라미터
  파싱 등)을 확정하는 것은 M4 스코프를 벗어난다고 판단했습니다. 다음 단계 후보:
  `/login`이 Supabase의 recovery 리다이렉트(`#access_token=...&type=recovery`)를 감지해
  `resetPw`가 `auth.updatePassword`를 실제로 호출하도록 마무리.
- **실시간 협업(Yjs/CRDT)·awareness(커서 공유)는 이후 M5/M5-awareness에서 구현되었습니다**
  (이 문서는 M4 시점 작성). **프로비저닝 관점에서 중요한 점: 실시간에는 추가 DB 스키마가
  필요 없습니다.** 웹 전송 계층(`apps/web/src/collab/`)이 **Supabase Realtime의 broadcast
  채널**(`mindflow-collab:<docId>`)로 Y.Doc 업데이트/awareness를 릴레이하며 — 이는 클라이언트
  간 릴레이라 `postgres_changes` 리플리케이션 설정도, 신규 테이블도 요구하지 않습니다.
  Supabase Realtime은 프로젝트 기본값으로 켜져 있으므로, 위 §1의 스키마/Auth 프로비저닝만
  마치면 다중 편집·커서 공유가 동작합니다. (단일 사용자/미설정 시 무회귀: `collab/factory.ts`가
  env 게이트로 Noop/BroadcastChannel 폴백.) `documents.data`(JSONB)는 영속 스냅샷 저장소로
  계속 쓰이고, 실시간 상태는 Y.Doc/awareness가 담당합니다.
- **문서 스냅샷/버전 이력 테이블**(`document_snapshots`)은 이번 마이그레이션에 포함하지
  않았습니다 — `version` 낙관적 잠금만 우선 구현. 복원 UI가 필요해지면 별도 마이그레이션으로.

## 5. Yjs/CRDT 도입 지점 (2단계, 설계만)

지금 코드를 짜지는 않지만, 다음 경계가 이미 준비되어 있습니다:

- `DocStore.save(id, doc, { prevVersion })`의 낙관적 잠금(LWW)은 "마지막에 저장한 사람이
  이긴다" 방식입니다. 진짜 동시 편집(같은 문서를 여러 사람이 동시에)을 지원하려면 이
  `save()`/`load()` 왕복을 Y.Doc 업데이트 브로드캐스트로 교체해야 합니다.
- `documents.data` JSONB는 그대로 Y.Doc → `DocV1` 스냅샷의 "체크포인트" 저장소로 재사용
  가능합니다(실시간 상태는 Y.Doc/awareness가, 영속 상태는 기존 테이블이 담당).
- 전송 계층 후보: Supabase Realtime(브로드캐스트 채널)로 Y.Doc 업데이트를 릴레이하거나,
  별도 `y-websocket` 서버. 어느 쪽이든 `apps/web/src/adapters/` 안에 `YjsDocStore` 같은
  새 어댑터로 캡슐화하면 `features/editor`는 변경 없이 소스만 교체됩니다(포트 설계의
  목적이 바로 이것입니다).
- `packages/mindmap-core`에는 아직 CRDT 관련 코드가 없습니다(ADR-0001 §2의 `crdt/`
  디렉터리는 스켈레톤 상태) — Y.Doc ↔ `DocV1` 매핑 함수가 필요해지면 그 시점에 코어에
  순수 함수로 추가하고, 실제 Y.Doc 인스턴스/네트워크는 여전히 `apps/web`이 소유합니다
  (코어 순수성 원칙 유지).

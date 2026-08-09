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
   psql "$DATABASE_URL" -f supabase/migrations/0008_email_is_registered.sql
   psql "$DATABASE_URL" -f supabase/migrations/0013_email_signin_providers.sql
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

## 1e. 이메일 회원가입 인증 (커스텀 SMTP + OTP 템플릿)

> 이메일/비밀번호로 가입하면 Supabase 기본 설정은 **확인 메일**을 보내고, 앱은
> 확인 단계에서 **6자리 코드(OTP)** 를 입력받아 `auth.verifyOtp(..., 'signup')`으로
> 검증한다(`features/auth/VerifyStep.tsx`). 그런데 두 가지 기본값이 이 흐름을
> 막는다: ① Supabase **기본 메일 발송은 시간당 수 통 제한 + 스팸 분류**라 실제로
> 잘 도착하지 않고, ② 기본 "Confirm signup" 템플릿은 **매직링크(`{{ .ConfirmationURL }}`)**
> 만 담아 6자리 코드가 메일에 없다. 아래 두 가지를 설정해야 가입 인증이 동작한다.

### ① 커스텀 SMTP 연결 (메일이 실제로 도착하게)

대시보드 → **Project Settings → Authentication → SMTP Settings** → *Enable Custom SMTP*.
발송 서비스는 아무거나 되지만 [Resend](https://resend.com)가 무료 티어(월 3,000통) +
연동이 쉬워 권장:

1. Resend 가입 → **도메인 인증**: Resend → *Domains* → Add `geurio.com` → 화면이
   보여주는 **SPF·DKIM 레코드를 Vercel DNS에 그대로 추가**(Vercel → 프로젝트 →
   Settings → Domains → geurio.com → DNS Records). 인증되면 `no-reply@geurio.com`
   발신 가능. (도메인 없이 테스트만이면 `onboarding@resend.dev` 발신도 되지만
   프로덕션은 도메인 인증 필수 — 안 하면 스팸 분류/거부된다.)
2. **DMARC 추가**(프로덕션 필수 — Gmail/Yahoo가 요구). Vercel DNS에 TXT:
   ```
   Name: _dmarc     Value: v=DMARC1; p=none; rua=mailto:dmarc@geurio.com
   ```
   며칠 정상 도착 확인 후 `p=none` → `p=quarantine`으로 조인다.
3. Resend → **API Keys**에서 키 발급.
4. Supabase SMTP Settings에 입력:
   - Host `smtp.resend.com`, Port `465`(SSL) 또는 `587`(STARTTLS)
   - Username `resend`, Password = **Resend API 키**
   - Sender email `no-reply@geurio.com`(인증된 도메인), Sender name `Geurio`
5. (선택) Authentication → Rate Limits에서 이메일 발송 한도를 필요에 맞게 상향.

> **왜 Gmail/Workspace SMTP가 아니라 Resend인가**: 구글 메일(무료 Gmail·Workspace)은
> 사람이 쓰는 메일함이지 앱 자동발송용이 아니다 — 딜리버리(스팸)·발송 한도·발신 주소
> (무료 Gmail은 `@gmail.com`만)·ToS(자동발송 제한) 모두 프로덕션에 불리하다. Resend는
> 트랜잭션 메일 전용이라 이 용도에 최적.

> Resend API 키는 **비밀값** — Supabase 대시보드에만 입력하고 저장소·커밋·클라이언트에
> 절대 넣지 않는다(`service_role`/Client Secret과 동일 취급).

### ② 이메일 템플릿을 코드(OTP) 방식으로 교체 (앱의 입력과 일치)

앱은 매직링크가 아니라 **6자리 코드(OTP)** 를 입력받으므로, **두 템플릿 모두** `{{ .Token }}`을
써야 한다. 대시보드 → **Authentication → Emails**.

> ⚠️ **기본 템플릿에 "추가"하지 말고 본문 전체를 교체**할 것. Supabase 기본 템플릿은
> 영문 안내 + 매직링크(`{{ .ConfirmationURL }}`)라, 코드 줄만 덧붙이면 영문 문구·링크가
> 남아 지저분하고 흐름도 뒤섞인다(우리는 코드 입력 방식). `{{ .ConfirmationURL }}`은
> 넣지 않는다. 쓰는 변수는 `{{ .Token }}` 하나면 충분. 코드 기본 만료는 1시간.
>
> 템플릿 HTML = 메일 본문 그 자체(Supabase가 주변 문구를 덧붙이지 않음).

**"Confirm signup"** — Subject: `Geurio 가입 인증 코드`
```html
<div style="font-family:'Apple SD Gothic Neo','Malgun Gothic',system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#33281f">
  <h1 style="font-size:20px;font-weight:800;margin:0 0 8px">Geurio 가입을 확인해 주세요</h1>
  <p style="font-size:14px;color:#8a7365;line-height:1.7;margin:0 0 24px">아래 6자리 인증 코드를 가입 화면에 입력하면 가입이 완료됩니다.</p>
  <div style="font-size:32px;font-weight:800;letter-spacing:8px;color:#f0663f;text-align:center;background:#fdeee7;border-radius:12px;padding:18px 0;margin:0 0 24px">{{ .Token }}</div>
  <p style="font-size:12.5px;color:#9c8b7e;line-height:1.7;margin:0">이 코드는 1시간 후 만료됩니다. 본인이 요청하지 않았다면 이 메일을 무시하세요.</p>
  <hr style="border:none;border-top:1px solid #ecdfd5;margin:28px 0 16px" />
  <p style="font-size:12px;color:#b6a596;margin:0">© Geurio (그리오)</p>
</div>
```

**"Reset Password"** — Subject: `Geurio 비밀번호 재설정 코드`
```html
<div style="font-family:'Apple SD Gothic Neo','Malgun Gothic',system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#33281f">
  <h1 style="font-size:20px;font-weight:800;margin:0 0 8px">비밀번호 재설정 코드</h1>
  <p style="font-size:14px;color:#8a7365;line-height:1.7;margin:0 0 24px">아래 6자리 코드를 비밀번호 찾기 화면에 입력하고 새 비밀번호를 설정하세요.</p>
  <div style="font-size:32px;font-weight:800;letter-spacing:8px;color:#f0663f;text-align:center;background:#fdeee7;border-radius:12px;padding:18px 0;margin:0 0 24px">{{ .Token }}</div>
  <p style="font-size:12.5px;color:#9c8b7e;line-height:1.7;margin:0">이 코드는 1시간 후 만료됩니다. 본인이 요청하지 않았다면 비밀번호는 그대로 유지되니 안심하세요.</p>
  <hr style="border:none;border-top:1px solid #ecdfd5;margin:28px 0 16px" />
  <p style="font-size:12px;color:#b6a596;margin:0">© Geurio (그리오)</p>
</div>
```

### ③ 앱 코드 쪽 (이미 구현됨 — 참고)

대시보드만 맞추면 되고 추가 작업은 없다. Supabase 모드에서:

- **회원가입 인증**: `verifyOtp(..., 'signup')`으로 코드 검증. "다시 보내기"는
  `auth.resend({ type: 'signup' })` 실제 호출.
- **비밀번호 찾기 인증**: 이메일의 코드로 `verifyOtp(..., 'recovery')` → 복구 세션 확립 →
  `updatePassword(새 비번)`. 성공 시 그대로 로그인 상태로 홈 이동. "다시 보내기"는
  `sendPasswordReset` 재발송(`features/auth/useLoginController.ts`의 `resetPw`/`resendCode`).
- 두 인증 화면 모두 **데모 코드 힌트 박스는 로컬/데모 모드에서만** 노출(Supabase 모드엔
  실제 메일 코드를 입력하므로 숨김).
- 로컬/데모 모드(env 미설정)에선 서버가 없어 화면의 데모 코드로 시뮬레이션한다.

### (대안) 인증을 아예 받지 않으려면

가장 간단: Authentication → Sign In / Providers → Email → **"Confirm email" 토글 OFF**.
그러면 가입 즉시 세션이 생기고 앱도 이를 그대로 처리한다(`signUp`의 `needsVerification`이
false가 되어 verify 단계를 건너뜀). 단 이메일 소유 확인은 안 된다.

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

## 6. 문서 공유 (0009) — 사람 사이의 실시간 공동 편집

M5/M5-awareness가 Yjs 동기화와 커서 공유를 붙였지만, **`documents`가 소유자 전용이라
다른 사람과는 공동 편집이 불가능했습니다** — 상대가 문서를 아예 읽을 수 없으니 협업할
대상이 없었죠. `0009_document_shares.sql`이 그 구멍을 메웁니다.

- **`document_shares`** — `(document_id, invitee_email)` PK, `role`(`edit`/`view`),
  `invited_by`. 초대 대상이 uuid가 아니라 **이메일**인 이유: 클라이언트는 `auth.users`를
  읽을 수 없어 이메일 → uuid 변환을 할 수 없고, 이메일로 두면 **아직 가입하지 않은
  사람도 초대**할 수 있습니다(그 이메일로 가입하는 순간 권한이 생김). 트리거가 항상
  `lower(trim())`으로 정규화합니다.
- **`documents` 정책 확장** — SELECT는 `소유자 OR 공유(view 이상)`, UPDATE는
  `소유자 OR 공유(edit)`. INSERT/DELETE는 소유자 전용 그대로.
- **순환 방지** — `documents` 정책이 `document_shares`를 참조하고 그 반대도 필요하므로,
  판정을 `owns_document()` / `shared_with_me()` **SECURITY DEFINER** 함수로 빼서 정책
  재귀를 끊었습니다.
- **Realtime 채널 인증(중요)** — 문서 내용은 `mindflow-collab:<docId>` 브로드캐스트
  채널을 흐르는데 **여기에 아무 인증이 없었습니다**. anon 키는 클라이언트 번들에 공개돼
  있으므로 docId를 아는 사람은 누구나 붙어 편집 내용을 받아 보거나 주입할 수 있었습니다
  (특히 예전 방식 id는 `m<제목해시>` — 제목만 알면 계산됩니다). 0009가 `realtime.messages`에
  RLS를 걸어 채널 참가(SELECT)와 발신(INSERT)을 문서 권한과 묶고, 클라이언트는
  `channel(name, { config: { private: true } })`로 붙습니다.

  ⚠️ **`realtime` 스키마는 우리 소유가 아닙니다.** 마이그레이션 실행 역할에 권한이 없으면
  이 블록만 실패하는데, 그때 배포 전체가 막히지 않도록 예외를 잡아 NOTICE만 남깁니다.
  **그 경우 채널은 예전처럼 열린 상태로 남습니다.**

  **수동 적용 절차 (실 프로젝트에서 검증됨, 2026-07)** — SQL Editor는 `postgres`로 돌고
  `realtime.messages`의 소유자는 `supabase_realtime_admin`이라, 0009의 `do` 블록을
  SQL Editor에 그대로 붙여 넣으면 **예외 가드가 오류를 삼켜 "Success"처럼 보이지만
  아무것도 적용되지 않습니다.** 실제로 필요한 건 이것뿐입니다:
  1. `alter table … enable row level security`는 **실행하지 않는다** — 소유자가 아니라
     `must be owner of table messages`(42501)로 실패하고, 최신 프로젝트는 애초에 RLS가
     이미 켜져 있다(`select relrowsecurity from pg_class where
     oid = 'realtime.messages'::regclass;` → `t`).
  2. 0009 마지막 블록에서 **`create policy` 두 개(+ 앞의 `drop policy if exists`)만**
     꺼내 SQL Editor에서 실행한다 — 정책 생성은 `postgres`로도 통과한다.
  3. 확인: `select policyname from pg_policies where schemaname='realtime';`에
  `collab_channel_read`/`collab_channel_write`가 보이면 적용된 것입니다. 두 계정의
  탭을 새로고침해 우상단 경고 아이콘이 사라졌는지도 확인하세요.

  **정책이 없으면 어떻게 되는지(그리고 왜 조용히 죽지 않는지)** — private 채널은 서버
  정책이 없으면 **구독 자체가 거부**되고, 그러면 문서 동기화·접속자·커서가 **한꺼번에**
  죽습니다(전부 같은 채널을 씁니다). 실제로 배포 후 그렇게 터졌고, 아무도 구독 상태를
  보지 않아 화면상 "혼자 있는 것"과 구분되지 않았습니다. 그래서 클라이언트
  (`collab/SupabaseRealtimeProvider.ts`)는 이제:
  1. private으로 붙고, 구독 전 `realtime.setAuth()`를 **await**해 소켓에 사용자 JWT를
     실어 줍니다. (기다리지 않던 시절엔 토큰이 늦게 실리는 레이스로 **한 탭만** 폴백해
     한쪽은 private·한쪽은 public에 앉았고 — 같은 이름이어도 두 모드는 서로 메시지가
     오가지 않아 — 협업이 조용히 죽었습니다.)
  2. 구독이 거부되면 private을 **한 번 재시도**한 뒤 **공개 채널로 폴백**합니다 —
     협업이 통째로 죽는 것보다 낫지만, 상태를 `connected-insecure`로 올려 보내 에디터
     우상단에 경고 아이콘이 뜨고 콘솔에 실패 사유와 조치 방법(이 문단)을 남깁니다.
  3. 구독은 되지만 **발신만 거부**되는 조합(읽기 정책만 적용된 경우)도 잡습니다 —
     `broadcast: { ack: true }`로 서버 확인을 받아, 첫 sync-request가 **명시적 오류**로
     ack되면 같은 폴백을 탑니다. ack가 단순히 늦거나 오지 않는 것(timed out)은 강등
     사유가 아닙니다 — 그걸로 강등하면 정책이 멀쩡한 서버에서도 전원이 공개 채널로
     떨어집니다(실제 그랬습니다).
  4. 공개 채널로도 못 붙으면 `offline` — 우상단에 "실시간 연결 끊김"이 뜹니다.
  5. **메시지 유실 자가 치유** — Realtime은 끊긴 동안의 브로드캐스트를 재전송하지
     않는데, Yjs 업데이트는 증분이라 하나를 놓치면 이후 업데이트 전부가 보류됩니다
     (커서는 절대 상태라 저절로 복구 — 그래서 "커서는 보이는데 편집만 안 온다"는
     증상이 됩니다). 각 클라이언트가 15초마다 상태 벡터(`ysv`)를 방송하고, 받은 쪽이
     빠진 연산만 diff로 돌려줘 한 주기 안에 메워집니다(삭제는 상태 벡터에 안 잡히므로
     diff의 delete set이 함께 나릅니다). join 밖에서는 send하지 않습니다 — 예전엔
     realtime-js가 REST로 우회 전송해 콘솔 스팸("falling back to REST API")과 반쪽
     발신을 만들었습니다.

  디버깅 팁: 콘솔 첫 줄의 `[geurio] build <시각>`으로 지금 어느 빌드가 떠 있는지 확인할
  수 있습니다. PWA는 에디터가 열려 있는 동안 업데이트를 미루므로, "고쳤다는데 그대로"의
  절반은 이전 번들이었습니다 — 모든 탭을 닫았다 다시 열면 새 빌드가 적용됩니다.

  즉 정책을 적용하지 않아도 공동 편집은 동작하지만(공개 채널), 그동안은 docId를 아는
  사람이 끼어들 수 있습니다. 경고가 보이면 위 `do` 블록을 실행하세요.
- **권한 UI는 `edit`만** 노출합니다. `view`는 컬럼·정책에 준비돼 있지만, 뷰어를 제대로
  만들려면 CRDT로 자기 편집이 상대에게 전파되는 것부터 막아야 해서 별도 작업입니다.
- 어댑터: `adapters/supabase/supabaseShareStore.ts`(실제), `adapters/local/localShareStore.ts`
  (데모 — 목록 계약만 동일하게 유지하고 실제 접근은 열어 주지 않습니다).

## 7. 홈 썸네일 본문 (0012 `preview_doc`) — egress 절감

- **왜**: 이미지 첨부는 문서 `data` jsonb 안에 base64 data URL로 인라인이라, 홈
  썸네일이 문서 전문을 받으면 카드마다 수백 KB~수 MB가 실려 옵니다(무료 5GB/월
  egress 잠식). `preview_doc(doc_id)` RPC는 `nodes.*.img` / `floats[].img` 값만
  `'stripped'`로 바꾼 본문을 돌려줍니다 — 크기 필드는 유지돼 박스 계산이 변하지
  않고, 클라이언트는 이미지 자리에 회색 자리표시자를 그립니다.
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

## 8. 사용자 피드백 (0014 `feedback`) — insert 전용 우편함

홈(프로필 메뉴)·에디터(보기/☰ 메뉴)의 "피드백 보내기" 모달이 쌓는 테이블입니다.
무료 티어로 충분합니다 — 텍스트 행이라 저장량·egress 모두 사실상 0.

- **스키마**: `feedback(id, user_id → auth.users on delete set null, email 스냅샷,
  category(bug/ux/idea/other), message(≤4000자), page, meta jsonb, created_at)`.
  탈퇴해도 내용은 남고 연결만 끊깁니다(수집 목적상 내용이 자산).
- **RLS**: INSERT만, 로그인 사용자, `user_id = auth.uid()` — 위조 불가.
  SELECT/UPDATE/DELETE 정책이 **없어** 일반 사용자는 자기 것도 다시 못 보는
  우편함입니다. **조회는 Supabase Studio**(Table Editor 또는 SQL, 서비스 롤)에서:
  `select created_at, category, page, email, message from feedback order by created_at desc;`
- **클라이언트**: `FeedbackStore` 포트(`adapters/ports.ts`) — Supabase 어댑터는
  위 테이블 insert, 로컬/데모 모드는 localStorage(`mf_feedback`)에 쌓고 모달이
  "실제 전송 안 됨"을 안내합니다. `meta`에 빌드 스탬프·userAgent가 실려 재현
  조사를 돕습니다.
- **배포**: GitHub 연동 자동 마이그레이션. 테이블이 아직 없는 서버에서는 어댑터가
  실패를 사용자 문구("전송 실패, 다시 시도")로 바꾸므로 순서에 안전합니다.

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

## 10. 첨부 이미지 (0016 Storage 버킷 `map-images`)

**왜 옮겼나.** 이미지는 문서 본문(jsonb)에 base64 데이터 URL로 인라인돼 있었다.
첨부 한 장이면 수백 KB라 ① 저장량·egress가 통째로 커지고 ② 실시간 협업에서는
**메시지 크기 한도(무료 250KB)를 넘겨 합류 동기화가 조용히 버려졌다** — 커서는
오는데 편집이 영영 안 오던 그 사고다. 이제 본문에는 `mfimg:<경로>` 참조만 남는다.

**왜 Supabase Storage인가.** 이미 쓰는 프로젝트 안이라 새 벤더·새 키·새 요금제가
없고, 무엇보다 `storage.objects`에 RLS를 걸 수 있어 **문서 권한 헬퍼
(`owns_document`/`shared_with_me`, 0009)를 그대로 재사용**한다 — 이미지 접근 권한이
문서 접근 권한과 자동으로 같아진다(공유하면 같이 보이고, 끊으면 같이 막힌다).
별도 저장소(R2/S3 등)를 쓰면 그 규칙과 서명 발급을 우리가 다시 만들어야 하는데,
이 앱에는 그걸 둘 서버가 없다.

**경로 규칙**: `<document_id>/<uuid>.<ext>`. 첫 조각이 문서 id라서 정책이
`split_part(name, '/', 1)`로 문서를 알아낸다.

**정책 요약** (0016):
| 동작 | 누구 |
| --- | --- |
| select(읽기) | 문서 소유자 또는 초대받은 사람(view 포함) |
| insert(쓰기) | 소유자 또는 **edit** 초대 |
| delete | 소유자만 (문서 영구 삭제 시 앱이 함께 정리) |

버킷은 **비공개**다. 화면에 그릴 때마다 만료 **12시간**짜리 서명 URL을 받고
(`SupabaseImageStore.resolve` → `createSignedUrls`), 만료 전에 11시간마다 다시
받는다(`useImageUrls`).

### 왜 수명이 12시간인가 — 무료 한도는 저장 용량이 아니라 **전송량**에서 먼저 닿는다

서명 URL을 갱신하면 URL 문자열이 바뀌고, 그러면 브라우저·CDN 캐시가 무효화돼 화면의
이미지를 **전부 다시 내려받는다**. 수명이 1시간이던 시절엔 맵을 하루 열어 둔 사용자
한 명이 이미지 10장(2MB)을 열 번 넘게 다시 받아 ≈20MB/일을 태웠다 — 그런 사용자
20명이면 무료 전송량(월 5GB)을 넘긴다. 12시간이면 한 세션에 URL 하나라 사실상
기기당 한 번만 내려받는다. 객체 자체의 `Cache-Control`도 1년으로 길게 준다(경로가
uuid라 같은 경로의 내용이 바뀌지 않는다).

트레이드오프는 **유출된 URL의 유효 시간**이다. 그래서 무한(공개 버킷)으로 가지 않고
12시간에서 끊는다.

**이미지는 WebP로 인코딩한다**(`pickImageFormat`, 지원하지 않는 브라우저는 예전대로
PNG/JPEG). 같은 체감 화질에서 JPEG 대비 실측 **48~60% 작다**(사진풍 55% · 스크린샷풍
48% · 그라디언트 60%) — 저장 용량과 전송량이 함께 절반이 되므로 실질 수용 인원이 약
두 배가 된다.

### 한도에 가까워지면

| 한도(무료) | 대략 감당 | 다음 수 |
| --- | --- | --- |
| 저장 1GB | 이미지 약 1만 장(WebP 기준) | Pro(100GB) |
| 전송 5GB/월 | 캐시가 도는 한 수백~수천 명 | Pro(250GB/월) |

업로드가 실패하면(용량 초과·권한·네트워크) 앱은 **본문 인라인으로 폴백**하고 사용자에게
독칩 배너로 알린다(`imageInlined`). 조용히 넘기면 실시간 메시지 크기 사고가 되살아나고
Postgres(무료 500MB)도 부푸므로, 이 배너가 보이기 시작하면 용량을 확인할 신호다.

### 배포

`supabase/migrations/0016_map_images.sql`은 GitHub 연동으로 자동 배포된다. 수동으로
적용하려면 SQL Editor에서 파일 전체를 그대로 실행하면 된다(재실행 가능 —
버킷은 `on conflict do nothing`, 정책은 `drop … if exists` 후 생성).

### 확인

```sql
-- 버킷
select id, public, file_size_limit from storage.buckets where id = 'map-images';
-- 정책 3개
select policyname, cmd from pg_policies
where schemaname = 'storage' and tablename = 'objects' and policyname like 'map images%';
-- 문서별 사용량
select split_part(name, '/', 1) as doc_id, count(*) files,
       pg_size_pretty(sum((metadata->>'size')::bigint)) as size
from storage.objects where bucket_id = 'map-images' group by 1 order by 3 desc;
```

### 옛 문서 이전 · 정리

- **이전은 자동**이다. 인라인 이미지가 있는 맵을 열면 에디터가 실물을 올리고 본문을
  참조로 바꿔 저장한다(`useEditorState`의 `imageMigratedRef` 효과). 실패해도 문서는
  온전하다 — 올라간 것만 참조가 되고 나머지는 인라인으로 남아 다음에 다시 시도한다.
- **정리는 영구 삭제 때만.** 편집 중 이미지를 지웠다가 undo하면 참조가 살아 돌아오므로
  그때는 실물을 지우지 않는다. 휴지통을 비울 때 `imageStore.removeForDoc`이 그 문서
  폴더를 통째로 지운다. 그래서 고아 파일이 남을 수 있는 경우는 하나뿐이다 — 두 사람이
  같은 옛 문서를 동시에 열어 각자 올렸을 때(한쪽 참조만 채택된다). 위 사용량 쿼리로
  확인하고 필요하면 수동 정리한다.

---

## 11. 링크 공유 (0017 `documents.link_role`)

### 무엇을 여는가

"링크를 아는 사람은 **열람**." 공유 팝업의 `링크가 있는 사람은 열람` 토글이
`documents.link_role`을 `'view'`로 바꾼다. 끄면 `null`이 되고 같은 주소도 즉시
막힌다.

**링크의 비밀은 문서 id 그 자체다** — 주소가 `/editor?map=<docId>`이고 id는 랜덤이라
추측할 수 없다. 별도 토큰을 두지 않은 이유: 회수 수단이 "끄기"로 충분하고, 토큰을
두면 주소가 둘(문서 주소 / 공유 주소)이 되어 사용자가 어느 것을 붙여넣었는지에 따라
결과가 달라진다.

### 이번 범위에서 **의도적으로 제외한 것**

- **편집 링크.** `check (link_role is null or link_role = 'view')`가 DB에서 막는다.
  링크는 유출되면 끄기 전까지 회수할 수 없는데, 열람은 피해가 "봤다"에서 멈추지만
  편집은 내용을 되돌릴 수 없게 만든다. 열려면 제약을 푸는 **의도적인** 마이그레이션이
  필요하다(그때 `documents_update_*` 정책도 함께 손봐야 한다).
- **익명 열람.** `anon` 역할에는 아무것도 열지 않았다(`link_shared`의 execute도
  회수). 익명을 열려면 공개 라우트 + 익명 RLS + 익명 이미지 서명 URL + 저장/협업
  비활성이 함께 필요하다 — 별도 작업이다.

### 클라이언트가 뷰어를 알아보는 방법

링크로 들어온 사람은 `document_shares`에 **행이 없다**. 그런데 소유자도 자기 행이
없어서, 초대 목록만으로는 둘이 구별되지 않는다. 그래서 `DocStore.load()`가
`owner`를 함께 읽어 `ownedByMe`를 실어 준다:

> 내 문서가 아닌데(`ownedByMe === false`) 초대 행도 없다 → **링크로 열었다** → 보기 전용

이건 어포던스일 뿐이고 진짜 게이트는 RLS다(링크는 SELECT만 열고 UPDATE는 열지
않는다). 이 판별이 없으면 뷰어에게 편집 UI를 내주고 저장만 서버가 거부하는 화면이
된다.

### 이미지도 함께 열린다

0016의 `map images readable by document readers` 정책을 0017이 다시 만들어
`link_shared(...)`를 더한다. 이게 없으면 링크로 연 사람에게 **본문은 보이는데 사진
자리마다 회색 자리표시자**가 뜬다.

### 배포

`supabase/migrations/0017_document_link_share.sql`은 GitHub 연동으로 자동 배포된다.
수동 적용도 파일 전체를 SQL Editor에서 그대로 실행하면 된다(재실행 가능 — `add
column if not exists`, `create or replace`, `drop policy if exists`).

### 확인

```sql
-- 컬럼과 제약
select column_name, data_type from information_schema.columns
where table_name = 'documents' and column_name = 'link_role';

-- 지금 링크가 열려 있는 문서
select id, title, link_role from public.documents where link_role is not null;

-- documents SELECT 정책에 링크 조건이 들어갔는지
select policyname, qual from pg_policies
where tablename = 'documents' and policyname = 'documents_select_own_or_shared';

-- 이미지 read 정책에 link_shared가 들어갔는지
select policyname, qual from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and policyname = 'map images readable by document readers';
```

### 링크 뷰어에게 보이는 참가자 (0018)

배포 후 제보: 링크로 연 사람의 공유 팝업에 **소유자가 안 보이고**, 소유자 전용
UI(링크 토글·초대 입력)가 그대로 열려 있었다.

원인은 `share_participants` RPC(0011)의 가드였다 — `owns_document or
shared_with_me`만 통과시키는데 **링크 뷰어는 둘 다 아니다** → 빈 목록 → 클라이언트가
"구 서버"로 착각해 나를 소유자로 폴백. 서버 RLS가 실제 쓰기는 막고 있었으니 권한이
샌 것은 아니고, **할 수 없는 일을 할 수 있는 것처럼 보여 준** 화면이었다.

0018이 **소유자 행에만** `link_shared(doc_id)`를 더한다. 초대 명단은 그대로
`owns_document or shared_with_me`다 — 그 목록은 곧 **이메일 주소 목록**이고 링크는
누구에게나 전달될 수 있다. "이 맵이 누구 것인가"는 뷰어가 알아야 하지만 "누구누구가
초대돼 있는가"는 아니다.

클라이언트에도 잠금이 하나 더 있다(`ShareModal`의 `viewerOnly`) — 참가자 목록이
비어 오는 서버에서도 `readOnly` 하나로 공유 설정이 잠긴다.

### 전체 끄기(사고 대응)

```sql
update public.documents set link_role = null where link_role is not null;
```

## 12. 초대 알림 (0019 `seen_at` + Edge Function `share-invite`)

맵을 공유해도 **상대는 알 길이 없었다** — 초대 행만 생기고, 상대가 우연히 홈의
"공유받음"을 펼쳐 봐야 발견한다. 알림을 두 겹으로 붙인다.

### ① 앱 안의 배지 (0019, 이미 동작)

`document_shares.seen_at`이 `null`이면 "아직 못 본 초대"다. 홈 LNB의 `공유받음`
행에 개수 배지, 새 항목에 점, 모바일은 ☰ 버튼에도 점(서랍 안 배지는 닫힌 문 뒤라
알림이 아니다). **맵을 열면** 그 초대가 `seen_at`으로 표시된다.

`seen_at`을 갱신하는 길은 `mark_shares_seen(doc_ids text[])` RPC 하나뿐이다.
UPDATE 정책을 넓히지 않은 이유: RLS는 컬럼 단위로 못 좁히므로, 초대받은 사람이
자기 행을 UPDATE할 수 있게 열면 `seen_at`만이 아니라 **`role`까지** 바꿀 수 있다
(보기 전용 사용자가 스스로 편집 권한으로 승격).

구 서버(0019 미적용)에서는 `seen_at` select가 실패하므로 어댑터가 **컬럼 없이 한 번
더 읽는다** — 목록은 그대로 뜨고 배지만 없다.

### ② 초대 메일 (Edge Function `share-invite`)

`supabase/functions/share-invite/index.ts`. **설정하기 전까지는 아무 일도 하지
않는다** — `RESEND_API_KEY`가 없으면 `{ sent: false, reason: 'not-configured' }`를
돌려주고, 클라이언트는 결과를 보지 않는다. 즉 아래 설정은 **원할 때** 하면 된다.

보내는 시점은 **처음 초대할 때 한 번**뿐이다(권한 변경·재초대는 보내지 않는다 —
같은 알림 반복은 스팸으로 읽힌다).

**클라이언트를 믿지 않는다**: 요청자가 그 문서의 소유자인지, 그리고 그 초대가 실제로
`document_shares`에 있는지를 함수가 서버에서 다시 확인한다. 이게 없으면 로그인한
아무나 이 함수를 불러 임의의 주소로 우리 이름의 메일을 보낼 수 있다(피싱).

#### 설정 (한 번)

1. **Resend 가입** — https://resend.com (무료 3,000통/월, 100통/일).
2. **도메인 인증**: Resend에서 `geurio.com`을 추가하면 DNS 레코드 3개(SPF·DKIM·
   반송)를 준다. 도메인 DNS에 그대로 넣고 인증될 때까지 기다린다. *(도메인 인증
   없이 테스트만 하려면 Resend의 `onboarding@resend.dev`를 `INVITE_FROM`으로 쓸 수
   있지만, 그 주소는 가입한 본인에게만 보낼 수 있다.)*
3. **시크릿 등록**:
   ```bash
   supabase secrets set RESEND_API_KEY=re_xxx
   supabase secrets set INVITE_FROM='Geurio <noreply@geurio.com>'   # 선택(기본값 동일)
   supabase secrets set APP_URL=https://geurio.com                   # 선택(기본값 동일)
   ```
4. **함수 배포**: `supabase functions deploy share-invite`
   (마이그레이션과 달리 **함수는 GitHub 연동으로 자동 배포되지 않는다**.)

`SUPABASE_URL`·`SUPABASE_ANON_KEY`·`SUPABASE_SERVICE_ROLE_KEY`는 Edge Function 런타임이
자동으로 넣어 준다 — 따로 등록하지 않는다.

#### 확인

```bash
supabase functions logs share-invite      # 발송·실패 로그
```

메일이 안 가는데 공유는 되는 상황이면 대개 셋 중 하나다: 시크릿 미등록
(`reason: 'not-configured'`), 도메인 미인증(Resend 401/403 → `reason: 'send-failed'`),
함수 미배포(클라이언트가 조용히 무시). 어느 경우든 **초대 자체와 앱 안 배지는 정상
동작한다** — 메일은 부수 효과다.

---

## 13. 주제 댓글 (0020 `document_comments`)

맵의 **주제(노드)**에 붙는 논의. 문서 전체 댓글은 루트 주제의 댓글로 대신한다 —
붙는 자리를 하나로 두어 모델을 단순하게 지킨다.

### 왜 본문(jsonb)이 아니라 별도 테이블인가

- 댓글은 **본문과 수명이 다르다** — 버전 기록으로 문서를 되돌려도 논의는 남아야 한다.
- 본문에 넣으면 CRDT 병합 대상이 된다 → 끊긴 채 양쪽이 댓글을 달면 한쪽이 사라진다
  (§배열 필드의 한계, `crdt/divergence.test.ts`에서 확인한 것과 같은 문제).
- 본문은 자동저장마다 통째로 오가는 값이라, 댓글이 늘수록 저장·전송이 무거워진다.

### 권한 (RLS)

| 동작 | 누구 |
| --- | --- |
| 읽기 | 소유자 + **초대받은 사람**(view/edit) |
| 쓰기(답글·멘션 포함) | 읽을 수 있는 사람 — **보기 전용도 댓글은 달 수 있다** |
| 지우기 | 쓴 사람 본인, 그리고 문서 소유자(정리 권한). 스레드 뿌리를 지우면 답글도 함께(cascade) |
| 해결/해제 | 쓸 수 있는 사람 전원 — 좁은 RPC `set_comment_resolved`(0021) |
| 수정 | 열지 않음 — 남긴 말이 조용히 바뀌면 기록으로서 믿을 수 없다 |

**해결 표시가 UPDATE 정책이 아니라 RPC인 이유**(0019 `mark_shares_seen`과 같은 판단):
RLS는 컬럼 단위로 못 좁힌다 — 댓글에 UPDATE를 열면 `resolved_at`만이 아니라 **남의
body까지** 고칠 수 있게 되어 "수정은 열지 않는다"가 무너진다.

**답글(0021)**: `parent_id` — 단층 스레드(대댓글 없음, 트리거 `check_comment_parent`가
같은 문서·뿌리 여부를 강제). **멘션**: `mentions jsonb`([{email,name}]) — 본문에는
"@이름"이 글자로 남고, 이 명단이 (이후) 알림이 겨냥할 대상이다. 명단의 이메일은 공유
참가자(0011로 서로에게 이미 보이는 값)에서 고른 것이라 새로 노출되는 정보가 없다.

**링크 공유(0017)로 들어온 사람은 읽지 못한다.** 링크는 누구에게나 전달될 수 있는데
댓글은 내부 논의라, 본문을 보여 주는 것과 같은 무게로 다룰 수 없다. 클라이언트도
같은 판단을 해서(`controller.canComment`) 진입점부터 감춘다 — "열리는 척하다 빈
목록"이 되지 않게.

**보기 전용에 쓰기를 허용한 이유**: 리뷰를 받으려고 보기 권한으로 부르는 일이 흔하고,
그때 의견을 남길 길이 없으면 초대의 목적이 반쯤 사라진다(구글 문서의 '댓글 작성자'
권한과 같은 생각).

### 작성자 이름은 스냅샷

`author_name`에 작성 시점의 표시 이름을 **박아 둔다**(`display_name` → 공급자 이름 →
이메일 로컬파트, 0015와 같은 순서. 이메일 전체는 남기지 않는다). `profiles` 조인을
쓰지 않는 이유는 클라이언트가 남의 `profiles`를 못 읽어 0010처럼 SECURITY DEFINER
RPC가 또 필요해지기 때문이다. 대가는 "이름을 바꾸면 옛 댓글은 옛 이름"인데, 채팅·
리뷰 도구들이 흔히 택하는 절충이다. 작성자가 탈퇴하면 `author`는 null이 되고 댓글은
이름과 함께 남는다.

주제가 지워져도 댓글은 남는다 — `node_id`는 본문 jsonb 안의 키라 참조 무결성을 걸 수
없고, 앱이 "사라진 주제"로 보여 준다.

### 실시간 — 내용 없는 신호(ping) 채널

상대의 작성·답글·해결이 **즉시** 보인다(요청). 설계: 공개 broadcast 채널
`mindflow-comments:<docId>`에 **"바뀌었다"는 ping만** 싣고, 받는 쪽이 `list()`로
다시 읽는다 — 그 select에 RLS가 걸려 있으므로 채널 자체는 비밀을 나르지 않는다.

- **공개 채널인 이유**: 0009의 `realtime.messages` 발신 정책은 edit 전용인데 댓글은
  **보기 전용 참가자도 쓴다**. private 채널이면 그 사람의 신호만 막혀 "내 댓글이
  남에게 실시간으로 안 가는" 반쪽이 된다(#228의 교훈 — 반쪽 채널은 조용히 죽는다).
  내용 없는 ping은 공개여도 잃을 것이 없다: 문서 id를 아는 외부인이 할 수 있는 일은
  "다시 읽어 봐"뿐이고 그 읽기는 RLS가 거른다. **추가 마이그레이션·정책 불필요.**
- **postgres_changes를 안 쓴 이유**: DELETE 이벤트는 RLS로 거를 수 없고(내용 유출
  경로), replica identity·publication 설정이 더 붙는다 — ping+refetch가 더 단순하고
  같은 결과를 낸다.
- **사용량(#231)**: 구독은 **공유된 문서에서만**(혼자 쓰는 맵은 채널 0개), 메시지는
  실제 댓글 동작이 있을 때 한 건씩 — 커서 트래픽과 비교가 안 되게 작다.

### 배포

`supabase/migrations/0020_document_comments.sql` + `0021_comment_threads.sql` —
GitHub 연동으로 자동 배포된다. 0021 미적용 서버에서는 확장 컬럼 select가 실패하고
어댑터가 **기본 컬럼으로 다시 읽어** 답글·해결 표시 없이 옛 모습으로 동작한다
(배포 순서 안전).
적용 전 서버에서는 select가 실패하고 어댑터가 **빈 목록**으로 넘어가므로(콘솔에
`[geurio] 댓글을 불러오지 못했어요` 경고) 앱은 깨지지 않는다.

### 확인

```sql
-- 이 문서의 댓글
select node_id, author_name, body, created_at
from public.document_comments
where document_id = '<맵 id>'
order by created_at;
```

---

## 14. 알림 우편함 (0022 `notifications`) — 홈 알림 센터

알림의 종류가 셋을 넘었다(공유 초대·멘션·답글·새 댓글) — 종류마다 배지를 늘리는
대신 우편함 하나에 모으고, 홈 툴바의 종(벨) 버튼이 읽는다.

### 클라이언트는 알림을 만들지 못한다

insert 정책이 없다 — 전부 **DB 트리거**가 만든다. 클라이언트 insert를 열면 로그인한
아무나 남의 우편함에 "당신이 멘션됐다"를 꽂을 수 있다(share-invite 함수가 초대를
서버에서 재확인하는 것과 같은 원칙: 알림의 근거는 서버가 본 사실이어야 한다).

| 트리거 | 시점 | 알림 |
| --- | --- | --- |
| `document_comments_notify` | 댓글 insert | 멘션된 사람(`mention`) → 스레드 뿌리 작성자(`reply`) → 문서 소유자(`comment`) — 우선순위 순, 같은 사람에게 한 번만, 자기 행동은 제외 |
| `document_shares_notify` | 공유 insert | 초대받은 사람(`share`) — upsert의 UPDATE(권한 변경)는 insert 트리거를 타지 않으므로 **처음 초대에만** |

아직 가입하지 않은 이메일은 우편함(auth.users 행)이 없어 알림도 없다 — 가입하면
LNB '공유받음' 배지(0019)가 그 역할을 한다.

### 읽기·읽음 처리

RLS는 전부 `recipient = auth.uid()`. UPDATE를 (0019·0021의 RPC 패턴과 달리) 직접
연 이유: 이 행에는 남의 것이 섞여 있지 않다 — 자기 알림의 어떤 컬럼을 바꿔도
피해자가 자기 자신뿐이라 컬럼을 좁힐 이유가 없다.

읽음 처리 시점은 **알림 센터를 열었을 때 전부**(0019 공유 배지와 같은 규칙 —
목록이 한 화면이라 열었으면 본 것이다). 항목을 누르면 그 맵으로 가고, 댓글류는
`?comments=<nodeId>`로 에디터가 그 주제의 댓글 패널을 바로 연다.

### 배포·확인

0022는 GitHub 연동으로 자동 배포된다. 미적용 서버에서는 select가 실패하고
어댑터가 빈 배열로 넘어가 벨이 조용히 빈다(콘솔 경고).

```sql
-- 내 우편함 (Studio에서 특정 사용자로 확인)
select kind, actor_name, preview, doc_title, created_at, read_at
from public.notifications where recipient = '<uid>' order by created_at desc;
```

**메일 알림은 아직 없다** — 멘션의 이메일 명단(0021 `mentions`)과 Resend 인프라
(§12)가 준비돼 있으므로, 원하면 `share-invite`와 같은 꼴의 Edge Function으로 붙일
수 있다(시크릿 설정 전까지는 아무 일도 하지 않는 같은 계약으로).

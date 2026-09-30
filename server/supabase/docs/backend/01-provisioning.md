<!-- backend.md §1 — 색인: ../backend.md -->
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

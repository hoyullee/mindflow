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
- `server/supabase/migrations/0001_init.sql` — `profiles`/`documents` 테이블 + RLS.

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

   # 또는 psql 직접 연결
   psql "$DATABASE_URL" -f server/supabase/migrations/0001_init.sql
   ```
   `server/supabase/seed/seed.sql`은 선택 사항(로컬 개발용 샘플 문서 1건 삽입 — 실제
   `auth.users` id로 치환 필요, 파일 내 주석 참고).
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

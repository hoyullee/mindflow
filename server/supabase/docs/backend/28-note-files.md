<!-- backend.md §28 — 색인: ../backend.md -->
## 28. 공책 파일 첨부 (0049 `plans`·`user_plans`·`note_files` + Edge Function `files`·`files-sweep`) — 바이트는 R2, 장부는 Supabase

공책에 PDF·압축·이미지 같은 파일을 붙입니다. **바이트는 Cloudflare R2(S3 호환)에 두고,
Supabase는 "누구의 어떤 파일이 얼마인가"(메타데이터)와 한도(요금제)만 갖습니다.**
브라우저는 Edge Function `files`가 발급한 **서명 URL**로 R2와 직접 주고받습니다 — 바이트가
우리 함수를 지나지 않아 함수 실행 시간·메모리·송신 한도를 먹지 않습니다.

### 왜 Supabase Storage가 아니라 R2인가

- Supabase 무료 플랜의 **송신(egress) 5GB**는 앱 본체(문서 동기화·실시간·이미지)와 나눠 쓰는
  통장입니다. 파일 내려받기가 그 통장을 먹으면 첨부 하나가 로그인·동기화를 막을 수 있습니다.
- R2는 **송신이 0원**이고 무료 저장 10GB입니다(요청 수 한도는 넉넉). 첨부 트래픽이 Supabase
  송신 한도와 완전히 분리됩니다.
- 그 대가: 서비스가 하나 늘고(Cloudflare 계정), 접근 판정을 Supabase가 해 주지 못해(Storage
  RLS를 못 쓴다) **서명 URL을 발급하는 함수**가 문지기가 됩니다. 그래서 판정은 함수가 하되,
  규칙 자체는 DB의 보조 함수(`owns_document`·`shared_with_me`·`link_shared`)에 둡니다.

### 스키마 (0049)

- `plans(id pk, name, storage_limit_bytes, file_limit_bytes)` — 시드 `('free','무료',
  200MB, 20MB)`. 로그인한 사용자는 읽기만(전부 `to authenticated`), 쓰기 정책 없음.
- `user_plans(user_id pk → auth.users on delete cascade, plan_id → plans default 'free',
  updated_at)` — 본인 행만 읽기, 쓰기 정책 없음. **행이 없으면 'free'**다(가입마다 행을 만들지
  않는다 — `my_file_quota`와 함수가 같은 규칙으로 읽는다).
- `note_files(id uuid pk, doc_id → documents on delete set null, uploader → auth.users on
  delete set null, object_key unique, name, size ≥ 0, mime, status 'pending'|'ready',
  created_at)` + 인덱스 `(uploader)`·`(doc_id)`.
  - `object_key = <docId>/<fileId>` — **사용자가 정한 파일 이름은 키에 들어가지 않는다**
    (경로 조작·충돌 방지). 이름은 `name`에만 있다.
  - `on delete set null`인 이유: DB의 cascade는 R2를 지우지 못한다. 행까지 같이 지우면
    **주인 없는 바이트가 R2에 영영 남는다.** 행을 남겨 두면 `files-sweep`이 null을 보고 객체를
    지운 뒤 행을 지운다.
- **RLS**: `note_files` SELECT는 `owns_document or shared_with_me or link_shared`(문서를
  읽을 수 있는 사람 — 첨부 목록은 본문과 같이 보이므로 본문과 같은 문턱). INSERT/UPDATE/
  DELETE 정책은 **없다**, `revoke … from anon`과 `revoke insert, update, delete from
  authenticated`로 이중 잠금 — 쓰는 쪽은 service_role(Edge Function)뿐이다. 클라이언트가
  크기를 말하는 대로 믿으면 한도가 무의미하고, `user_plans`를 열면 스스로 요금제를 올릴 수 있다.
- RPC `my_file_quota()` (security definer, `authenticated`만 execute) → `(plan, plan_name,
  used, storage_limit, file_limit)`. `used` = **내가 올린** 파일 `size` 합계, **pending도
  센다**(업로드만 시작하고 버리는 식으로 한도를 우회하지 못하게). 설정 화면의 "사용량 n / 200MB"가 이것을 읽는다.

### 요금제와 한도 — 유료 플랜을 나중에 붙이려면

한도는 코드가 아니라 `plans` 표에 있다. 유료 플랜은:

```sql
insert into public.plans (id, name, storage_limit_bytes, file_limit_bytes)
values ('pro', '프로', 10::bigint * 1024^3, 1024::bigint * 1024^2);
-- 결제 웹훅(service_role)이 결제 성공 시:
insert into public.user_plans (user_id, plan_id) values ('<uid>', 'pro')
on conflict (user_id) do update set plan_id = excluded.plan_id, updated_at = now();
```

함수·화면은 `my_file_quota()`를 읽을 뿐이라 **코드 변경이 없다.** 해지하면 `plan_id`를 'free'로
되돌린다 — 이미 올린 파일이 한도를 넘어도 **지우지는 않고** 새 업로드만 막힌다(`used + size > limit`).

### Edge Function `files` (verify_jwt 기본값 ON — 로그인한 사용자가 부른다)

`POST { action, … }` → JSON(CORS). **호출자를 JWT로 먼저 확인**하고, 접근 판정은 **호출자의
클라이언트로** `owns_document`·`shared_with_me`·`link_shared` RPC를 불러 한다(규칙의 단일 출처가
DB 보조 함수). RPC가 실패하면 **거부**로 읽는다. 쓰기는 service_role로만 한다.

| action | 입력 | 하는 일 / 결과 |
| --- | --- | --- |
| `upload` | `docId, name, size, mime` | 편집 권한(`owns_document or shared_with_me(…,'edit')`) → 이름·MIME 정리 → 한도 검사 → `note_files`(pending) → **PUT 서명 URL(15분, `Content-Type` 서명됨)**. `{ok:true, fileId, uploadUrl, headers:{'Content-Type'}}` · `{ok:false, reason:'too-large', fileLimit}` · `{ok:false, reason:'quota', used, limit}` · `{ok:false, reason:'forbidden'}` |
| `complete` | `fileId` | **올린 사람만.** R2에 HEAD로 **실제 크기**를 재서 한도를 다시 본다(선언을 믿지 않는다) → 초과면 객체·행 삭제 후 `too-large`/`quota`, 없으면 `missing`, 통과면 `size=실제, status='ready'` → `{ok:true, file:{id,name,size,mime}}`. 이미 ready면 같은 답(재시도 안전) |
| `download` | `fileId, inline?` | ready + 읽기 권한(`owns_document or shared_with_me(…,'view') or link_shared`) → **GET 서명 URL(10분)** + `response-content-disposition`(`attachment` 또는 `inline`; RFC 5987 `filename*=UTF-8''…` + ASCII 대체 `filename="…"`) + `response-content-type`=mime. 없음·pending·권한 없음은 **같은 답** `{ok:false, reason:'not-found'}` |
| `remove` | `fileId` | 올린 사람 또는 문서 소유자. **R2 먼저, 행은 그다음** — 순서가 반대면 R2 삭제 실패 때 주인 없는 바이트가 남는다. 404는 무시. `{ok:true}` |

- 오류: 알 수 없는 action·잘못된 입력은 HTTP 400 `{ok:false, reason:'bad-request'}`, 무토큰은 401
  `{ok:false, reason:'unauthorized'}`, 예기치 못한 실패는 500 `{ok:false, reason:'error'}`(원인은 로그에만).
  나머지 거절은 **HTTP 200 + `reason`**이다 — `functions.invoke`가 비 2xx의 본문을 `error` 뒤로 숨기기 때문.
- **R2 환경변수가 하나라도 없으면** 200 `{ok:false, reason:'not-configured'}` — 앱이 먼저 나가도 깨지지 않는다.
- 객체 키는 `<docId>/<fileId>`(fileId는 함수가 만든 uuid). 이름·MIME은 정리한다: 이름은 제어문자·`/`·`\`
  제거, 앞뒤 공백 제거, 200자 초과는 확장자를 살려 자름, 비면 거절. MIME은 제어문자 제거 + 120자 + 기본값
  `application/octet-stream`. **클라이언트는 응답의 `headers`를 그대로 써야 한다**(서명된 값이 정리된 MIME이다).
- **`inline` 강등**: `text/html`·`svg`·`xml` 같은 **페이지처럼 실행될 수 있는 형식**은 `inline`을 요청해도
  `attachment`로 내려 준다(R2 출처에서 스크립트가 도는 피싱 면을 닫는다). 이미지·PDF·영상·음성은 그대로 inline.
- 서명 구현 메모(하네스가 잡은 것): `aws4fetch`는 기본으로 `content-type`을 서명에서 **뺀다**
  (`SignedHeaders=host`) → 브라우저가 아무 형식으로나 올릴 수 있게 된다. 요청마다 `aws:{allHeaders:true}`를
  줘야 `SignedHeaders=content-type;host`가 된다. 또 공백이 `+`로 나가므로 `%20`으로 바꿔 내보낸다.

### 청소 — Edge Function `files-sweep` (cron · verify_jwt = false · `DIGEST_SECRET`)

`config.toml`에서 JWT 검증을 끄고 **`x-digest-secret` 헤더 == `DIGEST_SECRET`**으로 잠근다(§23과 같은 비밀·
같은 방식, 비밀이 없으면 500으로 닫힘). 지울 파일 선택은 SQL 함수 `files_sweep_candidates(batch int default 200)`
(security definer, **service_role만** execute)가 한다 — 규칙을 Postgres에서 그대로 시험할 수 있다.

| 지우는 것 | 규칙 |
| --- | --- |
| (a) 끊긴 업로드 | `status='pending'` 이고 **하루** 지남 |
| (b) 주인 없음 | `doc_id is null` 또는 `uploader is null` (문서·계정이 삭제됨 — 즉시 대상) |
| (c) 쓰이지 않음 | `status='ready'` 이고 **3일** 지났고, 문서 본문(`documents.data`)에 id가 없고 **최근 30일** `note_history.snapshot`에도 없음 |

(c)의 3일 유예는 막 올리고 본문에 넣기 전(저장 지연)인 파일을 건드리지 않으려는 것, 30일은 기록(§27)으로
되돌리면 첨부가 다시 나타나기 때문이다. 판정은 id(uuid) 문자열이 본문 jsonb 텍스트에 **들어 있는지**(`position`)로
본다 — 블록 구조에 기대지 않으므로 첨부를 어느 블록에 넣든 같은 규칙이다. 휴지통(soft delete) 문서는 본문이
남아 있으니 지우지 않는다. 한 회차 최대 200건, 남은 것은 다음 회차. **R2 먼저 지우고 성공한 것만 행을 지운다**
(실패한 행은 남아 다음 회차에 재시도).

- 응답: `{ok:true, candidates, deleted, pending, orphan, unused, failed}`.
- 트레이드오프: (c)의 `not exists` 검사는 후보 행마다 해당 문서 본문을 텍스트로 훑는다. 파일이 수만 건이 되면
  느려질 수 있다 — 그때는 문서별로 한 번만 훑도록 바꾼다(지금 규모에선 하루 1회 cron으로 충분).
- (b)는 **올린 사람이 탈퇴하면 남의 문서에 아직 쓰이는 첨부도 지운다**(스펙대로). 바꾸려면 `uploader is null`을
  (c)와 같은 "본문에 없을 때만"으로 낮추면 된다.

### 배포 체크리스트 (손으로 — 번호 순서대로)

마이그레이션(0049)은 `main` 머지에 자동 적용되지만 **R2와 Edge Function은 자동이 아니다.**
설정 전에는 `files`가 `not-configured`를 돌려주므로 앱은 깨지지 않고 첨부만 "준비 중"이다.

1. **Cloudflare 계정 + R2 버킷**: Cloudflare 대시보드 → R2 Object Storage(결제 수단 등록이 필요하지만
   무료 한도 안에서는 청구되지 않는다) → 버킷 생성, **Location hint = `apac-ne`**(아시아 북동). 이름은 예: `geurio-files`.
   버킷은 **비공개**로 둔다(공개 도메인·`r2.dev`를 켜지 않는다 — 서명 URL로만 접근).
2. **버킷 CORS 정책**: 버킷 → Settings → CORS Policy → JSON 편집에 붙여넣는다.
   ```json
   [
     {
       "AllowedOrigins": [
         "https://geurio.com",
         "https://www.geurio.com",
         "http://localhost:5173",
         "http://localhost:4173"
       ],
       "AllowedMethods": ["PUT", "GET", "HEAD"],
       "AllowedHeaders": ["Content-Type"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```
   - 설치형 데스크톱 앱(Electron)은 `https://geurio.com/home`을 띄우므로(`apps/desktop/src/shell.ts`)
     출처가 `https://geurio.com` — 위 목록에 이미 있다.
   - Capacitor 모바일 셸을 쓰게 되면 `https://localhost`(Android, `androidScheme: 'https'`)와
     `capacitor://localhost`(iOS)를 `AllowedOrigins`에 더한다(지금은 스캐폴딩이라 뺐다).
   - Vercel 프리뷰 배포에서 시험하려면 그 프리뷰 출처를 임시로 더한다.
3. **R2 API 토큰**: R2 → Manage API tokens → Create API token → 권한 **Object Read & Write**,
   적용 범위는 **이 버킷만**. 만들면 `Access Key ID`·`Secret Access Key`가 **한 번만** 보인다 — 바로 복사한다.
   `Account ID`는 R2 개요 화면 우측에 있다.
4. **Supabase 시크릿**:
   ```bash
   supabase secrets set R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… R2_BUCKET=geurio-files
   # DIGEST_SECRET은 §23에서 이미 설정돼 있다(files-sweep이 같은 값을 쓴다). 없으면 §23 2번을 먼저.
   ```
5. **함수 배포** (시크릿을 바꿨으면 배포를 한 번 더 — §24b ②):
   ```bash
   supabase functions deploy files
   supabase functions deploy files-sweep
   ```
   `files-sweep`의 `verify_jwt = false`는 `supabase/config.toml`에 있다. `files`는 기본값(켜짐).
6. **하루 한 번 청소 cron**(Studio → SQL Editor에서 한 번 — 03:17 KST = 18:17 UTC). `pg_cron`·`pg_net`은 §23에서
   이미 켰다면 `create extension` 두 줄은 그대로 두어도 된다:
   ```sql
   create extension if not exists pg_cron with schema extensions;
   create extension if not exists pg_net with schema extensions;

   select cron.schedule(
     'geurio-files-sweep',
     '17 18 * * *',
     $$
     select net.http_post(
       url     := 'https://<project-ref>.supabase.co/functions/v1/files-sweep',
       headers := jsonb_build_object('Content-Type', 'application/json',
                                     'x-digest-secret', '<DIGEST_SECRET과 같은 값>'),
       body    := '{}'::jsonb,
       -- R2 삭제가 건당 왕복이라 200건이면 기본 5초 타임아웃을 넘긴다. 넘으면 pg_net이 요청을
       -- 끊어 일부만 지운 회차가 된다(남은 행은 다음 회차에 다시 잡히므로 안전하지만 낭비다).
       timeout_milliseconds := 60000
     );
     $$
   );
   ```
   지우려면 `select cron.unschedule('geurio-files-sweep');`.
7. **개인정보처리방침**: 사용자가 올린 파일(과 파일 이름)이 Cloudflare R2에 보관된다 — `/privacy` §3(위탁)에
   수탁사 한 줄과 §6(보호 조치)의 "저장 중 암호화"에 R2를 더한다(웹 PR에서). 방침이 실제 구현과 어긋나면 구글 검수 반려 사유다.

### 확인 (Studio)

```sql
-- 내 사용량(로그인한 세션에서)
select * from public.my_file_quota();
-- 지금 청소가 지울 것(실제로 지우지는 않는다 — service_role/Studio에서)
select * from public.files_sweep_candidates();
-- 최근 올라온 파일
select id, doc_id, name, size, status, created_at from public.note_files order by created_at desc limit 20;
-- 첨부 청소를 한 번 손으로 돌려 보기
select net.http_post(url := 'https://<ref>.supabase.co/functions/v1/files-sweep',
                     headers := jsonb_build_object('x-digest-secret','<값>'),
                     body := '{}'::jsonb);
```

### 알려진 한계

- 총량 검사는 `upload`(선언)와 `complete`(실제)에서 두 번 하지만 **동시에 여러 업로드를 시작하면** 선언 합이
  한도를 약간 넘어갈 수 있다(원자적 예약이 아니다). `complete`가 실제 크기로 다시 막으므로 영구 초과는 없다.
- 서명된 PUT은 15분 안이면 같은 URL로 **덮어쓰기**가 가능하다(같은 키). 크기는 `complete`가 실측하므로 한도는 지켜진다.
- 단일 PUT이라 파일당 한도(무료 20MB)가 곧 단일 요청 크기다. 큰 파일(멀티파트)이 필요한 요금제가 생기면 그때 다룬다.

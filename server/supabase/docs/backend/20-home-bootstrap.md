<!-- backend.md §20 — 색인: ../backend.md -->
## 20. 홈 부트스트랩 (0036 `home_bootstrap`) + documents SELECT 역할 한정 (0037)

홈을 열면 첫 화면에 필요한 목록을 **한 번의 왕복**으로 받는다.

### 왜 하나로 묶었나
그동안 홈은 네 갈래를 따로 물었다 — `documents` 목록 / `document_shares`의 내 행(공유받은 맵 +
"아직 못 본" 배지) / 내가 걸어 둔 초대 수(카드의 "공유 중" 표식) / `link_role`이 켜진 문서.
넷은 병렬로 나가지만 요청은 넷이고, 하나하나가 TLS·인증 검사를 다시 지난다.

- **함수는 `security invoker`(기본값)** — RLS가 그대로 걸린다. 호출자가 원래 볼 수 있던 행만
  담기므로(내 문서 + 나에게 공유된 문서, 내 문서의 초대 전부 + 나에게 온 초대) 0010·0011·0015·
  0019처럼 가드를 직접 짤 필요가 없다. 대신 **`anon`에서 EXECUTE를 회수**한다(새 함수는 PUBLIC에
  기본 부여된다 — 홈은 로그인한 사용자의 화면이다).
- **반환은 `jsonb` 하나** — 두 목록의 칼럼 모양이 달라 한 표로는 못 담고, 클라이언트가 예전
  질의와 같은 필드를 그대로 읽게 하려는 것이다.
- **클라이언트는 진행 중인 요청을 나눠 쓴다**(`supabaseHomeBootstrap.ts`) — 포트를 새로 뚫지
  않고 `DocStore.list()`·`ShareStore.listSharedWithMe()`·`listSharedByMe()` 셋이 같은 약속을
  기다린다. **캐시가 아니라 합치기**다: 끝나면 버리므로 나중에 따로 부르는 조회(공유 팝업을 닫은
  뒤 등)는 언제나 새 값을 받는다.
- **RPC가 없는 서버에서는 예전 네 질의로 물러난다**(콘솔 경고 한 줄) — 배포 순서 안전.

실측(가짜 Supabase 엔드포인트, 홈 첫 로드): **REST 요청 10 → 6**. 폴백일 때는 실패한 RPC까지
포함해 10이다(예전과 같은 화면).

### 적용 확인
```sql
-- 함수와 권한
select proname, prosecdef from pg_proc where proname = 'home_bootstrap';
select grantee, privilege_type from information_schema.routine_privileges
 where routine_name = 'home_bootstrap';   -- authenticated만
-- 로그인 사용자로 실행(대시보드 SQL Editor는 postgres 역할이라 RLS를 우회한다)
select jsonb_array_length(public.home_bootstrap() -> 'documents') as docs,
       jsonb_array_length(public.home_bootstrap() -> 'shares')    as shares;
```

### 0037 — documents SELECT를 로그인 사용자로 한정 (보안 수리)
0036을 로컬 Postgres 하네스(0001·0002·0003·0009·0015·0017·0019 원문 적용)로 검증하다 드러난 것:
0017이 링크 공유를 위해 SELECT 정책에 더한 `link_role is not null`은 **역할을 가리지 않는다**
(`to` 절이 없으면 정책은 PUBLIC이고, Supabase는 `anon`에게도 public 스키마 테이블의 SELECT
권한을 준다). 하네스에서 `set role anon`으로 `select * from documents`를 하면 **링크 공유가 켜진
문서가 제목·본문까지 돌아왔다**(실측 1행) — 링크를 받은 사람만 보는 것이 아니라 목록째 훑을 수
있다는 뜻이다.

링크 공유의 설계는 처음부터 "링크가 있는 **로그인한** 사람은 열람"이었으므로(익명 열람은 공개
라우트·익명 RLS·익명 서명 URL이 함께 필요한 별도 작업) 조건은 그대로 두고 대상 역할만 좁혔다.
하네스 재검증: `anon` 0행 / 제3자(로그인) 링크 공유 문서 1행 / 소유자 2행.

```sql
-- 확인: 이 정책의 역할이 {authenticated}인가
select polname, polroles::regrole[] from pg_policy
 where polrelid = 'public.documents'::regclass and polcmd = 'r';
```

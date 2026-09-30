<!-- backend.md §23 — 색인: ../backend.md -->
## 23. 멘션 메일 (0039 + Edge Function `notify-digest`) — 안 보내는 쪽이 본체

### 왜 만들었나, 그리고 왜 이렇게 생겼나

사용자의 물음이 출발점이다 — **"멘션할 때마다 메일을 보내면 비용 부담이 있지 않나."**
재 보니 실제 제약은 요금이 아니라 **무료 한도의 성격**이었다:

- Resend 무료 = **월 3,000통 + 하루 100통**(§12).
- 그 통장을 멘션 메일이 혼자 쓰지 않는다 — **가입 확인·비밀번호 재설정**(Supabase
  Auth의 SMTP)과 **공유 초대**(`share-invite`)가 같은 키를 쓴다.
- 그래서 멘션 메일이 하루치를 태우면 **그날 가입·비밀번호 재설정이 막힌다.** 돈
  문제가 아니라 로그인 사고다.

넘겨도 Resend Pro가 월 $20에 50,000통이라 **금액은 사소하다**. 조여야 하는 이유는
한도 그 자체이고, 그래서 이 기능은 보내는 일보다 **안 보내는 일**이 본체다.

### 세 겹 (0039의 ①②③과 같은 번호)

| 겹 | 규칙 | 어디에 |
| --- | --- | --- |
| ① 읽지 않았을 때만 | `read_at is null` | `pending_mention_digests` |
| ② 30분에 한 통으로 묶음(요청) | 회차마다 수신자별 1통 · **5분보다 어린 것은 다음 회차로** | 같은 함수 + cron 주기 |
| ③ 상한 둘 | 수신자당 하루 5통 · 전체 하루 60통 | `per_user_daily` · `claim_email_budget` |

①이 가장 크게 먹는다 — 같이 편집 중인 사람은 벨을 바로 보므로 메일이 **아예 나가지
않는다**. 실시간 공동 편집이 이 앱의 주 사용 패턴이라 그렇다.
②의 5분 유예가 없으면 10:29의 멘션이 10:30에 나가 "읽을 틈"이 1분뿐이고, 그러면
①이 무력해진다.
③의 전체 상한 60통은 **나머지 40통을 인증·초대 메일의 자리로 남기는 안전판**이다.

**보내는 종류는 멘션 둘뿐이다** — `mention`(댓글 속)과 `doc_mention`(본문 속).
`reply`·`comment`는 일부러 뺐고(요청이 "멘션 메일"이었다), `share`는 이미
`share-invite`가 초대 메일을 보내므로 넣으면 같은 일에 두 통이 된다. 넓히고 싶으면
`pending_mention_digests`의 `kind in (…)` 한 줄이다.

### 왜 설정이 워크스페이스 블롭이 아닌가

`notification_prefs`는 별도 표다. **서버가 읽어야 하기 때문**이다 — 다이제스트는
`where email_mentions` 한 줄로 수신자를 걸러야지, 사용자 수만큼 불투명 JSON
(0004 `workspaces.data`)을 파싱할 수 없다. 그 블롭의 모양은 홈이 소유한다고
`ports.ts`에 못박혀 있어, 서버가 그 내부에 기대면 소유자가 둘이 된다.

**행이 없으면 켜짐**이다(`coalesce(p.email_mentions, true)`). 클라이언트도 같은
규칙으로 읽으므로(`DEFAULT_NOTIFICATION_PREFS`) 설정을 한 번도 연 적 없는 사용자는
양쪽에서 똑같이 보인다.

### 설정 화면의 진입 행이 상시로 바뀌었다 (회귀 주의)

예전에는 설정 첫 화면의 `알림` **진입 행 자체**가 `Notification` 지원 여부로 가려져
있었다("그 안에 그릴 것이 하나도 없다"). 멘션 메일은 OS 알림 권한과 무관하므로 —
메일을 보내는 것은 브라우저가 아니라 서버다 — 그 가정이 깨졌다. 감춘 채로 두면
**알림을 막아 둔 사람은 자기에게 가는 메일을 끌 길이 영영 없다.** 이제 행은 언제나
서고, 그 안에서 일정 알림 구획만 사라진다(`Home.test.tsx`가 못박는다).

### 배포 절차 (순서대로 — 셋 다 해야 메일이 나간다)

1. **마이그레이션**은 `main` 머지에 자동 적용(0039). 여기까지는 아무 메일도 나가지
   않는다 — 설정 스위치만 생긴다.
2. **Edge Function 배포는 손으로 한다**(자동이 아니다 — §19의 `redirect_uri_mismatch`
   사고가 이걸 빠뜨려 생겼다):
   ```bash
   supabase functions deploy notify-digest
   # ⚠️ 값을 **먼저 눈으로 보고** 넣는다 — `$(openssl …)`로 바로 넣으면 화면에 한 번도
   #    보이지 않는데, 같은 값을 아래 cron SQL에 손으로 적어야 하고 `secrets list`는
   #    값을 가려서 보여 준다. 그래서 401로 막힌다(§24b ①).
   openssl rand -hex 32                      # ← 출력된 64자를 복사
   supabase secrets set DIGEST_SECRET='<복사한 값>'
   supabase functions deploy notify-digest   # 시크릿을 바꿨으면 한 번 더(§24b ②)
   # RESEND_API_KEY·APP_URL·INVITE_FROM은 §12에서 이미 설정돼 있다(같은 키를 쓴다).
   ```
   `verify_jwt = false`는 `supabase/config.toml`에 있다 — **cron에는 사용자 JWT가
   없기 때문**이고, 대신 `DIGEST_SECRET` 헤더가 문을 잠근다. 비밀이 설정되지 않으면
   함수는 500으로 닫힌다(열린 채 두지 않는다). 그 비밀의 힘은 "회차를 한 번 돌린다"가
   전부라 service_role 키를 cron 잡에 적어 두는 것보다 폭발 반경이 훨씬 작다.
3. **30분 cron**(Studio → SQL Editor에서 한 번). `pg_cron`·`pg_net`은 Supabase가
   제공하는 확장이고 무료 플랜에서도 쓸 수 있다:
   ```sql
   create extension if not exists pg_cron with schema extensions;
   create extension if not exists pg_net with schema extensions;

   select cron.schedule(
     'geurio-mention-digest',
     '0,30 * * * *',
     $$
     select net.http_post(
       url     := 'https://<project-ref>.supabase.co/functions/v1/notify-digest',
       headers := jsonb_build_object('Content-Type', 'application/json',
                                     'x-digest-secret', '<DIGEST_SECRET과 같은 값>'),
       body    := '{}'::jsonb,
       -- **꼭 넣는다.** pg_net 기본 타임아웃은 5초인데, 한 회차가 메일을 여러 통
       -- 보내면(각각 Resend 왕복) 그걸 넘긴다. 넘기면 pg_net이 요청을 끊어
       -- **일부만 보내고 끝난 회차**가 된다 — `emailed_at`을 못 찍은 몫은 다음
       -- 회차에 다시 오지만, 이미 나간 메일의 예산은 사라진 뒤다.
       timeout_milliseconds := 60000
     );
     $$
   );
   ```
   지우려면 `select cron.unschedule('geurio-mention-digest');`.

**키가 없으면 아무 일도 하지 않는다**: `RESEND_API_KEY`가 없으면 함수는 후보를
**읽지도 않고** `{ sent: 0, reason: 'not-configured' }`로 물러난다. 읽어서 `emailed_at`을
찍어 버리면 키를 넣은 뒤 그 멘션들이 영영 안 나가기 때문이다.

### 확인 SQL (Studio)

```sql
-- 지금 회차가 보낼 것(실제로 보내지는 않는다)
select * from public.pending_mention_digests();
-- 오늘 얼마나 썼나(상한 60)
select * from public.email_budget where day = current_date;
-- 보낸 표시가 찍혔나
select recipient, kind, created_at, read_at, emailed_at
  from public.notifications where emailed_at is not null order by emailed_at desc limit 20;
-- 다이제스트를 한 번 손으로 돌려 보기(회차를 기다리지 않고)
select net.http_post(url := 'https://<ref>.supabase.co/functions/v1/notify-digest',
                     headers := jsonb_build_object('x-digest-secret','<값>'),
                     body := '{}'::jsonb);
```

### ✅ 실기기에서 도착 확인됨 (2026-09-15)

사용자의 메일함에 실제로 도착했다. `pending_mention_digests` → 예산 청구 → Resend →
`emailed_at` 스탬프까지 전 구간이 통과했다. 같은 라운드에 푸시도 확인됐다(§24).

### 메일이 안 올 때 보는 순서

0. **`{"sent":0,"candidates":0}`은 고장이 아니다** — "지금 보낼 것이 없다"는 뜻이고
   그게 정상 상태다. 실제로 사용자가 "읽음 처리도 안 했는데 왜 0이냐"고 물은 적이
   있는데, **답은 이미 나갔기 때문**이었다(`emailed_at`이 찍혀 있었고 메일함에 있었다).
   후보에서 빠지는 길이 일곱이라, 어느 것인지 **한 번에 보는 쿼리**를 먼저 돌린다:

   ```sql
   select n.id, n.kind, n.actor_name, n.doc_title, n.created_at,
          n.read_at, n.emailed_at, n.pushed_at,
          (n.read_at is null)                           as "①안읽음",
          (n.emailed_at is null)                        as "②안보냄",
          (n.kind in ('mention','doc_mention'))         as "③멘션종류",
          (n.created_at <= now() - interval '5 minutes') as "④5분지남",
          (n.created_at >= now() - interval '24 hours')  as "⑤24시간이내"
     from public.notifications n
    where n.recipient = (select id from auth.users where lower(email) = '<이메일>')
    order by n.created_at desc limit 20;

   -- ⑥ 설정 · ⑦ 수신자당 오늘 보낸 통수(상한 5)
   select email_mentions, push_mentions from public.notification_prefs
    where user_id = (select id from auth.users where lower(email) = '<이메일>');
   select count(distinct emailed_at) from public.notifications
    where recipient = (select id from auth.users where lower(email) = '<이메일>')
      and emailed_at >= current_date;
   ```
   **다섯 칸이 전부 `true`인 행이 하나라도 있어야** 후보가 된다. `false`인 칸이 곧
   원인이다 — ②가 가장 흔하다(**이미 나갔다. 스팸함을 본다**).

   참고: **읽음 처리는 종 팝업을 여는 순간에만** 일어난다(`NotificationBell`의
   `openCenter` 한 곳). 푸시 배너를 눌러 앱으로 들어오는 것만으로는 읽음이 되지
   않으므로, "배너를 눌렀더니 메일이 안 왔다"는 이 경로가 아니다.

1. `pending_mention_digests()`가 **빈가** — 그러면 앱이 옳다(읽었거나, 5분이 안 됐거나,
   설정이 꺼졌거나, 오늘 상한을 채웠다).
2. `email_budget.sent`가 **60인가** — 오늘 몫을 다 썼다. `emailed_at`을 찍지 않았으므로
   내일 간다.
3. Edge Function 로그(Studio → Functions → notify-digest) — `resend 실패`면 도메인
   인증·키를, `pending 조회 실패`면 마이그레이션 적용을 본다.
4. cron이 도는가 — 아래 쿼리. **`jobname`은 `cron.job_run_details`에 없다**(거기엔 `jobid`만
   있다 — 실측으로 `column "jobname" does not exist`에 걸렸다). 이름을 보려면 조인한다:
   ```sql
   select j.jobname, d.status, d.return_message, d.start_time, d.end_time
     from cron.job_run_details d join cron.job j on j.jobid = d.jobid
    order by d.start_time desc limit 10;
   ```
   ⚠️ **`status = succeeded`는 "알림이 갔다"는 뜻이 아니다.** pg_net 입장에서 성공은
   "HTTP 요청을 보냈다"까지라, 함수가 401(비밀 불일치)이나 500을 돌려줘도 초록으로
   찍힌다. 그래서 `return_message`를 함께 보고, 그래도 모르면 Edge Function 로그로 간다.

### 못 막는 것(밝혀 둔다)

- **발송에 실패하면 예산 한 통이 그냥 사라진다.** 환불 경로를 만들지 않은 이유는
  그것이 "실패를 무한 재시도로 증폭하지 않는" 값싼 브레이크이기도 하기 때문이다.
- **`emailed_at` 기록이 실패하면 같은 멘션이 다음 회차에 또 나간다.** 드물지만
  일어나면 사용자가 먼저 알아채므로 로그에 수신자를 남긴다.
- 로컬/데모 모드의 스위치는 **아무것도 바꾸지 않는다**(보낼 서버가 없다). 값을 들고
  있는 이유는 설정 화면이 모드마다 달라 보이지 않게 하려는 것뿐이다.

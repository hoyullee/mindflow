<!-- backend.md §24b — 색인: ../backend.md -->
## 24b. 처음 배포할 때 실제로 걸린 것들 (2026-09-15 실측)

§23·§24의 절차를 **사람이 처음 그대로 따라가 본** 기록이다. 다섯 군데에서 멈췄고,
전부 "코드는 맞는데 절차가 덜 친절해서" 생긴 일이었다. 다음 사람은 여기서 안 막힌다.

### ① 시크릿을 `$(openssl rand -hex 32)`로 **바로** 넣으면 안 된다

```bash
supabase secrets set DIGEST_SECRET=$(openssl rand -hex 32)   # ← 이렇게 하면 막힌다
```
값이 셸 안에서 만들어져 서버로 바로 들어가 **화면에 한 번도 보이지 않는다.** 그런데
같은 값을 cron SQL에 손으로 적어야 하고, `supabase secrets list`는 값을 **가려서**
보여 주므로 되찾을 수도 없다. 결과는 `401 {"error":"unauthorized"}`다(함수는 떠 있고
비밀도 설정돼 있는데 양쪽 값만 다른 상태).

**옳은 순서**: `openssl rand -hex 32`를 먼저 돌려 **값을 눈으로 보고**, 그 값을
`secrets set`과 cron SQL 양쪽에 붙여 넣는다.

### ② 시크릿을 바꾸면 함수를 **다시 배포**한다

`supabase secrets set` 뒤에 `supabase functions deploy <이름>`을 한 번 더 돌려야
새 값을 확실히 집어 간다.

### ③ Edge Function 로그는 **첫 호출 뒤에** 생긴다

"배포 직후 로그에 오류가 없는지 보라"는 순서가 거꾸로다 — 배포만으로는 한 줄도
쌓이지 않고, Deno는 **첫 요청에 함수를 부팅**하므로 import 오류조차 그때 드러난다.
로그가 비어 있는 것은 "아직 한 번도 안 불렸다"는 뜻이지 이상이 아니다.

### ④ 진단의 왕도는 `net._http_response`다

회차를 기다리지 말고 `net.http_post`로 한 번 쏜 뒤 응답을 읽으면 **한 번에 갈린다**:

| `status_code` / `content` | 뜻 | 할 일 |
| --- | --- | --- |
| `404` | 함수 미배포 | `supabase functions deploy` |
| `401 {"error":"unauthorized"}` | 배포됨 + 비밀 설정됨, **값만 불일치** | ①로 |
| `500 server not configured` | 배포됨, `DIGEST_SECRET` 미설정 | `secrets set` |
| `200 {"sent":0,"reason":"not-configured"}` | 비밀 통과, **API 키 없음** (digest=Resend / push=VAPID) | 해당 키 설정 |
| `200 {"sent":0,"candidates":0}` | ✅ 전부 정상, 지금 보낼 것이 없을 뿐 | 다음 단계 |
| `503`·`500` + `BOOT_ERROR` | 모듈이 안 뜬다(`npm:` 호환) | 아래 대안으로 |

```sql
select id, status_code, content, error_msg, created from net._http_response order by id desc limit 5;
```

**cron이 스스로 돈 회차인지 아는 법**: `created`가 `HH:00:00.xxx`/`HH:30:00.xxx`처럼
경계에 딱 붙어 있으면 cron이고, 그 아닌 시각이면 손으로 쏜 것이다.

### ⑤ Vercel은 `VITE_` 접두사에 `Secret` 타입을 **거부한다**

> Environment variables with a public framework prefix cannot use `visibility: secret`.

맞는 말이다 — `VITE_*`는 클라이언트 번들에 그대로 박히므로 숨겨진 값인 척할 수
없다. **Type을 `Config`로** 고르면 된다. 그리고 VAPID **공개** 키는 실제로 비밀이
아니다(브라우저가 구독할 때 그대로 싣는다). 비밀은 `VAPID_PRIVATE_KEY` 하나뿐이고
그건 Supabase 시크릿에만 넣는다.

**Turbo 캐시는 걱정하지 않아도 된다**: `turbo.json`에 `env`가 선언돼 있지 않지만,
Turbo 2의 Vite 프레임워크 추론이 `VITE_*`를 자동으로 해시 입력에 넣는다(그래서
`VITE_SUPABASE_URL`도 지금 정상 동작한다). 그래도 설정 행이 안 보이면 Redeploy에서
**"Use existing Build Cache"를 끄고** 다시 한다.

### ⑥ 재배포 뒤 **탭을 닫았다 열어야** 푸시가 온다

푸시를 받아 배너로 띄우는 코드는 **새 서비스 워커 안**에 있는데, 이 앱은 새 SW를
대기 상태로 두는 정책(`registerType: 'prompt'`)이라 열려 있던 탭은 옛 SW를 계속
쓴다. 옛 SW로 구독하면 푸시가 도착해도 처리할 핸들러가 없다. **"다 했는데 배너가
안 뜬다"의 1순위 원인이다.**

### ⑦ 설치형 앱에는 `멘션 푸시` 행이 **없다**(고장이 아니다)

`pushAvailable()`이 셸을 이름으로 걸러 내기 때문이다(위 "어디서는 아예 그리지
않는다"). 확인은 **브라우저에서** 해야 한다. 화면에 `앱을 닫아도 알림 받기`·
`로그인할 때 자동 실행`이 보이면 지금 보고 있는 것이 설치형 앱이다.

### ⑧ 시험할 때 **알림 센터를 누르지 않는다**

여는 순간 `markAllRead`가 돌아 전부 읽음 처리되고, 읽은 알림은 ①번 규칙으로 메일·
푸시 대상에서 빠진다. 그래서 "멘션했는데 `candidates:0`"이 된다. 대신 SQL로 심는다:

```sql
insert into public.notifications (recipient, kind, actor_name, doc_title, created_at)
values ((select id from auth.users where lower(email) = '<내 이메일>'),
        'mention', '테스트', '테스트 맵', now() - interval '10 minutes');
```
(`10 minutes` 과거로 심는 것은 **5분 유예**를 넘기려는 것이다.)

<!-- backend.md §24 — 색인: ../backend.md -->
## 24. 멘션 웹 푸시 (0040 `push_subscriptions` + Edge Function `notify-push`)

### 메일(§23)과 무엇이 다른가 — 조일 이유가 없다

| | 메일(§23) | 푸시(여기) |
| --- | --- | --- |
| 통당 비용 | Resend 한도를 인증·초대 메일과 **나눠 쓴다** | **0** |
| 묶음 | 30분마다 한 통 | 없음(1분 cron) |
| 유예 | 5분(읽을 틈) | 없음 — 지금 부르는 것이 존재 이유다 |
| 상한 | 수신자당 5통 · 전체 60통 | 없음 |
| 나이 컷 | 24시간 | **1시간**("한 시간 전 일"을 배너로 띄우는 건 소음이다) |

같은 겹은 하나다: **읽지 않았을 때만**. 그리고 `notification_prefs.push_mentions`.

### 왜 트리거가 아니라 1분 cron인가 (0024의 교훈)

알림 insert 트리거에서 `pg_net`으로 바로 쏘면 지연이 0이다. 그런데 이 저장소에는
**알림 트리거가 문서 저장을 통째로 굴린 사고**가 이미 있다(0024 — 멘션이 든 저장만
"변경됨"에서 멈췄다). 확장이 없거나 설정이 어긋나면 같은 일이 되풀이된다. cron은 그
위험이 **구조적으로 0**이고(저장 경로를 건드리지 않는다) 대가는 최대 1분의 지연뿐이다.

### 구독은 기기마다, 설정은 계정에

`push_subscriptions`의 한 행 = **한 브라우저**(엔드포인트가 그 정체라 unique —
같은 브라우저가 다시 구독하면 갱신된다). 켤지 말지는 계정(`push_mentions`)이
정하므로, 계정 설정을 끄면 구독이 남아 있어도 안 나간다.

설정 스위치 하나가 그 둘을 함께 움직인다 — 갈리면 "켜 뒀는데 안 온다"(구독 없음)나
"껐는데 온다"(다른 기기 구독이 살아 있음)가 되는데, 사용자에게는 둘 다 고장이다.

### 어디서는 아예 그리지 않는다

`PushManager`가 창에 **있으면서도** 구독이 실패하는 환경이 둘이다 — **설치형
셸**(Electron은 GCM 채널이 없다)과 **Capacitor WebView**(안드로이드 WebView의 FCM은
우리가 붙여야 한다). 이름으로 먼저 걸러 내지 않으면 설정에 눌러도 아무 일이 없는
스위치가 선다(`pushAvailable()`).

**설치형 셸의 빈자리는 따로 메웠다** — 아래 §24c. 모바일은 아직 비어 있고, 그쪽은
메일이 30분 뒤에 닿는다.
`VITE_VAPID_PUBLIC_KEY`가 없는 배포에서도 false다 — 키 없이는 구독 자체가 안 된다.

### 서비스 워커를 어떻게 얹었나

이 앱의 SW는 Workbox가 **생성한다**(`generateSW`) — 빌드마다 새로 쓰이므로 손댈 수
없다. 그래서 `workbox.importScripts: ['/push-sw.js']`로 우리 조각을 그 안에 끌어들이고,
같은 파일을 `globIgnores`로 프리캐시에서 뺐다(두 길로 관리하지 않는다).
`injectManifest`로 갈아타면 SW 전체를 우리가 떠안게 되므로 그 길은 피했다.

### 배포 절차 (셋 다 해야 푸시가 간다)

1. **VAPID 키 쌍**을 한 번 만든다(공개 키는 **비밀이 아니다** — 브라우저가 구독할 때
   그대로 싣는다):
   ```bash
   npx web-push generate-vapid-keys
   ```
2. **서버**: `supabase functions deploy notify-push` +
   ```bash
   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:noreply@geurio.com
   # DIGEST_SECRET은 §23에서 이미 설정돼 있다 — 두 함수가 **같은 비밀**을 쓴다.
   ```
3. **웹**: Vercel 환경변수 `VITE_VAPID_PUBLIC_KEY`에 공개 키를 넣고 **다시 배포한다**
   (빌드 시각에 번들로 들어간다 — 넣기 전 판에는 설정 행이 아예 없다).
   **Type은 `Secret`이 아니라 `Config`다** — Vercel이 공개 프레임워크 접두사에는
   Secret을 거부한다(§24b ⑤). 재배포 뒤에는 **탭을 전부 닫았다 열어야** 새 서비스
   워커가 붙는다(§24b ⑥ — 배너가 안 뜨는 1순위 원인).
4. **1분 cron**(Studio → SQL Editor):
   ```sql
   select cron.schedule(
     'geurio-mention-push',
     '* * * * *',
     $$
     select net.http_post(
       url     := 'https://<project-ref>.supabase.co/functions/v1/notify-push',
       headers := jsonb_build_object('Content-Type','application/json','x-digest-secret','<DIGEST_SECRET>'),
       body    := '{}'::jsonb,
       timeout_milliseconds := 30000   -- 기본 5초로는 구독 여럿에 쏘다 끊긴다(§23의 같은 이유)
     );
     $$
   );
   ```

키가 없으면 함수는 후보를 **읽지도 않고** 물러난다(`{ sent: 0, reason: 'not-configured' }`)
— 읽어서 `pushed_at`을 찍으면 키를 넣은 뒤 그 멘션들이 영영 안 나간다(§23과 같은 규칙).

### 확인 SQL

```sql
-- 지금 회차가 쏠 것
select recipient, total, doc_titles, document_id, jsonb_array_length(subs) subs
  from public.pending_mention_pushes();
-- 내 기기 목록
select endpoint, ua, created_at, last_ok_at, fail_count from public.push_subscriptions;
-- 쏜 표시
select recipient, kind, created_at, read_at, pushed_at, emailed_at
  from public.notifications order by created_at desc limit 20;
```

### 죽은 구독은 알아서 지워진다

푸시 서비스가 **404/410**을 주면 그 구독은 끝난 것이다(브라우저 데이터 삭제·앱 제거)
— 그 자리에서 지운다. 그 밖의 실패는 일시적일 수 있어 `fail_count`로 세고, 5번 연속
실패하면 지운다. 그래서 죽은 엔드포인트에 영원히 쏘는 일이 없다.

### ✅ 실기기에서 배달 확인됨 (2026-09-15)

**사용자가 브라우저에서 스위치를 켜고 다른 계정으로 멘션했을 때 배너가 떴다.**
이 한 번으로 이 환경에서 못 보던 구간이 전부 통과했다:
후보 고르기(`pending_mention_pushes`) → **`npm:web-push`가 Deno에서 실제로 동작**
(페이로드 aes128gcm 암호화 + VAPID 서명까지 — 아래 "함수가 아예 뜨지 않는 경우"로
적어 둔 위험이 **실현되지 않았다**) → 푸시 서비스 배달 → Workbox가 생성한 SW 안으로
`importScripts`된 `push-sw.js`가 배너 표시.

그러니 아래는 **"다시 만들 때 이 환경에서는 여전히 못 본다"**는 뜻으로만 읽으면 된다.

#### 이 환경에서 확인할 수 없는 것 (개발 중에는 갈라서 확인한다)

**실제 배달은 헤드리스로 검증할 수 없다.** 크로뮴은 `Notification.permission`이 늘
`denied`라(`probe-pitfalls.md` E2) `pushManager.subscribe()`가
`AbortError: Registration failed - permission denied`로 끝난다 — 실측했다
(`--headless=new`로도 같았다). 코드 쪽에서 확인할 수 있는 것은 여기까지다:

- 후보 고르기 SQL 5종(로컬 Postgres 하네스)
- 클라이언트 구독 모듈 8종(키 변환·권한 갈래·재사용·해제·셸 제외)
- `push-sw.js` 4종(배너·빈 페이로드 폴백·열린 창 재사용·새 창)
- 생성된 SW에 `importScripts("/push-sw.js")`가 실제로 들어가는지(빌드 산출물)

**되짚을 때의 순서**(안 뜨면): ① `pending_mention_pushes()`가 비었나
② Functions 로그에 `발송 실패`가 있나(VAPID 키·`VAPID_SUBJECT` 형식)
③ `push_subscriptions`에 내 기기 행이 있나 ④ cron이 도는가
(§23의 조인 쿼리 — `jobname`은 `cron.job`에만 있다. `status = succeeded`가 배달을
뜻하지 않는다는 주의도 그쪽에 있다).

**함수가 아예 뜨지 않는 경우도 하나 있다**(배포 직후 로그에 import 오류): 이 함수는
`npm:web-push`를 쓰는데, 그 패키지는 Node용이라 Deno의 node 호환 계층에 기댄다.
Supabase Edge Runtime에서 그것이 깨지면 **함수 자체가 로드되지 않아** cron이 조용히
헛돈다(알림이 0건인 것과 구분이 안 된다 — 그래서 로그를 먼저 본다). 직접 암호화를
구현하지 않고 이 패키지를 고른 이유는 RFC 8291(aes128gcm)을 손으로 짜면 **이 환경에서
검증할 방법이 없기 때문**이다(위의 E2). 깨지면 갈아탈 곳은 Deno 네이티브 대안
(`jsr:@negrel/webpush`)이고, 바꿀 자리는 `notify-push/index.ts`의 import와
`sendNotification` 호출 두 줄뿐이다.

### 푸시와 메일이 겹칠 때

푸시를 받고 **열어 보지 않으면** 30분 뒤 메일도 간다(`read_at`이 그대로이므로).
일부러 그렇게 뒀다 — 배너를 흘려보내는 일이 흔하고, 그때 메일이 마지막 그물이다.
열어서 알림 센터가 읽음 처리하면 메일은 오지 않는다.

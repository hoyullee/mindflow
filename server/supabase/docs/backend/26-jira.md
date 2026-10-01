# §26 Jira 연결 (0044 `jira_credentials`·`user_tool_prefs` + Edge Function `jira`) — 도구 · 작업 현황

> 화면: 홈 LNB **도구** 구획 → `작업 현황`(Jira 에픽·티켓을 달력·타임라인·집계로). 스펙은 디자인
> 원본의 `홈-도구-스펙.md`·`도구-작업현황-스펙.md`. 코드: `apps/web/src/features/tools/`.

## 무엇이 어디에 사나

| 것 | 자리 | 누가 읽고 쓰나 |
|---|---|---|
| refresh/access token, 고른 사이트·프로젝트, 시작일 필드 | `public.jira_credentials` | **Edge Function만**(RLS on, 정책 없음, GRANT 회수 — 0035와 같은 규칙) |
| LNB 표시·이름, 담당자 목록(끈 사람·더한 사람), 휴일 설정 | `public.user_tool_prefs`(`owner` = `auth.uid()`) | 클라이언트(본인 행만 — 0004와 같은 정책) |
| 에픽·티켓 내용 | **어디에도 저장하지 않는다** | 함수가 조회해 줄인 모양으로 돌려준다(브라우저 메모리 5분 캐시) |

`user_tool_prefs`를 워크스페이스 블롭에 싣지 않은 이유: 그 블롭은 저장소 두 곳·서명 세 자리가 필드를
나열해 들고 다녀 하나만 빠져도 조용히 지워진다. 그리고 **연결을 해제해도 이름·표시·휴일은 남아야**
한다(재연결 때 되살아난다) — 그래서 자격 증명 행과도 떨어져 있다.

## 왜 모든 조회가 함수를 지나나

Jira REST(`api.atlassian.com/ex/jira/{cloudId}/…`)는 **브라우저 호출(CORS)을 받지 않는다**. 구글처럼
액세스 토큰만 내려 주고 브라우저가 부르는 설계가 불가능하다. 그래서 토큰은 한 번도 브라우저로 나가지
않고, 함수는 **정해진 질문만** 받는다(임의 경로 프록시가 아니다):

| action | 하는 일 |
|---|---|
| `authorize` | 동의 화면 주소(스코프 `read:jira-work read:jira-user offline_access`, `state` = HMAC(uid.ts)) |
| `exchange` | 코드 → 토큰, 사이트 목록. 사이트가 하나면 곧바로 고른다 |
| `status` · `sites` · `select-site` | 연결 상태 / 사이트 고르기(바뀌면 프로젝트·시작일 필드를 비운다) |
| `projects` · `save-projects` | 프로젝트 검색 / 저장(최대 30) — 저장할 때마다 시작일 필드를 다시 찾는다 |
| `issues {from,to}` | 그 기간에 걸친 **에픽의 자식 티켓**(`/rest/api/3/search/jql`, 100×10쪽 상한) + 에픽 날짜 |
| `users {query}` | 담당자 추가용 사용자 검색(앱·비활성 계정 제외) |
| `disconnect` | 자격 증명 행 삭제(Atlassian에는 3LO 토큰 폐기 API가 없다 — 승인까지 거두려면 Atlassian 계정 설정 › 연결된 앱) |

순수한 부분(JQL·응답 정리·시작일 필드 고르기)은 `supabase/functions/_shared/jira.ts`이고 웹 쪽 vitest가
검사한다(`apps/web/src/features/tools/jira/jiraShared.test.ts`).

## 구글과 다른 점 — refresh token이 **회전한다**

Atlassian은 갱신할 때마다 새 refresh token을 주고 옛 것을 폐기한다. 탭 두 개가 동시에 갱신하면 늦은 쪽이
폐기된 토큰을 쓴다. 그래서 갱신 결과는 `version`을 조건으로 건 UPDATE로 적고(낙관적 잠금), 0행이면 이긴
쪽이 적은 액세스 토큰을 다시 읽어 쓴다(`accessTokenFor`). `invalid_grant`면 행을 지우고 `revoked` —
화면은 "다시 연결"을 말하고 LNB 상태 점이 주황이 된다. 90일 동안 안 쓰면 Atlassian이 토큰을 만료시킨다(같은 길).

## 데이터 규칙(결정 2026-09-30)

- 프로젝트는 **연결할 때 고른다**(`/auth/jira` → `/home?jira=setup` → 프로젝트 고르기). 나중에 설정 › 계정 설정 › 도구의 `프로젝트 N개 ›`.
- 시작일 필드는 사이트마다 다르다(`customfield_10015` 등) — `/rest/api/3/field`에서 날짜형 필드 중 `Start date`(번역 이름 포함) → `Target start` → 이름에 start·시작이 든 것 순.
- **날짜 기준은 사용자가 고른다**(0045 · 2026-10-01 — 프로젝트 고르기의 `날짜 기준` 칸). 시작 = 커스텀 날짜 필드 · `만든 날짜`(created) · 없음, 끝 = `기한`(duedate, 기본) · `해결된 날짜`(resolutiondate — 아직이면 오늘까지) · 커스텀 날짜 필드. 처음엔 자동으로 찾은 시작일 필드를 채워 둔다(함수 `fields`).
- **시작이 없으면 끝 하루**로 그린다(생성일로 두면 몇 달짜리 막대가 되어 진행 일수가 부푼다 — 그래서 만든 날은 고를 때만). 끝이 없으면 시작 하루. 둘 다 없으면 `fill_dates`(기본 켬)일 때 **만든 날 ~ 해결된 날(아직이면 오늘)**, 꺼져 있으면 뺀다. 열린 끝은 JQL이 넉넉히 부르고 정리 뒤 `overlaps`로 마지막 판정. 오늘은 클라이언트가 보낸다(`issues { today }` — 서버는 시간대를 모른다).
- **상태도 고른다**(0047 `issue_statuses` — `Jira 설정`의 `상태` 칩, 비우면 전부). 함수 `statuses`가 프로젝트별 `GET /rest/api/3/project/{key}/statuses`를 모으고(고른 이슈 유형이 있으면 그 유형의 상태만 · 하위 작업 유형 제외) 화면은 이름으로 묶고 JQL은 id로(`status in (…)`).
- **티켓 상세**(함수 `issue` — 상세 팝업): `GET /issue/{key}?expand=names,schema&fields=*all` + 최근 댓글 셋(`/comment?orderBy=-created&maxResults=3`) + 에픽이면 하위 티켓(`parent = KEY`, 100건). 정리는 `_shared/jiraDetail.ts`(ADF → 줄글 · 「모든 필드」는 스키마로 모양을 고르고 빈 필드는 개수만 · 순위·스프린트 내부값은 뺀다). **저장하지 않는다**(열 때마다 · 브라우저 탭에서 1분 캐시) · 사람은 이름·accountId만. 404는 `not-found`.
- **배포 예정일**(0046 `release_field` — 커스텀 날짜 필드·기한·표시 안 함, 이름에 `배포`·`release`가 든 필드를 처음에 채워 둔다). 막대(시작~끝)는 바꾸지 않고 **표시만**: 달력 칸의 `배포` 줄 · 타임라인 마름모 · 패널의 `이 날 배포 예정`.
- **이슈 유형도 고른다**(0045 `issue_types` — 프로젝트 고르기의 `이슈 유형` 칩, 비우면 전부). 함수 `issue-types`가 `GET /rest/api/3/project/{key}`의 유형을 모아 주고(하위 작업·에픽 제외), 팀 관리 프로젝트는 같은 이름이 프로젝트마다 다른 id라 화면은 **이름으로 묶고** 저장·JQL은 **id로**(`issuetype in (10146, …)` — 이름을 JQL에 넣지 않는다).
- 하위 작업(sub-task)과 에픽 자신은 뺀다(`standardIssueTypes()` + 응답의 계층). **에픽이 없는 티켓은 티켓 자신이 묶음**(`JiraEpic.solo` — 달력 칩·타임라인 줄이 티켓 하나씩. 처음엔 프로젝트로 묶었다가 "프로젝트 이름만 보이고 티켓이 그 아래로 숨는다"는 제보로 바꿨다). 집계 표만 `에픽 없는 티켓` 한 열로 접는다(`foldSolo`). 예전엔 `parent is not EMPTY`라 에픽을 안 쓰는 비즈니스 프로젝트가 통째로 비었다(제보 2026-10-01).
- 휴일은 **개인 설정**이고 공휴일은 앱이 들고 있는 표(`workstatus/holidays.ts`, 한국·미국·일본 2025–2032)다.

## 배포 — 한 번만

1. **Atlassian developer console**(developer.atlassian.com › Console) › Create › OAuth 2.0 integration.
   - Permissions › Jira API: `read:jira-work`, `read:jira-user`(classic).
   - Authorization › **Callback URL**: `https://<앱 주소>/auth/jira`(여러 개면 줄마다 — 로컬 개발은 `http://localhost:5173/auth/jira`).
   - Distribution: **Sharing을 켜야 나 말고 다른 사람이 연결할 수 있다** — 공유하지 않은 3LO 앱은 **만든 사람 한 명만** 승인할 수 있다(같은 조직의 동료도 막힌다). 켤 때 개인정보 선언을 묻는다: 우리는 티켓 내용을 저장하지 않지만 `user_tool_prefs.work.extra`에 **직접 더한 담당자의 accountId·이름**이 남으므로 "개인정보를 저장하는가" → **예**, 그러면 Personal Data Reporting API 주기 보고가 요구된다(**구현됨** — 아래 「개인정보 보고」). 개인정보처리방침 주소는 `https://geurio.com/privacy`.
2. Supabase secrets: `supabase secrets set ATLASSIAN_CLIENT_ID=… ATLASSIAN_CLIENT_SECRET=…`
3. 함수 배포(손으로): `supabase functions deploy jira` — `_shared/`는 함께 묶여 올라간다.
4. 마이그레이션 0044는 main 머지에 자동 적용.

시크릿이 없으면 함수는 200 `{ok:false, reason:'not-configured'}` — LNB 도구 관리의 `연결`은 "Jira 연결이 아직 준비 중이에요"라고 말할 뿐 깨지지 않는다. 로컬·데모 모드(Supabase 없음)는 `jiraDemo.ts`가 프로토타입의 샘플 데이터를 오늘이 든 달로 옮겨 답한다.

## 설치형 앱

동의는 **시스템 브라우저**에서 끝나고, 인가 코드는 딥링크로 앱에 돌아온다(구글 캘린더와 같은 길 — `desktopJira.ts`).
예전 판은 브라우저의 `/auth/jira`가 교환까지 하고 **웹 홈으로 가 버려** 앱으로 돌아오지 못했다(제보 2026-10-01).

1. 앱이 `authorize { desktop: true }`를 부르면 서버가 `state`를 `d.<ts>.<sig>`로 서명한다(표시도 서명 안 — 떼거나 붙이면 교환 거절).
2. 앱은 동의 주소를 `openExternal`로 열고, 그 주소의 `state`를 기억한다.
3. 브라우저의 `/auth/jira`는 `state`가 `d.`면 **교환하지 않고** `geurio://jira?code=…&state=…`로 앱을 깨운다(「Geurio 앱으로
   돌아가세요」 — `DesktopHandoff kind="jira"`). 이 갈래는 문지기 **밖**이다 — 브라우저가 로그인돼 있을 필요가 없다.
4. 앱은 **기억한 `state`와 같을 때만** 받아(딥링크는 아무나 쏠 수 있다) 자기 세션으로 `exchange` → 작업 현황 + (필요하면) 프로젝트 고르기.

배포 순서와 무관하다: 함수가 옛 판이면 `desktop` 표시를 무시해 `state`에 `d.`가 없고, 브라우저가 예전처럼 교환한다(앱 복귀만 안 될 뿐 깨지지 않는다).

## 개인정보 보고 (Edge Function `jira-privacy` — Sharing + "개인정보 저장: Yes"의 의무)

우리가 저장하는 Atlassian 사용자 정보는 `user_tool_prefs.data.work`의 두 칸이다 — `extra`(직접 더한 담당자
`{id, name, at}`)와 `hidden`(끈 담당자의 accountId). 기기를 바꿔도 따라오게 서버에 둔다(결정 2026-09-30).
그 대가로 Atlassian **Personal Data Reporting API**에 주기적으로(기본 7일) 보고한다.

- 호출: `POST https://api.atlassian.com/app/report-accounts/`, 본문 `{accounts:[{accountId, updatedAt}]}`(한 번에 90개),
  인증은 **사용자의 3LO 액세스 토큰**. 204 = 할 일 없음 / 200 = `accounts[{accountId, status}]`(`closed` | `updated`) / 429 = 다음 회차.
- `closed` → **모든 사람의** `extra`·`hidden`에서 지운다. `updated` → 그 담당자를 더한 사람의 사이트에서 이름을 새로 받는다
  (못 받으면 그대로 — 다음 회차에 다시 온다).
- 토큰은 **연결된 사람 아무나**의 것을 쓴다 → 연결을 해제한 사람의 목록도 보고된다(재연결 때 목록이 남는 이유 — 결정 2026-09-30).
  연결된 사람이 한 명도 없으면 보고할 수 없다(`reason: no-token` 로그) — 그 상태로 오래 두지 않는다.
- `updatedAt`은 `extra[].at`(추가하거나 이름을 새로 받은 시각). 옛 항목처럼 없으면 그 행의 `updated_at`.
- 순수한 부분은 `_shared/jiraPrivacy.ts`(웹 vitest `jiraPrivacy.test.ts`), 토큰 갱신은 `_shared/jiraAuth.ts`(두 함수가 공유 — 회전하는 refresh token의 낙관적 잠금이 한 곳에 있어야 한다).

### 배포 — 한 번만
1. `supabase functions deploy jira-privacy --project-ref qdzfonyqysbbchxotnrm`(`verify_jwt = false`는 `config.toml`). `jira`도 공용 모듈이 바뀌었으니 한 번 더 `deploy jira`.
2. 새 비밀은 없다 — 멘션 메일의 `DIGEST_SECRET`을 같은 헤더(`x-digest-secret`)로 쓴다.
3. **주 2회 cron**(Studio › SQL Editor에서 한 번 — 7일 주기에 한 번 실패해도 다음 회차가 주기 안에 든다):
   ```sql
   select cron.schedule(
     'geurio-jira-privacy',
     '17 3 * * 1,4',
     $$
     select net.http_post(
       url     := 'https://qdzfonyqysbbchxotnrm.supabase.co/functions/v1/jira-privacy',
       headers := jsonb_build_object('Content-Type', 'application/json',
                                     'x-digest-secret', '<DIGEST_SECRET과 같은 값>'),
       body    := '{}'::jsonb,
       timeout_milliseconds := 60000
     );
     $$
   );
   ```
   `pg_cron`·`pg_net`은 멘션 메일(§23) 때 이미 켰다. 지우려면 `select cron.unschedule('geurio-jira-privacy');`.
4. 한 번 손으로 돌려 확인: 위 `net.http_post(...)` 한 줄만 SQL Editor에서 실행 → Edge Functions › `jira-privacy` › Logs에
   `[jira-privacy] {"ok":true,...}`. 저장된 담당자가 없으면 `reported: 0`이 정상이다.

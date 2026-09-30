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
- **시작일이 없으면 기한 하루**로 그린다(생성일로 두면 몇 달짜리 막대가 되어 진행 일수가 부푼다). 기한이 없으면 시작일 하루. 둘 다 없으면 JQL에서부터 뺀다.
- 하위 작업(sub-task)은 뺀다 — 부모가 에픽 계층인 표준 이슈만(`issuetype in standardIssueTypes() AND parent is not EMPTY`).
- 휴일은 **개인 설정**이고 공휴일은 앱이 들고 있는 표(`workstatus/holidays.ts`, 한국·미국·일본 2025–2032)다.

## 배포 — 한 번만

1. **Atlassian developer console**(developer.atlassian.com › Console) › Create › OAuth 2.0 integration.
   - Permissions › Jira API: `read:jira-work`, `read:jira-user`(classic).
   - Authorization › **Callback URL**: `https://<앱 주소>/auth/jira`(여러 개면 줄마다 — 로컬 개발은 `http://localhost:5173/auth/jira`).
   - Distribution: **Sharing을 켜야 나 말고 다른 사람이 연결할 수 있다** — 공유하지 않은 3LO 앱은 **만든 사람 한 명만** 승인할 수 있다(같은 조직의 동료도 막힌다). 켤 때 개인정보 선언을 묻는다: 우리는 티켓 내용을 저장하지 않지만 `user_tool_prefs.work.extra`에 **직접 더한 담당자의 accountId·이름**이 남으므로 "개인정보를 저장하는가" → **예**, 그러면 Personal Data Reporting API 주기 보고가 요구된다(운영 백로그 ⑦). 개인정보처리방침 주소는 `https://geurio.com/privacy`.
2. Supabase secrets: `supabase secrets set ATLASSIAN_CLIENT_ID=… ATLASSIAN_CLIENT_SECRET=…`
3. 함수 배포(손으로): `supabase functions deploy jira` — `_shared/`는 함께 묶여 올라간다.
4. 마이그레이션 0044는 main 머지에 자동 적용.

시크릿이 없으면 함수는 200 `{ok:false, reason:'not-configured'}` — LNB 도구 관리의 `연결`은 "Jira 연결이 아직 준비 중이에요"라고 말할 뿐 깨지지 않는다. 로컬·데모 모드(Supabase 없음)는 `jiraDemo.ts`가 프로토타입의 샘플 데이터를 오늘이 든 달로 옮겨 답한다.

## 설치형 앱

셸은 바깥 주소를 시스템 브라우저로 넘긴다(`will-navigate`). 그래서 동의·교환은 **브라우저에서** 끝나고
(그 브라우저가 같은 계정으로 로그인돼 있어야 한다 — 아니면 로그인 뒤 이어진다), 앱은 창에 포커스가 돌아올 때
`status`를 다시 묻는다. `state`는 서버 서명이라 브라우저 저장소에 기대지 않는다.

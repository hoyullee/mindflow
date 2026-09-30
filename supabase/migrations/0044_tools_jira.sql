-- Jira 연결(도구 · 작업 현황) — Atlassian OAuth 2.0(3LO) 자격 증명을 서버가 보관한다.
--
-- 구글 캘린더(0035)와 같은 설계다: 브라우저는 **인가 코드**만 받아 Edge Function
-- (`jira`)에 넘기고, 함수가 client secret으로 교환해 refresh token을 여기에 적는다.
-- Jira REST는 브라우저 호출(CORS)을 받지 않으므로 **모든 조회도 그 함수가 대신** 한다 —
-- 그래서 액세스 토큰까지 이 표에 둔다(브라우저로는 한 번도 나가지 않는다).
--
-- ── 구글과 다른 점: refresh token이 **회전한다** ──────────────────────────
-- Atlassian은 갱신할 때마다 새 refresh token을 주고 옛 것을 폐기한다. 탭 두 개가
-- 동시에 갱신하면 늦게 도착한 쪽이 이미 폐기된 토큰을 쓰게 되므로, 갱신은
-- `version`을 조건으로 건 한 번의 UPDATE(낙관적 잠금)로 한다 — 진 쪽은 이긴 쪽이
-- 적어 둔 액세스 토큰을 다시 읽어 쓴다(함수의 `accessTokenFor`).
--
-- ── 클라이언트 정책은 하나도 두지 않는다(0035와 같은 이유) ─────────────────
-- 사이트·프로젝트 같은 표시용 값도 함수가 `status`로 돌려준다 — 표를 열어 줄 까닭이 없다.

create table if not exists public.jira_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  refresh_token text not null,
  access_token text,
  access_expires_at timestamptz,
  -- 낙관적 잠금 — 갱신 한 번마다 1씩 오른다(위 머리말).
  version integer not null default 0,
  scope text,
  -- 고른 사이트(v1은 하나). `cloud_id`가 API 경로의 열쇠, `site_url`은 표시·이슈 링크용.
  cloud_id text,
  site_url text,
  site_name text,
  -- 연결할 때 고른 프로젝트 — `[{ "key": "PAY", "name": "결제" }]`.
  projects jsonb not null default '[]'::jsonb,
  -- 시작일로 쓸 필드(`customfield_10015` 등 — 사이트마다 다르다). 못 찾았으면 null이고,
  -- 그때 티켓은 기한 하루짜리로 그린다(작업 현황 스펙 §2.1 · 결정 2026-09-30).
  start_field text,
  start_field_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.jira_credentials enable row level security;
revoke all on public.jira_credentials from anon, authenticated;

comment on table public.jira_credentials is
  'Jira(Atlassian 3LO) 자격 증명 · 고른 사이트와 프로젝트 — Edge Function(jira)만 접근. 클라이언트 정책 없음.';

-- ── 도구 설정(사용자별) ───────────────────────────────────────────────
-- LNB 도구 목록의 표시·이름, 작업 현황의 담당자 목록과 **휴일·영업일 설정**(개인 단위 —
-- 결정 2026-09-30). 자격 증명과 따로 두는 이유: 연결을 해제해도 이름·표시·휴일은
-- 남아야 한다(도구 스펙 §7 "재연결 시 복구"). 워크스페이스 블롭에 싣지 않은 이유:
-- 그 블롭은 저장소 두 곳과 서명 세 자리가 필드를 나열해 들고 다녀(`useHomeController`)
-- 필드 하나가 빠지면 조용히 지워진다 — 한 기능의 설정은 제 표에 둔다.
-- 비밀이 아니므로 0004(workspaces)와 같은 "본인 행만" 정책이다.

create table if not exists public.user_tool_prefs (
  owner uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_tool_prefs enable row level security;

drop policy if exists "user_tool_prefs_select_own" on public.user_tool_prefs;
create policy "user_tool_prefs_select_own" on public.user_tool_prefs
  for select using (auth.uid() = owner);

drop policy if exists "user_tool_prefs_insert_own" on public.user_tool_prefs;
create policy "user_tool_prefs_insert_own" on public.user_tool_prefs
  for insert with check (auth.uid() = owner);

drop policy if exists "user_tool_prefs_update_own" on public.user_tool_prefs;
create policy "user_tool_prefs_update_own" on public.user_tool_prefs
  for update using (auth.uid() = owner) with check (auth.uid() = owner);

drop trigger if exists user_tool_prefs_set_updated_at on public.user_tool_prefs;
create trigger user_tool_prefs_set_updated_at
  before update on public.user_tool_prefs
  for each row execute function public.set_updated_at();

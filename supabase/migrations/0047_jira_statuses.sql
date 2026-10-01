-- Jira 작업 현황 — **고른 상태의 티켓만** 본다(사용자 요청 2026-10-01: "모든 상태의 티켓이 나온다 —
-- 프로젝트의 티켓이 가질 수 있는 상태를 읽어 보여 주고, 필요한 상태만 고르게").
-- `[{ "id": "10214", "name": "진행 중" }]`, 비어 있으면 전부. 이슈 유형(0045)처럼 팀 관리 프로젝트는
-- 같은 이름이 프로젝트마다 다른 id라 화면은 이름으로 묶고 저장·JQL은 id로(`status in (…)`).

alter table public.jira_credentials
  add column if not exists issue_statuses jsonb not null default '[]'::jsonb;

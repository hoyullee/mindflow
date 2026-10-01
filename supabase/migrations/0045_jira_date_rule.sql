-- Jira 작업 현황 — **어느 날짜로 그릴지**를 사용자가 고른다(0044의 시작일 자동 감지를 넘어서).
--
-- 제보(2026-10-01): 프로젝트를 골랐는데 달력·타임라인·집계가 텅 비었다. 그 사이트의 업무
-- 프로젝트(비즈니스 템플릿)는 에픽이 없고 시작 날짜·기한도 거의 비어 있었다 — 우리는
-- `에픽의 자식 + 기한(또는 시작일)이 그 달 안`만 불러왔다. 에픽 조건은 함수에서 풀었고
-- (에픽이 없으면 프로젝트로 묶는다), 날짜는 여기 세 칸으로 고르게 한다.
--
-- - `start_field`(0044)는 이제 `created`(만든 날)도 받는다.
-- - `end_field`: 끝 날짜 — null이면 기한(`duedate`). `resolutiondate`(해결된 날)·커스텀 날짜 필드.
-- - `fill_dates`: 두 날짜가 다 비면 **만든 날 ~ 해결된 날(아직이면 오늘)**로 그린다.
--   기본 켬 — 날짜를 안 쓰는 팀도 연결하자마자 무언가 보인다(끄면 0044의 동작 그대로).

alter table public.jira_credentials
  add column if not exists end_field text,
  add column if not exists end_field_name text,
  add column if not exists fill_dates boolean not null default true;

-- 이슈 유형(같은 라운드 — 사용자 요청): 고른 유형만 부른다. `[{ "id": "10146", "name": "품질점검" }]`,
-- 비어 있으면 전부(하위 작업·에픽은 늘 빠진다). 팀 관리 프로젝트는 유형이 **프로젝트마다 다른 id**라
-- 화면은 이름으로 묶어 보이고 저장은 id로 한다(JQL에 이름을 넣지 않는다 — 따옴표·번역 문제).
alter table public.jira_credentials
  add column if not exists issue_types jsonb not null default '[]'::jsonb;

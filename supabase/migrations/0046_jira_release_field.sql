-- Jira 작업 현황 — **배포 예정일**로 보일 필드(사용자 요청 2026-10-01: "시작일·기한·배포 예정일을 어떤
-- 필드로 보여 줄지 우리가 고르게"). 시작·끝(0045)과 같은 자리(프로젝트 고르기의 날짜 기준)에서 고른다.
-- 막대(시작~끝)는 바꾸지 않고 표시만 한다 — 달력 칸의 배포 표시 · 타임라인의 마름모 · 패널의 날짜.
-- null이면 표시하지 않는다.

alter table public.jira_credentials
  add column if not exists release_field text,
  add column if not exists release_field_name text;

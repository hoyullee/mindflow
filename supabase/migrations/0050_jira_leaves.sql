-- Jira 작업 현황 — **담당자 휴가**(스펙 `작업 현황 · 담당자 휴가`).
--
-- Jira에 없는 "이 사람이 언제 쉬는지"를 우리가 든다. 달력·타임라인·집계·일정 맞춰보기가
-- 그 사람의 영업일에서 휴가를 빼서 센다(계산은 화면 — `workstatus/model.ts`).
--
-- ── 누가 보나(결정 2026-10-02) ───────────────────────────────────────────
-- **같은 Jira 사이트(`cloud_id`)를 연결한 그리오 사용자 모두**가 본다 — 팀장이 대신 입력하는
-- 일이 많고, 일정 계산은 팀이 같이 봐야 뜻이 있다. 사이트는 호출자의 `jira_credentials`에서
-- 읽는다(클라이언트가 보낸 값을 믿지 않는다 — `my_jira_cloud()`).
-- **등록은 누구나, 수정·삭제는 등록한 사람만**(사용자 결정 "A+2").
--
-- ── 개인정보 ─────────────────────────────────────────────────────────────
-- `person`은 Atlassian accountId — 개인정보 보고(`jira-privacy`)가 이 표의 사람도 보고하고,
-- 닫힌 계정의 휴가는 지운다. 이름은 표시용 스냅샷(이름이 바뀌면 보고가 고친다).

create table if not exists public.jira_leaves (
  id uuid primary key default gen_random_uuid(),
  cloud_id text not null,
  person text not null check (char_length(person) between 1 and 128),
  person_name text not null default '' check (char_length(person_name) <= 120),
  start_date date not null,
  end_date date not null,
  kind text not null default 'full' check (kind in ('full', 'am', 'pm')),
  note text not null default '' check (char_length(note) <= 60),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint jira_leaves_range check (start_date <= end_date and end_date - start_date <= 366),
  -- 반차는 하루짜리만(여러 날에 걸친 반차는 뜻이 없다).
  constraint jira_leaves_half_day check (kind = 'full' or start_date = end_date)
);

create index if not exists jira_leaves_site_idx on public.jira_leaves (cloud_id, end_date, start_date);
create index if not exists jira_leaves_person_idx on public.jira_leaves (cloud_id, person);

drop trigger if exists jira_leaves_set_updated_at on public.jira_leaves;
create trigger jira_leaves_set_updated_at before update on public.jira_leaves
  for each row execute function public.set_updated_at();

-- 호출자가 연결한 Jira 사이트. `jira_credentials`는 클라이언트에 닫혀 있어(0044) 정의자 권한으로 읽는다.
create or replace function public.my_jira_cloud()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select cloud_id from public.jira_credentials where user_id = auth.uid()
$$;
revoke all on function public.my_jira_cloud() from public, anon;
grant execute on function public.my_jira_cloud() to authenticated;

-- ── 겹침 막기 ────────────────────────────────────────────────────────────
-- 같은 사이트·같은 사람의 휴가가 겹치면 거절(`leave-overlap`). 예외 하나: **같은 날의 오전 + 오후 반차**
-- (= 종일과 같다 — 스펙 §10). 한 사람이 동시에 두 기기에서 넣는 경합은 드물어 잠금 없이 둔다.
create or replace function public.jira_leaves_check_overlap()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (
    select 1 from public.jira_leaves l
    where l.cloud_id = new.cloud_id
      and l.person = new.person
      and l.id <> new.id
      and l.start_date <= new.end_date
      and l.end_date >= new.start_date
      and not (
        l.kind <> 'full' and new.kind <> 'full' and l.kind <> new.kind
        and l.start_date = new.start_date and l.end_date = new.end_date
      )
  ) then
    raise exception 'leave-overlap' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists jira_leaves_overlap on public.jira_leaves;
create trigger jira_leaves_overlap before insert or update on public.jira_leaves
  for each row execute function public.jira_leaves_check_overlap();

-- ── 정책 ────────────────────────────────────────────────────────────────
alter table public.jira_leaves enable row level security;
revoke all on public.jira_leaves from anon;
grant select, insert, update, delete on public.jira_leaves to authenticated;

drop policy if exists "jira_leaves_select" on public.jira_leaves;
create policy "jira_leaves_select" on public.jira_leaves
  for select to authenticated
  using (cloud_id = public.my_jira_cloud());

-- 등록: 내 사이트에만, 내 이름으로만(`created_by` 기본값이 호출자 — 남의 이름으로 못 넣는다).
drop policy if exists "jira_leaves_insert" on public.jira_leaves;
create policy "jira_leaves_insert" on public.jira_leaves
  for insert to authenticated
  with check (cloud_id = public.my_jira_cloud() and created_by = auth.uid());

-- 수정·삭제: **등록한 사람만**. 수정으로 사이트·등록자를 바꿀 수도 없다.
drop policy if exists "jira_leaves_update" on public.jira_leaves;
create policy "jira_leaves_update" on public.jira_leaves
  for update to authenticated
  using (created_by = auth.uid() and cloud_id = public.my_jira_cloud())
  with check (created_by = auth.uid() and cloud_id = public.my_jira_cloud());

drop policy if exists "jira_leaves_delete" on public.jira_leaves;
create policy "jira_leaves_delete" on public.jira_leaves
  for delete to authenticated
  using (created_by = auth.uid() and cloud_id = public.my_jira_cloud());

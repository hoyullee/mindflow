-- MindFlow — Geurio 일정(캘린더 전용 일정).
--
-- 일정 화면은 지금까지 **칸반 카드의 마감**만 모았다. 칸반에 없는 일정(회의·휴가·
-- 개인 약속)을 적을 자리가 없어서, 사용자는 "일정 하나 적으려고" 칸반 카드를
-- 만들어야 했다.
--
-- ## 왜 별도 표인가 (문서 본문이 아니라)
--
-- ① **사람에 붙는다** — 캘린더는 문서가 아니라 per-user 뷰다(PR1의 설계 결정).
--    문서 본문(jsonb)에 넣으면 "누구의 일정인가"에 답이 없고 스페이스·공유에 얽힌다.
-- ② **수명이 다르다** — 문서를 지워도 내 일정은 남아야 한다.
-- ③ **본문은 자동저장마다 통째로 오간다**(0020 댓글과 같은 이유) — 일정이 늘수록
--    저장·전송이 무거워지고, CRDT 병합 대상이 되어 끊긴 채 양쪽이 적으면 한쪽이 사라진다.
--
-- ## 범위 (v1)
--
-- **종일 또는 시각 있는 하루/여러 날 일정**까지다. 반복은 넣지 않았다(사용자 결정) —
-- 반복은 저장 모양(RRULE)·예외 처리·표시 전개가 함께 와야 하고, 그 전에 "적을 자리"가
-- 먼저 필요하다. 알림·참석자·회의실은 구글 연동 단계에서 다룬다.
--
-- 구글 캘린더는 **선택적 거울**이라는 결정에 따라 `source`/`google_id`를 미리 둔다 —
-- 우리 표가 정본이고, 연동되면 그 일정을 여기에 미러링하거나 겹쳐 그린다.

create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null default '',
  -- 날짜는 **로컬 날짜 문자열**(`YYYY-MM-DD`)이다. 칸반 `due`/`start`가 그 꼴이고,
  -- 여기에 타임존을 끌어들이면 같은 일정이 기기마다 다른 날에 놓인다(종일 일정의
  -- 고전적 함정). 시각은 아래 `start_time`/`end_time`이 따로 든다.
  start_date date not null,
  -- 여러 날 일정의 마지막 날(포함). 하루면 `start_date`와 같다.
  end_date date not null,
  -- 종일인가 — 참이면 시각 둘은 무시된다.
  all_day boolean not null default true,
  -- `HH:MM`(24시간). 종일이 아니면 둘 다 있어야 한다.
  start_time text,
  end_time text,
  location text not null default '',
  note text not null default '',
  -- 표시 색 — 없으면 앱이 기본 강조색으로 그린다.
  color text,
  -- 어디서 온 일정인가. 'geurio' = 우리 표가 정본, 'google' = 미러(다음 단계).
  source text not null default 'geurio' check (source in ('geurio', 'google')),
  google_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_events_range check (end_date >= start_date),
  -- 시각은 **둘 다 있거나 둘 다 없다** — 하나만 있으면 그릴 수 없다.
  constraint calendar_events_times check (
    (start_time is null and end_time is null)
    or (start_time is not null and end_time is not null)
  ),
  constraint calendar_events_time_fmt check (
    (start_time is null or start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
    and (end_time is null or end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
  )
);

-- 달 단위로 훑는 조회가 전부다(`start_date <= 월말 and end_date >= 월초`).
create index if not exists calendar_events_owner_idx on public.calendar_events (owner, start_date);
create unique index if not exists calendar_events_google_idx on public.calendar_events (owner, google_id) where google_id is not null;

alter table public.calendar_events enable row level security;

-- 내 일정만. 알림 우편함(0022)과 같은 판단으로 UPDATE를 직접 연다 — 이 표에는 남의
-- 행이 섞여 있지 않아 어떤 컬럼을 바꿔도 피해자가 자기 자신뿐이다(컬럼을 좁히려고
-- RPC를 두던 0019·0021의 이유가 여기엔 없다).
drop policy if exists "calendar_events_select_own" on public.calendar_events;
create policy "calendar_events_select_own" on public.calendar_events
  for select using (owner = auth.uid());
drop policy if exists "calendar_events_insert_own" on public.calendar_events;
create policy "calendar_events_insert_own" on public.calendar_events
  for insert with check (owner = auth.uid());
drop policy if exists "calendar_events_update_own" on public.calendar_events;
create policy "calendar_events_update_own" on public.calendar_events
  for update using (owner = auth.uid()) with check (owner = auth.uid());
drop policy if exists "calendar_events_delete_own" on public.calendar_events;
create policy "calendar_events_delete_own" on public.calendar_events
  for delete using (owner = auth.uid());

-- `updated_at`은 **트리거가 찍는다**(0015 `updated_by`와 같은 이유 — 클라이언트가
-- 보내는 값이면 신뢰할 수 없다).
create or replace function public.touch_calendar_event()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists calendar_events_touch on public.calendar_events;
create trigger calendar_events_touch
  before update on public.calendar_events
  for each row execute function public.touch_calendar_event();

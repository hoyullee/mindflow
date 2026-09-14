-- 0040: 웹 푸시 구독 — 멘션을 **앱을 안 보고 있을 때** 바로 알린다(요청).
--
-- ## 왜 메일과 나란히 두는가
--
-- 0039의 메일은 "앱 밖에 있는 사람에게 닿는 것"이고 30분에 한 번이다. 푸시는
-- "이미 이 앱을 쓰는 사람을 지금 불러오는 것"이라 성격이 다르다 — 그리고 **통당
-- 비용이 0이다**(Resend 한도를 전혀 건드리지 않는다). 그래서 푸시는 조일 이유가
-- 없고, 조이는 규칙은 하나뿐이다: **읽지 않았을 때만**.
--
-- ## 왜 트리거가 아니라 cron인가 (0024의 교훈)
--
-- 알림 insert 트리거에서 `pg_net`으로 바로 쏘면 지연이 0이다. 그런데 이 저장소에는
-- 이미 **알림 트리거가 문서 저장을 통째로 굴린 사고**가 있다(0024 — 멘션이 든 저장만
-- 실패했다). 확장이 없거나 설정이 어긋나면 같은 일이 되풀이된다. 1분 cron은 그 위험이
-- **구조적으로 0**이고(insert 경로를 건드리지 않는다) 대가는 최대 1분의 지연뿐이다.
--
-- ## 구독은 기기마다, 설정은 계정에
--
-- `push_subscriptions`의 한 행 = **한 브라우저**다(엔드포인트가 그 정체다). 켤지 말지는
-- 0039의 `notification_prefs.push_mentions`(계정)가 정하고, 여기에는 "그 계정이 어느
-- 기기에서 받기로 했는가"만 쌓인다. 계정 설정을 끄면 구독이 남아 있어도 안 나간다.

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- 브라우저가 준 푸시 서비스 주소. **이것이 기기의 정체**라 unique다 — 같은
  -- 브라우저가 다시 구독하면 같은 값이 와서 upsert로 갱신된다(행이 불어나지 않는다).
  endpoint text not null unique,
  -- 페이로드 암호화 키(RFC 8291). 이 둘이 없으면 내용 있는 푸시를 보낼 수 없다.
  p256dh text not null,
  auth text not null,
  -- 사람이 "어느 기기인가"를 알아볼 실마리. 지금은 쓰는 화면이 없지만, 기기 목록을
  -- 보여 줄 때 엔드포인트 문자열을 그대로 내놓을 수는 없다.
  ua text not null default '',
  created_at timestamptz not null default now(),
  last_ok_at timestamptz,
  -- 연속 실패 횟수 — 404/410(구독 만료)은 그 자리에서 지우고, 그 밖의 실패만 센다.
  fail_count int not null default 0
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- 자기 구독만. 0022 notifications와 같은 판단 — 남의 것이 섞여 있지 않다.
drop policy if exists "push_subscriptions_select_own" on public.push_subscriptions;
create policy "push_subscriptions_select_own" on public.push_subscriptions
  for select using (user_id = auth.uid());
drop policy if exists "push_subscriptions_insert_own" on public.push_subscriptions;
create policy "push_subscriptions_insert_own" on public.push_subscriptions
  for insert with check (user_id = auth.uid());
drop policy if exists "push_subscriptions_update_own" on public.push_subscriptions;
create policy "push_subscriptions_update_own" on public.push_subscriptions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "push_subscriptions_delete_own" on public.push_subscriptions;
create policy "push_subscriptions_delete_own" on public.push_subscriptions
  for delete using (user_id = auth.uid());

/**
 * 지금 회차에서 푸시로 보낼 멘션을 **수신자별로** 묶어 돌려준다.
 *
 * 0039의 메일판(`pending_mention_digests`)과 규칙이 셋 다르다:
 *  - **유예가 없다**(`min_age_minutes` 기본 0) — 푸시는 "지금 불러오는 것"이라
 *    미루면 존재 이유가 사라진다. 대신 1분 cron이라 최대 1분이 걸린다.
 *  - **상한이 없다** — 통당 비용이 0이고 Resend 한도와 무관하다.
 *  - **한 시간보다 늙은 것은 버린다**(메일은 24시간) — 푸시로 "한 시간 전 일"을
 *    알리는 것은 소음이다. 그건 메일과 알림 센터의 몫이다.
 *
 * 같은 겹은 하나다: **읽지 않았을 때만**. 그리고 `push_mentions` 설정.
 *
 * 구독은 jsonb 배열로 함께 실어 준다 — Edge Function이 수신자마다 다시 묻지 않게.
 */
create or replace function public.pending_mention_pushes(
  max_age_minutes int default 60,
  max_recipients int default 200,
  max_subs_per_user int default 10
)
returns table (
  recipient uuid,
  ids uuid[],
  total int,
  actors text[],
  doc_titles text[],
  document_id text,
  subs jsonb
)
language sql
security definer
set search_path = public
as $$
  with candidate as (
    select n.*
      from public.notifications n
     where n.read_at is null
       and n.pushed_at is null
       and n.kind in ('mention', 'doc_mention')
       and n.created_at >= now() - make_interval(mins => max_age_minutes)
  ),
  grouped as (
    select c.recipient,
           array_agg(c.id order by c.created_at) as ids,
           count(*)::int as total,
           array_remove(array_agg(distinct nullif(c.actor_name, '')), null) as actors,
           array_remove(array_agg(distinct nullif(c.doc_title, '')), null) as doc_titles,
           -- 문서가 하나뿐일 때만 그 id를 싣는다 — 푸시를 누르면 **바로 그 문서**로
           -- 가야 뜻이 있고, 여럿이면 갈 곳이 홈이다.
           case when count(distinct c.document_id) = 1 then min(c.document_id) else null end as document_id
      from candidate c
     group by c.recipient
  )
  select g.recipient,
         g.ids,
         g.total,
         g.actors,
         g.doc_titles,
         g.document_id,
         coalesce(s.subs, '[]'::jsonb)
    from grouped g
    left join public.notification_prefs p on p.user_id = g.recipient
    left join lateral (
      select jsonb_agg(jsonb_build_object('id', x.id, 'endpoint', x.endpoint, 'p256dh', x.p256dh, 'auth', x.auth)) as subs
        from (
          select ps.id, ps.endpoint, ps.p256dh, ps.auth
            from public.push_subscriptions ps
           where ps.user_id = g.recipient
           order by ps.created_at desc
           limit max_subs_per_user
        ) x
    ) s on true
   where coalesce(p.push_mentions, true)
     and s.subs is not null
   limit max_recipients;
$$;

revoke all on function public.pending_mention_pushes(int, int, int) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.pending_mention_pushes(int, int, int) to service_role';
  end if;
end $$;

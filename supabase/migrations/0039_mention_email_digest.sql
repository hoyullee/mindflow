-- 0039: 멘션 **메일** — 30분 다이제스트 · 읽지 않았을 때만 · 일일 안전판.
--
-- ## 왜 "멘션마다 한 통"이 아닌가 (요청에서 나온 판단)
--
-- 사용자의 첫 물음이 "멘션할 때마다 메일을 보내면 비용 부담이 있지 않나"였다.
-- 실제 제약은 요금이 아니라 **무료 한도의 성격**이다: Resend 무료는 월 3,000통에
-- **하루 100통**이고, 그 한도를 멘션 메일이 **혼자 쓰지 않는다** — 가입 확인·비밀번호
-- 재설정(Supabase Auth의 SMTP)과 공유 초대(`share-invite`)가 **같은 통장**을 쓴다.
-- 그래서 멘션 메일이 하루치를 먹어 치우면 그날 **로그인 자체가 막힌다**. 돈 문제가
-- 아니라 사고다. 세 겹으로 막는다:
--
-- ① **읽지 않았을 때만**(`read_at is null`) — 같이 편집 중인 사람은 벨을 바로 보므로
--    메일이 아예 나가지 않는다. 실시간 공동 편집이 주 사용 패턴인 이 앱에서 이 규칙
--    하나가 대부분을 걷어낸다.
-- ② **묶어서 한 통**(요청: 30분 단위) — 30분마다 도는 다이제스트가 그 사이에 쌓인
--    멘션을 **수신자별로 한 통**에 담는다. 한 문서에서 세 번 멘션당해도 한 통이다.
--    갓 생긴 것(5분 미만)은 **다음 회차로 미룬다** — 안 그러면 10:29의 멘션이 10:30에
--    나가 "읽을 틈"이 1분뿐이다(①이 무력해진다).
-- ③ **상한 둘** — 수신자당 하루 `MENTION_EMAIL_PER_USER_DAILY`통, 전체 하루
--    `MENTION_EMAIL_DAILY_CAP`통. 후자가 인증·초대 메일의 자리를 남겨 두는 안전판이다.
--
-- ## 왜 별도 표인가(워크스페이스 블롭이 아니라)
--
-- 다이제스트는 **서버가** 수신자를 고른다 — `where email_on` 한 줄로 걸러야지,
-- 사용자 수만큼 불투명 JSON(0004 `workspaces.data`)을 파싱할 수는 없다. 그 블롭의
-- 모양은 홈이 소유한다고 문서에 못박혀 있어(ports.ts) 서버가 그 내부에 기대면
-- 두 소유자가 생긴다.
--
-- ## 발송 자체는 Edge Function이 한다
--
-- 여기(DB)에는 **무엇을 보낼지**와 **얼마나 보냈는지**만 있다. Resend 키를 쥔 쪽은
-- `supabase/functions/notify-digest`뿐이다(`share-invite`와 같은 원칙). 키가 없으면
-- 아무 일도 하지 않는다 — 이 마이그레이션이 먼저 적용돼도 앱은 그대로 동작한다.

-- ── ① 보낸 표시 ─────────────────────────────────────────────────────────────
-- `emailed_at`이 null인 행만 후보다. 보낸 뒤 찍어 두면 같은 멘션이 두 번 나가지
-- 않는다(다이제스트가 두 번 돌아도, 회차가 겹쳐도).
alter table public.notifications add column if not exists emailed_at timestamptz;
-- 웹 푸시(다음 단계)가 쓸 자리 — 지금은 아무도 쓰지 않는다. 한 번에 두는 이유는
-- 알림 표에 컬럼을 더하는 마이그레이션을 두 번 돌리지 않으려는 것뿐이다.
alter table public.notifications add column if not exists pushed_at timestamptz;

-- 다이제스트의 조회는 "아직 안 보냈고 아직 안 읽은 것"이다 — 그 둘이 다 null인
-- 행만 훑도록 **부분 인덱스**를 둔다(알림이 쌓여도 후보는 늘 적다).
create index if not exists notifications_pending_email_idx
  on public.notifications (created_at)
  where emailed_at is null and read_at is null;

-- ── ② 계정별 설정 ───────────────────────────────────────────────────────────
-- 기본값이 **켜짐**인 이유: 위 세 겹 때문에 이 메일은 이미 조용하다(읽으면 안 오고,
-- 30분에 한 통이고, 하루 5통이 끝이다). 꺼짐으로 시작하면 "멘션했는데 상대가 몰랐다"가
-- 기본 동작이 되는데, 그게 이 기능을 만든 이유다.
-- 행이 **없어도 켜짐**이다(아무도 설정을 연 적 없는 기존 사용자) — 그래서 다이제스트는
-- left join으로 읽고 `coalesce(..., true)`로 본다.
create table if not exists public.notification_prefs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- 멘션 메일을 받을까.
  email_mentions boolean not null default true,
  -- 웹 푸시를 받을까(다음 단계). 켜져 있어도 **구독이 없으면** 아무 일도 없다 —
  -- 브라우저 권한 자체가 진짜 opt-in이라 이 값은 "허용해 둔 뒤 끄고 싶을 때"의 스위치다.
  push_mentions boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.notification_prefs enable row level security;

-- 자기 행만. 0022 notifications와 같은 판단 — 이 행에는 남의 것이 섞여 있지 않아
-- 어떤 컬럼을 바꿔도 피해자가 자기 자신뿐이다.
drop policy if exists "notification_prefs_select_own" on public.notification_prefs;
create policy "notification_prefs_select_own" on public.notification_prefs
  for select using (user_id = auth.uid());
drop policy if exists "notification_prefs_insert_own" on public.notification_prefs;
create policy "notification_prefs_insert_own" on public.notification_prefs
  for insert with check (user_id = auth.uid());
drop policy if exists "notification_prefs_update_own" on public.notification_prefs;
create policy "notification_prefs_update_own" on public.notification_prefs
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop trigger if exists notification_prefs_set_updated_at on public.notification_prefs;
create trigger notification_prefs_set_updated_at
  before update on public.notification_prefs
  for each row execute function public.set_updated_at();

-- ── ③ 하루 예산(안전판) ─────────────────────────────────────────────────────
-- **RLS 정책을 하나도 걸지 않는다** = service_role(Edge Function) 말고는 아무도 못
-- 읽고 못 쓴다. 클라이언트가 볼 이유가 없는 값이고, 볼 수 있으면 "오늘 몇 통 남았나"가
-- 새는 셈이다.
create table if not exists public.email_budget (
  day date primary key,
  sent int not null default 0
);
alter table public.email_budget enable row level security;

/**
 * 오늘 예산에서 `want`통을 **원자적으로** 떼어 온다 — 실제로 떼어 준 수를 돌려준다.
 *
 * 왜 함수인가: 다이제스트가 두 번 겹쳐 돌아도(재시도·수동 실행) 합계가 상한을 넘지
 * 않아야 한다. `insert … on conflict do update`의 한 문장 안에서 더하고 `returning`으로
 * 확정값을 받으면 그 사이에 끼어들 틈이 없다.
 *
 * 상한은 **60통**이다(Resend 무료의 하루 100통 중). 나머지 40통은 인증·초대 메일의
 * 자리로 남긴다 — 그쪽이 막히면 로그인이 막힌다.
 */
create or replace function public.claim_email_budget(want int, cap int default 60)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  before_sent int;
  granted int;
begin
  if want is null or want <= 0 then
    return 0;
  end if;
  insert into public.email_budget (day, sent)
  values (current_date, 0)
  on conflict (day) do update set sent = public.email_budget.sent
  returning sent into before_sent;

  granted := greatest(0, least(want, cap - before_sent));
  if granted > 0 then
    update public.email_budget set sent = sent + granted where day = current_date;
  end if;
  return granted;
end;
$$;

-- 호출자는 service_role(Edge Function)뿐이다 — 로그인한 사용자가 이 함수를 불러
-- 예산을 **소진시켜** 남의 메일을 막는 일(고장 유발)을 못 하게 권한을 뺏는다.
--
-- `from public` **하나로 충분하다**: anon·authenticated는 실행 권한을 PUBLIC에서
-- 물려받을 뿐 따로 받은 적이 없다. 그 둘을 이름으로 적었더니 로컬 하네스에서
-- `role "anon" does not exist`로 **마이그레이션 전체가 굴렀다** — 그 이름들은
-- Supabase가 만들어 주는 것이라 다른 Postgres에서는 없다. 이름을 적지 않는 쪽이
-- 옳고, 실제로 필요한 권한은 아래에서 service_role에만 다시 준다(있을 때만).
revoke all on function public.claim_email_budget(int, int) from public;

-- ── ④ 보낼 것 고르기 ────────────────────────────────────────────────────────
/**
 * 지금 회차에서 메일로 보낼 멘션을 수신자별로 묶어 돌려준다.
 *
 * 규칙(위 ①②③):
 *  - 아직 **안 읽었고**(`read_at is null`) 아직 **안 보낸**(`emailed_at is null`) 것
 *  - 종류는 **멘션 둘뿐** — `mention`(댓글 속 멘션)과 `doc_mention`(본문 속 멘션).
 *    `reply`·`comment`는 일부러 뺐다(요청이 "멘션 메일"이었다). `share`는 이미
 *    `share-invite`가 초대 메일을 보내므로 넣으면 같은 일에 두 통이 된다.
 *  - **5분보다 어린 것은 미룬다** — 다음 회차(30분 뒤)에 간다. 읽을 틈을 준다.
 *  - **24시간보다 늙은 것은 버린다** — 함수가 오래 멈춰 있었다가 되살아날 때
 *    묵은 알림 수백 개가 한꺼번에 나가지 않게 한다(그건 스팸으로 읽힌다).
 *  - 설정이 꺼진 사람은 제외.
 *  - 수신자당 오늘 이미 보낸 다이제스트가 `per_user_daily`통이면 제외.
 *
 * 오래 기다린 사람이 먼저다(`oldest` 오름차순) — 예산이 모자랄 때 누가 밀릴지를
 * 무작위가 아니라 **대기 시간**으로 정한다.
 *
 * 돌려주는 `ids`로 Edge Function이 보낸 뒤 `emailed_at`을 찍는다.
 */
create or replace function public.pending_mention_digests(
  min_age_minutes int default 5,
  max_age_hours int default 24,
  per_user_daily int default 5,
  max_recipients int default 60
)
returns table (
  recipient uuid,
  email text,
  ids uuid[],
  total int,
  oldest timestamptz,
  actors text[],
  doc_titles text[]
)
language sql
security definer
set search_path = public
as $$
  with candidate as (
    select n.*
      from public.notifications n
     where n.read_at is null
       and n.emailed_at is null
       and n.kind in ('mention', 'doc_mention')
       and n.created_at <= now() - make_interval(mins => min_age_minutes)
       and n.created_at >= now() - make_interval(hours => max_age_hours)
  ),
  grouped as (
    select c.recipient,
           array_agg(c.id order by c.created_at) as ids,
           count(*)::int as total,
           min(c.created_at) as oldest,
           -- 누가 불렀는지 · 어느 문서인지는 **중복을 지워** 담는다(같은 사람이 세 번
           -- 부른 것을 메일에 세 번 적지 않는다).
           array_agg(distinct nullif(c.actor_name, '')) as actors,
           array_agg(distinct nullif(c.doc_title, '')) as doc_titles
      from candidate c
     group by c.recipient
  )
  select g.recipient,
         u.email::text,
         g.ids,
         g.total,
         g.oldest,
         -- array_agg(distinct …)는 NULL도 한 칸 차지한다 — 빈 이름을 nullif로 비웠으니
         -- 여기서 걷어낸다(메일 본문에 빈 줄이 생기지 않게).
         array_remove(g.actors, null),
         array_remove(g.doc_titles, null)
    from grouped g
    join auth.users u on u.id = g.recipient
    left join public.notification_prefs p on p.user_id = g.recipient
   where coalesce(p.email_mentions, true)
     and coalesce(u.email, '') <> ''
     -- 오늘 이 사람에게 **몇 통** 보냈나. 한 회차는 그 수신자의 행들을 **같은
     -- 타임스탬프**로 한꺼번에 찍으므로(Edge Function이 `.in('id', ids)` 한 번),
     -- `distinct emailed_at`의 개수가 곧 보낸 통수다.
     -- `current_date`는 DB 시간대(Supabase는 UTC)의 오늘이다 — `email_budget.day`와
     -- 같은 기준이라 두 상한이 같은 자정에 함께 풀린다.
     and (
       select count(distinct n2.emailed_at)
         from public.notifications n2
        where n2.recipient = g.recipient
          and n2.emailed_at >= current_date
     ) < per_user_daily
   order by g.oldest
   limit max_recipients;
$$;

revoke all on function public.pending_mention_digests(int, int, int, int) from public;

-- service_role이 있는 곳(Supabase)에서만 되돌려 준다 — 로컬 하네스에는 그 롤이 없다.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.claim_email_budget(int, int) to service_role';
    execute 'grant execute on function public.pending_mention_digests(int, int, int, int) to service_role';
  end if;
end $$;

-- MindFlow — 알림 우편함(홈 알림 센터의 저장소).
--
-- 알림의 종류가 셋이 됐다(공유 초대·멘션·답글) — 흩어진 배지 대신 한 테이블에
-- 모아 홈의 알림 센터가 읽는다.
--
-- **클라이언트는 알림을 만들지 못한다** — 전부 DB 트리거가 만든다(댓글 insert,
-- 공유 insert). 클라이언트 insert를 열면 로그인한 아무나 남의 우편함에 "당신이
-- 멘션됐다"를 꽂을 수 있다(share-invite 함수가 초대를 서버에서 재확인하는 것과
-- 같은 원칙: 알림의 근거는 서버가 본 사실이어야 한다).

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('mention', 'reply', 'comment', 'share')),
  -- 문서가 지워지면 알림도 함께 — 갈 곳 없는 알림은 소음이다.
  document_id text references public.documents (id) on delete cascade,
  node_id text,
  comment_id uuid references public.document_comments (id) on delete cascade,
  -- 행위자 이름 스냅샷(0020 author_name과 같은 이유 — 조인 없이 한 번에 읽는다).
  actor_name text not null default '',
  -- 본문 일부/맵 제목 스냅샷 — 알림 목록은 select 하나로 끝나야 한다.
  preview text not null default '',
  doc_title text not null default '',
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists notifications_recipient_idx on public.notifications (recipient, created_at desc);

alter table public.notifications enable row level security;

-- 자기 우편함만. UPDATE를 직접 여는 이유(0019·0021의 RPC 패턴과 다른 판단):
-- 이 행에는 남의 것이 섞여 있지 않다 — 자기 알림의 어떤 컬럼을 바꿔도 피해자가
-- 자기 자신뿐이라 컬럼을 좁힐 이유가 없다.
drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own" on public.notifications
  for select using (recipient = auth.uid());
drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own" on public.notifications
  for update using (recipient = auth.uid()) with check (recipient = auth.uid());
drop policy if exists "notifications_delete_own" on public.notifications;
create policy "notifications_delete_own" on public.notifications
  for delete using (recipient = auth.uid());
-- insert 정책은 없다 — 트리거(definer)만 넣는다.

-- ── 댓글 → 알림 ─────────────────────────────────────────────────────────────
-- 우선순위: 멘션 > 답글(스레드 뿌리 작성자) > 새 스레드(문서 소유자).
-- 같은 사람에게 같은 댓글로 두 번 알리지 않고, 자기 행동은 알리지 않는다.
create or replace function public.notify_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  d record;
  men record;
  uid uuid;
  handled uuid[] := array[]::uuid[];
begin
  select owner, title into d from public.documents where id = new.document_id;

  for men in select value from jsonb_array_elements(coalesce(new.mentions, '[]'::jsonb)) as t(value) loop
    select id into uid from auth.users where lower(email) = lower(coalesce(men.value ->> 'email', ''));
    if uid is not null and uid <> new.author and not (uid = any (handled)) then
      insert into public.notifications (recipient, kind, document_id, node_id, comment_id, actor_name, preview, doc_title)
      values (uid, 'mention', new.document_id, new.node_id, new.id, new.author_name, left(new.body, 140), coalesce(d.title, ''));
      handled := handled || uid;
    end if;
  end loop;

  if new.parent_id is not null then
    select author into uid from public.document_comments where id = new.parent_id;
    if uid is not null and uid <> new.author and not (uid = any (handled)) then
      insert into public.notifications (recipient, kind, document_id, node_id, comment_id, actor_name, preview, doc_title)
      values (uid, 'reply', new.document_id, new.node_id, new.id, new.author_name, left(new.body, 140), coalesce(d.title, ''));
      handled := handled || uid;
    end if;
  else
    if d.owner is not null and d.owner <> new.author and not (d.owner = any (handled)) then
      insert into public.notifications (recipient, kind, document_id, node_id, comment_id, actor_name, preview, doc_title)
      values (d.owner, 'comment', new.document_id, new.node_id, new.id, new.author_name, left(new.body, 140), coalesce(d.title, ''));
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists document_comments_notify on public.document_comments;
create trigger document_comments_notify
  after insert on public.document_comments
  for each row execute function public.notify_comment();

-- ── 공유 초대 → 알림 ────────────────────────────────────────────────────────
-- after INSERT만 — 초대는 upsert라(권한 변경도 같은 경로) on conflict UPDATE는
-- 트리거를 태우지 않는다 = **처음 초대에만** 알린다(share-invite 메일과 같은 규칙).
-- 아직 가입하지 않은 이메일은 알릴 우편함이 없다(가입하면 홈 LNB '공유받음'
-- 배지(0019)가 그 역할을 한다).
create or replace function public.notify_share()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
  ttl text;
  inviter text;
begin
  select id into uid from auth.users where lower(email) = new.invitee_email;
  if uid is null or uid = new.invited_by then
    return new;
  end if;
  select title into ttl from public.documents where id = new.document_id;
  select display_name into inviter from public.profiles where id = new.invited_by;
  insert into public.notifications (recipient, kind, document_id, actor_name, preview, doc_title)
  values (uid, 'share', new.document_id, coalesce(inviter, ''), '', coalesce(ttl, ''));
  return new;
end;
$$;

drop trigger if exists document_shares_notify on public.document_shares;
create trigger document_shares_notify
  after insert on public.document_shares
  for each row execute function public.notify_share();

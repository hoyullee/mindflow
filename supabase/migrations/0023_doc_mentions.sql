-- 0023: 본문 인라인 멘션 알림 (주의: documents의 본문 칼럼은 body가 아니라 **data**다
-- — 첫 판이 body를 참조해 CREATE TRIGGER가 실패, 파일 전체가 롤백돼 미적용이었다) — documents 저장 시 **새로 생긴** 멘션에만 알림.
--
-- 원칙은 0022와 동일: 클라이언트는 알림을 만들지 못한다(가짜 멘션 방지). 본문의
-- 멘션 이메일을 트리거가 추출해 old/new **집합 차이**만 알린다 — 자동저장이 0.9초
-- 마다 돌아도 이미 있던 멘션은 다시 알리지 않는다. 수신자는 그 문서에 실제로
-- 접근할 수 있는 사람(소유자 또는 초대)만 — 임의 이메일을 본문에 적어도 알림이
-- 가지 않는다(스팸 차단). undo/redo·CRDT 되살림으로 같은 멘션이 재등장하는 경우는
-- 미확인 동일 알림이 있으면 건너뛰어 중복을 누른다.

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check check (kind in ('mention', 'reply', 'comment', 'share', 'doc_mention'));

create or replace function public.doc_mention_emails(doc jsonb)
returns setof text
language sql
immutable
as $$
  -- 노드/메모의 rich 런에서 m(멘션 이메일)만 뽑는다 — 구조를 명시적으로 걷는다
  -- ('$.**.m' 같은 광역 경로는 우연히 m 키를 가진 다른 값도 물어 온다).
  -- `rich`는 평문일 때 **JSON null**이다(SQL NULL이 아니라서 coalesce로는 못
  -- 거른다 — jsonb_array_elements가 "cannot extract elements from a scalar"로
  -- 터진다, 로컬 하네스에서 실측). 0012와 같은 jsonb_typeof 가드를 쓴다.
  select distinct lower(r->>'m')
  from jsonb_each(case when jsonb_typeof(doc->'nodes') = 'object' then doc->'nodes' else '{}'::jsonb end) as n(id, node),
       jsonb_array_elements(case when jsonb_typeof(node->'rich') = 'array' then node->'rich' else '[]'::jsonb end) as r
  where r ? 'm' and coalesce(r->>'m', '') <> ''
  union
  select distinct lower(r->>'m')
  from jsonb_array_elements(case when jsonb_typeof(doc->'floats') = 'array' then doc->'floats' else '[]'::jsonb end) as f,
       jsonb_array_elements(case when jsonb_typeof(f->'rich') = 'array' then f->'rich' else '[]'::jsonb end) as r
  where r ? 'm' and coalesce(r->>'m', '') <> ''
$$;

create or replace function public.notify_doc_mentions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  em text;
  target uuid;
  actor text;
begin
  select coalesce(nullif(p.display_name, ''), split_part(u.email, '@', 1), '')
    into actor
    from auth.users u
    left join public.profiles p on p.id = u.id
   where u.id = auth.uid();

  for em in
    select e from public.doc_mention_emails(new.data) as e
    except
    select e from public.doc_mention_emails(coalesce(old.data, '{}'::jsonb)) as e
  loop
    select u.id into target from auth.users u where lower(u.email) = em;
    if target is null or target = auth.uid() then
      continue; -- 미가입자·자기 멘션은 알리지 않는다(0022와 같은 규칙)
    end if;
    -- 접근 가능한 사람에게만: 소유자이거나 초대(이메일)가 걸려 있어야 한다.
    if target <> new.owner and not exists (
      select 1 from public.document_shares s
       where s.document_id = new.id and lower(s.email) = em
    ) then
      continue;
    end if;
    -- undo/CRDT 되살림 중복 억제: 같은 문서의 미확인 doc_mention이 이미 있으면 생략.
    if exists (
      select 1 from public.notifications n
       where n.recipient = target and n.document_id = new.id and n.kind = 'doc_mention' and n.read_at is null
    ) then
      continue;
    end if;
    insert into public.notifications (recipient, kind, document_id, actor_name, preview, doc_title)
    values (target, 'doc_mention', new.id, coalesce(actor, ''), '', coalesce(new.title, ''));
  end loop;
  return new;
end;
$$;

drop trigger if exists trg_notify_doc_mentions on public.documents;
create trigger trg_notify_doc_mentions
  after update of data on public.documents
  for each row
  when (old.data is distinct from new.data)
  execute function public.notify_doc_mentions();

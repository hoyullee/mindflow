-- 0026: 멘션 알림 단위를 (이메일, 객체) 쌍으로(제보: 같은 사람을 **다른 객체**에
-- 다시 멘션하면 알림이 안 온다 → 사용자 선정).
--
-- 0023은 old/new 본문의 멘션을 **이메일 집합**으로 비교했다 — 자동저장 스팸은
-- 막지만, 문서에 그 사람 멘션이 하나라도 남아 있는 한 새 자리에 또 멘션해도
-- 집합에 변화가 없어 문서당·사람당 사실상 1회였다. 비교 단위를 **(이메일,
-- 객체 id)**로 좁힌다: 새 객체(주제/메모)에 단 멘션은 새 쌍이라 알림이 가고,
-- 자동저장 반복·같은 객체 안 재멘션·주변 텍스트 편집은 쌍이 그대로라 울리지
-- 않는다. 미확인 동일 알림 생략(중복 억제)과 0024의 이중 예외 가드는 유지.

create or replace function public.doc_mention_sites(doc jsonb)
returns table(em text, site text)
language sql
immutable
as $$
  -- 노드: nodes는 id를 키로 갖는 객체 — 키가 곧 객체 id.
  -- rich가 평문이면 JSON null이라 jsonb_typeof 가드 필수(0023과 동일).
  select distinct lower(r->>'m'), n.id
  from jsonb_each(case when jsonb_typeof(doc->'nodes') = 'object' then doc->'nodes' else '{}'::jsonb end) as n(id, node),
       jsonb_array_elements(case when jsonb_typeof(node->'rich') = 'array' then node->'rich' else '[]'::jsonb end) as r
  where r ? 'm' and coalesce(r->>'m', '') <> ''
  union
  select distinct lower(r->>'m'), coalesce(f->>'id', '')
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
  -- 알림은 저장을 방해하지 않는다 — 본문 전체를 가드로 감싼다(0024).
  begin
    select coalesce(nullif(p.display_name, ''), split_part(u.email, '@', 1), '')
      into actor
      from auth.users u
      left join public.profiles p on p.id = u.id
     where u.id = auth.uid();

    for em in
      -- (이메일, 객체) 쌍의 차이 → 새 쌍이 생긴 이메일만(같은 저장에 여러
      -- 객체가 늘어도 사람당 한 번 — distinct).
      select distinct d.em from (
        select * from public.doc_mention_sites(new.data)
        except
        select * from public.doc_mention_sites(coalesce(old.data, '{}'::jsonb))
      ) d
    loop
      begin
        select u.id into target from auth.users u where lower(u.email) = em;
        if target is null or target = auth.uid() then
          continue; -- 미가입자·자기 멘션은 알리지 않는다(0022와 같은 규칙)
        end if;
        -- 접근 가능한 사람에게만: 소유자이거나 초대(이메일)가 걸려 있어야 한다(0025).
        if target <> new.owner and not exists (
          select 1 from public.document_shares s
           where s.document_id = new.id and s.invitee_email = em
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
      exception when others then
        raise warning 'doc_mention 알림 생성 실패(%): %', em, sqlerrm;
      end;
    end loop;
  exception when others then
    raise warning 'doc_mention 알림 처리 실패: %', sqlerrm;
  end;
  return new;
end;
$$;

-- 0024: 멘션 알림이 **저장을 막던** 문제 강화(제보: 멘션이 든 저장만 "변경됨"에서
-- 멈춤). 트리거 안의 알림 insert가 에러를 내면 그 에러가 documents UPDATE 전체를
-- 굴려 저장이 실패한다 — 알림은 부가 기능이라 **저장을 방해하면 안 된다**(버전
-- 기록과 같은 원칙). 두 겹으로 고친다:
--
-- ① kind CHECK 제약을 **이름 불문** 재구축 — 0023은 `drop constraint if exists
--    notifications_kind_check`로 지웠는데, 라이브의 제약 이름이 다르면 그 drop이
--    조용히 무시되고 옛 4종 제약이 남아 `doc_mention` insert를 거부한다(멘션이 든
--    저장만 실패하는 증상과 정확히 일치). kind를 참조하는 check를 전부 지우고
--    5종으로 다시 건다.
-- ② 알림 생성 전체를 예외 가드로 감싼다 — 어떤 이유로든 실패하면 경고 로그만
--    남기고 저장은 그대로 성공한다(원인은 Postgres 로그로 진단).

do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.notifications'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%kind%'
  loop
    execute format('alter table public.notifications drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.notifications
  add constraint notifications_kind_check check (kind in ('mention', 'reply', 'comment', 'share', 'doc_mention'));

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
  -- 알림은 저장을 방해하지 않는다 — 본문 전체를 가드로 감싼다.
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
      begin
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

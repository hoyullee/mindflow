-- 0025: 멘션 알림이 여전히 안 가던 문제(라이브 Postgres 로그 제보) — 초대자 확인
-- 게이트가 존재하지 않는 칼럼을 참조했다. document_shares의 이메일 칼럼은 `email`이
-- 아니라 **`invitee_email`**(0009)이다. 0024의 예외 가드가 의도대로 동작해 저장은
-- 성공했지만, 그 게이트가 이메일마다 `column s.email does not exist`로 터져
-- 소유자가 아닌 초대자에게는 알림이 한 건도 만들어지지 않았다.
--
-- 교훈(0023의 body→data와 같은 계열): 트리거가 참조하는 테이블은 **실제 마이그레이션
-- 원문**으로 검증해야 한다 — 로컬 하네스가 document_shares를 임의 스키마로 만들어
-- 이 불일치를 통과시켰다.
--
-- 0009가 invitee_email을 insert 시점에 lower(trim())으로 정규화하므로(트리거
-- normalize_share_email) 비교는 정규화된 값끼리다 — em은 doc_mention_emails가
-- 이미 lower로 돌려준다.

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

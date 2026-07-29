-- 0011: 참가자 목록을 참가자 전원에게 공개 + role 포함.
--
-- 0010은 초대 목록 전체를 소유자에게만 보여줬다(0009의 테이블 정책과 같은 보수적
-- 기본값). 실사용 제보로 뒤집는다: 공유받은 사람도 "이 맵에 누가 있는지"를 봐야
-- 한다 — 함께 편집하는 사이에 참가자 명단을 숨기는 것이 오히려 어색하다(소유자가
-- 초대한 제3자가 편집 중인데 목록에는 안 보이는 상태). 문서에 접근할 수 있는
-- 사람(소유자 + 초대받은 사람)이라면 전원 같은 명단을 본다.
--
-- 초대·취소 권한은 그대로다: insert/update는 소유자만(0009 정책), delete는 소유자
-- 또는 본인 행(공유 나가기). 이 함수는 읽기 전용이다.
--
-- 반환 타입이 바뀌므로(role 추가) drop 후 재생성한다.

drop function if exists public.share_participants(text);

create function public.share_participants(doc_id text)
returns table (kind text, email text, display_name text, joined boolean, role text)
language sql
stable
security definer
set search_path = public
as $$
  select 'owner'::text as kind,
         u.email::text as email,
         coalesce(p.display_name, u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name') as display_name,
         true as joined,
         'edit'::text as role
  from public.documents d
  join auth.users u on u.id = d.owner
  left join public.profiles p on p.id = d.owner
  where d.id = doc_id
    and (public.owns_document(doc_id) or public.shared_with_me(doc_id, 'view'))
  union all
  select 'invitee'::text,
         s.invitee_email::text,
         coalesce(p.display_name, u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name'),
         (u.id is not null),
         s.role::text
  from public.document_shares s
  left join auth.users u on lower(u.email::text) = s.invitee_email
  left join public.profiles p on p.id = u.id
  where s.document_id = doc_id
    and (public.owns_document(doc_id) or public.shared_with_me(doc_id, 'view'));
$$;

revoke all on function public.share_participants(text) from anon;
revoke all on function public.share_participants(text) from public;
grant execute on function public.share_participants(text) to authenticated;

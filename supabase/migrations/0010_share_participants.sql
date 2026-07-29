-- 0010: 공유 팝업의 참가자 정보 — 소유자가 누구인지, 초대된 사람의 프로필명.
--
-- 왜 RPC인가: 클라이언트는 `auth.users`를 읽을 수 없어(설계 그대로) 이메일 ↔ 계정
-- ↔ `profiles.display_name`을 이을 방법이 없다. SECURITY DEFINER 함수 하나가 그
-- 조인을 대신 해 주되, 노출 범위는 0009의 공개 정책을 그대로 따른다:
--   * 소유자 행: 소유자 본인 + 공유받은 사람 모두 볼 수 있다(함께 편집하는 사이 —
--     초대한 사람이 누구인지는 알아야 한다).
--   * 초대 행: 소유자에게는 전체, 초대받은 사람에게는 **자기 행만**
--     (0009 `shares_select_owner_or_self`와 동일 — 참가자 목록은 곧 이메일
--     목록이므로 소유자만 전체를 본다).
--
-- 이름 해석 순서는 앱의 프로필명 규칙(0006)과 같다: `profiles.display_name`
-- (가입 트리거가 OAuth 이름/이메일 로컬파트로 시드) → OAuth 메타데이터 폴백.
-- 초대만 되고 아직 가입 전인 이메일은 계정이 없으므로 `joined = false`로 내려가고,
-- UI가 "가입 대기"로 표시한다.

create or replace function public.share_participants(doc_id text)
returns table (kind text, email text, display_name text, joined boolean)
language sql
stable
security definer
set search_path = public
as $$
  select 'owner'::text as kind,
         u.email::text as email,
         coalesce(p.display_name, u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name') as display_name,
         true as joined
  from public.documents d
  join auth.users u on u.id = d.owner
  left join public.profiles p on p.id = d.owner
  where d.id = doc_id
    and (public.owns_document(doc_id) or public.shared_with_me(doc_id, 'view'))
  union all
  select 'invitee'::text,
         s.invitee_email::text,
         coalesce(p.display_name, u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name'),
         (u.id is not null)
  from public.document_shares s
  left join auth.users u on lower(u.email::text) = s.invitee_email
  left join public.profiles p on p.id = u.id
  where s.document_id = doc_id
    and (
      public.owns_document(doc_id)
      or s.invitee_email = lower(coalesce(auth.jwt() ->> 'email', ''))
    );
$$;

revoke all on function public.share_participants(text) from anon;
revoke all on function public.share_participants(text) from public;
grant execute on function public.share_participants(text) to authenticated;

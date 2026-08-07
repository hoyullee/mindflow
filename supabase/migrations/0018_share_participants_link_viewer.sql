-- 0018: 링크로 연 사람에게도 **소유자**를 보여 준다.
--
-- 제보: 링크 공유(0017)로 맵을 연 사람의 공유 팝업에 소유자가 뜨지 않고, 심지어
-- 소유자 전용 UI(링크 토글·초대 입력)가 열려 있었다.
--
-- 원인은 이 함수의 가드다. 0011은 `owns_document or shared_with_me`만 통과시키는데
-- **링크 뷰어는 둘 다 아니다** → 빈 목록이 돌아온다. 그러면 클라이언트가 "소유자
-- 정보를 얻을 수 없는 환경(구 서버)"으로 착각해 소유자 판별을 폴백(= 나를 소유자로
-- 간주)한다. 서버 RLS가 실제 쓰기를 막고 있었으니 권한이 샌 것은 아니지만, 할 수
-- 없는 일을 할 수 있는 것처럼 보여 주는 화면이었다.
--
-- ── 링크 뷰어에게 무엇까지 보여 줄 것인가 ────────────────────────────────
-- **소유자만.** 초대받은 사람 목록은 그대로 `owns_document or shared_with_me`로
-- 둔다 — 그 목록은 곧 **이메일 주소 목록**이고, 링크는 누구에게나 전달될 수 있다.
-- "이 맵이 누구 것인가"는 뷰어가 알아야 할 정보지만, "누구누구가 초대돼 있는가"는
-- 아니다.
--
-- 반환 타입은 0011과 같다(drop 후 재생성 — 본문만 바뀐다).

drop function if exists public.share_participants(text);

create function public.share_participants(doc_id text)
returns table (kind text, email text, display_name text, joined boolean, role text)
language sql
stable
security definer
set search_path = public
as $$
  -- 소유자: 문서를 열 수 있는 사람이면 누구나 본다(링크 뷰어 포함).
  select 'owner'::text as kind,
         u.email::text as email,
         coalesce(p.display_name, u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name') as display_name,
         true as joined,
         'edit'::text as role
  from public.documents d
  join auth.users u on u.id = d.owner
  left join public.profiles p on p.id = d.owner
  where d.id = doc_id
    and (
      public.owns_document(doc_id)
      or public.shared_with_me(doc_id, 'view')
      or public.link_shared(doc_id)
    )
  union all
  -- 초대 명단(= 이메일 목록): 소유자와 초대받은 사람에게만. 링크 뷰어는 제외.
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

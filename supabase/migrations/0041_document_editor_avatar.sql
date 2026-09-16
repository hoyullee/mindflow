-- 0041 — 마지막 저장자의 **얼굴**(프로필 이미지)까지 돌려준다.
--
-- 0015가 만든 `document_editors`는 이름만 돌려줬다. 홈의 공책 카드가 디자인 원본대로
-- 오른쪽 아래에 **마지막으로 고친 사람의 얼굴**을 그리게 되면서 주소가 하나 더
-- 필요해졌다. 이름과 같은 자리에서 오므로 요청은 늘지 않는다(카드 수만큼 조회가
-- 늘어나는 `share_participants` 경로를 홈에 들이지 않으려는 것이 이 선택의 이유다).
--
-- 반환 모양이 바뀌므로 `create or replace`로는 안 된다 — 지우고 다시 만든다.
-- **양방향 안전**: 옛 앱이 새 함수를 불러도 여분의 칸을 무시하고, 새 앱이 옛 함수를
-- 불러도 `avatar_url`이 없어 얼굴 없이 이름만 그린다(어댑터가 그렇게 읽는다).
--
-- 가시성·이름 규칙은 0015 그대로다: 내 문서이거나 나에게 공유된 문서만, 마지막
-- 저장자가 나 자신이면 아무것도 돌려주지 않는다(그때 카드는 **내** 얼굴을 쓴다).
-- 이메일 전체는 여전히 돌려주지 않는다.
drop function if exists public.document_editors(text[]);

create or replace function public.document_editors(doc_ids text[])
returns table (document_id text, display_name text, avatar_url text)
language sql
stable
security definer
set search_path = public
as $$
  select d.id,
         coalesce(
           nullif(btrim(p.display_name), ''),
           nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
           nullif(btrim(u.raw_user_meta_data ->> 'name'), ''),
           split_part(u.email::text, '@', 1)
         ),
         nullif(btrim(coalesce(p.avatar_url, u.raw_user_meta_data ->> 'avatar_url')), '')
  from public.documents d
  join auth.users u on u.id = d.updated_by
  left join public.profiles p on p.id = d.updated_by
  where d.id = any(doc_ids)
    and d.updated_by is not null
    and d.updated_by <> auth.uid()
    and (public.owns_document(d.id) or public.shared_with_me(d.id, 'view'));
$$;

revoke all on function public.document_editors(text[]) from anon;
revoke all on function public.document_editors(text[]) from public;
grant execute on function public.document_editors(text[]) to authenticated;

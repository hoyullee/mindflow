-- 0031: 프로필 이미지(아바타).
--
-- 요청: 홈 설정에서 프로필 사진을 바꾸고, 그 사진이 마인드맵·화이트보드·칸반에서
-- 아바타를 쓰는 자리(접속자·담당·댓글 작성자)에 함께 반영되게.
--
-- ── 어디에 두는가 ────────────────────────────────────────────────────────
-- 파일은 **Storage 공개 버킷**(`avatars`), 주소는 `profiles.avatar_url` + 그 사람의
-- `auth.users.raw_user_meta_data.avatar_url`(앱이 이미 세션에서 읽는 자리 — 0001부터
-- 구글 사진을 그렇게 읽어 왔다. 같은 칸을 쓰면 화면 쪽에 새 읽기 경로가 없다).
--
-- 왜 **공개** 버킷인가: 아바타는 함께 쓰는 사람들 화면에 늘 떠 있어야 한다(접속자
-- 목록·댓글·담당). 문서 이미지(0016)처럼 서명 URL로 두면 남의 아바타마다 서명을
-- 받아야 하고, 그 사람이 어느 문서의 참가자인지까지 서버가 다시 판단해야 한다 —
-- 아바타 한 장을 위해 문서 권한 모델을 끌어오는 셈이다. 대가는 "주소를 아는 사람은
-- 그 사진을 볼 수 있다"인데, 경로가 uuid라 추측할 수 없고 내용도 프로필 사진이다
-- (Slack·Notion도 같은 절충). **쓰기는 본인 폴더만** — 그게 실제 경계다.
--
-- ── 남의 아바타를 어떻게 찾나 ────────────────────────────────────────────
-- `share_participants`(0011→0018)가 이미 그 문서의 참가자를 이메일·이름으로 돌려
-- 준다. 거기에 `avatar_url`과 `user_id`를 더한다 — 이메일로는 칸반 담당을, uuid로는
-- 댓글 작성자(0020의 `author`)를 잇는다. **스냅샷이 아니라 조인**이라 사진을 바꾸면
-- 옛 댓글의 아바타도 함께 바뀐다(이름은 스냅샷이라 그대로 — 0020의 절충 유지).
-- 새로 나가는 정보는 uuid뿐이고, 그 목록에 있는 사람은 이미 이메일로 보인다.

-- ── profiles.avatar_url ──────────────────────────────────────────────────
alter table public.profiles add column if not exists avatar_url text;

-- ── Storage 버킷 ─────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

-- 읽기: 누구나(공개 버킷의 뜻 그대로). 쓰기·지우기: **자기 폴더**(`<uid>/…`)만.
drop policy if exists "avatars_read" on storage.objects;
create policy "avatars_read" on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists "avatars_insert_own" on storage.objects;
create policy "avatars_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and split_part(name, '/', 1) = auth.uid()::text);

drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and split_part(name, '/', 1) = auth.uid()::text)
  with check (bucket_id = 'avatars' and split_part(name, '/', 1) = auth.uid()::text);

drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and split_part(name, '/', 1) = auth.uid()::text);

-- ── 참가자 목록에 아바타·uuid 추가 ───────────────────────────────────────
-- 반환 타입이 바뀌므로 drop 후 재생성한다(0018의 본문 + 두 칸).
drop function if exists public.share_participants(text);

create function public.share_participants(doc_id text)
returns table (kind text, email text, display_name text, joined boolean, role text, avatar_url text, user_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  -- 소유자: 문서를 열 수 있는 사람이면 누구나 본다(링크 뷰어 포함 — 0018).
  select 'owner'::text as kind,
         u.email::text as email,
         coalesce(p.display_name, u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name') as display_name,
         true as joined,
         'edit'::text as role,
         coalesce(p.avatar_url, u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture') as avatar_url,
         u.id as user_id
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
         s.role::text,
         coalesce(p.avatar_url, u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture'),
         u.id
  from public.document_shares s
  left join auth.users u on lower(u.email::text) = s.invitee_email
  left join public.profiles p on p.id = u.id
  where s.document_id = doc_id
    and (public.owns_document(doc_id) or public.shared_with_me(doc_id, 'view'));
$$;

revoke all on function public.share_participants(text) from anon;
revoke all on function public.share_participants(text) from public;
grant execute on function public.share_participants(text) to authenticated;

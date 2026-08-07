-- MindFlow — 링크 공유(링크를 아는 사람은 열람).
--
-- 지금까지 공유는 **이메일 초대**뿐이었다(0009). 초대는 정확하지만 무겁다 —
-- 상대의 이메일을 알아야 하고, 한 명씩 넣어야 한다. "이 맵 좀 봐 줘"에는
-- 링크 하나면 충분하다.
--
-- ── 이번에 정한 범위와 그 이유 ──────────────────────────────────────────
-- ① **보기 전용만.** 링크는 유출되면 회수할 수 없다(끄기 전까지). 열람은 유출돼도
--    피해가 "봤다"에서 멈추지만, 편집은 내용을 되돌릴 수 없게 망가뜨린다. 편집이
--    필요한 상대는 이메일로 초대한다. 그래서 check 제약을 'view' 하나로 좁혀 둔다
--    — 나중에 편집 링크를 열려면 이 제약을 푸는 **의도적인** 마이그레이션이 필요하다.
-- ② **로그인은 필요하다.** anon 역할에는 아무 정책도 열지 않는다. 익명 열람은
--    공개 라우트·익명 RLS·익명 이미지 서명까지 함께 손봐야 하는 별도 작업이다.
--
-- 링크의 비밀은 **문서 id 그 자체**다(주소가 `/editor?map=<docId>`). id는 랜덤이라
-- 추측할 수 없고, 공유를 끄면(`link_role = null`) 같은 주소도 즉시 막힌다.

alter table public.documents
  add column if not exists link_role text
    check (link_role is null or link_role = 'view');

comment on column public.documents.link_role is
  '링크 공유 권한. null = 꺼짐(소유자·초대받은 사람만). ''view'' = 로그인한 사람이 링크로 열람 가능.';

-- 링크로 열람 가능한 문서인가. `security definer`인 이유는 0009의
-- `shared_with_me`와 같다 — `storage.objects` 정책 안에서 `documents`를 호출자
-- 권한으로 읽으면 그 테이블의 정책이 다시 평가되어 얽힌다. definer로 끊는다.
create or replace function public.link_shared(doc_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.documents d
    where d.id = doc_id and d.link_role is not null
  );
$$;

-- 익명에게는 열지 않는다(위 ②).
revoke all on function public.link_shared(text) from anon;
grant execute on function public.link_shared(text) to authenticated;

-- ── documents: SELECT에 링크 공유를 더한다 ──────────────────────────────
-- UPDATE·INSERT·DELETE는 **손대지 않는다** — 링크는 열람 전용이므로 0009의
-- `documents_update_own_or_shared`(소유자 또는 edit 초대)가 그대로 유지된다.
-- 같은 행의 컬럼을 보는 것이라 definer 함수 없이 직접 참조해도 순환이 없다.
drop policy if exists "documents_select_own_or_shared" on public.documents;
create policy "documents_select_own_or_shared" on public.documents
  for select using (
    auth.uid() = owner
    or public.shared_with_me(id, 'view')
    or link_role is not null
  );

-- ── 첨부 이미지도 함께 보여야 한다 ──────────────────────────────────────
-- 0016의 read 정책은 소유자와 초대받은 사람만 통과시킨다. 그대로 두면 링크로 연
-- 사람에게는 **본문은 보이는데 사진 자리마다 회색 자리표시자**가 뜬다(권한이 문서와
-- 어긋난 상태 — 0016이 애초에 피하려던 바로 그 상황이다).
drop policy if exists "map images readable by document readers" on storage.objects;
create policy "map images readable by document readers"
on storage.objects for select
to authenticated
using (
  bucket_id = 'map-images'
  and (
    public.owns_document(split_part(name, '/', 1))
    or public.shared_with_me(split_part(name, '/', 1), 'view')
    or public.link_shared(split_part(name, '/', 1))
  )
);

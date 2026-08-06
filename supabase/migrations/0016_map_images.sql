-- 0016 첨부 이미지를 본문에서 빼내 Storage로.
--
-- 왜: 이미지는 본문(jsonb)에 base64 데이터 URL로 인라인돼 있었다. 첨부 한 장이면
-- 수백 KB라, ① 문서 저장량과 egress가 통째로 커지고 ② 실시간 협업에서는 **메시지
-- 크기 한도(무료 250KB)를 넘겨 합류 동기화가 조용히 버려지는** 사고까지 났다
-- (커서는 오는데 편집이 영영 안 오던 그 제보). 이제 본문에는 `mfimg:<경로>` 참조만
-- 남고 실물은 이 버킷에 있다.
--
-- 경로 규칙: `<document_id>/<uuid>.<ext>`. 첫 조각이 문서 id라서 아래 정책이
-- `split_part(name, '/', 1)`로 문서를 알아낼 수 있고, 그래서 **이미지 권한이 문서
-- 권한과 자동으로 같아진다** — 0009의 `owns_document()`/`shared_with_me()`를 그대로
-- 재사용하기 때문이다(공유하면 같이 보이고, 공유를 끊으면 같이 막힌다).
--
-- 버킷은 비공개다. 공개 버킷 + 추측 불가 경로가 더 간단하지만 URL이 한 번 새면
-- 영원히 열려 있다 — 클라이언트는 그릴 때마다 만료 있는 서명 URL을 받는다.

-- 버킷 (이미 있으면 그대로 둔다)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'map-images',
  'map-images',
  false,
  10 * 1024 * 1024, -- 클라이언트가 긴 변 1024로 줄여 올리므로 넉넉한 상한
  array['image/jpeg', 'image/png', 'image/gif', 'image/webp']
)
on conflict (id) do nothing;

-- 정책은 재실행 가능하게 (drop → create)
drop policy if exists "map images readable by document readers" on storage.objects;
drop policy if exists "map images writable by document editors" on storage.objects;
drop policy if exists "map images deletable by document owner" on storage.objects;

-- 읽기: 그 문서를 볼 수 있는 사람(소유자 또는 초대받은 사람 — view 포함)
create policy "map images readable by document readers"
on storage.objects for select
to authenticated
using (
  bucket_id = 'map-images'
  and (
    public.owns_document(split_part(name, '/', 1))
    or public.shared_with_me(split_part(name, '/', 1), 'view')
  )
);

-- 쓰기: 그 문서를 **편집**할 수 있는 사람만(보기 전용 초대는 올릴 수 없다)
create policy "map images writable by document editors"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'map-images'
  and (
    public.owns_document(split_part(name, '/', 1))
    or public.shared_with_me(split_part(name, '/', 1), 'edit')
  )
);

-- 삭제: 소유자만. 문서를 영구 삭제(휴지통 비우기)할 때 실물도 함께 지운다.
-- 편집자에게 열어 두지 않는 이유는 undo다 — 편집 중 이미지를 지웠다가 되돌리면
-- 참조는 살아 돌아오는데 실물이 없으면 복구가 안 된다. 그래서 앱은 편집 중에는
-- 실물을 지우지 않고, 문서를 영구 삭제할 때만 정리한다.
create policy "map images deletable by document owner"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'map-images'
  and public.owns_document(split_part(name, '/', 1))
);

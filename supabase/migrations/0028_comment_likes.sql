-- 0028 — 댓글 좋아요(요청: "해결" 대신 "좋아요").
--
-- **한 사람의 한 표 = 항목 하나**(행 하나)로 둔다. `document_comments`에 `likes int`
-- 하나를 두고 올렸다 내렸다 하면 ① 누가 눌렀는지 몰라 토글이 불가능하고 ② 두 사람이
-- 동시에 누르면 한쪽이 사라진다(read-modify-write). 반응(reactions)에서 이미 같은
-- 이유로 항목 모델을 골랐다.
--
-- 권한: 그 댓글을 **읽을 수 있는 사람**이 읽고, 자기 표만 넣고 뺀다. 남의 표를 대신
-- 눌러 줄 수 없고(그건 위조다), 댓글이 지워지면 표도 함께 사라진다(cascade).

create table if not exists public.comment_likes (
  comment_id uuid not null references public.document_comments (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

create index if not exists comment_likes_comment_idx on public.comment_likes (comment_id);

alter table public.comment_likes enable row level security;

-- "이 댓글을 읽을 수 있는가" — 0020의 댓글 select 정책과 같은 판단(소유자 또는
-- 초대받은 사람). 링크 공유(0017)로 들어온 사람은 댓글 자체를 못 읽으므로 여기서도 제외.
create or replace function public.can_read_comment(p_comment uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.document_comments c
     where c.id = p_comment
       and (public.owns_document(c.document_id) or public.shared_with_me(c.document_id))
  );
$$;

drop policy if exists comment_likes_select on public.comment_likes;
create policy comment_likes_select on public.comment_likes
  for select using (public.can_read_comment(comment_id));

drop policy if exists comment_likes_insert on public.comment_likes;
create policy comment_likes_insert on public.comment_likes
  for insert with check (user_id = auth.uid() and public.can_read_comment(comment_id));

drop policy if exists comment_likes_delete on public.comment_likes;
create policy comment_likes_delete on public.comment_likes
  for delete using (user_id = auth.uid());

-- MindFlow — 댓글 확장: 답글(스레드) · 멘션 · 해결 표시 (0020의 후속).
--
-- 셋 다 같은 테이블의 컬럼이다 — 답글은 "부모가 있는 댓글"일 뿐이고, 해결 표시는
-- 스레드(최상위 댓글)의 상태이며, 멘션은 이후 알림이 조회할 대상 목록이다.

alter table public.document_comments
  -- 답글: 최상위 댓글(스레드 뿌리)만 부모가 될 수 있다(아래 트리거) — 단층 스레드.
  -- 뿌리를 지우면 답글도 함께 사라진다(대화의 맥락이 사라진 답글만 남기지 않는다).
  add column if not exists parent_id uuid references public.document_comments (id) on delete cascade,
  -- 해결 표시(스레드 뿌리에만 의미). 시각 + 누가(탈퇴 대비 이름 스냅샷 — 0020의
  -- author_name과 같은 이유).
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by uuid references auth.users (id) on delete set null,
  add column if not exists resolved_by_name text not null default '',
  -- 멘션: [{"email": "...", "name": "..."}] — 본문에는 "@이름"이 글자로 남고,
  -- 여기의 이메일이 (이후) 알림이 겨냥할 대상이다. 이 명단의 이메일은 공유
  -- 참가자(0011로 서로에게 이미 보이는 값)에서 고른 것이라 새로 노출되는 정보가 없다.
  add column if not exists mentions jsonb not null default '[]'::jsonb;

create index if not exists document_comments_parent_idx on public.document_comments (parent_id);

-- ── 답글 무결성 트리거 ──────────────────────────────────────────────────────
-- CHECK 제약은 서브쿼리를 못 쓰므로 트리거로: 부모는 (1) 같은 문서의 댓글이어야
-- 하고 (2) 자신도 답글이면 안 된다(단층 스레드 — 대댓글 없음).
create or replace function public.check_comment_parent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  p record;
begin
  if new.parent_id is not null then
    select document_id, parent_id into p from public.document_comments where id = new.parent_id;
    if p.document_id is null or p.document_id <> new.document_id then
      raise exception 'parent comment must belong to the same document';
    end if;
    if p.parent_id is not null then
      raise exception 'replies cannot be nested';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists document_comments_parent_check on public.document_comments;
create trigger document_comments_parent_check
  before insert on public.document_comments
  for each row execute function public.check_comment_parent();

-- ── 해결 표시 RPC ───────────────────────────────────────────────────────────
-- UPDATE 정책 대신 좁은 RPC를 내는 이유(0019 `mark_shares_seen`과 같은 판단):
-- RLS는 컬럼 단위로 못 좁힌다 — 댓글에 UPDATE를 열면 resolved_at만이 아니라
-- **남의 body까지** 고칠 수 있게 되어 0020의 "수정은 열지 않는다"가 무너진다.
-- 해결/해제 권한은 댓글을 쓸 수 있는 사람 전원(소유자 + 초대받은 사람) — 리뷰를
-- 요청받은 보기 전용 참가자도 자기 논점이 반영되면 스스로 접을 수 있어야 한다
-- (구글 문서와 같은 규칙).
create or replace function public.set_comment_resolved(comment_id uuid, resolved boolean, resolver_name text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
begin
  select id, document_id, parent_id into c from public.document_comments where id = comment_id;
  if c.id is null then
    raise exception 'comment not found';
  end if;
  if c.parent_id is not null then
    raise exception 'only thread roots can be resolved';
  end if;
  if not (public.owns_document(c.document_id) or public.shared_with_me(c.document_id, 'view')) then
    raise exception 'not allowed';
  end if;
  update public.document_comments
     set resolved_at = case when resolved then now() else null end,
         resolved_by = case when resolved then auth.uid() else null end,
         resolved_by_name = case when resolved then coalesce(resolver_name, '') else '' end
   where id = comment_id;
end;
$$;

revoke all on function public.set_comment_resolved(uuid, boolean, text) from public;
grant execute on function public.set_comment_resolved(uuid, boolean, text) to authenticated;

-- MindFlow — 주제(노드)에 붙는 댓글.
--
-- 왜 노드에 붙이나: 마인드맵에서 논의의 대상은 "주제"다. 문서 전체 댓글은 루트
-- 주제의 댓글로 대신할 수 있으므로, 붙는 자리를 하나로 두어 모델을 단순하게 지킨다.
--
-- 왜 문서 본문(jsonb)이 아니라 별도 테이블인가:
--  * 댓글은 **본문과 수명이 다르다** — 문서를 되돌려도(버전 기록) 논의는 남아야 한다.
--  * 본문에 넣으면 CRDT 병합 대상이 되어, 끊긴 채 양쪽이 댓글을 달면 한쪽이 사라진다
--    (#332에서 확인한 배열 필드의 한계와 같은 문제).
--  * 본문은 자동저장마다 통째로 오가는 값이라, 댓글이 늘수록 저장·전송이 무거워진다.

create table if not exists public.document_comments (
  id uuid primary key default gen_random_uuid(),
  document_id text not null references public.documents (id) on delete cascade,
  -- 대상 주제의 id(문서 안에서만 유일). 주제가 지워져도 댓글은 남는다 —
  -- 참조 무결성을 걸 수 없는 값(본문 jsonb 안의 키)이라 앱이 "사라진 주제"로 보여 준다.
  node_id text not null,
  -- 작성자. 탈퇴하면 null이 되고 댓글은 남는다(`author_name` 스냅샷으로 계속 읽힌다).
  author uuid references auth.users (id) on delete set null,
  /**
   * 작성 시점의 표시 이름 **스냅샷**.
   *
   * profiles 조인 대신 스냅샷을 쓰는 이유: 댓글 목록은 한 번의 select로 끝나야 한다
   * (클라이언트는 남의 `profiles`를 못 읽어 0010처럼 SECURITY DEFINER RPC가 또 필요해진다).
   * 대가는 "이름을 바꾸면 옛 댓글은 옛 이름"인데, 채팅·리뷰 도구들이 흔히 택하는 절충이다.
   */
  author_name text not null default '',
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists document_comments_doc_idx on public.document_comments (document_id, created_at);

alter table public.document_comments enable row level security;

-- ── 정책 ────────────────────────────────────────────────────────────────────
-- 읽기: 소유자 + **초대받은 사람**(view/edit)만.
-- 링크 공유(0017)로 들어온 사람은 제외한다 — 링크는 누구에게나 전달될 수 있는데
-- 댓글은 내부 논의라, 본문을 보여 주는 것과 같은 무게로 다룰 수 없다.
drop policy if exists "comments_select" on public.document_comments;
create policy "comments_select" on public.document_comments
  for select using (
    public.owns_document(document_id) or public.shared_with_me(document_id, 'view')
  );

-- 쓰기: 읽을 수 있는 사람은 쓸 수 있다 — **보기 전용도 댓글은 달 수 있다**.
-- 리뷰를 받으려고 보기 권한으로 부르는 일이 흔하고, 그때 의견을 남길 길이 없으면
-- 초대의 목적이 반쯤 사라진다(구글 문서의 '댓글 작성자' 권한과 같은 생각).
drop policy if exists "comments_insert" on public.document_comments;
create policy "comments_insert" on public.document_comments
  for insert with check (
    author = auth.uid()
    and (public.owns_document(document_id) or public.shared_with_me(document_id, 'view'))
  );

-- 지우기: 쓴 사람 본인, 그리고 문서 소유자(정리 권한).
drop policy if exists "comments_delete" on public.document_comments;
create policy "comments_delete" on public.document_comments
  for delete using (author = auth.uid() or public.owns_document(document_id));

-- 수정은 열지 않는다: 남긴 말이 조용히 바뀌면 논의 기록으로서 믿을 수 없다.
-- 고치고 싶으면 지우고 다시 쓴다(지우기는 본인에게 열려 있다).

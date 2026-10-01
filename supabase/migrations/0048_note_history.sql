-- MindFlow — 공책 **페이지별 기록**("기록" 패널)을 서버로.
--
-- Apply with the Supabase CLI (`supabase db push` / `supabase migration up`)
-- or `psql "$DATABASE_URL" -f supabase/migrations/0048_note_history.sql`.
-- See server/supabase/docs/backend.md for the full provisioning checklist.
--
-- ── note_history ─────────────────────────────────────────────────────────
-- 항목 하나 = "누가·언제·무엇을 바꿨다" 한 줄 + 그 직후의 **페이지 스냅샷**.
-- 예전 `versionHistory.ts`는 이 기기 localStorage의 스냅샷이라 **누가**가 없었고,
-- 같이 쓰는 공책에서는 남의 편집을 볼 길이 없었다 — 그래서 서버에 둔다.
--
-- 왜 문서 본문(`documents.data`)이 아니라 별도 표인가: 댓글(0020)과 같은 이유다.
--  * 기록은 본문과 수명이 다르다 — 본문을 되돌려도 "되돌렸다"는 기록은 남아야 한다.
--  * 본문은 자동저장마다 통째로 오가는 값이라, 기록을 안에 넣으면 저장할 때마다
--    스냅샷이 쌓인 만큼 같이 실려 간다.
--
-- 쓰기 모델: **되돌리기도 새 항목**이다(지우지 않는다) — 그래서 DELETE 정책이 없다.
-- 연속 편집의 "묶음 창"만 자기 항목을 UPDATE한다(요약·전후 글·스냅샷·시각).
-- 늘어나는 양은 아래 보관 트리거가 막는다.

create table if not exists public.note_history (
  id uuid primary key default gen_random_uuid(),
  -- 문서가 지워지면 기록도 함께 간다(휴지통은 soft delete라 영향 없음).
  document_id text not null references public.documents (id) on delete cascade,
  -- 공책 안의 페이지 id — 본문(jsonb) 안의 키라 참조 무결성을 걸 수 없다.
  -- 페이지가 지워져도 기록은 남는다(되돌릴 길이므로 오히려 남아야 한다).
  page_id text not null,
  at timestamptz not null default now(),
  -- 행위자. `default auth.uid()`라 클라이언트가 보내지 않아도 호출자 id가 찍히고,
  -- 그것이 insert 정책(`actor_id = auth.uid()`)이 요구하는 값이다 — 남의 이름으로
  -- 기록을 위조할 수 없다. 탈퇴하면 null이 되고 기록은 아래 스냅샷 이름으로 읽힌다.
  actor_id uuid references auth.users (id) on delete set null default auth.uid(),
  -- 행위 시점의 이름·색·사진 **스냅샷**(댓글의 `author_name`과 같은 절충 — 목록이
  -- select 한 번으로 끝나야 하고, 남의 `profiles`는 클라이언트가 못 읽는다).
  actor_name text not null default '',
  actor_color text not null default '',
  actor_avatar text,
  kind text not null check (kind in ('create', 'edit', 'insert', 'delete', 'move', 'restore', 'checklist', 'table', 'tag', 'rename')),
  summary text not null default '',
  -- 문구 수정(`edit`)일 때만 `{ "before": string, "after": string }`, 아니면 null.
  diff jsonb,
  -- 눌렀을 때 본문에서 강조할 블록 id.
  anchor text,
  -- 이 항목 **직후의** 페이지(`NotePage` JSON). 되돌리기가 이것을 쓴다.
  snapshot jsonb not null
);

-- 목록 질의(`where document_id = ? and page_id = ? order by at desc`)와 보관
-- 트리거가 같은 인덱스를 탄다.
create index if not exists note_history_page_idx on public.note_history (document_id, page_id, at desc);

alter table public.note_history enable row level security;

-- 정책은 전부 `to authenticated`다 — 빼면 PUBLIC이라 anon에게도 열린다(링크 공유
-- 정책이 문서 본문을 익명에 노출했던 사건). 아래 revoke는 정책이 어긋나도 막는 이중 잠금.
revoke all on public.note_history from anon;

-- 읽기: 소유자 + **초대받은 사람**(view/edit). 링크 공유(0017)로 들어온 사람은 제외 —
-- 기록에는 남의 이름과 지난 본문이 들어 있어 댓글(0020)과 같은 무게로 다룬다.
drop policy if exists "note_history_select" on public.note_history;
create policy "note_history_select" on public.note_history
  for select to authenticated using (
    public.owns_document(document_id) or public.shared_with_me(document_id, 'view')
  );

-- 쓰기: **편집할 수 있는 사람**만, 자기 이름으로만. 보기 전용은 댓글과 달리 못 쓴다 —
-- 기록은 본문을 바꾼 일의 흔적이라 바꿀 수 없는 사람의 항목이 있을 수 없다.
drop policy if exists "note_history_insert" on public.note_history;
create policy "note_history_insert" on public.note_history
  for insert to authenticated with check (
    actor_id = auth.uid()
    and (public.owns_document(document_id) or public.shared_with_me(document_id, 'edit'))
  );

-- 고치기: **내 항목만**(묶음 창 안의 연속 편집). 남의 기록을 조용히 바꾸면 기록으로서
-- 믿을 수 없다. `with check`에서 편집 권한을 다시 본다 — 공유가 풀린 뒤에는 내 옛
-- 항목도 못 고친다. (RLS는 칼럼 단위로 좁힐 수 없어 `actor_id`·`document_id`를 옮기는
-- UPDATE는 with check가 막는다: actor_id는 여전히 나여야 하고, 옮겨 간 문서에서도
-- 편집 권한이 있어야 한다. 남의 문서에 내 이름으로 항목을 심는 길은 insert와 같은 조건이다.)
drop policy if exists "note_history_update" on public.note_history;
create policy "note_history_update" on public.note_history
  for update to authenticated
  using (actor_id = auth.uid())
  with check (
    actor_id = auth.uid()
    and (public.owns_document(document_id) or public.shared_with_me(document_id, 'edit'))
  );

-- DELETE 정책은 두지 않는다: 클라이언트는 기록을 지우지 못한다. 문서가 지워지면
-- 위 on-delete-cascade가, 오래된 항목은 아래 보관 트리거가 정리한다.

-- ── 보관 ──────────────────────────────────────────────────────────────────
-- **최근 30일은 전부, 그 이전은 하루에 하나**(그날의 마지막 항목). 스냅샷이 페이지
-- 통째라 무제한으로 쌓으면 무료 플랜 용량을 먹는다. 날 경계는 한국 날짜 — 사용자가
-- "어제 마지막으로 저장한 것"이라 부르는 단위와 맞춘다.
--
-- 별도 cron 없이 **같은 페이지에 새 항목이 들어올 때** 그 페이지만 정리한다
-- (안 쓰는 페이지는 늘지도 않으므로 정리할 이유도 없다). `security definer`인 이유:
-- 정책에 DELETE가 없어 호출자 권한으로는 지울 수 없다 — 지우는 범위가 위 문장의
-- 한 페이지로 고정이라 definer여도 열리는 것이 없다.
-- 정리 실패가 사용자의 기록 저장을 막으면 안 되므로 예외는 경고로만 남긴다
-- (별칭을 `old`로 지었다가 트리거의 OLD와 겹쳐 "ambiguous"로 조용히 실패한 적이 있다 —
-- 하네스가 경고 한 줄로 잡았다. 별칭은 `ranked`).
create or replace function public.note_history_prune()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.note_history h
   using (
     select x.id,
            row_number() over (
              partition by (x.at at time zone 'Asia/Seoul')::date
              order by x.at desc, x.id desc
            ) as rn
       from public.note_history x
      where x.document_id = new.document_id
        and x.page_id = new.page_id
        and x.at < now() - interval '30 days'
   ) ranked
   where h.id = ranked.id
     and ranked.rn > 1;
  return null;
exception when others then
  raise warning 'note_history_prune failed: % (%)', sqlerrm, sqlstate;
  return null;
end;
$$;

-- 트리거 함수는 클라이언트가 부를 일이 없다.
revoke all on function public.note_history_prune() from public, anon, authenticated;

drop trigger if exists note_history_prune on public.note_history;
create trigger note_history_prune
  after insert on public.note_history
  for each row execute function public.note_history_prune();

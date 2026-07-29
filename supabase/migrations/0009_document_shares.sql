-- MindFlow — 문서 공유(사람 사이의 실시간 공동 편집).
--
-- 지금까지 `documents`는 소유자 전용이었다(0001의 `documents_*_own` 정책). 그래서
-- Yjs/CRDT 동기화와 접속자 커서가 실제로 붙어 있어도 **다른 사람과는 공동 편집이
-- 불가능**했다 — 상대가 문서를 아예 읽을 수 없으니 협업할 대상이 없었다. 랜딩에
-- 적어 둔 "실시간 공동 편집"을 사실로 만드는 것이 이 마이그레이션의 목적이다.
--
-- 초대는 **이메일**로 한다(사용자 id가 아니라):
--  * 클라이언트는 `auth.users`를 읽을 수 없어 이메일 → uuid 변환을 할 수 없다.
--    이메일을 그대로 담고 읽는 쪽에서 `auth.jwt() ->> 'email'`과 맞춘다.
--  * 그래서 **아직 가입하지 않은 사람도 초대할 수 있다** — 그 이메일로 가입하는
--    순간 접근 권한이 생긴다(초대를 따로 보류할 필요가 없다).
-- 이메일은 대소문자를 구분하지 않으므로 항상 `lower()`로 비교/저장한다.

create table if not exists public.document_shares (
  document_id text not null references public.documents (id) on delete cascade,
  -- 초대받은 사람의 이메일(소문자). uuid가 아닌 이유는 위 주석 참고.
  invitee_email text not null,
  -- 권한. 지금 UI는 'edit'만 제공한다(뷰어는 CRDT로 자기 편집이 상대에게
  -- 전파되므로 편집 차단까지 함께 해야 한다 — 별도 작업). 컬럼과 정책은 미리
  -- 갖춰 두어 나중에 UI만 붙이면 되게 한다.
  role text not null default 'edit' check (role in ('edit', 'view')),
  invited_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (document_id, invitee_email)
);

create index if not exists document_shares_invitee_idx on public.document_shares (invitee_email);
create index if not exists document_shares_document_idx on public.document_shares (document_id);

alter table public.document_shares enable row level security;

-- 내가 소유한 문서의 공유인가 (정책에서 반복 사용).
create or replace function public.owns_document(doc_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.documents d where d.id = doc_id and d.owner = auth.uid());
$$;

-- 나에게 공유된 문서인가. `security definer`인 이유: 이 함수를 `documents` 정책
-- 안에서 부르는데, 호출자 권한으로 `document_shares`를 다시 읽으면 그 테이블의
-- 정책이 또 `documents`를 참조해 **순환**이 된다. definer로 끊는다.
create or replace function public.shared_with_me(doc_id text, min_role text default 'view')
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.document_shares s
    where s.document_id = doc_id
      and s.invitee_email = lower(coalesce(auth.jwt() ->> 'email', ''))
      and (min_role = 'view' or s.role = 'edit')
  );
$$;

revoke all on function public.owns_document(text) from anon;
revoke all on function public.shared_with_me(text, text) from anon;
grant execute on function public.owns_document(text) to authenticated;
grant execute on function public.shared_with_me(text, text) to authenticated;

-- ── document_shares 정책 ────────────────────────────────────────────────
-- 소유자는 자기 문서의 공유를 모두 관리한다. 초대받은 사람은 **자기 행만** 읽을 수
-- 있다(누가 또 초대됐는지는 소유자만 본다 — 참가자 목록이 곧 이메일 목록이므로).
drop policy if exists "shares_select_owner_or_self" on public.document_shares;
create policy "shares_select_owner_or_self" on public.document_shares
  for select using (
    public.owns_document(document_id)
    or invitee_email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

drop policy if exists "shares_insert_owner" on public.document_shares;
create policy "shares_insert_owner" on public.document_shares
  for insert with check (public.owns_document(document_id) and auth.uid() = invited_by);

drop policy if exists "shares_update_owner" on public.document_shares;
create policy "shares_update_owner" on public.document_shares
  for update using (public.owns_document(document_id)) with check (public.owns_document(document_id));

-- 소유자는 누구든 내보낼 수 있고, 초대받은 사람은 **자기 자신만** 빼낼 수 있다
-- (공유 나가기). 남을 내보내지는 못한다.
drop policy if exists "shares_delete_owner_or_self" on public.document_shares;
create policy "shares_delete_owner_or_self" on public.document_shares
  for delete using (
    public.owns_document(document_id)
    or invitee_email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

-- 이메일은 항상 소문자로 저장한다(비교와 PK가 대소문자에 휘둘리지 않게).
create or replace function public.normalize_share_email()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.invitee_email := lower(trim(new.invitee_email));
  return new;
end;
$$;

-- 트리거 전용 함수 — 직접 실행 권한은 회수한다(0007의 규약). 트리거는 EXECUTE
-- 권한과 무관하게 발화한다.
revoke execute on function public.normalize_share_email() from public, anon, authenticated;

drop trigger if exists document_shares_normalize_email on public.document_shares;
create trigger document_shares_normalize_email
  before insert or update on public.document_shares
  for each row execute function public.normalize_share_email();

-- ── documents 정책 확장: 소유자 OR 공유받은 사람 ─────────────────────────
-- SELECT은 'view'로도 되고, UPDATE는 'edit'만. INSERT/DELETE는 소유자 전용
-- (공유받은 사람이 남의 문서를 지우거나 새로 만들 수는 없다) — 0001 그대로 둔다.
drop policy if exists "documents_select_own" on public.documents;
create policy "documents_select_own_or_shared" on public.documents
  for select using (auth.uid() = owner or public.shared_with_me(id, 'view'));

drop policy if exists "documents_update_own" on public.documents;
create policy "documents_update_own_or_shared" on public.documents
  for update using (auth.uid() = owner or public.shared_with_me(id, 'edit'))
  with check (auth.uid() = owner or public.shared_with_me(id, 'edit'));

-- ── Realtime 채널 인증 ───────────────────────────────────────────────────
-- 문서 내용은 Yjs 업데이트로 `mindflow-collab:<docId>` 브로드캐스트 채널을 흐른다.
-- 이 채널에 **아무 인증이 없었다**: anon 키는 클라이언트 번들에 공개돼 있으므로
-- docId를 아는 사람은 누구나 붙어 편집 내용을 받아 보거나 주입할 수 있었다
-- (특히 예전 방식 id는 `m<제목해시>` — 제목만 알면 계산된다).
--
-- Realtime Authorization을 켜서 채널 참가/발신을 RLS로 막는다. 클라이언트는
-- `channel(name, { config: { private: true } })`로 붙어야 이 정책을 탄다
-- (`apps/web/src/collab/SupabaseRealtimeProvider.ts`).
create or replace function public.collab_channel_doc_id(topic text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when topic like 'mindflow-collab:%' then substring(topic from length('mindflow-collab:') + 1) else null end;
$$;

grant execute on function public.collab_channel_doc_id(text) to authenticated;

-- ⚠️ `realtime` 스키마는 우리 소유가 아니다. 마이그레이션 실행 역할에 권한이 없으면
-- 여기서 실패해 **배포 전체가 막힌다** — 그래서 예외를 잡아 NOTICE만 남기고 넘어간다.
-- 그 경우 채널은 예전처럼 열린 상태로 남으므로, 대시보드 SQL Editor에서 아래 블록을
-- 그대로 한 번 실행해 주면 된다(`server/supabase/docs/backend.md` §공유 참고).
do $$
begin
  alter table realtime.messages enable row level security;

  drop policy if exists "collab_channel_read" on realtime.messages;
  create policy "collab_channel_read" on realtime.messages
    for select to authenticated
    using (
      public.collab_channel_doc_id(realtime.topic()) is not null
      and (
        public.owns_document(public.collab_channel_doc_id(realtime.topic()))
        or public.shared_with_me(public.collab_channel_doc_id(realtime.topic()), 'view')
      )
    );

  -- 발신(브로드캐스트)은 편집 권한이 있어야 한다.
  drop policy if exists "collab_channel_write" on realtime.messages;
  create policy "collab_channel_write" on realtime.messages
    for insert to authenticated
    with check (
      public.collab_channel_doc_id(realtime.topic()) is not null
      and (
        public.owns_document(public.collab_channel_doc_id(realtime.topic()))
        or public.shared_with_me(public.collab_channel_doc_id(realtime.topic()), 'edit')
      )
    );
exception
  when insufficient_privilege or undefined_table then
    raise notice 'realtime.messages 정책을 적용하지 못했습니다(권한/테이블 없음). 대시보드 SQL Editor에서 수동 적용이 필요합니다: %', sqlerrm;
end
$$;

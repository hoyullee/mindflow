-- MindFlow — 공책 **태그 판**을 서버로(요청: "서버에 태그 저장소를 여는 작업").
--
-- Apply with the Supabase CLI (`supabase db push` / `supabase migration up`)
-- or `psql "$DATABASE_URL" -f supabase/migrations/0042_note_tags.sql`.
-- See server/supabase/docs/backend.md for the full provisioning checklist.
--
-- ── note_tags ────────────────────────────────────────────────────────────
-- 사용자당 **정확히 한 행**. `data`는 태그 판 전체를 그대로 담는다 —
-- `{ made: string[], colors: Record<string,string>, hidden: string[] }`
-- (made = 사용자가 만든 태그, colors = 이름→점 색, hidden = 지운 태그 — 기본
-- 여섯은 코드 상수라 목록에서 뺄 수 없어 **가려서** 지운다).
--
-- 왜 태그마다 한 행이 아니라 블롭인가: 판은 통째로 읽고 통째로 쓴다(고르개를
-- 그릴 때 늘 전부 필요하고, 한 번에 바뀌는 것은 한 항목뿐이라 경쟁이 없다).
-- `workspaces.data`가 작업공간 구조를 통째로 담는 것과 같은 판단이다(ADR-0001 §3.3).
-- `SupabaseTagStore`(apps/web/src/adapters/)가 이 테이블의 유일한 손님이다.

create table if not exists public.note_tags (
  -- `owner`가 PK이고 기본값이 auth.uid()다 — 클라이언트의 upsert가 owner 칼럼을
  -- 보내지 않아도 호출자 id로 찍히고, 그것이 곧 insert 정책(`with check`)이
  -- 요구하는 값이다(`workspaces`·`documents`와 같은 패턴).
  owner uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.note_tags enable row level security;

-- RLS: 자기 행만 읽고 쓴다(교차 접근 없음, service_role 우회 정책도 두지 않는다).
drop policy if exists "note_tags_select_own" on public.note_tags;
create policy "note_tags_select_own" on public.note_tags
  for select using (auth.uid() = owner);

drop policy if exists "note_tags_insert_own" on public.note_tags;
create policy "note_tags_insert_own" on public.note_tags
  for insert with check (auth.uid() = owner);

drop policy if exists "note_tags_update_own" on public.note_tags;
create policy "note_tags_update_own" on public.note_tags
  for update using (auth.uid() = owner) with check (auth.uid() = owner);

-- 탈퇴(`delete_account()`)는 auth.users 행을 지우고, 위 on-delete-cascade가
-- 이 행을 함께 지운다 — 따로 손볼 것이 없다(0005와 같은 계열).

-- `updated_at` 트리거 — 0001_init.sql의 public.set_updated_at()을 재사용한다.
drop trigger if exists note_tags_set_updated_at on public.note_tags;
create trigger note_tags_set_updated_at
  before update on public.note_tags
  for each row execute function public.set_updated_at();

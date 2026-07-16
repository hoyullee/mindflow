-- MindFlow — per-user workspace structure (spaces + folders), so a user's
-- spaces sync across every device they log in on instead of living only in
-- one browser's localStorage.
--
-- Apply with the Supabase CLI (`supabase db push` / `supabase migration up`)
-- or `psql "$DATABASE_URL" -f supabase/migrations/0004_workspaces.sql`.
-- See server/supabase/docs/backend.md for the full provisioning checklist.
--
-- ── workspaces ───────────────────────────────────────────────────────────
-- Exactly ONE row per user. `data` holds the whole workspace JSON that
-- `features/home` owns — `{ spaces: SpaceData[], mapFolders: Record<string,string> }`
-- (spaces = id/name/color/home + each space's maps & folders). It's a single
-- opaque blob (not a normalized spaces/folders schema) on purpose: the shape
-- lives in the shared TS types, mirroring how `documents.data` stores the doc
-- body whole (ADR-0001 §3.3). `SupabaseSpaceStore` (apps/web/src/adapters/) is
-- the only client of this table.

create table if not exists public.workspaces (
  -- `owner` is the PK and defaults to auth.uid(), so the client's upsert (which
  -- doesn't send an owner column) gets stamped with the caller's id — exactly
  -- what the insert RLS policy (`with check auth.uid() = owner`) requires, and
  -- the same owner-default pattern `documents` uses.
  owner uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.workspaces enable row level security;

-- RLS: a user can only see/write their own workspace row (no cross-user access,
-- no service-role bypass policy here — see server/supabase/docs/backend.md).
drop policy if exists "workspaces_select_own" on public.workspaces;
create policy "workspaces_select_own" on public.workspaces
  for select using (auth.uid() = owner);

drop policy if exists "workspaces_insert_own" on public.workspaces;
create policy "workspaces_insert_own" on public.workspaces
  for insert with check (auth.uid() = owner);

drop policy if exists "workspaces_update_own" on public.workspaces;
create policy "workspaces_update_own" on public.workspaces
  for update using (auth.uid() = owner) with check (auth.uid() = owner);

-- `updated_at` trigger — reuses public.set_updated_at() from 0001_init.sql.
drop trigger if exists workspaces_set_updated_at on public.workspaces;
create trigger workspaces_set_updated_at
  before update on public.workspaces
  for each row execute function public.set_updated_at();

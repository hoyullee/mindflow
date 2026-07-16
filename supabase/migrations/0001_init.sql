-- MindFlow — M4 initial schema: profiles + documents, RLS-enforced ownership.
--
-- Apply with the Supabase CLI (`supabase db push` / `supabase migration up`)
-- or `psql "$DATABASE_URL" -f supabase/migrations/0001_init.sql`
-- against a fresh Supabase project. See server/supabase/docs/backend.md for the full
-- provisioning checklist (this file assumes `auth.users` already exists,
-- i.e. Supabase Auth is enabled — true for every Supabase project by default).
--
-- Doc bodies are stored whole in `documents.data` (JSONB) — exactly what
-- `@mindflow/mindmap-core`'s `serializeDoc()` produces / `parseDoc()` consumes.
-- No server-side node-level schema: the wire format lives entirely in the
-- shared TS core, not duplicated as SQL columns (ADR-0001 §3.3's tradeoff #3).

-- ── profiles ─────────────────────────────────────────────────────────────
-- One row per `auth.users` row. Minimal for now (display name only) — extend
-- here, not by duplicating auth fields.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_upsert_own" on public.profiles;
create policy "profiles_upsert_own" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Auto-create a profile row the moment a user signs up, so the app never has
-- to do a separate "create my profile" round-trip after auth.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── documents ────────────────────────────────────────────────────────────
-- `data` = the core's `DocV1` JSON verbatim. `version` is the optimistic-lock
-- counter `DocStore.save()` compares against (`SupabaseDocStore`/`LocalDocStore`
-- in apps/web/src/adapters/). `deleted_at` = soft-delete (trash); `is_favorite`
-- backs Home's favorites list — both are additive to the M4 task's minimal
-- column list, kept here so `DocMeta` (apps/web/src/adapters/ports.ts) maps
-- 1:1 onto a single table with no follow-up migration needed.

-- `id` is TEXT, not uuid: the web client generates document ids itself
-- (Home's `newMapHref()` → `new-<base36 ts><rand>`, and the localStorage
-- `mindflow_doc_<id>` convention), so the column must accept arbitrary
-- strings. The default still mints a uuid-shaped value for any row inserted
-- without an explicit id. (`owner` stays uuid — it references auth.users.)
create table if not exists public.documents (
  id text primary key default gen_random_uuid()::text,
  -- `owner` defaults to auth.uid() so the client's INSERT (which doesn't send
  -- an owner column) gets stamped with the caller's id automatically — that's
  -- what the `documents_insert_own` RLS policy (`with check auth.uid() = owner`)
  -- requires. The default runs in the authenticated request context, so it
  -- resolves to the logged-in user (the standard Supabase owner-column pattern).
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null default '',
  data jsonb not null,
  version integer not null default 1,
  is_favorite boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists documents_owner_idx on public.documents (owner);
create index if not exists documents_owner_updated_at_idx on public.documents (owner, updated_at desc);
-- Partial index for the common "active (non-trashed) docs" listing query.
create index if not exists documents_owner_active_idx on public.documents (owner) where deleted_at is null;

alter table public.documents enable row level security;

-- RLS: an owner can do anything to their own rows; nobody else can see or
-- touch them (no admin/service-role bypass policy here on purpose — server-
-- side tooling should use the service_role key, which bypasses RLS entirely
-- and must NEVER be shipped to the client — see server/supabase/docs/backend.md).
drop policy if exists "documents_select_own" on public.documents;
create policy "documents_select_own" on public.documents
  for select using (auth.uid() = owner);

drop policy if exists "documents_insert_own" on public.documents;
create policy "documents_insert_own" on public.documents
  for insert with check (auth.uid() = owner);

drop policy if exists "documents_update_own" on public.documents;
create policy "documents_update_own" on public.documents
  for update using (auth.uid() = owner) with check (auth.uid() = owner);

drop policy if exists "documents_delete_own" on public.documents;
create policy "documents_delete_own" on public.documents
  for delete using (auth.uid() = owner);

-- `updated_at` trigger — every UPDATE stamps the current time server-side, so
-- clients never need to (and can't spoof it to win/lose an optimistic-lock race).
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists documents_set_updated_at on public.documents;
create trigger documents_set_updated_at
  before update on public.documents
  for each row execute function public.set_updated_at();

-- Note: `apps/web/src/adapters/supabase/supabaseDocStore.ts`'s `save()` also
-- sends `updated_at` explicitly in its UPDATE payload — harmless (this trigger
-- overwrites it with `now()` regardless), kept there only so a caller reading
-- back the row from the SAME statement's `.select()` sees a sane value even
-- before the trigger's effect is visible in that response.

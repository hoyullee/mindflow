-- Fix: `documents.id` must be TEXT, not uuid.
--
-- The web client generates document ids itself (Home's `newMapHref()` →
-- `new-<base36 timestamp><rand>`, e.g. `new-m8x9k2p472`, and the localStorage
-- `mindflow_doc_<id>` convention) — these are NOT uuids. Against the original
-- `id uuid` column, `SupabaseDocStore.save()`'s upsert was rejected by Postgres
-- ("invalid input syntax for type uuid"), so a brand-new map silently failed to
-- persist and never appeared in Home's list.
--
-- Apply this in the Supabase SQL editor if you already ran the original
-- `0001_init.sql` (which created `id uuid`). Fresh projects get `id text`
-- straight from the updated 0001 and don't need this — but running it there is
-- a harmless no-op (the column is already text). Safe on a populated table too:
-- every existing uuid value casts cleanly to its text form.

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'documents'
      and column_name = 'id' and data_type = 'uuid'
  ) then
    alter table public.documents alter column id drop default;
    alter table public.documents alter column id type text using id::text;
    alter table public.documents alter column id set default gen_random_uuid()::text;
  end if;
end $$;

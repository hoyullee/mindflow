-- Fix: `documents.owner` must default to auth.uid().
--
-- The web client's `SupabaseDocStore.save()` upsert inserts a row WITHOUT an
-- `owner` column. With no default, `owner` was null, so the
-- `documents_insert_own` RLS policy (`with check (auth.uid() = owner)`) rejected
-- every new-map insert with "42501: new row violates row-level security policy".
--
-- Defaulting `owner` to auth.uid() stamps the inserting user's id automatically
-- (the default is evaluated in the authenticated request context), satisfying
-- the policy — the standard Supabase owner-column pattern. RLS still blocks a
-- client that tries to set someone else's owner, so this is not a loosening.
--
-- Apply this in the Supabase SQL editor if you already ran an earlier
-- `0001_init.sql` that created `owner` without a default. Fresh projects get it
-- from the updated 0001; running this there is a harmless re-set of the default.

alter table public.documents alter column owner set default auth.uid();

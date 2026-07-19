-- MindFlow — self-service account deletion (회원 탈퇴).
--
-- Apply with the Supabase CLI (`supabase db push` / `supabase migration up`)
-- or `psql "$DATABASE_URL" -f supabase/migrations/0005_delete_account.sql`.
-- See server/supabase/docs/backend.md for the full provisioning checklist.
--
-- The anon/authenticated client key can't modify `auth.users` (only the
-- service_role can, and that key must NEVER ship to the browser). So account
-- deletion is exposed as a SECURITY DEFINER RPC the signed-in user can call:
-- it deletes THEIR OWN `auth.users` row (`id = auth.uid()`), which cascades to
-- every owned row — `public.profiles`, `public.documents`, `public.workspaces`
-- all reference `auth.users(id) on delete cascade` (0001_init.sql / 0004).
--
-- Because it runs as the definer (table owner), the function bypasses RLS to
-- reach `auth.users`; the `auth.uid()` guard scopes it strictly to the caller,
-- so a user can only ever delete their own account, never anyone else's.

create or replace function public.delete_account()
returns void
language plpgsql
security definer set search_path = public, auth
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  -- Cascades to profiles/documents/workspaces via their on-delete-cascade FKs.
  delete from auth.users where id = uid;
end;
$$;

-- Only a logged-in user may call it (and only for their own account, enforced
-- by the auth.uid() guard above). Never expose it to anon.
revoke all on function public.delete_account() from public, anon;
grant execute on function public.delete_account() to authenticated;

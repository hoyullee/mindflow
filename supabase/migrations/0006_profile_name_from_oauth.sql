-- 0006: profiles.display_name should default to the OAuth identity's real name.
--
-- The signup trigger (0001) seeded display_name from raw_user_meta_data's
-- `display_name` (never set by Google) and then the EMAIL LOCAL PART — so a
-- Google user's profile said "hoyul.lee" instead of their actual name, and the
-- client's remote-name reconcile then overwrote the session's Google name with
-- that email-derived value. Google (and most OAuth providers) put the person's
-- name in `full_name`/`name`, so fold those into the default chain.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'display_name',
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(new.email, '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Backfill: existing OAuth users whose display_name is still the email-derived
-- default get their provider name. A profile whose display_name differs from
-- the email local part was explicitly renamed by the user — leave it alone.
update public.profiles p
set display_name = coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name')
from auth.users u
where u.id = p.id
  and coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name') is not null
  and (p.display_name is null or p.display_name = split_part(u.email, '@', 1));


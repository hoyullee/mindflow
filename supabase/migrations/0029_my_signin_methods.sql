-- MindFlow — "내 계정의 로그인 수단" 조회 RPC (설정 → 로그인 수단).
--
-- Apply with the Supabase CLI (`supabase db push` / `supabase migration up`)
-- or `psql "$DATABASE_URL" -f supabase/migrations/0029_my_signin_methods.sql`.
-- See server/supabase/docs/backend.md for the full provisioning checklist.
--
-- 배경: 한 계정에 로그인 수단이 여럿 붙을 수 있다(같은 이메일의 Google 신원은
-- Supabase가 그 계정에 자동 연결한다). 설정 화면이 "비밀번호를 바꿀 수 있는가 /
-- 새로 설정해야 하는가", "Google이 연결돼 있는가"를 정확히 말하려면 두 가지가
-- 필요한데 클라이언트는 둘 다 읽을 수 없다:
--
--   * `auth.users.encrypted_password` — 비밀번호가 걸려 있는가.
--     ⚠️ 신원(identities)만으로는 알 수 없다. Google로 가입한 사용자가 나중에
--     비밀번호를 설정해도(`updateUser({ password })`) identities에는 'email'이
--     생기지 않는다 — 그래서 0013(`email_signin_providers`)으로 판단하면 비밀번호가
--     있는 계정을 "Google 전용"으로 잘못 보고 변경 항목을 잠근다.
--   * `auth.identities` — 어떤 소셜이 연결돼 있는가.
--
-- 0013과 달리 **이메일을 받지 않는다**: 언제나 `auth.uid()`의 것만 돌려주므로
-- 열거 위험이 없다(자기 계정 정보다). 비밀번호 해시는 물론 반환하지 않는다.

create or replace function public.my_signin_methods()
returns table (has_password boolean, providers text[])
language sql
security definer set search_path = public, auth
stable
as $$
  select
    (u.encrypted_password is not null and u.encrypted_password <> '') as has_password,
    coalesce(
      (select array_agg(distinct i.provider order by i.provider)
         from auth.identities i where i.user_id = u.id),
      array[]::text[]
    ) as providers
  from auth.users u
  where u.id = auth.uid();
$$;

revoke all on function public.my_signin_methods() from public;
grant execute on function public.my_signin_methods() to authenticated;

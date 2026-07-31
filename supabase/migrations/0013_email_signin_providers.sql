-- MindFlow — "이 이메일은 어떤 방법으로 가입돼 있나요?" 조회 RPC (회원가입 UX).
--
-- Apply with the Supabase CLI (`supabase db push` / `supabase migration up`)
-- or `psql "$DATABASE_URL" -f supabase/migrations/0013_email_signin_providers.sql`.
-- See server/supabase/docs/backend.md for the full provisioning checklist.
--
-- 배경(제보): Google로 가입한 이메일로 **이메일 회원가입**을 시도하면 가입이
-- 진행되는 것처럼 보이고 인증번호 입력 화면까지 넘어가는데, 코드는 영영 오지
-- 않는다. Supabase `auth.signUp`이 이메일 열거(enumeration) 방지를 위해 이미
-- 가입된 주소에도 성공을 돌려주기 때문이다(가짜 user 객체 — `identities`가 빈
-- 배열인 것이 유일한 단서이고, 메일은 발송되지 않는다).
--
-- 그래서 가입 시도 **전에** 그 이메일의 로그인 수단을 확인해, 이미 가입된
-- 계정이면 어떻게 가입했는지(Google / 이메일)까지 알려 주고 막는다.
--
-- 트레이드오프: 0008(`email_is_registered`)과 같은 결정 — 이메일 열거를
-- 의도적으로 허용한다. 이미 그 RPC가 가입 여부를 노출하고 있으므로 새로운
-- 종류의 노출은 아니며, 반환값은 **공급자 이름 목록뿐**이다(이름·프로필·가입
-- 시각 등 다른 정보는 일절 반환하지 않는다).

create or replace function public.email_signin_providers(p_email text)
returns text[]
language sql
security definer set search_path = public, auth
stable
as $$
  select coalesce(array_agg(distinct i.provider order by i.provider), array[]::text[])
  from auth.users u
  join auth.identities i on i.user_id = u.id
  where lower(u.email) = lower(trim(p_email));
$$;

-- 회원가입은 로그인 전(anon) 흐름이므로 anon도 호출할 수 있어야 한다.
revoke all on function public.email_signin_providers(text) from public;
grant execute on function public.email_signin_providers(text) to anon, authenticated;

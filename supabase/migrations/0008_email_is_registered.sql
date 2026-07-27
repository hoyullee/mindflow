-- MindFlow — "이 이메일이 가입돼 있나요?" 조회 RPC (비밀번호 찾기 UX).
--
-- Apply with the Supabase CLI (`supabase db push` / `supabase migration up`)
-- or `psql "$DATABASE_URL" -f supabase/migrations/0008_email_is_registered.sql`.
-- See server/supabase/docs/backend.md for the full provisioning checklist.
--
-- 배경: `auth.resetPasswordForEmail`은 이메일 열거(enumeration) 공격을 막으려고
-- 가입 여부와 무관하게 항상 성공을 돌려준다. 그래서 가입되지 않은 이메일에도
-- UI가 "인증 코드를 보냈어요"라고 표시하지만 실제 메일은 오지 않아, 사용자가
-- 왜 코드가 안 오는지 알 수 없었다(제보). 이를 해결하려고 비밀번호 찾기 화면에서
-- 전송 전에 "가입된 이메일인지"를 먼저 확인해 안내 툴팁을 띄운다.
--
-- 이 함수는 그 확인을 위해 존재한다. anon/authenticated 클라이언트 키로는
-- `auth.users`를 직접 조회할 수 없으므로(service_role 전용, 브라우저에 절대
-- 노출 금지), 존재 여부만 불리언으로 돌려주는 SECURITY DEFINER RPC로 노출한다.
--
-- 트레이드오프: 이 RPC는 의도적으로 이메일 열거를 허용한다(가입 여부가 노출됨).
-- 이는 "가입되지 않은 이메일임을 알려달라"는 제품 요구를 만족하기 위한 결정으로,
-- 이메일 주소 외 어떤 정보(이름·프로필·존재 시각 등)도 반환하지 않는다.

create or replace function public.email_is_registered(p_email text)
returns boolean
language sql
security definer set search_path = public, auth
stable
as $$
  select exists (
    select 1 from auth.users
    where lower(email) = lower(trim(p_email))
  );
$$;

-- 비밀번호 찾기는 로그인 전(anon) 흐름이므로 anon도 호출할 수 있어야 한다.
revoke all on function public.email_is_registered(text) from public;
grant execute on function public.email_is_registered(text) to anon, authenticated;

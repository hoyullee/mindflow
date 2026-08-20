-- MindFlow — 비밀번호를 설정한 계정에 **이메일 신원(identity)을 등록**한다.
--
-- Apply with the Supabase CLI (`supabase db push` / `supabase migration up`)
-- or `psql "$DATABASE_URL" -f supabase/migrations/0030_register_email_identity.sql`.
-- See server/supabase/docs/backend.md §16 for the full story.
--
-- 배경(라이브 제보): Google로 가입한 계정이 설정에서 비밀번호를 설정한 뒤에도
-- Google 연결을 해제할 수 없었다. Supabase는 해제 시 **신원을 최소 하나** 요구하는데
-- (`single_identity_not_deletable`), `updateUser({ password })`는 `auth.identities`에
-- 'email' 신원을 만들지 않는다 — 비밀번호는 신원으로 세지 않는다. 그래서 신원은
-- 계속 `['google']` 하나뿐이었다.
--
-- 그 계정에 실제로 없는 것은 "이메일로 로그인할 수 있다"는 **신원 행**이므로, 그것을
-- 만들어 준다. GoTrue가 이메일 가입 때 만드는 것과 **같은 모양**의 행이다
-- (provider='email', provider_id=사용자 id, identity_data에 sub/email).
--
-- 왜 Edge Function이 아니라 RPC인가: Admin API에는 "신원 추가"가 없어서 어느 쪽이든
-- 결국 service_role 권한으로 auth 스키마에 써야 한다. SECURITY DEFINER 함수면 키를
-- 어디에도 두지 않고(클라이언트 번들·함수 시크릿 모두) 조건을 SQL에 못박을 수 있다.
--
-- 안전장치(모두 필수):
--   * 언제나 `auth.uid()`의 것만 만든다(대상을 인자로 받지 않는다).
--   * 이메일이 **확인된** 계정만(email_confirmed_at) — 주인이 아닌 주소로 신원을
--     만들면 그 주소로 계정에 들어올 길이 생긴다.
--   * **비밀번호가 있을 때만** — 비밀번호 없는 이메일 신원은 로그인에 쓸 수 없어
--     (이 앱에 메일 코드 로그인이 없다) Google을 해제하면 계정이 잠긴다.
--   * 이미 'email' 신원이 있으면 아무것도 하지 않는다.
--   * 실패는 예외로 터뜨리지 않고 false + WARNING (스키마가 바뀌어도 앱이 안 죽는다).

create or replace function public.register_email_identity()
returns boolean
language plpgsql
security definer set search_path = public, auth
as $$
declare
  v_id uuid;
  v_email text;
  v_confirmed timestamptz;
  v_pw text;
begin
  select u.id, u.email, u.email_confirmed_at, u.encrypted_password
    into v_id, v_email, v_confirmed, v_pw
    from auth.users u
   where u.id = auth.uid();

  if v_id is null then return false; end if;                          -- 로그인 안 됨
  if v_email is null or v_confirmed is null then return false; end if; -- 확인된 이메일 아님
  if v_pw is null or v_pw = '' then return false; end if;              -- 비밀번호 없음
  if exists (select 1 from auth.identities i where i.user_id = v_id and i.provider = 'email') then
    return false;                                                      -- 이미 있다
  end if;

  -- `email` 칼럼은 최신 스키마에서 identity_data로부터 생성되는 열이라 직접 쓰지 않는다.
  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (
    v_id::text,
    v_id,
    jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
    'email',
    now(), now(), now()
  );
  return true;
exception
  when others then
    -- 신원 등록 실패가 비밀번호 설정·화면을 망가뜨리면 안 된다(0024와 같은 처방).
    raise warning 'register_email_identity 실패(%): %', sqlstate, sqlerrm;
    return false;
end;
$$;

revoke all on function public.register_email_identity() from public;
grant execute on function public.register_email_identity() to authenticated;

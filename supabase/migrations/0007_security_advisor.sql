-- 0007: Supabase Security Advisor 경고 정리.
--
-- Apply with the Supabase CLI (`supabase db push` / `supabase migration up`)
-- or `psql "$DATABASE_URL" -f supabase/migrations/0007_security_advisor.sql`.
-- (이 저장소는 Supabase GitHub 연동으로 main 병합 시 자동 적용된다.)
--
-- Security Advisor가 지적한 5건 중 SQL로 고칠 수 있는 것을 정리한다:
--
--   (해소) Function Search Path Mutable — public.set_updated_at
--          트리거 함수에 명시적 search_path가 없어 "가변 경로"로 표시됐다.
--   (해소) Public / Signed-In Users Can Execute SECURITY DEFINER — public.handle_new_user
--          트리거 전용 함수인데 EXECUTE가 public/anon/authenticated에 열려 있어
--          직접 호출이 가능했다. 트리거는 EXECUTE 권한과 무관하게 발화하므로
--          회수해도 회원가입 자동 프로필 생성은 그대로 동작한다.
--
-- 남는 2건은 SQL로 없앨 수 없다(설계상 의도 / 대시보드 설정):
--   · Signed-In Users Can Execute SECURITY DEFINER — public.delete_account
--     회원 탈퇴 기능의 핵심이다. auth.users를 지우려면 DEFINER 권한이 필요하고,
--     로그인 사용자가 호출해야 하며, 내부 auth.uid() 가드로 "본인 계정만" 삭제된다.
--     따라서 authenticated EXECUTE는 의도된 것이고 그대로 둔다(0005 참조).
--   · Leaked Password Protection Disabled — Auth 설정 토글이라 SQL 대상이 아니다.
--     대시보드 Authentication → Sign In / Providers → "Leaked password protection"
--     (HaveIBeenPwned 대조)을 켜면 해소된다.

-- (1) set_updated_at에 명시적 search_path 부여. 이 함수는 now()(pg_catalog,
--     항상 경로에 포함)만 참조하므로 빈 search_path로 충분하고 가장 안전하다.
alter function public.set_updated_at() set search_path = '';

-- (2) 트리거 전용 함수의 직접 실행 권한 회수. 트리거(on_auth_user_created,
--     documents_set_updated_at)는 이 GRANT와 무관하게 계속 발화한다.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;

// Real auth adapter — `AuthProvider` implemented against Supabase Auth
// (email/password, Google OAuth, email OTP, password reset). Only constructed
// by `adapters/factory.ts` when `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`
// are configured; never touched by tests that don't explicitly import it (no
// live network calls happen just by the module being loaded).

import type { Session, SupabaseClient, User } from '@supabase/supabase-js';
import type { AuthChangeListener, AuthProvider, AuthResult, AuthSession, SigninMethods, SignOutScope } from '../ports';

function mapUser(user: User | null | undefined): AuthSession['user'] | null {
  if (!user) return null;
  // OAuth identity metadata: Google fills user_metadata with full_name/name
  // and avatar_url/picture — surface them so the profile UI can show the
  // person's real name and photo instead of the email-derived fallback.
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
  // `app_metadata`(서버가 채우는 값)의 provider/providers — 이번 로그인 수단과
  // 계정에 연결된 수단 전부(설정 → 로그인 수단이 읽는다).
  const app = (user.app_metadata ?? {}) as Record<string, unknown>;
  const providers = Array.isArray(app.providers) ? app.providers.filter((p): p is string => typeof p === 'string') : [];
  return {
    id: user.id,
    email: user.email ?? null,
    name: str(meta.full_name) ?? str(meta.name),
    avatarUrl: str(meta.avatar_url) ?? str(meta.picture),
    signInProvider: str(app.provider),
    linkedProviders: providers,
  };
}

function mapSession(session: Session | null | undefined): AuthSession | null {
  const user = mapUser(session?.user);
  return user ? { user } : null;
}

export class SupabaseAuth implements AuthProvider {
  constructor(private readonly client: SupabaseClient) {}

  async getSession(): Promise<AuthSession | null> {
    const { data } = await this.client.auth.getSession();
    return mapSession(data.session);
  }

  async signInWithPassword(email: string, password: string): Promise<AuthResult> {
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) return { session: null, error: error.message };
    return { session: mapSession(data.session) };
  }

  async signUp(email: string, password: string): Promise<AuthResult> {
    const { data, error } = await this.client.auth.signUp({ email, password });
    if (error) return { session: null, error: error.message };
    // 이미 가입된 이메일: Supabase는 이메일 열거 방지로 **성공처럼** 응답하지만
    // 메일은 보내지 않는다. 유일한 단서가 `identities`가 빈 배열인 가짜 user다
    // (제보: Google로 가입한 주소로 이메일 가입 → 인증 코드 화면까지 갔는데
    // 코드가 영영 안 옴). 여기서 걸러 내면 RPC(`emailSignInProviders`)가 아직
    // 배포되지 않은 프로젝트에서도 막다른 화면으로 보내지 않는다.
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      return { session: null, error: 'User already registered' };
    }
    const session = mapSession(data.session);
    // Supabase's default flow requires email confirmation: `data.session` is
    // null (and `data.user` non-null) until the user clicks the emailed link.
    return { session, needsVerification: !session };
  }

  async resendSignup(email: string): Promise<{ error?: string }> {
    // Re-sends the "Confirm signup" email. For the app's 6-digit OTP verify
    // step to work, that template must include `{{ .Token }}` (see
    // server/supabase/docs/backend.md §1e) — otherwise the mail only carries a
    // magic link and the code field has nothing to match.
    const { error } = await this.client.auth.resend({ type: 'signup', email });
    return error ? { error: error.message } : {};
  }

  async signInWithOAuth(provider: 'google'): Promise<{ error?: string }> {
    const redirectTo = typeof window !== 'undefined' ? `${window.location.origin}/home` : undefined;
    const { error } = await this.client.auth.signInWithOAuth({
      provider,
      // `prompt=select_account`: without it Google silently reuses the single
      // signed-in browser account once consent was granted ONCE — clicking the
      // button then logs straight in with no way to pick a different account.
      // With it Google always shows the account chooser.
      options: { redirectTo, queryParams: { prompt: 'select_account' } },
    });
    // On success the browser is redirected to Google — this only returns
    // (with an error) when the redirect itself couldn't be initiated.
    return error ? { error: error.message } : {};
  }

  // GIS (Google Identity Services) path: the browser already holds a Google
  // ID token (JWT) from the official Sign-in-with-Google button, so this is a
  // direct token exchange — no redirect through the supabase.co callback (the
  // whole reason this path exists; see `signInWithOAuth` vs the login form's
  // `GoogleSignInButton`). Supabase validates the token's audience against the
  // Google client ID configured on the provider, and — when `nonce` is given —
  // checks that its SHA-256 matches the token's `nonce` claim.
  async signInWithIdToken(provider: 'google', token: string, nonce?: string): Promise<AuthResult> {
    const { data, error } = await this.client.auth.signInWithIdToken({ provider, token, ...(nonce ? { nonce } : {}) });
    if (error) return { session: null, error: error.message };
    return { session: mapSession(data.session) };
  }

  // 범위는 세션 정책의 유일한 손잡이(backend.md §15): 기본은 이 기기만,
  // 'global'은 모든 기기(분실·공용 PC 회수), 'others'는 지금 세션만 남긴다.
  async signOut(scope: SignOutScope = 'local'): Promise<void> {
    await this.client.auth.signOut(scope === 'local' ? undefined : { scope });
  }

  onAuthChange(listener: AuthChangeListener): () => void {
    const { data } = this.client.auth.onAuthStateChange((_event, session) => {
      listener(mapSession(session));
    });
    return () => data.subscription.unsubscribe();
  }

  async sendPasswordReset(email: string): Promise<{ error?: string }> {
    const redirectTo = typeof window !== 'undefined' ? `${window.location.origin}/login` : undefined;
    const { error } = await this.client.auth.resetPasswordForEmail(email, { redirectTo });
    return error ? { error: error.message } : {};
  }

  // Existence check for the "가입되지 않은 이메일" reset-form warning. The
  // anon/authenticated key can't read `auth.users`, so this goes through the
  // `email_is_registered` SECURITY DEFINER RPC (0008). On ANY failure (RPC not
  // yet migrated, network) return null = "unknown" so the caller falls back to
  // sending — never block a legitimate reset on a failed lookup.
  async isEmailRegistered(email: string): Promise<boolean | null> {
    const { data, error } = await this.client.rpc('email_is_registered', { p_email: email });
    if (error) return null;
    return typeof data === 'boolean' ? data : null;
  }

  async emailSignInProviders(email: string): Promise<string[] | null> {
    const { data, error } = await this.client.rpc('email_signin_providers', { p_email: email });
    if (error) return null; // RPC 미배포/네트워크 — 호출부는 기존 흐름으로 진행
    return Array.isArray(data) ? data.filter((x): x is string => typeof x === 'string') : null;
  }

  async verifyOtp(email: string, token: string, type: 'signup' | 'recovery'): Promise<AuthResult> {
    const { data, error } = await this.client.auth.verifyOtp({ email, token, type });
    if (error) return { session: null, error: error.message };
    return { session: mapSession(data.session) };
  }

  // 비밀번호를 바꾸면 **다른 기기의 세션을 해지한다**(계정을 되찾는 흐름의 마지막
  // 조각 — 옛 비밀번호로 들어와 있던 세션이 그대로 남으면 바꾼 의미가 없다).
  // 지금 세션은 'others'라 살아남으므로 사용자는 계속 쓴다. 해지가 실패해도
  // 비밀번호 변경은 이미 성공했으므로 오류로 만들지 않는다(조용히 넘어간다).
  async updatePassword(newPassword: string): Promise<{ error?: string }> {
    const { error } = await this.client.auth.updateUser({ password: newPassword });
    if (error) return { error: error.message };
    try {
      await this.client.auth.signOut({ scope: 'others' });
    } catch {
      /* 다른 세션 해지 실패 — 비밀번호는 이미 바뀌었다 */
    }
    return {};
  }

  // 설정 → 비밀번호 변경: **현재 비밀번호로 본인을 확인한 뒤** 바꾼다.
  //
  // 확인은 같은 계정으로 `signInWithPassword`를 한 번 더 하는 방식이다(성공하면
  // 같은 사용자의 새 세션이 되므로 사용자에게는 아무 일도 일어나지 않고, 실패하면
  // 지금 세션은 그대로 남는다). Supabase에 "비밀번호만 검증" API가 없어서다.
  // 성공 뒤는 `updatePassword`에 위임 — 다른 기기 세션 해지 규칙(§15)이 한 곳에 있다.
  async changePassword(currentPassword: string, newPassword: string): Promise<{ error?: string; wrongCurrent?: boolean }> {
    const { data } = await this.client.auth.getUser();
    const email = data?.user?.email;
    if (!email) return { error: 'Auth session missing' };
    const { error: signInError } = await this.client.auth.signInWithPassword({ email, password: currentPassword });
    if (signInError) return { wrongCurrent: true, error: signInError.message };
    return this.updatePassword(newPassword);
  }

  // The anon/authenticated client can't touch `auth.users`, so account deletion
  // goes through the `delete_account()` SECURITY DEFINER RPC (supabase/migrations/
  // 0005_delete_account.sql): it deletes the caller's `auth.users` row, which
  // cascades to documents/workspaces/profiles via their `on delete cascade` FKs.
  // Then sign out to drop the now-orphaned local session/token.
  async deleteAccount(): Promise<{ error?: string }> {
    const { error } = await this.client.rpc('delete_account');
    if (error) return { error: error.message };
    await this.client.auth.signOut();
    return {};
  }

  // Display name lives in `profiles.display_name` (auto-created per user by the
  // handle_new_user trigger, RLS-scoped to the owner — supabase/migrations/0001).
  async getProfileName(): Promise<string | null> {
    const { data: u } = await this.client.auth.getUser();
    const uid = u?.user?.id;
    if (!uid) return null;
    const { data, error } = await this.client.from('profiles').select('display_name').eq('id', uid).maybeSingle();
    if (error) return null;
    const v = (data as { display_name?: unknown } | null)?.display_name;
    return typeof v === 'string' && v.trim() ? v : null;
  }

  async setProfileName(name: string): Promise<{ error?: string }> {
    const { data: u } = await this.client.auth.getUser();
    const uid = u?.user?.id;
    if (!uid) return { error: 'not authenticated' };
    // upsert so it works even if the profile row is somehow missing
    const { error } = await this.client.from('profiles').upsert({ id: uid, display_name: name });
    return error ? { error: error.message } : {};
  }
  // ── 로그인 수단(설정 → 로그인 수단) ─────────────────────────────────────
  // 한 계정에 수단이 여럿 붙을 수 있다(같은 이메일의 Google 신원은 Supabase가
  // 자동 연결한다). 화면이 "비밀번호를 바꿀 수 있나 / 새로 걸어야 하나",
  // "Google이 연결돼 있나"를 정확히 말하려면 서버만 아는 두 값이 필요하다 — 0029.
  async signinMethods(): Promise<SigninMethods | null> {
    const { data, error } = await this.client.rpc('my_signin_methods');
    if (error) {
      console.warn('[geurio] my_signin_methods RPC 실패', error.message);
      return null; // 확인 불가 — 호출부는 잠그지 않고 "확인할 수 없어요"로 말한다
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    const r = row as { has_password?: boolean; providers?: unknown };
    return {
      hasPassword: !!r.has_password,
      providers: Array.isArray(r.providers) ? r.providers.map(String) : [],
    };
  }

  // ── 비밀번호 설정(소셜 전용 계정)의 본인 확인 ────────────────────────────
  // **복구(recovery) 코드**로 확인한다. 처음에는 `reauthenticate()`의 nonce를 썼는데
  // 라이브에서 **아무 번호를 넣어도 통과했다**(제보): GoTrue는 nonce를 "필요할 때"만
  // 강제한다 — Secure password change가 켜져 있고 세션이 최근(24시간) 것이 아닐 때다.
  // 방금 로그인한 사용자는 둘 다 아니어서 nonce를 **검사하지 않고** 비밀번호를
  // 바꿔 줬다(우리 확인 단계가 통째로 무력했다).
  //
  // 복구 코드는 `verifyOtp`가 **실제로 검증**하므로 틀린 번호는 반드시 실패하고,
  // 이 프로젝트에서 이미 쓰이는 경로다(로그인 화면의 '비밀번호 찾기' — 그래서
  // 템플릿에 코드가 들어 있는 것도 검증됐다). 대시보드 토글에 의존하지 않는다.
  async sendPasswordSetupCode(): Promise<{ error?: string }> {
    const { data } = await this.client.auth.getUser();
    const email = data?.user?.email;
    if (!email) return { error: 'Auth session missing' };
    return this.sendPasswordReset(email);
  }

  async setPasswordWithCode(code: string, newPassword: string): Promise<{ error?: string; wrongCode?: boolean }> {
    const { data } = await this.client.auth.getUser();
    const email = data?.user?.email;
    if (!email) return { error: 'Auth session missing' };
    // 검증 실패는 곧 "번호가 틀렸다" — 여기서 막히면 비밀번호는 건드리지 않는다.
    const verified = await this.verifyOtp(email, code.trim(), 'recovery');
    if (verified.error) return { wrongCode: true, error: verified.error };
    // 확인됐으면 설정하고 다른 기기 세션을 해지한다(§15의 규칙).
    return this.updatePassword(newPassword);
  }

  // 비밀번호를 설정한 계정에 이메일 신원을 등록한다(0030) — 이게 있어야 Google을
  // 뗄 수 있다(Supabase는 신원 최소 1개를 요구하고 비밀번호는 신원이 아니다).
  async registerEmailIdentity(): Promise<boolean> {
    const { data, error } = await this.client.rpc('register_email_identity');
    if (error) {
      console.warn('[geurio] register_email_identity RPC 실패', error.message);
      return false; // RPC 미배포·실패 — 화면은 예전처럼 해제를 잠근 채 이유를 말한다
    }
    return data === true;
  }

  // 연결은 리다이렉트다(로그인의 signInWithOAuth와 같은 왕복) — 돌아오면 세션의
  // providers가 갱신돼 설정 화면이 '연결됨'으로 바뀐다. 대시보드에서 Manual
  // Linking을 켜 두어야 동작한다(꺼져 있으면 그 사실을 오류로 알려 준다).
  async linkGoogle(): Promise<{ error?: string }> {
    const redirectTo = typeof window !== 'undefined' ? `${window.location.origin}/home?linked=google` : undefined;
    const { error } = await this.client.auth.linkIdentity({
      provider: 'google',
      options: { redirectTo, queryParams: { prompt: 'select_account' } },
    });
    // 원문을 남긴다 — 화면 문구는 한글로 옮겨지므로(localizeAuthError) 콘솔이
    // 유일한 진단 단서다(대개 대시보드에서 Manual linking이 꺼져 있는 경우).
    if (error) console.warn('[geurio] Google 연결 실패', error.message);
    return error ? { error: error.message } : {};
  }

  async unlinkGoogle(): Promise<{ error?: string }> {
    const { data, error } = await this.client.auth.getUserIdentities();
    if (error) return { error: error.message };
    const google = (data?.identities ?? []).find((i) => i.provider === 'google');
    if (!google) return {}; // 이미 연결돼 있지 않다 — 결과가 같으므로 성공으로 본다
    const res = await this.client.auth.unlinkIdentity(google);
    if (res.error) console.warn('[geurio] Google 연결 해제 실패', res.error.message);
    return res.error ? { error: res.error.message } : {};
  }

}

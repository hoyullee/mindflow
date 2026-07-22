// Real auth adapter — `AuthProvider` implemented against Supabase Auth
// (email/password, Google OAuth, email OTP, password reset). Only constructed
// by `adapters/factory.ts` when `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`
// are configured; never touched by tests that don't explicitly import it (no
// live network calls happen just by the module being loaded).

import type { Session, SupabaseClient, User } from '@supabase/supabase-js';
import type { AuthChangeListener, AuthProvider, AuthResult, AuthSession } from '../ports';

function mapUser(user: User | null | undefined): AuthSession['user'] | null {
  if (!user) return null;
  // OAuth identity metadata: Google fills user_metadata with full_name/name
  // and avatar_url/picture — surface them so the profile UI can show the
  // person's real name and photo instead of the email-derived fallback.
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
  return {
    id: user.id,
    email: user.email ?? null,
    name: str(meta.full_name) ?? str(meta.name),
    avatarUrl: str(meta.avatar_url) ?? str(meta.picture),
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
    const session = mapSession(data.session);
    // Supabase's default flow requires email confirmation: `data.session` is
    // null (and `data.user` non-null) until the user clicks the emailed link.
    return { session, needsVerification: !session };
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

  async signOut(): Promise<void> {
    await this.client.auth.signOut();
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

  async verifyOtp(email: string, token: string, type: 'signup' | 'recovery'): Promise<AuthResult> {
    const { data, error } = await this.client.auth.verifyOtp({ email, token, type });
    if (error) return { session: null, error: error.message };
    return { session: mapSession(data.session) };
  }

  async updatePassword(newPassword: string): Promise<{ error?: string }> {
    const { error } = await this.client.auth.updateUser({ password: newPassword });
    return error ? { error: error.message } : {};
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
}

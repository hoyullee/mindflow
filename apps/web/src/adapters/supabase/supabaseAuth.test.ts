import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseAuth } from './supabaseAuth';

// Fake client exposing only what getSession() touches — no network, no real SDK.
function clientWithUser(user: Record<string, unknown> | null): SupabaseClient {
  return {
    auth: {
      getSession: async () => ({ data: { session: user ? { user } : null } }),
    },
  } as unknown as SupabaseClient;
}

describe('SupabaseAuth session mapping (OAuth identity metadata)', () => {
  it('surfaces the Google full_name and avatar_url on the session user', async () => {
    const auth = new SupabaseAuth(
      clientWithUser({
        id: 'u1',
        email: 'hoyul@gmail.com',
        user_metadata: { full_name: '이호율', avatar_url: 'https://lh3.googleusercontent.com/a/photo=s96-c' },
      }),
    );
    const session = await auth.getSession();
    expect(session?.user.name).toBe('이호율');
    expect(session?.user.avatarUrl).toBe('https://lh3.googleusercontent.com/a/photo=s96-c');
  });

  it('falls back to metadata name/picture when full_name/avatar_url are absent', async () => {
    const auth = new SupabaseAuth(clientWithUser({ id: 'u1', email: 'a@b.c', user_metadata: { name: 'Hoyul Lee', picture: 'https://p/x.jpg' } }));
    const session = await auth.getSession();
    expect(session?.user.name).toBe('Hoyul Lee');
    expect(session?.user.avatarUrl).toBe('https://p/x.jpg');
  });

  it('leaves name/avatar null-ish for email/password accounts (no metadata)', async () => {
    const auth = new SupabaseAuth(clientWithUser({ id: 'u1', email: 'a@b.c', user_metadata: {} }));
    const session = await auth.getSession();
    expect(session?.user.name ?? null).toBeNull();
    expect(session?.user.avatarUrl ?? null).toBeNull();
  });
});

describe('SupabaseAuth signInWithOAuth', () => {
  it('always requests the Google account chooser (prompt=select_account)', async () => {
    // Without this param Google silently reuses the signed-in browser account
    // after the first consent — the button then can't switch accounts at all.
    let captured: Record<string, unknown> | null = null;
    const client = {
      auth: {
        signInWithOAuth: async (args: Record<string, unknown>) => {
          captured = args;
          return { error: null };
        },
      },
    } as unknown as SupabaseClient;
    const auth = new SupabaseAuth(client);
    const res = await auth.signInWithOAuth('google');
    expect(res.error).toBeUndefined();
    expect(captured!.provider).toBe('google');
    const options = captured!.options as { queryParams?: Record<string, string> };
    expect(options.queryParams).toEqual({ prompt: 'select_account' });
  });
});


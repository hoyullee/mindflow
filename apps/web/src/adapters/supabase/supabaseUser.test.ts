import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { currentUser } from './supabaseUser';

describe('currentUser', () => {
  it('세션이 있으면 `/auth/v1/user` 왕복 없이 세션에서 읽는다(제보: 새로고침 한 번에 user 6건)', async () => {
    const getUser = vi.fn(async () => ({ data: { user: { id: 'net' } } }));
    const client = {
      auth: {
        getSession: vi.fn(async () => ({ data: { session: { user: { id: 'u1', email: 'me@example.com' } } } })),
        getUser,
      },
    } as unknown as SupabaseClient;
    const me = await currentUser(client);
    expect(me?.id).toBe('u1');
    expect(getUser).not.toHaveBeenCalled();
  });

  it('세션이 없으면 서버에 물어본다 — 로그인 없이 부르는 경로가 조용히 죽지 않게', async () => {
    const client = {
      auth: {
        getSession: vi.fn(async () => ({ data: { session: null } })),
        getUser: vi.fn(async () => ({ data: { user: { id: 'u9' } } })),
      },
    } as unknown as SupabaseClient;
    expect((await currentUser(client))?.id).toBe('u9');
  });

  it('`getSession`이 없는 클라이언트에서도 동작한다(구 스텁·구 버전)', async () => {
    const client = { auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'u8' } } })) } } as unknown as SupabaseClient;
    expect((await currentUser(client))?.id).toBe('u8');
  });
});

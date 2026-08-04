import { describe, expect, it, vi } from 'vitest';
import { SupabaseFeedbackStore } from './supabaseFeedbackStore';
import type { SupabaseClient } from '@supabase/supabase-js';

// `feedback` 테이블(0014) insert 어댑터 — 로그인 사용자의 uid/이메일 스냅샷을
// 실어 넣는다(RLS가 `user_id = auth.uid()`를 강제하므로 반드시 본인 uid).

function clientWith({ user, insertError }: { user: { id: string; email?: string } | null; insertError?: { message: string } }) {
  const insert = vi.fn(async () => ({ error: insertError ?? null }));
  const client = {
    auth: { getUser: vi.fn(async () => ({ data: { user } })) },
    from: vi.fn(() => ({ insert })),
  } as unknown as SupabaseClient;
  return { client, insert };
}

describe('SupabaseFeedbackStore', () => {
  it('로그인 사용자의 uid·이메일 스냅샷과 함께 insert한다', async () => {
    const { client, insert } = clientWith({ user: { id: 'u1', email: 'me@example.com' } });
    const store = new SupabaseFeedbackStore(client);
    const res = await store.submit({ category: 'bug', message: ' 오류예요 ', page: 'editor', meta: { build: 'b1' } });
    expect(res).toEqual({});
    expect(insert).toHaveBeenCalledWith({
      user_id: 'u1',
      email: 'me@example.com',
      category: 'bug',
      message: '오류예요',
      page: 'editor',
      meta: { build: 'b1' },
    });
  });

  it('비로그인·빈 내용은 서버를 부르지 않는다', async () => {
    const { client: noUser, insert } = clientWith({ user: null });
    expect((await new SupabaseFeedbackStore(noUser).submit({ category: 'ux', message: '내용', page: 'home' })).error).toBeTruthy();
    expect(insert).not.toHaveBeenCalled();
    const { client, insert: insert2 } = clientWith({ user: { id: 'u1' } });
    expect((await new SupabaseFeedbackStore(client).submit({ category: 'ux', message: '  ', page: 'home' })).error).toBeTruthy();
    expect(insert2).not.toHaveBeenCalled();
  });

  it('insert 실패(테이블 미적용 등)는 사용자 문구로 바꾼다', async () => {
    const { client } = clientWith({ user: { id: 'u1' }, insertError: { message: 'relation "feedback" does not exist' } });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await new SupabaseFeedbackStore(client).submit({ category: 'other', message: '내용', page: 'home' });
    expect(res.error).toContain('전송에 실패');
    warn.mockRestore();
  });
});

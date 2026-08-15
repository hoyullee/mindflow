import { describe, expect, it, vi } from 'vitest';
import { SupabaseCommentStore } from './supabaseCommentStore';
import type { SupabaseClient } from '@supabase/supabase-js';

// `document_comments`(0020) + 답글·멘션·해결(0021) 어댑터.
// 실시간은 내용 없는 ping — 구독 채널로 보내고, 받는 쪽이 list()로 다시 읽는다.

interface Handlers {
  broadcast?: (payload: unknown) => void;
}

function clientWith({ user = { id: 'u1', email: 'me@example.com' }, rows = [] as unknown[], selectError = null as { message: string } | null }) {
  const insert = vi.fn(async () => ({ error: null }));
  const rpc = vi.fn(async () => ({ error: null }));
  const send = vi.fn(async () => 'ok');
  const handlers: Handlers = {};
  const channel = {
    on: vi.fn((_t: string, _f: unknown, cb: (p: unknown) => void) => {
      handlers.broadcast = cb;
      return channel;
    }),
    subscribe: vi.fn(() => channel),
    send,
  };
  const removeChannel = vi.fn();
  const order = vi.fn(async () => ({ data: rows, error: selectError }));
  const client = {
    auth: { getUser: vi.fn(async () => ({ data: { user: { ...user, user_metadata: { name: '홍길동' } } } })) },
    from: vi.fn(() => ({
      insert,
      delete: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })) })),
      select: vi.fn(() => ({ eq: vi.fn(() => ({ order })) })),
    })),
    rpc,
    channel: vi.fn(() => channel),
    removeChannel,
  } as unknown as SupabaseClient;
  return { client, insert, rpc, send, channel, removeChannel, handlers, order };
}

describe('SupabaseCommentStore — 답글·멘션·해결', () => {
  it('답글과 멘션이 insert 행에 실린다', async () => {
    const { client, insert } = clientWith({});
    const store = new SupabaseCommentStore(client);
    await store.add('d1', 'n1', '답글', { parentId: 'p1', mentions: [{ email: 'a@b.c', name: 'a' }] });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ parent_id: 'p1', mentions: [{ email: 'a@b.c', name: 'a' }], author_name: '홍길동' }));
  });

  it('해결 표시는 좁은 RPC로 — 해결자 이름 스냅샷을 싣는다', async () => {
    const { client, rpc } = clientWith({});
    const store = new SupabaseCommentStore(client);
    await store.setResolved('d1', 'c1', true);
    expect(rpc).toHaveBeenCalledWith('set_comment_resolved', { comment_id: 'c1', resolved: true, resolver_name: '홍길동' });
    await store.setResolved('d1', 'c1', false);
    expect(rpc).toHaveBeenCalledWith('set_comment_resolved', { comment_id: 'c1', resolved: false, resolver_name: '' });
  });

  it('구독 중이면 add/setResolved가 변경 ping을 보내고, 신호가 오면 콜백이 불린다', async () => {
    const { client, send, handlers } = clientWith({});
    const store = new SupabaseCommentStore(client);
    const onChange = vi.fn();
    const unsub = store.subscribe('d1', onChange);

    await store.add('d1', 'n1', '새 댓글');
    expect(send).toHaveBeenCalledWith({ type: 'broadcast', event: 'changed', payload: {} });
    handlers.broadcast?.({});
    expect(onChange).toHaveBeenCalledTimes(1);

    // 구독을 해지하면 ping을 보낼 채널도 없다(혼자 쓰는 문서 — 보낼 상대도 없다).
    unsub();
    send.mockClear();
    await store.add('d1', 'n1', '해지 후');
    expect(send).not.toHaveBeenCalled();
  });

  it('0021 미적용 서버: 확장 컬럼 select가 실패하면 기본 컬럼으로 다시 읽는다', async () => {
    // 첫 select(확장 컬럼)는 실패, 재시도(기본 컬럼)는 성공하는 클라이언트.
    const calls: string[] = [];
    const client = {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'u1' } } })) },
      from: vi.fn(() => ({
        select: vi.fn((cols: string) => {
          calls.push(cols);
          const fail = cols.includes('parent_id');
          return {
            eq: vi.fn(() => ({
              order: vi.fn(async () =>
                fail
                  ? { data: null, error: { message: 'column "parent_id" does not exist' } }
                  : { data: [{ id: 'c1', node_id: 'n1', author: 'u1', author_name: '나', body: '옛 댓글', created_at: '2026-01-01' }], error: null },
              ),
            })),
          };
        }),
      })),
    } as unknown as SupabaseClient;
    const list = await new SupabaseCommentStore(client).list('d1');
    // 댓글 표를 두 번 읽는다(확장 → 기본). 좋아요(0028) 읽기는 곁다리라 세지 않는다 —
    // 이 스텁에는 `.in`이 없어 그 시도가 던지지만, 목록은 그대로 떠야 한다.
    expect(calls.filter((c) => !c.includes('comment_id'))).toHaveLength(2);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'c1', parentId: null, resolved: false, mentions: [], mine: true });
  });
});

// `SupabaseDocStore.test.ts`와 같은 방식 — 실 Supabase가 없는 환경이므로 어댑터가
// **어떤 쿼리를 만드는지**를 단정한다(실제 접근 제어는 RLS가 하고, 그건 0009의 정책이다).

import { describe, expect, it, vi } from 'vitest';
import { SupabaseShareStore } from './supabaseShareStore';

class FakeQuery implements PromiseLike<{ data: unknown; error: unknown }> {
  calls: { method: string; args: unknown[] }[] = [];
  constructor(private result: { data: unknown; error: unknown }) {}
  private record(method: string, args: unknown[]): this {
    this.calls.push({ method, args });
    return this;
  }
  select(...args: unknown[]) {
    return this.record('select', args);
  }
  eq(...args: unknown[]) {
    return this.record('eq', args);
  }
  order(...args: unknown[]) {
    return this.record('order', args);
  }
  upsert(...args: unknown[]) {
    return this.record('upsert', args);
  }
  delete(...args: unknown[]) {
    return this.record('delete', args);
  }
  then<T1 = { data: unknown; error: unknown }, T2 = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown }) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

/** 호출마다 다른 결과를 돌려주는 쿼리 — 첫 select가 실패하는 상황을 만든다. */
class SeqQuery extends FakeQuery {
  constructor(private results: { data: unknown; error: unknown }[]) {
    super(results[0]!);
  }
  override then<T1 = { data: unknown; error: unknown }, T2 = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown }) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    const next = this.results.shift() ?? { data: null, error: null };
    return Promise.resolve(next).then(onfulfilled, onrejected);
  }
}

function fakeClient(result: { data: unknown; error: unknown }, email: string | null = 'me@example.com') {
  const query = new FakeQuery(result);
  const from = vi.fn(() => query);
  const auth = { getUser: vi.fn(async () => ({ data: { user: email ? { id: 'u1', email } : null }, error: null })) };
  return { client: { from, auth } as unknown as import('@supabase/supabase-js').SupabaseClient, query, from };
}

describe('SupabaseShareStore', () => {
  it('list()는 그 문서의 초대를 생성순으로 읽는다', async () => {
    const rows = [{ document_id: 'd1', invitee_email: 'a@example.com', role: 'edit', created_at: '2026-01-01T00:00:00Z' }];
    const { client, query, from } = fakeClient({ data: rows, error: null });

    const shares = await new SupabaseShareStore(client).list('d1');

    expect(from).toHaveBeenCalledWith('document_shares');
    expect(query.calls[0]).toEqual({ method: 'select', args: ['document_id,invitee_email,role,created_at'] });
    expect(query.calls[1]).toEqual({ method: 'eq', args: ['document_id', 'd1'] });
    expect(query.calls[2]).toEqual({ method: 'order', args: ['created_at', { ascending: true }] });
    expect(shares).toEqual([{ documentId: 'd1', email: 'a@example.com', role: 'edit', createdAt: '2026-01-01T00:00:00Z' }]);
  });

  it('알 수 없는 role은 edit으로 읽는다 (미래 값이 들어와도 깨지지 않게)', async () => {
    const rows = [{ document_id: 'd1', invitee_email: 'a@example.com', role: 'admin', created_at: 'x' }];
    const { client } = fakeClient({ data: rows, error: null });
    expect((await new SupabaseShareStore(client).list('d1'))[0]!.role).toBe('edit');
  });

  it('add()는 upsert로 초대한다 — 이미 있으면 권한만 갱신', async () => {
    const { client, query } = fakeClient({ data: null, error: null });

    const res = await new SupabaseShareStore(client).add('d1', '  Mixed@Example.COM  ', 'view');

    expect(res).toEqual({});
    expect(query.calls[0]?.method).toBe('upsert');
    const [payload, opts] = query.calls[0]!.args as [Record<string, unknown>, Record<string, unknown>];
    // 이메일은 소문자·트림해서 보낸다(서버 트리거도 같은 일을 하지만 클라이언트에서도 맞춘다)
    expect(payload).toEqual({ document_id: 'd1', invitee_email: 'mixed@example.com', role: 'view' });
    // `invited_by`는 보내지 않는다 — 컬럼 기본값 auth.uid()가 채워야 정책을 통과한다
    expect(payload).not.toHaveProperty('invited_by');
    expect(opts).toEqual({ onConflict: 'document_id,invitee_email' });
  });

  it('add()는 빈 이메일을 서버에 보내지 않는다', async () => {
    const { client, query } = fakeClient({ data: null, error: null });
    expect((await new SupabaseShareStore(client).add('d1', '  ')).error).toBeTruthy();
    expect(query.calls).toHaveLength(0);
  });

  it('add() 실패는 메시지를 그대로 돌려준다 (조용히 성공하지 않는다)', async () => {
    const { client } = fakeClient({ data: null, error: { message: 'new row violates row-level security policy' } });
    expect((await new SupabaseShareStore(client).add('d1', 'a@example.com')).error).toMatch(/row-level security/);
  });

  it('remove()는 문서+이메일로 지운다 (소문자 정규화)', async () => {
    const { client, query } = fakeClient({ data: null, error: null });

    await new SupabaseShareStore(client).remove('d1', 'A@Example.com');

    expect(query.calls[0]?.method).toBe('delete');
    expect(query.calls[1]).toEqual({ method: 'eq', args: ['document_id', 'd1'] });
    expect(query.calls[2]).toEqual({ method: 'eq', args: ['invitee_email', 'a@example.com'] });
  });

  it('listSharedWithMe()는 내 이메일로 온 초대만 읽는다 (seen_at 포함)', async () => {
    const rows = [{ document_id: 'd9', role: 'edit', seen_at: null }];
    const { client, query } = fakeClient({ data: rows, error: null }, 'Me@Example.com');

    const mine = await new SupabaseShareStore(client).listSharedWithMe();

    expect(query.calls[0]).toEqual({ method: 'select', args: ['document_id,role,seen_at'] });
    expect(query.calls[1]).toEqual({ method: 'eq', args: ['invitee_email', 'me@example.com'] });
    // `seenAt: null` = 아직 확인하지 않은 초대(홈 배지가 센다).
    expect(mine).toEqual([{ documentId: 'd9', role: 'edit', seenAt: null }]);
  });

  // 0019가 아직 안 간 서버에는 `seen_at` 컬럼이 없어 select가 통째로 실패한다.
  // 그때는 컬럼 없이 한 번 더 읽어 **목록은 그대로** 뜨게 한다(배지만 사라진다).
  it('seen_at이 없는 구 서버에서는 컬럼 없이 다시 읽는다', async () => {
    const query = new SeqQuery([
      { data: null, error: { message: 'column document_shares.seen_at does not exist' } },
      { data: [{ document_id: 'd9', role: 'view' }], error: null },
    ]);
    const client = {
      from: vi.fn(() => query),
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'u1', email: 'me@example.com' } }, error: null })) },
    } as unknown as import('@supabase/supabase-js').SupabaseClient;

    const mine = await new SupabaseShareStore(client).listSharedWithMe();

    expect(query.calls[0]).toEqual({ method: 'select', args: ['document_id,role,seen_at'] });
    expect(query.calls[2]).toEqual({ method: 'select', args: ['document_id,role'] });
    expect(mine).toEqual([{ documentId: 'd9', role: 'view' }]); // seenAt 없음 = 배지 없음
  });

  it('markSharedSeen()은 0019 RPC를 부르고, 빈 목록이면 부르지 않는다', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const client = { rpc } as unknown as import('@supabase/supabase-js').SupabaseClient;
    const store = new SupabaseShareStore(client);

    await store.markSharedSeen([]);
    expect(rpc).not.toHaveBeenCalled();

    await store.markSharedSeen(['d1', 'd2']);
    expect(rpc).toHaveBeenCalledWith('mark_shares_seen', { doc_ids: ['d1', 'd2'] });
  });

  it('markSharedSeen()의 실패는 삼킨다 — 알림 표시가 맵 열기를 막지 않는다', async () => {
    const rpc = vi.fn(async () => {
      throw new Error('function mark_shares_seen does not exist');
    });
    const client = { rpc } as unknown as import('@supabase/supabase-js').SupabaseClient;

    await expect(new SupabaseShareStore(client).markSharedSeen(['d1'])).resolves.toBeUndefined();
  });

  it('notifyInvite()는 share-invite 함수를 부른다 — 키는 서버에만 있다', async () => {
    const invoke = vi.fn(async () => ({ data: { sent: true }, error: null }));
    const client = { functions: { invoke } } as unknown as import('@supabase/supabase-js').SupabaseClient;

    await new SupabaseShareStore(client).notifyInvite('d1', 'friend@example.com');

    expect(invoke).toHaveBeenCalledWith('share-invite', { body: { documentId: 'd1', email: 'friend@example.com' } });
  });

  it('notifyInvite()의 실패는 삼킨다 — 초대는 이미 걸렸고 앱 배지가 알린다', async () => {
    const invoke = vi.fn(async () => {
      throw new Error('function not deployed');
    });
    const client = { functions: { invoke } } as unknown as import('@supabase/supabase-js').SupabaseClient;

    await expect(new SupabaseShareStore(client).notifyInvite('d1', 'a@b.com')).resolves.toBeUndefined();
  });

  it('로그인 정보가 없으면 조회하지 않고 빈 목록', async () => {
    const { client, query } = fakeClient({ data: [], error: null }, null);
    expect(await new SupabaseShareStore(client).listSharedWithMe()).toEqual([]);
    expect(query.calls).toHaveLength(0);
  });

  it('참가자: 0011 RPC의 행을 포트 모양으로 바꾼다', async () => {
    const rpc = vi.fn(async () => ({
      data: [
        { kind: 'owner', email: 'me@example.com', display_name: '호율', joined: true, role: 'edit', avatar_url: 'https://cdn/me.webp', user_id: 'u-me' },
        { kind: 'invitee', email: 'friend@example.com', display_name: '  ', joined: true, role: 'view' }, // 공백 이름은 null 취급
        { kind: 'invitee', email: 'ghost@example.com', display_name: null, joined: false, role: null }, // role 없으면 edit
      ],
      error: null,
    }));
    const client = { rpc } as unknown as import('@supabase/supabase-js').SupabaseClient;

    const people = await new SupabaseShareStore(client).listParticipants('d1');

    expect(rpc).toHaveBeenCalledWith('share_participants', { doc_id: 'd1' });
    expect(people).toEqual([
      // 0031 — 사진·계정 id가 함께 온다. 구 서버(칸이 없는 함수)에서는 null.
      { kind: 'owner', email: 'me@example.com', displayName: '호율', joined: true, role: 'edit', avatarUrl: 'https://cdn/me.webp', userId: 'u-me' },
      { kind: 'invitee', email: 'friend@example.com', displayName: null, joined: true, role: 'view', avatarUrl: null, userId: null },
      { kind: 'invitee', email: 'ghost@example.com', displayName: null, joined: false, role: 'edit', avatarUrl: null, userId: null },
    ]);
  });

  it('참가자: RPC가 없거나(마이그레이션 전) 실패하면 null — 공유 자체는 계속 동작해야 한다', async () => {
    const errClient = { rpc: vi.fn(async () => ({ data: null, error: { message: 'function share_participants does not exist' } })) } as unknown as import('@supabase/supabase-js').SupabaseClient;
    expect(await new SupabaseShareStore(errClient).listParticipants('d1')).toBeNull();

    const throwClient = { rpc: vi.fn(async () => { throw new Error('network'); }) } as unknown as import('@supabase/supabase-js').SupabaseClient;
    expect(await new SupabaseShareStore(throwClient).listParticipants('d1')).toBeNull();
  });

  // 링크 공유(0017) — `documents.link_role`. 보기 전용만 열린다(check 제약).
  describe('링크 공유', () => {
    function linkClient(result: { data: unknown; error: unknown }) {
      const calls: { method: string; args: unknown[] }[] = [];
      const q = {
        select: (...a: unknown[]) => (calls.push({ method: 'select', args: a }), q),
        update: (...a: unknown[]) => (calls.push({ method: 'update', args: a }), q),
        eq: (...a: unknown[]) => (calls.push({ method: 'eq', args: a }), q),
        maybeSingle: () => Promise.resolve(result),
        then: (f: (v: unknown) => unknown) => Promise.resolve(result).then(f),
      };
      const from = vi.fn(() => q);
      return { client: { from } as unknown as import('@supabase/supabase-js').SupabaseClient, calls, from };
    }

    it('켜져 있으면 view, 꺼져 있으면 null', async () => {
      const on = linkClient({ data: { link_role: 'view' }, error: null });
      expect(await new SupabaseShareStore(on.client).getLink('d1')).toBe('view');
      expect(on.from).toHaveBeenCalledWith('documents');

      const off = linkClient({ data: { link_role: null }, error: null });
      expect(await new SupabaseShareStore(off.client).getLink('d1')).toBeNull();
    });

    it('컬럼이 없는 서버(마이그레이션 전)나 오류는 **꺼짐**으로 본다 — 켜졌다고 잘못 말하지 않게', async () => {
      const err = linkClient({ data: null, error: { message: 'column documents.link_role does not exist' } });
      expect(await new SupabaseShareStore(err.client).getLink('d1')).toBeNull();
    });

    it('켜기/끄기는 그 문서 행의 link_role만 바꾼다', async () => {
      const on = linkClient({ data: null, error: null });
      await new SupabaseShareStore(on.client).setLink('d1', 'view');
      expect(on.calls).toEqual([{ method: 'update', args: [{ link_role: 'view' }] }, { method: 'eq', args: ['id', 'd1'] }]);

      const off = linkClient({ data: null, error: null });
      await new SupabaseShareStore(off.client).setLink('d1', null);
      expect(off.calls[0]).toEqual({ method: 'update', args: [{ link_role: null }] });
    });

    it('편집 링크는 열지 않는다 — 유출되면 회수할 수 없다(보기 전용만)', async () => {
      const c = linkClient({ data: null, error: null });
      await new SupabaseShareStore(c.client).setLink('d1', 'edit');
      expect(c.calls[0]).toEqual({ method: 'update', args: [{ link_role: null }] });
    });
  });
});

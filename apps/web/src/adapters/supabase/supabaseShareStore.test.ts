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

  it('listSharedWithMe()는 내 이메일로 온 초대만 읽는다', async () => {
    const rows = [{ document_id: 'd9', role: 'edit' }];
    const { client, query } = fakeClient({ data: rows, error: null }, 'Me@Example.com');

    const mine = await new SupabaseShareStore(client).listSharedWithMe();

    expect(query.calls[0]).toEqual({ method: 'select', args: ['document_id,role'] });
    expect(query.calls[1]).toEqual({ method: 'eq', args: ['invitee_email', 'me@example.com'] });
    expect(mine).toEqual([{ documentId: 'd9', role: 'edit' }]);
  });

  it('로그인 정보가 없으면 조회하지 않고 빈 목록', async () => {
    const { client, query } = fakeClient({ data: [], error: null }, null);
    expect(await new SupabaseShareStore(client).listSharedWithMe()).toEqual([]);
    expect(query.calls).toHaveLength(0);
  });

  it('참가자: 0010 RPC의 행을 포트 모양으로 바꾼다', async () => {
    const rpc = vi.fn(async () => ({
      data: [
        { kind: 'owner', email: 'me@example.com', display_name: '호율', joined: true },
        { kind: 'invitee', email: 'friend@example.com', display_name: '  ', joined: true }, // 공백 이름은 null 취급
        { kind: 'invitee', email: 'ghost@example.com', display_name: null, joined: false },
      ],
      error: null,
    }));
    const client = { rpc } as unknown as import('@supabase/supabase-js').SupabaseClient;

    const people = await new SupabaseShareStore(client).listParticipants('d1');

    expect(rpc).toHaveBeenCalledWith('share_participants', { doc_id: 'd1' });
    expect(people).toEqual([
      { kind: 'owner', email: 'me@example.com', displayName: '호율', joined: true },
      { kind: 'invitee', email: 'friend@example.com', displayName: null, joined: true },
      { kind: 'invitee', email: 'ghost@example.com', displayName: null, joined: false },
    ]);
  });

  it('참가자: RPC가 없거나(마이그레이션 전) 실패하면 null — 공유 자체는 계속 동작해야 한다', async () => {
    const errClient = { rpc: vi.fn(async () => ({ data: null, error: { message: 'function share_participants does not exist' } })) } as unknown as import('@supabase/supabase-js').SupabaseClient;
    expect(await new SupabaseShareStore(errClient).listParticipants('d1')).toBeNull();

    const throwClient = { rpc: vi.fn(async () => { throw new Error('network'); }) } as unknown as import('@supabase/supabase-js').SupabaseClient;
    expect(await new SupabaseShareStore(throwClient).listParticipants('d1')).toBeNull();
  });
});

// SupabaseDocStore is verified against a MOCKED `supabase-js` client only —
// no live Supabase instance exists in this environment (per CLAUDE.md /
// M4 task brief). These tests assert the query shape (table, filters,
// payload) the adapter constructs, not real Postgres behavior.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ROOT_ID, type Doc } from '@mindflow/mindmap-core';
import { SupabaseDocStore } from './supabaseDocStore';

function makeDoc(title: string): Doc {
  return {
    v: 1,
    nodes: { [ROOT_ID]: { id: ROOT_ID, text: title, emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 } },
    floats: [],
    lines: [],
    zones: [],
    layoutMode: 'radial',
    themeKey: 'coral',
  };
}

/** A minimal thenable query-builder stand-in: every chain method records its
 * call and returns `this`; awaiting the builder (or calling a terminal method
 * like `.single()`/`.maybeSingle()`) resolves to the configured `result`. */
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
  order(...args: unknown[]) {
    return this.record('order', args);
  }
  eq(...args: unknown[]) {
    return this.record('eq', args);
  }
  update(...args: unknown[]) {
    return this.record('update', args);
  }
  upsert(...args: unknown[]) {
    return this.record('upsert', args);
  }
  insert(...args: unknown[]) {
    return this.record('insert', args);
  }
  single() {
    this.record('single', []);
    return Promise.resolve(this.result);
  }
  maybeSingle() {
    this.record('maybeSingle', []);
    return Promise.resolve(this.result);
  }
  then<TResult1 = { data: unknown; error: unknown }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

/** `list()`가 `DocMeta.ownedByMe`를 채우려고 세션의 uid를 읽으므로 auth도 흉내 낸다. */
function fakeClient(result: { data: unknown; error: unknown }, myUserId = 'me') {
  const query = new FakeQuery(result);
  const from = vi.fn(() => query);
  const auth = { getUser: vi.fn(async () => ({ data: { user: { id: myUserId } }, error: null })) };
  return { client: { from, auth } as unknown as import('@supabase/supabase-js').SupabaseClient, query, from };
}

describe('SupabaseDocStore', () => {
  it('list() selects from `documents` ordered by updated_at desc and maps rows to DocMeta', async () => {
    const rows = [{ id: 'd1', title: 'A', version: 3, updated_at: '2026-01-01T00:00:00Z', is_favorite: true, deleted_at: null, owner: 'me' }];
    const { client, query, from } = fakeClient({ data: rows, error: null });
    const store = new SupabaseDocStore(client);

    const metas = await store.list();

    expect(from).toHaveBeenCalledWith('documents');
    expect(query.calls[0]).toEqual({ method: 'select', args: ['id,title,version,updated_at,is_favorite,deleted_at,owner'] });
    expect(query.calls[1]).toEqual({ method: 'order', args: ['updated_at', { ascending: false }] });
    expect(metas).toEqual([{ id: 'd1', title: 'A', version: 3, updatedAt: '2026-01-01T00:00:00Z', isFavorite: true, deletedAt: null, ownedByMe: true }]);
  });

  // 공유(0009) 이후 `list()`는 남이 나에게 공유한 문서까지 돌려준다 — 홈이 그것을
  // 자기 스페이스 카드로 삼지 않도록 소유 여부를 실어 줘야 한다.
  it('list() marks documents owned by someone else as not mine', async () => {
    const rows = [
      { id: 'mine', title: 'A', version: 1, updated_at: '2026-01-02T00:00:00Z', is_favorite: false, deleted_at: null, owner: 'me' },
      { id: 'theirs', title: 'B', version: 1, updated_at: '2026-01-01T00:00:00Z', is_favorite: false, deleted_at: null, owner: 'someone-else' },
    ];
    const { client } = fakeClient({ data: rows, error: null }, 'me');
    const metas = await new SupabaseDocStore(client).list();
    expect(metas.map((m) => [m.id, m.ownedByMe])).toEqual([
      ['mine', true],
      ['theirs', false],
    ]);
  });

  it('list() treats rows as mine when the session id is unknown (pre-sharing behavior)', async () => {
    const rows = [{ id: 'd1', title: 'A', version: 1, updated_at: '2026-01-01T00:00:00Z', is_favorite: false, deleted_at: null, owner: 'whoever' }];
    const query = new FakeQuery({ data: rows, error: null });
    const client = { from: vi.fn(() => query), auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: null })) } } as unknown as import('@supabase/supabase-js').SupabaseClient;
    const metas = await new SupabaseDocStore(client).list();
    expect(metas[0]?.ownedByMe).toBe(true);
  });

  it('list() throws when the query errors', async () => {
    const { client } = fakeClient({ data: null, error: { message: 'boom' } });
    const store = new SupabaseDocStore(client);
    await expect(store.list()).rejects.toThrow('boom');
  });

  it('load() selects a single row by id and parses the JSONB `data` column', async () => {
    const row = { id: 'd1', title: 'A', version: 2, data: { v: 1, nodes: { root: { id: 'root', text: 'A', parent: null, children: [] } } } };
    const { client, query, from } = fakeClient({ data: row, error: null });
    const store = new SupabaseDocStore(client);

    const loaded = await store.load('d1');

    expect(from).toHaveBeenCalledWith('documents');
    expect(query.calls).toEqual([{ method: 'select', args: ['id,title,version,data'] }, { method: 'eq', args: ['id', 'd1'] }, { method: 'maybeSingle', args: [] }]);
    expect(loaded).toMatchObject({ version: 2, title: 'A' });
    expect(loaded!.doc.nodes.root!.text).toBe('A');
  });

  it('load() returns null when no row is found', async () => {
    const { client } = fakeClient({ data: null, error: null });
    const store = new SupabaseDocStore(client);
    expect(await store.load('missing')).toBeNull();
  });

  it('save() with prevVersion does a WHERE id AND version update (optimistic lock)', async () => {
    const { client, query, from } = fakeClient({ data: { version: 4 }, error: null });
    const store = new SupabaseDocStore(client);

    const result = await store.save('d1', makeDoc('B'), { prevVersion: 3, title: 'B' });

    expect(from).toHaveBeenCalledWith('documents');
    expect(query.calls[0]?.method).toBe('update');
    const [updatePayload] = query.calls[0]!.args as [Record<string, unknown>];
    expect(updatePayload).toMatchObject({ title: 'B', version: 4 });
    expect(query.calls[1]).toEqual({ method: 'eq', args: ['id', 'd1'] });
    expect(query.calls[2]).toEqual({ method: 'eq', args: ['version', 3] });
    expect(result).toEqual({ ok: true, version: 4 });
  });

  it('save() reports a conflict when the versioned update matches no row', async () => {
    // first call (the conditional update) resolves with no matched row
    const query = new FakeQuery({ data: null, error: null });
    let call = 0;
    const from = vi.fn(() => {
      call += 1;
      // second `.from()` call is the follow-up "what's the current version" select
      if (call === 2) return new FakeQuery({ data: { version: 9 }, error: null });
      return query;
    });
    const client = { from } as unknown as import('@supabase/supabase-js').SupabaseClient;
    const store = new SupabaseDocStore(client);

    const result = await store.save('d1', makeDoc('B'), { prevVersion: 3 });

    expect(result).toEqual({ ok: false, reason: 'conflict', currentVersion: 9 });
  });

  it('save() without prevVersion upserts at version 1 (first save of a new doc)', async () => {
    const { client, query } = fakeClient({ data: { version: 1 }, error: null });
    const store = new SupabaseDocStore(client);

    const result = await store.save('new-doc', makeDoc('Fresh'), { title: 'Fresh' });

    expect(query.calls[0]?.method).toBe('upsert');
    const [upsertPayload, upsertOpts] = query.calls[0]!.args as [Record<string, unknown>, Record<string, unknown>];
    expect(upsertPayload).toMatchObject({ id: 'new-doc', title: 'Fresh', version: 1 });
    expect(upsertOpts).toEqual({ onConflict: 'id' });
    expect(result).toEqual({ ok: true, version: 1 });
  });

  // ③ 첫 저장에서 남의 문서를 덮지 않기 위한 플래그 — `SaveOptions.createOnly`.
  it('save({createOnly}) INSERT만 한다 (upsert가 아니다)', async () => {
    const { client, query } = fakeClient({ data: { version: 1 }, error: null });
    const store = new SupabaseDocStore(client);

    const result = await store.save('new-doc', makeDoc('Fresh'), { title: 'Fresh', createOnly: true });

    expect(query.calls[0]?.method).toBe('insert');
    expect(query.calls.some((c) => c.method === 'upsert')).toBe(false);
    const [payload] = query.calls[0]!.args as [Record<string, unknown>];
    expect(payload).toMatchObject({ id: 'new-doc', title: 'Fresh', version: 1 });
    expect(result).toEqual({ ok: true, version: 1 });
  });

  it('save({createOnly}) 중복 키면 덮지 않고 conflict를 돌려준다', async () => {
    let call = 0;
    const insertQuery = new FakeQuery({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } });
    const from = vi.fn(() => {
      call += 1;
      // 두 번째 `.from()`은 "현재 버전이 몇인가" 조회
      if (call === 2) return new FakeQuery({ data: { version: 7 }, error: null });
      return insertQuery;
    });
    const client = { from } as unknown as import('@supabase/supabase-js').SupabaseClient;
    const store = new SupabaseDocStore(client);

    const result = await store.save('taken', makeDoc('Mine'), { createOnly: true });

    expect(result).toEqual({ ok: false, reason: 'conflict', currentVersion: 7 });
  });

  it('save({createOnly}) 중복이 아닌 오류는 error로 돌려준다 (조용히 성공하지 않는다)', async () => {
    const { client } = fakeClient({ data: null, error: { code: '42501', message: 'permission denied' } });
    const store = new SupabaseDocStore(client);
    expect(await store.save('x', makeDoc('X'), { createOnly: true })).toEqual({ ok: false, reason: 'error', message: 'permission denied' });
  });

  it('remove()/restore() update deleted_at, rename() updates title, setFavorite() updates is_favorite', async () => {
    const { client, query, from } = fakeClient({ data: null, error: null });
    const store = new SupabaseDocStore(client);

    await store.remove('d1');
    expect(from).toHaveBeenLastCalledWith('documents');
    expect(query.calls.at(-2)).toEqual({ method: 'update', args: [expect.objectContaining({ deleted_at: expect.any(String) })] });

    await store.restore('d1');
    expect(query.calls.at(-2)).toEqual({ method: 'update', args: [{ deleted_at: null }] });

    await store.rename('d1', '새 이름');
    expect(query.calls.at(-2)).toEqual({ method: 'update', args: [{ title: '새 이름' }] });

    await store.setFavorite('d1', true);
    expect(query.calls.at(-2)).toEqual({ method: 'update', args: [{ is_favorite: true }] });
  });
});

// 썸네일 전용 본문(0012 `preview_doc` RPC + (version, updatedAt) 키 로컬 캐시).
// 동시 편집 검토의 핵심: version은 낙관적 잠금이라 판이 다르면 반드시 키가
// 어긋나고(재다운로드), 유일성이 깨질 수 있는 단 하나의 경로(강제 저장의
// version 1 재설정)는 서버가 항상 새로 찍는 updatedAt이 잡는다.
describe('SupabaseDocStore.loadPreview', () => {
  const META = { version: 3, updatedAt: '2026-01-05T00:00:00Z' };

  function rpcClient(rpcResult: { data: unknown; error: unknown }, loadRow: { data: unknown; error: unknown } = { data: null, error: null }) {
    const query = new FakeQuery(loadRow);
    const from = vi.fn(() => query);
    const rpc = vi.fn(async () => rpcResult);
    const auth = { getUser: vi.fn(async () => ({ data: { user: { id: 'me' } }, error: null })) };
    return { client: { from, auth, rpc } as unknown as import('@supabase/supabase-js').SupabaseClient, rpc, from };
  }

  beforeEach(() => localStorage.clear());

  it('RPC 본문을 받아 캐시하고, 같은 판(version+updatedAt)이면 네트워크를 다시 타지 않는다', async () => {
    const stripped = { ...makeDoc('미리보기'), nodes: { root: { ...makeDoc('미리보기').nodes.root!, img: 'stripped', imgW: 180, imgH: 120 } } };
    const { client, rpc } = rpcClient({ data: stripped, error: null });
    const store = new SupabaseDocStore(client);

    const first = await store.loadPreview('d1', META);
    expect(rpc).toHaveBeenCalledWith('preview_doc', { doc_id: 'd1' });
    expect(first).toContain('미리보기');
    // 스트립 자리표시자('stripped')와 크기 필드가 본문에 살아 있어야 미리보기가
    // 회색 자리표시자를 같은 크기로 그린다 (parseDoc이 img를 버리면 회귀).
    expect(first).toContain('"img":"stripped"');
    expect(first).toContain('"imgW":180');

    const second = await store.loadPreview('d1', META);
    expect(rpc).toHaveBeenCalledTimes(1); // 캐시 적중 — 네트워크 없음
    expect(second).toBe(first);
  });

  it('판이 바뀌면(남이 저장 → version 증가) 캐시를 버리고 다시 받는다', async () => {
    const { client, rpc } = rpcClient({ data: makeDoc('v3판'), error: null });
    const store = new SupabaseDocStore(client);
    await store.loadPreview('d1', META);
    await store.loadPreview('d1', { version: 4, updatedAt: '2026-01-06T00:00:00Z' });
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('version이 같아도 updatedAt이 다르면 다시 받는다 — 강제 저장(version 1 재설정) 가드', async () => {
    const { client, rpc } = rpcClient({ data: makeDoc('본문'), error: null });
    const store = new SupabaseDocStore(client);
    await store.loadPreview('d1', { version: 1, updatedAt: '2026-01-01T00:00:00Z' });
    await store.loadPreview('d1', { version: 1, updatedAt: '2026-01-02T00:00:00Z' });
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('RPC 미적용/실패 시 전문 load()로 폴백한다', async () => {
    const row = { id: 'd1', title: 'P', version: 3, data: makeDoc('폴백본문') };
    const { client, rpc, from } = rpcClient({ data: null, error: { message: 'function public.preview_doc does not exist' } }, { data: row, error: null });
    const store = new SupabaseDocStore(client);
    const body = await store.loadPreview('d1', META);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith('documents'); // load() 폴백이 실제 쿼리를 탔다
    expect(body).toContain('폴백본문');
  });

  it('본문이 어디에도 없으면 null (카드가 스켈레톤에서 일반 스케치로 정착)', async () => {
    const { client } = rpcClient({ data: null, error: { message: 'x' } }, { data: null, error: null });
    expect(await new SupabaseDocStore(client).loadPreview('없는문서', META)).toBeNull();
  });
});

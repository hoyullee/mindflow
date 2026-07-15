// SupabaseDocStore is verified against a MOCKED `supabase-js` client only —
// no live Supabase instance exists in this environment (per CLAUDE.md /
// M4 task brief). These tests assert the query shape (table, filters,
// payload) the adapter constructs, not real Postgres behavior.

import { describe, expect, it, vi } from 'vitest';
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

function fakeClient(result: { data: unknown; error: unknown }) {
  const query = new FakeQuery(result);
  const from = vi.fn(() => query);
  return { client: { from } as unknown as import('@supabase/supabase-js').SupabaseClient, query, from };
}

describe('SupabaseDocStore', () => {
  it('list() selects from `documents` ordered by updated_at desc and maps rows to DocMeta', async () => {
    const rows = [{ id: 'd1', title: 'A', version: 3, updated_at: '2026-01-01T00:00:00Z', is_favorite: true, deleted_at: null }];
    const { client, query, from } = fakeClient({ data: rows, error: null });
    const store = new SupabaseDocStore(client);

    const metas = await store.list();

    expect(from).toHaveBeenCalledWith('documents');
    expect(query.calls[0]).toEqual({ method: 'select', args: ['id,title,version,updated_at,is_favorite,deleted_at'] });
    expect(query.calls[1]).toEqual({ method: 'order', args: ['updated_at', { ascending: false }] });
    expect(metas).toEqual([{ id: 'd1', title: 'A', version: 3, updatedAt: '2026-01-01T00:00:00Z', isFavorite: true, deletedAt: null }]);
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

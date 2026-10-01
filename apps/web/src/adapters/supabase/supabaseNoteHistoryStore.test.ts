import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseNoteHistoryStore } from './supabaseNoteHistoryStore';

// `note_history`(0048) — 질의 모양(필터·정렬·한 건 더)과 행 ↔ 항목 변환만 본다.
// 권한·보관은 서버 몫이라 하네스(로컬 Postgres)에서 확인했다.

const ROW = {
  id: 'h1',
  document_id: 'd1',
  page_id: 'p1',
  at: '2026-10-01T03:04:05.123456+00:00',
  actor_id: 'u1',
  actor_name: '홍길동',
  actor_color: '#7C9BD8',
  actor_avatar: null,
  kind: 'edit',
  summary: '문구를 고쳤어요',
  diff: { before: '가', after: '나' },
  anchor: 'b3',
  snapshot: { id: 'p1', blocks: [] },
};

function clientWith({ rows = [] as unknown[], error = null as { message: string } | null, single = ROW as unknown } = {}) {
  const calls: string[] = [];
  const lt = vi.fn();
  const limit = vi.fn(async (n: number) => ({ data: rows.slice(0, n), error }));
  const order = vi.fn(() => ({ limit }));
  // eq, eq 뒤에 (before가 있으면) lt, 그 뒤 order — 어느 쪽이든 같은 체인 객체를 돌려준다.
  const chain: Record<string, unknown> = {};
  chain['eq'] = vi.fn((c: string, v: unknown) => (calls.push(`eq:${c}=${String(v)}`), chain));
  chain['lt'] = lt.mockImplementation((c: string, v: unknown) => (calls.push(`lt:${c}=${String(v)}`), chain));
  chain['order'] = order;
  const select = vi.fn(() => chain);
  const singleFn = vi.fn(async () => ({ data: single, error }));
  const insert = vi.fn(() => ({ select: vi.fn(() => ({ single: singleFn })) }));
  const updateEq = vi.fn(async () => ({ error }));
  const update = vi.fn(() => ({ eq: updateEq }));
  const from = vi.fn(() => ({ select, insert, update }));
  return { client: { from } as unknown as SupabaseClient, calls, select, order, limit, insert, update, updateEq, from };
}

describe('SupabaseNoteHistoryStore.list', () => {
  it('그 문서·페이지만 최신 먼저, 한 건 더 읽는다', async () => {
    const { client, calls, order, limit, from } = clientWith({ rows: [ROW] });
    const out = await new SupabaseNoteHistoryStore(client).list('d1', 'p1');
    expect(from).toHaveBeenCalledWith('note_history');
    expect(calls).toEqual(['eq:document_id=d1', 'eq:page_id=p1']);
    expect(order).toHaveBeenCalledWith('at', { ascending: false });
    expect(limit).toHaveBeenCalledWith(101);
    expect(out.hasMore).toBe(false);
    expect(out.entries[0]).toEqual({
      id: 'h1',
      docId: 'd1',
      pageId: 'p1',
      at: Date.parse('2026-10-01T03:04:05.123Z'),
      actor: { id: 'u1', name: '홍길동', color: '#7C9BD8', avatar: null },
      kind: 'edit',
      summary: '문구를 고쳤어요',
      diff: { before: '가', after: '나' },
      anchor: 'b3',
      snapshot: { id: 'p1', blocks: [] },
    });
  });

  it('limit보다 한 건 더 오면 hasMore — 돌려주는 것은 limit까지', async () => {
    const rows = [1, 2, 3].map((i) => ({ ...ROW, id: `h${i}` }));
    const { client } = clientWith({ rows });
    const out = await new SupabaseNoteHistoryStore(client).list('d1', 'p1', { limit: 2 });
    expect(out.entries.map((e) => e.id)).toEqual(['h1', 'h2']);
    expect(out.hasMore).toBe(true);
  });

  it('before(ms)는 at < ISO 필터로 간다', async () => {
    const { client, calls } = clientWith();
    await new SupabaseNoteHistoryStore(client).list('d1', 'p1', { before: Date.parse('2026-09-30T00:00:00Z') });
    expect(calls).toContain('lt:at=2026-09-30T00:00:00.000Z');
  });

  it('탈퇴한 사람(actor_id null)·어긋난 diff는 비운 채 읽는다', async () => {
    const { client } = clientWith({ rows: [{ ...ROW, actor_id: null, diff: 'oops', anchor: null }] });
    const [e] = (await new SupabaseNoteHistoryStore(client).list('d1', 'p1')).entries;
    expect(e!.actor.id).toBe('');
    expect(e!.diff).toBeNull();
    expect(e!.anchor).toBeNull();
  });

  it('오류는 던진다(호출자가 잡는다)', async () => {
    const { client } = clientWith({ error: { message: 'relation "note_history" does not exist' } });
    await expect(new SupabaseNoteHistoryStore(client).list('d1', 'p1')).rejects.toThrow(/does not exist/);
  });
});

describe('SupabaseNoteHistoryStore.append', () => {
  const actor = { id: 'u1', name: '홍길동', color: '#7C9BD8', avatar: 'https://x/a.png' };

  it('actor_id·id를 보내지 않는다(기본값 auth.uid()가 찍는다) / 시각은 줄 때만 보낸다', async () => {
    const { client, insert } = clientWith();
    const out = await new SupabaseNoteHistoryStore(client).append({ docId: 'd1', pageId: 'p1', actor, kind: 'edit', summary: 's', snapshot: { a: 1 } });
    const row = (insert.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(row).toMatchObject({ document_id: 'd1', page_id: 'p1', actor_name: '홍길동', actor_color: '#7C9BD8', actor_avatar: 'https://x/a.png', kind: 'edit', summary: 's', diff: null, anchor: null, snapshot: { a: 1 } });
    expect('actor_id' in row).toBe(false);
    expect('id' in row).toBe(false);
    expect('at' in row).toBe(false);
    expect(out.id).toBe('h1');
  });

  it('at을 주면 ISO로 보낸다', async () => {
    const { client, insert } = clientWith();
    await new SupabaseNoteHistoryStore(client).append({ docId: 'd1', pageId: 'p1', actor, kind: 'create', summary: '', snapshot: {}, at: Date.parse('2026-10-01T00:00:00Z') });
    expect((insert.mock.calls[0] as unknown as [Record<string, unknown>])[0]['at']).toBe('2026-10-01T00:00:00.000Z');
  });

  it('오류는 던진다', async () => {
    const { client } = clientWith({ error: { message: 'new row violates row-level security policy' } });
    await expect(new SupabaseNoteHistoryStore(client).append({ docId: 'd1', pageId: 'p1', actor, kind: 'edit', summary: '', snapshot: {} })).rejects.toThrow(/row-level security/);
  });
});

describe('SupabaseNoteHistoryStore.update', () => {
  it('준 필드만 보낸다', async () => {
    const { client, update, updateEq } = clientWith();
    await new SupabaseNoteHistoryStore(client).update('h1', { summary: '새 요약', at: Date.parse('2026-10-01T00:00:00Z'), diff: null });
    expect(update).toHaveBeenCalledWith({ summary: '새 요약', at: '2026-10-01T00:00:00.000Z', diff: null });
    expect(updateEq).toHaveBeenCalledWith('id', 'h1');
  });

  it('빈 패치는 서버를 부르지 않는다', async () => {
    const { client, update } = clientWith();
    await new SupabaseNoteHistoryStore(client).update('h1', {});
    expect(update).not.toHaveBeenCalled();
  });

  it('오류는 던진다', async () => {
    const { client } = clientWith({ error: { message: 'boom' } });
    await expect(new SupabaseNoteHistoryStore(client).update('h1', { summary: 'x' })).rejects.toThrow(/boom/);
  });
});

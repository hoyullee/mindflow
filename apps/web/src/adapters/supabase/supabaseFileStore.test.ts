import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseFileStore, type PutFn } from './supabaseFileStore';
import { FileUploadError } from '../ports';

// 첨부 파일(0049) — 함수 `files`와 주고받는 모양만 본다. 권한·한도 판정은 서버 몫이다.

type Reply = { data?: unknown; error?: unknown };

function clientWith(replies: Record<string, Reply>, rpc: Reply = { data: [] }) {
  const bodies: Record<string, unknown>[] = [];
  const invoke = vi.fn(async (_name: string, opts: { body: Record<string, unknown> }) => {
    bodies.push(opts.body);
    const r = replies[String(opts.body.action)] ?? { data: { ok: false, reason: 'bad-request' } };
    return { data: r.data ?? null, error: r.error ?? null };
  });
  const client = { functions: { invoke }, rpc: vi.fn(async () => ({ data: rpc.data ?? null, error: rpc.error ?? null })) } as unknown as SupabaseClient;
  return { client, bodies, invoke };
}

const pdf = () => new File(['%PDF-1.4 hello'], '보고서.pdf', { type: 'application/pdf' });

describe('SupabaseFileStore', () => {
  it('묻기 → R2로 직접 올리기 → 끝났다고 알리기 — 서명에 실은 형식을 그대로 보낸다', async () => {
    const { client, bodies } = clientWith({
      upload: { data: { ok: true, fileId: 'f1', uploadUrl: 'https://r2.example/put?sig', headers: { 'Content-Type': 'application/pdf' } } },
      complete: { data: { ok: true, file: { id: 'f1', name: '보고서.pdf', size: 14, mime: 'application/pdf' } } },
    });
    const put = vi.fn<PutFn>(async (_u, _b, _h, onProgress) => onProgress?.(0.5));
    const seen: number[] = [];
    const out = await new SupabaseFileStore(client, put).upload('doc1', pdf(), (r) => seen.push(r));
    expect(bodies[0]).toEqual({ action: 'upload', docId: 'doc1', name: '보고서.pdf', size: 14, mime: 'application/pdf' });
    expect(put.mock.calls[0]?.[0]).toBe('https://r2.example/put?sig');
    expect(put.mock.calls[0]?.[2]).toEqual({ 'Content-Type': 'application/pdf' });
    expect(bodies[1]).toEqual({ action: 'complete', fileId: 'f1' });
    expect(out).toEqual({ id: 'f1', name: '보고서.pdf', size: 14, mime: 'application/pdf' });
    expect(seen).toEqual([0.5, 1]);
  });

  it('서버가 막으면 까닭과 숫자를 그대로 — 한도 초과', async () => {
    const { client } = clientWith({ upload: { data: { ok: false, reason: 'quota', used: 199, limit: 200 } } });
    const err = await new SupabaseFileStore(client, vi.fn()).upload('doc1', pdf()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FileUploadError);
    expect((err as FileUploadError).reason).toBe('quota');
    expect((err as FileUploadError).detail).toEqual({ used: 199, limit: 200 });
  });

  it('R2로 올리다 실패하면 잡아 둔 자리를 바로 지운다(쓴 양에 남지 않게)', async () => {
    const { client, bodies } = clientWith({
      upload: { data: { ok: true, fileId: 'f2', uploadUrl: 'https://r2.example/put' } },
      remove: { data: { ok: true } },
    });
    const put: PutFn = async () => {
      throw new FileUploadError('network');
    };
    const err = await new SupabaseFileStore(client, put).upload('doc1', pdf()).catch((e: unknown) => e);
    expect((err as FileUploadError).reason).toBe('network');
    await Promise.resolve();
    expect(bodies.map((b) => b.action)).toEqual(['upload', 'remove']);
  });

  it('함수가 아직 없으면(404) 「준비 중」으로 읽는다', async () => {
    const { client } = clientWith({ upload: { error: { message: 'not found', context: { status: 404 } } } });
    const err = await new SupabaseFileStore(client, vi.fn()).upload('doc1', pdf()).catch((e: unknown) => e);
    expect((err as FileUploadError).reason).toBe('not-configured');
  });

  it('형식이 비어 있는 파일은 octet-stream으로 묻고 그대로 보낸다', async () => {
    const { client, bodies } = clientWith({
      upload: { data: { ok: true, fileId: 'f3', uploadUrl: 'u' } },
      complete: { data: { ok: true, file: { id: 'f3', name: 'a.hwp', size: 1, mime: 'application/octet-stream' } } },
    });
    const put = vi.fn<PutFn>(async () => undefined);
    await new SupabaseFileStore(client, put).upload('d', new File(['x'], 'a.hwp'));
    expect(bodies[0]?.mime).toBe('application/octet-stream');
    expect(put.mock.calls[0]?.[2]).toEqual({ 'Content-Type': 'application/octet-stream' });
  });

  it('한도 — RPC 행을 그대로, 모르면 null', async () => {
    const ok = clientWith({}, { data: [{ plan: 'free', plan_name: '무료', used: 1024, storage_limit: 209715200, file_limit: 20971520 }] });
    expect(await new SupabaseFileStore(ok.client).quota()).toEqual({ plan: 'free', planName: '무료', used: 1024, limit: 209715200, fileLimit: 20971520 });
    const bad = clientWith({}, { error: { message: 'function my_file_quota does not exist' } });
    expect(await new SupabaseFileStore(bad.client).quota()).toBeNull();
  });

  it('받기 주소 — 실패하면 null', async () => {
    const { client, bodies } = clientWith({ download: { data: { ok: true, url: 'https://r2.example/get' } } });
    const store = new SupabaseFileStore(client);
    expect(await store.downloadUrl('f1', true)).toBe('https://r2.example/get');
    expect(bodies[0]).toEqual({ action: 'download', fileId: 'f1', inline: true });
    const none = clientWith({ download: { data: { ok: false, reason: 'not-found' } } });
    expect(await new SupabaseFileStore(none.client).downloadUrl('zz')).toBeNull();
  });
});

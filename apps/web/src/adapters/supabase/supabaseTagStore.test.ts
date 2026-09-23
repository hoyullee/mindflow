import { describe, expect, it, vi } from 'vitest';
import { SupabaseTagStore } from './supabaseTagStore';
import type { SupabaseClient } from '@supabase/supabase-js';

// `note_tags` 테이블(0042) — 사용자당 한 행에 태그 판을 통째로. RLS가 자기 행으로
// 좁히므로 owner를 보내지 않는다(칼럼 기본값 `auth.uid()`가 찍는다).

function clientWith({ data, error, upsertError }: { data?: unknown; error?: { message: string }; upsertError?: { message: string } } = {}) {
  const maybeSingle = vi.fn(async () => ({ data: data ?? null, error: error ?? null }));
  const upsert = vi.fn(async () => ({ error: upsertError ?? null }));
  const client = {
    from: vi.fn(() => ({ select: vi.fn(() => ({ maybeSingle })), upsert })),
  } as unknown as SupabaseClient;
  return { client, upsert, maybeSingle };
}

describe('SupabaseTagStore', () => {
  it('자기 행의 판을 읽는다', async () => {
    const { client } = clientWith({ data: { data: { made: ['스프린트'], colors: { 스프린트: '#7C9BD8' }, hidden: ['회의록'] } } });
    expect(await new SupabaseTagStore(client).load()).toEqual({ made: ['스프린트'], colors: { 스프린트: '#7C9BD8' }, hidden: ['회의록'] });
  });

  it('행이 없으면 null(= 서버에 판이 없다)', async () => {
    const { client } = clientWith({ data: null });
    expect(await new SupabaseTagStore(client).load()).toBeNull();
  });

  it('모양이 어긋난 값은 빈 자리로 채운다(깨진 판으로 화면을 세우지 않는다)', async () => {
    const { client } = clientWith({ data: { data: { made: ['좋음', 3], colors: 'nope' } } });
    expect(await new SupabaseTagStore(client).load()).toEqual({ made: ['좋음'], colors: {}, hidden: [] });
  });

  it('읽기 실패는 던지지 않는다 — 기기 판으로 살 수 있어야 한다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { client } = clientWith({ error: { message: 'relation "note_tags" does not exist' } });
    expect(await new SupabaseTagStore(client).load()).toBeNull();
    warn.mockRestore();
  });

  it('owner 없이 upsert한다(기본값이 찍고, 다음부터는 그 행을 갱신한다)', async () => {
    const { client, upsert } = clientWith();
    await new SupabaseTagStore(client).save({ made: ['배포'], colors: {}, hidden: [] });
    expect(upsert).toHaveBeenCalledTimes(1);
    const [row, opts] = upsert.mock.calls[0] as unknown as [Record<string, unknown>, Record<string, unknown>];
    expect(row['data']).toEqual({ made: ['배포'], colors: {}, hidden: [] });
    expect(row['owner']).toBeUndefined();
    expect(opts).toEqual({ onConflict: 'owner' });
  });

  it('쓰기 실패도 던지지 않는다(태그 하나 때문에 화면이 깨지지 않게)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { client } = clientWith({ upsertError: { message: 'permission denied' } });
    await expect(new SupabaseTagStore(client).save({ made: [], colors: {}, hidden: [] })).resolves.toBeUndefined();
    warn.mockRestore();
  });
});

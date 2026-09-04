// 홈 부트스트랩 RPC(0036) — 세 포트 메서드가 **한 요청을 나눠 쓴다**.
// 실 Supabase가 없는 환경이므로 어댑터가 어떤 요청을 만드는지를 단정한다
// (실제 접근 제어는 RLS가 하고, 이 함수는 security invoker라 권한을 넓히지 않는다).

import { describe, expect, it, vi } from 'vitest';
import { SupabaseDocStore } from './supabaseDocStore';
import { SupabaseShareStore } from './supabaseShareStore';

const BOOT = {
  documents: [
    { id: 'd1', title: '내 맵', version: 3, updated_at: '2026-01-02T00:00:00Z', is_favorite: true, deleted_at: null, owner: 'u1', updated_by: 'u1', link_role: 'view' },
    { id: 'd2', title: '공유받은 맵', version: 1, updated_at: '2026-01-01T00:00:00Z', is_favorite: false, deleted_at: null, owner: 'u2', updated_by: 'u2', link_role: null },
  ],
  shares: [
    { document_id: 'd1', invitee_email: 'friend@example.com', role: 'edit', seen_at: '2026-01-03T00:00:00Z' },
    { document_id: 'd1', invitee_email: 'buddy@example.com', role: 'view', seen_at: null },
    { document_id: 'd2', invitee_email: 'me@example.com', role: 'view', seen_at: null },
  ],
};

function fakeClient(rpcResult: { data: unknown; error: unknown }) {
  const rpc = vi.fn(async () => rpcResult);
  const from = vi.fn(() => {
    // 폴백 경로(예전 질의) — 어떤 체인이든 빈 결과로 끝낸다.
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'not']) q[m] = () => q;
    q.then = (ok: (v: { data: unknown; error: unknown }) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
    return q;
  });
  const auth = { getSession: vi.fn(async () => ({ data: { session: { user: { id: 'u1', email: 'me@example.com' } } }, error: null })) };
  const client = { rpc, from, auth } as unknown as import('@supabase/supabase-js').SupabaseClient;
  return { client, rpc, from };
}

describe('home_bootstrap (0036)', () => {
  it('같은 틱에 부르는 세 조회가 요청 하나를 나눠 쓴다', async () => {
    const { client, rpc, from } = fakeClient({ data: BOOT, error: null });
    const docs = new SupabaseDocStore(client);
    const shares = new SupabaseShareStore(client);

    const [metas, withMe, byMe] = await Promise.all([docs.list(), shares.listSharedWithMe(), shares.listSharedByMe()]);

    // 왕복은 하나 — 그리고 예전 질의는 아예 나가지 않는다.
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('home_bootstrap');
    expect(from).not.toHaveBeenCalled();

    // 문서 목록 — 예전 질의와 같은 매핑(내 것인가 / 마지막 저장자가 나인가).
    expect(metas.map((m) => [m.id, m.ownedByMe, m.editedByMe])).toEqual([
      ['d1', true, true],
      ['d2', false, false],
    ]);
    // 공유받은 맵 — **내 이메일로 온 행만**.
    expect(withMe).toEqual([{ documentId: 'd2', role: 'view', seenAt: null }]);
    // 내가 걸어 둔 공유 — 보이는 초대 수 + link_role이 켜진 문서.
    expect(byMe).toEqual({ d1: { invitees: 2, link: true }, d2: { invitees: 1, link: false } });
  });

  it('RPC가 없는 서버(마이그레이션 대기)에서는 예전 질의로 물러난다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { client, rpc, from } = fakeClient({ data: null, error: { message: 'function public.home_bootstrap() does not exist' } });

    const metas = await new SupabaseDocStore(client).list();

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith('documents'); // 예전 목록 질의
    expect(metas).toEqual([]);
    expect(warn).toHaveBeenCalled(); // 원인을 콘솔이 말한다
    warn.mockRestore();
  });

  it('캐시가 아니라 합치기 — 끝난 뒤의 조회는 새로 받는다', async () => {
    const { client, rpc } = fakeClient({ data: BOOT, error: null });
    const shares = new SupabaseShareStore(client);

    await shares.listSharedByMe();
    await shares.listSharedByMe();

    expect(rpc).toHaveBeenCalledTimes(2);
  });
});

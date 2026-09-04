// 홈 첫 화면의 목록을 한 번에 받아 오는 공용 조회(RPC `home_bootstrap`, 0036).
//
// **왜 어댑터 밖의 모듈인가**: 이 한 번의 응답이 세 포트 메서드에 답한다 —
// `DocStore.list()`, `ShareStore.listSharedWithMe()`, `ShareStore.listSharedByMe()`.
// 포트를 새로 뚫거나 홈 컨트롤러를 고치지 않고(로컬·데모 어댑터는 손대지 않는다)
// **같은 틱에 나가는 호출들이 진행 중인 요청 하나를 나눠 쓰게** 하는 것이 가장
// 작은 변경이다. 홈 하이드레이션은 넷을 `Promise.allSettled`로 함께 부르므로 그
// 순간의 요청은 하나가 된다.
//
// 캐시는 두지 않는다(TTL 없음) — 진행 중인 약속만 나눠 쓰고 끝나면 버린다. 그래서
// 나중에 따로 부르는 조회(공유 팝업을 닫은 뒤의 `listSharedByMe` 등)는 언제나 새
// 값을 받는다: 낡은 값을 보여 주는 쪽이 요청 하나보다 나쁘다.
//
// RPC가 없는 서버(마이그레이션이 앱 배포보다 늦다)에서는 `null`을 돌려주고, 부르는
// 쪽이 예전 질의로 물러난다 — 배포 순서 안전(0012·0015·0019와 같은 태도).

import type { SupabaseClient } from '@supabase/supabase-js';

export interface BootstrapDocumentRow {
  id: string;
  title: string | null;
  version: number;
  updated_at: string;
  is_favorite: boolean | null;
  deleted_at: string | null;
  owner?: string | null;
  updated_by?: string | null;
  link_role?: string | null;
}

export interface BootstrapShareRow {
  document_id: string;
  invitee_email: string;
  role: string;
  seen_at: string | null;
}

export interface HomeBootstrap {
  documents: BootstrapDocumentRow[];
  shares: BootstrapShareRow[];
}

/** 진행 중인 요청 — 클라이언트별로 든다(테스트가 여러 클라이언트를 만든다). */
const inflight = new WeakMap<SupabaseClient, Promise<HomeBootstrap | null>>();

async function fetchBootstrap(client: SupabaseClient): Promise<HomeBootstrap | null> {
  const { data, error } = await client.rpc('home_bootstrap');
  if (error) {
    // 조용히 물러나되 콘솔에는 남긴다 — "요청이 왜 넷인가"를 나중에 되짚을 수 있게.
    console.warn('[geurio] home_bootstrap RPC 실패 — 개별 조회로 대체(마이그레이션 0036 대기):', error.message);
    return null;
  }
  const raw = data as { documents?: unknown; shares?: unknown } | null;
  if (!raw || !Array.isArray(raw.documents) || !Array.isArray(raw.shares)) return null;
  return { documents: raw.documents as BootstrapDocumentRow[], shares: raw.shares as BootstrapShareRow[] };
}

export function homeBootstrap(client: SupabaseClient): Promise<HomeBootstrap | null> {
  const cur = inflight.get(client);
  if (cur) return cur;
  const p = fetchBootstrap(client).catch(() => null); // 네트워크 오류 — 부르는 쪽이 자기 질의로
  inflight.set(client, p);
  // 끝나면 버린다 — 다음 조회는 새 값을 받는다(캐시가 아니라 **합치기**다).
  void p.finally(() => {
    if (inflight.get(client) === p) inflight.delete(client);
  });
  return p;
}

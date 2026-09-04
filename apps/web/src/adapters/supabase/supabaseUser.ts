// 지금 로그인한 사람 — **세션에서** 읽는다(네트워크 왕복 없음).
//
// 왜 `getUser()`가 아닌가: supabase-js의 `auth.getUser()`는 **매번 `/auth/v1/user`를
// 호출한다**(서버가 토큰을 검증해 최신 사용자 정보를 돌려준다). 우리 스토어들은
// 저마다 "내가 누구인가"를 알아야 하므로, 홈을 한 번 열면 그 왕복이 어댑터 수만큼
// 났다(제보: 새로고침 한 번에 `user` 요청 6건).
//
// 우리가 그 값으로 하는 일은 **내 uid·이메일로 질의를 만들고 insert 칸을 채우는 것**
// 뿐이고, 진짜 게이트는 그 JWT를 검증하는 **RLS**다 — 즉 서버에 다시 물어 얻는
// 것이 없다. `getSession()`은 로컬 저장소에서 읽고(만료면 조용히 갱신) 같은 JWT의
// 사용자를 준다.
//
// 세션이 없을 때만 `getUser()`로 물러선다(스토어를 로그인 없이 쓰는 경로·테스트
// 스텁이 `getSession`을 두지 않는 경우).

import type { SupabaseClient, User } from '@supabase/supabase-js';

export async function currentUser(client: SupabaseClient): Promise<User | null> {
  try {
    const { data } = await client.auth.getSession();
    const u = data.session?.user;
    if (u) return u;
  } catch {
    // getSession이 없는 스텁 — 아래 폴백으로.
  }
  const { data } = await client.auth.getUser();
  return data.user ?? null;
}

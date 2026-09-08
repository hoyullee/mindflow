// Thin wrapper around `@supabase/supabase-js`'s `createClient` — isolated so
// `adapters/factory.ts` and tests can construct/inject a client without every
// call site needing to know `createClient`'s options shape.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { authSessionStorage } from '../../features/auth/rememberSession';

let cached: { url: string; key: string; client: SupabaseClient } | null = null;

/**
 * Returns a memoized `SupabaseClient` for the given URL/anon key (re-creating
 * it only if either changes — relevant mainly for tests/hot-reload, since in
 * production `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` are fixed at build time).
 */
export function getSupabaseClient(url: string, anonKey: string): SupabaseClient {
  if (cached && cached.url === url && cached.key === anonKey) return cached.client;
  const client = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      // "이 브라우저에서 로그인 유지"를 끄면 세션이 탭 저장소로 간다(창을 닫으면
      // 사라짐). 켜져 있으면 지금까지처럼 localStorage — rememberSession.ts 참고.
      storage: authSessionStorage,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      // **명시해 둔다.** 이 값이 `implicit`이라는 사실에 기대는 경로가 있다 —
      // 설치형 앱의 Google 로그인 핸드오프는 콜백이 해시로 실어 주는 토큰을 낚아채
      // 앱에 넘긴다(features/auth/desktopGoogle.ts). auth-js의 **기본값**이 지금은
      // `implicit`이지만 언젠가 `pkce`로 뒤집히면 그 경로가 조용히 깨지므로(이미 한 번
      // 잘못 짚었다) 기본값에 기대지 않고 여기서 못박는다. 바꾸려면 그 파일과
      // 비밀번호 재설정 링크 흐름을 함께 손봐야 한다.
      flowType: 'implicit',
    },
  });
  cached = { url, key: anonKey, client };
  return client;
}

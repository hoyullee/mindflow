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
    },
  });
  cached = { url, key: anonKey, client };
  return client;
}

// Thin wrapper around `@supabase/supabase-js`'s `createClient` — isolated so
// `adapters/factory.ts` and tests can construct/inject a client without every
// call site needing to know `createClient`'s options shape.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

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
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  cached = { url, key: anonKey, client };
  return client;
}

// Backend selection: Supabase if configured, LocalStorage demo otherwise.
// This is the ONLY place that decides which concrete adapter the app uses —
// everything else (`BackendContext`, features) codes against the `Backend`/
// `AuthProvider`/`DocStore` ports.
//
// Importing the Supabase adapters here does NOT make any network call by
// itself (constructing a `SupabaseClient` is inert until a request method is
// invoked) — `createBackend()` only ever *constructs* them when the env vars
// are actually present, so a plain local/CI checkout never talks to Supabase.

import type { Backend } from './ports';
import { LocalAuth } from './local/localAuth';
import { LocalDocStore } from './local/localDocStore';
import { LocalSpaceStore } from './local/localSpaceStore';
import { getSupabaseClient } from './supabase/supabaseClient';
import { SupabaseAuth } from './supabase/supabaseAuth';
import { SupabaseDocStore } from './supabase/supabaseDocStore';
import { SupabaseSpaceStore } from './supabase/supabaseSpaceStore';
import { isSupabaseConfigured, readViteEnv, type BackendEnv } from './env';

/**
 * @param envOverride Inject an explicit env (tests) instead of reading
 * `import.meta.env`. Production call sites should omit this.
 */
export function createBackend(envOverride?: BackendEnv): Backend {
  const env = envOverride ?? readViteEnv();
  if (isSupabaseConfigured(env)) {
    const client = getSupabaseClient(env.VITE_SUPABASE_URL!, env.VITE_SUPABASE_ANON_KEY!);
    return { auth: new SupabaseAuth(client), docStore: new SupabaseDocStore(client), spaceStore: new SupabaseSpaceStore(client), mode: 'supabase' };
  }
  return { auth: new LocalAuth(), docStore: new LocalDocStore(), spaceStore: new LocalSpaceStore(), mode: 'local' };
}

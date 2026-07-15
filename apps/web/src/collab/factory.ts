// Collab-transport selection, mirroring `adapters/factory.ts`'s pattern
// exactly: Supabase Realtime if the project is configured (env-gated, same
// vars `SupabaseDocStore`/`SupabaseAuth` already use), else `BroadcastChannel`
// for local multi-tab collaboration, else a no-op (single-user, current
// behavior — e.g. a browser without `BroadcastChannel`, vanishingly rare but
// defensive).

import { isSupabaseConfigured, readViteEnv, type BackendEnv } from '../adapters/env';
import { getSupabaseClient } from '../adapters/supabase/supabaseClient';
import type { CollabProvider } from './ports';
import { BroadcastChannelProvider } from './BroadcastChannelProvider';
import { SupabaseRealtimeProvider } from './SupabaseRealtimeProvider';
import { NoopCollabProvider } from './NoopCollabProvider';

/**
 * @param envOverride Inject an explicit env (tests) instead of reading
 * `import.meta.env`. Production call sites should omit this.
 */
export function createCollabProvider(envOverride?: BackendEnv): CollabProvider {
  const env = envOverride ?? readViteEnv();
  if (isSupabaseConfigured(env)) {
    const client = getSupabaseClient(env.VITE_SUPABASE_URL!, env.VITE_SUPABASE_ANON_KEY!);
    return new SupabaseRealtimeProvider(client);
  }
  if (typeof BroadcastChannel !== 'undefined') {
    return new BroadcastChannelProvider();
  }
  return new NoopCollabProvider();
}

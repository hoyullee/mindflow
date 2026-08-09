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
import { LocalShareStore } from './local/localShareStore';
import { LocalFeedbackStore } from './local/localFeedbackStore';
import { LocalCommentStore } from './local/localCommentStore';
import { LocalNotificationStore } from './local/localNotificationStore';
import { LocalImageStore } from './local/localImageStore';
import { getSupabaseClient } from './supabase/supabaseClient';
import { SupabaseAuth } from './supabase/supabaseAuth';
import { SupabaseDocStore } from './supabase/supabaseDocStore';
import { SupabaseSpaceStore } from './supabase/supabaseSpaceStore';
import { SupabaseShareStore } from './supabase/supabaseShareStore';
import { SupabaseFeedbackStore } from './supabase/supabaseFeedbackStore';
import { SupabaseCommentStore } from './supabase/supabaseCommentStore';
import { SupabaseNotificationStore } from './supabase/supabaseNotificationStore';
import { SupabaseImageStore } from './supabase/supabaseImageStore';
import { isSupabaseConfigured, readViteEnv, type BackendEnv } from './env';

/**
 * @param envOverride Inject an explicit env (tests) instead of reading
 * `import.meta.env`. Production call sites should omit this.
 */
export function createBackend(envOverride?: BackendEnv): Backend {
  const env = envOverride ?? readViteEnv();
  if (isSupabaseConfigured(env)) {
    const client = getSupabaseClient(env.VITE_SUPABASE_URL!, env.VITE_SUPABASE_ANON_KEY!);
    return { auth: new SupabaseAuth(client), docStore: new SupabaseDocStore(client), spaceStore: new SupabaseSpaceStore(client), shareStore: new SupabaseShareStore(client), feedbackStore: new SupabaseFeedbackStore(client), imageStore: new SupabaseImageStore(client), commentStore: new SupabaseCommentStore(client), notificationStore: new SupabaseNotificationStore(client), mode: 'supabase' };
  }
  return { auth: new LocalAuth(), docStore: new LocalDocStore(), spaceStore: new LocalSpaceStore(), shareStore: new LocalShareStore(), feedbackStore: new LocalFeedbackStore(), imageStore: new LocalImageStore(), commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(), mode: 'local' };
}

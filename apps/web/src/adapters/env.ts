// Reads the two Supabase env vars Vite exposes to client code
// (`VITE_`-prefixed, per Vite convention — see apps/web/.env.example).
// Isolated in its own module so `factory.ts` can be unit-tested by passing an
// explicit override instead of depending on the real `import.meta.env`.

export interface BackendEnv {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
}

export function readViteEnv(): BackendEnv {
  try {
    // Vite statically replaces `import.meta.env.VITE_*` at build time; the cast
    // avoids depending on the `vite/client` ambient types leaking into this
    // otherwise-plain-TS module's public surface.
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
    return { VITE_SUPABASE_URL: env.VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY: env.VITE_SUPABASE_ANON_KEY };
  } catch {
    return {};
  }
}

export function isSupabaseConfigured(env: BackendEnv): boolean {
  return Boolean(env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY);
}

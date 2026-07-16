import { describe, expect, it } from 'vitest';
import { createBackend } from './factory';
import { LocalAuth } from './local/localAuth';
import { LocalDocStore } from './local/localDocStore';
import { LocalSpaceStore } from './local/localSpaceStore';
import { SupabaseAuth } from './supabase/supabaseAuth';
import { SupabaseDocStore } from './supabase/supabaseDocStore';
import { SupabaseSpaceStore } from './supabase/supabaseSpaceStore';

describe('createBackend', () => {
  it('selects the Local adapter when no Supabase env is configured', () => {
    const backend = createBackend({});
    expect(backend.mode).toBe('local');
    expect(backend.auth).toBeInstanceOf(LocalAuth);
    expect(backend.docStore).toBeInstanceOf(LocalDocStore);
    expect(backend.spaceStore).toBeInstanceOf(LocalSpaceStore);
  });

  it('selects the Local adapter when only one of the two env vars is set', () => {
    expect(createBackend({ VITE_SUPABASE_URL: 'https://x.supabase.co' }).mode).toBe('local');
    expect(createBackend({ VITE_SUPABASE_ANON_KEY: 'anon-key' }).mode).toBe('local');
  });

  it('selects the Supabase adapter when both env vars are configured', () => {
    const backend = createBackend({ VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_ANON_KEY: 'anon-key' });
    expect(backend.mode).toBe('supabase');
    expect(backend.auth).toBeInstanceOf(SupabaseAuth);
    expect(backend.docStore).toBeInstanceOf(SupabaseDocStore);
    expect(backend.spaceStore).toBeInstanceOf(SupabaseSpaceStore);
  });
});

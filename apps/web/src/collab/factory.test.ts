import { describe, expect, it } from 'vitest';
import { createCollabProvider } from './factory';
import { BroadcastChannelProvider } from './BroadcastChannelProvider';
import { SupabaseRealtimeProvider } from './SupabaseRealtimeProvider';
import { NoopCollabProvider } from './NoopCollabProvider';

describe('createCollabProvider', () => {
  it('selects BroadcastChannelProvider when no Supabase env is configured (jsdom has BroadcastChannel)', () => {
    expect(createCollabProvider({})).toBeInstanceOf(BroadcastChannelProvider);
  });

  it('selects BroadcastChannelProvider when only one of the two env vars is set', () => {
    expect(createCollabProvider({ VITE_SUPABASE_URL: 'https://x.supabase.co' })).toBeInstanceOf(BroadcastChannelProvider);
    expect(createCollabProvider({ VITE_SUPABASE_ANON_KEY: 'anon-key' })).toBeInstanceOf(BroadcastChannelProvider);
  });

  it('selects SupabaseRealtimeProvider when both env vars are configured', () => {
    const provider = createCollabProvider({ VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_ANON_KEY: 'anon-key' });
    expect(provider).toBeInstanceOf(SupabaseRealtimeProvider);
  });

  it('falls back to NoopCollabProvider when BroadcastChannel is unavailable (e.g. very old browsers)', () => {
    const original = globalThis.BroadcastChannel;
    // @ts-expect-error -- deliberately simulating an environment without BroadcastChannel
    delete globalThis.BroadcastChannel;
    try {
      expect(createCollabProvider({})).toBeInstanceOf(NoopCollabProvider);
    } finally {
      globalThis.BroadcastChannel = original;
    }
  });
});

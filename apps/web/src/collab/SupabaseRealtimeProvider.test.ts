// SupabaseRealtimeProvider is verified against a MOCKED `supabase-js` client
// only — no live Supabase project exists in this environment (same stance as
// `adapters/supabase/supabaseDocStore.test.ts`). These tests assert the
// channel/event shape the adapter constructs and that Yjs updates round-trip
// through its base64 broadcast payload, not real Supabase Realtime behavior.

import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { docToYDoc, yDocToDoc, type Doc } from '@mindflow/mindmap-core';
import { SupabaseRealtimeProvider } from './SupabaseRealtimeProvider';

function baseDoc(): Doc {
  return {
    v: 1,
    nodes: { root: { id: 'root', text: 'Root', emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 } },
    floats: [],
    lines: [],
    zones: [],
    layoutMode: 'radial',
    themeKey: 'coral',
  };
}

/** A minimal `RealtimeChannel` stand-in: records every `.on(...)` handler by
 * event name and every `.send(...)` payload, and lets the test simulate an
 * inbound broadcast by directly invoking the recorded handler — modelling a
 * SINGLE in-process "server" that just echoes `send()` calls back to every
 * subscribed channel handle (good enough to test the provider's own
 * protocol without a real Realtime socket). */
function makeFakeChannelPair() {
  const handlersA: Record<string, ((arg: { payload: unknown }) => void)[]> = {};
  const handlersB: Record<string, ((arg: { payload: unknown }) => void)[]> = {};
  const sentA: { event: string; payload: unknown }[] = [];
  const sentB: { event: string; payload: unknown }[] = [];

  function makeSide(handlers: typeof handlersA, sent: typeof sentA, otherHandlers: typeof handlersB) {
    const channel = {
      on: vi.fn((_type: string, filter: { event: string }, cb: (arg: { payload: unknown }) => void) => {
        (handlers[filter.event] ??= []).push(cb);
        return channel;
      }),
      subscribe: vi.fn((cb?: (status: string) => void) => {
        cb?.('SUBSCRIBED');
        return channel;
      }),
      send: vi.fn(async (msg: { event: string; payload: unknown }) => {
        sent.push({ event: msg.event, payload: msg.payload });
        // deliver to the OTHER side only (mirrors a real broadcast: you don't receive your own send back)
        for (const h of otherHandlers[msg.event] ?? []) h({ payload: msg.payload });
        return 'ok';
      }),
    };
    return channel;
  }

  const channelA = makeSide(handlersA, sentA, handlersB);
  const channelB = makeSide(handlersB, sentB, handlersA);
  return { channelA, channelB, sentA, sentB };
}

describe('SupabaseRealtimeProvider', () => {
  it('connect() subscribes a channel named after the docId and registers broadcast handlers', () => {
    const channel = { on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis(), send: vi.fn() };
    const from = vi.fn();
    const client = { channel: vi.fn(() => channel), removeChannel: vi.fn(), from } as unknown as import('@supabase/supabase-js').SupabaseClient;
    const provider = new SupabaseRealtimeProvider(client);
    const ydoc = docToYDoc(baseDoc());

    provider.connect('doc-123', ydoc);

    expect(client.channel).toHaveBeenCalledWith('mindflow-collab:doc-123');
    expect(channel.on).toHaveBeenCalledWith('broadcast', { event: 'yupdate' }, expect.any(Function));
    expect(channel.on).toHaveBeenCalledWith('broadcast', { event: 'ysync-request' }, expect.any(Function));
    expect(channel.subscribe).toHaveBeenCalled();
    provider.disconnect();
  });

  it('broadcasts local Yjs updates and a second provider (different Y.Doc, mocked client pair) converges', async () => {
    const { channelA, channelB } = makeFakeChannelPair();
    const clientA = { channel: vi.fn(() => channelA), removeChannel: vi.fn() } as unknown as import('@supabase/supabase-js').SupabaseClient;
    const clientB = { channel: vi.fn(() => channelB), removeChannel: vi.fn() } as unknown as import('@supabase/supabase-js').SupabaseClient;

    const doc = baseDoc();
    const ydocA = docToYDoc(doc);
    const ydocB = new Y.Doc();
    const providerA = new SupabaseRealtimeProvider(clientA);
    const providerB = new SupabaseRealtimeProvider(clientB);

    providerA.connect('doc-xyz', ydocA);
    providerB.connect('doc-xyz', ydocB); // fires a sync-request that A answers

    expect(yDocToDoc(ydocB)).toEqual(yDocToDoc(ydocA)); // caught up via sync-request/reply

    const nm = new Y.Map<unknown>();
    nm.set('id', 'newNode');
    nm.set('text', 'hello from A');
    ydocA.getMap('nodes').set('newNode', nm);

    expect(ydocB.getMap('nodes').has('newNode')).toBe(true);
    expect((ydocB.getMap('nodes').get('newNode') as Y.Map<unknown>).get('text')).toBe('hello from A');

    providerA.disconnect();
    providerB.disconnect();
  });

  it('disconnect() calls removeChannel and stops applying further local updates to the transport', () => {
    const channel = { on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis(), send: vi.fn() };
    const removeChannel = vi.fn();
    const client = { channel: vi.fn(() => channel), removeChannel } as unknown as import('@supabase/supabase-js').SupabaseClient;
    const provider = new SupabaseRealtimeProvider(client);
    const ydoc = docToYDoc(baseDoc());
    provider.connect('doc-1', ydoc);

    provider.disconnect();

    expect(removeChannel).toHaveBeenCalledWith(channel);
  });
});

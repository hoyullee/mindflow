// SupabaseRealtimeProvider is verified against a MOCKED `supabase-js` client
// only — no live Supabase project exists in this environment (same stance as
// `adapters/supabase/supabaseDocStore.test.ts`). These tests assert the
// channel/event shape the adapter constructs and that Yjs updates round-trip
// through its base64 broadcast payload, not real Supabase Realtime behavior.

import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { docToYDoc, yDocToDoc, type Doc } from '@mindflow/mindmap-core';
import { SupabaseRealtimeProvider } from './SupabaseRealtimeProvider';
import type { CollabStatus } from './ports';

/** private 채널 구독 전에 provider가 부르는 `realtime.setAuth()` — 실제
 * supabase-js 클라이언트에는 항상 있다. */
function realtimeMock() {
  return { setAuth: vi.fn(async () => undefined) };
}

/** 구독 직후 provider가 sync-request를 보내고 그 ack를 기다리므로(쓰기 권한 확인),
 * 단정 전에 마이크로태스크를 한 번 비워 준다. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

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
    const client = { channel: vi.fn(() => channel), removeChannel: vi.fn(), from, realtime: realtimeMock() } as unknown as import('@supabase/supabase-js').SupabaseClient;
    const provider = new SupabaseRealtimeProvider(client);
    const ydoc = docToYDoc(baseDoc());

    provider.connect('doc-123', ydoc);

    // `private: true`가 빠지면 채널이 누구에게나 열린다(anon 키는 번들에 공개) —
    // Realtime Authorization 정책(0009)을 타기 위한 필수 인자다.
    expect(client.channel).toHaveBeenCalledWith('mindflow-collab:doc-123', { config: { private: true, broadcast: { ack: true } } });
    // private 채널은 소켓이 사용자 JWT를 들고 있어야 통과한다 — 구독 전에 맞춰 준다.
    expect((client as unknown as { realtime: { setAuth: ReturnType<typeof vi.fn> } }).realtime.setAuth).toHaveBeenCalled();
    expect(channel.on).toHaveBeenCalledWith('broadcast', { event: 'yupdate' }, expect.any(Function));
    expect(channel.on).toHaveBeenCalledWith('broadcast', { event: 'ysync-request' }, expect.any(Function));
    expect(channel.subscribe).toHaveBeenCalled();
    provider.disconnect();
  });

  it('broadcasts local Yjs updates and a second provider (different Y.Doc, mocked client pair) converges', async () => {
    const { channelA, channelB } = makeFakeChannelPair();
    const clientA = { channel: vi.fn(() => channelA), removeChannel: vi.fn(), realtime: realtimeMock() } as unknown as import('@supabase/supabase-js').SupabaseClient;
    const clientB = { channel: vi.fn(() => channelB), removeChannel: vi.fn(), realtime: realtimeMock() } as unknown as import('@supabase/supabase-js').SupabaseClient;

    const doc = baseDoc();
    const ydocA = docToYDoc(doc);
    const ydocB = new Y.Doc();
    const providerA = new SupabaseRealtimeProvider(clientA);
    const providerB = new SupabaseRealtimeProvider(clientB);

    providerA.connect('doc-xyz', ydocA);
    providerB.connect('doc-xyz', ydocB); // fires a sync-request that A answers
    await flush();

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
    const client = { channel: vi.fn(() => channel), removeChannel, realtime: realtimeMock() } as unknown as import('@supabase/supabase-js').SupabaseClient;
    const provider = new SupabaseRealtimeProvider(client);
    const ydoc = docToYDoc(baseDoc());
    provider.connect('doc-1', ydoc);

    provider.disconnect();

    expect(removeChannel).toHaveBeenCalledWith(channel);
  });

  describe('awareness (presence) relay', () => {
    it('connect() also registers the awareness broadcast/sync-request handlers', () => {
      const channel = { on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis(), send: vi.fn() };
      const client = { channel: vi.fn(() => channel), removeChannel: vi.fn(), realtime: realtimeMock() } as unknown as import('@supabase/supabase-js').SupabaseClient;
      const provider = new SupabaseRealtimeProvider(client);
      const ydoc = docToYDoc(baseDoc());

      provider.connect('doc-aware', ydoc);

      expect(channel.on).toHaveBeenCalledWith('broadcast', { event: 'yaware' }, expect.any(Function));
      expect(channel.on).toHaveBeenCalledWith('broadcast', { event: 'yaware-sync-request' }, expect.any(Function));
      provider.disconnect();
    });

    it('relays a local awareness state to a second provider (mocked channel pair) and converges', async () => {
      const { channelA, channelB } = makeFakeChannelPair();
      const clientA = { channel: vi.fn(() => channelA), removeChannel: vi.fn(), realtime: realtimeMock() } as unknown as import('@supabase/supabase-js').SupabaseClient;
      const clientB = { channel: vi.fn(() => channelB), removeChannel: vi.fn(), realtime: realtimeMock() } as unknown as import('@supabase/supabase-js').SupabaseClient;

      const providerA = new SupabaseRealtimeProvider(clientA);
      const providerB = new SupabaseRealtimeProvider(clientB);
      providerA.connect('doc-aware-xyz', docToYDoc(baseDoc()));
      providerB.connect('doc-aware-xyz', new Y.Doc()); // fires sync-request/awareness-sync-request that A answers
      await flush();

      const awarenessA = providerA.getAwareness()!;
      const awarenessB = providerB.getAwareness()!;
      awarenessA.setLocalStateField('user', { name: 'Grape Owl', color: '#8a6bd1' });

      expect(awarenessB.getStates().has(awarenessA.clientID)).toBe(true);
      expect((awarenessB.getStates().get(awarenessA.clientID) as { user: { name: string } }).user.name).toBe('Grape Owl');

      providerA.disconnect();
      providerB.disconnect();
    });

    it("disconnect() broadcasts this client's departure to a connected peer (mocked channel pair)", async () => {
      const { channelA, channelB } = makeFakeChannelPair();
      const clientA = { channel: vi.fn(() => channelA), removeChannel: vi.fn(), realtime: realtimeMock() } as unknown as import('@supabase/supabase-js').SupabaseClient;
      const clientB = { channel: vi.fn(() => channelB), removeChannel: vi.fn(), realtime: realtimeMock() } as unknown as import('@supabase/supabase-js').SupabaseClient;

      const providerA = new SupabaseRealtimeProvider(clientA);
      const providerB = new SupabaseRealtimeProvider(clientB);
      providerA.connect('doc-aware-leave', docToYDoc(baseDoc()));
      providerB.connect('doc-aware-leave', new Y.Doc());
      await flush();

      const awarenessA = providerA.getAwareness()!;
      const awarenessB = providerB.getAwareness()!;
      awarenessA.setLocalStateField('user', { name: 'Ocean Whale', color: '#3f8fd0' });
      expect(awarenessB.getStates().has(awarenessA.clientID)).toBe(true);

      providerA.disconnect();

      expect(awarenessB.getStates().has(awarenessA.clientID)).toBe(false);
      providerB.disconnect();
    });

    it('getAwareness() returns null before connect() and after disconnect()', () => {
      const channel = { on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis(), send: vi.fn() };
      const client = { channel: vi.fn(() => channel), removeChannel: vi.fn(), realtime: realtimeMock() } as unknown as import('@supabase/supabase-js').SupabaseClient;
      const provider = new SupabaseRealtimeProvider(client);
      expect(provider.getAwareness()).toBeNull();
      provider.connect('doc-aware-lifecycle', docToYDoc(baseDoc()));
      expect(provider.getAwareness()).not.toBeNull();
      provider.disconnect();
      expect(provider.getAwareness()).toBeNull();
    });
  });

  // 배포 후 제보: 공유는 됐는데 **편집·접속자·커서가 한꺼번에** 오지 않았다. 채널
  // 하나가 죽으면 셋이 같이 죽고, 아무도 구독 상태를 보지 않아 "혼자 있는 것"과
  // 구분되지 않았다. 그래서 (1) 죽지 않게 폴백하고 (2) 상태를 반드시 올려 보낸다.
  describe('인증된 채널이 거부될 때', () => {
    /** subscribe 콜백을 즉시 호출하지 않고 붙잡아 두는 채널 — 테스트가 원하는
     * 시점에 상태를 흘려 보낼 수 있다. */
    function makeManualChannel(sendResult: 'ok' | 'error' = 'ok') {
      let cb: ((status: string) => void) | undefined;
      const channel = {
        on: vi.fn(() => channel),
        subscribe: vi.fn((c?: (status: string) => void) => {
          cb = c;
          return channel;
        }),
        send: vi.fn(async () => sendResult),
        fire: (status: string) => cb?.(status),
      };
      return channel;
    }

    function setup(channels: ReturnType<typeof makeManualChannel>[]) {
      let i = 0;
      const configs: unknown[] = [];
      const client = {
        channel: vi.fn((_name: string, opts: unknown) => {
          configs.push(opts);
          return channels[Math.min(i++, channels.length - 1)];
        }),
        removeChannel: vi.fn(),
        realtime: realtimeMock(),
      } as unknown as import('@supabase/supabase-js').SupabaseClient;
      const statuses: CollabStatus[] = [];
      const provider = new SupabaseRealtimeProvider(client);
      provider.connect('doc-fb', docToYDoc(baseDoc()), (s) => statuses.push(s));
      return { client, provider, statuses, configs };
    }

    it('구독이 거부되면 공개 채널로 폴백하고 그 사실을 상태로 알린다 (협업이 통째로 죽지 않는다)', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const privateCh = makeManualChannel();
      const publicCh = makeManualChannel();
      const { client, provider, statuses, configs } = setup([privateCh, publicCh]);

      privateCh.fire('CHANNEL_ERROR');
      expect(configs[1]).toEqual({ config: { private: false, broadcast: { ack: true } } });
      publicCh.fire('SUBSCRIBED');
      await flush();

      expect(statuses).toEqual(['connected-insecure']);
      expect(warn).toHaveBeenCalled(); // 조치 방법을 콘솔에 남긴다
      // 폴백한 채널로 실제 동기화 요청까지 나갔다 = 협업이 살아 있다
      expect(publicCh.send).toHaveBeenCalledWith(expect.objectContaining({ event: 'ysync-request' }));
      expect(client.removeChannel).toHaveBeenCalledWith(privateCh);
      provider.disconnect();
      warn.mockRestore();
    });

    it('구독은 되지만 브로드캐스트가 거부되면(읽기만 허용) 그것도 잡아 폴백한다', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const privateCh = makeManualChannel('error'); // 구독은 OK, send는 정책에 막힘
      const publicCh = makeManualChannel('ok');
      const { provider, statuses } = setup([privateCh, publicCh]);

      privateCh.fire('SUBSCRIBED');
      await flush();
      publicCh.fire('SUBSCRIBED');
      await flush();

      // private 채널에서 'connected'라고 보고한 적이 없어야 한다 — 보냈다면 그게
      // 바로 "붙은 척하고 조용히 죽은" 그 상태다.
      expect(statuses).toEqual(['connected-insecure']);
      provider.disconnect();
      warn.mockRestore();
    });

    it('공개 채널로도 못 붙으면 offline로 보고한다 (UI가 알린다)', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const privateCh = makeManualChannel();
      const publicCh = makeManualChannel();
      const { provider, statuses } = setup([privateCh, publicCh]);

      privateCh.fire('TIMED_OUT');
      publicCh.fire('CHANNEL_ERROR');
      await flush();

      expect(statuses).toEqual(['offline']);
      provider.disconnect();
      warn.mockRestore();
    });

    it('정책이 제대로 있으면 폴백하지 않고 connected로 보고한다', async () => {
      const privateCh = makeManualChannel('ok');
      const { client, provider, statuses } = setup([privateCh]);

      privateCh.fire('SUBSCRIBED');
      await flush();

      expect(statuses).toEqual(['connected']);
      expect(client.channel).toHaveBeenCalledTimes(1); // 공개 채널을 만들지 않았다
      provider.disconnect();
    });
  });
});

// SupabaseRealtimeProvider is verified against a MOCKED `supabase-js` client
// only — no live Supabase project exists in this environment (same stance as
// `adapters/supabase/supabaseDocStore.test.ts`). These tests assert the
// channel/event shape the adapter constructs and that Yjs updates round-trip
// through its base64 broadcast payload, not real Supabase Realtime behavior.

import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { ROOT_ID, addNode, docToYDoc, removeNode, yDocToDoc, type Doc } from '@mindflow/mindmap-core';
import { SupabaseRealtimeProvider } from './SupabaseRealtimeProvider';
import type { CollabStatus } from './ports';

/** private 채널 구독 전에 provider가 부르는 `realtime.setAuth()` — 실제
 * supabase-js 클라이언트에는 항상 있다. */
function realtimeMock() {
  return { setAuth: vi.fn(async () => undefined) };
}

/** 구독이 `setAuth()` await 뒤로 미뤄졌고(레이스 수정), 그 뒤 ack 확인까지 있으므로
 * 단정 전에 마이크로태스크를 넉넉히 비워 준다. */
async function flush(): Promise<void> {
  for (let i = 0; i < 12; i++) await Promise.resolve();
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
  // 회선 차단 스위치 — Realtime은 끊긴 동안의 브로드캐스트를 재전송하지 않으므로,
  // "상대가 못 받은 메시지"를 이걸로 재현한다(발신은 성공한 것처럼 보인다 — 실제
  // REST 폴백 발신과 같은 모양).
  const wire = { aToB: true, bToA: true };

  function makeSide(handlers: typeof handlersA, sent: typeof sentA, otherHandlers: typeof handlersB, deliver: () => boolean) {
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
        if (!deliver()) return 'ok';
        // deliver to the OTHER side only (mirrors a real broadcast: you don't receive your own send back)
        for (const h of otherHandlers[msg.event] ?? []) h({ payload: msg.payload });
        return 'ok';
      }),
    };
    return channel;
  }

  const channelA = makeSide(handlersA, sentA, handlersB, () => wire.aToB);
  const channelB = makeSide(handlersB, sentB, handlersA, () => wire.bToA);
  return { channelA, channelB, sentA, sentB, wire };
}

describe('SupabaseRealtimeProvider', () => {
  it('connect() subscribes a channel named after the docId and registers broadcast handlers', async () => {
    const channel = { on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis(), send: vi.fn() };
    const from = vi.fn();
    const client = { channel: vi.fn(() => channel), removeChannel: vi.fn(), from, realtime: realtimeMock() } as unknown as import('@supabase/supabase-js').SupabaseClient;
    const provider = new SupabaseRealtimeProvider(client);
    const ydoc = docToYDoc(baseDoc());

    provider.connect('doc-123', ydoc);
    await flush();

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

  it('disconnect() calls removeChannel and stops applying further local updates to the transport', async () => {
    const channel = { on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis(), send: vi.fn() };
    const removeChannel = vi.fn();
    const client = { channel: vi.fn(() => channel), removeChannel, realtime: realtimeMock() } as unknown as import('@supabase/supabase-js').SupabaseClient;
    const provider = new SupabaseRealtimeProvider(client);
    const ydoc = docToYDoc(baseDoc());
    provider.connect('doc-1', ydoc);
    await flush();

    provider.disconnect();

    expect(removeChannel).toHaveBeenCalledWith(channel);
  });

  describe('awareness (presence) relay', () => {
    it('connect() also registers the awareness broadcast/sync-request handlers', async () => {
      const channel = { on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis(), send: vi.fn() };
      const client = { channel: vi.fn(() => channel), removeChannel: vi.fn(), realtime: realtimeMock() } as unknown as import('@supabase/supabase-js').SupabaseClient;
      const provider = new SupabaseRealtimeProvider(client);
      const ydoc = docToYDoc(baseDoc());

      provider.connect('doc-aware', ydoc);
      await flush();

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
  // 제보(3차): 커서는 서로 보이는데 **편집만** 안 보인다. Realtime은 끊긴 동안의
  // 브로드캐스트를 재전송하지 않아, Yjs 업데이트 하나를 놓치면 이후 업데이트 전부가
  // "의존 연산 없음"으로 보류된다(커서는 절대 상태라 다음 움직임에 저절로 복구 —
  // 그래서 증상이 갈라진다). 주기 상태 벡터(SV) 교환이 그 구멍을 메운다.
  describe('메시지 유실 자가 치유 (주기 상태 벡터 동기화)', () => {
    function connectPair() {
      const pair = makeFakeChannelPair();
      const clientA = { channel: vi.fn(() => pair.channelA), removeChannel: vi.fn(), realtime: realtimeMock() } as unknown as import('@supabase/supabase-js').SupabaseClient;
      const clientB = { channel: vi.fn(() => pair.channelB), removeChannel: vi.fn(), realtime: realtimeMock() } as unknown as import('@supabase/supabase-js').SupabaseClient;
      const doc = baseDoc();
      // 삭제 치유 테스트가 지울 대상 — 이 파일의 baseDoc은 루트 하나뿐이다
      doc.nodes.a = { id: 'a', text: 'Child A', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 100, y: 0 };
      doc.nodes.root = { ...doc.nodes.root!, children: ['a'] };
      const ydocA = docToYDoc(doc);
      const ydocB = docToYDoc(doc); // 실제 상황: 두 기기가 같은 문서를 각자 심는다
      const providerA = new SupabaseRealtimeProvider(clientA);
      const providerB = new SupabaseRealtimeProvider(clientB);
      providerA.connect('doc-heal', ydocA);
      providerB.connect('doc-heal', ydocB);
      return { pair, ydocA, ydocB, providerA, providerB };
    }

    it('유실로 보류된 편집을 다음 주기 SV 교환이 메운다 (커서만 살고 편집이 죽던 그 증상)', async () => {
      vi.useFakeTimers();
      try {
        const { pair, ydocA, ydocB, providerA, providerB } = connectPair();
        await flush();
        expect(yDocToDoc(ydocB)).toEqual(yDocToDoc(ydocA)); // 합류 수렴(diff 교환)

        // A→B 회선이 잠깐 죽은 사이 A가 편집 — B는 이 업데이트를 영영 못 받는다
        pair.wire.aToB = false;
        addNode(ydocA, 'lost', { id: 'lost', text: '유실된 편집', emoji: '', parent: ROOT_ID, children: [], collapsed: false, color: null, x: 1, y: 1 });
        pair.wire.aToB = true;
        // 회선 복구 후의 편집은 도착하지만, 앞 연산이 없어 B에서 **보류**된다
        addNode(ydocA, 'after', { id: 'after', text: '이후 편집', emoji: '', parent: ROOT_ID, children: [], collapsed: false, color: null, x: 2, y: 2 });
        await flush();
        expect(yDocToDoc(ydocB).nodes.lost).toBeUndefined();
        expect(yDocToDoc(ydocB).nodes.after).toBeUndefined(); // 보류 — 예전엔 여기서 영원히 멈췄다

        // 한 주기 뒤: B의 SV 방송 → A가 빠진 연산의 diff를 돌려준다
        vi.advanceTimersByTime(15_000);
        await flush();
        expect(yDocToDoc(ydocB).nodes.lost?.text).toBe('유실된 편집');
        expect(yDocToDoc(ydocB).nodes.after?.text).toBe('이후 편집');
        expect(yDocToDoc(ydocB)).toEqual(yDocToDoc(ydocA));

        providerA.disconnect();
        providerB.disconnect();
      } finally {
        vi.useRealTimers();
      }
    });

    it('삭제만 놓친 경우도 메운다 (삭제는 상태 벡터에 잡히지 않는다 — delete set 경로)', async () => {
      vi.useFakeTimers();
      try {
        const { pair, ydocA, ydocB, providerA, providerB } = connectPair();
        await flush();

        pair.wire.aToB = false;
        removeNode(ydocA, 'a'); // 삭제는 새 struct를 만들지 않는다
        pair.wire.aToB = true;
        await flush();
        expect(yDocToDoc(ydocB).nodes.a).toBeDefined(); // 아직 못 받았다

        vi.advanceTimersByTime(15_000);
        await flush();
        expect(yDocToDoc(ydocB).nodes.a).toBeUndefined(); // diff의 delete set으로 복구
        expect(yDocToDoc(ydocB)).toEqual(yDocToDoc(ydocA));

        providerA.disconnect();
        providerB.disconnect();
      } finally {
        vi.useRealTimers();
      }
    });

    it('join 밖에서는 send하지 않는다 — REST 폴백 스팸과 반쪽 발신의 원인이었다', async () => {
      // subscribe 콜백을 아예 부르지 않는 채널 = 소켓이 끊겨 join하지 못한 상태
      const channel = { on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis(), send: vi.fn(async () => 'ok') };
      const client = { channel: vi.fn(() => channel), removeChannel: vi.fn(), realtime: realtimeMock() } as unknown as import('@supabase/supabase-js').SupabaseClient;
      const provider = new SupabaseRealtimeProvider(client);
      const ydoc = docToYDoc(baseDoc());
      provider.connect('doc-nojoin', ydoc);
      await flush();

      addNode(ydoc, 'n1', { id: 'n1', text: 'x', emoji: '', parent: ROOT_ID, children: [], collapsed: false, color: null, x: 0, y: 0 });
      await flush();

      expect(channel.send).not.toHaveBeenCalled();
      provider.disconnect();
    });
  });

  describe('인증된 채널이 거부될 때', () => {
    /** subscribe 콜백을 즉시 호출하지 않고 붙잡아 두는 채널 — 테스트가 원하는
     * 시점에 상태를 흘려 보낼 수 있다. fire는 flush까지 겸한다(구독이 setAuth
     * await 뒤로 미뤄져 있어서, 흘려 보낸 상태의 후속 처리도 비동기다). */
    function makeManualChannel(sendResult: 'ok' | 'error' | 'timed out' = 'ok') {
      let cb: ((status: string) => void) | undefined;
      const channel = {
        on: vi.fn(() => channel),
        subscribe: vi.fn((c?: (status: string) => void) => {
          cb = c;
          return channel;
        }),
        send: vi.fn(async () => sendResult),
        fire: async (status: string) => {
          cb?.(status);
          await flush();
        },
      };
      return channel;
    }

    async function setup(channels: ReturnType<typeof makeManualChannel>[]) {
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
      await flush(); // 첫(private) 구독이 setAuth await 뒤에 만들어진다
      return { client, provider, statuses, configs };
    }

    it('구독이 거부되면 private 재시도 → 공개 채널 폴백, 그 사실을 상태로 알린다', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const priv1 = makeManualChannel();
      const priv2 = makeManualChannel();
      const publicCh = makeManualChannel();
      const { client, provider, statuses, configs } = await setup([priv1, priv2, publicCh]);

      await priv1.fire('CHANNEL_ERROR');
      // 일시 오류로 한 탭만 강등돼 피어들이 다른 채널에 갈라지지 않도록, 강등 전에
      // private을 한 번 더 시도한다.
      expect(configs[1]).toEqual({ config: { private: true, broadcast: { ack: true } } });
      await priv2.fire('CHANNEL_ERROR');
      expect(configs[2]).toEqual({ config: { private: false, broadcast: { ack: true } } });
      await publicCh.fire('SUBSCRIBED');

      expect(statuses).toEqual(['connected-insecure']);
      expect(warn).toHaveBeenCalled(); // 조치 방법을 콘솔에 남긴다
      // 폴백한 채널로 실제 동기화 요청까지 나갔다 = 협업이 살아 있다
      expect(publicCh.send).toHaveBeenCalledWith(expect.objectContaining({ event: 'ysync-request' }), expect.anything());
      expect(client.removeChannel).toHaveBeenCalledWith(priv1);
      expect(client.removeChannel).toHaveBeenCalledWith(priv2);
      provider.disconnect();
      warn.mockRestore();
    });

    it('구독은 되지만 브로드캐스트가 명시적으로 거부되면(읽기만 허용) 그것도 잡아 폴백한다', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const privateCh = makeManualChannel('error'); // 구독은 OK, send는 정책에 막힘
      const publicCh = makeManualChannel('ok');
      const { provider, statuses } = await setup([privateCh, publicCh]);

      await privateCh.fire('SUBSCRIBED');
      await publicCh.fire('SUBSCRIBED');

      // private 채널에서 'connected'라고 보고한 적이 없어야 한다 — 보냈다면 그게
      // 바로 "붙은 척하고 조용히 죽은" 그 상태다.
      expect(statuses).toEqual(['connected-insecure']);
      provider.disconnect();
      warn.mockRestore();
    });

    it("ack가 시간 초과면 강등하지 않는다 — ack 미지원/지연 서버에서 전원이 공개 채널로 떨어졌던 회귀", async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const privateCh = makeManualChannel('timed out');
      const { client, provider, statuses } = await setup([privateCh]);

      await privateCh.fire('SUBSCRIBED');

      expect(statuses).toEqual(['connected']); // 정책 거부(error)가 아니면 private 유지
      expect(client.channel).toHaveBeenCalledTimes(1);
      provider.disconnect();
      warn.mockRestore();
    });

    it('공개 채널로도 못 붙으면 offline로 보고한다 (UI가 알린다)', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const priv1 = makeManualChannel();
      const priv2 = makeManualChannel();
      const publicCh = makeManualChannel();
      const { provider, statuses } = await setup([priv1, priv2, publicCh]);

      await priv1.fire('TIMED_OUT');
      await priv2.fire('TIMED_OUT');
      await publicCh.fire('CHANNEL_ERROR');

      expect(statuses).toEqual(['offline']);
      provider.disconnect();
      warn.mockRestore();
    });

    it('정책이 제대로 있으면 폴백하지 않고 connected로 보고한다', async () => {
      const privateCh = makeManualChannel('ok');
      const { client, provider, statuses } = await setup([privateCh]);

      // 구독 전에 소켓에 사용자 JWT를 확실히 실었다(await) — 이 레이스가 한 탭만
      // 강등시켜 피어들을 서로 다른 채널로 갈라놓던 원인이었다.
      expect((client as unknown as { realtime: { setAuth: ReturnType<typeof vi.fn> } }).realtime.setAuth).toHaveBeenCalled();
      await privateCh.fire('SUBSCRIBED');

      expect(statuses).toEqual(['connected']);
      expect(client.channel).toHaveBeenCalledTimes(1); // 공개 채널을 만들지 않았다
      provider.disconnect();
    });

    it('구독을 기다리는 사이 disconnect되면 죽은 세션의 채널을 만들지 않는다', async () => {
      const privateCh = makeManualChannel();
      let i = 0;
      const client = {
        channel: vi.fn(() => {
          i++;
          return privateCh;
        }),
        removeChannel: vi.fn(),
        realtime: realtimeMock(),
      } as unknown as import('@supabase/supabase-js').SupabaseClient;
      const provider = new SupabaseRealtimeProvider(client);
      provider.connect('doc-gone', docToYDoc(baseDoc()));
      provider.disconnect(); // setAuth await가 끝나기 전에 끊는다
      await flush();

      expect(i).toBe(0); // continuation이 세대 검사에 걸려 채널을 만들지 않았다
    });
  });
});
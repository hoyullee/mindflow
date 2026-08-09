// SupabaseRealtimeProvider is verified against a MOCKED `supabase-js` client
// only — no live Supabase project exists in this environment (same stance as
// `adapters/supabase/supabaseDocStore.test.ts`). These tests assert the
// channel/event shape the adapter constructs and that Yjs updates round-trip
// through its base64 broadcast payload, not real Supabase Realtime behavior.

import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { ROOT_ID, addNode, docToYDoc, removeNode, setNodeField, yDocToDoc, type Doc } from '@mindflow/mindmap-core';
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
    // 인자를 받는 시그니처로 둔다 — 테스트가 `send.mock.calls[i][0].event`로 무엇을
    // 보냈는지 확인하는데, 인자 없는 시그니처면 calls의 타입이 빈 튜플이 된다.
    send: vi.fn(async (...args: unknown[]) => {
      void args;
      return sendResult;
    }),
    track: vi.fn(async () => 'ok'),
    fire: async (status: string) => {
      cb?.(status);
      await flush();
    },
  };
  return channel;
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
      track: vi.fn(async () => 'ok'),
    };
    return channel;
  }

  const channelA = makeSide(handlersA, sentA, handlersB, () => wire.aToB);
  const channelB = makeSide(handlersB, sentB, handlersA, () => wire.bToA);
  return { channelA, channelB, sentA, sentB, wire };
}

describe('SupabaseRealtimeProvider', () => {
  it('connect() subscribes a channel named after the docId and registers broadcast handlers', async () => {
    const channel = { on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis(), send: vi.fn(), track: vi.fn(async () => 'ok') };
    const from = vi.fn();
    const client = { channel: vi.fn(() => channel), removeChannel: vi.fn(), from, realtime: realtimeMock() } as unknown as import('@supabase/supabase-js').SupabaseClient;
    const provider = new SupabaseRealtimeProvider(client);
    const ydoc = docToYDoc(baseDoc());

    provider.connect('doc-123', ydoc);
    await flush();

    // `private: true`가 빠지면 채널이 누구에게나 열린다(anon 키는 번들에 공개) —
    // Realtime Authorization 정책(0009)을 타기 위한 필수 인자다.
    expect(client.channel).toHaveBeenCalledWith('mindflow-collab:doc-123', { config: { private: true, broadcast: { ack: true }, presence: { key: expect.any(String) } } });
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
    const channel = { on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis(), send: vi.fn(), track: vi.fn(async () => 'ok') };
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
      const channel = { on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis(), send: vi.fn(), track: vi.fn(async () => 'ok') };
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
      const channel = { on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis(), send: vi.fn(), track: vi.fn(async () => 'ok') };
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
    async function connectPair() {
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
      await flush();
      // 실제 클라이언트처럼 정체성을 심는다(에디터에선 usePresence가 한다). 이게 있어야
      // 서로가 awareness에 잡히고, "혼자면 치유 신호를 멈추는" 게이트가 열린다 —
      // y-protocols의 생성자 기본 상태({})는 clock 0이라 상대에게 적용되지 않는다.
      providerA.getAwareness()!.setLocalStateField('user', { name: 'A', color: '#111111' });
      providerB.getAwareness()!.setLocalStateField('user', { name: 'B', color: '#222222' });
      await flush();
      return { pair, ydocA, ydocB, providerA, providerB };
    }

    it('유실로 보류된 편집을 다음 주기 SV 교환이 메운다 (커서만 살고 편집이 죽던 그 증상)', async () => {
      vi.useFakeTimers();
      try {
        const { pair, ydocA, ydocB, providerA, providerB } = await connectPair();
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
        const { pair, ydocA, ydocB, providerA, providerB } = await connectPair();

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

    it('혼자 열어 둔 탭은 주기 치유 신호를 보내지 않는다 (앱의 가장 흔한 상태 — 유휴 낭비 0)', async () => {
      vi.useFakeTimers();
      try {
        const channel = {
          on: vi.fn().mockReturnThis(),
          subscribe: vi.fn((cb?: (s: string) => void) => {
            cb?.('SUBSCRIBED');
            return channel;
          }),
          send: vi.fn(async (...args: unknown[]) => {
            void args;
            return 'ok';
          }),
          track: vi.fn(async () => 'ok'),
        };
        const client = { channel: vi.fn(() => channel), removeChannel: vi.fn(), realtime: realtimeMock() } as unknown as import('@supabase/supabase-js').SupabaseClient;
        const provider = new SupabaseRealtimeProvider(client);
        provider.connect('doc-solo', docToYDoc(baseDoc()));
        await flush();
        // usePresence처럼 자기 정체성은 심었지만 피어는 없다 = 혼자 편집 중
        provider.getAwareness()!.setLocalStateField('user', { name: '나', color: '#333333' });
        await flush();
        channel.send.mockClear();

        vi.advanceTimersByTime(60_000); // 네 주기
        await flush();

        const svSends = channel.send.mock.calls.filter((call) => (call[0] as unknown as { event: string }).event === 'ysv');
        expect(svSends).toHaveLength(0);
        provider.disconnect();
      } finally {
        vi.useRealTimers();
      }
    });

    it('join 밖에서는 send하지 않는다 — REST 폴백 스팸과 반쪽 발신의 원인이었다', async () => {
      // subscribe 콜백을 아예 부르지 않는 채널 = 소켓이 끊겨 join하지 못한 상태
      const channel = { on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis(), send: vi.fn(async () => 'ok'), track: vi.fn(async () => 'ok') };
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
      expect(configs[1]).toEqual({ config: { private: true, broadcast: { ack: true }, presence: { key: expect.any(String) } } });
      await priv2.fire('CHANNEL_ERROR');
      expect(configs[2]).toEqual({ config: { private: false, broadcast: { ack: true }, presence: { key: expect.any(String) } } });
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

    it('완전히 끊긴 뒤 스스로 다시 붙어 본다 — 복구가 새로고침뿐이면 안 된다(제보)', async () => {
      vi.useFakeTimers();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const priv1 = makeManualChannel();
      const priv2 = makeManualChannel();
      const publicCh = makeManualChannel();
      const retryCh = makeManualChannel('ok'); // 재시도에서는 붙는다
      const { client, provider, statuses } = await setup([priv1, priv2, publicCh, retryCh]);

      await priv1.fire('TIMED_OUT');
      await priv2.fire('TIMED_OUT');
      await publicCh.fire('CHANNEL_ERROR');
      expect(statuses).toEqual(['offline']);

      const madeChannels = (client.channel as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
      await vi.advanceTimersByTimeAsync(5000); // 첫 백오프
      await flush();
      expect((client.channel as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(madeChannels + 1);
      expect(statuses).toContain('connecting'); // 다시 시도하는 동안은 '고장'이 아니다

      await retryCh.fire('SUBSCRIBED');
      expect(statuses[statuses.length - 1]).toBe('connected'); // 배지가 스스로 사라진다

      provider.disconnect();
      warn.mockRestore();
      vi.useRealTimers();
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

  // 제보: "A유저가 편집한 내용이 B유저에게 즉시 반영되지 않는다."
  //
  // 뿌리는 **버려진 채널의 뒤늦은 콜백**이다. 우리가 채널을 갈아탈 때(공개 폴백·
  // 재시도·오류 재구독) `removeChannel(old)`을 부르는데, phoenix의 `leave()`는
  // 서버의 phx_leave 응답을 받은 **뒤에야** close를 쏜다(`@supabase/phoenix`
  // channel.js `leave()`). 그 응답은 새 채널이 이미 SUBSCRIBED된 다음에 도착하는
  // 것이 정상이고, 그때 옛 채널의 subscribe 콜백이 CLOSED로 불려 **공용 상태인
  // `joined`를 false로 되돌렸다.** 세대(gen) 검사는 connect/disconnect 사이만
  // 보호하므로 같은 세션 안의 채널 교체는 그대로 통과한다.
  //
  // 결과가 고약하다 — 채널은 살아서 잘 받고 있고 상태도 'connected'라 배지도 안
  // 뜨는데, `handleLocalUpdate`의 `!joined` 게이트에 막혀 **내 편집만 나가지
  // 않는다.** 그런데 `ysv`/`ysync-request` 응답 핸들러는 그 게이트가 없어서,
  // 상대의 15초 주기 치유 요청에는 답한다 → 내 편집이 **최대 15초 뒤에** 도착한다.
  // 정확히 "즉시 반영되지 않는다"는 증상이다.
  describe('버려진 채널의 뒤늦은 콜백 (제보: 편집이 즉시 안 감)', () => {
    async function fallenBackToPublic(docId: string) {
      const priv = makeManualChannel('error'); // 구독은 되지만 발신이 정책에 거부 → 공개 폴백
      const publicCh = makeManualChannel('ok');
      const channels = [priv, publicCh];
      let i = 0;
      const client = {
        channel: vi.fn(() => channels[Math.min(i++, channels.length - 1)]),
        removeChannel: vi.fn(),
        realtime: realtimeMock(),
      } as unknown as import('@supabase/supabase-js').SupabaseClient;
      const provider = new SupabaseRealtimeProvider(client);
      const ydoc = docToYDoc(baseDoc());
      provider.connect(docId, ydoc, () => undefined);
      await flush();
      await priv.fire('SUBSCRIBED'); // ack 'error' → fallbackToPublic
      await publicCh.fire('SUBSCRIBED'); // 공개 채널로 붙었다
      return { priv, publicCh, client, provider, ydoc };
    }

    it('옛 채널의 CLOSED가 뒤늦게 와도 내 편집은 계속 즉시 나간다', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { priv, publicCh, provider, ydoc } = await fallenBackToPublic('doc-stale-close');
      publicCh.send.mockClear();

      await priv.fire('CLOSED'); // removeChannel(priv)의 실제 결과 — 새 채널이 붙은 뒤에 도착한다

      addNode(ydoc, 'n1', { id: 'n1', text: '내 편집', emoji: '', parent: ROOT_ID, children: [], collapsed: false, color: null, x: 0, y: 0 });
      await flush();

      const updates = publicCh.send.mock.calls.filter((c) => (c[0] as { event: string }).event === 'yupdate');
      expect(updates).toHaveLength(1); // 수리 전: 0 — 15초 뒤 치유 요청에나 실려 갔다
      provider.disconnect();
      warn.mockRestore();
    });

    it('옛 채널의 뒤늦은 CHANNEL_ERROR가 살아 있는 채널을 걷어내지 않는다', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { priv, publicCh, client, provider } = await fallenBackToPublic('doc-stale-error');
      const madeChannels = (client.channel as unknown as ReturnType<typeof vi.fn>).mock.calls.length;

      await priv.fire('CHANNEL_ERROR'); // 옛 채널이 죽어 가며 마지막으로 알린다

      // 수리 전: `this.channel`(=살아 있는 공개 채널)을 지우고 새로 구독했다 —
      // 멀쩡한 연결을 옛 채널의 부고가 끊어 버리는 꼴.
      expect(client.removeChannel).not.toHaveBeenCalledWith(publicCh);
      expect((client.channel as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(madeChannels);
      provider.disconnect();
      warn.mockRestore();
    });

    /**
     * 두 피어 수준에서 **제보 문장 그대로** 확인한다: A가 편집하면 B에게 즉시 보이는가.
     *
     * 버스는 실제 Realtime의 결을 흉내낸다 — 토픽 팬아웃, 자기 메시지는 안 받음,
     * 구독은 비동기, 그리고 `removeChannel`의 close 통지는 **새 채널이 붙은 뒤에**
     * 온다(phoenix `leave()`가 서버 응답을 기다리므로 이게 정상 순서다).
     *
     * 수리 전 이 테스트의 로그: `즉시=없음 / 15초 치유 후=A의 편집`.
     */
    function makeBus() {
      const subs = new Set<{ topic: string; handlers: Record<string, ((a: { payload: unknown }) => void)[]>; alive: boolean }>();
      const pendingCloses: (() => void)[] = [];

      function makeClient(sendResults: ('ok' | 'error')[]) {
        let made = 0;
        return {
          realtime: { setAuth: async () => undefined },
          channel(topic: string) {
            const entry = { topic, handlers: {} as Record<string, ((a: { payload: unknown }) => void)[]>, alive: true };
            const result = sendResults[Math.min(made++, sendResults.length - 1)] ?? 'ok';
            let closeCb: (() => void) | undefined;
            const ch = {
              on(_t: string, f: { event: string }, cb: (a: { payload: unknown }) => void) {
                (entry.handlers[f.event] ??= []).push(cb);
                return ch;
              },
              subscribe(cb?: (s: string) => void) {
                setTimeout(() => {
                  subs.add(entry);
                  cb?.('SUBSCRIBED');
                }, 0);
                closeCb = () => cb?.('CLOSED');
                return ch;
              },
              async send(msg: { event: string; payload: unknown }) {
                if (!entry.alive) return 'error';
                for (const s of subs) {
                  if (s === entry || s.topic !== entry.topic || !s.alive) continue;
                  for (const h of s.handlers[msg.event] ?? []) h({ payload: msg.payload });
                }
                return result;
              },
              async track() {
                return 'ok';
              },
              __retire() {
                entry.alive = false;
                subs.delete(entry);
                pendingCloses.push(() => closeCb?.());
              },
            };
            return ch;
          },
          removeChannel(ch: { __retire?: () => void }) {
            ch.__retire?.();
          },
        } as unknown as import('@supabase/supabase-js').SupabaseClient;
      }

      return {
        makeClient,
        deliverCloses: () => {
          pendingCloses.splice(0).forEach((f) => f());
        },
      };
    }

    it('A가 편집하면 B에게 **즉시** 간다 — 15초 치유를 기다리지 않는다 (제보 문장 그대로)', async () => {
      vi.useFakeTimers();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        const bus = makeBus();
        const clientA = bus.makeClient(['error', 'ok']); // A는 private 발신 거부 → 공개 폴백(채널 교체)
        const clientB = bus.makeClient(['ok']);
        const ydocA = docToYDoc(baseDoc());
        const ydocB = docToYDoc(baseDoc());
        const A = new SupabaseRealtimeProvider(clientA);
        const B = new SupabaseRealtimeProvider(clientB);
        A.connect('doc-pair', ydocA);
        B.connect('doc-pair', ydocB);
        await vi.advanceTimersByTimeAsync(1);
        await flush();
        await vi.advanceTimersByTimeAsync(1); // 폴백 채널 join
        await flush();

        // 서로 보이게 — 주기 치유 게이트(피어 없으면 skip)가 열린다
        A.getAwareness()!.setLocalStateField('user', { name: 'A', color: '#111111' });
        B.getAwareness()!.setLocalStateField('user', { name: 'B', color: '#222222' });
        await flush();

        bus.deliverCloses(); // 옛 private 채널의 뒤늦은 CLOSED가 여기서 도착한다
        await flush();

        addNode(ydocA, 'n1', { id: 'n1', text: 'A의 편집', emoji: '', parent: ROOT_ID, children: [], collapsed: false, color: null, x: 0, y: 0 });
        await flush();

        expect(yDocToDoc(ydocB).nodes.n1?.text).toBe('A의 편집'); // 수리 전: undefined
        A.disconnect();
        B.disconnect();
      } finally {
        warn.mockRestore();
        vi.useRealTimers();
      }
    });
  });

  // 제보(2차): "커서는 서로 보이는데, 텍스트 편집을 확정해도 아무리 기다려도(15초
  // 넘게) 상대에게 반영되지 않는다."
  //
  // Realtime은 **메시지 하나의 크기에 상한**이 있고(무료 플랜 250KB) 넘으면 서버가
  // 조용히 버린다 — 발신자에게는 성공처럼 보인다. 우리 문서는 이미지를 본문에
  // base64로 인라인하므로 첨부 한 장이면 그 상한을 넘는다. 그러면:
  //   · 합류 시 **전체 상태 전송이 통째로 사라지고** → 상대는 내 기본 연산이 없다
  //   · 그 뒤의 작은 편집(텍스트 한 줄)은 의존 연산이 없어 상대에서 **보류**된다
  //   · 15초 주기 치유의 응답도 같은 크기라 **매번 또** 버려진다 → 영영 복구 없음
  //   · 커서(awareness)는 작아서 멀쩡히 오간다 → **연결은 정상으로 보인다**
  // 이 조합이 제보 문장을 정확히 만든다. 수리는 큰 업데이트를 조각내 보내는 것.
  describe('메시지 크기 한도 (이미지가 든 문서)', () => {
    /** 크기 상한이 있는 버스 — 넘는 메시지는 **조용히** 사라진다(실제 서버처럼). */
    function makeCappedBus(capBytes: number) {
      const subs = new Set<{ topic: string; handlers: Record<string, ((a: { payload: unknown }) => void)[]> }>();
      const dropped: string[] = [];
      const inflight: { target: { handlers: Record<string, ((a: { payload: unknown }) => void)[]> }; event: string; payload: unknown }[] = [];
      /** true면 메시지를 바로 전달하지 않고 `inflight`에 쌓는다(순서·유실 시험용). */
      let hold = false;

      function makeClient() {
        return {
          realtime: { setAuth: async () => undefined },
          channel(topic: string) {
            const entry = { topic, handlers: {} as Record<string, ((a: { payload: unknown }) => void)[]> };
            const ch = {
              on(_t: string, f: { event: string }, cb: (a: { payload: unknown }) => void) {
                (entry.handlers[f.event] ??= []).push(cb);
                return ch;
              },
              subscribe(cb?: (s: string) => void) {
                subs.add(entry);
                setTimeout(() => cb?.('SUBSCRIBED'), 0);
                return ch;
              },
              async send(msg: { event: string; payload: unknown }) {
                if (JSON.stringify(msg.payload).length > capBytes) {
                  dropped.push(msg.event);
                  return 'ok'; // 서버가 버려도 발신자는 성공으로 본다 — 그래서 조용하다
                }
                for (const s of subs) {
                  if (s === entry || s.topic !== entry.topic) continue;
                  if (hold) inflight.push({ target: s, event: msg.event, payload: msg.payload });
                  else for (const h of s.handlers[msg.event] ?? []) h({ payload: msg.payload });
                }
                return 'ok';
              },
              async track() {
                return 'ok';
              },
            };
            return ch;
          },
          removeChannel() {},
        } as unknown as import('@supabase/supabase-js').SupabaseClient;
      }

      return {
        makeClient,
        dropped,
        setHold: (v: boolean) => {
          hold = v;
        },
        /** 쌓아 둔 메시지를 원하는 순서로 흘린다. `skip`은 유실시킬 인덱스. */
        release: (order?: (n: number) => number[], skip: number[] = []) => {
          const queued = inflight.splice(0);
          const idx = order ? order(queued.length) : queued.map((_, i) => i);
          for (const i of idx) {
            if (skip.includes(i)) continue;
            const m = queued[i];
            if (!m) continue;
            for (const h of m.target.handlers[m.event] ?? []) h({ payload: m.payload });
          }
        },
      };
    }

    /** 첨부 한 장이 든 문서 — 실제 앱은 긴변 1024로 줄여 base64로 본문에 인라인한다. */
    function imageDoc(): Doc {
      const d = baseDoc();
      d.nodes.pic = {
        id: 'pic',
        text: '사진',
        emoji: '',
        parent: 'root',
        children: [],
        collapsed: false,
        color: null,
        x: 0,
        y: 0,
        img: 'data:image/jpeg;base64,' + 'A'.repeat(600 * 1024),
        imgW: 180,
        imgH: 120,
      } as unknown as Doc['nodes'][string];
      d.nodes.root = { ...d.nodes.root!, children: ['pic'] };
      return d;
    }

    async function connectPair(bus: ReturnType<typeof makeCappedBus>, d: Doc) {
      const ydocA = docToYDoc(d);
      const ydocB = docToYDoc(d); // 두 기기가 서버 본문을 각자 자기 Y.Doc으로 심는다
      const A = new SupabaseRealtimeProvider(bus.makeClient());
      const B = new SupabaseRealtimeProvider(bus.makeClient());
      A.connect('doc-cap', ydocA);
      B.connect('doc-cap', ydocB);
      await vi.advanceTimersByTimeAsync(1);
      await flush();
      A.getAwareness()!.setLocalStateField('user', { name: 'A', color: '#111111' });
      B.getAwareness()!.setLocalStateField('user', { name: 'B', color: '#222222' });
      await flush();
      return { ydocA, ydocB, A, B };
    }

    it('이미지가 든 문서에서도 A의 텍스트 편집이 B에게 즉시 간다 (제보 2차)', async () => {
      vi.useFakeTimers();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        const bus = makeCappedBus(250 * 1024);
        const { ydocA, ydocB, A, B } = await connectPair(bus, imageDoc());

        // 커서는 멀쩡히 오간다 — 그래서 사용자에겐 "연결은 정상"으로 보였다
        expect(B.getAwareness()!.getStates().size).toBeGreaterThanOrEqual(2);
        expect(A.getAwareness()!.getStates().size).toBeGreaterThanOrEqual(2);

        setNodeField(ydocA, 'root', 'text', 'A가 확정한 텍스트');
        await flush();

        expect(bus.dropped).toEqual([]); // 한도를 넘긴 메시지가 없다 = 조각내 보냈다
        expect(yDocToDoc(ydocB).nodes.root?.text).toBe('A가 확정한 텍스트'); // 수리 전: '루트'인 채 영원히
        A.disconnect();
        B.disconnect();
      } finally {
        warn.mockRestore();
        vi.useRealTimers();
      }
    });

    it('조각이 뒤섞여 도착해도 원래 업데이트로 조립된다', async () => {
      vi.useFakeTimers();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        const bus = makeCappedBus(250 * 1024);
        const { ydocA, ydocB, A, B } = await connectPair(bus, baseDoc());

        bus.setHold(true);
        setNodeField(ydocA, 'root', 'img', 'data:image/jpeg;base64,' + 'B'.repeat(600 * 1024));
        await flush();
        bus.release((n) => Array.from({ length: n }, (_, i) => n - 1 - i)); // 역순으로 흘린다
        await flush();

        expect((yDocToDoc(ydocB).nodes.root as unknown as { img?: string }).img).toHaveLength('data:image/jpeg;base64,'.length + 600 * 1024);
        A.disconnect();
        B.disconnect();
      } finally {
        warn.mockRestore();
        vi.useRealTimers();
      }
    });

    it('조각 하나가 유실되면 **아무것도 적용하지 않고**, 다음 주기 치유가 복구한다', async () => {
      vi.useFakeTimers();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        const bus = makeCappedBus(250 * 1024);
        const { ydocA, ydocB, A, B } = await connectPair(bus, baseDoc());

        bus.setHold(true);
        setNodeField(ydocA, 'root', 'img', 'data:image/jpeg;base64,' + 'C'.repeat(600 * 1024));
        await flush();
        bus.release(undefined, [1]); // 두 번째 조각을 잃는다
        await flush();
        expect((yDocToDoc(ydocB).nodes.root as unknown as { img?: string }).img).toBeUndefined(); // 반쪽 적용 없음

        bus.setHold(false);
        await vi.advanceTimersByTimeAsync(15_000); // 주기 치유가 다시 보낸다
        await flush();
        expect((yDocToDoc(ydocB).nodes.root as unknown as { img?: string }).img).toHaveLength('data:image/jpeg;base64,'.length + 600 * 1024);
        A.disconnect();
        B.disconnect();
      } finally {
        warn.mockRestore();
        vi.useRealTimers();
      }
    });
  });
});
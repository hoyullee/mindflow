// 유령 세션(제보 2건) — ① 새로고침마다 접속자 +1 ② 이탈자가 목록에 잔류.
//
// 뿌리: 새로고침/크래시는 pagehide의 "떠남" 방송이 **소켓과 함께 죽어** 유실된다.
// 그러면 유령은 y-protocols의 30초 타임아웃에만 기대는데, 그 사이 ① 새 탭이
// 합류하면 기존 탭의 awareness 응답이 유령을 **새 탭에 되심어** +1로 보이고
// ② 이탈자도 그만큼(백그라운드 탭이면 더) 남는다.
//
// 수리: 소켓 죽음을 즉시 아는 유일한 주체는 서버다 — presence.track()으로 살아
// 있음을 등록하고, 서버의 presence leave를 받아 그 자리에서 awareness를 정리한다.
//
// 버스는 실제 Realtime presence의 결을 흉내낸다: track한 클라이언트의 소켓이
// 죽으면(leave/close 통지 없이 사라져도) 서버가 다른 구독자들에게 presence
// leave({ key })를 쏜다.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { docToYDoc, type Doc } from '@mindflow/mindmap-core';
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

async function flush(): Promise<void> {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

interface BusEntry {
  topic: string;
  handlers: Record<string, ((a: never) => void)[]>;
  alive: boolean;
  presenceKey: string;
  tracked: boolean;
}

function makeBus() {
  const subs = new Set<BusEntry>();

  /** track했던(=서버가 살아 있다고 알고 있던) entry의 죽음을 피어들에게 알린다. */
  function fireLeave(entry: BusEntry): void {
    if (!entry.tracked) return;
    entry.tracked = false;
    for (const s of subs) {
      if (s === entry || s.topic !== entry.topic || !s.alive) continue;
      for (const h of s.handlers.leave ?? []) h({ key: entry.presenceKey } as never);
    }
  }

  function makeClient() {
    const mine: BusEntry[] = [];
    const client = {
      realtime: { setAuth: async () => undefined },
      channel(topic: string, opts?: { config?: { presence?: { key?: string } } }) {
        const entry: BusEntry = { topic, handlers: {}, alive: true, presenceKey: opts?.config?.presence?.key ?? '', tracked: false };
        mine.push(entry);
        const ch = {
          on(_t: string, f: { event: string }, cb: (a: never) => void) {
            (entry.handlers[f.event] ??= []).push(cb);
            return ch;
          },
          subscribe(cb?: (s: string) => void) {
            setTimeout(() => {
              subs.add(entry);
              cb?.('SUBSCRIBED');
            }, 0);
            return ch;
          },
          async send(msg: { event: string; payload: unknown }) {
            if (!entry.alive) return 'error';
            for (const s of subs) {
              if (s === entry || s.topic !== entry.topic || !s.alive) continue;
              for (const h of s.handlers[msg.event] ?? []) h({ payload: msg.payload } as never);
            }
            return 'ok';
          },
          async track() {
            entry.tracked = true;
            return 'ok';
          },
          __retire() {
            entry.alive = false;
            subs.delete(entry);
            fireLeave(entry); // 정상 leave도 서버는 알린다
          },
        };
        return ch;
      },
      removeChannel(ch: { __retire?: () => void }) {
        ch.__retire?.();
      },
      /** 소리 없는 죽음(새로고침/크래시) — 클라이언트는 leave도 close도 못 보내지만,
       * **서버는 소켓이 끊긴 것을 알고** 피어들에게 presence leave를 쏜다. */
      __kill() {
        mine.forEach((e) => {
          e.alive = false;
          subs.delete(e);
          fireLeave(e);
        });
      },
    };
    return client;
  }
  return { makeClient };
}

afterEach(() => vi.useRealTimers());

describe('유령 세션 정리 (presence leave)', () => {
  it('피어가 소리 없이 죽으면(새로고침·크래시) 30초를 기다리지 않고 즉시 접속자에서 빠진다', async () => {
    vi.useFakeTimers();
    const bus = makeBus();
    const cA = bus.makeClient();
    const cB = bus.makeClient();
    const A = new SupabaseRealtimeProvider(cA as never);
    const B = new SupabaseRealtimeProvider(cB as never);
    A.connect('g1', docToYDoc(baseDoc()));
    B.connect('g1', docToYDoc(baseDoc()));
    await vi.advanceTimersByTimeAsync(5);
    await flush();
    A.getAwareness()!.setLocalStateField('user', { name: 'A' });
    B.getAwareness()!.setLocalStateField('user', { name: 'B' });
    await flush();
    expect(A.getAwareness()!.getStates().size).toBe(2); // 서로 보인다

    cB.__kill(); // pagehide 방송이 유실되는 하드 이탈
    await flush();

    // 수리 전: 2 그대로(유령) — y-protocols 30초 타임아웃까지 잔류했다.
    expect(A.getAwareness()!.getStates().size).toBe(1);
    A.disconnect();
  });

  it('새로고침: 옛 자아가 정리된 채 새 탭이 합류한다 — 접속자가 +1로 늘지 않는다', async () => {
    vi.useFakeTimers();
    const bus = makeBus();
    const cA = bus.makeClient();
    const cB = bus.makeClient();
    const A = new SupabaseRealtimeProvider(cA as never);
    const B = new SupabaseRealtimeProvider(cB as never);
    A.connect('g2', docToYDoc(baseDoc()));
    B.connect('g2', docToYDoc(baseDoc()));
    await vi.advanceTimersByTimeAsync(5);
    await flush();
    A.getAwareness()!.setLocalStateField('user', { name: 'A' });
    B.getAwareness()!.setLocalStateField('user', { name: 'B' });
    await flush();

    // B 새로고침 = 소리 없는 죽음 + 새 클라이언트로 재합류
    cB.__kill();
    const cB2 = bus.makeClient();
    const B2 = new SupabaseRealtimeProvider(cB2 as never);
    B2.connect('g2', docToYDoc(baseDoc()));
    await vi.advanceTimersByTimeAsync(5);
    await flush();
    B2.getAwareness()!.setLocalStateField('user', { name: 'B' });
    await flush();

    // 수리 전: A=3(자신+B유령+B′), B′=3(자신+A+A의 응답에 실려 온 B유령) — "+1".
    expect(A.getAwareness()!.getStates().size).toBe(2);
    expect(B2.getAwareness()!.getStates().size).toBe(2);
    A.disconnect();
    B2.disconnect();
  });

  it('정상 이탈(disconnect)도 그대로 정리된다 (무회귀)', async () => {
    vi.useFakeTimers();
    const bus = makeBus();
    const cA = bus.makeClient();
    const cB = bus.makeClient();
    const A = new SupabaseRealtimeProvider(cA as never);
    const B = new SupabaseRealtimeProvider(cB as never);
    A.connect('g3', docToYDoc(baseDoc()));
    B.connect('g3', docToYDoc(baseDoc()));
    await vi.advanceTimersByTimeAsync(5);
    await flush();
    A.getAwareness()!.setLocalStateField('user', { name: 'A' });
    B.getAwareness()!.setLocalStateField('user', { name: 'B' });
    await flush();

    B.disconnect(); // awareness 작별 방송 + presence leave 둘 다
    await flush();
    expect(A.getAwareness()!.getStates().size).toBe(1);
    A.disconnect();
  });
});

// Unit-level test for `usePresence` in isolation — feeds it a real
// `y-protocols/awareness` `Awareness` instance (bound to a plain `Y.Doc`, no
// transport) and simulates "a remote peer" by relaying an `Awareness` update
// the same way `BroadcastChannelProvider`/`SupabaseRealtimeProvider` actually
// do (`encodeAwarenessUpdate`/`applyAwarenessUpdate`) — see
// `Editor.presence.test.tsx` for the full BroadcastChannel-backed,
// through-the-editor version.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { usePresence } from './usePresence';
import { EMPTY_PRESENCE_SELECTION } from './presence';

afterEach(() => {
  vi.useRealTimers();
});

describe('usePresence', () => {
  it('sets a local awareness state (identity + empty selection, no cursor) once connected', () => {
    const awareness = new Awareness(new Y.Doc());
    const { result } = renderHook(() => usePresence(awareness));

    const local = awareness.getStates().get(awareness.clientID) as { user: { name: string; color: string }; cursor: unknown; selection: unknown };
    expect(local.user.name).toBeTruthy();
    expect(local.user.color).toBeTruthy();
    expect(local.cursor).toBeNull();
    expect(local.selection).toEqual(EMPTY_PRESENCE_SELECTION);
    expect(result.current.localUser).toEqual(local.user);
  });

  it('uses the authed email as identity when provided (authed: true), instead of a random guest name', () => {
    const awareness = new Awareness(new Y.Doc());
    const { result } = renderHook(() => usePresence(awareness, 'hoyul.lee@wantedlab.com'));

    expect(result.current.localUser.name).toBe('hoyul.lee@wantedlab.com');
    expect(result.current.localUser.authed).toBe(true);
    const local = awareness.getStates().get(awareness.clientID) as { user: { name: string } };
    expect(local.user.name).toBe('hoyul.lee@wantedlab.com');
  });

  it('프로필명이 있으면 커서 이름표는 이메일 대신 그것을 쓴다 — 색은 이메일 시드 그대로', () => {
    const awareness = new Awareness(new Y.Doc());
    const { result, rerender } = renderHook(({ name }: { name: string | null }) => usePresence(awareness, 'hoyul.lee@wantedlab.com', name), {
      initialProps: { name: null as string | null },
    });
    const emailColor = result.current.localUser.color;

    // 프로필명은 비동기로 늦게 온다(로컬 캐시/백엔드) — 도착하면 이름만 바뀐다.
    rerender({ name: '호율' });

    expect(result.current.localUser.name).toBe('호율');
    expect(result.current.localUser.authed).toBe(true);
    expect(result.current.localUser.color).toBe(emailColor); // 이름을 바꿔도 내 색은 그대로
    const local = awareness.getStates().get(awareness.clientID) as { user: { name: string } };
    expect(local.user.name).toBe('호율'); // 피어에게 나가는 awareness에도 반영
  });

  it('falls back to a random "adjective+animal" guest identity when no authed email is given', () => {
    const awarenessA = new Awareness(new Y.Doc());
    const awarenessB = new Awareness(new Y.Doc());
    const { result: resultA } = renderHook(() => usePresence(awarenessA));
    const { result: resultB } = renderHook(() => usePresence(awarenessB));

    expect(resultA.current.localUser.name).toMatch(/\S+ \S+/); // "adjective animal"
    expect(resultA.current.localUser.authed).toBeUndefined();
    // 두 클라이언트는 서로 다른 씨앗(clientID)에서 정체성을 만든다. 이름이 **우연히**
    // 같을 수는 있으므로(12×12=144개 조합 — 실제로 이 저장소에서 두 번 겪었다) 이름
    // 자체를 비교하지 않는다. 확인할 성질은 "씨앗이 다르면 다른 정체성을 계산한다"이고,
    // 그건 아래 `identity.ts`의 순수 함수 테스트가 결정적으로 검증한다.
    expect(resultB.current.localUser.name).toMatch(/\S+ \S+/);
    expect(awarenessA.clientID).not.toBe(awarenessB.clientID);
  });

  it("exposes a remote peer's state (self excluded) and updates live as the peer's awareness changes", () => {
    const awarenessLocal = new Awareness(new Y.Doc());
    const awarenessRemote = new Awareness(new Y.Doc());
    const { result } = renderHook(() => usePresence(awarenessLocal));

    expect(result.current.peers).toEqual([]); // nobody else yet — solo

    act(() => {
      awarenessRemote.setLocalState({ user: { name: 'Remote Fox', color: '#3f8fd0' }, cursor: { x: 5, y: 9 }, selection: { nodes: ['n1'], floats: [], lines: [], zones: [] } });
      // relay the remote peer's announcement into OUR awareness, exactly like
      // `BroadcastChannelProvider.handleMessage`/`SupabaseRealtimeProvider`'s
      // broadcast handler do on receipt of a wire message.
      applyAwarenessUpdate(awarenessLocal, encodeAwarenessUpdate(awarenessRemote, [awarenessRemote.clientID]), 'remote');
    });

    expect(result.current.peers).toHaveLength(1);
    expect(result.current.peers[0]?.clientId).toBe(awarenessRemote.clientID);
    expect(result.current.peers[0]?.user.name).toBe('Remote Fox');
    expect(result.current.peers[0]?.cursor).toEqual({ x: 5, y: 9 });
    expect(result.current.peers[0]?.selection.nodes).toEqual(['n1']);

    act(() => {
      awarenessRemote.setLocalStateField('cursor', { x: 20, y: 20 });
      applyAwarenessUpdate(awarenessLocal, encodeAwarenessUpdate(awarenessRemote, [awarenessRemote.clientID]), 'remote');
    });
    expect(result.current.peers[0]?.cursor).toEqual({ x: 20, y: 20 });

    act(() => {
      // the remote peer disconnects — its state is removed (null), so it should
      // drop out of `peers` entirely.
      const removedStates = new Map<number, Record<string, unknown>>([[awarenessRemote.clientID, null as unknown as Record<string, unknown>]]);
      applyAwarenessUpdate(awarenessLocal, encodeAwarenessUpdate(awarenessRemote, [awarenessRemote.clientID], removedStates), 'remote');
    });
    expect(result.current.peers).toEqual([]);
  });

  it('setCursor/setSelection write straight to the local awareness state', () => {
    const awareness = new Awareness(new Y.Doc());
    const { result } = renderHook(() => usePresence(awareness));

    act(() => {
      result.current.setCursor({ x: 1, y: 2 });
      result.current.setSelection({ nodes: ['a'], floats: [], lines: [], zones: [] });
    });

    const local = awareness.getStates().get(awareness.clientID) as { cursor: { x: number; y: number }; selection: { nodes: string[] } };
    expect(local.cursor).toEqual({ x: 1, y: 2 });
    expect(local.selection.nodes).toEqual(['a']);
  });

  it('throttles rapid cursor updates (immediate leading send, coalesced trailing update)', () => {
    vi.useFakeTimers();
    const awareness = new Awareness(new Y.Doc());
    const { result } = renderHook(() => usePresence(awareness));

    act(() => {
      result.current.setCursor({ x: 1, y: 1 });
    });
    expect((awareness.getStates().get(awareness.clientID) as { cursor: unknown }).cursor).toEqual({ x: 1, y: 1 });

    act(() => {
      result.current.setCursor({ x: 2, y: 2 });
      result.current.setCursor({ x: 3, y: 3 });
    });
    // still the leading value — the trailing sends are coalesced behind the throttle window
    expect((awareness.getStates().get(awareness.clientID) as { cursor: unknown }).cursor).toEqual({ x: 1, y: 1 });

    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect((awareness.getStates().get(awareness.clientID) as { cursor: unknown }).cursor).toEqual({ x: 3, y: 3 });
  });

  it('setCursor(null) reports "no cursor" immediately, bypassing the throttle', () => {
    const awareness = new Awareness(new Y.Doc());
    const { result } = renderHook(() => usePresence(awareness));

    act(() => {
      result.current.setCursor({ x: 1, y: 1 });
      result.current.setCursor(null);
    });

    expect((awareness.getStates().get(awareness.clientID) as { cursor: unknown }).cursor).toBeNull();
  });

  it('is a complete no-op when awareness is null (single-user / no transport) — no crash, no peers', () => {
    const { result } = renderHook(() => usePresence(null));

    expect(result.current.peers).toEqual([]);
    expect(result.current.localUser.name).toBeTruthy();
    expect(() => {
      act(() => {
        result.current.setCursor({ x: 1, y: 1 });
        result.current.setSelection({ nodes: ['x'], floats: [], lines: [], zones: [] });
      });
    }).not.toThrow();
    expect(result.current.peers).toEqual([]);
  });
});

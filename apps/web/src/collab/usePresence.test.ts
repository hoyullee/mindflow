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

  it('falls back to a random "adjective+animal" guest identity when no authed email is given', () => {
    const awarenessA = new Awareness(new Y.Doc());
    const awarenessB = new Awareness(new Y.Doc());
    const { result: resultA } = renderHook(() => usePresence(awarenessA));
    const { result: resultB } = renderHook(() => usePresence(awarenessB));

    expect(resultA.current.localUser.name).toMatch(/\S+ \S+/); // "adjective animal"
    expect(resultA.current.localUser.authed).toBeUndefined();
    // two different (unrelated) clients get two different guest identities.
    expect(resultA.current.localUser.name).not.toBe(resultB.current.localUser.name);
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

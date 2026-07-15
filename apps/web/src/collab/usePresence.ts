// Presence (awareness) React hook — the counterpart to `useYjsDocSync.ts`
// (document sync) for THIS feature: cursor position + selection + identity,
// broadcast via whichever `CollabProvider`'s `Awareness` instance
// `useYjsDocSync` hands back. Never touches `doc`/the editor's undo stack —
// see CLAUDE.md's task brief ("문서 편집 자체는 M5로 이미 동기화됨 — 이번엔
// presence(커서/선택)만 추가").
//
// Identity: a real Supabase session's email (when `useAuthUser()` — or an
// explicit `authedEmail` override in tests — resolves one) short-circuits the
// random "adjective+animal" guest name (`identity.ts`); either way the color
// is deterministic per-identity (not per-tab), so switching browser tabs of
// the SAME logged-in account shows the SAME color/name to peers, while two
// different anonymous/local-mode tabs get two different guest identities
// (seeded off each tab's own, tab-lifetime-stable `Awareness#clientID`).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Awareness } from 'y-protocols/awareness';
import { colorForSeed, nameForSeed } from './identity';
import { EMPTY_PRESENCE_SELECTION, type PresenceCursor, type PresenceSelection, type PresenceState, type PresenceUser, type RemotePeer } from './presence';

/** Cursor-move broadcasts are throttled to this interval (leading + trailing
 * edge — the first move in a burst goes out immediately, later ones coalesce
 * to at most one send per interval) so a fast mouse gesture doesn't flood the
 * transport (`BroadcastChannel`/Supabase Realtime) with one message per
 * `pointermove` event. Selection changes are NOT throttled — they're already
 * discrete, low-frequency user actions (click/marquee), not a continuous
 * stream. */
const CURSOR_THROTTLE_MS = 50;

export interface UsePresenceResult {
  /** This client's own identity (for e.g. an "you are ○○" hint) — stable for
   * the life of the hook instance (one mount of the editor). */
  localUser: PresenceUser;
  /** Every OTHER currently-connected peer's live state (self excluded). Empty
   * when solo (no `Awareness`/no other peer) — the single-user no-op case. */
  peers: RemotePeer[];
  /** Reports the local pointer's CANVAS-coordinate position (or `null` when
   * it's left the canvas) — throttled internally, safe to call on every
   * `pointermove`. */
  setCursor: (cursor: PresenceCursor | null) => void;
  /** Reports the local selection (unthrottled — see the module doc comment). */
  setSelection: (selection: PresenceSelection) => void;
}

/** @param awareness The live `Awareness` for the currently-connected doc session
 * (from `useYjsDocSync`'s return value), or `null` (not yet connected / no-op
 * transport) — every method above becomes a safe no-op in that case, and
 * `peers` stays `[]`.
 * @param authedEmail The logged-in Supabase user's email, when there is a real
 * session (`useAuthUser()`); `null`/`undefined` (local/demo mode, or anonymous)
 * falls back to a random guest identity. */
export function usePresence(awareness: Awareness | null, authedEmail?: string | null): UsePresenceResult {
  // Seeded off the CLIENT (not a fresh Math.random() per render): an
  // authenticated email is stable across tabs/reconnects of the same
  // account; lacking that, the underlying Yjs doc's clientID is stable for
  // this tab's whole connection (reconnects on `docId` change get a new
  // Y.Doc, hence a new clientID — a fresh guest identity per document is
  // an acceptable trade-off here over threading a browser-persisted guest id
  // through `localStorage`, which is out of scope for this task).
  const seed = authedEmail || (awareness ? String(awareness.clientID) : 'solo');
  const localUser = useMemo<PresenceUser>(() => {
    if (authedEmail) return { name: authedEmail, color: colorForSeed(authedEmail), authed: true };
    return { name: nameForSeed(seed), color: colorForSeed(seed) };
  }, [authedEmail, seed]);

  const localUserRef = useRef(localUser);
  localUserRef.current = localUser;

  const [peers, setPeers] = useState<RemotePeer[]>([]);

  // (Re)initializes this client's local awareness state whenever the
  // connected `Awareness` instance changes (reconnect to a different
  // document, or identity resolves after the initial anonymous render) and
  // subscribes to remote peers' state changes.
  useEffect(() => {
    if (!awareness) {
      setPeers([]);
      return;
    }
    const initial: PresenceState = { user: localUserRef.current, cursor: null, selection: EMPTY_PRESENCE_SELECTION };
    awareness.setLocalState(initial);

    const handleChange = (): void => {
      const next: RemotePeer[] = [];
      awareness.getStates().forEach((state, clientId) => {
        if (clientId === awareness.clientID) return; // never include ourselves
        const s = state as Partial<PresenceState> | null;
        if (!s || !s.user) return; // a peer whose state hasn't been set yet (or just left, state === null)
        next.push({ clientId, user: s.user, cursor: s.cursor ?? null, selection: s.selection ?? EMPTY_PRESENCE_SELECTION });
      });
      setPeers(next);
    };
    handleChange();
    awareness.on('change', handleChange);
    return () => {
      awareness.off('change', handleChange);
      setPeers([]);
    };
    // Intentionally depends ONLY on `awareness` (not `localUser`) — re-running this on every
    // identity change (e.g. the async auth session resolving a moment after mount) would call
    // `setLocalState` again and reset `cursor`/`selection` back to their initial values, wiping
    // out whatever the user already reported. The effect below keeps `awareness`'s `user` field
    // in sync on its own, without touching `cursor`/`selection`.
  }, [awareness]);

  // Keeps the awareness `user` field current if `localUser` changes AFTER the
  // initial connect (e.g. `useAuthUser()`'s session check resolves a moment
  // after mount) — without stomping on whatever `cursor`/`selection` are
  // already live (a plain `setLocalState` would race the effect above).
  useEffect(() => {
    if (!awareness) return;
    awareness.setLocalStateField('user', localUser);
  }, [awareness, localUser]);

  const cursorThrottleRef = useRef<{ lastSentAt: number; timer: ReturnType<typeof setTimeout> | undefined; pending: PresenceCursor | null }>({
    lastSentAt: 0,
    timer: undefined,
    pending: null,
  });

  const setCursor = useCallback(
    (cursor: PresenceCursor | null) => {
      if (!awareness) return;
      const state = cursorThrottleRef.current;
      if (cursor === null) {
        // The pointer left the canvas — always send this immediately (no
        // point coalescing "gone" behind a throttle window; a stale last-seen
        // cursor is worse than a slightly early update).
        if (state.timer !== undefined) {
          clearTimeout(state.timer);
          state.timer = undefined;
        }
        state.pending = null;
        awareness.setLocalStateField('cursor', null);
        state.lastSentAt = Date.now();
        return;
      }
      state.pending = cursor;
      const now = Date.now();
      const elapsed = now - state.lastSentAt;
      if (elapsed >= CURSOR_THROTTLE_MS) {
        awareness.setLocalStateField('cursor', cursor);
        state.lastSentAt = now;
        return;
      }
      if (state.timer === undefined) {
        state.timer = setTimeout(() => {
          state.timer = undefined;
          if (state.pending) {
            awareness.setLocalStateField('cursor', state.pending);
            state.lastSentAt = Date.now();
          }
        }, CURSOR_THROTTLE_MS - elapsed);
      }
    },
    [awareness],
  );

  useEffect(
    () => () => {
      const state = cursorThrottleRef.current;
      if (state.timer !== undefined) clearTimeout(state.timer);
    },
    [],
  );

  const setSelection = useCallback(
    (selection: PresenceSelection) => {
      awareness?.setLocalStateField('selection', selection);
    },
    [awareness],
  );

  return { localUser, peers, setCursor, setSelection };
}

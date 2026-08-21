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
import { removeAwarenessStates } from 'y-protocols/awareness';
import { colorForSeed, nameForSeed } from './identity';
import { EMPTY_PRESENCE_SELECTION, type PresenceCursor, type PresenceSelection, type PresenceState, type PresenceUser, type RemotePeer } from './presence';

/** Cursor-move broadcasts are throttled to this interval (leading + trailing
 * edge — the first move in a burst goes out immediately, later ones coalesce
 * to at most one send per interval) so a fast mouse gesture doesn't flood the
 * transport (`BroadcastChannel`/Supabase Realtime) with one message per
 * `pointermove` event. Selection changes are NOT throttled — they're already
 * discrete, low-frequency user actions (click/marquee), not a continuous
 * stream.
 *
 * 100ms(초당 10회)인 이유: 커서가 협업 트래픽의 지배 항목이라(하루 테스트로 무료
 * 한도의 4%를 태웠다) 50ms에서 절반으로 줄였다. 원격 커서는 "저 사람이 어디 보고
 * 있나"용이라 10회/초면 충분하다 — 두 계정 실기기 테스트에서 "커서 움직임 자연스러움"
 * 확인 후 확정(2026-07-29). */
const CURSOR_THROTTLE_MS = 100;

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
 * falls back to a random guest identity.
 * @param displayName 표시용 프로필명(`useProfileName`). 있으면 커서 이름표에 이메일
 * 대신 이것을 쓴다 — 색은 계속 **이메일**로 시드해서, 이름을 바꿔도 상대 화면에서
 * 내 색이 튀지 않는다. 비동기로 늦게 와도 된다(아래 `setLocalStateField` 효과가
 * 이미 identity 지연 해석을 처리한다).
 * @param avatarUrl 내 프로필 이미지 주소(있으면 상대 화면의 접속자 아바타에 그려진다).
 *   이름과 같은 이유로 늦게 와도 된다. */
export function usePresence(awareness: Awareness | null, authedEmail?: string | null, displayName?: string | null, avatarUrl?: string | null): UsePresenceResult {
  // Seeded off the CLIENT (not a fresh Math.random() per render): an
  // authenticated email is stable across tabs/reconnects of the same
  // account; lacking that, the underlying Yjs doc's clientID is stable for
  // this tab's whole connection (reconnects on `docId` change get a new
  // Y.Doc, hence a new clientID — a fresh guest identity per document is
  // an acceptable trade-off here over threading a browser-persisted guest id
  // through `localStorage`, which is out of scope for this task).
  const seed = authedEmail || (awareness ? String(awareness.clientID) : 'solo');
  const localUser = useMemo<PresenceUser>(() => {
    if (authedEmail) return { name: displayName?.trim() || authedEmail, color: colorForSeed(authedEmail), authed: true, avatar: avatarUrl || null };
    return { name: nameForSeed(seed), color: colorForSeed(seed) };
  }, [authedEmail, displayName, avatarUrl, seed]);

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

  /**
   * 탭이 닫히면 **즉시** 떠났다고 알린다.
   *
   * 왜: awareness는 소식이 끊긴 상대를 30초 뒤에야 정리한다(`outdatedTimeout`).
   * 그래서 하드 클로즈한 탭이 접속자 목록에 30초간 유령으로 남고, 더 중요하게는
   * "상대가 저장하기 전에 떠났으면 남은 쪽이 저장을 인수한다"는 안전망
   * (`useEditorState`)이 그만큼 늦게 돈다(실측 32초).
   *
   * 문서 동기화는 건드리지 않는다 — awareness의 내 상태만 지운다. bfcache에서
   * 되살아난 탭은 `pageshow`에서 정체성을 다시 심어 접속자 목록에 복귀한다
   * (커서·선택은 다음 움직임에 다시 실린다).
   */
  useEffect(() => {
    if (!awareness) return;
    const onHide = (): void => {
      // origin은 **반드시 'local'** — 전송(provider)들은 그 리터럴이 붙은 것만
      // 밖으로 내보낸다(자기가 네트워크에서 적용한 업데이트가 되돌아 나가지 않게).
      // 다른 문자열을 주면 상태는 지워지지만 상대에게는 알려지지 않는다.
      removeAwarenessStates(awareness, [awareness.clientID], 'local');
    };
    const onShow = (): void => {
      awareness.setLocalStateField('user', localUserRef.current);
    };
    window.addEventListener('pagehide', onHide);
    window.addEventListener('pageshow', onShow);
    return () => {
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('pageshow', onShow);
    };
  }, [awareness]);

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

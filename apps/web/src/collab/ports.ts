// M5 real-time collaboration — transport port. `mindmap-core`'s `crdt/`
// binding (`docToYDoc`/`yDocToDoc`/`applyDocToYDoc`) is transport-agnostic by
// design (ADR-0001 §2: "core는 전송/네트워크를 모른다"); everything that
// actually moves a Yjs update across a wire (or a `BroadcastChannel`, or
// nothing at all) lives here, behind one small interface, so the editor only
// ever talks to a `CollabProvider` — never to `BroadcastChannel`/Supabase
// Realtime/`yjs` transport internals directly.

import type { YDoc } from '@mindflow/mindmap-core';
import type { Awareness } from 'y-protocols/awareness';

/**
 * A minimal awareness surface (who else is here). M5 left this deferred
 * ("awareness(커서/선택 공유 UI)는 이번엔 최소 또는 defer 가능"); this revision wires
 * it up via `getAwareness()` below rather than through `onPeers` — a
 * `y-protocols` `Awareness` instance already IS a small pub/sub of "every
 * client's current state" (`awareness.getStates()` / `awareness.on('change', ...)`),
 * so exposing the instance itself (created fresh per `connect()`, torn down on
 * `disconnect()`) is less machinery than re-deriving an equivalent `CollabPeer[]`
 * list here and handing it through a second, parallel callback. `onPeers`
 * stays on the port (still unused/optional) for a future transport that
 * genuinely can't offer a live `Awareness` object (e.g. a plain presence-count
 * ping); `apps/web/src/collab/usePresence.ts` is the one caller of `getAwareness()`.
 */
export interface CollabPeer {
  id: string;
}

export interface CollabProvider {
  /**
   * Starts syncing `ydoc` under `docId` (the channel/room key). Safe to call
   * again with a different `docId`/`ydoc` — implementations disconnect the
   * previous session first.
   */
  connect(docId: string, ydoc: YDoc): void;
  /** Stops syncing and releases the underlying transport (channel/socket).
   * Broadcasts this client's departure (local awareness state -> null) to any
   * connected peers before tearing down (see each provider's own `disconnect()`
   * doc comment). */
  disconnect(): void;
  /**
   * The `y-protocols/awareness` `Awareness` instance bound to the
   * currently-connected `Y.Doc` (created by `connect()`, destroyed by
   * `disconnect()`) — presence's transport-agnostic wire format (cursor/
   * selection/identity are just JSON fields on each client's awareness
   * state). Returns `null` before the first `connect()` call or after
   * `disconnect()`.
   */
  getAwareness(): Awareness | null;
  /** Optional: notified whenever the provider's view of connected peers
   * changes (deferred/minimal — see the doc comment above). */
  onPeers?(listener: (peers: CollabPeer[]) => void): () => void;
}

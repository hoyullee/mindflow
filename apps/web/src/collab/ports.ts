// M5 real-time collaboration — transport port. `mindmap-core`'s `crdt/`
// binding (`docToYDoc`/`yDocToDoc`/`applyDocToYDoc`) is transport-agnostic by
// design (ADR-0001 §2: "core는 전송/네트워크를 모른다"); everything that
// actually moves a Yjs update across a wire (or a `BroadcastChannel`, or
// nothing at all) lives here, behind one small interface, so the editor only
// ever talks to a `CollabProvider` — never to `BroadcastChannel`/Supabase
// Realtime/`yjs` transport internals directly.

import type { YDoc } from '@mindflow/mindmap-core';

/**
 * A minimal awareness surface (who else is here) — intentionally NOT wired
 * into the editor UI yet (M5 task brief: "awareness(커서/선택 공유 UI)는 이번엔
 * 최소 또는 defer 가능"). Kept on the port now so a provider can start
 * tracking presence without a breaking interface change later; `onPeers` is
 * optional and providers that don't implement presence simply never call it.
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
  /** Stops syncing and releases the underlying transport (channel/socket). */
  disconnect(): void;
  /** Optional: notified whenever the provider's view of connected peers
   * changes (deferred/minimal — see the doc comment above). */
  onPeers?(listener: (peers: CollabPeer[]) => void): () => void;
}

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

/**
 * 전송이 실제로 붙었는지 — 조용히 죽지 않게 하려고 둔다.
 *
 * 배포 후 제보로 배운 것: 공유는 됐는데 **편집·접속자·커서가 한꺼번에** 안 왔다.
 * 원인은 채널 하나였다(구독 실패). 그런데 구독 상태를 아무도 보지 않아 화면에는
 * "혼자 있는 것과 똑같이" 보였고, 무엇이 고장났는지 알 방법이 없었다. 이제 상태를
 * 위로 올려 보내 UI가 알려 줄 수 있게 한다.
 */
export type CollabStatus =
  /** 붙었다(권한이 걸린 private 채널). */
  | 'connected'
  /** 붙었지만 **인증되지 않은 공개 채널**이다 — private 구독이 거부돼 폴백했다.
   * 서버의 Realtime Authorization 정책이 적용되지 않은 상태(0009의 realtime 블록이
   * 권한 부족으로 건너뛰어졌을 때). 협업은 되지만 docId를 아는 사람이 끼어들 수 있다. */
  | 'connected-insecure'
  /** 전송이 없다(로컬 단독) 또는 붙지 못했다. */
  | 'offline';

/** 상태 변화를 알려 주는 콜백. `connect()`에 넘긴다. */
export type CollabStatusListener = (status: CollabStatus) => void;

export interface CollabProvider {
  /**
   * Starts syncing `ydoc` under `docId` (the channel/room key). Safe to call
   * again with a different `docId`/`ydoc` — implementations disconnect the
   * previous session first.
   */
  connect(docId: string, ydoc: YDoc, onStatus?: CollabStatusListener): void;
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

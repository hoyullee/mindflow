// Multi-tab collaboration with NO backend: every tab of the same browser
// (same origin) that has the same document open joins a `BroadcastChannel`
// named after the document id. This is the "로컬 검증·오프라인 협업용" transport
// from the M5 task brief — it's also literally what the manual verification
// step ("실 브라우저에서 /editor 두 탭") exercises, so its message protocol is
// intentionally tiny and synchronous (no server round-trip to reason about).
//
// Protocol (three message kinds, all plain objects — `BroadcastChannel`
// structured-clones its payload, so a raw `Uint8Array` travels across tabs
// just fine, no serialization needed):
//   { kind: 'sync-request' }                 — "I just connected, please send me your full state"
//   { kind: 'update', update: Uint8Array }    — a Yjs DOCUMENT update (either a genuine
//                                               incremental change, or a full
//                                               state snapshot sent in reply to
//                                               'sync-request')
//   { kind: 'awareness', update: Uint8Array } — an AWARENESS update (presence: cursor/
//                                               selection/identity — see `usePresence.ts`),
//                                               encoded with `y-protocols/awareness`'s
//                                               `encodeAwarenessUpdate`. Kept as its own
//                                               message kind (not folded into `update`)
//                                               so a peer only pays for decoding whichever
//                                               kind actually changed.

import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import type { YDoc } from '@mindflow/mindmap-core';
import type { CollabProvider } from './ports';

type Message = { kind: 'sync-request' } | { kind: 'update'; update: Uint8Array } | { kind: 'awareness'; update: Uint8Array };

export class BroadcastChannelProvider implements CollabProvider {
  private channel: BroadcastChannel | null = null;
  private ydoc: YDoc | null = null;
  private awareness: Awareness | null = null;

  private readonly handleLocalUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === this) return; // don't re-broadcast an update WE just applied from the network
    this.channel?.postMessage({ kind: 'update', update } satisfies Message);
  };

  /** `y-protocols/awareness`'s `Awareness.emit('update', ...)` tags every event with the
   * ORIGIN PASSED TO `setLocalState`/`applyAwarenessUpdate` — a hardcoded literal `'local'`
   * for a change this client made itself (`setLocalStateField`, `usePresence.ts`), or
   * whatever we pass as `origin` to `applyAwarenessUpdate` below for a change that arrived
   * over the wire (`this`, this provider instance). Only ever relay the former — otherwise
   * an update this tab just applied FROM the network would bounce straight back out. */
  private readonly handleLocalAwarenessUpdate = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown): void => {
    if (origin !== 'local' || !this.awareness) return;
    const changed = added.concat(updated, removed);
    if (!changed.length) return;
    this.channel?.postMessage({ kind: 'awareness', update: encodeAwarenessUpdate(this.awareness, changed) } satisfies Message);
  };

  private readonly handleMessage = (ev: MessageEvent<Message>): void => {
    const ydoc = this.ydoc;
    if (!ydoc) return;
    const msg = ev.data;
    if (msg.kind === 'sync-request') {
      this.channel?.postMessage({ kind: 'update', update: Y.encodeStateAsUpdate(ydoc) } satisfies Message);
      if (this.awareness) {
        const known = Array.from(this.awareness.getStates().keys());
        if (known.length) this.channel?.postMessage({ kind: 'awareness', update: encodeAwarenessUpdate(this.awareness, known) } satisfies Message);
      }
      return;
    }
    if (msg.kind === 'update') {
      Y.applyUpdate(ydoc, msg.update, this);
      return;
    }
    if (msg.kind === 'awareness' && this.awareness) {
      applyAwarenessUpdate(this.awareness, msg.update, this);
    }
  };

  connect(docId: string, ydoc: YDoc): void {
    this.disconnect();
    this.ydoc = ydoc;
    this.awareness = new Awareness(ydoc);
    this.channel = new BroadcastChannel(`mindflow-collab:${docId}`);
    this.channel.onmessage = this.handleMessage;
    ydoc.on('update', this.handleLocalUpdate);
    this.awareness.on('update', this.handleLocalAwarenessUpdate);
    // Ask any already-open tabs for the current doc's full CRDT state (+ their
    // current presence) so this (newly-opened) tab catches up even if it
    // missed earlier updates.
    this.channel.postMessage({ kind: 'sync-request' } satisfies Message);
  }

  getAwareness(): Awareness | null {
    return this.awareness;
  }

  disconnect(): void {
    this.ydoc?.off('update', this.handleLocalUpdate);
    // `Awareness#destroy()` sets this client's local state to `null` (with
    // origin `'local'`) BEFORE tearing down its own listeners, so this line
    // both broadcasts "I'm gone" to any connected tabs (via
    // `handleLocalAwarenessUpdate`, above — the channel is still open at this
    // point) and detaches `handleLocalAwarenessUpdate` for us.
    this.awareness?.destroy();
    this.channel?.close();
    this.channel = null;
    this.ydoc = null;
    this.awareness = null;
  }
}

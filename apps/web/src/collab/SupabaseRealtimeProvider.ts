// Multi-DEVICE collaboration transport, reusing the Supabase project M4
// already provisions (ADR-0001 §3.3: "협업(조건부) — Yjs + Supabase
// Realtime(브로드캐스트)"). No new backend/table — Realtime's ephemeral
// broadcast channels need no schema at all, just a channel name.
//
// Channel = one per document id (`mindflow-collab:<docId>`), matching
// `BroadcastChannelProvider`'s naming so both providers are trivially
// swappable behind the same `docId` concept. Only active when
// `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` are configured (`collab/factory.ts`
// gates this the same way `adapters/factory.ts` gates `SupabaseDocStore`).
//
// Awareness (presence: cursor/selection/identity, `usePresence.ts`) rides the
// SAME channel as a separate broadcast event (`yaware`/`yaware-sync-request`),
// base64-encoded exactly like a doc update (`base64.ts`) since Realtime
// broadcast payloads are JSON.

import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import type { YDoc } from '@mindflow/mindmap-core';
import type { CollabProvider } from './ports';
import { base64ToBytes, bytesToBase64 } from './base64';

const BROADCAST_EVENT = 'yupdate';
const SYNC_REQUEST_EVENT = 'ysync-request';
const AWARENESS_EVENT = 'yaware';
const AWARENESS_SYNC_REQUEST_EVENT = 'yaware-sync-request';

interface UpdatePayload {
  update: string; // base64
}

export class SupabaseRealtimeProvider implements CollabProvider {
  private channel: RealtimeChannel | null = null;
  private ydoc: YDoc | null = null;
  private awareness: Awareness | null = null;

  constructor(private readonly client: SupabaseClient) {}

  private readonly handleLocalUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === this) return; // don't re-broadcast an update WE just applied from the network
    void this.channel?.send({ type: 'broadcast', event: BROADCAST_EVENT, payload: { update: bytesToBase64(update) } satisfies UpdatePayload });
  };

  /** See `BroadcastChannelProvider.handleLocalAwarenessUpdate`'s doc comment for why the
   * origin check is `!== 'local'` here rather than `=== this` (as `handleLocalUpdate` above
   * does for plain Yjs doc updates) — `Awareness` hardcodes `'local'` as the origin of any
   * change this client made itself. */
  private readonly handleLocalAwarenessUpdate = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown): void => {
    if (origin !== 'local' || !this.awareness) return;
    const changed = added.concat(updated, removed);
    if (!changed.length) return;
    void this.channel?.send({ type: 'broadcast', event: AWARENESS_EVENT, payload: { update: bytesToBase64(encodeAwarenessUpdate(this.awareness, changed)) } satisfies UpdatePayload });
  };

  connect(docId: string, ydoc: YDoc): void {
    this.disconnect();
    this.ydoc = ydoc;
    this.awareness = new Awareness(ydoc);
    // `private: true` — Realtime Authorization을 타게 한다. 이게 없으면 채널은
    // 누구에게나 열려 있고(anon 키는 번들에 공개돼 있다), docId를 아는 사람이 문서
    // 내용을 받아 보거나 주입할 수 있다. 정책은 문서 권한을 그대로 따른다
    // (`supabase/migrations/0009_document_shares.sql`의 realtime.messages 블록).
    const channel = this.client.channel(`mindflow-collab:${docId}`, { config: { private: true } });
    channel
      .on('broadcast', { event: BROADCAST_EVENT }, ({ payload }: { payload: UpdatePayload }) => {
        if (!this.ydoc) return;
        Y.applyUpdate(this.ydoc, base64ToBytes(payload.update), this);
      })
      .on('broadcast', { event: SYNC_REQUEST_EVENT }, () => {
        if (!this.ydoc) return;
        void channel.send({ type: 'broadcast', event: BROADCAST_EVENT, payload: { update: bytesToBase64(Y.encodeStateAsUpdate(this.ydoc)) } satisfies UpdatePayload });
      })
      .on('broadcast', { event: AWARENESS_EVENT }, ({ payload }: { payload: UpdatePayload }) => {
        if (!this.awareness) return;
        applyAwarenessUpdate(this.awareness, base64ToBytes(payload.update), this);
      })
      .on('broadcast', { event: AWARENESS_SYNC_REQUEST_EVENT }, () => {
        if (!this.awareness) return;
        const known = Array.from(this.awareness.getStates().keys());
        if (!known.length) return;
        void channel.send({ type: 'broadcast', event: AWARENESS_EVENT, payload: { update: bytesToBase64(encodeAwarenessUpdate(this.awareness, known)) } satisfies UpdatePayload });
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // catch up on whatever's already been edited/presence already announced by peers
          // that joined earlier
          void channel.send({ type: 'broadcast', event: SYNC_REQUEST_EVENT, payload: {} });
          void channel.send({ type: 'broadcast', event: AWARENESS_SYNC_REQUEST_EVENT, payload: {} });
        }
      });
    this.channel = channel;
    ydoc.on('update', this.handleLocalUpdate);
    this.awareness.on('update', this.handleLocalAwarenessUpdate);
  }

  getAwareness(): Awareness | null {
    return this.awareness;
  }

  disconnect(): void {
    this.ydoc?.off('update', this.handleLocalUpdate);
    // Broadcasts this client's departure (local state -> null, origin 'local') to any
    // subscribed peers before the channel itself is removed — see
    // `BroadcastChannelProvider.disconnect()`'s identical reasoning.
    this.awareness?.destroy();
    if (this.channel) void this.client.removeChannel(this.channel);
    this.channel = null;
    this.ydoc = null;
    this.awareness = null;
  }
}

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

import * as Y from 'yjs';
import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import type { YDoc } from '@mindflow/mindmap-core';
import type { CollabProvider } from './ports';
import { base64ToBytes, bytesToBase64 } from './base64';

const BROADCAST_EVENT = 'yupdate';
const SYNC_REQUEST_EVENT = 'ysync-request';

interface UpdatePayload {
  update: string; // base64
}

export class SupabaseRealtimeProvider implements CollabProvider {
  private channel: RealtimeChannel | null = null;
  private ydoc: YDoc | null = null;

  constructor(private readonly client: SupabaseClient) {}

  private readonly handleLocalUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === this) return; // don't re-broadcast an update WE just applied from the network
    void this.channel?.send({ type: 'broadcast', event: BROADCAST_EVENT, payload: { update: bytesToBase64(update) } satisfies UpdatePayload });
  };

  connect(docId: string, ydoc: YDoc): void {
    this.disconnect();
    this.ydoc = ydoc;
    const channel = this.client.channel(`mindflow-collab:${docId}`);
    channel
      .on('broadcast', { event: BROADCAST_EVENT }, ({ payload }: { payload: UpdatePayload }) => {
        if (!this.ydoc) return;
        Y.applyUpdate(this.ydoc, base64ToBytes(payload.update), this);
      })
      .on('broadcast', { event: SYNC_REQUEST_EVENT }, () => {
        if (!this.ydoc) return;
        void channel.send({ type: 'broadcast', event: BROADCAST_EVENT, payload: { update: bytesToBase64(Y.encodeStateAsUpdate(this.ydoc)) } satisfies UpdatePayload });
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // catch up on whatever's already been edited by peers that joined earlier
          void channel.send({ type: 'broadcast', event: SYNC_REQUEST_EVENT, payload: {} });
        }
      });
    this.channel = channel;
    ydoc.on('update', this.handleLocalUpdate);
  }

  disconnect(): void {
    this.ydoc?.off('update', this.handleLocalUpdate);
    if (this.channel) void this.client.removeChannel(this.channel);
    this.channel = null;
    this.ydoc = null;
  }
}

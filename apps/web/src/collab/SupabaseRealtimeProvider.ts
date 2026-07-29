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
import type { CollabProvider, CollabStatusListener } from './ports';
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

  /**
   * 구독을 시작한다. `private: true`는 Realtime Authorization을 타게 하는 스위치다 —
   * 이게 없으면 채널은 누구에게나 열려 있고(anon 키는 번들에 공개돼 있다), docId를
   * 아는 사람이 문서 내용을 받아 보거나 주입할 수 있다.
   *
   * 그런데 **서버에 정책이 없으면 private 구독은 거부된다.** 0009의 realtime 블록은
   * `realtime` 스키마 권한이 없으면 건너뛰어지도록 되어 있어서(배포 전체가 막히지
   * 않게), 그 경우 여기서 채널이 죽는다. 실제로 그렇게 터졌다 — 공유는 됐는데
   * 편집·접속자·커서가 **한꺼번에** 오지 않았고, 구독 실패를 아무도 보지 않아
   * "혼자 있는 것"과 구분되지 않았다.
   *
   * 그래서: private으로 먼저 붙고, 거부되면 **공개 채널로 한 번 폴백**한다. 협업이
   * 죽는 것보다는 낫고, 대신 조용히 넘기지 않는다 — 상태를 `connected-insecure`로
   * 올려 보내고(UI가 알려 준다) 콘솔에 조치 방법을 남긴다.
   */
  connect(docId: string, ydoc: YDoc, onStatus?: CollabStatusListener): void {
    this.disconnect();
    this.ydoc = ydoc;
    this.awareness = new Awareness(ydoc);
    ydoc.on('update', this.handleLocalUpdate);
    this.awareness.on('update', this.handleLocalAwarenessUpdate);
    this.subscribeChannel(docId, true, onStatus);
  }

  private subscribeChannel(docId: string, wantPrivate: boolean, onStatus?: CollabStatusListener): void {
    // private 채널은 소켓이 사용자 JWT를 들고 있어야 인증을 통과한다. supabase-js가
    // 세션 변화 때 realtime.setAuth를 호출하지만, 그보다 먼저 구독하면 anon으로
    // 붙어 거부된다 — 여기서 한 번 더 확실히 맞춰 준다(이미 맞으면 무해).
    if (wantPrivate) {
      try {
        void this.client.realtime.setAuth().catch(() => {
          /* 토큰을 못 얻어도 아래 구독이 실패로 흘러 폴백된다 */
        });
      } catch {
        /* 이 API가 없는 클라이언트 — 같은 이유로 폴백에 맡긴다 */
      }
    }
    // `broadcast.ack`: 서버가 브로드캐스트 수신을 확인해 주게 한다 — 이게 없으면
    // `send()`는 소켓에 밀어 넣고 무조건 'ok'로 즉시 resolve한다(realtime-js
    // `RealtimeChannel#send`). 구독이 됐다고 **보낼 수 있다는 뜻은 아니어서**
    // (private 채널의 읽기·쓰기 정책은 서로 다른 정책이다) 확인이 필요하다.
    const channel = this.client.channel(`mindflow-collab:${docId}`, { config: { private: wantPrivate, broadcast: { ack: true } } });
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
          void this.announce(channel, docId, wantPrivate, onStatus);
          return;
        }
        if (status !== 'CHANNEL_ERROR' && status !== 'TIMED_OUT') return; // CLOSED = 우리가 끊은 것
        if (wantPrivate) {
          this.fallbackToPublic(docId, onStatus);
          return;
        }
        onStatus?.('offline'); // 공개 채널로도 못 붙었다 — 네트워크/프로젝트 문제
      });
    this.channel = channel;
  }

  /**
   * 구독 직후: 먼저 들어와 있던 피어에게 현재 상태를 요청하고(문서·awareness),
   * 그 **첫 send의 ack로 쓰기 권한까지 확인한다.** private 채널에서 읽기는 되고
   * 쓰기는 거부되는 조합이 실제로 가능해서(정책이 select/insert 둘로 나뉘어 있다),
   * 구독 성공만 보고 '연결됨'이라고 하면 또 조용히 죽는다.
   */
  private async announce(channel: RealtimeChannel, docId: string, wantPrivate: boolean, onStatus?: CollabStatusListener): Promise<void> {
    const ack = await channel.send({ type: 'broadcast', event: SYNC_REQUEST_EVENT, payload: {} });
    if (this.channel !== channel) return; // 그 사이 문서를 옮겼거나 끊었다
    if (ack !== 'ok' && wantPrivate) {
      this.fallbackToPublic(docId, onStatus);
      return;
    }
    onStatus?.(ack !== 'ok' ? 'offline' : wantPrivate ? 'connected' : 'connected-insecure');
    // 요청만 하면 반쪽 동기화다 — 내 전체 상태도 함께 보낸다. 각 기기는 자기 로컬
    // 문서로 Y.Doc을 따로 심으므로 연산 이력이 서로 다르고, 상대가 내 심기 연산을 갖고
    // 있지 않으면 이후 내 편집 업데이트는 상대에서 **보류**돼 반영되지 않는다(부분 적용된
    // 노드로 상대 캔버스가 터지는 것까지 실브라우저로 재현했다 —
    // `mindmap-core`의 `readNodesMap` doc comment 참고).
    if (this.ydoc) void channel.send({ type: 'broadcast', event: BROADCAST_EVENT, payload: { update: bytesToBase64(Y.encodeStateAsUpdate(this.ydoc)) } satisfies UpdatePayload });
    void channel.send({ type: 'broadcast', event: AWARENESS_SYNC_REQUEST_EVENT, payload: {} });
  }

  /**
   * 인증된 채널이 거부됐을 때 **공개 채널로 한 번만** 내려간다. 협업이 통째로 죽는
   * 것보다는 낫지만 조용히 넘기지는 않는다 — 상태를 `connected-insecure`로 올려
   * 보내고(UI가 배지로 알린다) 콘솔에 조치 방법을 남긴다. 원인은 대개 서버에
   * Realtime Authorization 정책이 없는 것이다(0009의 realtime 블록은 `realtime`
   * 스키마 권한이 없으면 배포를 막지 않도록 건너뛰어진다).
   */
  private fallbackToPublic(docId: string, onStatus?: CollabStatusListener): void {
    console.warn(
      '[collab] 인증된(private) 실시간 채널이 거부돼 공개 채널로 전환합니다. ' +
        'Supabase 대시보드 SQL Editor에서 supabase/migrations/0009_document_shares.sql의 ' +
        '마지막 do 블록(realtime.messages 정책)을 적용하면 인증된 채널로 붙습니다. ' +
        '자세한 확인 방법: server/supabase/docs/backend.md §6',
    );
    if (this.channel) void this.client.removeChannel(this.channel);
    this.channel = null;
    this.subscribeChannel(docId, false, onStatus);
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

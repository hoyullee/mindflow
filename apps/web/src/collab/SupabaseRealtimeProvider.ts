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
/** 상태 벡터 알림 — "내 문서는 여기까지 안다". 받은 쪽은 자기 문서와의 diff를
 * 계산해 `yupdate`로 돌려준다(빠진 연산만, 전체 문서가 아니라). */
const SV_EVENT = 'ysv';
/** 주기 치유 간격. Realtime은 끊긴 동안의 브로드캐스트를 재전송하지 않으므로,
 * 유실은 "언제든" 생길 수 있는 것으로 두고 주기적으로 메운다. */
const SYNC_INTERVAL_MS = 15_000;

interface UpdatePayload {
  update: string; // base64
}

interface SyncPayload {
  /** 요청자의 상태 벡터(base64). 없으면(구버전 클라이언트) 전체 상태로 응답. */
  sv?: string;
}

export class SupabaseRealtimeProvider implements CollabProvider {
  private channel: RealtimeChannel | null = null;
  private ydoc: YDoc | null = null;
  private awareness: Awareness | null = null;
  /** 세대 카운터 — `subscribeChannel`이 async가 되면서(아래 setAuth await) 끊긴 뒤에
   * 도착하는 continuation이 죽은 세션의 채널을 만들 수 있다. connect/disconnect마다
   * 올리고, await 뒤에는 자기 세대가 아직 현재인지 확인한다. */
  private session = 0;
  /**
   * 채널이 실제로 join된 상태인가. join 밖에서 `send()`하면 realtime-js가 REST로
   * 우회 전송하는데(콘솔의 "falling back to REST API" 스팸), 그 창에서 **수신**은
   * 전혀 안 되고 있으므로 어차피 반쪽이다 — 보내지 않고, 재합류/주기 동기화가
   * 밀린 연산을 diff로 나른다.
   */
  private joined = false;
  private syncTimer: ReturnType<typeof setInterval> | undefined;
  /** 완전히 끊겼을 때의 자동 재접속(백오프) — 없으면 새로고침만이 유일한 복구였다. */
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private retryAttempt = 0;

  constructor(private readonly client: SupabaseClient) {}

  private readonly handleLocalUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === this) return; // don't re-broadcast an update WE just applied from the network
    if (!this.joined) return; // join 밖 — 재합류 시 diff 동기화가 나른다(위 doc comment)
    void this.channel?.send({ type: 'broadcast', event: BROADCAST_EVENT, payload: { update: bytesToBase64(update) } satisfies UpdatePayload });
  };

  /** See `BroadcastChannelProvider.handleLocalAwarenessUpdate`'s doc comment for why the
   * origin check is `!== 'local'` here rather than `=== this` (as `handleLocalUpdate` above
   * does for plain Yjs doc updates) — `Awareness` hardcodes `'local'` as the origin of any
   * change this client made itself. */
  private readonly handleLocalAwarenessUpdate = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown): void => {
    if (origin !== 'local' || !this.awareness) return;
    if (!this.joined) return; // awareness는 절대 상태라 재합류 때 한 번 다시 알리면 된다
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
    const gen = this.session; // disconnect()가 방금 올렸다
    this.retryAttempt = 0;
    this.ydoc = ydoc;
    this.awareness = new Awareness(ydoc);
    ydoc.on('update', this.handleLocalUpdate);
    this.awareness.on('update', this.handleLocalAwarenessUpdate);
    // 주기 치유: 내 상태 벡터를 알리면, 내가 놓친 연산을 가진 피어가 그 diff를
    // 돌려준다(SV_EVENT 핸들러). 유실이 "언제" 났는지 몰라도 한 주기 안에 메워진다.
    this.syncTimer = setInterval(() => {
      if (!this.joined || !this.channel || !this.ydoc) return;
      // 혼자면 보내지 않는다 — 치유할 상대가 없는데 15초마다 빈 채널에 쏘면 앱의
      // 가장 흔한 상태(단독 편집)가 Realtime 사용량만 태운다(탭당 ~5,700건/일).
      // 피어 판단은 awareness(자기 자신 포함이므로 >1). 서로 안 보이는 드문 순간엔
      // 잠시 멈출 수 있지만, 상대의 awareness가 도착하는 즉시 재개된다 — awareness는
      // 절대 상태라 스스로 복구되고, 상대 쪽 타이머도 같은 판단으로 돌고 있다.
      if (!this.awareness || this.awareness.getStates().size <= 1) return;
      void this.channel.send({ type: 'broadcast', event: SV_EVENT, payload: { sv: bytesToBase64(Y.encodeStateVector(this.ydoc)) } satisfies SyncPayload });
    }, SYNC_INTERVAL_MS);
    void this.subscribeChannel(gen, docId, { wantPrivate: true, retried: false }, onStatus);
  }

  private async subscribeChannel(gen: number, docId: string, opts: { wantPrivate: boolean; retried: boolean }, onStatus?: CollabStatusListener): Promise<void> {
    const { wantPrivate, retried } = opts;
    // private 채널은 소켓이 사용자 JWT를 들고 있어야 인증을 통과한다. supabase-js가
    // 세션 변화 때 realtime.setAuth를 호출하지만, 그보다 먼저 구독하면 anon으로 붙어
    // 거부된다. **반드시 await** — 예전엔 기다리지 않고 구독해서 토큰이 늦게 실리는
    // 레이스가 있었고, 그러면 한 탭만 폴백해 한쪽은 private·한쪽은 public에 앉았다.
    // 같은 이름이어도 private/public 채널은 서로 메시지가 오가지 않으므로 그 순간
    // 협업이 조용히 죽는다(제보: "한 명만 경고 아이콘이 없고, 그때 동시 편집이 안 됨").
    if (wantPrivate) {
      try {
        await this.client.realtime.setAuth();
      } catch {
        /* 토큰을 못 얻어도 아래 구독이 실패로 흘러 재시도/폴백된다 */
      }
    }
    if (gen !== this.session) return; // 기다리는 사이 disconnect/재연결됐다
    // `broadcast.ack`: 서버가 브로드캐스트 수신을 확인해 주게 한다 — 이게 없으면
    // `send()`는 소켓에 밀어 넣고 무조건 'ok'로 즉시 resolve한다(realtime-js
    // `RealtimeChannel#send`). 구독이 됐다고 **보낼 수 있다는 뜻은 아니어서**
    // (private 채널의 읽기·쓰기 정책은 서로 다른 정책이다) 확인이 필요하다.
    this.joined = false; // 새 채널 — SUBSCRIBED가 다시 켠다
    const channel = this.client.channel(`mindflow-collab:${docId}`, { config: { private: wantPrivate, broadcast: { ack: true } } });
    channel
      .on('broadcast', { event: BROADCAST_EVENT }, ({ payload }: { payload: UpdatePayload }) => {
        if (!this.ydoc) return;
        Y.applyUpdate(this.ydoc, base64ToBytes(payload.update), this);
      })
      .on('broadcast', { event: SYNC_REQUEST_EVENT }, ({ payload }: { payload: SyncPayload }) => {
        if (!this.ydoc) return;
        // 요청자의 상태 벡터가 있으면 **빠진 연산만**(diff) 보낸다 — 전체 상태를
        // 반복 전송하면 이미지 인라인 문서에서 페이로드가 커진다. 벡터가 없으면
        // (구버전) 전체 상태.
        const theirSv = payload?.sv ? base64ToBytes(payload.sv) : undefined;
        void channel.send({ type: 'broadcast', event: BROADCAST_EVENT, payload: { update: bytesToBase64(Y.encodeStateAsUpdate(this.ydoc, theirSv)) } satisfies UpdatePayload });
        // 반대 방향도 닫는다: 내 상태 벡터를 알려 주면, 요청자가 **자기만 가진 연산**을
        // diff로 보내온다(SV_EVENT 핸들러). 합류 한 번으로 양방향이 수렴한다.
        void channel.send({ type: 'broadcast', event: SV_EVENT, payload: { sv: bytesToBase64(Y.encodeStateVector(this.ydoc)) } satisfies SyncPayload });
      })
      .on('broadcast', { event: SV_EVENT }, ({ payload }: { payload: SyncPayload }) => {
        if (!this.ydoc || !payload?.sv) return;
        // 항상 응답한다(diff가 "비어 보여도" delete set은 실린다 — 삭제는 상태 벡터에
        // 잡히지 않아서, 삭제만 놓친 피어는 이 경로로만 복구된다). 적용은 멱등이다.
        void channel.send({ type: 'broadcast', event: BROADCAST_EVENT, payload: { update: bytesToBase64(Y.encodeStateAsUpdate(this.ydoc, base64ToBytes(payload.sv))) } satisfies UpdatePayload });
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
      .subscribe((status, err) => {
        if (gen !== this.session) return; // 죽은 세션의 콜백
        if (status === 'SUBSCRIBED') {
          // 재합류 포함 — 끊긴 동안 양쪽에 쌓인 연산은 announce의 sync-request(내 SV)와
          // 그 응답의 SV 교환이 diff로 나른다.
          this.joined = true;
          void this.announce(gen, channel, docId, wantPrivate, onStatus);
          return;
        }
        this.joined = false;
        if (status !== 'CHANNEL_ERROR' && status !== 'TIMED_OUT') return; // CLOSED = 우리가 끊은 것
        // 원인이 화면 밖으로 사라지지 않게 — 다음 제보 때 "왜"까지 알 수 있도록 남긴다.
        console.warn(`[collab] 실시간 채널 구독 실패 (${wantPrivate ? 'private' : 'public'}, ${status})`, err ?? '');
        if (this.channel) void this.client.removeChannel(this.channel);
        this.channel = null;
        if (wantPrivate) {
          if (!retried) {
            // 일시 오류(토큰 갱신 직후, 순간 네트워크)로 한 탭만 강등되면 피어들이 서로
            // 다른 채널에 갈라진다 — 강등 전에 private을 한 번 더 시도한다.
            void this.subscribeChannel(gen, docId, { wantPrivate: true, retried: true }, onStatus);
            return;
          }
          this.fallbackToPublic(gen, docId, onStatus);
          return;
        }
        onStatus?.('offline'); // 공개 채널로도 못 붙었다 — 네트워크/프로젝트 문제
        this.scheduleRetry(gen, docId, onStatus);
      });
    this.channel = channel;
  }

  /**
   * 구독 직후: 먼저 들어와 있던 피어에게 현재 상태를 요청하고(문서·awareness),
   * 그 **첫 send의 ack로 쓰기 권한까지 확인한다.** private 채널에서 읽기는 되고
   * 쓰기는 거부되는 조합이 실제로 가능해서(정책이 select/insert 둘로 나뉘어 있다),
   * 구독 성공만 보고 '연결됨'이라고 하면 또 조용히 죽는다.
   */
  private async announce(gen: number, channel: RealtimeChannel, docId: string, wantPrivate: boolean, onStatus?: CollabStatusListener): Promise<void> {
    // 확인용 send는 짧게 기다린다 — 기본 타임아웃(10초)을 그대로 두면, ack가 조금만
    // 늦어도 "쓰기 거부"로 오판해 강등했고 그 10초가 사용자가 체감한 연결 지연이었다.
    // 내 상태 벡터를 실어 보낸다: 응답은 내가 빠뜨린 연산의 diff이고, 상대는 자기 SV를
    // 되돌려 줘 내가 가진(상대가 놓친) 연산도 diff로 건너간다 — 재합류 치유의 핵심.
    const mySv: SyncPayload = this.ydoc ? { sv: bytesToBase64(Y.encodeStateVector(this.ydoc)) } : {};
    const ack = await channel.send({ type: 'broadcast', event: SYNC_REQUEST_EVENT, payload: mySv }, { timeout: 4000 });
    if (gen !== this.session || this.channel !== channel) return; // 그 사이 문서를 옮겼거나 끊었다
    // 강등 사유는 **명시적 'error'만** — RLS가 발신을 거부하면 서버가 오류로 응답한다.
    // 'timed out'은 ack가 늦거나 서버가 ack를 지원하지 않는 경우일 수 있어서, 그걸로
    // 강등하면 정책이 멀쩡한 서버에서도 전원이 공개 채널로 떨어진다(제보: 정책 적용
    // 후에도 경고 아이콘이 그대로).
    if (ack === 'error' && wantPrivate) {
      console.warn('[collab] private 채널 구독은 됐지만 발신이 거부됐습니다 (collab_channel_write 정책 확인 — backend.md §6).');
      if (this.channel) void this.client.removeChannel(this.channel);
      this.channel = null;
      this.fallbackToPublic(gen, docId, onStatus);
      return;
    }
    if (ack === 'timed out') console.warn('[collab] 브로드캐스트 ack가 오지 않았습니다 — 연결은 유지합니다.');
    if (ack === 'error') {
      onStatus?.('offline');
      this.scheduleRetry(gen, docId, onStatus);
    } else {
      this.retryAttempt = 0; // 붙었다 — 다음 사고의 백오프는 처음부터
      onStatus?.(wantPrivate ? 'connected' : 'connected-insecure');
    }
    // 요청만 하면 반쪽 동기화다 — 내 연산도 상대에게 가야 한다. 각 기기는 자기 로컬
    // 문서로 Y.Doc을 따로 심으므로 연산 이력이 서로 다르고, 상대가 내 심기 연산을 갖고
    // 있지 않으면 이후 내 편집 업데이트는 상대에서 **보류**돼 반영되지 않는다(부분 적용된
    // 노드로 상대 캔버스가 터지는 것까지 실브라우저로 재현했다 — `mindmap-core`의
    // `readNodesMap` doc comment 참고). 전체 상태 대신 SV를 알린다: 상대가 자기에게
    // 없는 부분의 diff를 받아 가는 건 SV_EVENT 핸들러가 한다(구버전 상대라면 위
    // sync-request 응답에서 이미 전체 상태를 보냈다).
    if (this.ydoc) void channel.send({ type: 'broadcast', event: SV_EVENT, payload: { sv: bytesToBase64(Y.encodeStateVector(this.ydoc)) } satisfies SyncPayload });
    void channel.send({ type: 'broadcast', event: AWARENESS_SYNC_REQUEST_EVENT, payload: {} });
    // 재합류라면 상대 화면에서 내 커서가 stale/사라짐 상태일 수 있다 — 내 상태를 다시 알린다.
    if (this.awareness) {
      void channel.send({ type: 'broadcast', event: AWARENESS_EVENT, payload: { update: bytesToBase64(encodeAwarenessUpdate(this.awareness, [this.awareness.clientID])) } satisfies UpdatePayload });
    }
  }

  /**
   * 완전히 끊긴 뒤 **스스로 다시 붙어 본다**(2s → 8s → 30s → 2m, 이후 2m 고정).
   *
   * 예전엔 여기서 끝이었다 — 상태가 'offline'으로 굳고 복구 수단은 새로고침뿐이라,
   * 순간적인 네트워크 끊김 하나로 남은 세션 내내 배지가 떠 있었다(제보). 재시도는
   * 구독 한 번이라 비용이 거의 없고, 붙는 순간 `announce`가 상태를 'connected'로
   * 되돌려 배지도 사라진다. 세대(gen)로 죽은 세션의 타이머를 무효화한다.
   */
  private scheduleRetry(gen: number, docId: string, onStatus?: CollabStatusListener): void {
    if (gen !== this.session) return;
    if (this.retryTimer !== undefined) clearTimeout(this.retryTimer);
    // 첫 시도는 **빠르게**: 공유 맵에서는 끊긴 동안 편집이 멈추므로(apps/web
    // `collabBlocked`), 이 지연이 곧 사용자가 멈춰 있는 시간이다.
    const delays = [2000, 8000, 30000, 120000];
    const delay = delays[Math.min(this.retryAttempt, delays.length - 1)] ?? 120000;
    this.retryAttempt++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      if (gen !== this.session) return;
      onStatus?.('connecting'); // 다시 시도하는 동안은 '고장'이 아니다
      void this.subscribeChannel(gen, docId, { wantPrivate: true, retried: false }, onStatus);
    }, delay);
  }

  /**
   * 인증된 채널이 거부됐을 때 **공개 채널로 한 번만** 내려간다. 협업이 통째로 죽는
   * 것보다는 낫지만 조용히 넘기지는 않는다 — 상태를 `connected-insecure`로 올려
   * 보내고(UI가 배지로 알린다) 콘솔에 조치 방법을 남긴다. 원인은 대개 서버에
   * Realtime Authorization 정책이 없는 것이다(0009의 realtime 블록은 `realtime`
   * 스키마 권한이 없으면 배포를 막지 않도록 건너뛰어진다).
   */
  private fallbackToPublic(gen: number, docId: string, onStatus?: CollabStatusListener): void {
    console.warn(
      '[collab] 인증된(private) 실시간 채널이 거부돼 공개 채널로 전환합니다. ' +
        'Supabase 대시보드 SQL Editor에서 realtime.messages에 collab_channel_read/' +
        'collab_channel_write 정책을 만들면 인증된 채널로 붙습니다(create policy 두 개만 — ' +
        '절차: server/supabase/docs/backend.md §6).',
    );
    if (this.channel) void this.client.removeChannel(this.channel);
    this.channel = null;
    void this.subscribeChannel(gen, docId, { wantPrivate: false, retried: true }, onStatus);
  }

  getAwareness(): Awareness | null {
    return this.awareness;
  }

  disconnect(): void {
    this.session++; // 진행 중인 async 구독 continuation 무효화
    if (this.syncTimer !== undefined) {
      clearInterval(this.syncTimer);
      this.syncTimer = undefined;
    }
    if (this.retryTimer !== undefined) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
    this.ydoc?.off('update', this.handleLocalUpdate);
    // Broadcasts this client's departure (local state -> null, origin 'local') to any
    // subscribed peers before the channel itself is removed — see
    // `BroadcastChannelProvider.disconnect()`'s identical reasoning. `joined`를
    // 끄기 **전에** 해야 이 마지막 방송이 send 게이트에 막히지 않는다.
    this.awareness?.destroy();
    this.joined = false;
    if (this.channel) void this.client.removeChannel(this.channel);
    this.channel = null;
    this.ydoc = null;
    this.awareness = null;
  }
}

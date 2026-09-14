// 알림 우편함(0022 `notifications`) 위의 `NotificationStore`.
//
// 읽기 전용에 가깝다 — 알림을 **만드는** 것은 DB 트리거(댓글·공유 insert)뿐이고,
// 여기서는 내 우편함을 읽고 읽음 처리만 한다(RLS: recipient = auth.uid()).

import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_NOTIFICATION_PREFS, type AppNotification, type NotificationPrefs, type NotificationStore, type PushSubscriptionRecord } from '../ports';
import { currentUser } from './supabaseUser';

interface Row {
  id: string;
  kind: AppNotification['kind'];
  document_id: string | null;
  node_id: string | null;
  actor_name: string | null;
  preview: string | null;
  doc_title: string | null;
  created_at: string;
  read_at: string | null;
}

export class SupabaseNotificationStore implements NotificationStore {
  constructor(private readonly client: SupabaseClient) {}

  async list(): Promise<AppNotification[]> {
    const { data, error } = await this.client
      .from('notifications')
      .select('id,kind,document_id,node_id,actor_name,preview,doc_title,created_at,read_at')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) {
      // 테이블 미적용 서버(배포 순서) — 알림이 없는 것으로 본다(#229: 조용히
      // 죽지 않게 원문은 콘솔로).
      console.warn('[geurio] 알림을 불러오지 못했어요:', error.message);
      return [];
    }
    return (data as Row[] | null ?? []).map((r) => ({
      id: r.id,
      kind: r.kind,
      documentId: r.document_id,
      nodeId: r.node_id,
      actorName: (r.actor_name || '').trim(),
      preview: r.preview || '',
      docTitle: r.doc_title || '',
      createdAt: r.created_at,
      read: !!r.read_at,
    }));
  }

  /**
   * 알림 설정(0039) — 행이 없으면 **기본값**이다. 서버(다이제스트)도 같은 규칙으로
   * 읽으므로(`coalesce(p.email_mentions, true)`) 한 번도 설정을 연 적 없는 사용자는
   * 양쪽에서 똑같이 "켜짐"으로 보인다.
   *
   * 표가 아직 없는 서버(배포 순서)에서도 기본값으로 떨어진다 — 설정 행이 사라지는
   * 것보다 "기본대로"가 정직하다(실제 서버 동작이 그렇다).
   */
  async loadPrefs(): Promise<NotificationPrefs> {
    const { data, error } = await this.client.from('notification_prefs').select('email_mentions,push_mentions').maybeSingle();
    if (error) {
      console.warn('[geurio] 알림 설정을 불러오지 못했어요:', error.message);
      return DEFAULT_NOTIFICATION_PREFS;
    }
    const row = data as { email_mentions?: boolean; push_mentions?: boolean } | null;
    if (!row) return DEFAULT_NOTIFICATION_PREFS;
    return {
      emailMentions: row.email_mentions ?? DEFAULT_NOTIFICATION_PREFS.emailMentions,
      pushMentions: row.push_mentions ?? DEFAULT_NOTIFICATION_PREFS.pushMentions,
    };
  }

  async savePrefs(prefs: NotificationPrefs): Promise<{ error?: string }> {
    // `user_id`를 **직접 실어야** 한다 — 이 표에는 `default auth.uid()`가 없다
    // (0004 workspaces와 달리 PK가 곧 사용자라 기본값을 걸어도 upsert의 on conflict
    // 대상이 모호해지지 않지만, 명시하는 편이 RLS의 with check와 눈으로 맞춘다).
    const me = await currentUser(this.client);
    if (!me?.id) return { error: '로그인이 필요해요.' };
    const { error } = await this.client
      .from('notification_prefs')
      .upsert({ user_id: me.id, email_mentions: prefs.emailMentions, push_mentions: prefs.pushMentions }, { onConflict: 'user_id' });
    if (error) {
      console.warn('[geurio] 알림 설정 저장 실패:', error.message);
      return { error: '설정을 저장하지 못했어요.' };
    }
    return {};
  }

  async savePushSubscription(sub: PushSubscriptionRecord): Promise<{ error?: string }> {
    const me = await currentUser(this.client);
    if (!me?.id) return { error: '로그인이 필요해요.' };
    // `endpoint`가 유일 키다 — 같은 브라우저가 다시 구독하면 행이 늘지 않고 갱신된다.
    const { error } = await this.client
      .from('push_subscriptions')
      .upsert({ user_id: me.id, endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth, ua: sub.ua ?? '', fail_count: 0 }, { onConflict: 'endpoint' });
    if (error) {
      console.warn('[geurio] 푸시 구독 저장 실패:', error.message);
      return { error: '이 기기를 등록하지 못했어요.' };
    }
    return {};
  }

  async removePushSubscription(endpoint: string): Promise<{ error?: string }> {
    // RLS가 `user_id = auth.uid()`라 남의 구독은 애초에 지워지지 않는다.
    const { error } = await this.client.from('push_subscriptions').delete().eq('endpoint', endpoint);
    if (error) {
      console.warn('[geurio] 푸시 구독 해제 실패:', error.message);
      return { error: '이 기기를 해제하지 못했어요.' };
    }
    return {};
  }

  async markAllRead(): Promise<{ error?: string }> {
    const { error } = await this.client.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null);
    if (error) {
      console.warn('[geurio] 알림 읽음 처리 실패:', error.message);
      return { error: '읽음 처리에 실패했어요.' };
    }
    return {};
  }

  subscribe(onChange: () => void): () => void {
    // 수신자 전용 ping 채널(0027 트리거의 realtime.send 짝) — 댓글(#0021)과
    // 같은 공개 broadcast: 신호에 내용이 없고 실제 목록은 RLS 걸린 list()로
    // 읽으므로 채널이 비밀을 나르지 않는다. uid는 비동기로 오므로 그 사이
    // 해제되면 붙지 않는다.
    let disposed = false;
    let channel: RealtimeChannel | null = null;
    void currentUser(this.client).then((me) => {
      const uid = me?.id;
      if (!uid || disposed) return;
      channel = this.client.channel(`mindflow-notify:${uid}`, { config: { private: false } });
      channel.on('broadcast', { event: 'notify' }, () => onChange());
      channel.subscribe();
    });
    return () => {
      disposed = true;
      if (channel) void this.client.removeChannel(channel);
      channel = null;
    };
  }
}

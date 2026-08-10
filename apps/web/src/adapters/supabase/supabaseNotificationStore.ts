// 알림 우편함(0022 `notifications`) 위의 `NotificationStore`.
//
// 읽기 전용에 가깝다 — 알림을 **만드는** 것은 DB 트리거(댓글·공유 insert)뿐이고,
// 여기서는 내 우편함을 읽고 읽음 처리만 한다(RLS: recipient = auth.uid()).

import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { AppNotification, NotificationStore } from '../ports';

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
    void this.client.auth.getUser().then(({ data }) => {
      const uid = data.user?.id;
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

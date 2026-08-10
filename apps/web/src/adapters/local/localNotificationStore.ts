// 로컬/데모 모드의 `NotificationStore` — `mf_notifications`(localStorage)를 읽는다.
// 알림을 **만드는** 쪽은 로컬 어댑터들이다(LocalCommentStore의 멘션·답글,
// LocalShareStore의 초대 — Supabase의 DB 트리거(0022)와 같은 시점).

import type { AppNotification, NotificationStore } from '../ports';
import { LOCAL_NOTIFY_CHANNEL, readLocalNotifications, writeLocalNotifications } from './localNotifications';

function demoEmail(): string {
  try {
    const session = JSON.parse(localStorage.getItem('mf_demo_session') || 'null') as { user?: { email?: string | null } } | null;
    return (session?.user?.email ?? '').trim().toLowerCase();
  } catch {
    return '';
  }
}

export class LocalNotificationStore implements NotificationStore {
  async list(): Promise<AppNotification[]> {
    const me = demoEmail();
    if (!me) return [];
    return readLocalNotifications()
      .filter((n) => n.recipientEmail === me)
      .slice(-50)
      .reverse()
      .map((n) => ({
        id: n.id,
        kind: n.kind,
        documentId: n.documentId,
        nodeId: n.nodeId,
        actorName: n.actorName,
        preview: n.preview,
        docTitle: n.docTitle,
        createdAt: n.createdAt,
        read: !!n.readAt,
      }));
  }

  async markAllRead(): Promise<{ error?: string }> {
    const me = demoEmail();
    if (!me) return {};
    const now = new Date().toISOString();
    writeLocalNotifications(readLocalNotifications().map((n) => (n.recipientEmail === me && !n.readAt ? { ...n, readAt: now } : n)));
    return {};
  }

  subscribe(onChange: () => void): () => void {
    // pushLocalNotification의 ping을 받는다 — 내 앞으로 온 신호만.
    if (typeof BroadcastChannel === 'undefined') return () => {};
    const ch = new BroadcastChannel(LOCAL_NOTIFY_CHANNEL);
    ch.onmessage = (e) => {
      const em = ((e.data as { recipientEmail?: string } | null)?.recipientEmail ?? '').trim().toLowerCase();
      if (em && em === demoEmail()) onChange();
    };
    return () => ch.close();
  }
}

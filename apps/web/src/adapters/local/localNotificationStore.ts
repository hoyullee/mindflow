// 로컬/데모 모드의 `NotificationStore` — `mf_notifications`(localStorage)를 읽는다.
// 알림을 **만드는** 쪽은 로컬 어댑터들이다(LocalCommentStore의 멘션·답글,
// LocalShareStore의 초대 — Supabase의 DB 트리거(0022)와 같은 시점).

import { DEFAULT_NOTIFICATION_PREFS, type AppNotification, type NotificationPrefs, type NotificationStore } from '../ports';
import { LOCAL_NOTIFY_CHANNEL, readLocalNotifications, writeLocalNotifications } from './localNotifications';

/** 데모 모드의 알림 설정이 사는 자리. */
const PREFS_KEY = 'mf_notify_prefs';

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

  /**
   * 데모 모드의 알림 설정 — 이 브라우저에만 산다.
   *
   * **여기서는 스위치가 아무것도 바꾸지 않는다**: 데모에는 메일을 보낼 서버도,
   * 푸시를 쏠 곳도 없다. 그래도 값을 들고 있는 이유는 설정 화면이 모드마다
   * 달라지지 않게 하기 위해서다 — 껐다 켠 것이 다음에 열었을 때 그대로 있어야
   * 스위치가 고장 난 것으로 보이지 않는다.
   */
  async loadPrefs(): Promise<NotificationPrefs> {
    try {
      const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null') as Partial<NotificationPrefs> | null;
      if (!raw) return DEFAULT_NOTIFICATION_PREFS;
      return {
        emailMentions: raw.emailMentions ?? DEFAULT_NOTIFICATION_PREFS.emailMentions,
        pushMentions: raw.pushMentions ?? DEFAULT_NOTIFICATION_PREFS.pushMentions,
      };
    } catch {
      return DEFAULT_NOTIFICATION_PREFS;
    }
  }

  async savePrefs(prefs: NotificationPrefs): Promise<{ error?: string }> {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* 저장소가 막혀 있어도 데모는 계속 돈다 — 다음에 열면 기본값이다 */
    }
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

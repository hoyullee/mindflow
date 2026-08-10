// 로컬/데모 모드의 알림 우편함 저장소(`mf_notifications`) — Supabase 모드에서
// DB 트리거(0022)가 하는 일을, 데모에서는 "서버 역할"인 로컬 어댑터들이 한다
// (LocalCommentStore의 멘션, LocalShareStore의 초대). 수신자는 이메일로 적는다 —
// 데모에는 uuid가 없고, 브라우저의 데모 세션 이메일이 곧 정체성이다.

import type { NotificationKind } from '../ports';

const KEY = 'mf_notifications';
const MAX = 200;

export interface StoredNotification {
  id: string;
  recipientEmail: string;
  kind: NotificationKind;
  documentId: string | null;
  nodeId: string | null;
  actorName: string;
  preview: string;
  docTitle: string;
  createdAt: string;
  readAt: string | null;
}

export function readLocalNotifications(): StoredNotification[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? (list as StoredNotification[]) : [];
  } catch {
    return [];
  }
}

export function writeLocalNotifications(list: StoredNotification[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX)));
  } catch {
    /* 쿼터/사용 불가 — 알림은 부가 기능 */
  }
}

/** 이 기기 문서의 제목(루트 주제 글자) — 알림 목록의 doc_title 스냅샷용. */
export function localDocTitle(documentId: string): string {
  try {
    const raw = localStorage.getItem(`mindflow_doc_${documentId}`);
    if (!raw) return '';
    const doc = JSON.parse(raw) as { nodes?: Record<string, { text?: string }> };
    return (doc.nodes?.root?.text ?? '').trim();
  } catch {
    return '';
  }
}

/** BroadcastChannel 이름 — 로컬 모드의 알림 ping(0027 realtime.send의 짝). */
export const LOCAL_NOTIFY_CHANNEL = 'mf-notify';

/** 다른 탭(과 같은 탭의 벨)에 "새 알림이 생겼다"고 알린다 — 내용 없는 신호,
 * 받는 쪽이 자기 우편함을 다시 읽는다(댓글 ping과 같은 무늬). */
function pingLocalNotify(recipientEmail: string): void {
  if (typeof BroadcastChannel === 'undefined') return;
  try {
    const ch = new BroadcastChannel(LOCAL_NOTIFY_CHANNEL);
    ch.postMessage({ recipientEmail });
    ch.close();
  } catch {
    /* 신호는 부가 기능 — 실패해도 알림 자체는 저장됐다 */
  }
}

export function pushLocalNotification(n: Omit<StoredNotification, 'id' | 'createdAt' | 'readAt'>): void {
  const list = readLocalNotifications();
  const recipientEmail = n.recipientEmail.trim().toLowerCase();
  list.push({
    ...n,
    recipientEmail,
    id: `n${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`,
    createdAt: new Date().toISOString(),
    readAt: null,
  });
  writeLocalNotifications(list);
  pingLocalNotify(recipientEmail);
}

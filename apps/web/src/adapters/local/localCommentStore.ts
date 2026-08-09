// 로컬/데모 모드의 `CommentStore` — 서버가 없으니 localStorage에 쌓는다.
// 혼자 쓰는 메모처럼 동작하지만 UI 흐름은 Supabase 모드와 같다
// (ShareStore·FeedbackStore와 같은 태도). 실시간 신호는 BroadcastChannel —
// 같은 브라우저의 다른 탭이 즉시 다시 읽는다(M5 로컬 전송과 같은 판단).

import type { CommentMention, CommentStore, DocComment } from '../ports';
import { localDocTitle, pushLocalNotification } from './localNotifications';

const KEY = 'mf_comments';
/** 이 기기에 쌓아 둘 상한 — 데모라 넉넉하되 무한히 늘지는 않게. */
const MAX = 500;

interface Stored {
  id: string;
  documentId: string;
  nodeId: string;
  parentId?: string | null;
  authorName: string;
  body: string;
  createdAt: string;
  resolvedAt?: string | null;
  resolvedByName?: string | null;
  mentions?: CommentMention[];
}

function readAll(): Stored[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? (list as Stored[]) : [];
  } catch {
    return [];
  }
}

function writeAll(list: Stored[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX)));
  } catch {
    /* 쿼터/사용 불가 — 데모라 조용히 넘어간다 */
  }
}

/** 이 브라우저의 데모 사용자 이름. 없으면 '나'. */
function demoName(): string {
  try {
    const session = JSON.parse(localStorage.getItem('mf_demo_session') || 'null') as { user?: { email?: string | null } } | null;
    const email = (session?.user?.email ?? '').trim();
    return email ? (email.split('@')[0] ?? '나') : '나';
  } catch {
    return '나';
  }
}

/** 다른 탭에 "이 문서의 댓글이 바뀌었다"고 알린다(내용 없음 — 받는 쪽이 다시 읽는다). */
function ping(documentId: string): void {
  if (typeof BroadcastChannel === 'undefined') return;
  try {
    const ch = new BroadcastChannel(`mf-comments:${documentId}`);
    ch.postMessage({ t: 'changed' });
    ch.close();
  } catch {
    /* 신호는 부가 기능 — 실패해도 댓글 자체는 저장됐다 */
  }
}

export class LocalCommentStore implements CommentStore {
  async list(documentId: string): Promise<DocComment[]> {
    return readAll()
      .filter((c) => c.documentId === documentId)
      .map((c) => ({
        id: c.id,
        nodeId: c.nodeId,
        parentId: c.parentId ?? null,
        authorName: c.authorName,
        // 데모에는 남이 없다 — 전부 내 댓글이라 지울 수 있다.
        mine: true,
        body: c.body,
        createdAt: c.createdAt,
        resolved: !!c.resolvedAt,
        resolvedByName: c.resolvedByName ?? null,
        mentions: Array.isArray(c.mentions) ? c.mentions : [],
      }));
  }

  async add(documentId: string, nodeId: string, body: string, opts?: { parentId?: string; mentions?: CommentMention[] }): Promise<{ error?: string }> {
    const text = body.trim();
    if (!text) return { error: '내용을 입력해 주세요.' };
    const list = readAll();
    if (opts?.parentId) {
      // 0021 트리거와 같은 규칙: 부모는 같은 문서의 최상위 댓글이어야 한다.
      const parent = list.find((c) => c.id === opts.parentId && c.documentId === documentId);
      if (!parent || parent.parentId) return { error: '답글을 남길 수 없는 댓글이에요.' };
    }
    list.push({
      id: `c${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`,
      documentId,
      nodeId,
      parentId: opts?.parentId ?? null,
      authorName: demoName(),
      body: text.slice(0, 2000),
      createdAt: new Date().toISOString(),
      mentions: opts?.mentions ?? [],
    });
    writeAll(list);
    ping(documentId);
    // 알림 생성 — Supabase에서는 DB 트리거(0022)가 하는 일. 데모에는 "남"이
    // 없으므로 이메일이 있는 멘션만 우편함에 넣는다(답글·소유자 알림은 작성자
    // 이메일을 모른다 — 어차피 한 사람뿐이라 알릴 상대도 없다).
    const myEmail = (() => {
      try {
        const s = JSON.parse(localStorage.getItem('mf_demo_session') || 'null') as { user?: { email?: string | null } } | null;
        return (s?.user?.email ?? '').trim().toLowerCase();
      } catch {
        return '';
      }
    })();
    (opts?.mentions ?? []).forEach((m) => {
      const to = m.email.trim().toLowerCase();
      if (!to || to === myEmail) return;
      pushLocalNotification({ recipientEmail: to, kind: 'mention', documentId, nodeId, actorName: demoName(), preview: text.slice(0, 140), docTitle: localDocTitle(documentId) });
    });
    return {};
  }

  async remove(documentId: string, commentId: string): Promise<{ error?: string }> {
    // 뿌리를 지우면 답글도 함께(0021 on delete cascade와 같은 규칙).
    writeAll(readAll().filter((c) => !(c.documentId === documentId && (c.id === commentId || c.parentId === commentId))));
    ping(documentId);
    return {};
  }

  async setResolved(documentId: string, commentId: string, resolved: boolean): Promise<{ error?: string }> {
    const list = readAll();
    const c = list.find((x) => x.documentId === documentId && x.id === commentId);
    if (!c) return { error: '댓글을 찾을 수 없어요.' };
    if (c.parentId) return { error: '답글은 해결 표시를 할 수 없어요.' };
    c.resolvedAt = resolved ? new Date().toISOString() : null;
    c.resolvedByName = resolved ? demoName() : null;
    writeAll(list);
    ping(documentId);
    return {};
  }

  subscribe(documentId: string, onChange: () => void): () => void {
    if (typeof BroadcastChannel === 'undefined') return () => {};
    const ch = new BroadcastChannel(`mf-comments:${documentId}`);
    ch.onmessage = () => onChange();
    return () => ch.close();
  }
}

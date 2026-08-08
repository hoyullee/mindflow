// 로컬/데모 모드의 `CommentStore` — 서버가 없으니 localStorage에 쌓는다.
// 혼자 쓰는 메모처럼 동작하지만 UI 흐름은 Supabase 모드와 같다
// (ShareStore·FeedbackStore와 같은 태도).

import type { CommentStore, DocComment } from '../ports';

const KEY = 'mf_comments';
/** 이 기기에 쌓아 둘 상한 — 데모라 넉넉하되 무한히 늘지는 않게. */
const MAX = 500;

interface Stored {
  id: string;
  documentId: string;
  nodeId: string;
  authorName: string;
  body: string;
  createdAt: string;
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

export class LocalCommentStore implements CommentStore {
  async list(documentId: string): Promise<DocComment[]> {
    return readAll()
      .filter((c) => c.documentId === documentId)
      .map((c) => ({
        id: c.id,
        nodeId: c.nodeId,
        authorName: c.authorName,
        // 데모에는 남이 없다 — 전부 내 댓글이라 지울 수 있다.
        mine: true,
        body: c.body,
        createdAt: c.createdAt,
      }));
  }

  async add(documentId: string, nodeId: string, body: string): Promise<{ error?: string }> {
    const text = body.trim();
    if (!text) return { error: '내용을 입력해 주세요.' };
    const list = readAll();
    list.push({
      id: `c${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`,
      documentId,
      nodeId,
      authorName: demoName(),
      body: text.slice(0, 2000),
      createdAt: new Date().toISOString(),
    });
    writeAll(list);
    return {};
  }

  async remove(documentId: string, commentId: string): Promise<{ error?: string }> {
    writeAll(readAll().filter((c) => !(c.documentId === documentId && c.id === commentId)));
    return {};
  }
}

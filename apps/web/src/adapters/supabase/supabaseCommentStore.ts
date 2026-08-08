// 주제 댓글 — `document_comments` 테이블 위의 `CommentStore`
// (`supabase/migrations/0020_document_comments.sql`).
//
// 권한은 전부 RLS가 정한다(읽기=소유자·초대받은 사람, 쓰기=읽을 수 있는 사람,
// 지우기=작성자 또는 소유자). 여기서는 화면이 헛돌지 않도록 결과를 다듬을 뿐이다.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CommentStore, DocComment } from '../ports';

interface Row {
  id: string;
  node_id: string;
  author: string | null;
  author_name: string | null;
  body: string;
  created_at: string;
}

export class SupabaseCommentStore implements CommentStore {
  constructor(private readonly client: SupabaseClient) {}

  async list(documentId: string): Promise<DocComment[]> {
    if (!documentId) return [];
    const { data: me } = await this.client.auth.getUser();
    const uid = me?.user?.id ?? null;
    const { data, error } = await this.client
      .from('document_comments')
      .select('id,node_id,author,author_name,body,created_at')
      .eq('document_id', documentId)
      .order('created_at', { ascending: true });
    if (error) {
      // 테이블 미적용 서버(배포 순서)·권한 없음 — 댓글이 없는 것으로 본다.
      // 조용히 죽지 않게 원문은 콘솔로(#229의 교훈).
      console.warn('[geurio] 댓글을 불러오지 못했어요:', error.message);
      return [];
    }
    return (data as Row[] | null ?? []).map((r) => ({
      id: r.id,
      nodeId: r.node_id,
      authorName: (r.author_name || '').trim(),
      mine: !!uid && r.author === uid,
      body: r.body,
      createdAt: r.created_at,
    }));
  }

  async add(documentId: string, nodeId: string, body: string): Promise<{ error?: string }> {
    const text = body.trim();
    if (!text) return { error: '내용을 입력해 주세요.' };
    const { data } = await this.client.auth.getUser();
    const user = data?.user;
    if (!user) return { error: '로그인이 필요해요.' };
    // 표시 이름은 앱의 프로필명 규칙과 같은 순서로 고른다(0015와 동일):
    // 지정한 이름 → 공급자 이름 → 이메일 로컬파트. 이메일 전체는 남기지 않는다.
    const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
    const name =
      (typeof meta.display_name === 'string' && meta.display_name.trim()) ||
      (typeof meta.name === 'string' && meta.name.trim()) ||
      (user.email ?? '').split('@')[0] ||
      '알 수 없음';
    const { error } = await this.client.from('document_comments').insert({
      document_id: documentId,
      node_id: nodeId,
      author: user.id,
      author_name: name,
      body: text.slice(0, 2000),
    });
    if (error) {
      console.warn('[geurio] 댓글 저장 실패:', error.message);
      return { error: '댓글을 남기지 못했어요. 잠시 후 다시 시도해 주세요.' };
    }
    return {};
  }

  async remove(documentId: string, commentId: string): Promise<{ error?: string }> {
    const { error } = await this.client.from('document_comments').delete().eq('id', commentId).eq('document_id', documentId);
    if (error) {
      console.warn('[geurio] 댓글 삭제 실패:', error.message);
      return { error: '삭제하지 못했어요.' };
    }
    return {};
  }
}

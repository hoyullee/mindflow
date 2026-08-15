// 주제 댓글 — `document_comments` 테이블 위의 `CommentStore`
// (0020 기본 + 0021 답글·멘션·해결 표시).
//
// 권한은 전부 RLS가 정한다(읽기=소유자·초대받은 사람, 쓰기=읽을 수 있는 사람,
// 지우기=작성자 또는 소유자, 해결=쓸 수 있는 사람 — 좁은 RPC). 여기서는 화면이
// 헛돌지 않도록 결과를 다듬을 뿐이다.
//
// ── 실시간 설계 ─────────────────────────────────────────────────────────────
// 채널에는 **"바뀌었다"는 신호(ping)만** 싣고, 받는 쪽이 `list()`로 다시 읽는다.
// 그 select에 RLS가 걸려 있으므로 채널 자체는 비밀을 나르지 않는다. 공개(broadcast)
// 채널을 쓰는 이유: 0009의 realtime.messages 발신 정책은 edit 전용인데 **댓글은
// 보기 전용 참가자도 쓴다** — private 채널이면 그 사람의 신호가 막혀 "내가 단
// 댓글이 남에게 실시간으로 안 가는" 반쪽이 된다(#228의 교훈: 채널이 반쪽이면
// 조용히 죽는다). 내용 없는 ping은 공개 채널이어도 잃을 것이 없다 — 문서 id를
// 아는 외부인이 할 수 있는 일은 "다시 읽어 봐"뿐이고 그 읽기는 RLS가 거른다.

import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { CommentMention, CommentStore, DocComment } from '../ports';

interface Row {
  id: string;
  node_id: string;
  parent_id: string | null;
  author: string | null;
  author_name: string | null;
  body: string;
  created_at: string;
  resolved_at: string | null;
  resolved_by_name: string | null;
  mentions: unknown;
}

const COLS = 'id,node_id,parent_id,author,author_name,body,created_at,resolved_at,resolved_by_name,mentions';
/** 0021 미적용 서버(배포 순서)용 — 확장 컬럼 없이 한 번 더 읽는 폴백. */
const BASE_COLS = 'id,node_id,author,author_name,body,created_at';

function mentionsOf(raw: unknown): CommentMention[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((m): m is CommentMention => !!m && typeof (m as CommentMention).email === 'string' && typeof (m as CommentMention).name === 'string');
}

export class SupabaseCommentStore implements CommentStore {
  /** 문서별 신호 채널 — 구독이 만들고, add/remove/setResolved가 ping을 싣는다. */
  private channels = new Map<string, RealtimeChannel>();

  constructor(private readonly client: SupabaseClient) {}

  async list(documentId: string): Promise<DocComment[]> {
    if (!documentId) return [];
    const { data: me } = await this.client.auth.getUser();
    const uid = me?.user?.id ?? null;
    let { data, error } = await this.client
      .from('document_comments')
      .select(COLS)
      .eq('document_id', documentId)
      .order('created_at', { ascending: true });
    if (error) {
      // 0021 미적용 서버면 확장 컬럼 select가 통째로 실패한다 — 기본 컬럼으로
      // 한 번 더(#321의 updated_by 폴백과 같은 판단: 새 필드 때문에 목록 전체가
      // 죽으면 안 된다).
      const retry = await this.client.from('document_comments').select(BASE_COLS).eq('document_id', documentId).order('created_at', { ascending: true });
      data = retry.data as Row[] | null;
      error = retry.error;
    }
    if (error) {
      // 테이블 미적용 서버(배포 순서)·권한 없음 — 댓글이 없는 것으로 본다.
      // 조용히 죽지 않게 원문은 콘솔로(#229의 교훈).
      console.warn('[geurio] 댓글을 불러오지 못했어요:', error.message);
      return [];
    }
    const rows = (data as Partial<Row>[] | null) ?? [];
    // 좋아요는 별도 표(0028) — 목록 하나를 더 읽어 개수와 "내가 눌렀는가"를 붙인다.
    // 미적용 서버에서는 조용히 0으로 둔다(배포 순서 안전 — 목록이 죽으면 안 된다).
    const likes = new Map<string, { n: number; mine: boolean }>();
    if (rows.length) {
      const ids = rows.map((r) => r.id).filter((v): v is string => !!v);
      try {
        const { data: likeRows, error: likeErr } = await this.client.from('comment_likes').select('comment_id,user_id').in('comment_id', ids);
        if (likeErr) console.warn('[geurio] 댓글 좋아요를 불러오지 못했어요:', likeErr.message);
        for (const l of (likeRows as { comment_id: string; user_id: string }[] | null) ?? []) {
          const cur = likes.get(l.comment_id) ?? { n: 0, mine: false };
          likes.set(l.comment_id, { n: cur.n + 1, mine: cur.mine || (!!uid && l.user_id === uid) });
        }
      } catch (e) {
        // 좋아요는 곁다리다 — 못 읽어도 **댓글 목록은 뜬다**(0028 미적용 서버 안전).
        console.warn('[geurio] 댓글 좋아요를 불러오지 못했어요:', e);
      }
    }
    return rows.map((r) => ({
      id: r.id ?? '',
      nodeId: r.node_id ?? '',
      parentId: r.parent_id ?? null,
      authorName: (r.author_name || '').trim(),
      mine: !!uid && r.author === uid,
      body: r.body ?? '',
      createdAt: r.created_at ?? '',
      resolved: !!r.resolved_at,
      resolvedByName: r.resolved_by_name || null,
      likes: likes.get(r.id ?? '')?.n ?? 0,
      likedByMe: likes.get(r.id ?? '')?.mine ?? false,
      mentions: mentionsOf(r.mentions),
    }));
  }

  async add(documentId: string, nodeId: string, body: string, opts?: { parentId?: string; mentions?: CommentMention[] }): Promise<{ error?: string }> {
    const text = body.trim();
    if (!text) return { error: '내용을 입력해 주세요.' };
    const { data } = await this.client.auth.getUser();
    const user = data?.user;
    if (!user) return { error: '로그인이 필요해요.' };
    const name = this.displayNameOf(user.user_metadata, user.email);
    const row: Record<string, unknown> = {
      document_id: documentId,
      node_id: nodeId,
      author: user.id,
      author_name: name,
      body: text.slice(0, 2000),
    };
    if (opts?.parentId) row.parent_id = opts.parentId;
    if (opts?.mentions?.length) row.mentions = opts.mentions;
    const { error } = await this.client.from('document_comments').insert(row);
    if (error) {
      console.warn('[geurio] 댓글 저장 실패:', error.message);
      return { error: '댓글을 남기지 못했어요. 잠시 후 다시 시도해 주세요.' };
    }
    this.ping(documentId);
    return {};
  }

  async setLiked(documentId: string, commentId: string, liked: boolean): Promise<{ error?: string }> {
    const { data } = await this.client.auth.getUser();
    const uid = data?.user?.id;
    if (!uid) return { error: '로그인이 필요해요.' };
    const { error } = liked
      ? await this.client.from('comment_likes').upsert({ comment_id: commentId, user_id: uid }, { onConflict: 'comment_id,user_id' })
      : await this.client.from('comment_likes').delete().eq('comment_id', commentId).eq('user_id', uid);
    if (error) {
      console.warn('[geurio] 좋아요 저장 실패:', error.message);
      return { error: '좋아요를 반영하지 못했어요.' };
    }
    this.ping(documentId);
    return {};
  }

  async remove(documentId: string, commentId: string): Promise<{ error?: string }> {
    const { error } = await this.client.from('document_comments').delete().eq('id', commentId).eq('document_id', documentId);
    if (error) {
      console.warn('[geurio] 댓글 삭제 실패:', error.message);
      return { error: '삭제하지 못했어요.' };
    }
    this.ping(documentId);
    return {};
  }

  async setResolved(documentId: string, commentId: string, resolved: boolean): Promise<{ error?: string }> {
    const { data } = await this.client.auth.getUser();
    const user = data?.user;
    const { error } = await this.client.rpc('set_comment_resolved', {
      comment_id: commentId,
      resolved,
      resolver_name: resolved ? this.displayNameOf(user?.user_metadata, user?.email) : '',
    });
    if (error) {
      console.warn('[geurio] 댓글 해결 표시 실패:', error.message);
      return { error: '해결 표시를 바꾸지 못했어요.' };
    }
    this.ping(documentId);
    return {};
  }

  subscribe(documentId: string, onChange: () => void): () => void {
    const existing = this.channels.get(documentId);
    if (existing) void this.client.removeChannel(existing);
    const channel = this.client.channel(`mindflow-comments:${documentId}`, { config: { private: false } });
    this.channels.set(documentId, channel);
    channel.on('broadcast', { event: 'changed' }, () => onChange());
    channel.subscribe();
    return () => {
      // 뒤늦은 부고가 새 구독을 걷어내지 않게, 여전히 내가 현재 채널일 때만(#334).
      if (this.channels.get(documentId) === channel) this.channels.delete(documentId);
      void this.client.removeChannel(channel);
    };
  }

  /** 앱의 프로필명 규칙(0015)과 같은 순서 — 이메일 전체는 남기지 않는다. */
  private displayNameOf(meta: Record<string, unknown> | undefined, email: string | null | undefined): string {
    const m = meta ?? {};
    return (
      (typeof m.display_name === 'string' && m.display_name.trim()) ||
      (typeof m.name === 'string' && m.name.trim()) ||
      (email ?? '').split('@')[0] ||
      '알 수 없음'
    );
  }

  /** 다른 접속자에게 "바뀌었다"고 알린다 — 구독 중이 아니면(혼자 쓰는 문서) 보낼 곳도 없다. */
  private ping(documentId: string): void {
    const ch = this.channels.get(documentId);
    if (!ch) return;
    void ch.send({ type: 'broadcast', event: 'changed', payload: {} });
  }
}

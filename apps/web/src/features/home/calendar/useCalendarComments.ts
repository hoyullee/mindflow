// 일정 상세 팝업의 댓글 열이 쓰는 호스트 — 에디터의 그 댓글 열(`CommentThreads`)을
// 홈에서 그대로 쓰기 위한 어댑터다.
//
// 왜 어댑터인가: 댓글 열은 `CommentHost`(목록·작성·삭제·좋아요·내 이름/사진·테마)만
// 요구하고, 에디터 컨트롤러는 그 모양을 이미 갖고 있다. 홈은 문서를 열지 않으므로
// 컨트롤러가 없고, 대신 **댓글 포트를 직접** 그 모양으로 감싼다 — 목록·작성·좋아요·
// 멘션·실시간이 두 화면에서 한 코드다(같은 것을 두 벌로 두지 않는다).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCommentStore } from '../../../adapters/BackendContext';
import { useAuthUser } from '../../../adapters/useAuthUser';
import { useProfileName } from '../../../adapters/useProfileName';
import type { CommentHost } from '../../editor/components/CommentPanel';
import type { CommentMention, DocComment } from '../../../adapters/ports';
import type { Theme } from '../../editor/theme';

export function useCalendarComments(docId: string, theme: Theme): CommentHost {
  const commentStore = useCommentStore();
  const authUser = useAuthUser();
  const profileName = useProfileName(authUser?.email ?? null, authUser?.name ?? null);
  const [comments, setComments] = useState<DocComment[]>([]);
  const [loading, setLoading] = useState(true);
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    if (!docId) return;
    try {
      const list = await commentStore.list(docId);
      if (aliveRef.current) setComments(list);
    } catch {
      /* 못 읽으면 빈 목록 — 팝업의 다른 부분은 그대로 뜬다 */
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [commentStore, docId]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  // 남의 새 글은 팝업을 열 때 다시 읽는다(+ 실시간 신호가 오면 그때도).
  useEffect(() => {
    if (!docId || !commentStore.subscribe) return;
    return commentStore.subscribe(docId, () => void reload());
  }, [commentStore, docId, reload]);

  const myName = profileName || authUser?.name || authUser?.email?.split('@')[0] || '나';

  return useMemo(
    () => ({
      uiTheme: theme,
      docId,
      comments,
      commentsLoading: loading,
      myName,
      myAvatar: authUser?.avatarUrl ?? null,
      addComment: async (nodeId: string, body: string, opts?: { parentId?: string; mentions?: CommentMention[] }) => {
        const res = await commentStore.add(docId, nodeId, body, opts);
        if (!res.error) await reload();
        return res;
      },
      removeComment: async (commentId: string) => {
        const res = await commentStore.remove(docId, commentId);
        if (!res.error) await reload();
        return res;
      },
      likeComment: async (commentId: string, liked: boolean) => {
        const res = await commentStore.setLiked(docId, commentId, liked);
        if (!res.error) await reload();
        return res;
      },
      // `closeComments`는 두지 않는다 — 이 열은 모달 안이라 Escape는 모달의 것이다.
    }),
    [theme, docId, comments, loading, myName, authUser?.avatarUrl, commentStore, reload],
  );
}

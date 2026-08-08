// 주제(노드)에 붙는 댓글 패널.
//
// 자리: 데스크톱은 **오른쪽**(속성 패널이 왼쪽이라 둘이 함께 떠도 부딪히지 않는다.
// 위로는 접속자 아바타, 아래로는 미니맵/줌 묶음을 피한다), 모바일은 바텀 시트.
//
// 대상은 "지금 고른 주제" 하나다 — 주제를 바꾸면 패널이 따라간다(useEditorState).
// 문서 전체 댓글은 루트 주제의 댓글로 대신한다(0020의 설계 메모 참고).

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { EditorController } from '../useEditorState';
import { panelTitleLine } from './panel/panelPrimitives';
import { CommentIcon } from './ToolbarMenus';
import { formatFullDateTime, formatLastEdited } from '../../home/timeFormat';
import { useIsMobile } from '../../../hooks/useMediaQuery';

export function CommentPanel({ controller }: { controller: EditorController }) {
  const th = controller.uiTheme;
  const isMobile = useIsMobile();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLTextAreaElement | null>(null);
  const nodeId = controller.commentsNodeId;

  // 대상 주제가 바뀌면 쓰던 글은 그 주제의 것이므로 비운다(엉뚱한 주제에 달리지 않게).
  useEffect(() => {
    setDraft('');
    setError(null);
  }, [nodeId]);

  // 열면 바로 쓸 수 있게 — 다만 모바일에서는 포커스가 곧 키보드라, 읽으러 연 사람의
  // 화면 절반을 빼앗는다. 데스크톱만.
  useEffect(() => {
    if (controller.commentsOpen && !isMobile) boxRef.current?.focus();
  }, [controller.commentsOpen, isMobile]);

  if (!controller.commentsOpen) return null;

  const node = controller.doc.nodes[nodeId];
  // 주제가 지워져도 댓글은 남는다(0020) — 대상이 사라졌음을 그대로 말해 준다.
  const title = node ? panelTitleLine(node.text) : '사라진 주제';
  const list = controller.comments.filter((c) => c.nodeId === nodeId);

  const submit = async () => {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    const res = await controller.addComment(nodeId, body);
    setBusy(false);
    if (res.error) setError(res.error);
    else {
      setDraft('');
      setError(null);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter는 **줄바꿈**이다 — 소프트 키보드에는 Shift가 없어서 Enter를 등록으로
    // 쓰면 폰에서 여러 줄을 쓸 방법이 사라진다(#333과 같은 이유). 등록은 버튼과
    // Ctrl/⌘+Enter.
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void submit();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      controller.closeComments();
    }
  };

  const wrap: CSSProperties = isMobile
    ? {
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        width: '100%',
        height: '55dvh',
        border: `1px solid ${th.border}`,
        borderBottom: 'none',
        borderRadius: '16px 16px 0 0',
        boxShadow: '0 -8px 30px rgba(0,0,0,.14)',
        zIndex: 27,
        background: th.panel,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }
    : {
        position: 'absolute',
        right: 16,
        top: 80,
        width: 288,
        // 아래로는 미니맵/줌 묶음(우하단)을 피한다 — 미니맵이 접혀 있으면 더 길게.
        maxHeight: `calc(100% - ${80 + (controller.showMinimap ? 190 : 68)}px)`,
        border: `1px solid ${th.border}`,
        borderRadius: 14,
        boxShadow: '0 8px 30px rgba(0,0,0,.10)',
        zIndex: 16,
        background: th.panel,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      };

  return (
    <aside style={wrap} data-comment-panel aria-label="댓글">
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 12px', borderBottom: `1px solid ${th.border}` }}>
        <span style={{ color: th.accent, display: 'flex' }}>
          <CommentIcon size={15} />
        </span>
        <div style={{ flex: '1 1 auto', minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: th.text }}>댓글</div>
          <div title={node?.text} style={{ fontSize: 11.5, color: th.subtext, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {title}
          </div>
        </div>
        <button
          type="button"
          className="mf-ed-btn"
          onClick={controller.closeComments}
          aria-label="댓글 닫기"
          title="닫기"
          style={{ width: isMobile ? 44 : 26, height: isMobile ? 44 : 26, border: 'none', background: 'transparent', color: th.subtext, borderRadius: 7, cursor: 'pointer', fontSize: 15, fontFamily: 'inherit' }}
        >
          ✕
        </button>
      </header>

      <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '10px 12px' }} data-comment-list>
        {controller.commentsLoading && !list.length ? (
          <div style={{ fontSize: 12, color: th.subtext, padding: '10px 0' }}>불러오는 중…</div>
        ) : list.length ? (
          list.map((c) => (
            <article key={c.id} data-comment-item style={{ padding: '9px 0', borderBottom: `1px solid ${th.border}` }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: th.text, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.authorName || '알 수 없음'}</span>
                <span title={formatFullDateTime(c.createdAt)} style={{ fontSize: 11, color: th.subtext, flex: '1 1 auto' }}>
                  {formatLastEdited(c.createdAt)}
                </span>
                {c.mine && (
                  <button
                    type="button"
                    className="mf-ed-btn"
                    aria-label="댓글 삭제"
                    title="삭제"
                    onClick={() => void controller.removeComment(c.id)}
                    style={{ border: 'none', background: 'transparent', color: th.subtext, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', padding: isMobile ? '8px 6px' : '2px 4px', borderRadius: 6 }}
                  >
                    삭제
                  </button>
                )}
              </div>
              <div style={{ fontSize: 12.5, lineHeight: 1.55, color: th.text, whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: 3 }}>{c.body}</div>
            </article>
          ))
        ) : (
          <div style={{ fontSize: 12, color: th.subtext, lineHeight: 1.6, padding: '10px 0' }}>
            아직 댓글이 없어요.
            <br />이 주제에 대한 의견을 남겨 보세요.
          </div>
        )}
      </div>

      <div style={{ borderTop: `1px solid ${th.border}`, padding: isMobile ? '10px 12px calc(10px + env(safe-area-inset-bottom, 0px))' : '10px 12px' }}>
        {error && <div style={{ fontSize: 11.5, color: '#d92626', marginBottom: 6 }}>{error}</div>}
        <textarea
          ref={boxRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          maxLength={2000}
          placeholder="댓글 남기기"
          aria-label="댓글 입력"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            resize: 'none',
            border: `1px solid ${th.border}`,
            borderRadius: 9,
            background: th.panel2,
            color: th.text,
            fontFamily: 'inherit',
            fontSize: 12.5,
            lineHeight: 1.5,
            padding: '8px 9px',
            outline: 'none',
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 7 }}>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!draft.trim() || busy}
            title="Ctrl/⌘ + Enter"
            style={{
              border: 'none',
              borderRadius: 8,
              padding: isMobile ? '11px 18px' : '7px 14px',
              minHeight: isMobile ? 44 : undefined,
              fontFamily: 'inherit',
              fontSize: 12,
              fontWeight: 700,
              cursor: !draft.trim() || busy ? 'default' : 'pointer',
              background: !draft.trim() || busy ? th.border : th.accent,
              color: !draft.trim() || busy ? th.subtext : th.accentInk,
            }}
          >
            남기기
          </button>
        </div>
      </div>
    </aside>
  );
}

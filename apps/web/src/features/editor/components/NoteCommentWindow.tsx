// 공책 **본문 댓글 창**(스펙 6-4) — 형광 부분 옆에 서는 328px 상자.
//
// 페이지 댓글(우측 열)과 **같은 저장소**를 쓴다: 뿌리 댓글의 대상 id가 `nm:<스레드id>`일
// 뿐이다(`noteComment.ts` 머리말). 그래서 답글·멘션·해결·삭제가 전부 이미 있는 길이고,
// 이 파일이 새로 하는 일은 **자리와 모양**뿐이다.
//
// 입력칸은 페이지 댓글과 같은 `CommentComposer`를 쓴다 — 멘션 자동완성·강조·Enter 규칙이
// 한 벌이어야 "댓글인데 여기서만 @가 안 된다"가 생기지 않는다. 스펙은 `⌘Enter 보내기`만
// 적었지만 그 부품은 Enter로도 보낸다(앱 전체가 그렇다) — 줄바꿈은 Shift+Enter다.

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { CommentMention, DocComment, ShareParticipant } from '../../../adapters/ports';
import { CommentComposer } from './CommentPanel';
import { Avatar } from './commentPinShape';
import { formatLastEdited } from '../../home/timeFormat';
import { COMMENT_BOX_W, commentBoxPos, threadNodeId } from '../noteComment';
import type { EditorController } from '../useEditorState';

/** 형광 조각들을 하나로 묶은 화면 사각형 — 한 스레드가 서식 경계로 갈려도 기준은 하나다. */
export function markRect(threadId: string): { left: number; top: number; bottom: number } | null {
  if (typeof document === 'undefined') return null;
  const els = [...document.querySelectorAll<HTMLElement>('[data-cm]')].filter((el) => el.getAttribute('data-cm') === threadId);
  if (!els.length) return null;
  const rects = els.map((el) => el.getBoundingClientRect());
  return {
    left: Math.min(...rects.map((r) => r.left)),
    top: Math.min(...rects.map((r) => r.top)),
    bottom: Math.max(...rects.map((r) => r.bottom)),
  };
}

const HEAD_BTN: CSSProperties = {
  height: 26,
  flex: '0 0 auto',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '0 9px',
  borderRadius: 99,
  fontFamily: 'inherit',
  fontSize: 11,
  fontWeight: 800,
  cursor: 'pointer',
};

export function NoteCommentWindow({
  controller,
  threadId,
  quote,
  participants,
  onClose,
}: {
  controller: EditorController;
  threadId: string;
  /** 인용 — **지금 본문**에서 읽은 글이다(스냅샷이 아니다). */
  quote: string;
  participants: ShareParticipant[];
  /** `wrote`는 이 창이 살아 있는 동안 댓글이 하나라도 달렸는가 — 닫는 쪽이 형광을
   *  되돌릴지 가른다(6-4: 아무 댓글도 쓰지 않고 닫으면 형광과 스레드를 같이 없앤다). */
  onClose: (wrote: boolean) => void;
}) {
  const node = threadNodeId(threadId);
  const mine = controller.comments.filter((c) => c.nodeId === node);
  const root: DocComment | undefined = mine.find((c) => !c.parentId);
  const replies = root ? mine.filter((c) => c.parentId === root.id) : [];
  const items = root ? [root, ...replies] : [];
  const [wrote, setWrote] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState(() => commentBoxPos({ left: 0, top: 0, bottom: 0 }, 1, 1));

  // 자리는 형광에 붙는다 — 스크롤·리사이즈에 따라간다(본문이 움직이면 창도 움직인다).
  useLayoutEffect(() => {
    const place = (): void => {
      const r = markRect(threadId);
      if (r) setPos(commentBoxPos(r, window.innerWidth, window.innerHeight));
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [threadId, items.length]);

  // 바깥 클릭으로 닫는다 — 형광과 패널 카드는 예외다(그쪽이 스레드를 **바꿔** 연다).
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      const t = e.target as HTMLElement | null;
      if (boxRef.current?.contains(t as Node)) return;
      if (t?.closest?.('[data-cm]') || t?.closest?.('[data-cm-card]')) return;
      onClose(wrote);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose(wrote);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose, wrote]);

  const send = async (body: string, mentions: CommentMention[]): Promise<boolean> => {
    const res = await controller.addComment(node, body, root ? { parentId: root.id, mentions } : { mentions });
    if (res.error) return false;
    setWrote(true);
    return true;
  };

  return createPortal(
    <div
      ref={boxRef}
      data-note-cm-window
      data-cm-place={pos.place}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: pos.left,
        ...(pos.top === null ? { bottom: pos.bottom ?? 0 } : { top: pos.top }),
        zIndex: 120,
        width: COMMENT_BOX_W,
        maxHeight: pos.maxHeight,
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        borderRadius: 14,
        background: 'var(--mf-card)',
        border: '1px solid var(--mf-border-soft)',
        boxShadow: '0 22px 44px -22px rgba(46,42,38,.5)',
        animation: 'mf-note-pop .13s ease both',
      }}
    >
      {/* 머리 — 무엇에 단 댓글인지(인용)와 해결·닫기 */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '11px 10px 10px 13px', borderBottom: '1px solid var(--mf-border-soft)' }}>
        <div style={{ flex: '1 1 auto', minWidth: 0 }}>
          <span data-cm-label style={{ display: 'block', fontSize: 10, fontWeight: 800, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--mf-faint)' }}>
            {items.length ? `댓글 ${items.length}개` : '새 댓글'}
          </span>
          <span
            data-cm-quote
            style={{
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              marginTop: 4,
              paddingLeft: 8,
              borderLeft: '2px solid var(--mf-note-cm-line-on)',
              fontSize: 12,
              lineHeight: 1.5,
              color: 'var(--mf-subtext)',
              wordBreak: 'keep-all',
            }}
          >
            {quote || '원문이 지워졌어요'}
          </span>
        </div>
        {root && (
          <button
            type="button"
            data-cm-resolve
            onClick={() => {
              void controller.resolveComment(root.id, true);
              onClose(true);
            }}
            style={{ ...HEAD_BTN, border: '1px solid #e5eedf', background: '#f4f9f1', color: '#4e8c67' }}
          >
            ✓ 해결
          </button>
        )}
        <button
          type="button"
          data-cm-close
          aria-label="닫기"
          onClick={() => onClose(wrote)}
          style={{ ...HEAD_BTN, width: 26, padding: 0, justifyContent: 'center', border: 0, background: 'transparent', color: 'var(--mf-faint)', fontSize: 14 }}
        >
          ×
        </button>
      </div>

      {items.length > 0 && (
        <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '12px 13px 4px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {items.map((c) => (
            <div key={c.id} data-cm-item style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <Avatar name={c.authorName} size={24} />
              <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--mf-text)' }}>{c.authorName || '알 수 없음'}</span>
                <span style={{ marginLeft: 6, fontSize: 10.5, color: 'var(--mf-faint)' }}>{formatLastEdited(c.createdAt)}</span>
                <p style={{ margin: '2px 0 0', fontSize: 12.5, lineHeight: 1.6, color: 'var(--mf-text)', whiteSpace: 'pre-wrap', wordBreak: 'keep-all' }}>{c.body}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ flex: '0 0 auto', padding: '10px 12px 12px' }}>
        <CommentComposer
          controller={controller}
          isMobile={false}
          participants={participants}
          placeholder={root ? '답글 달기 · @로 사람 부르기' : '이 부분에 대한 의견을 남겨 주세요'}
          inputLabel={root ? '답글 입력' : '본문 댓글 입력'}
          submitLabel={root ? '답글' : '댓글 달기'}
          autoFocus
          compact
          onSubmit={send}
        />
        <span style={{ display: 'block', marginTop: 6, fontSize: 10.5, color: 'var(--mf-faint)' }}>⌘Enter 보내기 · Esc 닫기</span>
      </div>
    </div>,
    document.body,
  );
}

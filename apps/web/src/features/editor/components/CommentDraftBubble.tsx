// 첫 댓글 말풍선(요청 ④ — Figma 방식).
//
// 댓글 도구로 캔버스를 누르면 **핀이 바로 생기지 않는다**: 이 말풍선이 그 자리에 떠서
// 첫 마디를 받고, 저장에 성공해야 핀이 문서에 들어간다(`submitCommentDraft`). 그래서
// 쓰지 않고 다른 곳을 누르면 지울 것도 없다(요청 ⑤ — 미작성 핀 즉시 제거).
//
// 자리는 화면 좌표다(팬/줌 레이어 밖) — 확대해도 입력칸 글자 크기가 그대로여야
// 하므로. 팬/줌이 바뀌면 다시 계산돼 핀 자리를 따라간다(`commentAnchor`).

import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { EditorController } from '../useEditorState';
import { CARD_SHADOW, accentGradient, glassCard } from '../chrome';
import { CommentIcon } from './ToolbarMenus';
import { CommentComposer, useCommentParticipants } from './CommentPanel';
import { anchoredBoxPos, pinScreenPos } from './commentAnchor';
import { useIsMobile } from '../../../hooks/useMediaQuery';

const BUBBLE_W = 280;
const BUBBLE_H = 132;

export function CommentDraftBubble({ controller }: { controller: EditorController }) {
  const th = controller.uiTheme;
  const isMobile = useIsMobile();
  const draft = controller.commentDraft;
  const participants = useCommentParticipants(controller.docId, !!draft);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // 바깥을 누르면 접는다(요청 ⑤) — 문서에는 아무것도 남지 않는다. 캡처 단계에서
  // 듣는 이유: 캔버스의 포인터 핸들러가 먼저 돌아 이 요소를 언마운트해 버리면
  // `contains` 판정이 늘 false가 된다.
  useEffect(() => {
    if (!draft) return;
    const onDown = (e: PointerEvent): void => {
      const el = rootRef.current;
      if (el && e.target instanceof globalThis.Node && el.contains(e.target)) return;
      controller.cancelCommentDraft();
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [draft, controller]);

  if (!draft) return null;

  const p = pinScreenPos({ pan: controller.pan, zoom: controller.zoom, vw: controller.vw, vh: controller.vh }, draft);
  const { left, top } = anchoredBoxPos({ pan: controller.pan, zoom: controller.zoom, vw: controller.vw, vh: controller.vh }, draft, BUBBLE_W, BUBBLE_H);

  const card: CSSProperties = {
    position: 'absolute',
    left,
    top,
    width: BUBBLE_W,
    padding: 10,
    borderRadius: 16,
    ...glassCard(th, 0.98),
    boxShadow: CARD_SHADOW,
    zIndex: 130, // 도구 막대(120)보다 위 — 방금 켠 도구가 만든 입력칸이다
  };

  return (
    <>
      {/* 초안 핀 — 확정된 핀과 같은 물방울이되 아직 문서에 없다는 뜻으로 점선 테두리. */}
      <div
        aria-hidden
        data-comment-draft-pin
        style={{
          position: 'absolute',
          left: p.x,
          top: p.y,
          width: 28,
          height: 28,
          transform: 'translate(0, -100%)',
          borderRadius: '999px 999px 999px 4px',
          background: accentGradient(th),
          color: th.accentInk,
          border: `2px dashed ${th.panel}`,
          boxShadow: '0 6px 16px rgba(46,42,38,.3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 129,
          pointerEvents: 'none',
        }}
      >
        <CommentIcon size={12} />
      </div>

      <div
        ref={rootRef}
        data-comment-draft
        role="dialog"
        aria-label="첫 댓글 남기기"
        style={card}
        // `.mf-ed-vp`가 배경 드래그를 소유한다 — 새어 나가면 마퀴가 포인터를 캡처해
        // 버튼이 click을 영영 못 받는다(ContextMenu·BoardToolbar와 같은 함정).
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            controller.cancelCommentDraft();
          }
        }}
      >
        <CommentComposer
          controller={controller}
          isMobile={isMobile}
          participants={participants}
          placeholder="댓글 남기기 (@로 멘션)"
          submitLabel="남기기"
          autoFocus
          compact
          onSubmit={async (body, mentions) => {
            const res = await controller.submitCommentDraft(body, mentions);
            return !res.error;
          }}
        />
      </div>
    </>
  );
}

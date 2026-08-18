// 첫 댓글 **말풍선**과 댓글 도구 오버레이(Figma 방식, 요청).
//
// 예전에는 댓글 버튼을 누르면 곧바로 핀이 문서에 꽂히고 팝업이 열렸다. 그러면
// "댓글이 하나도 없는 핀"이라는 상태가 생기고, 그걸 나중에 정리하는 효과가
// 목록이 도착하기 전(문서 로드 직후)에 멀쩡한 핀을 지우는 사고를 냈다(제보:
// 댓글이 저장되지 않는다). 지금은 순서가 뒤집혀 있다 —
//
//   ① 도구를 켜면 커서가 댓글 아이콘이 된다
//   ② 캔버스를 누른 자리에 **말풍선(첫 댓글 입력칸)**만 뜬다(문서는 그대로)
//   ③ 첫 댓글이 **저장에 성공한 순간** 그 자리에 핀이 생긴다
//   ④ 쓰지 않고 다른 곳을 누르면 말풍선은 흔적 없이 사라진다
//
// 그래서 "빈 핀"이라는 상태 자체가 없고, 정리할 일도 없다.

import type { PointerEvent as ReactPointerEvent } from 'react';
import { useEffect, useRef } from 'react';
import type { EditorController } from '../useEditorState';
import { CommentComposer, useMentionParticipants } from './CommentPanel';
import { CommentIcon } from './ToolbarMenus';
import { accentGradient, CARD_SHADOW, glassCard } from '../chrome';
import { useIsMobile } from '../../../hooks/useMediaQuery';

/** 말풍선 폭(데스크톱) — 댓글 팝업(326)보다 좁게, 한 줄짜리 입력에 맞춘다. */
const BUBBLE_W = 288;

/** 댓글 도구가 켜져 있는 동안 캔버스를 덮어 **첫 클릭만** 받는 오버레이.
 * 그리기 오버레이(BoardDrawLayer)와 같은 방식 — 아래의 선택·드래그 핸들러를
 * 건드리지 않고 얹는 가장 파급 작은 방법이다. */
export function CommentToolLayer({ controller }: { controller: EditorController }) {
  const on = controller.commentTool;
  const setCommentTool = controller.setCommentTool;
  useEffect(() => {
    if (!on) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setCommentTool(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [on, setCommentTool]);

  if (!on) return null;

  const onDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0 && e.pointerType === 'mouse') return; // 우클릭/휠클릭은 취소
    e.stopPropagation(); // `.mf-ed-vp`로 새면 배경 마퀴가 포인터를 가져간다
    controller.startCommentDraftAtClient(e.clientX, e.clientY);
  };

  return (
    <div
      data-comment-tool-layer
      onPointerDown={onDown}
      onContextMenu={(e) => {
        e.preventDefault();
        controller.setCommentTool(false);
      }}
      style={{ position: 'absolute', inset: 0, zIndex: 105, cursor: 'crosshair', touchAction: 'none' }}
    />
  );
}

/** 첫 댓글 말풍선 — 화면 좌표계(팬/줌 레이어 **밖**)라 확대해도 글자 크기가 같다. */
export function CommentDraftBubble({ controller }: { controller: EditorController }) {
  const th = controller.uiTheme;
  const isMobile = useIsMobile();
  const draft = controller.commentDraft;
  // 말풍선이 떠 있을 때만 참가자를 읽는다 — 쓰지도 않을 요청을 매 화면에서 내지 않는다.
  const participants = useMentionParticipants(controller.docId, !!controller.commentDraft);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const cancel = controller.cancelCommentDraft;

  // 바깥을 누르거나 Escape면 사라진다 — 쓰지 않은 말풍선은 남기지 않는다(요청).
  useEffect(() => {
    if (!draft) return;
    const onDown = (e: PointerEvent): void => {
      const el = boxRef.current;
      if (el && e.target instanceof globalThis.Node && el.contains(e.target)) return;
      cancel();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') cancel();
    };
    // 캡처 단계 — 배경 핸들러가 먼저 포인터를 캡처해 버려도 취소는 놓치지 않는다.
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [draft, cancel]);

  if (!draft) return null;

  const sx = controller.pan.x + draft.x * controller.zoom;
  const sy = controller.pan.y + draft.y * controller.zoom;
  const vw = controller.vw || 1200;
  const vh = controller.vh || 800;
  const gap = 12;
  const w = isMobile ? Math.min(BUBBLE_W, vw - 2 * gap) : BUBBLE_W;
  // 표식(30px 물방울) 오른쪽에 붙는다 — 겹치면 무엇을 가리키는지 흐려진다.
  let left = sx + 38;
  if (left + w + gap > vw) left = sx - w - 10;
  left = Math.max(gap, Math.min(left, Math.max(gap, vw - w - gap)));
  const top = Math.max(gap, Math.min(sy - 34, Math.max(gap, vh - 190)));

  return (
    <>
      {/* 꽂힐 자리 표식 — 실제 핀과 같은 물방울(아직 문서에는 없다). */}
      <div
        data-comment-draft-marker
        aria-hidden
        style={{
          position: 'absolute',
          left: sx,
          top: sy,
          width: 30,
          height: 30,
          transform: 'translate(0, -100%)',
          borderRadius: '999px 999px 999px 5px',
          background: accentGradient(th),
          color: th.accentInk,
          border: `2px solid ${th.panel}`,
          boxShadow: '0 6px 16px rgba(46,42,38,.3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 106,
        }}
      >
        <CommentIcon size={13} />
      </div>
      <div
        ref={boxRef}
        data-comment-draft
        aria-label="첫 댓글"
        style={{
          position: 'absolute',
          left,
          top,
          width: w,
          padding: 10,
          borderRadius: 16,
          ...glassCard(th, 0.98),
          boxShadow: CARD_SHADOW,
          zIndex: 107,
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

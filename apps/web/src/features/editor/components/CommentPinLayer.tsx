// 캔버스에 꽂은 **댓글 핀**(Figma 방식, 요청) — 다른 객체처럼 만들고 옮기고 고른다.
//
// 핀은 자리만 든다(`Doc.commentPins`). 말은 서버 `comments` 표에 **핀 id를 대상으로**
// 그대로 저장되므로 서버는 한 줄도 바뀌지 않는다. 고르면 기존 댓글 팝업이 그 핀의
// 목록을 열고, 핀에는 **댓글 수**가 배지로 붙는다. 댓글이 하나도 없는 핀은 살아남지
// 않는다.
//
// 핀을 만드는 것은 두 걸음이다(요청 ④): 댓글 도구/메뉴가 **초안 핀**을 띄우고,
// 첫 댓글을 남겨야 비로소 문서에 들어간다. 그래서 이 레이어는 확정된 핀만 그리고,
// 초안은 `CommentDraftBubble`이 맡는다 — 모양은 둘이 같다(`commentPinShape`).

import type { PointerEvent as ReactPointerEvent } from 'react';
import { useRef } from 'react';
import type { EditorController } from '../useEditorState';
import { Avatar, CommentPinCount, CommentPinResolved, commentPinBoxStyle } from './commentPinShape';
import { useParticipantAvatars } from '../useParticipantAvatars';

/** 이보다 적게 움직인 포인터는 "클릭"으로 본다 — 끌어 옮긴 뒤에는 팝업을 열지 않는다
 * (제보 ③: 핀을 움직일 때마다 댓글 목록을 다시 불러왔다). */
const CLICK_SLOP = 4;

export function CommentPinLayer({ controller }: { controller: EditorController }) {
  const th = controller.uiTheme;
  const pins = controller.doc.commentPins ?? [];
  // 핀 얼굴은 **첫 글을 쓴 사람**이므로 그 사람의 프로필 이미지를 쓴다(0031).
  // 내 얼굴은 참가자 목록에 없다(멘션 후보에서 나를 뺀다) — 세션에서 직접 온다.
  const avatars = useParticipantAvatars(controller.docId);
  /** 마지막 포인터 조작이 드래그였는가 — 그 뒤에 오는 click을 삼킨다. */
  const draggedRef = useRef(false);
  if (!pins.length) return null;

  return (
    <>
      {pins.map((pin) => {
        // 이 핀의 스레드 = 그 핀을 대상으로 한 글 전부(뿌리 + 답글). 얼굴은 **첫 글을
        // 쓴 사람**이고(시안 ①), 해결 여부는 뿌리 글이 든다.
        const msgs = controller.comments.filter((c) => c.nodeId === pin.id);
        const root = msgs.find((c) => !c.parentId) ?? msgs[0];
        const author = root?.authorName || '?';
        const authorAvatar = root?.mine ? controller.myAvatar : root?.authorId ? (avatars.byUserId[root.authorId] ?? null) : null;
        const resolved = !!root?.resolved;
        const count = msgs.length;
        const selected = controller.selection?.kind === 'commentPin' && controller.selection.id === pin.id;
        const onPointerDown = (e: ReactPointerEvent) => {
          e.stopPropagation();
          if (e.button !== 0) return;
          draggedRef.current = false;
          controller.selectCommentPin(pin.id);
          if (controller.readOnly) return;
          // 끌어서 옮긴다 — 좌표는 **원본 기준**으로 매번 다시 계산한다(누적하지 않는다).
          const start = { x: e.clientX, y: e.clientY, ox: pin.x, oy: pin.y };
          const zoom = controller.zoom;
          const move = (ev: PointerEvent): void => {
            if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > CLICK_SLOP) draggedRef.current = true;
            controller.moveCommentPin(pin.id, start.ox + (ev.clientX - start.x) / zoom, start.oy + (ev.clientY - start.y) / zoom);
          };
          const up = (): void => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
          };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        };
        return (
          <div
            key={pin.id}
            data-comment-pin={pin.id}
            role="button"
            tabIndex={0}
            aria-label={`스레드 ${count}개${resolved ? ' (해결됨)' : ''}`}
            title={resolved ? `${author} · 해결된 스레드` : `${author} · 스레드 ${count}개`}
            onPointerDown={onPointerDown}
            // 키보드로도 연다 — `role="button"`·`tabIndex`를 달아 놓고 Enter가 아무
            // 일도 하지 않으면 초점만 받고 마는 버튼이 된다.
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                controller.selectCommentPin(pin.id);
                controller.openComments(pin.id);
              }
            }}
            onClick={(e) => {
              e.stopPropagation();
              // 옮긴 직후의 click은 "열기"가 아니다 — 여기서 팝업을 열면 드래그를
              // 놓을 때마다 댓글 목록을 서버에서 다시 읽는다(제보 ③).
              if (draggedRef.current) {
                draggedRef.current = false;
                return;
              }
              controller.openComments(pin.id);
            }}
            style={{
              position: 'absolute',
              left: pin.x,
              top: pin.y,
              zIndex: 30,
              cursor: 'grab',
              // 얼굴이 주인공이라 평소엔 흰 바탕, 고른 핀만 강조색으로 도드라진다(시안 ①).
              ...commentPinBoxStyle(th, selected, 1, selected ? 'accent' : 'panel', false),
              opacity: resolved ? 0.72 : 1,
            }}
          >
            {/* 얼굴이 핀을 거의 채운다(시안 ① 실측 비율 0.81) — 예전 24는 흰 여백이
                넓어 얼굴이 작은 점처럼 보였다. 고른 핀은 반투명 흰 얼굴(시안 ②). */}
            <Avatar name={author} size={28} onAccent={selected} src={authorAvatar} />
            {resolved ? <CommentPinResolved th={th} /> : <CommentPinCount count={count} th={th} onAccent={selected} />}
          </div>
        );
      })}
    </>
  );
}

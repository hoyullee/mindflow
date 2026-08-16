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
import { CommentPinCount, CommentPinGlyph, commentPinBoxStyle } from './commentPinShape';

/** 이보다 적게 움직인 포인터는 "클릭"으로 본다 — 끌어 옮긴 뒤에는 팝업을 열지 않는다
 * (제보 ③: 핀을 움직일 때마다 댓글 목록을 다시 불러왔다). */
const CLICK_SLOP = 4;

export function CommentPinLayer({ controller }: { controller: EditorController }) {
  const th = controller.uiTheme;
  const pins = controller.doc.commentPins ?? [];
  /** 마지막 포인터 조작이 드래그였는가 — 그 뒤에 오는 click을 삼킨다. */
  const draggedRef = useRef(false);
  if (!pins.length) return null;

  return (
    <>
      {pins.map((pin) => {
        const count = controller.comments.filter((c) => c.nodeId === pin.id).length;
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
            aria-label={`댓글 핀 ${count}개`}
            title={count ? `댓글 ${count}개` : '댓글 핀'}
            onPointerDown={onPointerDown}
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
            style={{ position: 'absolute', left: pin.x, top: pin.y, zIndex: 30, cursor: 'grab', ...commentPinBoxStyle(th, selected) }}
          >
            <CommentPinGlyph />
            <CommentPinCount count={count} th={th} />
          </div>
        );
      })}
    </>
  );
}

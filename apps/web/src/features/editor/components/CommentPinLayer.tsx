// 캔버스에 꽂은 **댓글 핀**(Figma 방식, 요청) — 다른 객체처럼 만들고 옮기고 고른다.
//
// 핀은 자리만 든다(`Doc.commentPins`). 말은 서버 `comments` 표에 **핀 id를 대상으로**
// 그대로 저장되므로 서버는 한 줄도 바뀌지 않는다. 고르면 기존 댓글 팝업이 그 핀의
// 목록을 열고, 핀에는 **댓글 수**가 적힌다. 핀은 첫 댓글이 저장된 뒤에 생기고
// (`startCommentDraft` → `submitCommentDraft`), 마지막 댓글이 지워지면 함께 사라진다.

import type { PointerEvent as ReactPointerEvent } from 'react';
import { useRef } from 'react';
import type { EditorController } from '../useEditorState';
import { accentGradient } from '../chrome';
import { CommentIcon } from './ToolbarMenus';

/** 클릭과 드래그를 가르는 문턱(px) — 이보다 덜 움직였으면 "누른 것"이다. */
const DRAG_SLOP = 3;

export function CommentPinLayer({ controller }: { controller: EditorController }) {
  const th = controller.uiTheme;
  const pins = controller.doc.commentPins ?? [];
  const movedRef = useRef(false);
  if (!pins.length) return null;

  return (
    <>
      {pins.map((pin) => {
        const count = controller.comments.filter((c) => c.nodeId === pin.id).length;
        const selected = controller.selection?.kind === 'commentPin' && controller.selection.id === pin.id;
        const onPointerDown = (e: ReactPointerEvent) => {
          e.stopPropagation();
          if (e.button !== 0) return;
          controller.selectCommentPin(pin.id);
          movedRef.current = false;
          // 끌어서 옮긴다 — 좌표는 **원본 기준**으로 매번 다시 계산한다(누적하지 않는다).
          const start = { x: e.clientX, y: e.clientY, ox: pin.x, oy: pin.y };
          const zoom = controller.zoom;
          const move = (ev: PointerEvent): void => {
            if (!movedRef.current && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_SLOP) return;
            movedRef.current = true;
            if (controller.readOnly) return;
            controller.moveCommentPin(pin.id, start.ox + (ev.clientX - start.x) / zoom, start.oy + (ev.clientY - start.y) / zoom);
          };
          const up = (): void => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            // **옮긴 것이 아니라 누른 것일 때만** 팝업을 연다 — 예전에는 드래그
            // 끝의 클릭까지 팝업을 열어 옮길 때마다 댓글을 다시 불러왔다(제보).
            if (!movedRef.current) controller.openComments(pin.id);
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
            aria-label={`댓글 ${count}개`}
            title={count ? `댓글 ${count}개` : '댓글'}
            onPointerDown={onPointerDown}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                controller.openComments(pin.id);
              }
            }}
            style={{
              position: 'absolute',
              left: pin.x,
              top: pin.y,
              // 물방울 모양: 왼쪽 아래 꼭짓점이 가리키는 지점(지도 핀 관례).
              minWidth: 30,
              height: 30,
              padding: '0 9px',
              borderRadius: '999px 999px 999px 5px',
              background: accentGradient(th),
              color: th.accentInk,
              border: `2px solid ${th.panel}`,
              boxShadow: selected ? `0 0 0 3px ${th.accent}40, 0 6px 16px rgba(46,42,38,.35)` : '0 6px 16px rgba(46,42,38,.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              fontSize: 12,
              fontWeight: 800,
              cursor: 'grab',
              userSelect: 'none',
              zIndex: 30,
              transform: 'translate(0, -100%)',
            }}
          >
            {/* 댓글 팝업 머리와 **같은 아이콘**(요청) — 같은 것을 가리키는 표식은 하나. */}
            <CommentIcon size={13} />
            {count > 0 && <span data-pin-count>{count}</span>}
          </div>
        );
      })}
    </>
  );
}

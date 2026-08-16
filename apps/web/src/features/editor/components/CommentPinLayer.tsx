// 캔버스에 꽂은 **댓글 핀**(Figma 방식, 요청) — 다른 객체처럼 만들고 옮기고 고른다.
//
// 핀은 자리만 든다(`Doc.commentPins`). 말은 서버 `comments` 표에 **핀 id를 대상으로**
// 그대로 저장되므로 서버는 한 줄도 바뀌지 않는다. 고르면 기존 댓글 팝업이 그 핀의
// 목록을 열고, 핀에는 **댓글 수**가 적힌다. 댓글이 하나도 없는 핀은 살아남지 않는다.

import type { PointerEvent as ReactPointerEvent } from 'react';
import type { EditorController } from '../useEditorState';
import { accentGradient } from '../chrome';

export function CommentPinLayer({ controller }: { controller: EditorController }) {
  const th = controller.uiTheme;
  const pins = controller.doc.commentPins ?? [];
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
          if (controller.readOnly) return;
          // 끌어서 옮긴다 — 좌표는 **원본 기준**으로 매번 다시 계산한다(누적하지 않는다).
          const start = { x: e.clientX, y: e.clientY, ox: pin.x, oy: pin.y };
          const zoom = controller.zoom;
          const move = (ev: PointerEvent): void => {
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
              controller.openComments(pin.id);
            }}
            style={{
              position: 'absolute',
              left: pin.x,
              top: pin.y,
              // 물방울 모양: 왼쪽 아래 꼭짓점이 가리키는 지점(지도 핀 관례).
              minWidth: 28,
              height: 28,
              padding: '0 8px',
              borderRadius: '999px 999px 999px 4px',
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
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M21 12a8 8 0 0 1-8 8H8l-4 3v-6a8 8 0 0 1 8-8h1a8 8 0 0 1 8 3z" />
            </svg>
            {count > 0 && <span data-pin-count>{count}</span>}
          </div>
        );
      })}
    </>
  );
}

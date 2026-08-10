// 댓글 개수 배지 — 주제(NodeLayer)의 배지와 같은 문법을 메모·선·영역에도.
// 누르면 그 객체의 댓글 패널이 열린다(배지는 표시이자 진입점 — 0020).
import type { CSSProperties } from 'react';
import { isPanButton } from '../pointerButtons';

export function CommentBadge({ id, count, accent, panel, onOpen, style }: { id: string; count: number; accent: string; panel: string; onOpen: () => void; style: CSSProperties }) {
  return (
    <div
      role="button"
      tabIndex={-1}
      data-comment-badge={id}
      title={`댓글 ${count}개`}
      aria-label={`댓글 ${count}개`}
      style={{
        minWidth: 18,
        height: 18,
        boxSizing: 'border-box',
        padding: '0 4px',
        borderRadius: 999,
        background: panel,
        border: `1.5px solid ${accent}`,
        color: accent,
        fontSize: 9.5,
        fontWeight: 700,
        lineHeight: '15px',
        textAlign: 'center',
        fontFamily: 'Pretendard, sans-serif',
        boxShadow: '0 1px 4px rgba(0,0,0,.12)',
        cursor: 'pointer',
        userSelect: 'none',
        ...style,
      }}
      onPointerDown={(e) => {
        if (isPanButton(e)) return; // 우클릭·휠클릭 = 화면 이동
        e.stopPropagation(); // 드래그로 새지 않게
      }}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
    >
      {count}
    </div>
  );
}

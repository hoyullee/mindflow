import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';

/**
 * 노드/메모/영역 공용 크기 조절 핸들. 시각적 크기(13px)는 그대로 두고
 * **포인터 판정 영역만 28px**로 넓힌다 — 13px 핸들은 데스크톱에서도 빗맞히기
 * 쉬웠고, 빗맞히면 그 아래 객체의 이동 드래그가 시작돼 "크기 조절하려다
 * 도형이 움직이는" 오조작이 났다. 바깥(투명 히트 영역)이 이벤트를 받고
 * 안쪽 상자는 장식이다.
 */
const VISUAL = 13;
const HIT = 28;

interface ResizeHandleProps {
  title: string;
  accent: string;
  panel: string;
  /** 시각 상자의 기존 오프셋(px) — 히트 영역은 이를 중심으로 확장된다. */
  right: number;
  bottom: number;
  zIndex: number;
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onDoubleClick?: (e: ReactMouseEvent<HTMLDivElement>) => void;
}

export function ResizeHandle({ title, accent, panel, right, bottom, zIndex, onPointerDown, onDoubleClick }: ResizeHandleProps) {
  const pad = (HIT - VISUAL) / 2;
  return (
    <div
      title={title}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      style={{
        position: 'absolute',
        right: right - pad,
        bottom: bottom - pad,
        width: HIT,
        height: HIT,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'nwse-resize',
        zIndex,
        touchAction: 'none',
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: VISUAL,
          height: VISUAL,
          borderRadius: 4,
          background: panel,
          border: `2px solid ${accent}`,
          boxSizing: 'border-box',
          boxShadow: '0 1px 4px rgba(0,0,0,.2)',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}

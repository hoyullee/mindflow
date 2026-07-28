import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';

/**
 * 노드/메모/영역 공용 크기 조절 핸들(우하단 모서리). 시각적 크기(13px)는 그대로 두고
 * **포인터 판정 영역만 28px**로 넓힌다 — 13px 핸들은 데스크톱에서도 빗맞히기
 * 쉬웠고, 빗맞히면 그 아래 객체의 이동 드래그가 시작돼 "크기 조절하려다
 * 도형이 움직이는" 오조작이 났다. 바깥(투명 히트 영역)이 이벤트를 받고
 * 안쪽 상자는 장식이다.
 *
 * 한때 오른쪽·아래 변에 축을 고정하는 막대 핸들도 뒀다. "가로로 끌었는데 세로가
 * 튄다"는 제보를 우회하려던 장치였는데, 실제 원인(텍스트 최소 높이의 계단 함수,
 * 분수 `cw`가 건드리는 과팽창 되돌림)을 모서리 드래그 쪽에서 고친 뒤로는 존재
 * 이유가 없어졌다 — 핸들 셋의 28px 히트 영역이 서로 겹쳐 빗맞히는 쪽이 오히려
 * 문제였다. 그래서 다시 모서리 하나로 돌아왔다.
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
        width: HIT,
        height: HIT,
        right: right - pad,
        bottom: bottom - pad,
        cursor: 'nwse-resize',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
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

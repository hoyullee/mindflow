import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';

/**
 * 노드/메모/영역 공용 크기 조절 핸들. 시각적 크기(13px)는 그대로 두고
 * **포인터 판정 영역만 28px**로 넓힌다 — 13px 핸들은 데스크톱에서도 빗맞히기
 * 쉬웠고, 빗맞히면 그 아래 객체의 이동 드래그가 시작돼 "크기 조절하려다
 * 도형이 움직이는" 오조작이 났다. 바깥(투명 히트 영역)이 이벤트를 받고
 * 안쪽 상자는 장식이다.
 *
 * `axis`로 한 방향만 바꾸는 변(邊) 핸들도 만든다. 모서리 하나뿐이던 시절에는
 * 폭만 넓히려 해도 손의 세로 흔들림이 그대로 높이에 들어가 "가로로 조절했는데
 * 세로가 제멋대로 바뀐다"는 제보로 이어졌다 — 축을 고정할 방법 자체가 없었다.
 */
const VISUAL = 13;
const HIT = 28;
/** 변 핸들의 시각 크기 — 모서리(정사각형)와 구분되도록 납작한 막대. */
const BAR_LONG = 18;
const BAR_SHORT = 6;

/** `x`=폭만, `y`=높이만, `both`=모서리(둘 다). */
export type ResizeAxis = 'x' | 'y' | 'both';

interface ResizeHandleProps {
  title: string;
  accent: string;
  panel: string;
  /** 시각 상자의 기존 오프셋(px) — 히트 영역은 이를 중심으로 확장된다. */
  right: number;
  bottom: number;
  zIndex: number;
  /** 기본 `both`(우하단 모서리) — 기존 호출부는 그대로 둔다. */
  axis?: ResizeAxis;
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onDoubleClick?: (e: ReactMouseEvent<HTMLDivElement>) => void;
}

export function ResizeHandle({ title, accent, panel, right, bottom, zIndex, axis = 'both', onPointerDown, onDoubleClick }: ResizeHandleProps) {
  const pad = (HIT - VISUAL) / 2;

  // 변 핸들은 해당 변의 한가운데에 붙는다(가로변=아래 중앙, 세로변=오른쪽 중앙).
  const place: CSSProperties =
    axis === 'x'
      ? { right: right - pad, top: '50%', transform: 'translateY(-50%)', cursor: 'ew-resize' }
      : axis === 'y'
        ? { bottom: bottom - pad, left: '50%', transform: 'translateX(-50%)', cursor: 'ns-resize' }
        : { right: right - pad, bottom: bottom - pad, cursor: 'nwse-resize' };

  const bar: CSSProperties =
    axis === 'x'
      ? { width: BAR_SHORT, height: BAR_LONG }
      : axis === 'y'
        ? { width: BAR_LONG, height: BAR_SHORT }
        : { width: VISUAL, height: VISUAL };

  return (
    <div
      title={title}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      style={{
        position: 'absolute',
        width: HIT,
        height: HIT,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex,
        touchAction: 'none',
        ...place,
      }}
    >
      <div
        aria-hidden="true"
        style={{
          borderRadius: 4,
          background: panel,
          border: `2px solid ${accent}`,
          boxSizing: 'border-box',
          boxShadow: '0 1px 4px rgba(0,0,0,.2)',
          pointerEvents: 'none',
          ...bar,
        }}
      />
    </div>
  );
}

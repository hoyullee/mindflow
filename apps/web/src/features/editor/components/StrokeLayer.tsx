// 자유 그리기 획 렌더(화이트보드 M4) — 팬/줌 변환 레이어 **안**에 놓여 좌표가
// 다른 객체와 같은 캔버스 좌표계다. 획은 보드의 "바닥에 그린 잉크"이므로
// 메모/이미지(FloatLayer)보다 아래에 깔린다(호출부의 렌더 순서).
//
// SVG는 10×10 + overflow:visible — 획들이 어디까지 뻗든 viewBox 계산 없이
// 원시 캔버스 좌표로 그대로 그린다(EdgeLayer와 같은 꼴). **0×0이면 안 된다**:
// SVG 스펙에서 최상위 svg의 width/height 0은 렌더링 자체를 끈다(실브라우저에서
// DOM에는 path가 있는데 화면에 아무것도 안 그려지는 것으로 드러났다).

import type { Stroke } from '@mindflow/mindmap-core';
import { strokePathD } from '@mindflow/mindmap-core';

interface StrokeLayerProps {
  strokes: Stroke[] | undefined;
  /** 그리는 중인 획의 미리보기(컨트롤러 `liveStroke`) — 커밋 전이라 문서에 없다. */
  live: { pts: number[]; color: string; w: number } | null;
}

export function StrokeLayer({ strokes, live }: StrokeLayerProps) {
  const list = strokes ?? [];
  if (!list.length && !live) return null;
  return (
    <svg data-stroke-layer width={10} height={10} overflow="visible" style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }} aria-hidden="true">
      {list.map((s) => (
        <path key={s.id} data-stroke-id={s.id} d={strokePathD(s.pts)} fill="none" stroke={s.color} strokeWidth={s.w} strokeLinecap="round" strokeLinejoin="round" />
      ))}
      {live && live.pts.length >= 2 && <path data-live-stroke d={strokePathD(live.pts)} fill="none" stroke={live.color} strokeWidth={live.w} strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}

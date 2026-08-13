// 자유 그리기 획 렌더(화이트보드 M4) — 팬/줌 변환 레이어 **안**에 놓여 좌표가
// 다른 객체와 같은 캔버스 좌표계다. 손으로 그은 잉크는 **언제나 객체 위**에
// 얹힌다(제보: 메모 뒤로 숨었다) — 종이에 펜으로 덧그리는 감각이고, 가려지면
// 방금 그은 획이 사라진 것처럼 보인다. DOM 순서만으로는 부족해 z-index로
// 못박는다(객체 쪽에 z-index를 쓰는 요소가 있다: 노드 40·라인 25~28·메모 10/20).
// 편집 박스(100)·끌어 올린 노드(200)만 잉크 위 — 지금 만지는 것은 보여야 한다.
//
// SVG는 10×10 + overflow:visible — 획들이 어디까지 뻗든 viewBox 계산 없이
// 원시 캔버스 좌표로 그대로 그린다(EdgeLayer와 같은 꼴). **0×0이면 안 된다**:
// SVG 스펙에서 최상위 svg의 width/height 0은 렌더링 자체를 끈다(실브라우저에서
// DOM에는 path가 있는데 화면에 아무것도 안 그려지는 것으로 드러났다).
//
// 하이라이터(`Stroke.hl`)는 반투명 + **곱하기 합성**이다: 알파만 낮추면 흰 바탕에선
// 그럴듯해도 색 있는 메모 위에서 뿌옇게 뜬다(형광펜은 밑을 가리는 게 아니라 걸러
// 낸다). 잉크 자체는 여전히 객체 **위** 층이므로 덮은 글자가 비쳐 보인다.

import type { Stroke } from '@mindflow/mindmap-core';
import { strokeBounds, strokePathD } from '@mindflow/mindmap-core';
import { HL_OPACITY, isHighlighter } from '../boardTools';

/** 잉크가 앉는 층 — 객체(≤81) 위, 편집 박스(100)·드래그 중인 노드(200) 아래. */
export const STROKE_Z = 90;

interface StrokeLayerProps {
  strokes: Stroke[] | undefined;
  /** 그리는 중인 획의 미리보기(컨트롤러 `liveStroke`) — 커밋 전이라 문서에 없다. */
  live: { pts: number[]; color: string; w: number; hl?: boolean } | null;
  /** 지금 선택된 획들의 id — 점선 상자로 표시한다(획에는 손잡이가 없다).
   * 마퀴 다중 선택이 들어오면서(요청) 목록이 됐다 — 단일 선택은 원소 하나. */
  selectedIds?: string[];
  /** 선택 표시 색(테마 accent). */
  accent?: string;
}

/** 선택 상자가 획에서 떨어지는 여백(캔버스 단위) — 굵은 하이라이터도 상자가
 * 잉크에 닿지 않게 굵기 절반(bounds에 이미 포함)에 조금 더 준다. */
const SEL_PAD = 4;

export function StrokeLayer({ strokes, live, selectedIds, accent }: StrokeLayerProps) {
  const list = strokes ?? [];
  if (!list.length && !live) return null;
  const selBoxes = (selectedIds ?? [])
    .map((id) => {
      const s = list.find((x) => x.id === id);
      const b = s ? strokeBounds(s) : null;
      return b ? { id, b } : null;
    })
    .filter((v): v is { id: string; b: { x0: number; y0: number; x1: number; y1: number } } => !!v);
  const strokeProps = (s: { color: string; w: number; hl?: boolean }) => ({
    fill: 'none',
    stroke: s.color,
    strokeWidth: s.w,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    ...(isHighlighter(s) ? { opacity: HL_OPACITY, style: { mixBlendMode: 'multiply' as const } } : {}),
  });
  return (
    <svg data-stroke-layer width={10} height={10} overflow="visible" style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none', zIndex: STROKE_Z }} aria-hidden="true">
      {list.map((s) => (
        <path key={s.id} data-stroke-id={s.id} data-stroke-hl={isHighlighter(s) ? '1' : undefined} d={strokePathD(s.pts)} {...strokeProps(s)} />
      ))}
      {live && live.pts.length >= 2 && <path data-live-stroke d={strokePathD(live.pts)} {...strokeProps(live)} />}
      {selBoxes.map(({ id, b }) => (
        <rect
          key={`sel-${id}`}
          data-stroke-selection={id}
          x={b.x0 - SEL_PAD}
          y={b.y0 - SEL_PAD}
          width={Math.max(1, b.x1 - b.x0 + SEL_PAD * 2)}
          height={Math.max(1, b.y1 - b.y0 + SEL_PAD * 2)}
          fill="none"
          stroke={accent ?? '#f0663f'}
          strokeWidth={1.5}
          strokeDasharray="5 4"
          rx={6}
        />
      ))}
    </svg>
  );
}

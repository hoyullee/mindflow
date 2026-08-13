// 맞춤 안내선(스마트 가이드) — 끌고 있는 객체가 이웃의 기준선에 붙는 **그 순간에만**
// 뜨는 얇은 선. 문서에 남지 않는 화면 장식이라 팬/줌 레이어 안에 두되(캔버스 좌표를
// 그대로 쓴다) 포인터는 받지 않는다.
//
// 굵기를 `1/zoom`으로 주는 이유: 이 선은 "객체"가 아니라 **눈금**이라 확대해도
// 두꺼워지면 안 된다(확대할수록 정밀 작업인데 안내선이 굵어지면 방해가 된다).
// 같은 이유로 점선 간격도 줌으로 나눈다 — 어느 배율에서나 같은 무늬로 보인다.
//
// 층은 잉크(90) 위·편집 박스(100) 아래: 무엇에 맞추는지가 가려지면 안 되지만
// 지금 글자를 치고 있는 박스를 덮을 이유는 없다.

import type { SnapGuide } from '../arrange';

export const GUIDE_Z = 97;

interface GuideLayerProps {
  guides: SnapGuide[];
  zoom: number;
  color: string;
}

export function GuideLayer({ guides, zoom, color }: GuideLayerProps) {
  if (!guides.length) return null;
  const z = zoom || 1;
  // SVG는 10×10 + overflow:visible — 0×0은 렌더링 자체가 꺼진다(StrokeLayer 주석 참고).
  return (
    <svg data-guide-layer width={10} height={10} overflow="visible" style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none', zIndex: GUIDE_Z }} aria-hidden="true">
      {guides.map((g) => {
        const vertical = g.axis === 'x';
        return (
          <line
            key={`${g.axis}${g.at}`}
            data-guide-axis={g.axis}
            data-guide-at={g.at}
            x1={vertical ? g.at : g.from}
            y1={vertical ? g.from : g.at}
            x2={vertical ? g.at : g.to}
            y2={vertical ? g.to : g.at}
            stroke={color}
            strokeWidth={1 / z}
            strokeDasharray={`${4 / z} ${3 / z}`}
            shapeRendering="crispEdges"
          />
        );
      })}
    </svg>
  );
}

// 그리기 입력 오버레이(화이트보드 M4) — 펜/지우개 도구가 켜져 있는 동안 캔버스
// 전체를 덮어 **모든 포인터를 받는다**(그 아래의 선택·드래그·팬 핸들러를 건드리지
// 않고 그리기를 얹는 가장 파급 작은 방법). 문서 변이는 컨트롤러의
// boardDraw* 핸들러가 chokepoint(commitDoc)를 거쳐 처리한다.
//
// 두 손가락 제스처(핀치)는 그리기가 아니다 — 두 번째 포인터가 닿는 순간 진행
// 중인 획을 커밋 없이 버린다(줌은 도구를 '선택'으로 돌리고 쓰는 것이 v1 규칙).

import type { PointerEvent as ReactPointerEvent } from 'react';
import { useRef } from 'react';
import type { EditorController } from '../useEditorState';

export function BoardDrawLayer({ controller }: { controller: EditorController }) {
  const activePointers = useRef(new Set<number>());
  if (!controller.isBoard || controller.readOnly || controller.boardTool === 'select') return null;

  const onDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0 && e.pointerType === 'mouse') return; // 우클릭/휠클릭은 그리기가 아니다
    // `.mf-ed-vp`로 새어 나가면 배경 마퀴 드래그가 포인터를 다시 캡처해 이
    // 레이어의 move/up을 빼앗는다(BoardToolbar와 같은 함정).
    e.stopPropagation();
    activePointers.current.add(e.pointerId);
    if (activePointers.current.size > 1) {
      controller.boardDrawCancel();
      return;
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // jsdom 등 포인터 캡처 미구현 환경 — 캡처는 최적화지 필수 조건이 아니다.
    }
    controller.boardDrawDown(e.clientX, e.clientY);
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (activePointers.current.size !== 1) return;
    controller.boardDrawMove(e.clientX, e.clientY);
  };
  const onUpOrCancel = (e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean): void => {
    activePointers.current.delete(e.pointerId);
    if (cancelled) controller.boardDrawCancel();
    else controller.boardDrawUp();
  };

  return (
    <div
      data-board-draw-layer
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={(e) => onUpOrCancel(e, false)}
      onPointerCancel={(e) => onUpOrCancel(e, true)}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'absolute',
        inset: 0,
        // 캔버스 안 최고 층(NodeLayer 편집 박스 100)보다 위 — 그리는 동안은
        // 모든 객체 위에 잉크를 얹는다. 도구 막대(BoardToolbar)는 이보다 위.
        zIndex: 110,
        touchAction: 'none',
        cursor: controller.boardTool === 'pen' ? 'crosshair' : 'cell',
      }}
    />
  );
}

// 그리기 입력 오버레이(화이트보드 M4) — 펜/지우개 도구가 켜져 있는 동안 캔버스
// 전체를 덮어 **모든 포인터를 받는다**(그 아래의 선택·드래그·팬 핸들러를 건드리지
// 않고 그리기를 얹는 가장 파급 작은 방법). 문서 변이는 컨트롤러의
// boardDraw* 핸들러가 chokepoint(commitDoc)를 거쳐 처리한다.
//
// 손가락 규칙(요청):
//   한 손가락 = 그리기·지우기
//   두 손가락 = **화면 이동·확대**(그리기 도구가 켜져 있어도)
// 예전에는 두 번째 손가락이 닿으면 획만 버리고 아무 일도 하지 않아서, 펜을 켠 채로는
// 화면을 옮길 수 없었다(도구를 '선택'으로 되돌려야 했다). 이 레이어가 포인터를 전부
// 가져가므로 아래 배경 핸들러가 볼 수 없다 — 그래서 두 손가락 제스처를 컨트롤러의
// `twoFinger*`로 **직접 넘긴다**(배경 핸들러가 쓰는 것과 같은 함수라 감각이 같다).

import type { PointerEvent as ReactPointerEvent } from 'react';
import { useRef } from 'react';
import type { EditorController } from '../useEditorState';
import { commentPinCursor } from './commentPinShape';

export function BoardDrawLayer({ controller }: { controller: EditorController }) {
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  // 두 손가락 제스처가 시작되면 마지막 손가락이 떨어질 때까지 그리기를 재개하지
  // 않는다 — 한 손가락이 먼저 떨어졌다고 남은 손가락이 갑자기 선을 긋기 시작하면
  // 화면을 옮기다 낙서가 생긴다.
  const gesturing = useRef(false);
  /** 댓글 도구: 누른 자리(움직였으면 "클릭"이 아니라 화면 이동으로 본다). */
  const pressAt = useRef<{ x: number; y: number } | null>(null);

  if (!controller.isBoard || controller.readOnly || controller.boardTool === 'select') return null;

  const comment = controller.boardTool === 'comment';
  const th = controller.uiTheme;

  const two = (): [{ x: number; y: number }, { x: number; y: number }] | null => {
    const pts = Array.from(pointers.current.values());
    return pts.length === 2 && pts[0] && pts[1] ? [pts[0], pts[1]] : null;
  };

  const onDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0 && e.pointerType === 'mouse') return; // 우클릭/휠클릭은 그리기가 아니다
    // `.mf-ed-vp`로 새어 나가면 배경 마퀴 드래그가 포인터를 다시 캡처해 이
    // 레이어의 move/up을 빼앗는다(BoardToolbar와 같은 함정).
    e.stopPropagation();
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // jsdom 등 포인터 캡처 미구현 환경 — 캡처는 최적화지 필수 조건이 아니다.
    }
    const pair = two();
    if (pair) {
      // 두 번째 손가락 — 그리던 획은 버리고(낙서로 남지 않게) 화면 조작으로 넘어간다.
      gesturing.current = true;
      controller.boardDrawCancel();
      controller.twoFingerStart(pair[0].x, pair[0].y, pair[1].x, pair[1].y);
      return;
    }
    if (pointers.current.size > 2 || gesturing.current) return; // 세 손가락은 무시
    if (comment) {
      // 댓글은 긋는 것이 아니라 **꽂는 것**이다 — 손을 뗄 때 그 자리에 말풍선을 띄운다
      // (누르자마자 띄우면 화면을 끌려던 손짓에도 말풍선이 뜬다).
      pressAt.current = { x: e.clientX, y: e.clientY };
      return;
    }
    controller.boardDrawDown(e.clientX, e.clientY);
  };

  const onMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pair = two();
    if (pair) {
      controller.twoFingerMove(pair[0].x, pair[0].y, pair[1].x, pair[1].y);
      return;
    }
    if (gesturing.current || pointers.current.size !== 1) return;
    if (comment) return; // 한 손가락 이동은 아래 onUp의 슬롭 판정이 본다
    controller.boardDrawMove(e.clientX, e.clientY);
  };

  const onUpOrCancel = (e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean): void => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) controller.twoFingerEnd();
    if (gesturing.current) {
      // 제스처 중이었다면 그릴 것이 없다. 마지막 손가락이 떨어져야 그리기 재개.
      if (pointers.current.size === 0) gesturing.current = false;
      return;
    }
    if (comment) {
      const at = pressAt.current;
      pressAt.current = null;
      // 4px 안쪽으로 움직인 포인터만 "여기에 댓글"이다.
      if (!cancelled && at && Math.hypot(e.clientX - at.x, e.clientY - at.y) <= 4) controller.startCommentDraftAtClient(e.clientX, e.clientY);
      return;
    }
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
        // 댓글 도구의 커서는 **꽂히는 핀 그대로**다(요청 ③) — 손끝의 그림과 놓이는
        // 물건이 다르면 무엇을 만드는 중인지 헷갈린다.
        cursor: comment ? commentPinCursor(th.accent, th.accentInk) : controller.boardTool === 'pen' ? 'crosshair' : 'cell',
      }}
    />
  );
}

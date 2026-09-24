// 본문 블록을 **끌어 다른 줄로 옮기는** 공통 부품.
//
// 그림에서 시작한 동작인데(요청) 임베드(칸반·맵·화이트보드)에도 같은 것을 요청받아
// 한자리로 모았다 — 두 벌이 되면 "그림은 목록 사이에 들어가는데 임베드는 안 된다"
// 같은 어긋남이 생긴다. 규칙 셋은 그대로다: **6px 문턱**(고르려다 손이 떨린 경우를
// 문서 변경으로 만들지 않는다) · **틈에 가는 선**(어디로 가는지 보이지 않으면 끌기는
// 도박이다) · **목록 안의 틈도 자리**(사람이 보는 것은 「1.」과 「2.」 사이의 줄이다).

import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { EditorController } from '../useEditorState';

export interface DropSpot {
  /** 블록 목록 기준의 틈 번호(0 = 맨 위, n = 맨 아래). */
  index: number;
  /** 목록 **안의** 틈이면 그 목록과 항목 번호 — 놓을 때 그 자리에서 가른다. */
  list?: { id: string; at: number };
  y: number;
  left: number;
  width: number;
}

/**
 * 끌고 있는 것이 **어느 틈에** 떨어질까 — 블록 칸들의 가운데를 기준으로 가른다.
 *
 * 돌려주는 `index`는 **지금 목록 기준의 틈 번호**다(0 = 맨 위, n = 맨 아래).
 * 옮기는 쪽에서 자기 자신을 뺀 자리로 고쳐 쓴다.
 */
export function blockDropSpot(y: number): DropSpot | null {
  if (typeof document === 'undefined') return null;
  const wraps = [...document.querySelectorAll<HTMLElement>('[data-note-page] [data-note-blockwrap]')];
  if (!wraps.length) return null;
  let index = wraps.length;
  for (let i = 0; i < wraps.length; i += 1) {
    const r = wraps[i]!.getBoundingClientRect();
    if (y < r.top + r.height / 2) {
      index = i;
      break;
    }
  }
  /**
   * **목록의 항목 사이도 떨어질 자리다**(요청) — 목록은 블록 하나라 그 안에 다른
   * 블록이 들어갈 자리가 없지만, 사람이 보는 것은 「1. 11」과 「2. 22」 **사이의 줄**이다.
   * 그 틈을 가리켰으면 블록 틈 대신 그쪽을 돌려준다(놓을 때 목록을 둘로 가른다).
   *
   * 어느 블록의 안인지는 **y가 그 상자 안에 들었는가**로 본다(제보 1). 예전에는 위에서
   * 구한 틈 번호의 **앞 블록**(`wraps[index - 1]`)을 봤는데, 그 번호는 블록의 **가운데**를
   * 기준으로 갈린 값이라 같은 블록이라도 **위쪽 절반**에서는 한 칸 앞 블록을 가리켰다.
   * 그래서 제목 바로 밑에 목록이 있으면 첫·둘째 항목 사이의 틈이 영영 잡히지 않고
   * 그림이 목록 **앞**으로 갔다(실측: 3항목 목록에서 1·2번 항목 아래로 넣을 수 없었다).
   */
  const inside = wraps.find((w) => {
    const r = w.getBoundingClientRect();
    return y >= r.top && y <= r.bottom;
  });
  const items = inside ? [...inside.querySelectorAll<HTMLElement>('[data-note-item]')] : [];
  if (inside && items.length > 1) {
    const box = inside.getBoundingClientRect();
    const at = wraps.indexOf(inside);
    // 항목도 블록과 **같은 규칙**으로 가른다 — 가운데를 넘었으면 그 아래 틈이다.
    let k = items.length;
    for (let i = 0; i < items.length; i += 1) {
      const r = items[i]!.getBoundingClientRect();
      if (y < r.top + r.height / 2) {
        k = i;
        break;
      }
    }
    // 0(첫 항목 위)·n(마지막 항목 아래)은 **블록 틈**이다 — 목록을 가르지 않는다.
    if (k > 0 && k < items.length) {
      const key = items[k]!.getAttribute('data-note-item') ?? '';
      const [listId] = key.split(':');
      return { index: at, list: { id: listId ?? '', at: k }, y: items[k]!.getBoundingClientRect().top - 4, left: box.left, width: box.width };
    }
    const edge = k <= 0 ? at : at + 1;
    return { index: edge, y: k <= 0 ? box.top : box.bottom, left: box.left, width: box.width };
  }
  const ref = (index >= wraps.length ? wraps[wraps.length - 1] : wraps[index])!.getBoundingClientRect();
  return { index, y: index >= wraps.length ? ref.bottom : ref.top, left: ref.left, width: ref.width };
}

/** 떨어질 자리에 그리는 가는 선 — 본문 위에 뜨므로 `fixed`다. */
export function DropLine({ spot }: { spot: DropSpot | null }): JSX.Element | null {
  if (!spot) return null;
  return (
    <div
      data-note-drop
      aria-hidden="true"
      style={{ position: 'fixed', left: spot.left, top: spot.y - 1, width: spot.width, height: 2, borderRadius: 2, background: 'var(--mf-accent)', zIndex: 45, pointerEvents: 'none' }}
    />
  );
}

/**
 * 블록 하나를 끌 수 있게 만든다. `begin`을 `pointerdown`에서 부르면 된다 —
 * **고르기와 읽기 전용 판단은 부르는 쪽 몫**이다(블록마다 고르는 규칙이 다르다).
 */
export function useBlockDrag(controller: EditorController, blockId: string): {
  dragging: boolean;
  dropAt: DropSpot | null;
  begin: (e: ReactPointerEvent<Element>) => void;
} {
  const dragRef = useRef<{ x: number; y: number; on: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dropAt, setDropAt] = useState<DropSpot | null>(null);

  const begin = (e: ReactPointerEvent<Element>): void => {
    dragRef.current = { x: e.clientX, y: e.clientY, on: false };
    const move = (ev: PointerEvent): void => {
      const d = dragRef.current;
      if (!d) return;
      if (!d.on && Math.abs(ev.clientY - d.y) + Math.abs(ev.clientX - d.x) < 6) return;
      if (!d.on) {
        d.on = true;
        setDragging(true);
      }
      setDropAt(blockDropSpot(ev.clientY));
    };
    const up = (ev: PointerEvent): void => {
      const d = dragRef.current;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      dragRef.current = null;
      setDragging(false);
      setDropAt(null);
      if (!d?.on) return;
      const spot = blockDropSpot(ev.clientY);
      if (!spot) return;
      // 목록 **안의** 틈이면 그 목록을 둘로 가르고 사이에 끼운다(한 커밋).
      if (spot.list && spot.list.id && spot.list.id !== blockId) {
        controller.moveNoteBlockIntoList(blockId, spot.list.id, spot.list.at);
        return;
      }
      const ids = (controller.notePage?.blocks ?? []).map((b) => b.id);
      const from = ids.indexOf(blockId);
      // 틈 번호는 **자기 자신이 아직 목록에 있는** 상태의 값이다 — 뺀 뒤의 자리로 옮긴다.
      const to = spot.index > from ? spot.index - 1 : spot.index;
      if (from >= 0 && to !== from) controller.moveNoteBlock(blockId, to);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  return { dragging, dropAt, begin };
}

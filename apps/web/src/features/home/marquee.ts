// 홈의 **마퀴(드래그 사각형) 선택** — 빈 자리에서 끌어 맵 카드를 한 번에 고른다(요청).
//
// 계산은 순수 함수로 두고(사각형 만들기·교차 판정) DOM은 훅이 읽어 넘긴다 — 그래야
// 브라우저 없이도 규칙을 검증할 수 있다(에디터의 `kanbanDrag`와 같은 결).
//
// **마우스에서만** 동작한다: 터치에는 길게 누르기(선택 모드)가 이미 있고, 손가락
// 드래그는 스크롤이라 사각형을 그리면 목록을 못 넘긴다.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

export interface MarqueeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CardBox {
  key: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 두 점으로 사각형 — 어느 방향으로 끌어도 양수 크기가 된다. */
export function rectFrom(ax: number, ay: number, bx: number, by: number): MarqueeRect {
  return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
}

/**
 * 사각형에 **닿는** 카드들(파일 탐색기 관례 — 완전히 감쌀 필요는 없다).
 *
 * 순서는 넘겨받은 순서 그대로다 — 호출부가 화면에 그려진 순서(DOM)로 모으므로
 * 선택 목록도 사용자가 보는 순서가 된다.
 */
export function keysInRect(r: MarqueeRect, boxes: readonly CardBox[]): string[] {
  const right = r.x + r.w;
  const bottom = r.y + r.h;
  return boxes.filter((b) => b.left < right && b.right > r.x && b.top < bottom && b.bottom > r.y).map((b) => b.key);
}

/** 이 지점에서 마퀴를 시작해도 되는가 — 카드·메뉴·조작 요소 위는 아니다. */
export function canStartMarquee(target: HTMLElement | null): boolean {
  if (!target || !target.closest) return false;
  return !target.closest('.map-card, .mf-home-ctx, .mf-sel-bar, button, a, input, textarea, select, [role="dialog"], [contenteditable="true"]');
}

/** 사각형으로 치기 시작했다고 볼 최소 이동(px) — 평범한 클릭과 가른다. */
const THRESHOLD = 5;

/**
 * 마퀴 훅 — `onPointerDown`을 본문(`main`)에 걸고, 돌려주는 `rect`를 그린다.
 *
 * 끄는 동안 매 이동마다 `onSelect`를 부른다(교체). 수정 키(Ctrl/⌘·Shift)를 쥐고
 * 시작했으면 시작 시점의 선택을 `base`로 함께 넘겨 더하기가 된다.
 */
export function useMarqueeSelect(opts: {
  onSelect: (keys: string[], base?: string[]) => void;
  /** 시작 시점의 선택 — 수정 키를 쥐고 시작했을 때만 쓰인다. */
  currentSelection: () => string[];
  disabled?: boolean;
}): { rect: MarqueeRect | null; onPointerDown: (e: ReactPointerEvent) => void } {
  const [rect, setRect] = useState<MarqueeRect | null>(null);
  const ref = useRef(opts);
  ref.current = opts;

  // 드래그 중 페이지가 언마운트되면 리스너가 남지 않게(안전망).
  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanupRef.current?.(), []);

  const onPointerDown = useCallback((e: ReactPointerEvent) => {
    if (ref.current.disabled) return;
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    if (!canStartMarquee(e.target as HTMLElement)) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const additive = e.ctrlKey || e.metaKey || e.shiftKey;
    const base = additive ? ref.current.currentSelection() : undefined;
    let started = false;

    const boxes = (): CardBox[] =>
      Array.from(document.querySelectorAll<HTMLElement>('[data-card-key]')).map((el) => {
        const r = el.getBoundingClientRect();
        return { key: el.getAttribute('data-card-key') || '', left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      });

    const onMove = (ev: globalThis.PointerEvent): void => {
      if (!started) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < THRESHOLD) return;
        started = true;
      }
      // 사각형을 그리는 동안 글자가 드래그 선택되지 않게.
      ev.preventDefault();
      const r = rectFrom(startX, startY, ev.clientX, ev.clientY);
      setRect(r);
      ref.current.onSelect(keysInRect(r, boxes()), base);
    };
    const finish = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      cleanupRef.current = null;
      setRect(null);
    };
    cleanupRef.current = finish;
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  }, []);

  return { rect, onPointerDown };
}

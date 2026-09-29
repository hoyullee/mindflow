// 모바일 **선택 모드 진입**(길게 누르기) — 맵 카드와 폴더 카드가 같은 것을 쓴다.
//
// 예전에는 이 기계가 `MapCard` 안에만 있었다. 폴더도 다중 선택 대상이 되면서(요청)
// 같은 제스처가 두 곳에 필요해졌는데, 베껴 두면 **한쪽만 고쳐지는** 날이 온다
// (길게 누르기의 길이·흔들림 허용치·따라오는 클릭 삼키기가 전부 미세한 값이다).
//
// 시간을 **직접 잰다**(칸반 카드 드래그의 `beginPointerDrag`와 같은 골격): 브라우저의
// 길게 누르기(=`contextmenu`)는 기기·브라우저마다 발화 여부가 갈리고, iOS는
// `-webkit-touch-callout: none`을 걸면 아예 오지 않기도 한다. 둘 중 **먼저 오는 쪽**이
// 모드를 켜고, 나머지는 이미 켜져 있으므로 아무 일도 하지 않는다.

import { useEffect, useRef } from 'react';
import type { MutableRefObject, PointerEvent as ReactPointerEvent } from 'react';

/** iOS·안드로이드의 길게 누르기와 같은 길이. */
export const LONG_PRESS_MS = 500;
/** 손가락은 완벽히 멎지 않는다 — 이만큼까지는 "가만히 있었다"로 본다. */
export const LONG_PRESS_SLOP = 10;

export interface LongPressSelect {
  /** 이번 제스처가 터치였는가 — `contextmenu`가 우클릭인지 길게 누르기인지 가른다. */
  wasTouch: MutableRefObject<boolean>;
  /** 길게 누르기로 모드에 들어간 직후 따라오는 클릭 한 번을 삼킨다. */
  swallowClick: MutableRefObject<boolean>;
  /** 길게 누르기가 성립했을 때 — 타이머와 `contextmenu` 두 경로가 함께 부른다. */
  begin: () => void;
  onPointerDown: (e: ReactPointerEvent) => void;
  onPointerMove: (e: ReactPointerEvent) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
}

export function useLongPressSelect(opts: {
  /** 이 카드의 선택 키 — 모드에 들어가며 첫 항목이 된다. */
  cardKey: string;
  /** 지금 이 제스처를 받을 수 있는가(모바일 레이아웃 · 모드가 아직 꺼져 있음 등). */
  armed: boolean;
  /** 이미 모드 안인가 — 켜져 있으면 다시 켜지 않는다(첫 항목을 덮어쓰지 않게). */
  active: boolean;
  onEnter: (key: string) => void;
  /** 이 셀렉터에 걸리는 자리에서는 시작하지 않는다(☰·★처럼 자기 동작이 있는 곳). */
  skip?: string;
}): LongPressSelect {
  const ref = useRef(opts);
  ref.current = opts;
  const timer = useRef<number | undefined>(undefined);
  const start = useRef<{ x: number; y: number } | null>(null);
  const wasTouch = useRef(false);
  const swallowClick = useRef(false);

  const cancel = (): void => {
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = undefined;
    start.current = null;
  };
  useEffect(() => cancel, []);

  const begin = (): void => {
    cancel();
    swallowClick.current = true;
    if (ref.current.active) return;
    // 메뉴가 손가락 **아래에서** 뜨는 것과 같은 이유로 시각만으로는 알아채기 늦다.
    navigator.vibrate?.(12);
    ref.current.onEnter(ref.current.cardKey);
  };

  return {
    wasTouch,
    swallowClick,
    begin,
    onPointerDown: (e) => {
      wasTouch.current = e.pointerType === 'touch';
      // 새 제스처의 시작 — 앞선 제스처가 남긴 억제 플래그를 여기서 푼다(클릭이 끝내
      // 오지 않은 경우에도 다음 탭이 먹히도록).
      swallowClick.current = false;
      cancel();
      if (!wasTouch.current || !ref.current.armed) return;
      const t = e.target as HTMLElement;
      const skip = ref.current.skip;
      if (skip && t.closest && t.closest(skip)) return;
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = window.setTimeout(begin, LONG_PRESS_MS);
    },
    onPointerMove: (e) => {
      const s = start.current;
      if (!s) return;
      if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > LONG_PRESS_SLOP) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
  };
}

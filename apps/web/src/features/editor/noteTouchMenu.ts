// 손가락의 규칙을 한곳에 — **길게 누르기**가 메뉴를 열고, **움직이면 그 메뉴를 거둔다**.
//
// 제보(안드로이드·삼성 인터넷)에서 온 두 갈래를 여기서 함께 다룬다:
//  · 메뉴는 길게 누르기에서만 열린다(두 번 터치로 오는 `contextmenu`를 버린다)
//  · 길게 누른 **뒤 움직이면** 그것은 메뉴가 아니라 **끌기**다 — 열린 메뉴를 닫고
//    뒤늦게 오는 `contextmenu`도 막는다.
//
// 문서에 **캡처 단계로** 건다 — 리액트 18은 리스너를 루트 컨테이너에 붙이므로
// 여기서 `stopPropagation`하면 어떤 화면의 어떤 메뉴도 열리지 않는다(자리마다
// 가드를 심으면 새 메뉴가 생길 때 빠뜨린다).

/** 이만큼 누르고 있어야 「길게 누르기」다. 브라우저의 `contextmenu`(≈500ms)보다 앞. */
export const LONG_PRESS_MS = 380;
/** 이만큼 움직이면 누르기가 아니라 끌기다(스크롤·글자 고르기). */
const MOVE_SLOP = 12;
/** 길게 누른 뒤 이 시간 안에 온 `contextmenu`만 통과시킨다. */
const OPEN_WINDOW_MS = 1500;

/**
 * 마지막 누름의 종류 — **미디어 질의(`pointer: coarse`)를 믿지 않는다**.
 *
 * 제보로 알았다: S펜을 받는 삼성 기기는 `(hover: none) and (pointer: coarse)`가
 * **거짓**일 수 있어(스타일러스를 정밀 포인터로 센다), 그 질의로 "손가락인가"를
 * 가르면 표의 칸을 한 번만 눌러도 소프트 키보드가 올라왔다. 실제로 온 이벤트의
 * `pointerType`이 가장 정확한 답이다.
 */
let lastType = 'mouse';
let tracking = false;
/** 손가락으로 지금 열려 있는(또는 방금 연) 메뉴가 있나 — 그 시각. */
let heldAt = 0;
const closers = new Set<() => void>();

function track(e: PointerEvent): void {
  lastType = e.pointerType || 'mouse';
}

/** 마지막 누름이 손가락이었나. 미디어 질의보다 이 값을 믿는다(위 주석). */
export function isTouchPointer(): boolean {
  return lastType === 'touch';
}

/**
 * 끌기가 시작됐다 — **열린 메뉴를 닫고, 뒤늦게 올 `contextmenu`도 막는다**(요청).
 *
 * 브라우저의 길게 누르기 판정(≈500ms)이 우리 것(380ms)보다 늦어서, 손가락이
 * 움직이기 시작한 **뒤에** `contextmenu`가 도착하는 창이 있다. 그 창을 닫는다.
 */
export function cancelTouchMenu(): void {
  heldAt = 0;
  closers.forEach((fn) => fn());
}

/** 메뉴를 여는 쪽이 「닫는 법」을 맡겨 둔다 — 끌기가 시작되면 우리가 부른다. */
export function registerTouchMenuCloser(fn: () => void): () => void {
  closers.add(fn);
  return () => closers.delete(fn);
}

export interface TouchMenuGate {
  isTouch: () => boolean;
  stop: () => void;
}

/** 손가락의 `contextmenu`를 **길게 누르기 뒤에만** 통과시킨다. */
export function installTouchMenuGate(): TouchMenuGate {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let from: { x: number; y: number } | null = null;

  const clear = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    from = null;
  };

  const down = (e: PointerEvent): void => {
    track(e);
    clear();
    heldAt = 0;
    if (lastType !== 'touch') return;
    from = { x: e.clientX, y: e.clientY };
    timer = setTimeout(() => {
      heldAt = Date.now();
    }, LONG_PRESS_MS);
  };
  const move = (e: PointerEvent): void => {
    if (!from) return;
    if (Math.abs(e.clientX - from.x) + Math.abs(e.clientY - from.y) > MOVE_SLOP) clear();
  };
  const up = (): void => clear();

  const menu = (e: Event): void => {
    if (lastType !== 'touch') return;
    // 길게 누른 직후인가 — 아니면 이 이벤트는 우리 것이 아니다(두 번 터치·끌기 중).
    if (heldAt && Date.now() - heldAt < OPEN_WINDOW_MS) {
      /**
       * **OS의 선택 메뉴와 겹치지 않게** 고른 글을 접는다(제보: 두 판이 겹쳐 뜬다).
       *
       * 안드로이드는 글자가 골라져 있는 동안 제 툴바(잘라내기·복사·번역…)를 띄우고,
       * 그 위에 우리 판이 그대로 겹쳤다. 그 툴바를 우리가 숨길 길은 없고 **선택이
       * 접히면 스스로 사라진다** — 우리 메뉴는 「블록」 단위라 고른 글자에 기대지
       * 않으므로 잃는 것이 없다(캐럿은 끝에 남긴다).
       */
      setTimeout(() => {
        const s = window.getSelection();
        if (s && !s.isCollapsed) s.collapseToEnd();
      }, 0);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  if (!tracking) {
    tracking = true;
    document.addEventListener('pointerdown', track, true);
  }
  document.addEventListener('pointerdown', down, true);
  document.addEventListener('pointermove', move, true);
  document.addEventListener('pointerup', up, true);
  document.addEventListener('pointercancel', up, true);
  document.addEventListener('contextmenu', menu, true);

  return {
    isTouch: () => lastType === 'touch',
    stop: () => {
      clear();
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', up, true);
      document.removeEventListener('contextmenu', menu, true);
    },
  };
}

// 손가락에서 **우클릭 메뉴가 열리는 자리**를 하나로 정한다 — 길게 누르기.
//
// 제보(안드로이드·삼성 인터넷): 본문을 **두 번 터치**하면 우클릭 메뉴가 떴다. 우리
// 메뉴는 전부 `contextmenu` 이벤트에서 열리는데, 모바일 브라우저는 그 이벤트를
// 길게 누르기 말고도 보낸다(단어를 고르는 두 번 터치가 그렇다) — 그리고 그 사정은
// 브라우저마다 다르다. 그래서 **왜 왔는지를 따지지 않고** 우리 쪽에서 문을 세운다:
// 손가락으로 **길게 누른 직후**에 온 것만 통과시키고 나머지는 잡아서 버린다.
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

export interface TouchMenuGate {
  /** 지금 손가락이 마지막 입력인가 — 자리마다 다른 규칙을 둘 때 쓴다(표 경계선). */
  isTouch: () => boolean;
  stop: () => void;
}

/**
 * 손가락의 `contextmenu`를 **길게 누르기 뒤에만** 통과시킨다.
 *
 * `onHold`를 주면 길게 누르기가 성립한 순간에도 알려 준다(브라우저가 `contextmenu`를
 * 아예 보내지 않는 경우를 위한 길 — 지금은 쓰지 않는다).
 */
export function installTouchMenuGate(onHold?: (e: PointerEvent) => void): TouchMenuGate {
  let lastType: string = 'mouse';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let held = 0;
  let from: { x: number; y: number } | null = null;

  const clear = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    from = null;
  };

  const down = (e: PointerEvent): void => {
    lastType = e.pointerType || 'mouse';
    clear();
    held = 0;
    if (lastType !== 'touch') return;
    from = { x: e.clientX, y: e.clientY };
    timer = setTimeout(() => {
      held = Date.now();
      onHold?.(e);
    }, LONG_PRESS_MS);
  };
  const move = (e: PointerEvent): void => {
    if (!from) return;
    if (Math.abs(e.clientX - from.x) + Math.abs(e.clientY - from.y) > MOVE_SLOP) clear();
  };
  const up = (): void => clear();

  const menu = (e: Event): void => {
    if (lastType !== 'touch') return;
    // 길게 누른 직후인가 — 아니면 이 이벤트는 우리 것이 아니다(두 번 터치 등).
    if (held && Date.now() - held < OPEN_WINDOW_MS) return;
    e.preventDefault();
    e.stopPropagation();
  };

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

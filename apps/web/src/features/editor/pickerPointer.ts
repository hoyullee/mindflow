// 키보드로 고른 이미지·파일 고르개를 **마우스가 움직인 뒤에** 연다 — Windows의 포인터 숨김(제보).
//
// Windows에는 「입력하는 동안 포인터 숨기기」가 있고, Chromium(Chrome·Edge·설치형 앱)이 이 설정을
// 따르기 시작했다 — 글을 치면 포인터를 숨기고 **마우스가 움직이면** 다시 보인다. 그런데 블록 넣기
// 목록에서 방향키 + Enter로 이미지·파일을 고르면, 포인터가 숨은 채로 열기 창이 앞을 막는다. 그 뒤의
// 움직임은 막힌 창(앱)에 닿지 않으므로 포인터가 앱 위에서 돌아오지 않는다(앱 밖으로 나가야 보인다).
// 마우스로 고르면 고르기 전에 이미 움직였으므로 멀쩡하다 — 제보의 갈림과 같다.
//
// 그래서 키보드로 고른 경우에는 **첫 마우스 움직임에서** 고르개를 연다. 움직임이 앱에 먼저 닿아 포인터가
// 돌아온 뒤에 창이 뜬다. Enter의 사용자 활성화는 몇 초 이어지므로(Chrome 5초) 그 안의 움직임에서 연
// 고르개는 막히지 않는다. 기다리는 동안:
//  - Enter를 한 번 더 누르면 바로 연다(마우스를 쓰지 않는 사람 — 그때 포인터는 숨어 있어도 된다).
//  - Esc·다른 키·시간이 지나면 열지 않고 `giveUp` — 호출부가 그 자리에 「올리기」 단추를 남긴다.

/** 키보드로 고른 뒤 마우스 움직임을 기다리는 시간. 사용자 활성화(5초)보다 짧아야 한다. */
export const POINTER_WAIT_MS = 3000;

/** 이 기기가 「입력하는 동안 포인터 숨기기」에 걸리는가 — Windows + 마우스(정밀 포인터). */
export function pointerHidesWhileTyping(nav: Pick<Navigator, 'userAgent'> | undefined = typeof navigator === 'undefined' ? undefined : navigator): boolean {
  if (!nav || !/Windows/i.test(nav.userAgent)) return false;
  try {
    return typeof matchMedia !== 'function' || matchMedia('(any-pointer: fine)').matches;
  } catch {
    return true;
  }
}

/**
 * 마우스가 실제로 움직이거나(또는 눌리거나) Enter를 다시 누르면 `open`, Esc·다른 키·시간 초과면 `giveUp`.
 * 둘 중 하나만 한 번 친다. 돌려준 함수로 기다림을 거둘 수 있다(아무것도 치지 않는다).
 *
 * 움직임은 **진짜 이동**만 센다 — 레이아웃이 바뀌면 브라우저가 제자리 `mousemove`를 흉내 내는 일이 있어
 * `movementX/Y`가 0인 것은 거른다.
 */
export function openAfterPointerMoves(
  open: () => void,
  giveUp: () => void,
  { ms = POINTER_WAIT_MS, win = window, real = (e: Event) => e.isTrusted }: { ms?: number; win?: Window; real?: (e: Event) => boolean } = {},
): () => void {
  let done = false;
  const stop = (): void => {
    done = true;
    win.clearTimeout(timer);
    win.removeEventListener('pointermove', onMove, true);
    win.removeEventListener('pointerdown', onDown, true);
    win.removeEventListener('keydown', onKey, true);
  };
  const finish = (fn: () => void): void => {
    if (done) return;
    stop();
    fn();
  };
  const isMouse = (e: Event): boolean => {
    const t = (e as PointerEvent).pointerType;
    return t === undefined || t === '' || t === 'mouse' || t === 'pen';
  };
  const onMove = (e: Event): void => {
    if (!real(e) || !isMouse(e)) return;
    const m = e as PointerEvent;
    if (!m.movementX && !m.movementY) return;
    finish(open);
  };
  const onDown = (e: Event): void => {
    if (!real(e) || !isMouse(e)) return;
    finish(open);
  };
  const onKey = (e: Event): void => {
    const k = e as KeyboardEvent;
    if (k.isComposing || ['Shift', 'Control', 'Alt', 'Meta'].includes(k.key)) return;
    if (k.key === 'Enter') {
      k.preventDefault();
      k.stopPropagation();
      finish(open);
      return;
    }
    if (k.key === 'Escape') {
      k.preventDefault();
      k.stopPropagation();
    }
    finish(giveUp);
  };
  win.addEventListener('pointermove', onMove, true);
  win.addEventListener('pointerdown', onDown, true);
  win.addEventListener('keydown', onKey, true);
  const timer = win.setTimeout(() => finish(giveUp), ms);
  return stop;
}

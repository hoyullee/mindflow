import { useEffect, useState } from 'react';

/**
 * 소프트 키보드가 화면 아래에서 가리는 높이(px).
 *
 * 모바일 브라우저는 키보드가 올라와도 **레이아웃 뷰포트**(`window.innerHeight`,
 * `100dvh`)를 줄이지 않는다 — 줄어드는 건 `visualViewport`뿐이다. 그래서 화면
 * 아래쪽에 있는 편집 대상이 키보드 뒤로 숨어도 CSS만으로는 알 길이 없다.
 *
 * iOS Safari는 여기에 더해 포커스 시 레이아웃 뷰포트째 위로 밀어 올리기도 하는데
 * (`visualViewport.offsetTop > 0`), 그만큼도 "가려진 높이"에 포함된다.
 */

/** 이 아래는 키보드로 치지 않는다 — iOS의 액세서리 바·주소창 축소 같은 잔변동. */
export const KEYBOARD_MIN_INSET = 120;

interface ViewportLike {
  height: number;
  offsetTop: number;
  scale?: number;
}

/** 순수 계산부 — 테스트가 이 함수만으로 규칙을 고정한다. */
export function keyboardInsetOf(vv: ViewportLike | null | undefined, layoutHeight: number): number {
  if (!vv || !layoutHeight) return 0;
  // 사용자가 **두 손가락으로 화면을 확대**하면 시각 뷰포트가 그만큼 작아진다 —
  // 키보드와 구분되지 않는 신호다. 글씨를 키워 읽는 중에 캔버스가 저절로 움직이면
  // 그게 더 이상하므로, 확대 중에는 아예 관여하지 않는다.
  if ((vv.scale ?? 1) > 1.05) return 0;
  const inset = layoutHeight - (vv.height + vv.offsetTop);
  return inset >= KEYBOARD_MIN_INSET ? Math.round(inset) : 0;
}

function read(): number {
  if (typeof window === 'undefined') return 0;
  return keyboardInsetOf(window.visualViewport, window.innerHeight);
}

/**
 * 지금 키보드가 가린 높이(px). 키보드가 없거나 `visualViewport`를 모르는 환경
 * (jsdom 포함)에서는 항상 0이라, 이 훅을 쓰는 쪽은 "0이면 평소대로"만 지키면 된다.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState<number>(read);

  useEffect(() => {
    const vv = typeof window === 'undefined' ? null : window.visualViewport;
    if (!vv) return;
    const onChange = (): void => setInset(read());
    onChange();
    // resize = 키보드 열림/닫힘, scroll = iOS가 레이아웃 뷰포트를 밀어 올린 경우.
    vv.addEventListener('resize', onChange);
    vv.addEventListener('scroll', onChange);
    return () => {
      vv.removeEventListener('resize', onChange);
      vv.removeEventListener('scroll', onChange);
    };
  }, []);

  return inset;
}

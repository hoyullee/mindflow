import { useRef } from 'react';
import { useIsMobile } from '../../../hooks/useMediaQuery';

/** 모바일에서 두 번째 탭을 "더블탭"으로 볼 최대 간격(ms). 시스템 더블클릭 임계값
 * (보통 300~500ms)과 비슷하게 잡아, 느리게 두 번 누르면 '선택 두 번'이 된다. */
const DOUBLE_TAP_MS = 320;

/** 데스크톱에서 "이 카드가 직전 클릭도 받았는가"를 볼 창. 실제 더블클릭 판정은
 * 브라우저(운영체제 설정, 보통 500ms 안팎)가 하므로 이 값은 그보다 넉넉하게 둔다 —
 * 우리는 트리거가 아니라 **문지기**다(다른 것을 누른 뒤의 한 번을 걸러내는 역할). */
const DOUBLE_CLICK_MS = 800;

export interface CardActivation {
  /** 클릭/탭 한 번을 처리하고 무엇을 해야 하는지 알려 준다.
   * 데스크톱은 항상 'select'(열기는 뒤따르는 dblclick이 맡는다),
   * 모바일은 두 번째 탭이면 'activate'. */
  click(): 'select' | 'activate';
  /** 브라우저가 쏜 dblclick을 인정할지(데스크톱 전용). 인정하면 소비한다. */
  acceptDoubleClick(): boolean;
}

/**
 * 홈 카드(맵·폴더)의 공통 활성화 규칙 — **한 번 = 선택 / 두 번 = 열기**.
 *
 * 두 가지를 이 안에 가둔다:
 *
 * 1. **모바일은 dblclick을 못 믿는다.** iOS 사파리 등은 더블탭에서 이 이벤트를
 *    안정적으로 쏘지 않아, 데스크톱 관용구를 그대로 썼을 땐 카드가 아예 안 열렸다.
 *    그래서 탭 두 번의 간격을 직접 잰다.
 * 2. **데스크톱은 dblclick을 그냥 믿으면 안 된다.** 크롬은 두 클릭의 대상이
 *    달라도(폴더 진입 → 그 자리에 새로 그려진 맵 카드, 배경 클릭 → 카드) 같은
 *    지점·시간이면 dblclick을 **두 번째 클릭 대상**에 쏜다(제보: 폴더에 들어가자마자
 *    한 번 더 누르면 에디터가 열림). 그래서 이 카드가 **자기가 직전 클릭도 받았는지**를
 *    세어 두고, 아니면 dblclick을 무시한다.
 */
export function useCardActivation(): CardActivation {
  const isMobile = useIsMobile();
  const lastTapRef = useRef(0);
  const sawOwnFirstClickRef = useRef(false);

  return {
    click() {
      const now = Date.now();
      if (isMobile) {
        const second = now - lastTapRef.current < DOUBLE_TAP_MS;
        lastTapRef.current = second ? 0 : now; // 열고 나면 초기화(3번째 탭이 또 열지 않도록)
        return second ? 'activate' : 'select';
      }
      sawOwnFirstClickRef.current = now - lastTapRef.current < DOUBLE_CLICK_MS;
      lastTapRef.current = now;
      return 'select';
    },
    acceptDoubleClick() {
      // 모바일은 위 탭 카운터가 이미 열었다 — 브라우저가 dblclick까지 쏘는 기기에서
      // 두 번 열리지 않도록 여기서는 항상 거절한다.
      if (isMobile) return false;
      if (!sawOwnFirstClickRef.current) return false;
      sawOwnFirstClickRef.current = false;
      lastTapRef.current = 0; // 세 번째 클릭이 곧바로 또 열지 않도록
      return true;
    },
  };
}

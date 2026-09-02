// 화면을 **열어 둔 채** 다른 곳에서 바뀐 것을 잡는다(제보: 구글 캘린더에서 일정을
// 더해도 열어 둔 일정 화면은 그대로였다).
//
// 왜 이런 장치가 필요한가: 우리 조회는 "화면에 들어올 때 한 번"이고, 그 뒤에는
// 아무도 다시 묻지 않는다. 구글에는 **푸시**(watch 채널)가 있지만 받아 줄 서버
// 엔드포인트가 필요하고, Geurio 일정도 다른 기기에서 바뀌면 같은 처지다.
// 그래서 서버 없이 되는 두 가지를 쓴다 — 새 배포 감지(#302)·알림 벨과 같은 규칙:
//
// 1. **깨어나는 순간**: 탭 복귀·창 포커스·네트워크 복귀. 확인하러 돌아오는 바로
//    그 순간이 자연스러운 확인 타이밍이고, 브라우저는 이때 스스로 묻지 않는다.
// 2. **주기**: 보고 있는 동안에만 60초마다. 탭이 가려지면 쉬었다가 복귀 때 ①이
//    받는다 — 백그라운드 탭이 하루 종일 조회를 태우지 않는다.
//
// 두 계기는 같은 스로틀을 지난다(연타·중복 방지).

import { useEffect, useRef } from 'react';

/** 보고 있는 동안의 주기 확인 — 사람이 달력을 지켜보는 시간 단위. */
export const LIVE_REFRESH_MS = 60_000;
/** 깨어남이 겹쳐 와도(포커스 + visibility 동시) 한 번만 묻는다. */
export const LIVE_REFRESH_THROTTLE_MS = 20_000;

/**
 * @param enabled 이 소비처가 실제로 그리고 있는가 — 꺼져 있으면 아무 계기도 걸지
 *   않는다(대시보드는 위젯마다 훅을 지난다).
 * @param refresh 조용한 갱신 — 화면을 비우거나 로딩 표시를 켜지 않아야 한다
 *   (사용자가 보고 있는 중이다).
 */
export function useLiveRefresh(enabled: boolean, refresh: () => void): void {
  // 최신 콜백을 ref로 읽는다 — 렌더마다 새 함수라 의존성에 넣으면 리스너가 매번
  // 다시 붙고 주기가 처음부터 다시 시작된다.
  const fnRef = useRef(refresh);
  fnRef.current = refresh;
  const lastRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const run = (): void => {
      lastRef.current = Date.now();
      fnRef.current();
    };
    const wake = (): void => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastRef.current < LIVE_REFRESH_THROTTLE_MS) return;
      run();
    };
    const tick = (): void => {
      // 가려진 탭은 쉰다 — 돌아올 때 `wake`가 받는다.
      if (document.visibilityState !== 'visible') return;
      run();
    };
    const timer = window.setInterval(tick, LIVE_REFRESH_MS);
    window.addEventListener('focus', wake);
    window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', wake);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', wake);
      window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [enabled]);
}

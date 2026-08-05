import { useEffect, useState } from 'react';

/**
 * 네트워크 연결 여부(`navigator.onLine` + online/offline 이벤트).
 *
 * `onLine`은 "랜선이 꽂혀 있다" 수준의 신호라 캡티브 포털 같은 경우를 못 잡는다 —
 * 그래서 이 값은 **안내에만** 쓰고, 실제 판단(저장 성공/실패)은 요청 결과가 한다.
 * 반대로 `false`일 때는 거의 확실히 못 나가므로, 그 순간을 사용자에게 알리고
 * 다시 붙는 순간(`online`)을 재시도 신호로 쓰기에는 충분하다.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState<boolean>(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));

  useEffect(() => {
    const up = (): void => setOnline(true);
    const down = (): void => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  return online;
}

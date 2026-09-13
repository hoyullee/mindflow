// 설치형 앱의 작업 표시줄 배지를 **지금 개수에 맞춰 둔다**.
//
// 문지기(`RequireAuth`) 안, 알림 공급자 **아래**에 한 번 마운트한다 — 배지는 앱이
// 화면 밖에 있을 때 보이는 표시이고, 그때 렌더러가 들고 있는 화면은 홈일 수도
// 에디터일 수도 있다. 홈에만 붙이면 에디터에서 일정 알림이 떠도 배지가 움직이지
// 않는다(그 경우가 정확히 배지가 필요한 경우다).
//
// 브라우저·PWA·옛 설치본에서는 `setDesktopBadge`가 조용히 아무 일도 하지 않는다.

import { useEffect } from 'react';
import { useUnreadCount } from '../features/home/components/unreadCount';
import { setDesktopBadge } from './desktopBadge';

export function DesktopBadgeHost(): null {
  const count = useUnreadCount();
  useEffect(() => {
    setDesktopBadge(count);
  }, [count]);
  // 로그아웃하면 문지기가 이 자리를 걷어낸다 — 남의 계정 화면에 내 숫자가 남지 않게.
  useEffect(() => () => setDesktopBadge(0), []);
  return null;
}

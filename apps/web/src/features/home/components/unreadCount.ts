// 알림 배지에 적히는 **그 숫자** 한 곳.
//
// LNB 알림 카드와 작업 표시줄 배지가 같은 수를 보여야 한다 — 두 곳에서 따로 세면
// 사이드바에는 2, 작업 표시줄에는 1이 뜨는 날이 온다(우클릭 메뉴·NavCard와 같은
// 계열의 드리프트).

import { useNotifications } from './NotificationsContext';
import { useMergedUpdate } from '../../../pwa/updateControl';
import { updateNoticeOf } from '../../../platform/shellUpdate';

/**
 * 안 읽은 알림 수 + **새 버전 하나**(요청: 하나의 창구).
 *
 * 새 버전은 열어도 사라지지 않으므로 적용·설치 전까지 남는다 — 그게 맞다:
 * 눌러야 끝나는 일이다.
 */
export function useUnreadCount(): number {
  const { unread } = useNotifications();
  const notice = updateNoticeOf(useMergedUpdate());
  return unread + (notice ? 1 : 0);
}

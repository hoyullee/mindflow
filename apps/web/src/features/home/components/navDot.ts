// 폰의 ☰(서랍 손잡이)에 찍는 **점 하나** — "사이드바 안에 볼 것이 있다".
//
// 서랍이 닫혀 있으면 그 안의 배지는 알림이 아니다(닫힌 문 뒤에 있다). 그래서 문에도
// 표시를 하는데, 종류마다 점을 하나씩 늘리면 좁은 앱 바가 표식으로 뒤덮인다 —
// **하나로 합쳐** 안내 문구(툴팁·접근 이름)가 무엇이 있는지 말한다.

import { useNotifications } from './NotificationsContext';
import { useMergedUpdate } from '../../../pwa/updateControl';
import { updateNoticeOf } from '../../../platform/shellUpdate';

export interface NavDot {
  on: boolean;
  title: string;
  label: string;
}

/** 순수부 — 세는 것과 문구를 정하는 규칙(화면 셋이 같은 말을 쓴다).
 * 새 버전은 **개수가 아니라 있음/없음**이라 따로 적는다(`새 알림 N개`에 섞으면
 * 그 숫자가 우편함 항목 수와 어긋난다). */
export function navDotOf(sharedUnread: number, notifUnread: number, update = false): NavDot {
  const parts: string[] = [];
  if (notifUnread > 0) parts.push(`새 알림 ${notifUnread}개`);
  if (update) parts.push('새 버전');
  if (sharedUnread > 0) parts.push(`새 공유 ${sharedUnread}개`);
  if (!parts.length) return { on: false, title: '메뉴 열기', label: '메뉴 열기' };
  const what = parts.join(' · ');
  return { on: true, title: `메뉴 열기 (${what})`, label: `메뉴 열기, ${what}` };
}

/** 알림 수는 우편함 상태에서, 공유 수는 호출부(뷰모델)에서 온다.
 * 새 버전도 함께 센다 — 서랍이 닫혀 있으면 그 안의 알림 카드가 보이지 않는다. */
export function useNavDot(sharedUnread = 0): NavDot {
  const notice = updateNoticeOf(useMergedUpdate());
  return navDotOf(sharedUnread, useNotifications().unread, !!notice);
}

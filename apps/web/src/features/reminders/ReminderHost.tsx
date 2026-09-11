// 일정 알림을 실제로 띄우는 자리 — 스케줄러(순수 판단) + OS 알림 + 인앱 토스트.
//
// **문지기(`RequireAuth`) 안**에 마운트한다: 로그인한 화면이면 어디서든(홈·에디터)
// 알림이 와야 하고, 반대로 랜딩·로그인·약관에서는 일정을 조회할 이유가 없다.

import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { focusCalendar } from '../home/calendarFocus';
import { showOsNotification } from './reminderPrefs';
import { isGoogleReminder, reminderBody, type ReminderItem } from './reminders';
import { ReminderToast } from './ReminderToast';
import { useReminderScheduler } from './useReminderScheduler';

export function ReminderHost() {
  const navigate = useNavigate();

  /**
   * **그 일정을 보여 준다** — 홈이 떠 있으면 그 자리에서, 에디터에서면 홈으로 가서.
   *
   * 알림이 가리키는 것은 화면이 아니라 **한 일정**이다. 그래서 회차가 놓인 날까지
   * 함께 넘긴다 — 화면만 바꾸면 이미 일정 화면이던 사람에게는 아무 일도 일어나지
   * 않고(제보), 다른 달을 보던 사람에게는 그 일정이 보이지 않는다.
   */
  const openCalendar = useCallback(
    (item?: ReminderItem) => {
      focusCalendar(item ? { date: item.date, eventId: item.eventId, source: isGoogleReminder(item) ? 'google' : 'geurio' } : undefined);
      navigate('/home');
    },
    [navigate],
  );

  const onFire = useCallback(
    (item: ReminderItem) => {
      // OS 알림이 막혀 있어도(권한 없음·생성 실패) **인앱 토스트는 그대로 뜬다** —
      // 알림이 통째로 사라지지 않게. 권한을 얻는 자리는 설정의 `일정 알림`이다.
      //
      // 모바일에서 OS가 예약을 들고 있는 모드라면 이 콜백은 애초에 불리지 않는다
      // (그때는 OS가 띄우고 우리는 그 수신 이벤트로 토스트만 잇는다).
      showOsNotification({
        title: item.title,
        body: reminderBody(item),
        tag: item.key,
        onClick: () => openCalendar(item),
      });
    },
    [openCalendar],
  );

  const { current, rest, dismiss } = useReminderScheduler(onFire, openCalendar);
  if (!current) return null;

  return (
    <ReminderToast
      item={current}
      rest={rest}
      onOpen={() => {
        dismiss();
        openCalendar(current);
      }}
      onDismiss={dismiss}
    />
  );
}

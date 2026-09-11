// 일정 알림을 실제로 띄우는 자리 — 스케줄러(순수 판단) + OS 알림 + 인앱 토스트.
//
// **문지기(`RequireAuth`) 안**에 마운트한다: 로그인한 화면이면 어디서든(홈·에디터)
// 알림이 와야 하고, 반대로 랜딩·로그인·약관에서는 일정을 조회할 이유가 없다.

import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { minutesOf, timeLabel } from '../home/calendar/model';
import { focusCalendar } from '../home/calendarFocus';
import { showOsNotification } from './reminderPrefs';
import { reminderLead, type ReminderItem } from './reminders';
import { ReminderToast } from './ReminderToast';
import { useReminderScheduler } from './useReminderScheduler';

export function ReminderHost() {
  const navigate = useNavigate();

  /** 일정 화면으로 — 홈이 떠 있으면 그 자리에서 바뀌고, 에디터에서면 홈으로 간다. */
  const openCalendar = useCallback(() => {
    focusCalendar();
    navigate('/home');
  }, [navigate]);

  const onFire = useCallback(
    (item: ReminderItem) => {
      const mins = minutesOf(item.startTime);
      const when = mins === null ? item.startTime : timeLabel(mins);
      // OS 알림이 막혀 있어도(권한 없음·생성 실패) **인앱 토스트는 그대로 뜬다** —
      // 알림이 통째로 사라지지 않게. 권한을 얻는 자리는 설정의 `일정 알림`이다.
      showOsNotification({
        title: item.title,
        body: `${when} · ${reminderLead(item.minutes)}`,
        tag: item.key,
        onClick: openCalendar,
      });
    },
    [openCalendar],
  );

  const { current, rest, dismiss } = useReminderScheduler(onFire);
  if (!current) return null;

  return (
    <ReminderToast
      item={current}
      rest={rest}
      onOpen={() => {
        dismiss();
        openCalendar();
      }}
      onDismiss={dismiss}
    />
  );
}

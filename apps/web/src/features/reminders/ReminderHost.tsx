// 일정 알림을 실제로 띄우는 자리 — 스케줄러(순수 판단) + OS 알림 + 인앱 토스트.
//
// **문지기(`RequireAuth`) 안**에 마운트한다: 로그인한 화면이면 어디서든(홈·에디터)
// 알림이 와야 하고, 반대로 랜딩·로그인·약관에서는 일정을 조회할 이유가 없다.

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSpaceStore } from '../../adapters/BackendContext';
import { focusCalendar } from '../home/calendarFocus';
import { syncRemindersFromAccount } from './reminderSync';
import { desktopNotifyAvailable } from '../../platform/desktopBridge';
import { askNotifyPermission, resolveNotifyPermission, showOsNotification } from './reminderPrefs';
import { isGoogleReminder, reminderBody, type ReminderItem } from './reminders';
import { ReminderToast } from './ReminderToast';
import { useReminderScheduler } from './useReminderScheduler';

export function ReminderHost() {
  const navigate = useNavigate();
  const spaceStore = useSpaceStore();

  // 알림 설정의 정본은 **계정**이다(제보: 앱과 웹에 따로 켜져 있었다). 홈은 이미
  // 블롭을 읽어 값을 넘겨 주므로 여기서는 **에디터로 곧장 들어온 탭**만 한 번
  // 읽는다 — 실패해도 이 기기의 캐시로 그대로 돈다.
  useEffect(() => {
    void syncRemindersFromAccount(spaceStore);
  }, [spaceStore]);

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

  /**
   * OS 알림이 못 떴고 **아직 물어볼 수 있는** 상태인가(권한 `default`).
   *
   * 제보: 인앱 토스트는 떴는데 OS 알림이 오지 않았고, 설정의 `테스트 알림`을 누르면
   * 정상으로 떴다. 두 길의 차이는 하나뿐이다 — **테스트 버튼은 물어본다**(그 클릭이
   * 제스처다). 스케줄러의 주기 확인은 제스처가 아니라 물어볼 수 없어, 권한이
   * `default`인 기기에서는 조용히 인앱 토스트만 뜬다(그 기기에서는 영영 그렇다).
   *
   * 그래서 **알림이 앱 안에서만 뜬 그 순간**에 물어볼 길을 낸다 — 토스트의 버튼이
   * 곧 제스처다. `denied`·`unsupported`에는 내지 않는다(브라우저가 다시 묻지 않아
   * 죽은 버튼이 된다 — 그때 할 말은 설정 화면의 `일정 알림` 행이 이미 하고 있다).
   */
  const [askAllow, setAskAllow] = useState(false);

  const showFor = useCallback(
    (item: ReminderItem) =>
      showOsNotification({
        title: item.title,
        body: reminderBody(item),
        tag: item.key,
        onClick: () => openCalendar(item),
      }),
    [openCalendar],
  );

  const onFire = useCallback(
    (item: ReminderItem) => {
      // OS 알림이 막혀 있어도(권한 없음·생성 실패) **인앱 토스트는 그대로 뜬다** —
      // 알림이 통째로 사라지지 않게.
      //
      // 모바일에서 OS가 예약을 들고 있는 모드라면 이 콜백은 애초에 불리지 않는다
      // (그때는 OS가 띄우고 우리는 그 수신 이벤트로 토스트만 잇는다).
      void showFor(item).then((shown) => {
        if (shown) return;
        // **왜** 못 떴는지 물어본다 — 물어볼 수 있을 때만 버튼을 낸다.
        void resolveNotifyPermission().then((perm) => {
          setAskAllow(perm === 'default');
          // 못 뜬 것은 문제다 — 한 줄로 사유를 남긴다(설정의 `테스트 알림`이 눌러서
          // 읽는 답이라면, 이건 지나간 알림에 대한 답이다). 성공은 적지 않는다.
          console.warn('[geurio] OS 알림을 띄우지 못했어요', { shell: desktopNotifyAvailable(), perm });
        });
      });
    },
    [showFor],
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
      onAllow={
        askAllow
          ? () => {
              void askNotifyPermission().then((perm) => {
                setAskAllow(false);
                // 허용한 그 자리에서 **그 알림을 실제로 띄운다** — 누른 결과가 눈에
                // 보여야 하고, 방금 온 알림이 OS 알림으로는 끝내 안 뜨는 것도 아니다.
                if (perm === 'granted') void showFor(current);
              });
            }
          : undefined
      }
    />
  );
}

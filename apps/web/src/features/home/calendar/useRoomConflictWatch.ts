// 회의실 거절을 **배경에서** 훑는다 — 일정 화면을 보고 있지 않아도(제보).
//
// ## 왜 이 훅이 생겼나
//
// 첫 판은 적재하는 자리를 `useGoogleCalendar`(일정 목록을 받는 곳) 하나로 뒀다.
// 그 훅은 **일정 화면·대시보드에만** 살아 있어서, 맵을 편집하고 있거나 홈의 다른
// 영역에 있으면 회의실이 거절해도 알림 센터에 아무것도 쌓이지 않았다(제보).
// 알림은 화면을 보고 있는 사람에게만 오는 것이 아니다 — 일정 알림이 이미 그렇게
// 산다(`useReminderScheduler`는 문지기 안에서 스스로 조회한다).
//
// 그래서 같은 모양을 쓴다: **로그인한 화면이면 어디서든** 돌면서 스스로 좁은 창을
// 조회하고 기록을 맞춘다(`syncRoomConflictNotices`).
//
// ## 캘린더 목록은 계정 값에서
//
// 스케줄러의 **거울**(`readReminderCalendars`)을 쓰지 않는다 — 그쪽은 "구글 일정도
// 알림"을 켠 사람에게만 만들어지고(꺼 둔 사람에게 왕복 0회는 의도된 결정이다),
// 만들려면 캘린더 목록 조회가 한 번 더 붙는다. 우리는 **id만** 필요하므로 계정
// 블롭의 값을 그대로 쓴다(`syncedGoogleCalendarIds`) — 새 왕복이 0이다. 그 값이
// 도착하는 시점은 마운트보다 늦을 수 있어 신호를 구독한다.
//
// ## 조회량
//
// 목적이 "놓치지 않는 것"이라 창을 한 달로 넓게 잡는 대신 주기를 길게 둔다(10분,
// 탭이 보일 때만). 회의실이 거절한 뒤 몇 분 늦게 아는 것은 문제가 아니다 — 보고
// 있지 않은 사람에게 가는 알림이기 때문이다. 우리가 **직접 고친** 일정은 기다리지
// 않는다(`onCalendarChanged`).

import { useCallback, useEffect, useRef } from 'react';
import { ensureGoogleToken, fetchEvents, type GoogleEvent } from './googleCalendar';
import { isoOf } from './model';
import { onCalendarChanged } from '../../reminders/calendarChanged';
import { onSyncedGoogleCalendarsChange, syncedGoogleCalendarIds } from '../../reminders/reminderSync';
import { syncRoomConflictNotices } from './roomConflictInbox';

/** 다시 훑는 주기 — 탭이 보일 때만 돈다. */
const WATCH_MS = 10 * 60_000;
/** 훑는 창(앞으로 며칠) — 한 달이면 달력 한 화면과 같은 폭이다. */
const WATCH_DAYS = 31;
/** 계기가 몰려도(신호 + 깨어남 + 주기) 이 간격 안에서는 한 번만. */
const MIN_GAP_MS = 60_000;

/** 오늘부터 `days`일 뒤까지(로컬) — 조회 구간. */
function watchWindow(now: Date, days: number): { from: string; to: string } {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  return { from: isoOf(now.getFullYear(), now.getMonth() + 1, now.getDate()), to: isoOf(end.getFullYear(), end.getMonth() + 1, end.getDate()) };
}

export function useRoomConflictWatch(): void {
  /** 마지막으로 훑은 시각 · 지금 훑는 중인가 — 계기가 겹쳐도 한 번만 나간다. */
  const lastRef = useRef(0);
  const busyRef = useRef(false);

  const scan = useCallback(async (force = false) => {
    if (busyRef.current) return;
    const now = Date.now();
    if (!force && now - lastRef.current < MIN_GAP_MS) return;
    const ids = syncedGoogleCalendarIds();
    if (!ids.length) return;
    busyRef.current = true;
    lastRef.current = now;
    try {
      // 토큰은 **팝업 없이** 받는다(서버가 refresh token을 들고 있다) — 못 받으면
      // 조용히 물러난다. 배경에서 동의 창이 저절로 뜨면 안 된다(#546).
      const got = await ensureGoogleToken();
      if (!('token' in got)) return;
      const { from, to } = watchWindow(new Date(), WATCH_DAYS);
      // 캘린더 하나가 실패해도(권한 없음·삭제됨) 나머지는 그대로 본다.
      const per = await Promise.all(
        ids.map((id) => fetchEvents(got.token.accessToken, { id, summary: '' }, from, to).catch(() => [] as GoogleEvent[])),
      );
      syncRoomConflictNotices(per.flat());
    } catch {
      /* 배경 일이다 — 실패는 다음 주기에 다시 시도한다 */
    } finally {
      busyRef.current = false;
    }
  }, []);

  useEffect(() => {
    const run = (force = false): void => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void scan(force);
    };
    // 마운트 직후 한 번(계정 값이 이미 와 있는 탭) + 값이 도착하면 그때.
    run(true);
    const offSynced = onSyncedGoogleCalendarsChange(() => run(true));
    // 우리가 고친 일정은 기다리지 않는다 — 방을 바꿔 저장한 직후가 그 자리다.
    const offChanged = onCalendarChanged(() => run(true));
    const t = window.setInterval(() => run(), WATCH_MS);
    const onWake = (): void => run();
    window.addEventListener('focus', onWake);
    document.addEventListener('visibilitychange', onWake);
    return () => {
      offSynced();
      offChanged();
      window.clearInterval(t);
      window.removeEventListener('focus', onWake);
      document.removeEventListener('visibilitychange', onWake);
    };
  }, [scan]);
}

// 알림 스케줄러 — 앱이 켜져 있는 동안 "지금 띄울 것"을 찾아 띄운다.
//
// **어느 화면에서든 돌아야 한다**: 마인드맵을 편집하는 중에도 10:20이 되면 알림이
// 와야 하므로, 일정 화면이 아니라 문지기(`RequireAuth`) 안에 마운트한다. 그래서
// 데이터를 화면에서 받아 오지 않고 스스로 좁은 창(오늘~+2일)만 조회한다.
//
// ## 모바일에서는 우리가 띄우지 않는다(3단계)
//
// Capacitor 앱에서 알림 권한이 있으면 **OS가 예약을 들고 있다**(`nativeSchedule.ts`)
// — 앱이 닫혀 있어도 뜬다. 그때 우리 주기 확인까지 띄우면 같은 알림이 둘이 되므로,
// 그 모드에서는 훑기를 **판단에서 빼고** 토스트를 OS의 수신 이벤트로 받는다.
// 권한이 없으면(거절·아직 안 물음) 예약을 맡길 수 없으므로 예전처럼 우리가 훑는다.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CalendarEvent } from '../../adapters/ports';
import { useEventStore } from '../../adapters/BackendContext';
import { ensureGoogleToken, fetchEvents, myRsvpOf, readReminderCalendars } from '../home/calendar/googleCalendar';
import { useLiveRefresh } from '../home/calendar/useLiveRefresh';
import {
  cancelNative,
  checkNativeNotifyPermission,
  nativeNotificationsAvailable,
  onNativeNotification,
  pendingNativeIds,
  scheduleNative,
} from '../../platform/nativeNotifications';
import {
  NATIVE_WINDOW_DAYS,
  planNativeSchedule,
  reminderNotificationId,
} from './nativeSchedule';
import {
  REMINDER_REFETCH_MS,
  REMINDER_TICK_MS,
  dueReminders,
  googleReminderItems,
  parseReminderExtra,
  reminderBody,
  reminderItems,
  reminderWindow,
  type GoogleReminderSource,
  type ReminderItem,
} from './reminders';
import {
  googleRemindersEnabled,
  markReminderFired,
  onRemindersEnabledChange,
  remindersEnabled,
  wasReminderFired,
} from './reminderPrefs';

/**
 * 구글 일정 중 알림에 쓸 것만 받아 온다(2단계) — 캘린더는 **이 기기의 거울**이
 * 알려 준다(`readReminderCalendars`: 홈이 적어 두는 "지금 보여 주는 캘린더 + 기본
 * 알림"). 그래야 에디터에서도, 워크스페이스 블롭을 읽지 않고 돌 수 있다.
 *
 * 토큰은 **팝업 없이** 받는다(`ensureGoogleToken` — 서버가 refresh token을 들고
 * 있다). 못 받으면 조용히 빈 손으로 물러난다: 알림 때문에 동의 창이 저절로 뜨면
 * 안 되고(#546), 여기서 "다시 연결"을 세울 자리도 아니다(화면이 그 일을 한다).
 */
async function fetchGoogleReminders(from: string, to: string): Promise<{ events: GoogleReminderSource[]; defaults: Map<string, number> }> {
  const cals = readReminderCalendars();
  if (!cals.length) return { events: [], defaults: new Map() };
  const got = await ensureGoogleToken();
  if (!('token' in got)) return { events: [], defaults: new Map() };
  const defaults = new Map<string, number>();
  for (const c of cals) if (typeof c.defaultMinutes === 'number') defaults.set(c.id, c.defaultMinutes);
  // 캘린더 하나가 실패해도(권한 없음·삭제됨) 나머지는 그대로 받는다.
  const per = await Promise.all(
    cals.map((c) => fetchEvents(got.token.accessToken, { id: c.id, summary: '' }, from, to).catch(() => [])),
  );
  return {
    events: per.flat().map((e) => ({
      id: e.id,
      calendarId: e.calendarId,
      title: e.title,
      startDate: e.startDate,
      ...(e.startTime ? { startTime: e.startTime } : {}),
      allDay: e.allDay,
      ...('reminderMinutes' in e ? { reminderMinutes: e.reminderMinutes } : {}),
      ...(e.holiday ? { holiday: true } : {}),
      ...(e.workLocation ? { workLocation: e.workLocation } : {}),
      ...((): { rsvp?: GoogleReminderSource['rsvp'] } => {
        const r = myRsvpOf(e);
        return r ? { rsvp: r } : {};
      })(),
    })),
    defaults,
  };
}

export interface ReminderQueue {
  /** 지금 보여 줄 알림(없으면 null). 여럿이 한꺼번에 뜨면 하나씩 넘긴다. */
  current: ReminderItem | null;
  /** 뒤에 몇 건 더 있는가 — 토스트가 "1건 더"로 말한다. */
  rest: number;
  dismiss: () => void;
}

/**
 * @param onFire 알림 한 건이 실제로 발화했을 때(OS 알림은 호출부가 띄운다 — 이 훅은
 *   브라우저 API를 직접 만지지 않아 테스트에서 그대로 돌 수 있다).
 */
export function useReminderScheduler(
  onFire?: (item: ReminderItem) => void,
  onOpen?: (item?: ReminderItem) => void,
): ReminderQueue {
  const eventStore = useEventStore();
  const [enabled, setEnabled] = useState(() => remindersEnabled());
  const [googleOn, setGoogleOn] = useState(() => googleRemindersEnabled());
  // OS가 예약을 들고 있는가 — 네이티브 셸 안이고 알림 권한이 있을 때만 참이다.
  //
  // **`null`은 "아직 모른다"**이고 그동안은 아무도 띄우지 않는다: 권한을 묻는 것이
  // 비동기라, 모르는 채로 우리가 먼저 띄우면 곧이어 OS도 띄워 같은 알림이 둘이 된다
  // (앱을 켠 직후가 정확히 그 순간이다). 웹은 물어볼 것이 없어 처음부터 `false`다.
  const [nativeOwned, setNativeOwned] = useState<boolean | null>(() =>
    nativeNotificationsAvailable() ? null : false,
  );
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [google, setGoogle] = useState<{ events: GoogleReminderSource[]; defaults: Map<string, number> }>(() => ({ events: [], defaults: new Map() }));
  const [queue, setQueue] = useState<ReminderItem[]>([]);
  const aliveRef = useRef(true);
  const fireRef = useRef(onFire);
  fireRef.current = onFire;
  const openRef = useRef(onOpen);
  openRef.current = onOpen;

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // 설정에서 켜고 끄면 **열려 있는 모든 화면**이 따라온다(스케줄러가 화면마다 있다).
  //
  // 권한도 이때 다시 본다: 모바일에서 알림을 켜는 그 클릭이 곧 OS 권한을 묻는
  // 제스처라(설정 토글), 허용 직후에 OS 예약 모드로 넘어가야 한다.
  const probeNative = useCallback(() => {
    if (!nativeNotificationsAvailable()) {
      setNativeOwned(false);
      return;
    }
    void checkNativeNotifyPermission().then((perm) => {
      if (aliveRef.current) setNativeOwned(perm === 'granted');
    });
  }, []);

  useEffect(() => {
    probeNative();
    return onRemindersEnabledChange(() => {
      setEnabled(remindersEnabled());
      setGoogleOn(googleRemindersEnabled());
      probeNative();
    });
  }, [probeNative]);

  // OS에 맡기는 모드에서는 **더 멀리** 본다 — 앱을 며칠 열지 않아도 그동안의
  // 알림이 이미 예약돼 있어야 한다(앱이 켜져 있을 때만 도는 웹은 이틀이면 족하다).
  const windowDays = nativeOwned === true ? NATIVE_WINDOW_DAYS : undefined;

  const fetchWindow = useCallback(() => {
    if (!enabled) {
      setEvents([]);
      setGoogle({ events: [], defaults: new Map() });
      return;
    }
    const { from, to } = reminderWindow(new Date(), windowDays);
    void eventStore
      .list(from, to)
      .then((list) => {
        if (aliveRef.current) setEvents(list);
      })
      // 조회 실패는 조용히 넘긴다 — 들고 있던 것으로 계속 돌고 다음 주기가 다시 묻는다.
      .catch(() => undefined);
    // 구글은 **켜 두었을 때만** 묻는다 — 끈 사람에게는 왕복이 한 번도 나가지 않는다.
    if (!googleOn) {
      setGoogle({ events: [], defaults: new Map() });
      return;
    }
    void fetchGoogleReminders(from, to)
      .then((got) => {
        if (aliveRef.current) setGoogle(got);
      })
      .catch(() => undefined);
  }, [eventStore, enabled, googleOn, windowDays]);

  useEffect(() => {
    fetchWindow();
    if (!enabled) return;
    const timer = window.setInterval(fetchWindow, REMINDER_REFETCH_MS);
    return () => window.clearInterval(timer);
  }, [fetchWindow, enabled]);

  // 깨어나는 순간(탭 복귀·포커스·네트워크 복귀)에도 다시 묻는다 — 절전에서 돌아온
  // 직후가 "그동안 뭐가 생겼나"를 알아야 하는 바로 그 시점이다.
  useLiveRefresh(enabled, fetchWindow);

  // 두 원천을 **한 목록**으로 합쳐 같은 규칙(유예·중복 방지·큐·OS 예약)을 지나게
  // 한다 — 갈라 두면 한쪽에만 규칙이 붙는다.
  const items = useMemo(() => {
    if (!enabled) return [] as ReminderItem[];
    const { from, to } = reminderWindow(new Date(), windowDays);
    const mine = reminderItems(events, from, to);
    return googleOn ? [...mine, ...googleReminderItems(google.events, google.defaults, from, to)] : mine;
  }, [events, google, googleOn, enabled, windowDays]);

  const tick = useCallback(() => {
    // OS가 예약을 들고 있으면(또는 아직 모르면) 우리가 띄우지 않는다.
    if (!enabled || nativeOwned !== false) return;
    const due = dueReminders(items, Date.now());
    const fresh: ReminderItem[] = [];
    for (const item of due) {
      // 저장소를 **바로 앞에서** 읽는다 — 탭이 여럿이면 각자 주기를 돌린다.
      if (wasReminderFired(item.key, item.fireAt)) continue;
      markReminderFired(item.key, item.fireAt);
      fresh.push(item);
      fireRef.current?.(item);
    }
    if (fresh.length) setQueue((q) => [...q, ...fresh]);
  }, [items, enabled, nativeOwned]);

  useEffect(() => {
    if (!enabled || nativeOwned !== false) return;
    // 목록이 바뀌면 곧바로 한 번 확인한다 — 앱을 켠 직후의 "이미 지난 알림"(유예 안쪽)이
    // 30초를 기다리지 않게.
    tick();
    const timer = window.setInterval(tick, REMINDER_TICK_MS);
    return () => window.clearInterval(timer);
  }, [tick, enabled, nativeOwned]);

  // 알림을 끄면 떠 있던 것도 내린다(끈 뒤에도 남아 있으면 꺼진 것으로 보이지 않는다).
  useEffect(() => {
    if (!enabled) setQueue([]);
  }, [enabled]);

  // ── 모바일: OS에 예약을 맡긴다(3단계) ────────────────────────────────────
  //
  // **집합 차이**만 낸다(`planNativeSchedule`) — 통째로 지웠다 다시 심으면 그 찰나에
  // 곧 뜰 알림이 사라지고, 같은 입력에도 OS에 쓸데없는 일을 시킨다.
  //
  // `enabled`를 이 효과의 조건으로 두지 않는다: 꺼지면 `items`가 빈 목록이 되어
  // **같은 경로로** 전부 거둬진다(끄는 길을 따로 만들면 한쪽이 빠진다).
  useEffect(() => {
    if (nativeOwned !== true) return;
    let alive = true;
    void (async () => {
      const pending = await pendingNativeIds();
      if (!alive) return;
      const plan = planNativeSchedule(items, pending, Date.now());
      if (plan.cancel.length) await cancelNative(plan.cancel);
      if (!alive || !plan.schedule.length) return;
      await scheduleNative(
        plan.schedule.map((item) => ({
          id: reminderNotificationId(item.key, item.fireAt, item.title),
          title: item.title,
          body: reminderBody(item),
          at: item.fireAt,
          // 알림이 뜨거나 탭될 때 그대로 돌아온다 — 앱이 닫혀 있다 열리는 경로라
          // 그때 다시 조회하지 않고도 무엇에 대한 알림인지 안다.
          extra: item,
        })),
      );
    })().catch((err: unknown) => {
      // 예약 실패는 조용히 넘긴다(권한 회수·기기 제한) — 다음 동기화가 다시 시도한다.
      console.warn('[geurio] 로컬 알림 예약 실패', err);
    });
    return () => {
      alive = false;
    };
  }, [items, nativeOwned]);

  // OS가 띄운 알림을 받는다: 앱이 떠 있으면 인앱 토스트로 잇고(iOS는 그때 배너를
  // 감추므로 이것이 유일한 표시다), **탭**이면 일정 화면으로 간다(앱이 닫혀 있다
  // 열리는 경로 포함).
  useEffect(() => {
    if (nativeOwned !== true) return;
    let off: (() => void) | null = null;
    let alive = true;
    void onNativeNotification((extra, tapped) => {
      const item = parseReminderExtra(extra);
      if (tapped) {
        // 탭한 알림이 가리키는 **그 일정**으로 — payload를 못 읽으면(옛 예약)
        // 예전처럼 화면만 연다.
        openRef.current?.(item ?? undefined);
        return;
      }
      if (item) setQueue((q) => [...q, item]);
    }).then((fn) => {
      if (alive) off = fn;
      else fn();
    });
    return () => {
      alive = false;
      off?.();
    };
  }, [nativeOwned]);

  const dismiss = useCallback(() => setQueue((q) => q.slice(1)), []);
  return { current: queue[0] ?? null, rest: Math.max(0, queue.length - 1), dismiss };
}

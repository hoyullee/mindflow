// 알림 스케줄러 — 앱이 켜져 있는 동안 "지금 띄울 것"을 찾아 띄운다.
//
// **어느 화면에서든 돌아야 한다**: 마인드맵을 편집하는 중에도 10:20이 되면 알림이
// 와야 하므로, 일정 화면이 아니라 문지기(`RequireAuth`) 안에 마운트한다. 그래서
// 데이터를 화면에서 받아 오지 않고 스스로 좁은 창(오늘~+2일)만 조회한다.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CalendarEvent } from '../../adapters/ports';
import { useEventStore } from '../../adapters/BackendContext';
import { useLiveRefresh } from '../home/calendar/useLiveRefresh';
import {
  REMINDER_REFETCH_MS,
  REMINDER_TICK_MS,
  dueReminders,
  reminderItems,
  reminderWindow,
  type ReminderItem,
} from './reminders';
import { markReminderFired, onRemindersEnabledChange, remindersEnabled, wasReminderFired } from './reminderPrefs';

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
export function useReminderScheduler(onFire?: (item: ReminderItem) => void): ReminderQueue {
  const eventStore = useEventStore();
  const [enabled, setEnabled] = useState(() => remindersEnabled());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [queue, setQueue] = useState<ReminderItem[]>([]);
  const aliveRef = useRef(true);
  const fireRef = useRef(onFire);
  fireRef.current = onFire;

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // 설정에서 켜고 끄면 **열려 있는 모든 화면**이 따라온다(스케줄러가 화면마다 있다).
  useEffect(() => onRemindersEnabledChange(() => setEnabled(remindersEnabled())), []);

  const fetchWindow = useCallback(() => {
    if (!enabled) {
      setEvents([]);
      return;
    }
    const { from, to } = reminderWindow();
    void eventStore
      .list(from, to)
      .then((list) => {
        if (aliveRef.current) setEvents(list);
      })
      // 조회 실패는 조용히 넘긴다 — 들고 있던 것으로 계속 돌고 다음 주기가 다시 묻는다.
      .catch(() => undefined);
  }, [eventStore, enabled]);

  useEffect(() => {
    fetchWindow();
    if (!enabled) return;
    const timer = window.setInterval(fetchWindow, REMINDER_REFETCH_MS);
    return () => window.clearInterval(timer);
  }, [fetchWindow, enabled]);

  // 깨어나는 순간(탭 복귀·포커스·네트워크 복귀)에도 다시 묻는다 — 절전에서 돌아온
  // 직후가 "그동안 뭐가 생겼나"를 알아야 하는 바로 그 시점이다.
  useLiveRefresh(enabled, fetchWindow);

  const tick = useCallback(() => {
    if (!enabled) return;
    const { from, to } = reminderWindow();
    const due = dueReminders(reminderItems(events, from, to), Date.now());
    const fresh: ReminderItem[] = [];
    for (const item of due) {
      // 저장소를 **바로 앞에서** 읽는다 — 탭이 여럿이면 각자 주기를 돌린다.
      if (wasReminderFired(item.key, item.fireAt)) continue;
      markReminderFired(item.key, item.fireAt);
      fresh.push(item);
      fireRef.current?.(item);
    }
    if (fresh.length) setQueue((q) => [...q, ...fresh]);
  }, [events, enabled]);

  useEffect(() => {
    if (!enabled) return;
    // 목록이 바뀌면 곧바로 한 번 확인한다 — 앱을 켠 직후의 "이미 지난 알림"(유예 안쪽)이
    // 30초를 기다리지 않게.
    tick();
    const timer = window.setInterval(tick, REMINDER_TICK_MS);
    return () => window.clearInterval(timer);
  }, [tick, enabled]);

  // 알림을 끄면 떠 있던 것도 내린다(끈 뒤에도 남아 있으면 꺼진 것으로 보이지 않는다).
  useEffect(() => {
    if (!enabled) setQueue([]);
  }, [enabled]);

  const dismiss = useCallback(() => setQueue((q) => q.slice(1)), []);
  return { current: queue[0] ?? null, rest: Math.max(0, queue.length - 1), dismiss };
}

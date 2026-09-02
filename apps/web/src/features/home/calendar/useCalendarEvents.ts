// 일정 화면이 읽는 **Geurio 일정**(0033). 칸반 마감(`entries.ts`)과 나란한 두 번째 원천.
//
// 조회 구간은 **보이는 월 격자 6주**다(달 경계를 넘는다) — 격자가 그리는 것과 목록이
// 세는 것이 같아야 하고, 한 번에 한 달치만 받으므로 전송량이 유한하다.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useEventStore } from '../../../adapters/BackendContext';
import type { CalendarEvent, CalendarEventInput } from '../../../adapters/ports';
import { gridRange } from './model';
import { useLiveRefresh } from './useLiveRefresh';

export interface CalendarEventsApi {
  events: CalendarEvent[];
  loading: boolean;
  /** 저장 결과의 오류 문구(팝업이 보여 준다). null이면 성공. */
  create: (input: CalendarEventInput) => Promise<string | null>;
  update: (id: string, patch: Partial<CalendarEventInput>) => Promise<string | null>;
  remove: (id: string) => Promise<string | null>;
  reload: () => void;
}

/**
 * @param enabled 이 화면이 실제로 일정을 그리는가 — 대시보드는 위젯마다 이 훅을
 *   지나므로(문서 위젯이 대부분) 끄지 않으면 위젯 수만큼 조회가 나간다.
 */
export function useCalendarEvents(y: number, m: number, enabled = true): CalendarEventsApi {
  const eventStore = useEventStore();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const { from, to } = gridRange(y, m);
  /**
   * @param quiet 보고 있는 중의 갱신인가 — 그러면 로딩 표시를 켜지 않는다(화면이
   *   깜빡이지 않게). 조회가 실패해도 들고 있던 것을 그대로 둔다.
   */
  const run = useCallback(
    (quiet: boolean) => {
      if (!enabled) {
        setEvents([]);
        setLoading(false);
        return;
      }
      if (!quiet) setLoading(true);
      void eventStore
        .list(from, to)
        .then((list) => {
          if (aliveRef.current) setEvents(list);
        })
        .catch(() => undefined)
        .finally(() => {
          if (aliveRef.current && !quiet) setLoading(false);
        });
    },
    [eventStore, from, to, enabled],
  );
  const reload = useCallback(() => run(false), [run]);

  useEffect(() => reload(), [reload]);

  // 열어 둔 채 **다른 기기에서** 바뀐 일정도 잡는다(제보) — 탭 복귀·주기 갱신.
  useLiveRefresh(enabled, () => run(true));

  return {
    events,
    loading,
    reload,
    create: async (input) => {
      const res = await eventStore.create(input);
      if (res.error) return res.error;
      reload();
      return null;
    },
    update: async (id, patch) => {
      const res = await eventStore.update(id, patch);
      if (res.error) return res.error;
      reload();
      return null;
    },
    remove: async (id) => {
      const res = await eventStore.remove(id);
      if (res.error) return res.error;
      reload();
      return null;
    },
  };
}

// 공책이 보는 **일정** — 일정 블록(스펙 2절)과 우측 「일정」 탭(5절)이 함께 쓰는 원천.
//
// ## 왜 홈의 훅을 그대로 못 쓰나
//
// 일정 화면은 `useCalendarEntries(state)`로 칸반 마감까지 모으는데, 그 훅은 **홈 상태**
// (스페이스·공유받은 맵·썸네일 본문)를 먹는다. 에디터 라우트에는 그 상태가 없다 —
// 만들려면 홈이 하는 프리페치를 통째로 옮겨야 한다.
//
// 그래서 여기서는 **두 원천만** 든다(사용자 결정): 그리오 일정(0033)과 구글 캘린더.
// 칸반 마감은 다음 일이다 — 필요해지면 이 함수에 세 번째 배열을 더하면 되고, 그때
// 넘겨야 할 것은 "어느 보드를 볼 것인가"다.
//
// ## 구글 설정은 어디서 오나
//
// 홈은 `state.google`에 들고 있지만 에디터에는 그 상태가 없으므로 **워크스페이스 블롭을
// 직접 한 번 읽는다**(`SpaceStore.load`). 읽은 값은 모듈에 캐시해 둔다 — 공책을 여닫을
// 때마다 같은 블롭을 다시 받을 이유가 없고, 설정이 바뀌는 자리는 홈뿐이라 이 탭이 사는
// 동안은 변하지 않는다(바뀌었다면 홈을 지나온 것이고, 그때는 새로고침이 따른다).

import { useEffect, useMemo, useState } from 'react';
import type { CalendarEntry } from '../home/calendar/entries';
import { eventEntries, googleEntries, holidayMap } from '../home/calendar/entries';
import type { HolidayInfo } from '../home/calendar/entries';
import { gridRange } from '../home/calendar/model';
import { useCalendarEvents } from '../home/calendar/useCalendarEvents';
import { googlePrefsOf, useGoogleCalendar, type GoogleCalendarPrefs } from '../home/calendar/useGoogleCalendar';
import { useSpaceStore } from '../../adapters/BackendContext';
import type { SpaceStore } from '../../adapters/ports';

type GooglePrefBlob = { calendars: string[]; extra?: { id: string; name: string }[]; holiday?: string } | null;

/** 이 탭이 이미 읽어 둔 구글 설정 — 같은 블롭을 공책마다 다시 받지 않는다. */
let prefCache: { at: Promise<GooglePrefBlob> } | null = null;

/** 테스트가 탭 캐시를 비운다(`clearGoogleSessionCache`와 같은 자리). */
export function clearNoteAgendaPrefCache(): void {
  prefCache = null;
}

function loadGooglePrefs(store: SpaceStore): Promise<GooglePrefBlob> {
  if (!prefCache) {
    prefCache = {
      at: store
        .load()
        .then((ws) => (ws?.google ?? null) as GooglePrefBlob)
        .catch(() => null),
    };
  }
  return prefCache.at;
}

export interface NoteAgenda {
  /** 이 달(격자 6주)의 일정 — 그리오 + 구글을 한 모양으로 합쳤다. */
  entries: CalendarEntry[];
  /** 공휴일(구글) — 날짜 색을 큰 달력과 같게 하려면 필요하다. */
  holidays: Record<string, HolidayInfo>;
  /** 아직 첫 조회가 끝나지 않았는가 — 빈 목록과 "아직 모름"을 가른다. */
  loading: boolean;
}

/**
 * 공책이 볼 **그 달**의 일정.
 *
 * @param enabled 블록도 탭도 없으면 끈다 — 공책을 열기만 해도 일정 왕복이 나가면
 *   글만 쓰는 사람이 매번 그 비용을 낸다.
 */
export function useNoteAgenda(y: number, m: number, enabled = true): NoteAgenda {
  const spaceStore = useSpaceStore();
  const [prefs, setPrefs] = useState<GoogleCalendarPrefs>(() => googlePrefsOf(null));
  const [prefsReady, setPrefsReady] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void loadGooglePrefs(spaceStore).then((g) => {
      if (!alive) return;
      setPrefs(googlePrefsOf(g));
      setPrefsReady(true);
    });
    return () => {
      alive = false;
    };
  }, [enabled, spaceStore]);

  const events = useCalendarEvents(y, m, enabled);
  // 설정을 읽기 전에는 **끈 상태로** 돈다 — `enabled: false`인 prefs를 넘기면 훅이
  // 아무것도 부르지 않는다(연동하지 않은 계정과 같은 길).
  const google = useGoogleCalendar(y, m, enabled && prefsReady ? prefs : googlePrefsOf(null), () => {});

  const entries = useMemo(() => {
    if (!enabled) return [];
    const evs = eventEntries(events.events, gridRange(y, m));
    const gs = googleEntries(google.events);
    return [...evs, ...gs].sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : (a.startTime ?? '') < (b.startTime ?? '') ? -1 : a.title < b.title ? -1 : 1));
  }, [enabled, events.events, google.events, y, m]);

  const holidays = useMemo(() => holidayMap(google.events), [google.events]);

  return { entries, holidays, loading: enabled && events.loading };
}

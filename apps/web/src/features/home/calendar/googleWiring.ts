/**
 * 구글 훅에서 **두 팝업이 함께 쓰는 값**을 뽑아낸다 — 새 일정 목적지와 선택 스코프.
 *
 * 일정 화면(`CalendarView`)과 공책의 날짜 칩 팝오버(`NoteEventPopups`)가 같은 팝업을
 * 띄우므로, 이 파생이 두 곳에 흩어지면 **한쪽만 고쳐진다**(회의실이 일정 화면에서만
 * 보인다든가). 그래서 한 자리에 둔다.
 */

import type { GoogleCalendarApi } from './useGoogleCalendar';
import type { GoogleDirectoryApi } from './GoogleEventFields';

export interface GoogleTargetLite {
  id: string;
  name: string;
  color?: string;
  primary?: boolean;
}

/** 새 일정의 목적지 — **쓸 수 있는** 구글 캘린더만(공휴일·보기 전용은 뺀다). */
export function googleTargetsOf(google: GoogleCalendarApi): GoogleTargetLite[] {
  return google.writableCalendars.map((c) => ({ id: c.id, name: c.summary, ...(c.color ? { color: c.color } : {}), ...(c.primary ? { primary: true } : {}) }));
}

/** 선택 스코프로 열리는 것들(이름 검색·회의실) — 상세와 새 일정이 같은 것을 쓴다. */
export function googleDirectoryOf(google: GoogleCalendarApi): GoogleDirectoryApi {
  return {
    canSearchPeople: google.canSearchPeople,
    searchPeople: google.searchPeople,
    canPickRooms: google.canPickRooms,
    rooms: google.rooms,
    roomsReady: google.roomsReady,
    loadRooms: google.loadRooms,
    checkRoomBusy: google.checkRoomBusy,
  };
}

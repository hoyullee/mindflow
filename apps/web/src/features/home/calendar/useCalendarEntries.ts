// 전 스페이스 + 공유받은 맵의 **칸반 마감**을 모으는 훅 — 일정 화면과 대시보드
// 캘린더 위젯이 함께 쓴다(같은 것을 두 벌로 두지 않는다).
//
// 본문은 **썸네일이 이미 받아 둔 것**(`previewDocs`)이라 이 훅이 새로 내려받는
// 것은 없다. 모자란 스페이스는 컨트롤러가 검색과 같은 프리페치 경로로 채운다.

import { useMemo } from 'react';
import type { HomeState } from '../types';
import { calendarEntries, type CalendarEntry, type CalendarSource } from './entries';

/**
 * @param enabled 이 화면이 실제로 일정을 그리는가 — 대시보드는 위젯마다 이 훅을
 *   지나므로(문서 위젯이 대부분) 끄지 않으면 위젯 수만큼 헛일을 한다.
 */
export function useCalendarEntries(state: HomeState, enabled = true): CalendarEntry[] {
  return useMemo(() => {
    if (!enabled) return [];
    const sources: CalendarSource[] = [];
    for (const sp of state.spaces) {
      if (sp.id === 'drive') continue; // Drive 데모에는 우리 문서가 없다
      for (const mp of Array.isArray(sp.maps) ? sp.maps : []) {
        if (mp.docId) sources.push({ docId: mp.docId, boardName: mp.title, spaceName: sp.name });
      }
    }
    // 공유받은 맵도 내 일정이다 — 다만 스페이스가 없으므로 구획 이름으로 표기한다.
    // 보기 전용(role='view')이면 그대로 실어 보낸다: 끌리지도, 고쳐지지도 않는다.
    for (const sm of state.sharedMaps) sources.push({ docId: sm.docId, boardName: sm.title, spaceName: '공유받음', ...(sm.role === 'view' ? { readOnly: true } : {}) });
    return calendarEntries(sources, state.previewDocs);
  }, [enabled, state.spaces, state.sharedMaps, state.previewDocs]);
}

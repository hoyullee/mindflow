/**
 * 공책 안에서 여는 **일정 팝업 둘** — 상세와 새로 만들기(요청 5·6).
 *
 * 날짜 칩 팝오버에서 일정을 고르면 일정 화면으로 **건너가 버렸다**. 공책을 읽다가
 * 일정 하나를 확인하려고 문서를 떠나는 것은 값이 너무 크다 — 그래서 일정 화면이 쓰는
 * 그 팝업을 여기서 그대로 띄운다. **부품을 새로 만들지 않는다**: `EventDetail`·
 * `GoogleDetailHost`·`NewEventModal`은 일정 화면의 것 그대로이고, 붙이는 값의 파생도
 * 한 자리에서 가져온다(`googleWiring`) — 두 벌이 되는 순간 한쪽만 고쳐진다.
 *
 * ## 조회는 팝업이 열렸을 때만
 *
 * `useNoteAgenda`를 `enabled`로 켠다. 공책을 열어 두기만 해도 일정 왕복이 나가면
 * 글만 쓰는 사람이 그 비용을 내고, 칩 팝오버(`NoteDatePop`)가 이미 제 몫을 받아 온다.
 *
 * ## 달은 **열린 것**이 정한다
 *
 * 상세는 그 일정이 있는 달을, 새로 만들기는 놓일 날의 달을 본다 — 그 달을 받아야
 * 목록에서 그 일정을 찾을 수 있다.
 */

import { useMemo, useState } from 'react';
import type { CalendarEvent, CalendarEventInput } from '../../../adapters/ports';
import { EventDetail, geurioCalendarChips } from '../../home/calendar/EventDetail';
import { GoogleDetailHost } from '../../home/calendar/GoogleEventDetail';
import { NewEventModal } from '../../home/calendar/NewEventModal';
import { submitNewEvent } from '../../home/calendar/newEventSubmit';
import { geurioColorOptions } from '../../home/calendar/eventColor';
import { googleDirectoryOf, googleTargetsOf } from '../../home/calendar/googleWiring';
import { partsOf } from '../../home/calendar/model';
import { useNoteAgenda } from '../noteAgenda';

/** 지금 열려 있는 것 — 셋 중 하나이거나 아무것도 아니다. */
export type NoteEventOpen =
  /** 그리오 일정 상세. `occ`는 반복의 그 회차(삭제 범위의 기준). */
  | { kind: 'geurio'; id: string; occ?: string; at: string }
  /** 구글 일정 상세 — 쓸 수 있으면 고칠 수도 있다(그쪽 host가 가른다). */
  | { kind: 'google'; id: string; at: string }
  /** 새 일정 — 놓일 날. */
  | { kind: 'new'; at: string };

export function NoteEventPopups({ open, isMobile, onClose }: { open: NoteEventOpen | null; isMobile: boolean; onClose: () => void }) {
  const at = open ? partsOf(open.at) : null;
  const agenda = useNoteAgenda(at?.y ?? 2026, at?.m ?? 1, !!open);
  const { events, google } = agenda;
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const targets = useMemo(() => googleTargetsOf(google), [google]);
  const directory = useMemo(() => googleDirectoryOf(google), [google]);

  if (!open) return null;

  if (open.kind === 'new') {
    return (
      <NewEventModal
        draft={{ date: open.at, allDay: true }}
        isMobile={isMobile}
        saving={saving}
        error={saveError}
        googleTargets={targets}
        directory={directory}
        googleColors={google.eventColors}
        onClose={() => {
          setSaveError(null);
          onClose();
        }}
        onSubmit={(input: CalendarEventInput, target) => {
          setSaving(true);
          void submitNewEvent(input, target, { createGeurio: events.create, createGoogle: google.createEvent }, google.selfEmail).then((err) => {
            setSaving(false);
            setSaveError(err);
            if (!err) onClose();
          });
        }}
      />
    );
  }

  if (open.kind === 'google') {
    return (
      <GoogleDetailHost
        openId={open.id}
        events={google.events}
        isMobile={isMobile}
        onClose={onClose}
        onPatch={google.updateEvent}
        onDelete={google.deleteEvent}
        directory={directory}
        colors={google.eventColors}
        calendarDefaults={google.calendarDefaults}
      />
    );
  }

  // 그리오 일정 — 목록이 아직이거나 지워졌으면 조용히 아무것도 그리지 않는다
  // (일정 화면의 상세와 같은 태도다: 없는 것을 억지로 세우지 않는다).
  const ev: CalendarEvent | undefined = events.events.find((e) => e.id === open.id);
  if (!ev) return null;
  return (
    <EventDetail
      key={ev.id}
      event={ev}
      isMobile={isMobile}
      {...(open.occ ? { occurrence: open.occ } : {})}
      calendarChips={geurioCalendarChips(targets)}
      color={{ value: ev.color ?? null, options: geurioColorOptions() }}
      onClose={onClose}
      onPatch={(patch) => events.update(ev.id, patch)}
      onDelete={() => events.remove(ev.id)}
    />
  );
}

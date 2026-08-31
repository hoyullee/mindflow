// 새 일정을 **어디에** 저장하는가 — 두 소비처(일정 화면·대시보드 위젯)가 함께 쓴다.
//
// 저장할 곳이 둘(우리 표 / 구글)이라 갈림이 생겼고, 그 갈림을 두 화면이 각자 적으면
// 한쪽만 고쳐지는 순간 같은 팝업이 다르게 동작한다. 그래서 한 함수로 둔다.

import type { CalendarEventInput } from '../../../adapters/ports';
import { buildRecurrence, type GoogleEventDraft } from './googleCalendar';
import type { GoogleFieldsValue } from './GoogleEventFields';
import type { NewEventTarget } from './NewEventModal';

/**
 * 우리 말(`note`) → 구글 말(`description`). 그 밖은 이름이 같다.
 * 구글 전용 필드(참석자·반복·알림 등)는 목적지에 실려 온 값을 그대로 얹는다.
 */
export function inputToGoogleDraft(input: CalendarEventInput, fields?: GoogleFieldsValue): GoogleEventDraft {
  const rrule = fields ? buildRecurrence(fields.recurrence) : undefined;
  return {
    title: input.title,
    allDay: input.allDay,
    startDate: input.startDate,
    endDate: input.endDate,
    ...(input.startTime ? { startTime: input.startTime } : {}),
    ...(input.endTime ? { endTime: input.endTime } : {}),
    location: input.location ?? '',
    description: input.note ?? '',
    ...(fields
      ? {
          attendees: fields.attendees,
          rooms: fields.rooms,
          visibility: fields.visibility,
          transparency: fields.transparency,
          reminderMinutes: fields.reminderMinutes,
          ...(rrule ? { recurrence: rrule } : {}),
          ...(fields.addMeet ? { addMeet: true } : {}),
        }
      : {}),
  };
}

export interface NewEventSinks {
  createGeurio: (input: CalendarEventInput) => Promise<string | null>;
  createGoogle: (calendarId: string, draft: GoogleEventDraft) => Promise<string | null>;
}

/** 성공하면 `null`, 실패하면 사람이 읽을 문장(팝업 발치가 그대로 보여 준다). */
export function submitNewEvent(input: CalendarEventInput, target: NewEventTarget, sinks: NewEventSinks): Promise<string | null> {
  return target.kind === 'google' ? sinks.createGoogle(target.calendarId, inputToGoogleDraft(input, target.fields)) : sinks.createGeurio(input);
}

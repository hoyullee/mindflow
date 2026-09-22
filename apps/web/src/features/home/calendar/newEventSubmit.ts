// 새 일정을 **어디에** 저장하는가 — 두 소비처(일정 화면·대시보드 위젯)가 함께 쓴다.
//
// 저장할 곳이 둘(우리 표 / 구글)이라 갈림이 생겼고, 그 갈림을 두 화면이 각자 적으면
// 한쪽만 고쳐지는 순간 같은 팝업이 다르게 동작한다. 그래서 한 함수로 둔다.

import type { CalendarEventInput } from '../../../adapters/ports';
import { buildRecurrence, type GoogleEventDraft, type GoogleRsvp } from './googleCalendar';
import type { GoogleFieldsValue } from './GoogleEventFields';
import type { NewEventTarget } from './NewEventModal';

/**
 * 우리 말(`note`) → 구글 말(`description`). 그 밖은 이름이 같다.
 * 구글 전용 필드(참석자·반복·알림 등)는 목적지에 실려 온 값을 그대로 얹는다.
 */
/**
 * **내가 만든 일정에는 내가 참석한다**(요청 3).
 *
 * 왜 필요한가: 구글은 주최자를 암묵적 참석자로 보지만 **API로 만든 일정에는 그 행을
 * 넣어 주지 않는다**(캘린더 화면에서 만들 때와 다른 점이다). 그래서 내가 만든 일정을
 * 우리 팝업에서 열면 내 응답이 없어(`selfEmail`이 서지 않는다) 「참석 여부」 구획이
 * 통째로 사라졌고, 구글 쪽 게스트 목록에도 "나"가 없었다 — 제보 1·3의 공통 뿌리다.
 *
 * **사람을 초대한 일정에만** 넣는다: 아무도 없는 일정에 나 하나를 넣으면 구글에서
 * "참석자 1명"짜리 회의가 되어 게스트 구획·초대 취소 확인이 붙는다. 혼자 적어 둔
 * 일정에 있을 이유가 없는 것들이다. 회의실만 잡은 일정도 넣지 않는다 — 리소스는 내
 * 응답을 볼 사람이 아니다.
 *
 * 내 주소를 손으로 적어 둔 경우에는 **중복을 만들지 않고 응답만 올린다**. 그때 키는
 * 배열에 든 **그 표기 그대로**여야 한다 — `attendeesBody`가 `rsvps`를 정확한 문자열로
 * 찾기 때문이다(대소문자가 다르면 조용히 안 붙는다).
 */
export function withSelfAccepted(attendees: readonly string[], me?: string): { attendees: string[]; rsvps?: Record<string, GoogleRsvp> } {
  const self = (me ?? '').trim().toLowerCase();
  if (!self || attendees.length === 0) return { attendees: [...attendees] };
  const mine = attendees.find((e) => e.trim().toLowerCase() === self);
  return { attendees: mine ? [...attendees] : [...attendees, self], rsvps: { [mine ?? self]: 'accepted' } };
}

export function inputToGoogleDraft(input: CalendarEventInput, fields?: GoogleFieldsValue, me?: string): GoogleEventDraft {
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
          // `attendees`(+ 내 `rsvps`)를 함께 준다 — **뒤에 다시 `attendees:`를 쓰면 덮인다**.
          ...withSelfAccepted(fields.attendees, me),
          rooms: fields.rooms,
          visibility: fields.visibility,
          transparency: fields.transparency,
          // 종일 일정에는 알림을 싣지 않는다 — 화면이 못 고르게 막아 둔 값이고
          // (`ReminderField` 주석: 우리 칩은 전부 "N분 전"인데 종일의 기준은 자정이다),
          // 시각으로 고른 뒤 종일로 바꾼 초안이 그대로 저장되면 고른 적 없는 알림이
          // 생긴다. `undefined`는 "안 건드린다"라 그 캘린더의 기본이 그대로 적용된다.
          reminderMinutes: input.allDay ? undefined : fields.reminderMinutes,
          ...(fields.colorId ? { colorId: fields.colorId } : {}),
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
export function submitNewEvent(input: CalendarEventInput, target: NewEventTarget, sinks: NewEventSinks, me?: string): Promise<string | null> {
  return target.kind === 'google' ? sinks.createGoogle(target.calendarId, inputToGoogleDraft(input, target.fields, me)) : sinks.createGeurio(input);
}

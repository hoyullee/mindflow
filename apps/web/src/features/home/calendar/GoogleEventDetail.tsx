// 구글 일정 상세 — **Geurio 일정과 같은 팝업**(PR6).
//
// PR5에서는 고칠 것이 하나도 없어 자기 팝업이었지만, 이제 쓰기 권한이 있으니 고칠
// 것이 Geurio 일정과 같다(제목·종일·날짜·시각·위치·메모·삭제). 그래서 이 파일은
// **값을 옮기는 얇은 층**이다 — 팝업 하나(`EventDetail`)를 두 원천이 함께 쓴다.
// 둘로 갈라 두면 한쪽에만 기능이 붙는다(`CommentThreads`·`ShareModal`과 같은 판단).
//
// 여기서 고친 것은 **구글에만** 남는다. 우리 표에 사본을 두지 않으므로(구글이 정본)
// 저장이 끝나면 훅이 보이는 달을 다시 받아 구글이 돌려준 것을 그린다.

import { useState } from 'react';
import { EventDetail, type CalendarChip } from './EventDetail';
import { GoogleEventFields, type GoogleDirectoryApi, type GoogleFieldsChange, type GoogleFieldsValue } from './GoogleEventFields';
import { attendeesBody, remindersBody, whenBody, RECURRENCE_OFF } from './googleCalendar';
import type { CalendarEvent, CalendarEventInput } from '../../../adapters/ports';
import type { GoogleEvent, GoogleEventDraft, GoogleEventPatch, GoogleWriteField } from './googleCalendar';

/** 구글 일정 → 팝업이 읽는 모양. 이름만 다르고 뜻은 같다(`description` ↔ `note`). */
export function googleAsEvent(g: GoogleEvent): CalendarEvent {
  return {
    id: g.id,
    title: g.title,
    startDate: g.startDate,
    endDate: g.endDate,
    allDay: g.allDay,
    ...(g.startTime ? { startTime: g.startTime } : {}),
    ...(g.endTime ? { endTime: g.endTime } : {}),
    ...(g.location ? { location: g.location } : {}),
    ...(g.description ? { note: g.description } : {}),
    ...(g.color ? { color: g.color } : {}),
    source: 'google',
  };
}

/** 팝업이 돌려준 부분 수정 → 구글에 보낼 온전한 값. */
export function draftFrom(g: GoogleEvent, patch: Partial<CalendarEventInput>, fields?: GoogleFieldsChange): GoogleEventDraft {
  const base: GoogleEventDraft = {
    title: g.title,
    allDay: g.allDay,
    startDate: g.startDate,
    endDate: g.endDate,
    ...(g.startTime ? { startTime: g.startTime } : {}),
    ...(g.endTime ? { endTime: g.endTime } : {}),
    location: g.location ?? '',
    description: g.description ?? '',
    // 바꾸지 않은 구글 전용 필드도 **그대로 실어** 보낸다 — PATCH에서 빠지면
    // 참석자·알림이 조용히 지워진다(위치·메모와 같은 이유).
    attendees: g.attendees ?? [],
    rooms: g.rooms ?? [],
    visibility: g.visibility ?? 'default',
    transparency: g.transparency ?? 'opaque',
    ...(g.reminderMinutes !== undefined ? { reminderMinutes: g.reminderMinutes } : {}),
  };
  const next: GoogleEventDraft = {
    ...base,
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.allDay !== undefined ? { allDay: patch.allDay } : {}),
    ...(patch.startDate !== undefined ? { startDate: patch.startDate } : {}),
    ...(patch.endDate !== undefined ? { endDate: patch.endDate } : {}),
    ...(patch.location !== undefined ? { location: patch.location } : {}),
    ...(patch.note !== undefined ? { description: patch.note } : {}),
  };
  // 시각은 `undefined`로 **지우는 것도 뜻이 있다**(종일로 바꾸기) — 키가 왔으면 그대로 쓴다.
  if ('startTime' in patch) {
    if (patch.startTime) next.startTime = patch.startTime;
    else delete next.startTime;
  }
  if ('endTime' in patch) {
    if (patch.endTime) next.endTime = patch.endTime;
    else delete next.endTime;
  }
  // 종일로 바뀌면 시각은 뜻을 잃는다(구글도 `date`만 받는다).
  if (next.allDay) {
    delete next.startTime;
    delete next.endTime;
  }
  if (fields) {
    if (fields.attendees) next.attendees = fields.attendees;
    if (fields.rooms) next.rooms = fields.rooms;
    if (fields.visibility) next.visibility = fields.visibility;
    if (fields.transparency) next.transparency = fields.transparency;
    // 알림은 `undefined`(캘린더 기본)도 뜻이 있으므로 **키가 왔는지**로 판단한다.
    if ('reminderMinutes' in fields) {
      if (fields.reminderMinutes === undefined) delete next.reminderMinutes;
      else next.reminderMinutes = fields.reminderMinutes;
    }
  }
  return next;
}

/**
 * 팝업이 돌려준 부분 수정 → 구글에 보낼 **부분 PATCH**.
 *
 * 실은 것이 곧 바꿀 것이다(제보): 제목만 고치면 `summary` 하나만 간다. 예전에는
 * 무엇을 고쳤든 전체 본문을 보내서, 구글이 그 일정의 시각을 거절하면 제목 수정까지
 * 통째로 막혔고(400 `Invalid start time.`), 그 사이 날짜가 바뀌어 있으면 412로도
 * 막혔다 — 둘 다 사용자가 손대지 않은 필드 때문이었다.
 *
 * 날짜·시각은 **짝**으로만 다룬다: 종일/날짜/시각 중 하나라도 바뀌면 `start`+`end`를
 * 함께 보낸다(구글은 종류가 섞이면 거절한다). 참석자·회의실도 한 배열이라 짝이다.
 */
export function patchFrom(g: GoogleEvent, patch: Partial<CalendarEventInput>, fields?: GoogleFieldsChange): GoogleEventPatch {
  const merged = draftFrom(g, patch, fields);
  const body: Record<string, unknown> = {};
  const touched: GoogleWriteField[] = [];
  const mark = (f: GoogleWriteField): void => {
    if (!touched.includes(f)) touched.push(f);
  };
  if (patch.title !== undefined) {
    body.summary = merged.title;
    mark('title');
  }
  // 언제인가 — 이 다섯 중 하나라도 왔으면 합친 값으로 짝을 보낸다.
  if (['allDay', 'startDate', 'endDate', 'startTime', 'endTime'].some((k) => k in patch)) {
    Object.assign(body, whenBody(merged));
    mark('when');
  }
  // 빈 값도 **보낸다** — 키를 빼면 구글은 "안 바꾼다"로 읽어서 지운 것이 저장되지 않는다.
  if (patch.location !== undefined) {
    body.location = merged.location ?? '';
    mark('location');
  }
  if (patch.note !== undefined) {
    body.description = merged.description ?? '';
    mark('description');
  }
  if (fields?.attendees || fields?.rooms) {
    body.attendees = attendeesBody(merged);
    mark('attendees');
  }
  if (fields?.visibility) {
    body.visibility = merged.visibility ?? 'default';
    mark('visibility');
  }
  if (fields?.transparency) {
    body.transparency = merged.transparency ?? 'opaque';
    mark('transparency');
  }
  if (fields && 'reminderMinutes' in fields) {
    body.reminders = remindersBody(merged.reminderMinutes);
    mark('reminders');
  }
  return { body, touched };
}

/** 구글 일정 → 필드 묶음이 읽는 값. 반복·Meet는 상세에서 고치지 않는다(구글에서). */
export function fieldsOf(g: GoogleEvent): GoogleFieldsValue {
  return {
    attendees: g.attendees ?? [],
    rooms: g.rooms ?? [],
    visibility: g.visibility ?? 'default',
    transparency: g.transparency ?? 'opaque',
    reminderMinutes: g.reminderMinutes,
    recurrence: RECURRENCE_OFF,
    addMeet: false,
  };
}

export function GoogleEventDetail({
  event,
  isMobile,
  onClose,
  onPatch,
  onDelete,
  directory,
}: {
  event: GoogleEvent;
  isMobile: boolean;
  onClose: () => void;
  /** 쓸 수 없는 캘린더(공휴일·보기 전용 공유)면 넘기지 않는다 — 그때는 읽기 전용. */
  onPatch?: (patch: GoogleEventPatch) => Promise<string | null>;
  onDelete?: () => Promise<string | null>;
  directory?: GoogleDirectoryApi;
}) {
  // 구글 전용 필드의 초안 — 본문 초안(제목·날짜·시각…)은 `EventDetail`이 든다.
  // **저장은 완료 버튼에서 한 번**(요청): 팝업이 모아 준 본문 diff와 이 필드 초안을
  // `patchFrom`이 **바뀐 것만** 담은 PATCH 하나로 합친다.
  const [pendingFields, setPendingFields] = useState<GoogleFieldsChange>({});
  const writable = !!onPatch && !!onDelete;

  // "저장할 캘린더"(#11) — 구글 일정이니 소속 캘린더가 켜지고 Geurio는 비활성이다
  // (Geurio 일정은 반대 — `geurioCalendarChips`). 일정을 옮기는 기능이 아니라 표식이다.
  const chips: CalendarChip[] = [
    { key: 'geurio', name: 'Geurio 캘린더', color: 'var(--mf-accent)', on: false },
    { key: event.calendarId, name: event.calendarName, color: event.color ?? 'var(--mf-info)', on: true },
  ];

  return (
    <EventDetail
      event={googleAsEvent(event)}
      isMobile={isMobile}
      onClose={onClose}
      cardAttrs={{ 'data-google-detail': '1' }}
      readOnly={!writable}
      // 머리에는 **`Google`**만(제보 #22) — 기본 캘린더의 이름은 계정 이메일이라
      // 제목 자리에 주소가 박힌다. 어느 캘린더인지는 아래 "저장할 캘린더" 줄이 말한다.
      badge="Google"
      calendarChips={chips}
      // 알림은 왼쪽 열의 늘 보이는 자리에서 고친다(요청 #5) — 값은 구글 전용 초안에 담긴다.
      {...(writable
        ? {
            reminder: {
              value: 'reminderMinutes' in pendingFields ? pendingFields.reminderMinutes : event.reminderMinutes,
              onChange: (m: number | null | undefined) => setPendingFields((p) => ({ ...p, reminderMinutes: m })),
            },
          }
        : {})}
      footerHint={writable ? 'Google 캘린더에 저장돼요' : 'Google 캘린더에서 가져온 일정이에요'}
      notice={
        event.holiday
          ? '공휴일 캘린더의 일정이라 고칠 수 없어요.'
          : '이 캘린더에 쓸 권한이 없어요. 구글에서 열어 확인해 주세요.'
      }
      extraDirty={Object.keys(pendingFields).length > 0}
      onPatch={async (patch) => {
        if (!onPatch) return null;
        return onPatch(patchFrom(event, patch, pendingFields));
      }}
      onDelete={async () => (onDelete ? onDelete() : null)}
      // 구글 전용 필드는 **오른쪽 열**이다(제보 #16 — 새 일정 팝업과 같은 구조).
      // 쓸 수 있는 일정에서만 — 읽기 전용이면 열 자체가 없고 카드도 560px로 남는다.
      {...(writable
        ? {
            side: (
              <GoogleEventFields
                value={{ ...fieldsOf(event), ...pendingFields }}
                mode="edit"
                recurring={!!event.recurringEventId}
                {...(directory ? { directory } : {})}
                {...(event.meetLink ? { meetLink: event.meetLink } : {})}
                onChange={(patch) => setPendingFields((p) => ({ ...p, ...patch }))}
              />
            ),
          }
        : {})}
      footerLeft={
        /* `Google에서 열기` — 발치의 취소 왼쪽(요청). 취소와 같은 높이로 서서
           한 줄로 읽힌다. */
        event.htmlLink ? (
          <a
            href={event.htmlLink}
            target="_blank"
            rel="noopener noreferrer"
            data-google-open
            className="mf-ctl"
            style={{ flex: '0 0 auto', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 6, height: isMobile ? 44 : 36, padding: '0 14px', borderRadius: 999, border: '1px solid var(--mf-border)', background: 'var(--mf-card)', color: 'var(--mf-subtext)', fontSize: 12.5, fontWeight: 700, textDecoration: 'none' }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M14 4h6v6M20 4 11 13M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
            </svg>
            Google에서 열기
          </a>
        ) : null
      }
    />
  );
}

/**
 * 열려 있는 구글 일정 상세를 그린다 — 일정 화면과 대시보드 위젯이 **같은 것**을 쓴다.
 * (PR5에서 위젯은 상세를 열기만 하고 그리지 않아, 위젯의 구글 칩을 눌러도 아무 일이
 * 없었다. 배선을 한곳에 두면 그런 반쪽이 다시 생기지 않는다.)
 */
export function GoogleDetailHost({
  openId,
  events,
  isMobile,
  onClose,
  onPatch,
  onDelete,
  directory,
}: {
  openId: string | null;
  events: readonly GoogleEvent[];
  isMobile: boolean;
  onClose: () => void;
  onPatch: (ev: GoogleEvent, patch: GoogleEventPatch) => Promise<string | null>;
  onDelete: (ev: GoogleEvent) => Promise<string | null>;
  directory?: GoogleDirectoryApi;
}) {
  const g = openId ? events.find((e) => e.id === openId) : null;
  if (!g) return null;
  return (
    <GoogleEventDetail
      event={g}
      isMobile={isMobile}
      onClose={onClose}
      {...(directory ? { directory } : {})}
      {...(g.writable
        ? {
            onPatch: (patch: GoogleEventPatch) => onPatch(g, patch),
            onDelete: async () => {
              const err = await onDelete(g);
              if (!err) onClose();
              return err;
            },
          }
        : {})}
    />
  );
}

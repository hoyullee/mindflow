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
import { EventDetail } from './EventDetail';
import type { CalendarEvent, CalendarEventInput } from '../../../adapters/ports';
import type { GoogleEvent, GoogleEventDraft } from './googleCalendar';

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
export function draftFrom(g: GoogleEvent, patch: Partial<CalendarEventInput>): GoogleEventDraft {
  const base: GoogleEventDraft = {
    title: g.title,
    allDay: g.allDay,
    startDate: g.startDate,
    endDate: g.endDate,
    ...(g.startTime ? { startTime: g.startTime } : {}),
    ...(g.endTime ? { endTime: g.endTime } : {}),
    location: g.location ?? '',
    description: g.description ?? '',
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
  return next;
}

export function GoogleEventDetail({
  event,
  isMobile,
  onClose,
  onPatch,
  onDelete,
}: {
  event: GoogleEvent;
  isMobile: boolean;
  onClose: () => void;
  /** 쓸 수 없는 캘린더(공휴일·보기 전용 공유)면 넘기지 않는다 — 그때는 읽기 전용. */
  onPatch?: (draft: GoogleEventDraft) => Promise<string | null>;
  onDelete?: () => Promise<string | null>;
}) {
  const [pending, setPending] = useState<Partial<CalendarEventInput>>({});
  const writable = !!onPatch && !!onDelete;
  // 저장이 끝나면 훅이 달을 다시 받지만 그 왕복이 끝나기 전까지는 방금 고친 값을
  // 보여 준다 — 아니면 눌렀는데 아무 일도 없는 것처럼 보인다.
  const shown = { ...googleAsEvent(event), ...pending };

  return (
    <EventDetail
      event={shown}
      isMobile={isMobile}
      onClose={onClose}
      cardAttrs={{ 'data-google-detail': '1' }}
      readOnly={!writable}
      badge={`${event.calendarName} · Google`}
      footerHint={writable ? 'Google 캘린더에 저장돼요 · 변경한 내용은 자동으로 저장돼요' : 'Google 캘린더에서 가져온 일정이에요'}
      notice={
        event.holiday
          ? '공휴일 캘린더의 일정이라 고칠 수 없어요.'
          : '이 캘린더에 쓸 권한이 없어요. 구글에서 열어 확인해 주세요.'
      }
      onPatch={async (patch) => {
        if (!onPatch) return null;
        setPending((p) => ({ ...p, ...patch }));
        const err = await onPatch(draftFrom(event, { ...pending, ...patch }));
        if (err) setPending({});
        return err;
      }}
      onDelete={async () => (onDelete ? onDelete() : null)}
      extra={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {event.recurringEventId && (
            <span data-google-recurring style={{ flex: '1 1 220px', minWidth: 0, fontSize: 11.5, color: 'var(--mf-faint2)', lineHeight: 1.6 }}>
              반복 일정이에요 — 여기서 고치면 <b style={{ fontWeight: 700 }}>이 회차만</b> 바뀝니다. 반복 규칙 자체는 구글에서 바꿔 주세요.
            </span>
          )}
          {event.htmlLink && (
            <a
              href={event.htmlLink}
              target="_blank"
              rel="noopener noreferrer"
              data-google-open
              className="mf-ctl"
              style={{ marginLeft: 'auto', flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 14px', borderRadius: 999, border: '1px solid var(--mf-border)', background: 'var(--mf-card)', color: 'var(--mf-subtext)', fontSize: 12.5, fontWeight: 700, textDecoration: 'none' }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M14 4h6v6M20 4 11 13M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
              </svg>
              Google에서 열기
            </a>
          )}
        </div>
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
}: {
  openId: string | null;
  events: readonly GoogleEvent[];
  isMobile: boolean;
  onClose: () => void;
  onPatch: (ev: GoogleEvent, draft: GoogleEventDraft) => Promise<string | null>;
  onDelete: (ev: GoogleEvent) => Promise<string | null>;
}) {
  const g = openId ? events.find((e) => e.id === openId) : null;
  if (!g) return null;
  return (
    <GoogleEventDetail
      event={g}
      isMobile={isMobile}
      onClose={onClose}
      {...(g.writable
        ? {
            onPatch: (draft: GoogleEventDraft) => onPatch(g, draft),
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

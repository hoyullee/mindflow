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

import { createContext, useMemo, useState } from 'react';
import type { CalendarEvent, CalendarEventInput } from '../../../adapters/ports';
import type { CalendarEntry } from '../../home/calendar/entries';
import { EventDetail, geurioCalendarChips } from '../../home/calendar/EventDetail';
import { GoogleDetailHost } from '../../home/calendar/GoogleEventDetail';
import { NewEventModal } from '../../home/calendar/NewEventModal';
import { submitNewEvent } from '../../home/calendar/newEventSubmit';
import { geurioColorOptions } from '../../home/calendar/eventColor';
import { googleDirectoryOf, googleTargetsOf } from '../../home/calendar/googleWiring';
import { partsOf } from '../../home/calendar/model';
import { useNoteAgenda } from '../noteAgenda';
import { NoteCardPeek } from './NoteCardPeek';
import { Modal, MODAL_DIM } from '../../../components/Modal';
import type { Theme } from '../theme';

/** 지금 열려 있는 것 — 셋 중 하나이거나 아무것도 아니다. */
export type NoteEventOpen =
  /** 그리오 일정 상세. `occ`는 반복의 그 회차(삭제 범위의 기준). */
  | { kind: 'geurio'; id: string; occ?: string; at: string }
  /** 구글 일정 상세 — 쓸 수 있으면 고칠 수도 있다(그쪽 host가 가른다). */
  | { kind: 'google'; id: string; at: string }
  /** 새 일정 — 놓일 날. */
  | { kind: 'new'; at: string }
  /**
   * 칸반 카드의 마감 — **읽기 전용 미니 카드**(제보 1, 사용자 결정).
   * 그 카드를 고치는 길은 보드뿐이라 값을 통째로 들고 간다(다시 찾지 않는다).
   */
  | { kind: 'card'; entry: CalendarEntry; at: string };

/**
 * 달력 줄 하나를 **공책에서 열 것**으로 옮긴다 — 칩 팝오버와 우측 「일정」 탭이 함께 쓴다.
 *
 * 두 자리에 같은 판단이 있으면 한쪽만 고쳐진다(실제로 우측 탭은 이 팝업이 생기기 전에
 * 만들어져 **일정 화면으로 건너뛰고 있었다** — 제보 1). 규칙은 하나다:
 * 구글이면 구글 상세, 그리오 일정이면 그리오 상세(반복은 `id#회차`를 갈라 넘긴다),
 * 그 밖(칸반 카드의 마감)은 읽기 전용 미니 카드.
 */
export function noteEventOpenOf(e: CalendarEntry, at: string): NoteEventOpen {
  if (e.google) return { kind: 'google', id: e.cardId, at };
  if (e.event) {
    const [id, occ] = e.cardId.split('#');
    return { kind: 'geurio', id: id ?? e.cardId, ...(occ ? { occ } : {}), at };
  }
  return { kind: 'card', entry: e, at };
}

/**
 * 공책 안에서 **일정 팝업을 여는 함수** — 편집기 맨 위(`NoteEditor`)가 쥔 상태를 블록 깊은 곳까지
 * 내려 준다. 일정 블록(`NoteSchedBlock`)이 그 소비자다(제보: 블록의 일정을 누르면 일정 화면으로
 * 건너가 버렸다 — 칩 팝오버와 우측 「일정」 탭은 이미 공책 안에서 열고 있었다).
 *
 * 블록마다 prop으로 내려 보내지 않은 이유: 일정 블록은 블록 부품의 여러 층 아래에 있고, 그
 * 사이의 부품들은 이 값을 쓰지 않는다. 공급자가 없으면(`null` — 편집기 밖의 미리보기 등)
 * 소비자는 예전처럼 일정 화면으로 보낸다.
 */
export const NoteEventOpenerContext = createContext<((open: NoteEventOpen) => void) | null>(null);

/**
 * **일정을 받아 오는 동안의 판**(요청: 일정 칩·일정 블록의 일정을 누르면 팝업이 뜨기까지 틈이
 * 있다 — 그 사이에 로딩 애니메이션을).
 *
 * 틈의 정체: 이 팝업은 **열릴 때 비로소** 그 달의 일정(그리오·구글·칸반)을 받는다(파일 머리의
 * 「조회는 팝업이 열렸을 때만」). 받기 전에는 고른 일정을 목록에서 찾지 못해 아무것도 그리지
 * 않았다 — 누른 것이 먹었는지 알 수 없는 시간이었다. 상세 팝업과 **같은 막·같은 z**에 스피너
 * 카드만 띄운다: 도착하면 그 자리에 상세가 선다. 막·Esc로 닫으면 여는 것 자체를 그만둔다.
 */
function EventLoading({ isMobile, onClose }: { isMobile: boolean; onClose: () => void }) {
  return (
    <Modal
      open
      onClose={onClose}
      label="일정 불러오는 중"
      dim={{ ...MODAL_DIM, animation: 'mf-dim-in .18s ease-out', zIndex: 321, alignItems: isMobile ? 'flex-end' : 'center', padding: isMobile ? 0 : 32 }}
      card={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '14px 18px',
        borderRadius: 14,
        background: 'var(--mf-card)',
        border: '1px solid var(--mf-border)',
        boxShadow: 'var(--mf-card-shadow)',
        color: 'var(--mf-subtext)',
        fontSize: 13,
        fontWeight: 600,
        animation: 'mf-fade .2s ease',
        ...(isMobile ? { marginBottom: 'calc(24px + env(safe-area-inset-bottom))' } : {}),
      }}
      cardAttrs={{ 'data-note-event-loading': '1' }}
    >
      <span
        aria-hidden="true"
        style={{ width: 18, height: 18, flexShrink: 0, boxSizing: 'border-box', border: '2px solid var(--mf-border)', borderTopColor: 'var(--mf-accent)', borderRadius: '50%', animation: 'mf-spin .7s linear infinite' }}
      />
      <span role="status">일정을 불러오는 중…</span>
    </Modal>
  );
}

export function NoteEventPopups({ open, isMobile, theme, onClose }: { open: NoteEventOpen | null; isMobile: boolean; theme: Theme; onClose: () => void }) {
  const at = open ? partsOf(open.at) : null;
  const agenda = useNoteAgenda(at?.y ?? 2026, at?.m ?? 1, !!open);
  const { events, google } = agenda;
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const targets = useMemo(() => googleTargetsOf(google), [google]);
  const directory = useMemo(() => googleDirectoryOf(google), [google]);

  if (!open) return null;

  /**
   * 칸반 카드는 **읽기 전용**이다 — 고치는 길은 그 보드뿐이라 단추가 그리로 보낸다.
   * 조회도 필요 없다: 팝오버가 이미 들고 있던 항목을 그대로 받았다.
   */
  if (open.kind === 'card') {
    return (
      <NoteCardPeek
        entry={open.entry}
        iso={open.at}
        theme={theme}
        onClose={onClose}
        onOpenBoard={() => {
          const e = open.entry;
          onClose();
          window.location.assign(`/editor?map=${encodeURIComponent(e.docId)}&title=${encodeURIComponent(e.boardName)}&docId=${encodeURIComponent(e.docId)}`);
        }}
      />
    );
  }

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
    // 아직 그 달의 구글 일정이 오지 않았다 — 받는 동안 스피너(상세는 목록에서 찾아 그린다).
    if (agenda.loading && !google.events.some((e) => e.id === open.id)) return <EventLoading isMobile={isMobile} onClose={onClose} />;
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

  // 그리오 일정 — 목록이 **아직이면 스피너**(`EventLoading`), 다 받았는데도 없으면(지워졌다)
  // 조용히 아무것도 그리지 않는다(일정 화면의 상세와 같은 태도 — 없는 것을 억지로 세우지 않는다).
  const ev: CalendarEvent | undefined = events.events.find((e) => e.id === open.id);
  if (!ev) return agenda.loading ? <EventLoading isMobile={isMobile} onClose={onClose} /> : null;
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

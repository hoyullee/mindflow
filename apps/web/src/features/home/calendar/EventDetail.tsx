// Geurio 일정 상세 — 디자인 원본 `evOpen` 블록의 **`evIsSimple` 분기** 이식.
//
// **새 일정 팝업과 같은 얼굴이다**(요청 #10) — 제목 입력·라벨·필드·발치(취소/완료)의
// 꼴을 `NewEventModal`과 맞추고, 목적지 칩·빠른 길이 칩도 같은 것을 가져다 쓴다.
// 칸반 카드 상세(`CalendarDetail`)와는 다른 팝업이다: 고칠 것이 다르다(상태·담당·분류가
// 없고, 대신 종일 토글·시각·위치·메모가 있다).
//
// **저장할 캘린더**(요청 #11)는 이 일정이 어디 것인지 **보여 주기만** 한다 — 소속
// 캘린더만 켜진 칩이고 나머지는 비활성이다(일정을 캘린더 사이로 옮기는 기능은 없다 —
// 눌리는 척하는 칩이 더 나쁘다).
//
// **저장은 완료 버튼에서 한 번**이다: 필드들은 팝업 안의 초안(draft)만 고치고, `완료`가
// 바뀐 것만 모아 `onPatch` 한 번으로 보낸 뒤 닫는다. ✕·Escape·취소는 초안을 버린다 —
// 그래서 적는 중에 막 클릭으로 닫히면 입력을 잃으므로, 고칠 수 있는 팝업은 막 클릭으로
// 닫지 않는다(새 일정 팝업과 같은 규칙). 읽기 전용은 잃을 것이 없어 예전처럼 닫힌다.
//
// **반복 일정**은 규칙 요약을 한 줄로 알린다 — 고치면 전체 반복에 적용된다(회차별
// 예외는 담지 않는다 — 0034 주석). 다만 **삭제는 범위를 묻는다**: 이 일정만(EXDATE) /
// 이 일정과 이후 일정(UNTIL) / 모든 일정(행 삭제). 규칙 자체를 바꾸는 것은 범위 밖이다.
//
// **구글 일정도 이 팝업을 쓴다**(PR6 — `GoogleEventDetail`이 값만 옮겨 준다). 둘로
// 갈라 두면 한쪽에만 기능이 붙는다 — 그래서 원천마다 다른 것(머리 배지·발치 문구·
// 고칠 수 있는가·안내)만 프롭으로 받고 나머지는 한 코드다.

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Modal, MODAL_DIM, useCardMorph } from '../../../components/Modal';
import { DateButton, PillButton } from './DatePop';
import { SpanBar } from './SpanBar';
import { TimeButton } from './TimePop';
import { addDays, daysBetween, minutesOf, timeLabel, todayISO } from './model';
import { destChipStyle, destDotStyle, hhmm, QUICK_MINUTES } from './NewEventModal';
import { ReminderField } from './GoogleEventFields';
import { EventColorField, type EventColorOption } from './eventColor';
import { MapLink } from './fieldBits';
import { DeleteConfirm, DeletingNote } from './DeleteConfirm';
import type { CalendarEvent, CalendarEventInput } from '../../../adapters/ports';
import { endRuleBefore, excludeOccurrence, parseRecurrence, recurrenceLabel } from './recurrence';

/** 팝업이 들고 고치는 초안 — 저장은 `완료`가 바뀐 것만 모아 한 번에 보낸다. */
interface Draft {
  title: string;
  allDay: boolean;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  location: string;
  note: string;
  /**
   * 지정한 색 — Geurio는 hex, 구글은 색 번호다(`EventColorOption.value`). 초기값은
   * **호스트가 준다**(`color.value`): 구글 일정의 `event.color`는 지정색이 없으면
   * 캘린더 색으로 채워져 오므로, 그걸 "고른 값"으로 읽으면 안 된다.
   */
  color: string | null;
}

function draftOf(e: CalendarEvent, color: string | null): Draft {
  return {
    title: e.title,
    allDay: e.allDay,
    startDate: e.startDate,
    endDate: e.endDate,
    startTime: e.startTime ?? '09:00',
    endTime: e.endTime ?? '10:00',
    location: e.location ?? '',
    note: e.note ?? '',
    color,
  };
}

/** "저장할 캘린더" 줄의 칩 하나 — 소속(on)만 켜지고 나머지는 비활성이다(#11). */
export interface CalendarChip {
  key: string;
  name: string;
  color: string;
  on: boolean;
}

/**
 * Geurio 일정의 "저장할 캘린더" 줄 — Geurio가 소속이고, 연결된 구글 캘린더들은
 * 비활성으로 보인다(예: 구글 일정을 열면 반대로 Geurio 칩이 비활성 —
 * `GoogleEventDetail`이 그 쌍을 만든다). 두 호스트(일정 화면·대시보드 위젯)가
 * 같은 줄을 그리도록 여기 한 곳에 둔다.
 */
export function geurioCalendarChips(googleTargets: readonly { id: string; name: string; color?: string }[]): CalendarChip[] {
  return [
    { key: 'geurio', name: 'Geurio 캘린더', color: 'var(--mf-accent)', on: true },
    ...googleTargets.map((c) => ({ key: c.id, name: c.name, color: c.color ?? 'var(--mf-info)', on: false })),
  ];
}

export function EventDetail({
  event,
  isMobile,
  onClose,
  onPatch,
  onDelete,
  readOnly = false,
  badge = 'Geurio 캘린더',
  footerHint = '',
  notice,
  footerLeft,
  side,
  extraDirty = false,
  occurrence,
  calendarChips,
  reminder,
  color,
  cardAttrs,
  onWhen,
}: {
  event: CalendarEvent;
  isMobile: boolean;
  onClose: () => void;
  onPatch: (patch: Partial<CalendarEventInput>) => Promise<string | null>;
  onDelete: () => Promise<string | null>;
  /** 고칠 수 없는 일정(공휴일·남이 보기 전용으로 공유한 캘린더) — 입력을 잠근다. */
  readOnly?: boolean;
  /** 머리의 원천 이름 — 어느 캘린더의 일정인지. */
  badge?: string;
  footerHint?: string;
  /** 읽기 전용일 때 대신 보여 줄 안내(왜 못 고치는가). */
  notice?: string;
  /** 원천이 더 얹는 것 — 본문 열 아래에 이어 붙는다(구글의 "Google에서 열기" 링크). */
  /** 발치의 **취소 왼쪽**에 붙는 원천 전용 버튼(구글의 `Google에서 열기`). */
  footerLeft?: ReactNode;
  /**
   * **오른쪽 열**(제보 #16) — 새 일정 팝업과 같은 구조: 왼쪽은 일정 자체, 오른쪽은
   * 원천이 처리해 주는 것들(구글 전용 필드). 있으면 카드가 900px로 넓어진다.
   * 좁은 화면은 열을 나눌 폭이 없어 본문 열에 이어 붙인다.
   */
  side?: ReactNode;
  /**
   * 초안의 **구간**이 바뀔 때 알린다 — 원천이 그 시간대로 무언가를 물어봐야 할 때
   * 쓴다(구글: 회의실이 그 시간에 비어 있는가). 팝업은 초안을 자기가 들고 있으므로,
   * 밖에서 그 값을 보려면 이 길뿐이다(저장된 값만 보면 시간을 고치는 동안 어긋난다).
   */
  onWhen?: (w: { allDay: boolean; startDate: string; endDate: string; startTime?: string; endTime?: string }) => void;
  /** 오른쪽 열 쪽에 저장할 변경이 있는가 — 이 팝업의 필드가 그대로여도 완료가 저장한다. */
  extraDirty?: boolean;
  /** 반복 일정에서 **어느 회차를 눌러 열었는가**(그 회차의 시작일) — 삭제 범위의 기준. */
  occurrence?: string;
  /** "저장할 캘린더" 줄 — 소속 칩만 켜지고 나머지는 비활성(#11). 없으면 줄을 그리지 않는다. */
  calendarChips?: CalendarChip[];
  /**
   * 알림 — **늘 보이는 자리**(요청 #5). 값을 주면 고칠 수 있고, 없으면 비활성 표식이
   * 뜬다(우리 표에는 알림을 띄울 장치가 없다 — `ReminderField` 주석).
   */
  reminder?: { value: number | null | undefined; onChange: (minutes: number | null | undefined) => void };
  /**
   * 일정 색(요청) — 원천이 자기 팔레트와 지금 값을 준다. 없으면 줄을 그리지 않는다
   * (고를 색이 없으면 죽은 칸이 된다). 고른 값은 팝업 초안에 담겨 `완료`가 함께
   * 저장한다 — 저장할 값의 뜻은 원천이 안다(구글은 `colorId`).
   */
  color?: { value: string | null; options: readonly EventColorOption[] };
  /** 원천을 가리키는 표식 — 두 팝업이 한 코드라도 화면에서는 구별돼야 한다. */
  cardAttrs?: Record<string, string>;
}) {
  const colorInit = color?.value ?? null;
  const [draft, setDraft] = useState(() => draftOf(event, colorInit));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 반복 일정 삭제 — 범위를 묻는 확인 팝업(요청). 회차를 모르는 반복은 물을 수 없다.
  const [scopeOpen, setScopeOpen] = useState(false);
  // 반복이 아닌 일정도 **한 번 묻는다**(요청) — 삭제는 되돌릴 수 없고(버전 기록에
  // 남지 않는다) 머리의 버튼 하나가 곧 실행이면 잘못 눌린다.
  const [confirmOpen, setConfirmOpen] = useState(false);
  /** 지우는 중 — 확인 팝업이 스피너를 띄우고 두 버튼을 잠근다(요청). */
  const [deleting, setDeleting] = useState(false);
  const canScope = !readOnly && !!event.recurrence && !!occurrence;
  /** 오른쪽 열로 갈라 놓을 수 있는가 — 좁은 화면은 폭이 없어 한 열에 이어 붙인다. */
  const twoCol = !!side && !isMobile;
  const today = todayISO();
  // 크기 애니메이션(요청) — 종일 토글 등으로 내용이 늘고 줄 때 카드가 이어진다.
  const morphRef = useCardMorph();

  const run = (fn: () => Promise<string | null>, closeAfter = false): void => {
    void (async () => {
      setSaving(true);
      const err = await fn();
      setSaving(false);
      setError(err);
      if (!err && closeAfter) onClose();
    })();
  };

  const set = (patch: Partial<Draft>): void => setDraft((d) => ({ ...d, ...patch }));

  /** 시작 날짜를 옮기면 **기간 길이를 지킨 채** 종료 날짜도 따라온다(시각과 같은 규칙). */
  const pickStartDate = (iso: string): void => {
    const keep = Math.max(0, daysBetween(draft.startDate, draft.endDate));
    set({ startDate: iso, endDate: addDays(iso, keep) });
  };

  /**
   * 시작 시각을 옮기면 **길이를 지킨 채** 종료 시각도 따라온다(달력 앱의 관례).
   * 그러지 않으면 늦은 시각을 고르는 순간 종료가 시작보다 앞서 저장이 막힌다.
   */
  const pickStart = (v: string): void => {
    const from = minutesOf(draft.startTime);
    const to = minutesOf(draft.endTime);
    const next = minutesOf(v);
    if (from === null || to === null || next === null) {
      set({ startTime: v });
      return;
    }
    const keep = Math.max(15, to - from);
    const end = Math.min(23 * 60 + 59, next + keep);
    set({ startTime: v, endTime: hhmm(end) });
  };

  const durMin = (() => {
    const a = minutesOf(draft.startTime);
    const b = minutesOf(draft.endTime);
    return a !== null && b !== null ? b - a : null;
  })();
  const invalidTime = !draft.allDay && durMin !== null && durMin <= 0;
  // 초안의 구간을 원천에 알린다(구글 회의실 확인) — 다섯 값이 바뀔 때만 부른다.
  const { allDay, startDate, endDate, startTime, endTime } = draft;
  useEffect(() => {
    onWhen?.({ allDay, startDate, endDate, ...(startTime ? { startTime } : {}), ...(endTime ? { endTime } : {}) });
  }, [onWhen, allDay, startDate, endDate, startTime, endTime]);

  /** 바뀐 것만 모은다 — 값이 그대로인 필드는 싣지 않는다(고치지 않은 것을 고쳤다고 말하지 않는다). */
  const buildPatch = (): Partial<CalendarEventInput> => {
    const p: Partial<CalendarEventInput> = {};
    const title = draft.title.trim();
    if (title && title !== event.title.trim()) p.title = title;
    if (draft.allDay !== event.allDay) p.allDay = draft.allDay;
    const endDate = draft.allDay ? (draft.endDate < draft.startDate ? draft.startDate : draft.endDate) : draft.startDate;
    if (draft.startDate !== event.startDate) p.startDate = draft.startDate;
    if (endDate !== event.endDate) p.endDate = endDate;
    if (draft.allDay) {
      // 종일로 바뀌면 시각은 뜻을 잃는다 — 키를 실어 **지운다**(빼면 "안 바꾼다"로 읽힌다).
      if (event.startTime) p.startTime = undefined;
      if (event.endTime) p.endTime = undefined;
    } else {
      if (draft.startTime !== event.startTime) p.startTime = draft.startTime;
      if (draft.endTime !== event.endTime) p.endTime = draft.endTime;
    }
    if (draft.location.trim() !== (event.location ?? '').trim()) p.location = draft.location.trim();
    if (draft.note.trim() !== (event.note ?? '').trim()) p.note = draft.note.trim();
    // 색은 **지운 것도 뜻이 있다** — 키를 실어 보낸다(빼면 "안 바꾼다"로 읽힌다).
    if (color && draft.color !== colorInit) p.color = draft.color ?? undefined;
    return p;
  };

  /** 완료 — 바뀐 게 없으면 그냥 닫고, 있으면 한 번에 저장한 뒤 닫는다(실패면 남아서 말한다). */
  const submit = (): void => {
    if (saving) return;
    if (readOnly) {
      onClose();
      return;
    }
    if (invalidTime) {
      setError('종료 시각이 시작보다 앞서요');
      return;
    }
    const patch = buildPatch();
    if (Object.keys(patch).length === 0 && !extraDirty) {
      onClose();
      return;
    }
    run(() => onPatch(patch), true);
  };

  /**
   * 삭제는 **끝날 때까지 확인 팝업이 남는다**(요청) — 그 자리에 스피너를 띄우고
   * 두 버튼을 잠근다. 실패하면 팝업을 닫고 발치 한 곳에서 사유를 말한다(오류 문구는
   * 한 자리라는 규칙). 성공하면 상세째 닫히므로 되돌릴 상태가 없다.
   */
  const runDelete = (fn: () => Promise<string | null>): void => {
    void (async () => {
      setDeleting(true);
      const err = await fn();
      setDeleting(false);
      if (err) {
        setConfirmOpen(false);
        setScopeOpen(false);
        setError(err);
        return;
      }
      onClose();
    })();
  };

  const removeAll = (): void => runDelete(() => onDelete());

  /**
   * 반복 일정의 범위 삭제 — 이 일정만은 그 회차를 규칙에서 빼고(EXDATE), 이후 일정은
   * 규칙의 끝을 그 회차 전날로 당긴다(UNTIL). 첫 회차부터 "이후"면 남는 게 없으므로
   * 행을 지운다. 초안과 무관한 **즉시 동작**이다(삭제는 미뤄 둘 일이 아니다).
   */
  const deleteScoped = (scope: 'one' | 'following' | 'all'): void => {
    // 팝업은 닫지 않는다 — 끝날 때까지 그 자리에서 진행을 보여 준다(요청).
    const rule = event.recurrence;
    if (scope === 'all' || !rule || !occurrence) {
      removeAll();
      return;
    }
    if (scope === 'following' && occurrence <= event.startDate) {
      removeAll();
      return;
    }
    const next = scope === 'one' ? excludeOccurrence(rule, occurrence) : endRuleBefore(rule, addDays(occurrence, -1));
    runDelete(() => onPatch({ recurrence: next }));
  };

  const spanDays = daysBetween(draft.startDate, draft.allDay ? (draft.endDate < draft.startDate ? draft.startDate : draft.endDate) : draft.startDate) + 1;
  const whenPill = draft.allDay ? (spanDays > 1 ? `${spanDays}일간` : '종일') : `${timeLabel(minutesOf(draft.startTime) ?? 0)} – ${timeLabel(minutesOf(draft.endTime) ?? 0)}`;

  const footMsg = error ?? (saving ? '저장 중…' : invalidTime ? '종료 시각이 시작보다 앞서요' : footerHint);
  const footTone = error || invalidTime ? 'var(--mf-danger)' : 'var(--mf-faint2)';

  return (
    <Modal
      open
      onClose={onClose}
      label="일정 상세"
      // 고칠 수 있는 팝업은 초안을 들고 있다 — 막 클릭 한 번에 버려지면 안 된다.
      dismissOnBackdrop={readOnly}
      // 막·등장 효과는 설정 팝업과 같은 것(요청) — 예전에는 배경이 그대로 보였다(제보).
      dim={{ ...MODAL_DIM, animation: 'mf-dim-in .18s ease-out', zIndex: 321, alignItems: isMobile ? 'flex-end' : 'center', padding: isMobile ? 0 : 32 }}
      cardRef={morphRef}
      card={{
        // 오른쪽 열이 붙으면 새 일정 팝업과 같은 900px(원본 `newEvW`) — 폭 전이도
        // `useCardMorph`가 잇는다(CSS transition을 걸면 RO가 옛 폭으로 높이를 잰다).
        width: isMobile ? '100%' : twoCol ? 900 : 560,
        maxWidth: '100%',
        maxHeight: isMobile ? '92dvh' : '100%',
        boxSizing: 'border-box',
        borderRadius: isMobile ? '22px 22px 0 0' : 22,
        background: 'var(--mf-card)',
        border: '1px solid var(--mf-border)',
        boxShadow: 'var(--mf-card-shadow)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        animation: 'mf-fade .2s ease',
      }}
      cardAttrs={{ 'data-event-detail': '1', ...cardAttrs }}
    >
      <>
        {/* 머리 — 새 일정 팝업과 같은 문법(점 + 이름 · 시각 알약 · 동작 · ✕). */}
        <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 10, padding: '16px 18px', borderBottom: '1px solid var(--mf-border-soft)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, flex: '0 0 auto', minWidth: 0 }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: event.color ?? 'var(--mf-accent)', display: 'block', flex: '0 0 auto' }} />
            <span data-event-badge style={{ fontSize: 13.5, fontWeight: 800, letterSpacing: '-.02em', color: 'var(--mf-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{badge}</span>
          </span>
          <span style={{ flex: 1, minWidth: 0 }} />
          <span data-event-when style={{ height: 24, padding: '0 10px', borderRadius: 999, background: 'var(--mf-panel2)', color: 'var(--mf-muted)', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap', flex: '0 0 auto' }}>
            {whenPill}
          </span>
          {!readOnly && (
            <button
              type="button"
              data-event-delete
              onClick={() => (canScope ? setScopeOpen(true) : setConfirmOpen(true))}
              className="mf-ctl"
              style={{ flex: '0 0 auto', whiteSpace: 'nowrap', height: 30, padding: '0 15px', borderRadius: 999, border: '1px solid var(--mf-border)', background: 'var(--mf-card)', color: 'var(--mf-muted)', font: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
            >
              삭제
            </button>
          )}
          <button type="button" aria-label="닫기" title="닫기" onClick={onClose} className="mf-ctl" style={{ width: 30, height: 30, flex: '0 0 auto', border: '1px solid var(--mf-border)', borderRadius: 999, background: 'var(--mf-card)', color: 'var(--mf-muted)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        {/* 본문 — 새 일정 팝업과 같은 구조다(제보 #16): 원천이 오른쪽 열을 주면 두 열로
            갈라지고, 각 열이 자기 스크롤을 갖는다. `overflow-anchor`를 끄는 이유:
            내용이 자라는 순간 브라우저 스크롤 앵커링이 scrollTop을 보정해 보이는
            내용이 위로 튄다(제보 — "컨텐츠가 잘려서 올라간 뒤 늘어난다"). */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'stretch', minWidth: 0 }}>
        <div className="lnb-scroll" data-event-main style={{ flex: '1 1 340px', minWidth: 0, boxSizing: 'border-box', overflowY: 'auto', overflowAnchor: 'none', padding: '20px 22px 24px', display: 'flex', flexDirection: 'column', gap: 19 }}>
          <input
            aria-label="일정 제목"
            data-event-title
            value={draft.title}
            readOnly={readOnly}
            onChange={(e) => set({ title: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
            placeholder="일정 제목"
            maxLength={200}
            style={{ width: '100%', boxSizing: 'border-box', height: 52, padding: '0 15px', borderRadius: 14, border: '1px solid var(--mf-border)', background: 'var(--mf-card)', font: 'inherit', fontSize: 18, fontWeight: 800, letterSpacing: '-.03em', color: 'var(--mf-text)', outline: 'none' }}
          />

          {/* 저장할 캘린더(#11) — 이 일정이 어디 것인지. 소속만 켜지고 나머지는 비활성
              (일정을 캘린더 사이로 옮기는 기능은 없다 — 눌리는 척하는 칩이 더 나쁘다). */}
          {calendarChips && calendarChips.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <Label>저장할 캘린더</Label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                {calendarChips.map((c) => (
                  <span key={c.key} data-event-cal={c.key} aria-disabled={!c.on} style={{ ...destChipStyle(c.on, c.color), cursor: 'default', ...(c.on ? {} : { opacity: 0.5 }) }}>
                    <span style={destDotStyle(c.color)} />
                    {c.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 반복 — 고치면 전체 반복에 적용된다는 사실을 숨기지 않는다(삭제는 범위를 묻는다). */}
          {event.recurrence ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <Label>반복</Label>
              <span data-event-repeat style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: 'var(--mf-faint2)', lineHeight: 1.6 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: '0 0 auto' }}>
                  <path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 4v4h-4M21 12a9 9 0 0 1-15 6.7L3 16M3 20v-4h4" />
                </svg>
                {repeatLine(event.recurrence, event.startDate)}
              </span>
            </div>
          ) : null}

          {readOnly ? (
            <span data-event-notice style={{ fontSize: 12.5, color: 'var(--mf-muted)', background: 'var(--mf-panel2)', border: '1px solid var(--mf-border)', borderRadius: 12, padding: '11px 13px', lineHeight: 1.65 }}>
              {notice ?? '이 일정은 여기서 고칠 수 없어요.'}
            </span>
          ) : null}
          {/* 읽기 전용(구글의 보기 전용 캘린더)에도 진행 바는 보여 준다 — **고칠 수
              없는 것**과 **알 수 없는 것**은 다르다. */}
          {readOnly && draft.allDay && spanDays > 1 && <SpanBar start={draft.startDate} due={draft.endDate} today={today} />}


          {readOnly ? null : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <Label>날짜와 시간</Label>
                  <span style={{ flex: 1, minWidth: 0 }} />
                  <PillButton on={draft.allDay} attrs={{ 'data-event-allday': '1' }} onClick={() => set({ allDay: !draft.allDay })}>
                    종일
                  </PillButton>
                </span>

                <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <span style={{ flex: '1 1 170px', minWidth: 150, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <SubLabel>{draft.allDay ? '시작 날짜' : '날짜'}</SubLabel>
                    <DateButton label={draft.allDay ? '시작 날짜' : '날짜'} value={draft.startDate} clearable={false} attrs={{ 'data-event-date': '1' }} onPick={(iso) => iso && pickStartDate(iso)} />
                  </span>
                  {draft.allDay && (
                    <span style={{ flex: '1 1 170px', minWidth: 150, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <SubLabel>종료 날짜</SubLabel>
                      <DateButton label="종료 날짜" value={draft.endDate < draft.startDate ? draft.startDate : draft.endDate} min={draft.startDate} clearable={false} attrs={{ 'data-event-enddate': '1' }} onPick={(iso) => iso && set({ endDate: iso })} />
                    </span>
                  )}
                  {!draft.allDay && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 7, flex: '1 1 100%', minWidth: 0 }}>
                      <TimeButton label="시작 시각" value={draft.startTime} attrs={{ 'data-event-start': '1' }} onPick={pickStart} />
                      <span style={{ flex: '0 0 auto', fontSize: 12, color: 'var(--mf-faint2)' }}>–</span>
                      <TimeButton label="종료 시각" value={draft.endTime} min={draft.startTime} attrs={{ 'data-event-end': '1' }} onPick={(v) => set({ endTime: v })} />
                    </span>
                  )}
                </div>

                {/* 빠른 길이 칩 — 새 일정 팝업의 그 줄(#10 파리티). */}
                {!draft.allDay && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {QUICK_MINUTES.map((m) => (
                      <button
                        key={m}
                        type="button"
                        data-event-quick={m}
                        onClick={() => {
                          const from = minutesOf(draft.startTime);
                          if (from === null) return;
                          set({ endTime: hhmm(Math.min(23 * 60 + 59, from + m)) });
                        }}
                        className="mf-ctl"
                        aria-pressed={durMin === m}
                        style={{ height: 24, padding: '0 10px', borderRadius: 999, border: `1px solid ${durMin === m ? 'var(--mf-accent-mute)' : 'var(--mf-border)'}`, background: durMin === m ? 'var(--mf-accent-soft)' : 'var(--mf-card)', color: durMin === m ? 'var(--mf-accent-strong)' : 'var(--mf-muted)', font: 'inherit', fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', flex: '0 0 auto' }}
                      >
                        {m >= 60 ? `${m / 60}시간` : `${m}분`}
                      </button>
                    ))}
                    <span style={{ flex: 1, minWidth: 0 }} />
                    <span data-event-dur style={{ fontSize: 11, color: durMin !== null && durMin > 0 ? 'var(--mf-muted)' : 'var(--mf-danger)', whiteSpace: 'nowrap', flex: '0 0 auto' }}>
                      {durMin === null || durMin <= 0 ? '종료 시각이 시작보다 앞서요' : durMin >= 60 ? `${Math.floor(durMin / 60)}시간${durMin % 60 ? ` ${durMin % 60}분` : ''}` : `${durMin}분`}
                    </span>
                  </span>
                )}

                {/* 기간 진행 바(제보 ⑦) — **날짜 아래**에, 칸반 카드 상세와 같은 바로
                    그린다(`N일 중 M일째` + 남은 날 + 하루 한 칸). 예전의 `3일간 · 1일
                    남음` 한 줄을 이 바가 대신한다(같은 말을 두 번 하지 않는다). */}
                {draft.allDay && spanDays > 1 && <SpanBar start={draft.startDate} due={draft.endDate} today={today} />}
              </div>

              <Field label="위치" trailing={<MapLink query={draft.location} />}>
                <input aria-label="위치" data-event-loc value={draft.location} placeholder="주소 또는 장소 이름" maxLength={200} onChange={(e) => set({ location: e.target.value })} style={fieldStyle(false)} />
              </Field>

              <Field label="메모">
                <textarea aria-label="메모" data-event-note value={draft.note} placeholder="자유롭게 적어 두세요" maxLength={2000} onChange={(e) => set({ note: e.target.value })} style={fieldStyle(true)} />
              </Field>

              {/* 일정 색(요청) — 원천이 팔레트를 준 경우만. 저장은 `완료`에서 한 번이다. */}
              {color && <EventColorField value={draft.color} options={color.options} onPick={(v) => set({ color: v })} />}

              {/* 알림 — 늘 보이는 자리(요청 #5). 원천이 값을 주지 않으면 비활성 표식. */}
              <ReminderField value={reminder?.value} onChange={(m) => reminder?.onChange(m)} disabled={!reminder} />
            </>
          )}

          {/* 좁은 화면 — 열을 나눌 폭이 없어 같은 열에 이어 붙인다. */}
          {side && isMobile && side}
        </div>

        {twoCol && (
          <div className="lnb-scroll" data-event-side style={{ flex: '1 1 260px', minWidth: 240, maxWidth: 380, boxSizing: 'border-box', overflowY: 'auto', overflowAnchor: 'none', borderLeft: '1px solid var(--mf-border-soft)', background: 'var(--mf-cal-cmt)', padding: '18px 16px 22px' }}>
            {/* 새 일정 팝업과 같은 흰 카드 — 왼쪽 열과 성격이 다름을 면으로 말한다. */}
            <div style={{ borderRadius: 16, border: '1px solid var(--mf-border-soft)', background: 'var(--mf-card)', padding: 15, boxSizing: 'border-box' }}>{side}</div>
          </div>
        )}
        </div>

        {/* 발치 — 새 일정 팝업과 같은 [상황 문구][취소][완료] 배치. 오류도 **여기 한
            곳**에서만 말한다(제보: 본문 끝과 발치에 같은 문장이 두 번 떴다). */}
        <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px', borderTop: '1px solid var(--mf-border-soft)' }}>
          <span data-event-foot style={{ flex: 1, minWidth: 0, fontSize: 12, color: footTone, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{footMsg}</span>
          {/* 원천 전용 버튼 — 취소 **왼쪽**(요청). 본문 끝에 두면 스크롤을 내려야
              보인다: 이 일정을 어디서 여는지는 늘 같은 자리에 있어야 한다. */}
          {footerLeft}
          {!readOnly && (
            <button type="button" data-event-cancel onClick={onClose} className="mf-ctl" style={{ flex: '0 0 auto', whiteSpace: 'nowrap', height: isMobile ? 44 : 36, padding: '0 16px', borderRadius: 999, border: '1px solid var(--mf-border)', background: 'var(--mf-card)', color: 'var(--mf-muted)', font: 'inherit', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
              취소
            </button>
          )}
          <button type="button" data-event-done disabled={saving} onClick={submit} className="mf-ctl-primary" style={{ flex: '0 0 auto', whiteSpace: 'nowrap', height: isMobile ? 44 : 40, padding: isMobile ? '0 20px' : '0 26px', borderRadius: 999, border: 0, background: 'linear-gradient(180deg, var(--mf-accent), var(--mf-accent-strong))', color: 'var(--mf-accent-ink)', font: 'inherit', fontSize: 13.5, fontWeight: 800, cursor: 'pointer', boxShadow: '0 8px 18px -10px rgba(var(--mf-accent-rgb), .9)' }}>
            완료
          </button>
        </div>

        {/* 반복 일정 삭제 — 어디까지 지울지 먼저 묻는다(요청). 초점은 취소에 —
            파괴적 버튼이 기본 초점이면 Enter 한 번에 지워진다(열 삭제 확인창의 규칙). */}
        {scopeOpen && (
          <Modal open onClose={() => setScopeOpen(false)} label="반복 일정 삭제" dismissOnBackdrop={false} initialFocusSelector="[data-event-scope-cancel]" dim={{ ...MODAL_DIM, animation: 'mf-dim-in .18s ease-out', zIndex: 340 }} card={{ width: 340, maxWidth: 'calc(100vw - 32px)', boxSizing: 'border-box', borderRadius: 18, background: 'var(--mf-card)', border: '1px solid var(--mf-border)', boxShadow: 'var(--mf-card-shadow)', padding: '20px 20px 16px', animation: 'mf-fade .2s ease' }} cardAttrs={{ 'data-event-scope': '1' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: '-.02em', color: 'var(--mf-text)' }}>반복 일정 삭제</span>
              <span style={{ fontSize: 12.5, color: 'var(--mf-muted)', lineHeight: 1.6 }}>반복되는 일정이에요. 어디까지 삭제할까요?</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 10 }}>
                <ScopeButton attrs={{ 'data-event-scope-one': '1' }} disabled={deleting} onClick={() => deleteScoped('one')} title="이 일정만" sub="다른 회차는 그대로 남아요" />
                <ScopeButton attrs={{ 'data-event-scope-following': '1' }} disabled={deleting} onClick={() => deleteScoped('following')} title="이 일정과 이후 일정" sub="이 회차부터의 반복이 끝나요" />
                <ScopeButton attrs={{ 'data-event-scope-all': '1' }} disabled={deleting} onClick={() => deleteScoped('all')} title="모든 일정" sub="반복 전체가 사라져요" danger />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
                {deleting && <DeletingNote />}
                <button type="button" data-event-scope-cancel disabled={deleting} onClick={() => setScopeOpen(false)} className="mf-ctl" style={{ height: isMobile ? 44 : 34, padding: '0 16px', borderRadius: 999, border: '1px solid var(--mf-border)', background: 'var(--mf-card)', color: 'var(--mf-muted)', font: 'inherit', fontSize: 12.5, fontWeight: 700, cursor: deleting ? 'default' : 'pointer', opacity: deleting ? 0.6 : 1 }}>
                  취소
                </button>
              </div>
            </div>
          </Modal>
        )}

        {/* 반복이 아닌 일정의 삭제 확인(요청) — 칸반 카드 상세와 같은 팝업을 쓴다. */}
        {confirmOpen && (
          <DeleteConfirm
            title="일정을 삭제할까요?"
            body={`${draft.title.trim() ? `'${draft.title.trim()}' 일정이 사라져요.` : '이 일정이 사라져요.'} 되돌릴 수 없어요.`}
            isMobile={isMobile}
            deleting={deleting}
            onCancel={() => setConfirmOpen(false)}
            onConfirm={removeAll}
          />
        )}
      </>
    </Modal>
  );
}


/** 범위 삭제의 한 갈래 — 제목 + 무엇이 남는지 한 줄. */
function ScopeButton({ title, sub, danger, attrs, disabled, onClick }: { title: string; sub: string; danger?: boolean; attrs: Record<string, string>; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" {...attrs} disabled={disabled} onClick={onClick} className="mf-ctl" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, width: '100%', boxSizing: 'border-box', padding: '10px 13px', borderRadius: 12, border: '1px solid var(--mf-border)', background: 'var(--mf-card)', font: 'inherit', textAlign: 'left', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1 }}>
      <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: '-.015em', color: danger ? 'var(--mf-danger)' : 'var(--mf-text)' }}>{title}</span>
      <span style={{ fontSize: 11.5, color: 'var(--mf-faint2)' }}>{sub}</span>
    </button>
  );
}

/** 새 일정 팝업의 그 필드 꼴(#10 파리티) — 값이 있는 입력·메모. */
function fieldStyle(multiline: boolean) {
  return {
    width: '100%',
    boxSizing: 'border-box' as const,
    height: multiline ? 110 : 40,
    padding: multiline ? '11px 12px' : '0 12px',
    borderRadius: 12,
    border: '1px solid var(--mf-border)',
    background: 'var(--mf-card)',
    font: 'inherit',
    fontSize: 13,
    lineHeight: multiline ? 1.6 : undefined,
    color: 'var(--mf-text)',
    outline: 'none',
    resize: multiline ? ('vertical' as const) : undefined,
  };
}

/** 새 일정 팝업과 같은 라벨 꼴(11.5/800). */
function Label({ children }: { children: ReactNode }) {
  return <span style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--mf-subtext)' }}>{children}</span>;
}

function SubLabel({ children }: { children: ReactNode }) {
  return <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--mf-faint2)' }}>{children}</span>;
}

function Field({ label, children, trailing }: { label: string; children: ReactNode; trailing?: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      {/* 라벨 오른쪽에 그 필드에 딸린 것 하나(위치의 `지도에서 보기`) — 없으면 라벨만. */}
      {trailing ? (
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <Label>{label}</Label>
          <span style={{ flex: 1 }} />
          {trailing}
        </span>
      ) : (
        <Label>{label}</Label>
      )}
      {children}
    </div>
  );
}

/** `2주마다 반복 · 종료 없음 — 고치면 전체 반복에 적용돼요`. */
function repeatLine(rule: string, baseDate: string): string {
  const spec = parseRecurrence(rule);
  return `${spec ? recurrenceLabel(spec, baseDate) : '반복 일정'} — 고치면 전체 반복에 적용돼요`;
}

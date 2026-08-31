// Geurio 일정 상세 — 디자인 원본 `evOpen` 블록의 **`evIsSimple` 분기** 이식.
//
// 칸반 카드 상세(`CalendarDetail`)와 다른 팝업이다: 고칠 것이 다르다(상태·담당·분류가
// 없고, 대신 종일 토글·시각·위치·메모가 있다). 우리 표(0033)가 정본이라 여기서 고치면
// 곧바로 저장된다.
//
// 원본에 있지만 두지 않은 것: 알림 · 참석자·Meet(구글 일정에서 쓴다).
//
// **반복 일정**은 규칙 요약을 한 줄로 알린다 — 한 행이 곧 하나의 반복이라 고치면 전체에
// 적용된다(회차별 예외는 담지 않는다 — 0034 주석). 규칙 자체를 바꾸는 것은 범위 밖이다.
//
// **구글 일정도 이 팝업을 쓴다**(PR6 — `GoogleEventDetail`이 값만 옮겨 준다). 둘로
// 갈라 두면 한쪽에만 기능이 붙는다 — 그래서 원천마다 다른 것(머리 배지·발치 문구·
// 고칠 수 있는가·안내)만 프롭으로 받고 나머지는 한 코드다.

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Modal, MODAL_DIM } from '../../../components/Modal';
import { DateButton, PillButton } from './DatePop';
import { TimeButton } from './TimePop';
import { addDays, daysBetween, minutesOf, timeLabel, todayISO } from './model';
import type { CalendarEvent, CalendarEventInput } from '../../../adapters/ports';
import { parseRecurrence, recurrenceLabel } from './recurrence';

export function EventDetail({
  event,
  isMobile,
  onClose,
  onPatch,
  onDelete,
  readOnly = false,
  badge = 'Geurio 캘린더',
  footerHint = 'Geurio 캘린더에만 저장되는 일정이에요 · 변경한 내용은 자동으로 저장돼요',
  notice,
  extra,
  cardAttrs,
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
  /** 원천이 더 얹는 것 — 구글은 반복 회차 안내와 "구글에서 열기" 링크를 넣는다. */
  extra?: ReactNode;
  /** 원천을 가리키는 표식 — 두 팝업이 한 코드라도 화면에서는 구별돼야 한다. */
  cardAttrs?: Record<string, string>;
}) {
  const [title, setTitle] = useState(event.title);
  const titleRef = useRef(title);
  titleRef.current = title;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = todayISO();

  const run = async (fn: () => Promise<string | null>): Promise<void> => {
    setSaving(true);
    const err = await fn();
    setSaving(false);
    setError(err);
  };

  const commitTitle = (): void => {
    const next = titleRef.current.trim();
    if (readOnly || !next || next === event.title.trim()) return;
    void run(() => onPatch({ title: next }));
  };

  const close = (): void => {
    commitTitle();
    onClose();
  };

  useEffect(() => setTitle(event.title), [event.title]);

  const spanDays = daysBetween(event.startDate, event.endDate) + 1;
  const whenPill = event.allDay ? (spanDays > 1 ? `${spanDays}일간` : '종일') : `${timeLabel(minutesOf(event.startTime) ?? 0)} – ${timeLabel(minutesOf(event.endTime) ?? 0)}`;

  return (
    <Modal
      open
      onClose={close}
      label="일정 상세"
      dismissOnBackdrop
      // 막·등장 효과는 설정 팝업과 같은 것(요청) — 예전에는 배경이 그대로 보였다(제보).
      dim={{ ...MODAL_DIM, animation: 'mf-dim-in .18s ease-out', zIndex: 321, alignItems: isMobile ? 'flex-end' : 'center', padding: isMobile ? 0 : 32 }}
      card={{
        width: isMobile ? '100%' : 560,
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
        <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 10, padding: '16px 18px', borderBottom: '1px solid var(--mf-border-soft)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, flex: '0 0 auto' }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: event.color ?? 'var(--mf-accent)', display: 'block' }} />
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
              onClick={() =>
                void run(async () => {
                  const err = await onDelete();
                  if (!err) onClose();
                  return err;
                })
              }
              className="mf-ctl"
              style={{ flex: '0 0 auto', whiteSpace: 'nowrap', height: 30, padding: '0 15px', borderRadius: 999, border: '1px solid var(--mf-border)', background: 'var(--mf-card)', color: 'var(--mf-muted)', font: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
            >
              삭제
            </button>
          )}
          <button type="button" aria-label="닫기" title="닫기" onClick={close} className="mf-ctl" style={{ width: 30, height: 30, flex: '0 0 auto', border: '1px solid var(--mf-border)', borderRadius: 999, background: 'var(--mf-card)', color: 'var(--mf-muted)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <div className="lnb-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 22px 24px', display: 'flex', flexDirection: 'column', gap: 19 }}>
          <textarea
            aria-label="일정 제목"
            data-event-title
            value={title}
            readOnly={readOnly}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                (e.target as HTMLTextAreaElement).blur();
              }
              if (e.key === 'Escape') setTitle(event.title);
            }}
            placeholder="일정 제목"
            style={{ width: '100%', boxSizing: 'border-box', minHeight: 80, resize: 'vertical', padding: '15px 16px', borderRadius: 14, border: '1px solid var(--mf-border)', background: 'var(--mf-card)', font: 'inherit', fontSize: 19, fontWeight: 800, letterSpacing: '-.03em', lineHeight: 1.45, color: 'var(--mf-text)', outline: 'none' }}
          />

          {/* 반복 일정 — 고치면 전체 반복에 적용된다는 사실을 숨기지 않는다. */}
          {event.recurrence ? (
            <span data-event-repeat style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: 'var(--mf-faint2)', lineHeight: 1.6 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: '0 0 auto' }}>
                <path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 4v4h-4M21 12a9 9 0 0 1-15 6.7L3 16M3 20v-4h4" />
              </svg>
              {repeatLine(event.recurrence, event.startDate)}
            </span>
          ) : null}

          {readOnly ? (
            <span data-event-notice style={{ fontSize: 12.5, color: 'var(--mf-muted)', background: 'var(--mf-panel2)', border: '1px solid var(--mf-border)', borderRadius: 12, padding: '11px 13px', lineHeight: 1.65 }}>
              {notice ?? '이 일정은 여기서 고칠 수 없어요.'}
            </span>
          ) : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <Label>날짜와 시간</Label>
                  <span style={{ flex: 1, minWidth: 0 }} />
                  <PillButton
                    on={event.allDay}
                    attrs={{ 'data-event-allday': '1' }}
                    onClick={() =>
                      void run(() =>
                        event.allDay
                          ? onPatch({ allDay: false, startTime: '09:00', endTime: '10:00', endDate: event.startDate })
                          : onPatch({ allDay: true, startTime: undefined, endTime: undefined }),
                      )
                    }
                  >
                    종일
                  </PillButton>
                </span>

                <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <span style={{ flex: '1 1 170px', minWidth: 150, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <SubLabel>{event.allDay ? '시작 날짜' : '날짜'}</SubLabel>
                    <DateButton label={event.allDay ? '시작 날짜' : '날짜'} value={event.startDate} clearable={false} attrs={{ 'data-event-date': '1' }} onPick={(iso) => iso && void run(() => onPatch({ startDate: iso, endDate: shiftedEndDate(event, iso) }))} />
                  </span>
                  {event.allDay && (
                    <span style={{ flex: '1 1 170px', minWidth: 150, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <SubLabel>종료 날짜</SubLabel>
                      <DateButton label="종료 날짜" value={event.endDate} min={event.startDate} clearable={false} attrs={{ 'data-event-enddate': '1' }} onPick={(iso) => iso && void run(() => onPatch({ endDate: iso }))} />
                    </span>
                  )}
                  {!event.allDay && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 7, flex: '1 1 100%', minWidth: 0 }}>
                      <TimeButton label="시작 시각" value={event.startTime ?? '09:00'} attrs={{ 'data-event-start': '1' }} onPick={(v) => void run(() => onPatch({ startTime: v, endTime: shiftedEnd(event, v) }))} />
                      <span style={{ flex: '0 0 auto', fontSize: 12, color: 'var(--mf-faint2)' }}>–</span>
                      <TimeButton label="종료 시각" value={event.endTime ?? '10:00'} min={event.startTime} attrs={{ 'data-event-end': '1' }} onPick={(v) => void run(() => onPatch({ endTime: v }))} />
                    </span>
                  )}
                </div>

                {event.allDay && spanDays > 1 && (
                  <span data-event-span style={{ fontSize: 11.5, color: 'var(--mf-faint2)' }}>
                    {spanDays}일간 · {today < event.startDate ? `${daysBetween(today, event.startDate)}일 뒤 시작` : today > event.endDate ? '종료' : `${daysBetween(today, event.endDate)}일 남음`}
                  </span>
                )}
              </div>

              <Field label="위치">
                <TextField value={event.location ?? ''} placeholder="주소 또는 장소 이름" label="위치" attrs={{ 'data-event-loc': '1' }} onCommit={(v) => void run(() => onPatch({ location: v }))} />
              </Field>

              <Field label="메모">
                <TextField multiline value={event.note ?? ''} placeholder="자유롭게 적어 두세요" label="메모" attrs={{ 'data-event-note': '1' }} onCommit={(v) => void run(() => onPatch({ note: v }))} />
              </Field>
            </>
          )}

          {extra}
          {error && <span data-event-error style={{ fontSize: 12, color: 'var(--mf-danger)' }}>{error}</span>}
        </div>

        <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px', borderTop: '1px solid var(--mf-border-soft)' }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--mf-faint2)' }}>{saving ? '저장 중…' : footerHint}</span>
          <button type="button" data-event-done onClick={close} className="mf-ctl" style={{ flex: '0 0 auto', whiteSpace: 'nowrap', height: isMobile ? 44 : 40, padding: isMobile ? '0 20px' : '0 26px', borderRadius: 999, border: 0, background: 'linear-gradient(180deg, var(--mf-accent), var(--mf-accent-strong))', color: 'var(--mf-accent-ink)', font: 'inherit', fontSize: 13.5, fontWeight: 800, cursor: 'pointer', boxShadow: '0 8px 18px -10px rgba(var(--mf-accent-rgb), .9)' }}>
            완료
          </button>
        </div>
      </>
    </Modal>
  );
}

/**
 * 시작 날짜를 옮겼을 때의 종료 날짜 — **기간 길이를 지킨 채** 따라온다. 클램프만
 * 두면 시작을 앞으로 당기는 순간 하루짜리 일정이 긴 기간 일정으로 바뀐다.
 */
function shiftedEndDate(event: CalendarEvent, nextStart: string): string {
  const keep = Math.max(0, daysBetween(event.startDate, event.endDate));
  return addDays(nextStart, keep);
}

/**
 * 시작 시각을 옮겼을 때의 종료 시각 — **길이를 지킨 채** 따라온다(달력 앱의 관례).
 * 그러지 않으면 늦은 시각을 고르는 순간 종료가 시작보다 앞서고, 그 값은 표의 제약을
 * 어기므로 정규화가 종일로 되돌려 버린다(시각이 통째로 사라진다).
 */
function shiftedEnd(event: CalendarEvent, nextStart: string): string {
  const from = minutesOf(event.startTime ?? '09:00');
  const to = minutesOf(event.endTime ?? '10:00');
  const next = minutesOf(nextStart);
  if (from === null || to === null || next === null) return event.endTime ?? '10:00';
  const keep = Math.max(15, to - from);
  const end = Math.min(23 * 60 + 59, next + keep);
  return `${`${Math.floor(end / 60)}`.padStart(2, '0')}:${`${end % 60}`.padStart(2, '0')}`;
}

/** 값이 있는 입력 — 타이핑마다 저장하지 않고 **blur·Enter에 한 번** 커밋한다. */
function TextField({ value, placeholder, label, multiline, attrs, onCommit }: { value: string; placeholder: string; label: string; multiline?: boolean; attrs?: Record<string, string>; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const style = {
    width: '100%',
    boxSizing: 'border-box' as const,
    height: multiline ? 78 : 40,
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
  const commit = (): void => {
    if (draft.trim() !== value.trim()) onCommit(draft.trim());
  };
  return multiline ? (
    <textarea aria-label={label} {...attrs} value={draft} placeholder={placeholder} maxLength={2000} onChange={(e) => setDraft(e.target.value)} onBlur={commit} style={style} />
  ) : (
    <input
      aria-label={label}
      {...attrs}
      value={draft}
      placeholder={placeholder}
      maxLength={200}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      style={style}
    />
  );
}

function Label({ children }: { children: ReactNode }) {
  return <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '-.01em', color: 'var(--mf-subtext)' }}>{children}</span>;
}

function SubLabel({ children }: { children: ReactNode }) {
  return <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--mf-faint2)' }}>{children}</span>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

/** `2주마다 반복 · 종료 없음 — 고치거나 삭제하면 전체 반복에 적용돼요`. */
function repeatLine(rule: string, baseDate: string): string {
  const spec = parseRecurrence(rule);
  return `${spec ? recurrenceLabel(spec, baseDate) : '반복 일정'} — 고치거나 삭제하면 전체 반복에 적용돼요`;
}

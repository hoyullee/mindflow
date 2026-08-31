// 새 일정 — 디자인 원본 `Geurio 일정 캘린더.dc.html`의 `newEvOpen` 블록 이식.
//
// 칸반 카드가 아닌 일정(회의·휴가·개인 약속)을 적는 자리다. 저장할 곳은 둘이다
// (PR6 — 원본의 `저장할 캘린더 [Geurio | Google]`): 우리 표(`calendar_events`, 0033)
// 또는 사용자의 **구글 캘린더**. 구글에 만들면 그 일정은 구글에만 남는다(사본을 두면
// 두 곳의 진실이 갈린다) — 발치 문구가 그 경계를 말한다.
//
// 구글에 **쓸 수 있는 캘린더가 없으면**(연동 안 함·보기 전용) 고르기를 그리지 않고
// 예전처럼 배지 하나만 둔다 — 고를 것이 하나뿐인 라디오는 UI가 아니라 장식이다.
//
// 목적지가 **구글이면** 원본의 `nIsGoogle` 블록(반복·Meet·참석자·공개 설정·참여 가능
// 여부·알림)이 함께 뜬다 — 구글이 실제로 처리해 주는 것들이다(`GoogleEventFields`).
// Geurio면 대신 원본의 `evCalNote` 문구로 그 사실을 알린다.
//
// 원본에 있지만 두지 않은 것: **회의실** — 목록이 조직 캘린더(Admin SDK)에서 와야
// 하는데 우리에겐 원천이 없다. 검색 결과가 영영 비는 상자를 두지 않는다.

import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Modal, MODAL_DIM } from '../../../components/Modal';
import { DateButton, PillButton } from './DatePop';
import { TimeButton } from './TimePop';
import { addDays, daysBetween, minutesOf, todayISO } from './model';
import { RadioCards } from '../../../components/Segmented';
import { GoogleEventFields, type GoogleDirectoryApi, type GoogleFieldsValue } from './GoogleEventFields';
import { RECURRENCE_OFF } from './googleCalendar';
import type { CalendarEventInput } from '../../../adapters/ports';

/** 어디에 저장할까 — `google`이면 그 캘린더 id가 함께 온다. */
export type NewEventTarget = { kind: 'geurio' } | { kind: 'google'; calendarId: string; fields: GoogleFieldsValue };

/** 목적지로 내놓을 구글 캘린더(쓸 수 있는 것만). */
export interface GoogleTarget {
  id: string;
  name: string;
  color?: string;
}

/** 회의 길이 빠른 선택(분) — 30분·1시간·2시간·3시간. */
const QUICK_MINUTES = [30, 60, 120, 180];

/** 자정부터의 분 → `HH:MM`. */
function hhmm(mins: number): string {
  return `${`${Math.floor(mins / 60)}`.padStart(2, '0')}:${`${mins % 60}`.padStart(2, '0')}`;
}

export interface NewEventDraft {
  /** 처음 놓일 날짜(달력에서 고른 날, 없으면 오늘). */
  date: string;
  allDay: boolean;
}

export function NewEventModal({
  draft,
  isMobile,
  saving,
  error,
  onClose,
  onSubmit,
  googleTargets = [],
  directory,
}: {
  draft: NewEventDraft;
  isMobile: boolean;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (input: CalendarEventInput, target: NewEventTarget) => void;
  /** 쓸 수 있는 구글 캘린더 — 비어 있으면 고르기를 그리지 않는다. */
  googleTargets?: GoogleTarget[];
  /** 선택 스코프로 열리는 것들(이름 검색·회의실) — 없으면 그만큼만 줄어든다. */
  directory?: GoogleDirectoryApi;
}) {
  const [title, setTitle] = useState('');
  const [allDay, setAllDay] = useState(draft.allDay);
  const [startDate, setStartDate] = useState(draft.date || todayISO());
  const [endDate, setEndDate] = useState(draft.date || todayISO());
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [location, setLocation] = useState('');
  const [note, setNote] = useState('');
  // 기본값은 **우리 표**다 — 남의 서비스에 쓰는 일은 사용자가 골라야 한다.
  const [dest, setDest] = useState<string>('geurio');
  // 구글 전용 필드 — 목적지를 Geurio로 되돌려도 값은 남는다(다시 고르면 그대로).
  const [gf, setGf] = useState<GoogleFieldsValue>({ attendees: [], rooms: [], visibility: 'default', transparency: 'opaque', reminderMinutes: undefined, recurrence: RECURRENCE_OFF, addMeet: false });
  // 고른 캘린더가 사라지면(연동 해제·권한 변경) 조용히 우리 표로 되돌린다.
  const destValid = dest === 'geurio' || googleTargets.some((t) => t.id === dest);
  const target: NewEventTarget = destValid && dest !== 'geurio' ? { kind: 'google', calendarId: dest, fields: gf } : { kind: 'geurio' };

  // 안전망 — 어떤 경로로든 종료일이 시작일보다 앞서지 않게(표의 제약과 같은 규칙).
  useEffect(() => {
    setEndDate((cur) => (cur < startDate ? startDate : cur));
  }, [startDate]);

  /**
   * 시작 날짜를 옮기면 **기간 길이를 지킨 채** 종료 날짜도 따라온다(시각과 같은 규칙).
   * 클램프만 두면 시작을 앞으로 당기는 순간 하루짜리 일정이 그 사이만큼 긴 기간
   * 일정으로 바뀐다(실브라우저 프로브가 잡은 자리 — 8/28 하루가 8/5~8/28이 됐다).
   */
  const pickStartDate = (iso: string): void => {
    const keep = Math.max(0, daysBetween(startDate, endDate));
    setStartDate(iso);
    setEndDate(addDays(iso, keep));
  };

  /**
   * 시작 시각을 옮기면 **길이를 지킨 채** 종료 시각도 따라온다(달력 앱의 관례).
   * 그러지 않으면 늦은 시각을 고르는 순간 종료가 시작보다 앞선 상태가 되어, 사용자가
   * 종료를 손으로 고칠 때까지 저장이 막힌다(실브라우저 프로브가 잡은 자리).
   */
  const pickStart = (v: string): void => {
    const from = minutesOf(startTime);
    const to = minutesOf(endTime);
    const next = minutesOf(v);
    setStartTime(v);
    if (from === null || to === null || next === null) return;
    const keep = Math.max(15, to - from);
    setEndTime(hhmm(Math.min(23 * 60 + 59, next + keep)));
  };

  const durMin = useMemo(() => {
    const a = minutesOf(startTime);
    const b = minutesOf(endTime);
    return a !== null && b !== null ? b - a : null;
  }, [startTime, endTime]);
  const canSave = !!title.trim() && (allDay || (durMin !== null && durMin > 0));

  // 발치 문구 — 저장 실패가 가장 급하고, 그다음이 "왜 등록이 안 눌리는가"다.
  const footMsg =
    error ??
    (saving
      ? '저장 중…'
      : !title.trim()
        ? ''
        : !allDay && durMin !== null && durMin <= 0
          ? '종료 시각이 시작보다 앞서요'
          : // 어디에 남는지 한 줄로 — 구글에 만든 일정은 그리오에 사본을 두지 않는다.
            target.kind === 'google'
            ? 'Google 캘린더에 저장돼요'
            : '');
  const footTone = error || (!allDay && durMin !== null && durMin <= 0) ? 'var(--mf-danger)' : 'var(--mf-faint2)';

  const submit = (): void => {
    if (!canSave || saving) return;
    onSubmit(
      {
        title: title.trim(),
        startDate,
        endDate: allDay ? endDate : startDate,
        allDay,
        ...(allDay ? {} : { startTime, endTime }),
        ...(location.trim() ? { location: location.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      },
      target,
    );
  };

  return (
    <Modal
      open
      onClose={onClose}
      label="새 일정"
      // 적는 중이므로 막 클릭으로 닫지 않는다(잃을 입력이 있다 — 상세 팝업과 반대).
      dismissOnBackdrop={false}
      // 막·등장 효과는 **설정 팝업과 같은 것**을 쓴다(요청) — 홈의 팝업이 저마다 다른
      // 방식으로 뜨면 그 자체가 산만하다.
      dim={{ ...MODAL_DIM, animation: 'mf-dim-in .18s ease-out', zIndex: 322, alignItems: isMobile ? 'flex-end' : 'center', padding: isMobile ? 0 : 32 }}
      card={{
        // 원본: 640 높이. 구글 열이 없으니 폭은 한 열(원본 `newEvW`의 좁은 쪽).
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
      cardAttrs={{ 'data-new-event': '1' }}
    >
      <>
        <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 10, padding: '16px 18px', borderBottom: '1px solid var(--mf-border-soft)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, flex: '0 0 auto' }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--mf-accent)', display: 'block' }} />
            <span style={{ fontSize: 13.5, fontWeight: 800, letterSpacing: '-.02em', color: 'var(--mf-text)', whiteSpace: 'nowrap' }}>새 일정</span>
          </span>
          <span style={{ flex: 1, minWidth: 0 }} />
          <button type="button" aria-label="닫기" title="닫기" onClick={onClose} className="mf-ctl" style={{ width: 30, height: 30, flex: '0 0 auto', border: '1px solid var(--mf-border)', borderRadius: 999, background: 'var(--mf-card)', color: 'var(--mf-muted)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <div className="lnb-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 22px 24px', display: 'flex', flexDirection: 'column', gap: 19 }}>
          <input
            autoFocus
            aria-label="일정 제목"
            data-new-title
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
            placeholder="일정 제목"
            maxLength={200}
            style={{ width: '100%', boxSizing: 'border-box', height: 52, padding: '0 15px', borderRadius: 14, border: '1px solid var(--mf-border)', background: 'var(--mf-card)', font: 'inherit', fontSize: 18, fontWeight: 800, letterSpacing: '-.03em', color: 'var(--mf-text)', outline: 'none' }}
          />

          {/* 저장할 캘린더(디자인 원본) — 고를 것이 하나면 배지, 둘 이상이면 라디오
              묶음이다(←/→로도 옮겨 다닌다 — 이 앱의 "하나만 고르는 묶음" 규칙). */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <Label>저장할 캘린더</Label>
            {googleTargets.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                <span data-new-cal style={destChipStyle(true, 'var(--mf-accent)')}>
                  <span style={destDotStyle('var(--mf-accent)')} />
                  Geurio 캘린더
                </span>
              </div>
            ) : (
              <RadioCards
                label="저장할 캘린더"
                value={destValid ? dest : 'geurio'}
                onChange={setDest}
                grid={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}
                items={[
                  {
                    value: 'geurio',
                    label: 'Geurio 캘린더',
                    className: 'mf-ctl',
                    attrs: { 'data-new-cal': 'geurio' },
                    style: (on) => destChipStyle(on, 'var(--mf-accent)'),
                    children: (
                      <>
                        <span style={destDotStyle('var(--mf-accent)')} />
                        Geurio 캘린더
                      </>
                    ),
                  },
                  ...googleTargets.map((t) => ({
                    value: t.id,
                    label: `${t.name} (Google)`,
                    className: 'mf-ctl',
                    attrs: { 'data-new-cal': t.id },
                    style: (on: boolean) => destChipStyle(on, t.color ?? 'var(--mf-info)'),
                    children: (
                      <>
                        <span style={destDotStyle(t.color ?? 'var(--mf-info)')} />
                        {t.name}
                      </>
                    ),
                  })),
                ]}
              />
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <Label>날짜와 시간</Label>
              <span style={{ flex: 1, minWidth: 0 }} />
              <PillButton on={allDay} attrs={{ 'data-new-allday': '1' }} onClick={() => setAllDay((v) => !v)}>
                종일
              </PillButton>
            </span>

            <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <span style={{ flex: '1 1 170px', minWidth: 150, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <SubLabel>{allDay ? '시작 날짜' : '날짜'}</SubLabel>
                <DateButton label={allDay ? '시작 날짜' : '날짜'} value={startDate} clearable={false} attrs={{ 'data-new-date': '1' }} onPick={(iso) => iso && pickStartDate(iso)} />
              </span>
              {allDay && (
                <span style={{ flex: '1 1 170px', minWidth: 150, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <SubLabel>종료 날짜</SubLabel>
                  <DateButton label="종료 날짜" value={endDate} min={startDate} clearable={false} attrs={{ 'data-new-enddate': '1' }} onPick={(iso) => iso && setEndDate(iso)} />
                </span>
              )}
              {!allDay && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 7, flex: '1 1 100%', minWidth: 0 }}>
                  <TimeButton label="시작 시각" value={startTime} attrs={{ 'data-new-start': '1' }} onPick={pickStart} />
                  <span style={{ flex: '0 0 auto', fontSize: 12, color: 'var(--mf-faint2)' }}>–</span>
                  <TimeButton label="종료 시각" value={endTime} min={startTime} attrs={{ 'data-new-end': '1' }} onPick={(v) => setEndTime(v)} />
                </span>
              )}
            </div>

            {!allDay && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {QUICK_MINUTES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    data-new-quick={m}
                    onClick={() => {
                      const from = minutesOf(startTime);
                      if (from === null) return;
                      setEndTime(hhmm(Math.min(23 * 60 + 59, from + m)));
                    }}
                    className="mf-ctl"
                    aria-pressed={durMin === m}
                    style={{ height: 24, padding: '0 10px', borderRadius: 999, border: `1px solid ${durMin === m ? 'var(--mf-accent-mute)' : 'var(--mf-border)'}`, background: durMin === m ? 'var(--mf-accent-soft)' : 'var(--mf-card)', color: durMin === m ? 'var(--mf-accent-strong)' : 'var(--mf-muted)', font: 'inherit', fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', flex: '0 0 auto' }}
                  >
                    {m >= 60 ? `${m / 60}시간` : `${m}분`}
                  </button>
                ))}
                <span style={{ flex: 1, minWidth: 0 }} />
                <span data-new-dur style={{ fontSize: 11, color: durMin !== null && durMin > 0 ? 'var(--mf-muted)' : 'var(--mf-danger)', whiteSpace: 'nowrap', flex: '0 0 auto' }}>
                  {durMin === null || durMin <= 0 ? '종료 시각이 시작보다 앞서요' : durMin >= 60 ? `${Math.floor(durMin / 60)}시간${durMin % 60 ? ` ${durMin % 60}분` : ''}` : `${durMin}분`}
                </span>
              </span>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Label>위치</Label>
            <input aria-label="위치" data-new-loc value={location} onChange={(e) => setLocation(e.target.value)} placeholder="주소 또는 장소 이름" maxLength={200} style={fieldStyle} />
          </div>

          {/* 구글 전용 필드(디자인 원본 `nIsGoogle`) — Geurio면 그 사실을 한 줄로 알린다. */}
          {target.kind === 'google' ? (
            <GoogleEventFields value={gf} mode="create" onChange={(patch) => setGf((v) => ({ ...v, ...patch }))} {...(directory ? { directory } : {})} />
          ) : (
            <span data-new-geurio-note style={{ fontSize: 11.5, color: 'var(--mf-faint2)', lineHeight: 1.6 }}>
              Geurio에만 저장되는 일정이에요 · 참석자·Meet·반복은 <b style={{ fontWeight: 700 }}>구글 캘린더</b>를 고르면 쓸 수 있어요
            </span>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Label>메모</Label>
            <textarea aria-label="메모" data-new-note value={note} onChange={(e) => setNote(e.target.value)} placeholder="자유롭게 적어 두세요" maxLength={2000} style={{ ...fieldStyle, height: 78, padding: '11px 12px', resize: 'vertical', lineHeight: 1.6 }} />
          </div>

        </div>

        {/* 발치 왼쪽은 **상황 문구 자리**다 — 늘 같은 안내를 걸어 두면 정작 알려야 할
            때(저장 실패·시각이 거꾸로) 눈에 띌 자리가 없다. */}
        <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px', borderTop: '1px solid var(--mf-border-soft)' }}>
          <span data-new-foot style={{ flex: 1, minWidth: 0, fontSize: 12, color: footTone, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{footMsg}</span>
          <button type="button" onClick={onClose} className="mf-ctl" style={{ flex: '0 0 auto', whiteSpace: 'nowrap', height: isMobile ? 44 : 36, padding: '0 16px', borderRadius: 999, border: '1px solid var(--mf-border)', background: 'var(--mf-card)', color: 'var(--mf-muted)', font: 'inherit', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
            취소
          </button>
          <button
            type="button"
            data-new-submit
            disabled={!canSave || saving}
            onClick={submit}
            // 등록도 그라디언트 버튼 — 면을 갈아 끼우면 색이 사라진다(헤더의 새 일정과 같다).
            className="mf-ctl-primary"
            style={{
              flex: '0 0 auto',
              whiteSpace: 'nowrap',
              height: isMobile ? 44 : 40,
              padding: isMobile ? '0 20px' : '0 26px',
              borderRadius: 999,
              border: 0,
              background: canSave && !saving ? 'linear-gradient(180deg, var(--mf-accent), var(--mf-accent-strong))' : 'var(--mf-accent-mute)',
              color: 'var(--mf-accent-ink)',
              font: 'inherit',
              fontSize: 13.5,
              fontWeight: 800,
              cursor: canSave && !saving ? 'pointer' : 'default',
              boxShadow: canSave && !saving ? '0 8px 18px -10px rgba(var(--mf-accent-rgb), .9)' : 'none',
            }}
          >
            {saving ? '등록 중…' : '등록'}
          </button>
        </div>
      </>
    </Modal>
  );
}

const fieldStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  height: 40,
  padding: '0 12px',
  borderRadius: 12,
  border: '1px solid var(--mf-border)',
  background: 'var(--mf-card)',
  font: 'inherit',
  fontSize: 13,
  color: 'var(--mf-text)',
  outline: 'none',
};

function Label({ children }: { children: ReactNode }) {
  return <span style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--mf-subtext)' }}>{children}</span>;
}

function SubLabel({ children }: { children: ReactNode }) {
  return <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--mf-faint2)' }}>{children}</span>;
}

/** 목적지 칩 — 고른 것만 강조색 테두리·면(색 점은 그 캘린더의 색). */
function destChipStyle(on: boolean, dot: string): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    height: 34,
    padding: '0 14px',
    borderRadius: 999,
    border: on ? '1.5px solid var(--mf-accent-mute)' : '1px solid var(--mf-border)',
    background: on ? 'var(--mf-accent-soft)' : 'var(--mf-card)',
    color: on ? 'var(--mf-accent-strong)' : 'var(--mf-subtext)',
    font: 'inherit',
    fontSize: 12.5,
    fontWeight: 800,
    whiteSpace: 'nowrap',
    flex: '0 0 auto',
    maxWidth: 240,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    cursor: 'pointer',
    ...(dot ? {} : {}),
  };
}

function destDotStyle(color: string): CSSProperties {
  return { width: 7, height: 7, borderRadius: 999, background: color, display: 'block', flex: '0 0 auto' };
}

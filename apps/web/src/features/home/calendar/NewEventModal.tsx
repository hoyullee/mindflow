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
// **반복은 두 목적지 모두** 왼쪽 열에서 고른다(`RecurrenceField`) — 우리 표(0033)도
// 규칙(RRULE)을 담으므로 Geurio 일정도 반복한다.
//
// 목적지가 **구글이면** 원본의 `nIsGoogle` 블록(Meet·참석자·회의실·공개 설정·참여 가능
// 여부·알림)이 **오른쪽 열**로 뜬다(원본 `newEvW` — 900px 두 열). 좁은 화면은 열을
// 나눌 폭이 없어 한 열에 이어 붙인다.

import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Modal, MODAL_DIM, useCardMorph } from '../../../components/Modal';
import { DateButton, PillButton } from './DatePop';
import { TimeButton } from './TimePop';
import { addDays, daysBetween, minutesOf, timeLabel, todayISO } from './model';
import { RadioCards } from '../../../components/Segmented';
import { GoogleEventFields, type GoogleDirectoryApi, type GoogleFieldsValue } from './GoogleEventFields';
import { RecurrenceField } from './RecurrenceField';
import { buildRecurrence, RECURRENCE_OFF, type RecurrenceSpec } from './googleCalendar';
import type { CalendarEventInput } from '../../../adapters/ports';

/** 어디에 저장할까 — `google`이면 그 캘린더 id가 함께 온다. */
export type NewEventTarget = { kind: 'geurio' } | { kind: 'google'; calendarId: string; fields: GoogleFieldsValue };

/** 목적지로 내놓을 구글 캘린더(쓸 수 있는 것만). */
export interface GoogleTarget {
  id: string;
  name: string;
  color?: string;
}

/** 회의 길이 빠른 선택(분) — 30분·1시간·2시간·3시간. 상세 팝업도 같은 줄을 쓴다. */
export const QUICK_MINUTES = [30, 60, 120, 180];

/** 자정부터의 분 → `HH:MM`. */
export function hhmm(mins: number): string {
  return `${`${Math.floor(mins / 60)}`.padStart(2, '0')}:${`${mins % 60}`.padStart(2, '0')}`;
}

export interface NewEventDraft {
  /** 처음 놓일 날짜(달력에서 고른 날, 없으면 오늘). */
  date: string;
  allDay: boolean;
  /** 처음 놓일 시각(`HH:MM`) — 시간표의 빈 시간대를 눌러 열었을 때 그 시각. */
  at?: string;
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
  // 시간표의 빈 시간대를 눌러 열었으면 그 시각부터 한 시간(기본은 09:00–10:00).
  const [startTime, setStartTime] = useState(draft.at ?? '09:00');
  const [endTime, setEndTime] = useState(() => {
    const from = minutesOf(draft.at ?? '09:00');
    return from === null ? '10:00' : hhmm(Math.min(23 * 60 + 59, from + 60));
  });
  const [location, setLocation] = useState('');
  const [note, setNote] = useState('');
  // 기본값은 **우리 표**다 — 남의 서비스에 쓰는 일은 사용자가 골라야 한다.
  const [dest, setDest] = useState<string>('geurio');
  // 구글 전용 필드 — 목적지를 Geurio로 되돌려도 값은 남는다(다시 고르면 그대로).
  const [gf, setGf] = useState<GoogleFieldsValue>({ attendees: [], rooms: [], visibility: 'default', transparency: 'opaque', reminderMinutes: undefined, recurrence: RECURRENCE_OFF, addMeet: false });
  // 반복은 **목적지와 무관**하다(둘 다 규칙을 저장한다) — 그래서 gf 밖의 자기 상태다.
  const [rep, setRep] = useState<RecurrenceSpec>(RECURRENCE_OFF);
  // 고른 캘린더가 사라지면(연동 해제·권한 변경) 조용히 우리 표로 되돌린다.
  const destValid = dest === 'geurio' || googleTargets.some((t) => t.id === dest);
  const target: NewEventTarget = destValid && dest !== 'geurio' ? { kind: 'google', calendarId: dest, fields: { ...gf, recurrence: rep } } : { kind: 'geurio' };
  /** 오른쪽 열로 갈라 놓을 수 있는가 — 좁은 화면은 폭이 없어 한 열에 이어 붙인다. */
  const twoCol = target.kind === 'google' && !isMobile;
  // 크기 애니메이션(요청) — 목적지·반복·종일 같은 선택으로 카드가 늘고 줄 때
  // 이전 크기에서 새 크기로 잇는다(설정 팝업의 화면 전환과 같은 곡선).
  const morphRef = useCardMorph();

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

  /** 머리의 `8월 26일 · 오전 10:00 – 오전 11:00`(원본 `nWhenPill`). */
  const whenPill = (() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startDate);
    const day = m ? `${+m[2]!}월 ${+m[3]!}일` : '날짜 미정';
    const span = daysBetween(startDate, endDate);
    const when = allDay ? (span > 0 ? `${span + 1}일간` : '종일') : `${timeLabel(minutesOf(startTime) ?? 0)} – ${timeLabel(minutesOf(endTime) ?? 0)}`;
    return `${day} · ${when}`;
  })();

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
    const rule = buildRecurrence(rep)?.[0];
    onSubmit(
      {
        title: title.trim(),
        startDate,
        endDate: allDay ? endDate : startDate,
        allDay,
        ...(allDay ? {} : { startTime, endTime }),
        ...(location.trim() ? { location: location.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        // 반복 규칙은 **RRULE 한 줄**로 담는다(구글에 보내는 것과 같은 형식).
        ...(rule ? { recurrence: rule } : {}),
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
      cardRef={morphRef}
      card={{
        // 원본 `newEvW` — 구글 열이 붙으면 900, 아니면 540(우리는 560).
        // 폭 전이도 `useCardMorph`가 잇는다 — CSS transition을 여기 걸면 폭이 아직
        // 옛 값일 때 RO가 짜부라진 높이를 목표로 잡는다(훅 주석 참고).
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
      cardAttrs={{ 'data-new-event': '1' }}
    >
      <>
        <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 10, padding: '16px 18px', borderBottom: '1px solid var(--mf-border-soft)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, flex: '0 0 auto' }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--mf-accent)', display: 'block' }} />
            <span style={{ fontSize: 13.5, fontWeight: 800, letterSpacing: '-.02em', color: 'var(--mf-text)', whiteSpace: 'nowrap' }}>새 일정</span>
          </span>
          {/* 어디에 저장되는지 머리에서 한 번 더(원본 `nCalPill`). **고를 것이 하나면
              그리지 않는다** — 아래 배지와 같은 말을 두 번 하는 셈이다. */}
          {googleTargets.length > 0 && (
            <span data-new-cal-pill style={{ height: 24, padding: '0 10px', borderRadius: 999, background: 'var(--mf-accent-soft)', color: 'var(--mf-accent-strong)', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap', flex: '0 0 auto', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {target.kind === 'google' ? (googleTargets.find((t) => t.id === dest)?.name ?? '구글 캘린더') : 'Geurio 캘린더'}
            </span>
          )}
          <span style={{ flex: 1, minWidth: 0 }} />
          <span data-new-when style={{ height: 24, padding: '0 10px', borderRadius: 999, background: 'var(--mf-panel2)', color: 'var(--mf-muted)', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap', flex: '0 0 auto' }}>
            {whenPill}
          </span>
          <button type="button" aria-label="닫기" title="닫기" onClick={onClose} className="mf-ctl" style={{ width: 30, height: 30, flex: '0 0 auto', border: '1px solid var(--mf-border)', borderRadius: 999, background: 'var(--mf-card)', color: 'var(--mf-muted)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        {/* 본문 — 목적지가 구글이면 **두 열**(원본과 같은 구조: 왼쪽은 일정 자체,
            오른쪽은 구글이 처리해 주는 것들). 각 열이 자기 스크롤을 갖는다. */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'stretch', minWidth: 0 }}>
        <div className="lnb-scroll" data-new-main style={{ flex: '1 1 340px', minWidth: 0, boxSizing: 'border-box', overflowY: 'auto', overflowAnchor: 'none', padding: '20px 22px 24px', display: 'flex', flexDirection: 'column', gap: 19 }}>
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

          {/* 반복 — 목적지와 무관하게 여기서 고른다(둘 다 규칙을 저장한다). */}
          <RecurrenceField value={rep} onChange={setRep} baseDate={startDate} />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Label>메모</Label>
            <textarea aria-label="메모" data-new-note value={note} onChange={(e) => setNote(e.target.value)} placeholder="자유롭게 적어 두세요" maxLength={2000} style={{ ...fieldStyle, height: 110, padding: '11px 12px', resize: 'vertical', lineHeight: 1.6 }} />
          </div>

          {/* 좁은 화면 — 열을 나눌 폭이 없어 같은 열에 이어 붙인다. */}
          {target.kind === 'google' && isMobile && <GoogleEventFields value={gf} mode="create" onChange={(patch) => setGf((v) => ({ ...v, ...patch }))} {...(directory ? { directory } : {})} />}
        </div>

        {twoCol && (
          <div className="lnb-scroll" data-new-google-col style={{ flex: '1 1 260px', minWidth: 240, maxWidth: 380, boxSizing: 'border-box', overflowY: 'auto', overflowAnchor: 'none', borderLeft: '1px solid var(--mf-border-soft)', background: 'var(--mf-cal-cmt)', padding: '18px 16px 22px' }}>
            {/* 원본은 이 열의 내용을 흰 카드 하나에 담는다 — 왼쪽 열과 성격이 다름을
                면으로 말한다("여기는 구글이 해 주는 것들"). */}
            <div style={{ borderRadius: 16, border: '1px solid var(--mf-border-soft)', background: 'var(--mf-card)', padding: 15, boxSizing: 'border-box' }}>
              <GoogleEventFields value={gf} mode="create" onChange={(patch) => setGf((v) => ({ ...v, ...patch }))} {...(directory ? { directory } : {})} />
            </div>
          </div>
        )}
        </div>

        {/* 발치 왼쪽은 **상황 문구 자리**다 — 늘 같은 안내를 걸어 두면 정작 알려야 할
            때(저장 실패·시각이 거꾸로) 눈에 띌 자리가 없다. */}
        <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px', borderTop: '1px solid var(--mf-border-soft)' }}>
          <span data-new-foot style={{ flex: 1, minWidth: 0, fontSize: 12, color: footTone, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{footMsg}</span>
          <button type="button" data-new-cancel onClick={onClose} className="mf-ctl" style={{ flex: '0 0 auto', whiteSpace: 'nowrap', height: isMobile ? 44 : 36, padding: '0 16px', borderRadius: 999, border: '1px solid var(--mf-border)', background: 'var(--mf-card)', color: 'var(--mf-muted)', font: 'inherit', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
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

/** 목적지 칩 — 고른 것만 강조색 테두리·면(색 점은 그 캘린더의 색). 상세 팝업(#11)도 같은 칩이다. */
export function destChipStyle(on: boolean, dot: string): CSSProperties {
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

export function destDotStyle(color: string): CSSProperties {
  return { width: 7, height: 7, borderRadius: 999, background: color, display: 'block', flex: '0 0 auto' };
}

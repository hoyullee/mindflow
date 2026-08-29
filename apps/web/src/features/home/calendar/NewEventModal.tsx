// 새 일정 — 디자인 원본 `Geurio 일정 캘린더.dc.html`의 `newEvOpen` 블록 이식.
//
// 칸반 카드가 아닌 일정(회의·휴가·개인 약속)을 적는 자리다. 저장은 우리 표
// (`calendar_events`, 0033) — 구글은 **선택적 거울**이라는 설계 결정에 따라 다음
// 단계에서 붙는다. 그래서 원본의 `저장할 캘린더 [Geurio | Google]` 고르기는 지금
// **머리의 배지 하나**로 대신한다(고를 것이 하나뿐인 라디오는 UI가 아니라 장식이다).
//
// 원본에 있지만 두지 않은 것: 반복(v1 제외 — 사용자 결정) · 알림(보낼 장치가 없다) ·
// 참석자·Meet·회의실(구글 연동 단계). 눌러도 아무 일이 없는 버튼은 두지 않는다.

import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Modal } from '../../../components/Modal';
import { DateButton, PillButton } from './DatePop';
import { TimeButton } from './TimePop';
import { addDays, daysBetween, minutesOf, todayISO } from './model';
import type { CalendarEventInput } from '../../../adapters/ports';

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
}: {
  draft: NewEventDraft;
  isMobile: boolean;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (input: CalendarEventInput) => void;
}) {
  const [title, setTitle] = useState('');
  const [allDay, setAllDay] = useState(draft.allDay);
  const [startDate, setStartDate] = useState(draft.date || todayISO());
  const [endDate, setEndDate] = useState(draft.date || todayISO());
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [location, setLocation] = useState('');
  const [note, setNote] = useState('');

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
  const footMsg = error ?? (saving ? '저장 중…' : !title.trim() ? '' : !allDay && durMin !== null && durMin <= 0 ? '종료 시각이 시작보다 앞서요' : '');
  const footTone = error || (!allDay && durMin !== null && durMin <= 0) ? 'var(--mf-danger)' : 'var(--mf-faint2)';

  const submit = (): void => {
    if (!canSave || saving) return;
    onSubmit({
      title: title.trim(),
      startDate,
      endDate: allDay ? endDate : startDate,
      allDay,
      ...(allDay ? {} : { startTime, endTime }),
      ...(location.trim() ? { location: location.trim() } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      label="새 일정"
      // 적는 중이므로 막 클릭으로 닫지 않는다(잃을 입력이 있다 — 상세 팝업과 반대).
      dismissOnBackdrop={false}
      // 디자인 원본과 같은 막 — 팝업이 떠 있는 동안 뒤 화면을 가린다.
      dim={{ background: 'rgba(46,42,38,.32)', backdropFilter: 'blur(3px)', animation: 'mf-dim-in .16s ease-out', zIndex: 322, alignItems: isMobile ? 'flex-end' : 'center', padding: isMobile ? 0 : 32 }}
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
      }}
      cardAttrs={{ 'data-new-event': '1' }}
    >
      <>
        <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 10, padding: '16px 18px', borderBottom: '1px solid var(--mf-border-soft)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, flex: '0 0 auto' }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--mf-accent)', display: 'block' }} />
            <span style={{ fontSize: 13.5, fontWeight: 800, letterSpacing: '-.02em', color: 'var(--mf-text)', whiteSpace: 'nowrap' }}>새 일정</span>
          </span>
          <span style={{ height: 24, padding: '0 10px', borderRadius: 999, background: 'var(--mf-accent-soft)', color: 'var(--mf-accent-strong)', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap', flex: '0 0 auto' }}>Geurio 캘린더</span>
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
            className="mf-ctl"
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

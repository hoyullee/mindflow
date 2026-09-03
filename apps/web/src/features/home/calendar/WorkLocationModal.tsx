// 근무 위치 설정(요청) — 구글의 `eventType: 'workingLocation'` 일정을 그 날짜에 쓴다.
//
// **읽는 쪽은 이미 있었다**(#83): 구글이 근무 위치를 그런 일정으로 주고, 우리는
// 그것을 칩이 아니라 **날짜 칸 우측 상단의 한 마디**로 그린다(그 날의 상태니까).
// 이제 쓰는 쪽을 붙인다 — 스코프도 그대로다(`calendar.events`).
//
// **구글 전용**이다: 우리 표(0033)에는 근무 위치라는 개념이 없고, 구글도 이 일정을
// **기본 캘린더에만** 받는다. 그래서 이 팝업은 기본 캘린더를 쓸 수 있고 그 캘린더를
// 지금 보고 있을 때만 열린다(고른 값이 화면에 나타나지 않으면 고장으로 읽힌다).
//
// **모양은 구글의 그 화면과 같다**(사용자 스크린샷): 장소는 집·사무실·기타 위치
// 셋이고, 종일이면 **시작–종료 구간**을 고르며, `시간 추가`를 켜면 **하루 안의 시각
// 구간**이 된다(구글도 시각 근무 위치를 하루로 제한한다 — 그래서 둘은 함께 쓰이지
// 않는다).
//
// **구간은 일정 하나가 아니다.** 구글은 종일 근무 위치를 **하루씩** 들으므로
// (라이브 제보의 400 `malformedWorkingLocationEvent`) 고른 구간의 **하루하루에**
// 하나씩 건다 — 날짜 칸이 근무 위치를 하루 단위로 보여 주는 것과도 결이 같다.
// 그래서 걸려 있는 날을 열면 보이는 것은 **그 하루**이고, 종료 날짜를 뒤로 밀면
// 그만큼 날이 더 걸린다(구간 밖의 날은 건드리지 않는다).
//
// **반복되는 근무 위치는 우리가 다루지 않는다** — 구글은 그것을 캘린더 설정에 두고
// 우리 스코프(`calendar.events`)로는 닿지 않는다. 그래서 한 줄로 알린다(없는 기능을
// 흉내 낸 버튼을 두지 않는다).

import { useState } from 'react';
import { Modal, MODAL_DIM, useCardMorph } from '../../../components/Modal';
import { RadioCards } from '../../../components/Segmented';
import { DateButton, PillButton } from './DatePop';
import { TimeButton } from './TimePop';
import { addDays, daysBetween, minutesOf } from './model';
import { WORK_LOCATION_MAX_DAYS, workLocationDays, type WorkLocationDraft, type WorkLocationKind } from './googleCalendar';

/** 지금 그 날에 걸린 근무 위치 — 없으면 `null`(그 구간·시각을 그대로 되살린다). */
export interface WorkLocationCurrent {
  kind: WorkLocationKind | null;
  label: string;
  startDate: string;
  endDate: string;
  startTime?: string;
  endTime?: string;
}

const PRESETS: { kind: WorkLocationKind; name: string; note: string }[] = [
  // 이름은 구글의 그 화면과 같은 낱말이다(집·사무실·기타 위치). 부제는 **한 줄에
  // 들어갈 만큼**만 — 420px 카드를 셋으로 나누면 칸이 좁다(실측).
  { kind: 'homeOffice', name: '집', note: '집에서 일해요' },
  { kind: 'officeLocation', name: '사무실', note: '이름을 적어요' },
  { kind: 'customLocation', name: '기타 위치', note: '카페·출장지 등' },
];

export function WorkLocationModal({
  iso,
  current,
  isMobile,
  saving,
  error,
  onClose,
  onSave,
  onClear,
}: {
  iso: string;
  current: WorkLocationCurrent | null;
  isMobile: boolean;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (draft: WorkLocationDraft) => void;
  onClear: () => void;
}) {
  const [kind, setKind] = useState<WorkLocationKind>(current?.kind ?? 'homeOffice');
  // 이름은 **이름이 들어가는 갈래**의 값만 되살린다(집은 이름이 없다).
  const [label, setLabel] = useState(current && current.kind !== 'homeOffice' ? current.label : '');
  // 구간·시각은 걸려 있던 일정의 값을 그대로 되살린다(없으면 누른 하루).
  const [from, setFrom] = useState(current?.startDate ?? iso);
  const [to, setTo] = useState(current?.endDate ?? iso);
  const [timed, setTimed] = useState(!!(current?.startTime && current?.endTime));
  const [t1, setT1] = useState(current?.startTime ?? '09:00');
  const [t2, setT2] = useState(current?.endTime ?? '18:00');
  const morphRef = useCardMorph();
  const needsLabel = kind !== 'homeOffice';

  const draft = (): WorkLocationDraft => ({
    kind,
    ...(needsLabel && label.trim() ? { label: label.trim() } : {}),
    startDate: from,
    // 시각과 구간은 함께 쓰이지 않는다 — 구글이 시각 근무 위치를 하루로 제한한다.
    ...(timed ? { startTime: t1, endTime: t2 } : to > from ? { endDate: to } : {}),
  });
  // 하루에 요청 하나씩 나가므로 너무 긴 구간은 **막고 이유를 말한다**(조용히 잘라
  // 저장하면 고른 것과 저장된 것이 달라진다).
  const days = workLocationDays(draft()).length;
  const tooLong = !timed && to > from && dayCount(from, to) > WORK_LOCATION_MAX_DAYS;
  const save = (): void => {
    if (!saving && !tooLong) onSave(draft());
  };

  /** 시작 날짜를 옮기면 길이를 지킨 채 종료도 따라온다(새 일정 팝업과 같은 규칙). */
  const pickFrom = (v: string): void => {
    const keep = Math.max(0, daysBetween(from, to));
    setFrom(v);
    setTo(addDays(v, keep));
  };
  /** 시작 시각도 마찬가지 — 그러지 않으면 종료가 앞선 상태가 되어 저장이 막힌다. */
  const pickT1 = (v: string): void => {
    const a = minutesOf(t1);
    const b = minutesOf(t2);
    const n = minutesOf(v);
    setT1(v);
    if (a === null || b === null || n === null) return;
    const keep = Math.max(15, b - a);
    const end = Math.min(23 * 60 + 45, n + keep);
    setT2(`${`${Math.floor(end / 60)}`.padStart(2, '0')}:${`${end % 60}`.padStart(2, '0')}`);
  };

  const footMsg =
    error ??
    (saving
      ? `저장 중…${days > 1 ? ` (${days}일)` : ''}`
      : tooLong
        ? `한 번에 ${WORK_LOCATION_MAX_DAYS}일까지 걸 수 있어요`
        : days > 1
          ? `${days}일에 걸어요`
          : '');
  const footTone = error || tooLong ? 'var(--mf-danger)' : 'var(--mf-faint2)';

  return (
    <Modal
      open
      onClose={onClose}
      label="근무 위치"
      // 적는 중일 수 있다 — 막 클릭으로 닫지 않는다(새 일정 팝업과 같은 규칙).
      dismissOnBackdrop={false}
      dim={{ ...MODAL_DIM, animation: 'mf-dim-in .18s ease-out', zIndex: 323, alignItems: isMobile ? 'flex-end' : 'center', padding: isMobile ? 0 : 32 }}
      cardRef={morphRef}
      card={{
        width: isMobile ? '100%' : 420,
        maxWidth: '100%',
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
      cardAttrs={{ 'data-work-modal': '1' }}
    >
      <>
        <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 10, padding: '16px 18px', borderBottom: '1px solid var(--mf-border-soft)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <HomeGlyph />
            <span style={{ fontSize: 13.5, fontWeight: 800, letterSpacing: '-.02em', color: 'var(--mf-text)', whiteSpace: 'nowrap' }}>근무 위치</span>
          </span>
          <span style={{ flex: 1, minWidth: 0 }} />
          <button type="button" aria-label="닫기" title="닫기" onClick={onClose} className="mf-ctl" style={{ width: 30, height: 30, flex: '0 0 auto', border: '1px solid var(--mf-border)', borderRadius: 999, background: 'var(--mf-card)', color: 'var(--mf-muted)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '18px 20px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--mf-subtext)' }}>장소 선택</span>
            <RadioCards
              label="근무 위치 갈래"
              value={kind}
              onChange={(v) => setKind(v as WorkLocationKind)}
              grid={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}
              items={PRESETS.map((p) => ({
                value: p.kind,
                label: p.name,
                className: 'mf-ctl',
                attrs: { 'data-work-kind': p.kind },
                style: (on: boolean) => ({
                  display: 'flex',
                  flexDirection: 'column' as const,
                  alignItems: 'flex-start',
                  gap: 3,
                  padding: '11px 12px',
                  borderRadius: 14,
                  border: on ? '1.5px solid var(--mf-accent-mute)' : '1px solid var(--mf-border)',
                  background: on ? 'var(--mf-accent-soft)' : 'var(--mf-card)',
                  color: on ? 'var(--mf-accent-strong)' : 'var(--mf-subtext)',
                  font: 'inherit',
                  textAlign: 'left' as const,
                  cursor: 'pointer',
                }),
                children: (
                  <>
                    <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: '-.015em' }}>{p.name}</span>
                    <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--mf-faint2)', lineHeight: 1.4 }}>{p.note}</span>
                  </>
                ),
              }))}
            />
          </div>

          {/* 이름 — 사무실·직접 입력에만 있다(재택은 이름이 없다). 비워 두면 구글의
              기본 표기를 쓴다(없는 것을 지어내지 않는다). */}
          {needsLabel && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--mf-subtext)' }}>{kind === 'officeLocation' ? '사무실 이름' : '장소 이름'}</span>
              <input
                aria-label={kind === 'officeLocation' ? '사무실 이름' : '장소 이름'}
                data-work-label
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') save();
                }}
                placeholder={kind === 'officeLocation' ? '예: 판교 오피스 5층' : '예: 고객사 · 워크숍'}
                maxLength={100}
                style={{ width: '100%', boxSizing: 'border-box', height: 40, padding: '0 12px', borderRadius: 12, border: '1px solid var(--mf-border)', background: 'var(--mf-card)', font: 'inherit', fontSize: 13, color: 'var(--mf-text)', outline: 'none' }}
              />
            </div>
          )}

          {/* 언제 — 구글의 그 화면과 같은 한 줄: 종일은 시작–종료 구간이고, `시간 추가`를
              켜면 하루 안의 시각 구간이 된다(구글이 시각을 하루로 제한한다). */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--mf-subtext)' }}>{timed ? '날짜와 시간' : '기간'}</span>
            {/* ⚠️ `DateButton`은 `width: 100%`다(부모가 세로 flex라는 전제 — 그 파일의
                주석). 한 줄에 둘을 세우려면 **각자 flex 칸에 담아야** 한다: 버튼에
                직접 flex를 주면 폭이 100%인 채로 줄이 접힌다(실측). */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <DateButton label={timed ? '날짜' : '시작 날짜'} value={from} clearable={false} attrs={{ 'data-work-from': '1' }} onPick={(v) => v && pickFrom(v)} />
              </span>
              {!timed && (
                <>
                  <span style={{ flex: '0 0 auto', fontSize: 12, color: 'var(--mf-faint2)' }}>–</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <DateButton label="종료 날짜" value={to} min={from} clearable={false} attrs={{ 'data-work-to': '1' }} onPick={(v) => setTo(v ?? from)} />
                  </span>
                </>
              )}
            </div>
            {timed && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <TimeButton label="시작 시각" value={t1} attrs={{ 'data-work-t1': '1' }} onPick={pickT1} />
                <span style={{ flex: '0 0 auto', fontSize: 12, color: 'var(--mf-faint2)' }}>–</span>
                <TimeButton label="종료 시각" value={t2} min={t1} attrs={{ 'data-work-t2': '1' }} onPick={(v) => setT2(v)} />
              </div>
            )}
            <span style={{ display: 'inline-flex' }}>
              <PillButton
                on={timed}
                attrs={{ 'data-work-time': '1' }}
                onClick={() => {
                  // 시각을 켜면 하루로 접는다(구간과 함께 쓸 수 없다).
                  if (!timed) setTo(from);
                  setTimed(!timed);
                }}
              >
                {timed ? '시간 지우기' : '＋ 시간 추가'}
              </PillButton>
            </span>
          </div>

          <span data-work-note style={{ fontSize: 11.5, color: 'var(--mf-faint2)', lineHeight: 1.6 }}>
            Google 캘린더의 기본 캘린더에 하루씩 저장돼요. 반복되는 근무 위치는 Google 캘린더 설정에서 정해요.
          </span>
        </div>

        <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px', borderTop: '1px solid var(--mf-border-soft)' }}>
          <span data-work-foot style={{ flex: 1, minWidth: 0, fontSize: 12, color: footTone, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{footMsg}</span>
          {/* 지우기는 **걸려 있을 때만** — 없는 것을 지울 수는 없다. */}
          {current && (
            <button type="button" data-work-clear title="이 날의 근무 위치 지우기" aria-label="이 날의 근무 위치 지우기" disabled={saving} onClick={onClear} className="mf-ctl" style={{ flex: '0 0 auto', whiteSpace: 'nowrap', height: isMobile ? 44 : 36, padding: '0 14px', borderRadius: 999, border: '1px solid var(--mf-border)', background: 'var(--mf-card)', color: 'var(--mf-danger)', font: 'inherit', fontSize: 12.5, fontWeight: 700, cursor: saving ? 'default' : 'pointer' }}>
              지우기
            </button>
          )}
          <button type="button" data-work-cancel onClick={onClose} className="mf-ctl" style={{ flex: '0 0 auto', whiteSpace: 'nowrap', height: isMobile ? 44 : 36, padding: '0 16px', borderRadius: 999, border: '1px solid var(--mf-border)', background: 'var(--mf-card)', color: 'var(--mf-muted)', font: 'inherit', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
            취소
          </button>
          <button
            type="button"
            data-work-save
            disabled={saving || tooLong}
            onClick={save}
            className="mf-ctl-primary"
            style={{ flex: '0 0 auto', whiteSpace: 'nowrap', height: isMobile ? 44 : 40, padding: isMobile ? '0 20px' : '0 24px', borderRadius: 999, border: 0, background: 'linear-gradient(180deg, var(--mf-accent), var(--mf-accent-strong))', color: 'var(--mf-accent-ink)', font: 'inherit', fontSize: 13.5, fontWeight: 800, cursor: saving || tooLong ? 'default' : 'pointer', opacity: tooLong ? 0.5 : 1, boxShadow: '0 8px 18px -10px rgba(var(--mf-accent-rgb), .9)' }}
          >
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      </>
    </Modal>
  );
}

/** 두 날 사이의 날 수(양끝 포함) — 상한 판정에만 쓴다. */
function dayCount(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00`);
  const b = Date.parse(`${to}T00:00:00`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 1;
  return Math.floor((b - a) / 86400000) + 1;
}

/** 집 + 노트북 — 달력 칸의 근무 위치 배지와 같은 글리프 계열. */
function HomeGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--mf-accent-strong)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 10.5 12 4l9 6.5" />
      <path d="M5 10v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9" />
      <path d="M9.5 20v-5h5v5" />
    </svg>
  );
}

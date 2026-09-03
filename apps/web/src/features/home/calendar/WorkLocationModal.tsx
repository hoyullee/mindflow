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
// **되풀이**는 하루짜리면 언제나 뜬다(요청 — 구글의 `근무 위치 수정` 화면과 같은 두
// 선택: `선택한 날짜만` / `…부터 매주`). 구간(하루 초과)에서만 사라진다: 구간은 이미
// 하루씩 여러 일정으로 나가므로 거기에 되풀이를 얹으면 사용자가 고른 적 없는 모양이
// 된다.
//
// **이미 매주 반복인 근무 위치**를 열면 `매주`가 켜진 채로 뜨고, 두 선택은 그때
// **바꾸는 범위**가 된다(구글의 그 화면과 같은 뜻):
//  - `매주` 유지 → 그 **반복 자체**를 고친다(회차가 아니라 원본 일정).
//  - `선택한 날짜만` → 그 회차를 지우고 그 날짜에 홀로 선 근무 위치를 새로 만든다.
//
// 회차를 그대로 PATCH하지 않는 이유는 구글이 막기 때문이다 — 라이브에서 400
// `malformedWorkingLocationEvent`("modify a working location event in a way that is not
// valid for this event type")로 거절됐다. 그래서 어느 쪽을 고르든 **회차 PATCH는 하지
// 않는다**(저장 규칙은 `useGoogleCalendar.saveWorkLocation`).

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
  /** 이미 매주 되풀이되는 일정의 회차인가 — 그러면 되풀이는 고르는 값이 아니다. */
  recurring?: boolean;
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
  /** 지금 도는 일 — 어느 버튼이 스피너를 달지 정한다(`null`이면 쉬는 중). */
  saving: 'save' | 'clear' | null;
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
  // 되풀이 — 이미 매주 반복인 근무 위치를 열면 그 상태가 기본값이다(요청).
  const [weekly, setWeekly] = useState(!!current?.recurring);
  const morphRef = useCardMorph();
  const needsLabel = kind !== 'homeOffice';
  /** 하루짜리인가 — 되풀이는 여기에만 뜻이 있다(구간은 하루씩 여러 일정이다). */
  const oneDay = timed || to <= from;
  const showRepeat = oneDay;
  const on = showRepeat && weekly;
  /** 이미 반복인 것을 그 날만 떼어 내는 저장인가 — 발치가 그 사실을 말한다. */
  const detaching = !!current?.recurring && showRepeat && !weekly;
  /** 반복 자체를 고치는 저장인가 — 회차 하나가 아니라 그 반복 전체가 바뀐다. */
  const wholeSeries = !!current?.recurring && on;

  const draft = (): WorkLocationDraft => ({
    kind,
    ...(needsLabel && label.trim() ? { label: label.trim() } : {}),
    startDate: from,
    // 시각과 구간은 함께 쓰이지 않는다 — 구글이 시각 근무 위치를 하루로 제한한다.
    ...(timed ? { startTime: t1, endTime: t2 } : to > from ? { endDate: to } : {}),
    ...(on ? { repeat: 'weekly' as const } : {}),
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

  // 발치는 **오류·상황**만 말한다. "저장 중"·"지우는 중"은 그 버튼이 스피너와 함께
  // 말하므로 여기서 한 번 더 적지 않고(같은 말을 두 곳에서 하지 않는다), 도는 동안
  // 앞으로 일어날 일을 설명하던 두 문구는 접는다(이미 일어나고 있다).
  const footMsg =
    error ??
    (tooLong
      ? `한 번에 ${WORK_LOCATION_MAX_DAYS}일까지 걸 수 있어요`
      : days > 1
        ? `${days}일에 걸어요`
        : saving
          ? ''
          : wholeSeries
            ? '매주 반복되는 근무 위치 전체가 바뀌어요'
            : detaching
              ? '이 날만 반복에서 떼어 내요'
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

          {/* 되풀이(요청 ④) — 구글의 `근무 위치 수정` 화면과 같은 두 선택.
              하루짜리에만 뜬다(구간은 이미 하루씩 여러 일정이다). */}
          {showRepeat && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--mf-subtext)' }}>되풀이</span>
              <RadioCards
                label="근무 위치 되풀이"
                value={weekly ? 'weekly' : 'once'}
                onChange={(v) => setWeekly(v === 'weekly')}
                grid={{ display: 'flex', flexDirection: 'column', gap: 6 }}
                items={[
                  { value: 'once', title: '선택한 날짜만', note: dayLabel(from) },
                  { value: 'weekly', title: `${dayLabel(from)}부터 매주`, note: `${weekdayName(from)}요일` },
                ].map((o) => ({
                  value: o.value,
                  label: `${o.title} · ${o.note}`,
                  className: 'mf-ctl',
                  attrs: { 'data-work-repeat': o.value },
                  style: (sel: boolean) => ({
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '9px 12px',
                    borderRadius: 12,
                    border: sel ? '1.5px solid var(--mf-accent-mute)' : '1px solid var(--mf-border)',
                    background: sel ? 'var(--mf-accent-soft)' : 'var(--mf-card)',
                    color: sel ? 'var(--mf-accent-strong)' : 'var(--mf-subtext)',
                    font: 'inherit',
                    textAlign: 'left' as const,
                    cursor: 'pointer',
                  }),
                  children: (
                    <>
                      {/* 라디오 점 — 구글의 그 화면과 같은 어포던스(고른 칸만 채워진다). */}
                      <span aria-hidden="true" style={{ flex: '0 0 auto', width: 15, height: 15, borderRadius: 999, border: `1.5px solid ${weekly === (o.value === 'weekly') ? 'var(--mf-accent)' : 'var(--mf-border)'}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                        {weekly === (o.value === 'weekly') && <span style={{ width: 7, height: 7, borderRadius: 999, background: 'var(--mf-accent)' }} />}
                      </span>
                      <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: '-.01em', whiteSpace: 'nowrap' }}>{o.title}</span>
                        <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--mf-faint2)' }}>{o.note}</span>
                      </span>
                    </>
                  ),
                }))}
              />
            </div>
          )}

        </div>

        <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px', borderTop: '1px solid var(--mf-border-soft)' }}>
          <span data-work-foot style={{ flex: 1, minWidth: 0, fontSize: 12, color: footTone, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{footMsg}</span>
          {/* 지우기는 **걸려 있을 때만** — 없는 것을 지울 수는 없다. */}
          {current && (
            <button type="button" data-work-clear title="이 날의 근무 위치 지우기" aria-label="이 날의 근무 위치 지우기" aria-busy={saving === 'clear' ? true : undefined} disabled={!!saving} onClick={onClear} className="mf-ctl" style={{ flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', height: isMobile ? 44 : 36, padding: '0 14px', borderRadius: 999, border: '1px solid var(--mf-border)', background: 'var(--mf-card)', color: 'var(--mf-danger)', font: 'inherit', fontSize: 12.5, fontWeight: 700, cursor: saving ? 'default' : 'pointer', opacity: saving && saving !== 'clear' ? 0.6 : 1 }}>
              {saving === 'clear' && <Spinner tone="var(--mf-danger)" track="var(--mf-hairline)" />}
              {saving === 'clear' ? '지우는 중…' : '지우기'}
            </button>
          )}
          <button type="button" data-work-cancel disabled={!!saving} onClick={onClose} className="mf-ctl" style={{ flex: '0 0 auto', whiteSpace: 'nowrap', height: isMobile ? 44 : 36, padding: '0 16px', borderRadius: 999, border: '1px solid var(--mf-border)', background: 'var(--mf-card)', color: 'var(--mf-muted)', font: 'inherit', fontSize: 12.5, fontWeight: 700, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1 }}>
            취소
          </button>
          <button
            type="button"
            data-work-save
            aria-busy={saving === 'save' ? true : undefined}
            disabled={!!saving || tooLong}
            onClick={save}
            className="mf-ctl-primary"
            style={{ flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap', height: isMobile ? 44 : 40, padding: isMobile ? '0 20px' : '0 24px', borderRadius: 999, border: 0, background: 'linear-gradient(180deg, var(--mf-accent), var(--mf-accent-strong))', color: 'var(--mf-accent-ink)', font: 'inherit', fontSize: 13.5, fontWeight: 800, cursor: saving || tooLong ? 'default' : 'pointer', opacity: tooLong || (saving && saving !== 'save') ? 0.5 : 1, boxShadow: '0 8px 18px -10px rgba(var(--mf-accent-rgb), .9)' }}
          >
            {saving === 'save' && <Spinner tone="var(--mf-accent-ink)" track="var(--mf-accent-strong)" />}
            {saving === 'save' ? '저장 중…' : '저장'}
          </button>
        </div>
      </>
    </Modal>
  );
}

const DOW = ['일', '월', '화', '수', '목', '금', '토'];

/** `9월 16일 (수요일)` — 되풀이 선택지가 무엇을 가리키는지 그대로 적는다. */
function dayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${DOW[d.getDay()]}요일)`;
}

/** `수` — 매주 어느 요일인가. */
function weekdayName(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? '' : (DOW[d.getDay()] ?? '');
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

/**
 * 도는 중 표시 — 그 버튼 안에서 돈다(요청).
 *
 * 자리를 버튼 안에 둔 이유는 **누른 것이 무엇인지**가 곧 답이기 때문이다: 저장과
 * 지우기가 같은 발치에 나란히 있어서, 표시를 한 곳에 두면 어느 쪽이 도는지 알 수
 * 없다. `mf-spin` 키프레임은 앱이 이미 쓰는 그것이다(삭제 확인창·로더와 같은 값).
 */
function Spinner({ tone, track }: { tone: string; track: string }) {
  return (
    <span
      data-work-spin
      aria-hidden="true"
      style={{
        display: 'block',
        flexShrink: 0,
        width: 13,
        height: 13,
        borderRadius: 999,
        // 트랙은 그 버튼의 면에서 온다 — 강조색 버튼에는 한 톤 진한 강조색, 흰
        // 면에는 옅은 경계선. 한 값으로 박으면 어느 한쪽에서 보이지 않는다.
        border: `2px solid ${track}`,
        borderTopColor: tone,
        animation: 'mf-spin .7s linear infinite',
      }}
    />
  );
}

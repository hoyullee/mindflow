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
// **하루만 다룬다.** 여러 날에 걸친 근무 위치는 손대지 않고 사유를 적는다 — 하루만
// 고치려면 일정을 쪼개야 하는데(구글의 클라이언트가 하는 일) 그 규칙을 흉내 내면
// 남의 달력이 조용히 어그러진다(반복 일정 삭제를 상세로 미루는 것과 같은 결).

import { useState } from 'react';
import { Modal, MODAL_DIM, useCardMorph } from '../../../components/Modal';
import { RadioCards } from '../../../components/Segmented';
import { dateLabel } from './model';
import type { WorkLocationDraft, WorkLocationKind } from './googleCalendar';

/** 지금 그 날에 걸린 근무 위치 — 없으면 `null`. */
export interface WorkLocationCurrent {
  kind: WorkLocationKind | null;
  label: string;
  /** 여러 날에 걸친 일정인가 — 그러면 고치지 않고 사유를 적는다. */
  spanned: boolean;
}

const PRESETS: { kind: WorkLocationKind; name: string; note: string }[] = [
  // 부제는 **한 줄에 들어갈 만큼**만 — 420px 카드를 셋으로 나누면 칸이 좁다(실측).
  { kind: 'homeOffice', name: '재택', note: '집에서 일해요' },
  { kind: 'officeLocation', name: '사무실', note: '이름을 적어요' },
  { kind: 'customLocation', name: '직접 입력', note: '카페·출장지 등' },
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
  // 이름은 **이름이 들어가는 갈래**의 값만 되살린다(재택은 이름이 없다).
  const [label, setLabel] = useState(current && current.kind !== 'homeOffice' ? current.label : '');
  const morphRef = useCardMorph();
  const locked = !!current?.spanned;
  const needsLabel = kind !== 'homeOffice';

  const footMsg = error ?? (saving ? '저장 중…' : locked ? '여러 날에 걸친 근무 위치예요 — 구글에서 고쳐 주세요' : '');
  const footTone = error || locked ? 'var(--mf-danger)' : 'var(--mf-faint2)';

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
          <span data-work-day style={{ height: 24, padding: '0 10px', borderRadius: 999, background: 'var(--mf-panel2)', color: 'var(--mf-muted)', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
            {dateLabel(iso)}
          </span>
          <button type="button" aria-label="닫기" title="닫기" onClick={onClose} className="mf-ctl" style={{ width: 30, height: 30, flex: '0 0 auto', border: '1px solid var(--mf-border)', borderRadius: 999, background: 'var(--mf-card)', color: 'var(--mf-muted)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '18px 20px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--mf-subtext)' }}>어디에서 일하나요</span>
            <RadioCards
              label="근무 위치 갈래"
              value={kind}
              onChange={(v) => setKind(v as WorkLocationKind)}
              disabled={locked}
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
                  cursor: locked ? 'default' : 'pointer',
                  opacity: locked ? 0.55 : 1,
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
                readOnly={locked}
                onChange={(e) => setLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !locked && !saving) onSave({ kind, ...(label.trim() ? { label: label.trim() } : {}) });
                }}
                placeholder={kind === 'officeLocation' ? '예: 판교 오피스 5층' : '예: 고객사 · 워크숍'}
                maxLength={100}
                style={{ width: '100%', boxSizing: 'border-box', height: 40, padding: '0 12px', borderRadius: 12, border: '1px solid var(--mf-border)', background: 'var(--mf-card)', font: 'inherit', fontSize: 13, color: 'var(--mf-text)', outline: 'none' }}
              />
            </div>
          )}

          <span data-work-note style={{ fontSize: 11.5, color: 'var(--mf-faint2)', lineHeight: 1.6 }}>
            Google 캘린더의 기본 캘린더에 하루치로 저장돼요.
          </span>
        </div>

        <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px', borderTop: '1px solid var(--mf-border-soft)' }}>
          <span data-work-foot style={{ flex: 1, minWidth: 0, fontSize: 12, color: footTone, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{footMsg}</span>
          {/* 지우기는 **걸려 있을 때만** — 없는 것을 지울 수는 없다. */}
          {current && !current.spanned && (
            <button type="button" data-work-clear disabled={saving} onClick={onClear} className="mf-ctl" style={{ flex: '0 0 auto', whiteSpace: 'nowrap', height: isMobile ? 44 : 36, padding: '0 14px', borderRadius: 999, border: '1px solid var(--mf-border)', background: 'var(--mf-card)', color: 'var(--mf-danger)', font: 'inherit', fontSize: 12.5, fontWeight: 700, cursor: saving ? 'default' : 'pointer' }}>
              지우기
            </button>
          )}
          <button type="button" data-work-cancel onClick={onClose} className="mf-ctl" style={{ flex: '0 0 auto', whiteSpace: 'nowrap', height: isMobile ? 44 : 36, padding: '0 16px', borderRadius: 999, border: '1px solid var(--mf-border)', background: 'var(--mf-card)', color: 'var(--mf-muted)', font: 'inherit', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
            취소
          </button>
          {!locked && (
            <button
              type="button"
              data-work-save
              disabled={saving}
              onClick={() => onSave({ kind, ...(label.trim() ? { label: label.trim() } : {}) })}
              className="mf-ctl-primary"
              style={{ flex: '0 0 auto', whiteSpace: 'nowrap', height: isMobile ? 44 : 40, padding: isMobile ? '0 20px' : '0 24px', borderRadius: 999, border: 0, background: 'linear-gradient(180deg, var(--mf-accent), var(--mf-accent-strong))', color: 'var(--mf-accent-ink)', font: 'inherit', fontSize: 13.5, fontWeight: 800, cursor: saving ? 'default' : 'pointer', boxShadow: '0 8px 18px -10px rgba(var(--mf-accent-rgb), .9)' }}
            >
              {saving ? '저장 중…' : '저장'}
            </button>
          )}
        </div>
      </>
    </Modal>
  );
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

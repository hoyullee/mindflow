import { useEffect, useRef, useState } from 'react';
import { DateButton } from '../../home/calendar/DatePop';
import { bizDaysIn, LEAVE_KIND, shortDate, type HolidayRules, type LeaveKind, type Person } from './model';
import type { Leave, LeaveInput } from '../jira/leavesStore';
import { MONO, Seg } from './wsUi';

/**
 * 담당자 휴가(휴가 스펙)의 공통 조각 — 빗금 질감·칩·반쪽 아바타·등록 폼.
 * 회사 휴일(연한 분홍 바탕)과 구분되게 휴가는 늘 **빗금**이다.
 */

export const HATCH = 'repeating-linear-gradient(45deg, #F1EAE1 0 4px, #FFFDFB 4px 8px)';

/** `09.22–09.23`, 하루면 `09.30`. */
export const leaveRange = (l: { start: string; end: string }) => (l.start === l.end ? shortDate(l.start) : `${shortDate(l.start)}–${shortDate(l.end)}`);
/** `오후 반차 · 병원` */
export const leaveLabel = (l: { kind: LeaveKind; note?: string }) => `${LEAVE_KIND[l.kind]}${l.note ? ` · ${l.note}` : ''}`;

export function UmbrellaIcon({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M22 12a10 10 0 0 0-20 0zM12 12v7a2 2 0 0 0 4 0" />
    </svg>
  );
}

/** 휴가인 사람 아바타 — 흰 바탕 + 색 테두리. 반차는 반만 채운다(오전 위 · 오후 아래). */
export function LeaveAvatar({ p, kind, size }: { p: Pick<Person, 'ini' | 'c'>; kind: LeaveKind; size: number }) {
  return (
    <span aria-hidden="true" style={{ position: 'relative', width: size, height: size, borderRadius: '50%', flexShrink: 0, background: '#FFFFFF', border: `1.5px solid ${p.c}`, color: p.c, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.max(6, Math.round(size * 0.42)), fontWeight: 800, lineHeight: 1, boxSizing: 'border-box', overflow: 'hidden' }}>
      {kind !== 'full' && <span style={{ position: 'absolute', inset: 0, background: p.c, opacity: 0.35, clipPath: kind === 'am' ? 'inset(0 0 50% 0)' : 'inset(50% 0 0 0)' }} />}
      <span style={{ position: 'relative' }}>{p.ini}</span>
    </span>
  );
}

/** `휴가 N일` 빗금 배지(집계 헤더·맞춰보기 행). */
export function LeaveBadge({ days, height, font, attrs }: { days: number; height: number; font: number; attrs?: Record<string, string> }) {
  return (
    <span {...attrs} style={{ flexShrink: 0, height, padding: '0 7px', borderRadius: 99, border: '1px dashed #D9CFC3', background: HATCH, color: '#8A8078', fontSize: font, fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap', boxSizing: 'border-box' }}>
      휴가 {fmtDays(days)}일
    </span>
  );
}

export const fmtDays = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** 담당자 행의 `휴가` 단추(우산 + 글자). */
export function LeaveButton({ on, onClick, label, height = 22, font = 10.5 }: { on: boolean; onClick: () => void; label: string; height?: number; font?: number }) {
  return (
    <button type="button" className="btn mf-ws-leave-btn" data-on={on ? '1' : '0'} aria-label={label} aria-expanded={on} onClick={onClick} style={{ flexShrink: 0, height, padding: '0 7px', borderRadius: 99, border: `1px solid ${on ? '#E7C7B4' : '#EADFD3'}`, background: on ? '#FBEDE6' : 'transparent', color: on ? '#C0563A' : '#8A8078', fontFamily: 'inherit', fontSize: font, fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: 3, cursor: 'pointer', whiteSpace: 'nowrap' }}>
      <UmbrellaIcon />
      휴가
    </button>
  );
}

/** 팝오버의 등록된 휴가 칩 — 내가 넣은 것만 누르면 고치고, ×로 지운다. */
export function LeaveChip({ l, onEdit, onDelete, editing }: { l: Leave; onEdit: () => void; onDelete: () => void; editing: boolean }) {
  const title = `${leaveLabel(l)}${l.mine ? '' : ' · 등록한 사람만 고치거나 지울 수 있어요'}`;
  return (
    <span data-ws-leave-chip={l.id} data-mine={l.mine ? '1' : '0'} title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 20, padding: l.mine ? '0 3px 0 7px' : '0 7px', borderRadius: 99, background: HATCH, border: `1px solid ${editing ? '#E8A25F' : '#E4D9CD'}`, boxSizing: 'border-box', maxWidth: '100%' }}>
      <button type="button" className="btn" disabled={!l.mine} onClick={onEdit} aria-label={l.mine ? `${leaveRange(l)} ${leaveLabel(l)} 고치기` : undefined} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: 0, background: 'transparent', padding: 0, fontFamily: 'inherit', cursor: l.mine ? 'pointer' : 'default', minWidth: 0 }}>
        <span style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: 700, color: '#5C554D', whiteSpace: 'nowrap' }}>{leaveRange(l)}</span>
        <span style={{ fontSize: 10.5, fontWeight: 600, color: '#A29B90', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{leaveLabel(l)}</span>
      </button>
      {l.mine && (
        <button type="button" className="btn mf-ws-leave-x" aria-label={`${leaveRange(l)} 휴가 지우기`} onClick={onDelete} style={{ width: 16, height: 16, flexShrink: 0, border: 0, borderRadius: 99, background: 'transparent', color: '#B7ACA1', padding: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </span>
  );
}

export interface LeaveDraft {
  person: string;
  start?: string;
  end?: string;
  kind?: LeaveKind;
  note?: string;
  /** 고치는 중인 내 휴가. */
  editId?: string;
}

/**
 * 인라인 등록 폼(스펙 §3.3) — 시작~끝 · 종일/오전/오후 · 메모 · `영업일 N일`.
 * 반차는 하루짜리라 반차를 고르면 끝 = 시작.
 */
export function LeaveForm({ draft, person, rules, onCancel, onSubmit }: { draft: LeaveDraft; person: Person; rules: HolidayRules; onCancel: () => void; onSubmit: (v: LeaveInput, editId?: string) => Promise<boolean> }) {
  const [start, setStart] = useState(draft.start ?? '');
  const [end, setEnd] = useState(draft.end ?? draft.start ?? '');
  const [kind, setKind] = useState<LeaveKind>(draft.kind ?? 'full');
  const [note, setNote] = useState(draft.note ?? '');
  const [busy, setBusy] = useState(false);
  // 목록 아래쪽 사람의 폼은 스크롤 밖에서 열린다 — 열리면 보이게.
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    boxRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, []);
  const half = kind !== 'full';
  const s = start;
  const e = half ? start : end;
  const ready = !!s && !!e && s <= e;
  const n = ready ? bizDaysIn(s, e, rules, 400).length * (half ? 0.5 : 1) : 0;
  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    await onSubmit({ person: person.id, personName: person.name, start: s, end: e, kind, note }, draft.editId);
    setBusy(false);
  };
  return (
    <div ref={boxRef} data-ws-leave-form={person.id} style={{ margin: '0 2px 6px', padding: 10, borderRadius: 12, background: '#FBF7F1', border: '1px solid #F1E7DC', display: 'flex', flexDirection: 'column', gap: 8, animation: 'mf-tool-pop .14s ease' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ flex: '1 1 0', minWidth: 0 }}>
          <DateButton label="휴가 시작" value={start || undefined} clearable={false} height={30} attrs={{ 'data-ws-leave-start': '' }} onPick={(iso) => {
            if (!iso) return;
            setStart(iso);
            if (!end || end < iso || half) setEnd(iso);
          }} />
        </span>
        <span style={{ color: 'var(--mf-ws-faint)', fontSize: 12 }}>~</span>
        <span style={{ flex: '1 1 0', minWidth: 0, opacity: half ? 0.5 : 1 }}>
          <DateButton label="휴가 끝" value={(half ? start : end) || undefined} clearable={false} disabled={half} height={30} attrs={{ 'data-ws-leave-end': '' }} onPick={(iso) => {
            if (!iso) return;
            setEnd(iso);
            if (!start || start > iso) setStart(iso);
          }} />
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Seg items={[['full', '종일'], ['am', '오전'], ['pm', '오후']]} value={kind} onChange={(k) => { setKind(k); if (k !== 'full' && start) setEnd(start); }} height={22} font={11} pad={8} label="휴가 종류" />
        <input
          data-ws-leave-note
          value={note}
          maxLength={60}
          onChange={(ev) => setNote(ev.target.value)}
          onKeyDown={(ev) => {
            if (ev.key === 'Enter') void submit();
          }}
          placeholder="메모 (연차, 병원…)"
          aria-label="휴가 메모"
          className="mf-ws-leave-note"
          style={{ flex: '1 1 auto', minWidth: 0, height: 26, padding: '0 8px', borderRadius: 8, border: '1px solid #EADFD3', background: '#FFFDFB', color: 'var(--mf-ws-ink)', fontFamily: 'inherit', fontSize: 12, outline: 'none', boxSizing: 'border-box' }}
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span data-ws-leave-sum style={{ fontSize: 11, color: '#A29B90', flex: '1 1 auto', minWidth: 0 }}>{ready ? `영업일 ${fmtDays(n)}일` : '날짜를 골라 주세요'}</span>
        <button type="button" className="btn" onClick={onCancel} style={{ height: 26, padding: '0 10px', borderRadius: 8, border: '1px solid #EADFD3', background: '#FFFDFB', color: 'var(--mf-ws-ink2)', fontFamily: 'inherit', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>
          취소
        </button>
        <button type="button" className="btn" data-ws-leave-submit disabled={!ready || busy} onClick={() => void submit()} style={{ height: 26, padding: '0 12px', borderRadius: 8, border: 0, background: ready ? '#3A352F' : '#EDE6DD', color: ready ? '#FFFDFB' : '#B7ACA1', fontFamily: 'inherit', fontSize: 11.5, fontWeight: 800, cursor: ready ? 'pointer' : 'default' }}>
          {draft.editId ? '저장' : '등록'}
        </button>
      </div>
    </div>
  );
}

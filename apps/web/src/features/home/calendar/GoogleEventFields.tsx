// 구글 일정 전용 필드 — 디자인 원본 `Geurio 일정 캘린더.dc.html`의 `nIsGoogle` 블록.
//
// **왜 구글일 때만 뜨나**: 여기 있는 것들은 구글이 **실제로 처리해 주는 일**이다 —
// 초대 메일 발송(참석자), 알림, 바쁨/한가함(다른 사람이 내 시간을 볼 때), Meet 링크.
// 우리 표(0033)에는 그걸 보낼 장치가 없으므로, 목적지가 Geurio면 대신 한 줄로 알린다
// (디자인 원본의 `evCalNote`도 "참석자·Meet는 구글 일정에서 쓸 수 있어요"라고 적는다).
//
// **참석자·회의실은 선택 스코프에 달려 있다.** 이름 검색은 People API
// (`directory.readonly`·`contacts.other.readonly`), 회의실은 Admin SDK
// (`admin.directory.resource.calendar.readonly`)다. 받지 못했으면(개인 계정에는
// 디렉터리가 없고, 회의실은 조직이 막을 수 있다) **이름 검색 없이 이메일 입력**으로
// 남고 회의실 구획은 **그리지 않는다** — 결과가 영영 비는 상자를 두지 않는다.

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { DateButton, PillButton } from './DatePop';
import { RadioCards } from '../../../components/Segmented';
import { recurrenceSummary, type GoogleTransparency, type GoogleVisibility, type RecurrenceSpec } from './googleCalendar';
import { filterRooms, type DirectoryPerson, type MeetingRoom } from './googleDirectory';

/** 이 묶음이 다루는 값 — 새 일정은 지역 상태, 상세는 구글에서 읽은 값이다. */
export interface GoogleFieldsValue {
  attendees: string[];
  /** 예약한 회의실의 리소스 주소. */
  rooms: string[];
  visibility: GoogleVisibility;
  transparency: GoogleTransparency;
  /** `undefined`=캘린더 기본, `null`=없음, 숫자=N분 전. */
  reminderMinutes: number | null | undefined;
  /** 반복은 **만들 때만** 고칠 수 있다(아래 `mode` 참고). */
  recurrence: RecurrenceSpec;
  addMeet: boolean;
}

/** 선택 스코프로 열리는 것들 — `useGoogleCalendar`가 이 모양으로 내준다. */
export interface GoogleDirectoryApi {
  canSearchPeople: boolean;
  searchPeople: (query: string) => Promise<DirectoryPerson[] | null>;
  canPickRooms: boolean;
  rooms: readonly MeetingRoom[];
  loadRooms: () => void;
}

export interface GoogleFieldsChange {
  attendees?: string[];
  rooms?: string[];
  visibility?: GoogleVisibility;
  transparency?: GoogleTransparency;
  reminderMinutes?: number | null | undefined;
  recurrence?: RecurrenceSpec;
  addMeet?: boolean;
}

const VIS_OPTS: { v: GoogleVisibility; label: string; note: string }[] = [
  { v: 'default', label: '기본', note: '캘린더 기본 공개 설정을 따라요' },
  { v: 'public', label: '공개', note: '캘린더를 공유한 모두가 상세를 볼 수 있어요' },
  { v: 'private', label: '비공개', note: '참석자에게만 제목이 보여요' },
];

/** 디자인 원본의 `evRemindOpts` + 구글의 실제 상태인 **기본 알림**. */
const REMIND_OPTS: { key: string; label: string; minutes: number | null | undefined }[] = [
  { key: 'default', label: '기본', minutes: undefined },
  { key: 'none', label: '없음', minutes: null },
  { key: '10', label: '10분 전', minutes: 10 },
  { key: '60', label: '1시간 전', minutes: 60 },
  { key: '1440', label: '1일 전', minutes: 1440 },
];

const UNITS: { u: RecurrenceSpec['unit']; label: string }[] = [
  { u: 'day', label: '일' },
  { u: 'week', label: '주' },
  { u: 'month', label: '개월' },
];

const END_MODES: { m: RecurrenceSpec['endMode']; label: string }[] = [
  { m: 'none', label: '없음' },
  { m: 'date', label: '날짜' },
  { m: 'count', label: '횟수' },
];

export function GoogleEventFields({
  value,
  onChange,
  /**
   * `create` 새 일정 — 반복·Meet를 고를 수 있다.
   * `edit` 이미 있는 일정 — 반복 규칙과 Meet 생성은 **구글에서** 한다(회차 하나에
   * 규칙을 씌우면 남의 달력이 망가진다). 대신 있는 것을 보여 준다.
   */
  mode,
  meetLink,
  recurring,
  directory,
}: {
  value: GoogleFieldsValue;
  onChange: (patch: GoogleFieldsChange) => void;
  mode: 'create' | 'edit';
  meetLink?: string;
  recurring?: boolean;
  /** 선택 스코프로 열리는 것들 — 없으면 이름 검색·회의실이 빠진다. */
  directory?: GoogleDirectoryApi;
}) {
  // 회의실 목록은 이 묶음이 처음 열릴 때 한 번 받는다(왕복 1회).
  useEffect(() => {
    if (directory?.canPickRooms) directory.loadRooms();
  }, [directory]);
  const remindKey = REMIND_OPTS.find((o) => o.minutes === value.reminderMinutes)?.key ?? 'default';
  const visNote = VIS_OPTS.find((o) => o.v === value.visibility)?.note ?? '';

  return (
    <div data-google-fields style={{ display: 'flex', flexDirection: 'column', gap: 19 }}>
      {mode === 'create' ? (
        <Field label="반복" trailing={<PillButton on={value.recurrence.on} attrs={{ 'data-gf-repeat': '1' }} onClick={() => onChange({ recurrence: { ...value.recurrence, on: !value.recurrence.on } })}>반복</PillButton>}>
          {value.recurrence.on ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 13px', borderRadius: 12, background: 'var(--mf-bg)', border: '1px solid var(--mf-border)' }}>
              <Row label="반복 주기">
                <Stepper value={value.recurrence.interval} min={1} max={30} onChange={(n) => onChange({ recurrence: { ...value.recurrence, interval: n } })} />
                <Segments
                  aria="반복 단위"
                  items={UNITS.map((u) => ({ value: u.u, label: u.label }))}
                  value={value.recurrence.unit}
                  onChange={(u) => onChange({ recurrence: { ...value.recurrence, unit: u as RecurrenceSpec['unit'] } })}
                  attr="data-gf-unit"
                />
                <SubText>마다</SubText>
              </Row>
              <Row label="반복 종료">
                <Segments
                  aria="반복 종료"
                  items={END_MODES.map((e) => ({ value: e.m, label: e.label }))}
                  value={value.recurrence.endMode}
                  onChange={(m) => onChange({ recurrence: { ...value.recurrence, endMode: m as RecurrenceSpec['endMode'] } })}
                  attr="data-gf-endmode"
                />
                {value.recurrence.endMode === 'date' && (
                  <>
                    <DateButton label="반복 종료 날짜" value={value.recurrence.until ?? ''} clearable={false} attrs={{ 'data-gf-until': '1' }} onPick={(iso) => iso && onChange({ recurrence: { ...value.recurrence, until: iso } })} />
                    <SubText>종료</SubText>
                  </>
                )}
                {value.recurrence.endMode === 'count' && (
                  <>
                    <Stepper value={value.recurrence.count ?? 5} min={1} max={365} onChange={(n) => onChange({ recurrence: { ...value.recurrence, count: n } })} />
                    <SubText>회 반복 후 종료</SubText>
                  </>
                )}
              </Row>
              <span data-gf-repeat-summary style={{ fontSize: 11.5, color: 'var(--mf-faint2)' }}>{recurrenceSummary(value.recurrence)}</span>
            </div>
          ) : null}
        </Field>
      ) : recurring ? (
        <span data-gf-repeat-note style={{ fontSize: 11.5, color: 'var(--mf-faint2)', lineHeight: 1.6 }}>
          반복 일정이에요 — 여기서 고치면 <b style={{ fontWeight: 700 }}>이 회차만</b> 바뀝니다. 반복 규칙 자체는 구글에서 바꿔 주세요.
        </span>
      ) : null}

      {/* Google Meet — 만들 때 켜면 구글이 링크를 만들어 준다. 이미 있으면 링크를 보여 준다. */}
      {mode === 'create' ? (
        <Field label="온라인 회의" trailing={<PillButton on={value.addMeet} attrs={{ 'data-gf-meet': '1' }} onClick={() => onChange({ addMeet: !value.addMeet })}>Google Meet</PillButton>}>
          <SubText>{value.addMeet ? '등록할 때 구글이 회의 링크를 만들어 참석자에게 함께 보내요' : '켜면 회의 링크를 함께 만들어요'}</SubText>
        </Field>
      ) : meetLink ? (
        <Field label="온라인 회의">
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span data-gf-meet-link style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12.5, color: 'var(--mf-subtext)' }}>{meetLink}</span>
            <button type="button" className="mf-ctl" data-gf-meet-copy onClick={() => void navigator.clipboard?.writeText(meetLink).catch(() => undefined)} style={{ flex: '0 0 auto', height: 30, padding: '0 12px', borderRadius: 999, border: '1px solid var(--mf-border)', background: 'var(--mf-card)', color: 'var(--mf-subtext)', font: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              링크 복사
            </button>
          </span>
        </Field>
      ) : null}

      <Field label="참석자">
        <Attendees
          list={value.attendees}
          onChange={(next) => onChange({ attendees: next })}
          {...(directory?.canSearchPeople ? { search: directory.searchPeople } : {})}
        />
      </Field>

      {/* 회의실 — 목록을 받을 수 있을 때만 그린다(디자인 원본의 그 자리). */}
      {directory?.canPickRooms && (
        <Field label="회의실">
          <Rooms all={directory.rooms} picked={value.rooms} onChange={(next) => onChange({ rooms: next })} />
        </Field>
      )}

      <Field label="공개 설정">
        <Segments aria="공개 설정" items={VIS_OPTS.map((o) => ({ value: o.v, label: o.label }))} value={value.visibility} onChange={(v) => onChange({ visibility: v as GoogleVisibility })} attr="data-gf-vis" wide />
        <SubText>{visNote}</SubText>
      </Field>

      <Field label="참여 가능 여부">
        <Segments
          aria="참여 가능 여부"
          items={[
            { value: 'opaque', label: '바쁨' },
            { value: 'transparent', label: '한가함' },
          ]}
          value={value.transparency}
          onChange={(v) => onChange({ transparency: v as GoogleTransparency })}
          attr="data-gf-busy"
          wide
        />
      </Field>

      <Field label="알림">
        <Segments aria="알림" items={REMIND_OPTS.map((o) => ({ value: o.key, label: o.label }))} value={remindKey} onChange={(k) => onChange({ reminderMinutes: REMIND_OPTS.find((o) => o.key === k)?.minutes })} attr="data-gf-remind" wide />
      </Field>
    </div>
  );
}

/**
 * 참석자 — 디자인 원본은 조직 디렉터리를 검색하지만 우리는 그 목록을 가져올 수 없다
 * (Admin SDK + 관리자 승인). 그래서 **이메일을 직접 적는다.** 초대 메일은 구글이 보낸다.
 */
function Attendees({ list, onChange, search }: { list: string[]; onChange: (next: string[]) => void; search?: (q: string) => Promise<DirectoryPerson[] | null> }) {
  const [draft, setDraft] = useState('');
  const [hits, setHits] = useState<DirectoryPerson[]>([]);
  const [active, setActive] = useState(0);
  // 이름 검색은 **입력마다 왕복**이므로 220ms 디바운스 — 사람이 치는 속도로는
  // 한 낱말에 한 번이면 충분하다(홈 검색과 같은 판단).
  const seqRef = useRef(0);
  useEffect(() => {
    if (!search) return;
    const q = draft.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    const mine = ++seqRef.current;
    const t = setTimeout(() => {
      void search(q).then((r) => {
        // 늦게 온 옛 응답이 새 결과를 덮지 않게(마지막 요청만 적용).
        if (mine !== seqRef.current) return;
        setHits((r ?? []).filter((p) => !list.includes(p.email)));
        setActive(0);
      });
    }, 220);
    return () => clearTimeout(t);
  }, [draft, search, list]);

  const addEmail = (email: string): void => {
    const e = email.trim().toLowerCase();
    setDraft('');
    setHits([]);
    if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || list.includes(e)) return;
    onChange([...list, e]);
  };
  const add = (): void => addEmail(draft);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, position: 'relative' }}>
      <input
        aria-label={search ? '참석자 이름 또는 이메일' : '참석자 이메일'}
        data-gf-guest-input
        value={draft}
        placeholder={search ? '이름 또는 이메일 검색' : '이메일을 적고 Enter'}
        autoComplete="off"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          // 후보를 고르려는 클릭이 blur보다 먼저 오게 — 그래서 커밋은 미룬다.
          setTimeout(() => {
            setHits([]);
            if (draft.trim()) add();
          }, 120);
        }}
        onKeyDown={(e) => {
          if (hits.length > 0 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length);
            return;
          }
          if (e.key === 'Escape' && hits.length > 0) {
            e.preventDefault();
            setHits([]);
            return;
          }
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            // 후보가 떠 있으면 그것을, 아니면 적은 값을 그대로 이메일로 본다.
            if (hits.length > 0) addEmail(hits[active]?.email ?? draft);
            else add();
          }
        }}
        style={{ width: '100%', boxSizing: 'border-box', height: 40, padding: '0 12px', borderRadius: 12, border: '1px solid var(--mf-border)', background: 'var(--mf-card)', font: 'inherit', fontSize: 13, color: 'var(--mf-text)', outline: 'none' }}
      />
      {hits.length > 0 && (
        <div data-gf-guest-hits style={{ display: 'flex', flexDirection: 'column', gap: 1, padding: 4, borderRadius: 12, background: 'var(--mf-card)', border: '1px solid var(--mf-border)', boxShadow: 'var(--mf-card-shadow-sm)', maxHeight: 190, overflowY: 'auto' }} className="lnb-scroll">
          {hits.map((p, i) => (
            <button
              key={p.email}
              type="button"
              data-gf-guest-hit={p.email}
              data-active={i === active ? '1' : undefined}
              // mousedown으로 처리한다 — blur가 클릭을 삼키는 함정(서식 툴바에서 겪은 것).
              onMouseDown={(e) => {
                e.preventDefault();
                addEmail(p.email);
              }}
              onMouseEnter={() => setActive(i)}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1, padding: '7px 9px', borderRadius: 9, border: 0, background: i === active ? 'var(--mf-panel2)' : 'transparent', font: 'inherit', textAlign: 'left', cursor: 'pointer', minWidth: 0, width: '100%' }}
            >
              <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--mf-text)', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
              <span style={{ fontSize: 11, color: 'var(--mf-faint)', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.email}</span>
            </button>
          ))}
        </div>
      )}
      {list.length > 0 && (
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {list.map((email) => (
            <span key={email} data-gf-guest={email} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 6px 0 10px', borderRadius: 999, background: 'var(--mf-panel2)', border: '1px solid var(--mf-border)', fontSize: 12, color: 'var(--mf-subtext)', maxWidth: '100%' }}>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email}</span>
              <button type="button" aria-label={`${email} 초대 취소`} className="mf-ctl" onClick={() => onChange(list.filter((e) => e !== email))} style={{ flex: '0 0 auto', width: 18, height: 18, borderRadius: 999, border: 0, background: 'transparent', color: 'var(--mf-faint)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </span>
          ))}
        </span>
      )}
      <SubText>{list.length ? `${list.length}명을 초대해요 · 초대 메일은 구글이 보냅니다` : '아직 초대한 사람이 없어요'}</SubText>
    </div>
  );
}

/**
 * 회의실 — 목록은 한 번 받아 두고(왕복 1회) 화면에서 좁힌다. 고른 회의실은 구글에서
 * `resource: true` 참석자로 저장되므로 **실제로 예약된다**.
 */
function Rooms({ all, picked, onChange }: { all: readonly MeetingRoom[]; picked: string[]; onChange: (next: string[]) => void }) {
  const [q, setQ] = useState('');
  const hits = q.trim() ? filterRooms(all, q).filter((r) => !picked.includes(r.email)) : [];
  const byEmail = (email: string) => all.find((r) => r.email === email);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <input
        aria-label="회의실 검색"
        data-gf-room-input
        value={q}
        placeholder="회의실 이름 또는 층 검색"
        autoComplete="off"
        onChange={(e) => setQ(e.target.value)}
        style={{ width: '100%', boxSizing: 'border-box', height: 40, padding: '0 12px', borderRadius: 12, border: '1px solid var(--mf-border)', background: 'var(--mf-card)', font: 'inherit', fontSize: 13, color: 'var(--mf-text)', outline: 'none' }}
      />
      {q.trim() && hits.length === 0 && <SubText>검색 결과가 없어요</SubText>}
      {hits.length > 0 && (
        <div data-gf-room-hits style={{ display: 'flex', flexDirection: 'column', gap: 1, padding: 4, borderRadius: 12, background: 'var(--mf-card)', border: '1px solid var(--mf-border)', boxShadow: 'var(--mf-card-shadow-sm)', maxHeight: 190, overflowY: 'auto' }} className="lnb-scroll">
          {hits.map((r) => (
            <button
              key={r.email}
              type="button"
              data-gf-room-hit={r.email}
              onMouseDown={(e) => {
                e.preventDefault();
                setQ('');
                onChange([...picked, r.email]);
              }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', borderRadius: 9, border: 0, background: 'transparent', font: 'inherit', textAlign: 'left', cursor: 'pointer', minWidth: 0, width: '100%' }}
              className="menu-row"
            >
              <RoomGlyph />
              <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 700, color: 'var(--mf-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
              {r.capacity ? <span style={{ flex: '0 0 auto', fontSize: 11, color: 'var(--mf-faint)' }}>{r.capacity}인</span> : null}
            </button>
          ))}
        </div>
      )}
      {picked.length > 0 && (
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {picked.map((email) => {
            const r = byEmail(email);
            return (
              <span key={email} data-gf-room={email} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 6px 0 9px', borderRadius: 999, background: 'var(--mf-panel2)', border: '1px solid var(--mf-border)', fontSize: 12, color: 'var(--mf-subtext)', maxWidth: '100%' }}>
                <RoomGlyph />
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r?.name ?? email}</span>
                <button type="button" aria-label={`${r?.name ?? email} 예약 취소`} className="mf-ctl" onMouseDown={(e) => e.preventDefault()} onClick={() => onChange(picked.filter((p) => p !== email))} style={{ flex: '0 0 auto', width: 18, height: 18, borderRadius: 999, border: 0, background: 'transparent', color: 'var(--mf-faint)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
                    <path d="M6 6l12 12M18 6 6 18" />
                  </svg>
                </button>
              </span>
            );
          })}
        </span>
      )}
      <SubText>{picked.length ? '선택한 시간에 예약돼요 · 구글이 회의실 일정에 함께 넣습니다' : '조직 캘린더의 회의실을 검색해 예약할 수 있어요'}</SubText>
    </div>
  );
}

function RoomGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--mf-faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: '0 0 auto' }} aria-hidden="true">
      <path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16M15 9h4a1 1 0 0 1 1 1v11M3 21h18M11 12h.01" />
    </svg>
  );
}

function Stepper({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (n: number) => void }) {
  const btn: CSSProperties = { width: 24, height: 24, borderRadius: 8, border: '1px solid var(--mf-border)', background: 'var(--mf-card)', color: 'var(--mf-subtext)', font: 'inherit', fontSize: 13, fontWeight: 800, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flex: '0 0 auto' }}>
      <button type="button" className="mf-ctl" aria-label="줄이기" onClick={() => onChange(Math.max(min, value - 1))} style={btn}>
        −
      </button>
      <span style={{ minWidth: 22, textAlign: 'center', fontFamily: "'JetBrains Mono', monospace", fontSize: 12.5, fontWeight: 700, color: 'var(--mf-text)' }}>{value}</span>
      <button type="button" className="mf-ctl" aria-label="늘리기" onClick={() => onChange(Math.min(max, value + 1))} style={btn}>
        +
      </button>
    </span>
  );
}

/** 하나만 고르는 알약 묶음 — 화살표로도 옮겨 다닌다(이 앱의 규칙). */
function Segments({ aria, items, value, onChange, attr, wide }: { aria: string; items: { value: string; label: string }[]; value: string; onChange: (v: string) => void; attr: string; wide?: boolean }) {
  return (
    <RadioCards
      label={aria}
      value={value}
      onChange={onChange}
      grid={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', ...(wide ? {} : { flex: '0 0 auto' }) }}
      items={items.map((it) => ({
        value: it.value,
        label: it.label,
        className: 'mf-ctl',
        attrs: { [attr]: it.value },
        style: (on: boolean) => ({
          height: 30,
          padding: '0 12px',
          borderRadius: 999,
          border: on ? '1.5px solid var(--mf-accent-mute)' : '1px solid var(--mf-border)',
          background: on ? 'var(--mf-accent-soft)' : 'var(--mf-card)',
          color: on ? 'var(--mf-accent-strong)' : 'var(--mf-subtext)',
          font: 'inherit',
          fontSize: 12,
          fontWeight: on ? 800 : 600,
          cursor: 'pointer',
          whiteSpace: 'nowrap' as const,
        }),
        children: it.label,
      }))}
    />
  );
}

function Field({ label, trailing, children }: { label: string; trailing?: ReactNode; children?: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '-.01em', color: 'var(--mf-subtext)' }}>{label}</span>
        <span style={{ flex: 1, minWidth: 0 }} />
        {trailing}
      </span>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
      <span style={{ flex: '0 0 auto', fontSize: 11, fontWeight: 700, color: 'var(--mf-faint2)', minWidth: 56 }}>{label}</span>
      {children}
    </span>
  );
}

function SubText({ children }: { children: ReactNode }) {
  return <span style={{ fontSize: 11.5, color: 'var(--mf-faint2)', lineHeight: 1.55 }}>{children}</span>;
}

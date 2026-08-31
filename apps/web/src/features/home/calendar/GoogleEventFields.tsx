// 구글 일정 전용 필드 — 디자인 원본 `Geurio 일정 캘린더.dc.html`의 `nIsGoogle` 블록.
//
// **반복은 이 묶음에 없다** — Geurio 일정도 반복하므로 왼쪽 열의 `RecurrenceField`가
// 두 목적지에 함께 뜬다. 여기 남은 것은 구글만 할 수 있는 일이다.
//
// **왜 구글일 때만 뜨나**: 여기 있는 것들은 구글이 **실제로 처리해 주는 일**이다 —
// 초대 메일 발송(참석자), 알림, 바쁨/한가함(다른 사람이 내 시간을 볼 때), Meet 링크.
// 우리 표(0033)에는 그걸 보낼 장치가 없다.
//
// **참석자·회의실은 선택 스코프에 달려 있다.** 이름 검색은 People API
// (`directory.readonly`·`contacts.other.readonly`), 회의실은 Admin SDK
// (`admin.directory.resource.calendar.readonly`)다. 받지 못했으면(개인 계정에는
// 디렉터리가 없고, 회의실은 조직이 막을 수 있다) **이름 검색 없이 이메일 입력**으로
// 남고 회의실 구획은 **그리지 않는다** — 결과가 영영 비는 상자를 두지 않는다.
// 회의실 구획은 목록이 **실제로 도착한 뒤에야** 그린다: 스코프만 보고 먼저 그리면
// 목록 요청이 403으로 끝나는 순간 구획이 사라져 "잠깐 나타났다 사라지는" 깜빡임이
// 된다(라이브 제보).
//
// 디자인 원본과 일부러 다르게 둔 것: 회의실의 `사용 가능/사용 중` 배지와 "선택한
// 시간에 비어 있는 회의실만" 문구 — 그 정보는 freebusy 조회(별도 스코프)에서 오는데
// 우리는 아직 받지 않으므로, 모르는 것을 아는 척 칠하지 않는다. 참석자의 필수/선택
// 전환도 아직 모델에 없어 두지 않았다.

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { Field, Segments, SubText } from './fieldBits';
import type { GoogleTransparency, GoogleVisibility, RecurrenceSpec } from './googleCalendar';
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

export function GoogleEventFields({
  value,
  onChange,
  /**
   * `create` 새 일정 — Meet 링크를 함께 만들 수 있다.
   * `edit` 이미 있는 일정 — Meet 생성과 반복 규칙 변경은 **구글에서** 한다(회차 하나에
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
  const rooms = directory?.canPickRooms ? directory.rooms : [];
  const roomName = (email: string): string => rooms.find((r) => r.email === email)?.name ?? email;

  return (
    <div data-google-fields style={{ display: 'flex', flexDirection: 'column', gap: 19 }}>
      {/* 반복은 이 묶음 밖(왼쪽 열의 `RecurrenceField`)에 있다 — 목적지가 Geurio든
          구글이든 같은 자리에서 고른다. 여기서는 **이미 있는 반복**만 알린다. */}
      {mode === 'edit' && recurring ? (
        <span data-gf-repeat-note style={{ fontSize: 11.5, color: 'var(--mf-faint2)', lineHeight: 1.6 }}>
          반복 일정이에요 — 여기서 고치면 <b style={{ fontWeight: 700 }}>이 회차만</b> 바뀝니다. 반복 규칙 자체는 구글에서 바꿔 주세요.
        </span>
      ) : null}

      {/* Google Meet — 디자인 원본의 **토글 카드**(아이콘 칩 + 상태 문구 + 스위치).
          만들 때 켜면 구글이 링크를 만들어 주고, 이미 있으면 링크를 보여 준다. */}
      {mode === 'create' ? (
        <button
          type="button"
          data-gf-meet
          aria-pressed={value.addMeet}
          className="mf-ctl"
          onClick={() => onChange({ addMeet: !value.addMeet })}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 11,
            width: '100%',
            boxSizing: 'border-box',
            padding: '12px 13px',
            borderRadius: 13,
            border: `1px solid ${value.addMeet ? 'var(--mf-accent-mute)' : 'var(--mf-border-soft)'}`,
            background: value.addMeet ? 'var(--mf-accent-soft)' : 'var(--mf-card)',
            cursor: 'pointer',
            font: 'inherit',
            textAlign: 'left',
            transition: 'background .14s ease, border-color .14s ease',
          }}
        >
          <span style={{ width: 30, height: 30, flex: '0 0 auto', borderRadius: 9, background: 'var(--mf-card)', border: '1px solid var(--mf-border)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <MeetGlyph />
          </span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: '-.015em', color: 'var(--mf-text)' }}>Google Meet {value.addMeet ? '켜짐' : '꺼짐'}</span>
            <span data-gf-meet-note style={{ fontSize: 11, color: 'var(--mf-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {value.addMeet ? '등록하면 회의 링크가 자동으로 만들어져요' : '켜면 초대장에 회의 링크가 함께 들어가요'}
            </span>
          </span>
          {/* 스위치는 장식이다 — 켜짐/꺼짐은 카드 전체(aria-pressed)가 말한다. */}
          <span aria-hidden style={{ flex: '0 0 auto', width: 38, height: 22, borderRadius: 999, background: value.addMeet ? 'var(--mf-accent)' : 'var(--mf-scroll)', padding: 2, boxSizing: 'border-box', display: 'inline-flex', justifyContent: value.addMeet ? 'flex-end' : 'flex-start', transition: 'background .16s ease' }}>
            <span style={{ width: 18, height: 18, borderRadius: 999, background: '#FFFFFF', boxShadow: '0 1px 3px rgba(46,42,38,.3)', display: 'block' }} />
          </span>
        </button>
      ) : meetLink ? (
        <Field label="온라인 회의">
          {/* 원본 `nHasMeetLink` 행 — 링크는 등폭으로, 복사 버튼과 함께. */}
          <span style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 12px', borderRadius: 12, background: 'var(--mf-card)', border: '1px solid var(--mf-border-soft)', minWidth: 0 }}>
            <span data-gf-meet-link style={{ flex: 1, minWidth: 0, fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5, color: 'var(--mf-accent-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meetLink}</span>
            <button type="button" className="mf-ctl" data-gf-meet-copy onClick={() => void navigator.clipboard?.writeText(meetLink).catch(() => undefined)} style={{ flex: '0 0 auto', whiteSpace: 'nowrap', height: 28, padding: '0 12px', borderRadius: 999, border: '1px solid var(--mf-border)', background: 'var(--mf-panel2)', color: 'var(--mf-accent-strong)', font: 'inherit', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>
              링크 복사
            </button>
          </span>
        </Field>
      ) : null}

      <Field label="참석자" sub={value.attendees.length ? `${value.attendees.length}명 초대 · 초대 메일은 구글이 보내요` : '아직 초대한 사람이 없어요'}>
        <Attendees list={value.attendees} onChange={(next) => onChange({ attendees: next })} {...(directory?.canSearchPeople ? { search: directory.searchPeople } : {})} />
      </Field>

      {/* 회의실 — 목록이 **도착했을 때만** 그린다(위 머리 주석의 깜빡임). */}
      {rooms.length > 0 && (
        <Field label="회의실" sub={value.rooms.length ? `${value.rooms.map(roomName).join(' · ')} 예약됨` : '조직 캘린더의 회의실을 골라 예약할 수 있어요'}>
          <Rooms all={rooms} picked={value.rooms} onChange={(next) => onChange({ rooms: next })} />
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

/** 디자인 원본의 아바타 팔레트(`AV`) — 행 순서대로 돌려 쓴다. */
const AV = ['#E8845C', '#7C9BD8', '#69B08A', '#C58AC0', '#D8A24F'];

function Avatar({ label, i }: { label: string; i: number }) {
  return (
    <span aria-hidden style={{ width: 24, height: 24, flex: '0 0 auto', borderRadius: 999, background: AV[i % AV.length], color: '#FFFDFB', fontSize: 10, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      {label.charAt(0).toUpperCase()}
    </span>
  );
}

/** 돋보기 든 34px 검색 상자(원본) — 테두리는 상자가 두르고 입력은 맨몸이다. */
function SearchBox({ label, placeholder, value, attrs, onChange, onBlur, onKeyDown }: { label: string; placeholder: string; value: string; attrs: Record<string, string>; onChange: (v: string) => void; onBlur?: () => void; onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 8, height: 34, padding: '0 11px', borderRadius: 11, border: '1px solid var(--mf-border)', background: 'var(--mf-card)', minWidth: 0, boxSizing: 'border-box' }}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--mf-faint)" strokeWidth="2.2" strokeLinecap="round" style={{ flex: '0 0 auto' }} aria-hidden="true">
        <circle cx="11" cy="11" r="6.5" />
        <path d="m16 16 4 4" />
      </svg>
      <input aria-label={label} {...attrs} value={value} placeholder={placeholder} autoComplete="off" onChange={(e) => onChange(e.target.value)} onBlur={onBlur} onKeyDown={onKeyDown} style={{ flex: 1, minWidth: 0, border: 0, background: 'transparent', font: 'inherit', fontSize: 12, color: 'var(--mf-text)', outline: 'none', padding: 0 }} />
    </span>
  );
}

/** 결과·목록을 담는 흰 카드(원본) — 행 사이는 옅은 선, 넘치면 안에서 스크롤. */
const listCard: CSSProperties = { display: 'flex', flexDirection: 'column', borderRadius: 12, border: '1px solid var(--mf-border)', background: 'var(--mf-card)', overflowY: 'auto' };
const rowDivider = (i: number): CSSProperties => (i === 0 ? {} : { borderTop: '1px solid var(--mf-border-soft)' });

/**
 * 참석자 — 원본의 검색 상자 + 후보 리스트(아바타·이름·이메일·`초대`) + 초대된 사람
 * 카드 행. 이름 검색이 없으면(선택 스코프 미승인) 이메일 직접 입력으로 남는다.
 * 초대 메일은 구글이 보낸다.
 */
function Attendees({ list, onChange, search }: { list: string[]; onChange: (next: string[]) => void; search?: (q: string) => Promise<DirectoryPerson[] | null> }) {
  const [draft, setDraft] = useState('');
  const [hits, setHits] = useState<DirectoryPerson[]>([]);
  const [active, setActive] = useState(0);
  // 마지막 검색이 **끝난** 질의 — "일치하는 사람이 없어요"가 검색 중에 깜빡이지 않게.
  const [settled, setSettled] = useState('');
  // 고른 후보의 이름 — 초대된 행이 이메일 대신 이름을 보여 준다(직접 적은 주소는 주소 그대로).
  const [names, setNames] = useState<Record<string, string>>({});
  // 이름 검색은 **입력마다 왕복**이므로 220ms 디바운스 — 사람이 치는 속도로는
  // 한 낱말에 한 번이면 충분하다(홈 검색과 같은 판단).
  const seqRef = useRef(0);
  useEffect(() => {
    if (!search) return;
    const q = draft.trim();
    setSettled('');
    if (q.length < 2) {
      setHits([]);
      return;
    }
    const mine = ++seqRef.current;
    const t = setTimeout(() => {
      void search(q).then((r) => {
        // 늦게 온 옛 응답이 새 결과를 덮지 않게(마지막 요청만 적용).
        if (mine !== seqRef.current) return;
        setHits(r ?? []);
        setActive(0);
        setSettled(q);
      });
    }, 220);
    return () => clearTimeout(t);
  }, [draft, search]);

  const addEmail = (email: string, name?: string): void => {
    const e = email.trim().toLowerCase();
    setDraft('');
    setHits([]);
    if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || list.includes(e)) return;
    if (name) setNames((m) => ({ ...m, [e]: name }));
    onChange([...list, e]);
  };
  const add = (): void => addEmail(draft);
  const noHit = !!search && !!draft.trim() && settled === draft.trim() && hits.length === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      {/* 초대된 사람 — 원본의 카드 행(아바타 + 이름 + 제외). */}
      {list.map((email, i) => (
        <span key={email} data-gf-guest={email} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 9px', borderRadius: 11, background: 'var(--mf-card)', border: '1px solid var(--mf-border-soft)', minWidth: 0 }}>
          <Avatar label={names[email] ?? email} i={i} />
          <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 700, color: 'var(--mf-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{names[email] ?? email}</span>
          <button type="button" aria-label={`${email} 초대 취소`} title="제외" className="mf-ctl" onClick={() => onChange(list.filter((e) => e !== email))} style={{ flex: '0 0 auto', width: 22, height: 22, border: 0, borderRadius: 999, background: 'transparent', color: 'var(--mf-faint)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </span>
      ))}

      <SearchBox
        label={search ? '참석자 이름 또는 이메일' : '참석자 이메일'}
        attrs={{ 'data-gf-guest-input': '1' }}
        value={draft}
        placeholder={search ? '이름 또는 이메일 검색' : '이메일을 적고 Enter'}
        onChange={setDraft}
        onBlur={() => {
          // 후보를 고르려는 클릭이 blur보다 먼저 오게 — 그래서 커밋은 미룬다.
          setTimeout(() => {
            setHits([]);
            setSettled('');
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
            const pick = hits[active];
            if (pick) addEmail(pick.email, pick.name);
            else add();
          }
        }}
      />

      {(hits.length > 0 || noHit) && (
        <div data-gf-guest-hits className="lnb-scroll" style={{ ...listCard, maxHeight: 186 }}>
          {hits.map((p, i) => {
            const added = list.includes(p.email);
            return (
              <button
                key={p.email}
                type="button"
                data-gf-guest-hit={p.email}
                data-active={i === active ? '1' : undefined}
                // mousedown으로 처리한다 — blur가 클릭을 삼키는 함정(서식 툴바에서 겪은 것).
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (!added) addEmail(p.email, p.name);
                }}
                onMouseEnter={() => setActive(i)}
                style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', border: 0, ...rowDivider(i), background: i === active ? 'var(--mf-panel2)' : 'transparent', cursor: added ? 'default' : 'pointer', font: 'inherit', textAlign: 'left', minWidth: 0, width: '100%', transition: 'background .12s ease' }}
              >
                <Avatar label={p.name} i={i} />
                <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: 1 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--mf-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                  <span style={{ fontSize: 10.5, color: 'var(--mf-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.email}</span>
                </span>
                {/* 이미 초대한 사람은 회색 `초대됨` — 눌러도 두 번 들어가지 않는다. */}
                <span style={{ flex: '0 0 auto', fontSize: 11, fontWeight: 700, color: added ? 'var(--mf-faint)' : 'var(--mf-accent-strong)', whiteSpace: 'nowrap' }}>{added ? '초대됨' : '초대'}</span>
              </button>
            );
          })}
          {noHit && <span style={{ padding: 10, fontSize: 11.5, color: 'var(--mf-faint)', ...rowDivider(hits.length) }}>일치하는 사람이 없어요 · Enter로 이메일 직접 초대</span>}
        </div>
      )}
    </div>
  );
}

/**
 * 회의실 — 원본의 검색 상자 + **늘 보이는 목록**(검색은 좁히기만 한다). 고른 회의실은
 * 그 행이 강조되고 `예약됨` 배지가 붙는다(원본의 그 상태) — 다시 누르면 취소.
 * 구글에서는 `resource: true`인 참석자로 저장되므로 **실제로 예약된다**.
 */
function Rooms({ all, picked, onChange }: { all: readonly MeetingRoom[]; picked: string[]; onChange: (next: string[]) => void }) {
  const [q, setQ] = useState('');
  const rows = q.trim() ? filterRooms(all, q) : [...all];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <SearchBox label="회의실 검색" attrs={{ 'data-gf-room-input': '1' }} value={q} placeholder="회의실 이름 또는 층 검색" onChange={setQ} />
      <div data-gf-room-list className="lnb-scroll" style={{ ...listCard, maxHeight: 196 }}>
        {rows.map((r, i) => {
          const on = picked.includes(r.email);
          const sub = [r.where, r.capacity ? `${r.capacity}인` : null].filter(Boolean).join(' · ');
          return (
            <button
              key={r.email}
              type="button"
              data-gf-room-hit={r.email}
              {...(on ? { 'data-gf-room': r.email } : {})}
              aria-pressed={on}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(on ? picked.filter((p) => p !== r.email) : [...picked, r.email]);
              }}
              className="mf-ctl"
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', border: 0, ...rowDivider(i), background: on ? 'var(--mf-accent-soft)' : 'transparent', cursor: 'pointer', font: 'inherit', textAlign: 'left', minWidth: 0, width: '100%', transition: 'background .12s ease' }}
            >
              <span style={{ width: 22, height: 22, flex: '0 0 auto', borderRadius: 7, background: on ? 'var(--mf-accent-mute)' : 'var(--mf-panel2)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                <RoomGlyph on={on} />
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: 1 }}>
                <span style={{ fontSize: 12, fontWeight: on ? 800 : 600, color: on ? 'var(--mf-accent-strong)' : 'var(--mf-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                {sub && <span style={{ fontSize: 10.5, color: 'var(--mf-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</span>}
              </span>
              {on && <span style={{ flex: '0 0 auto', height: 20, padding: '0 8px', borderRadius: 999, background: 'var(--mf-success-soft)', color: 'var(--mf-success-ink)', fontSize: 10, fontWeight: 700, display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>예약됨</span>}
            </button>
          );
        })}
        {rows.length === 0 && <span style={{ padding: 10, fontSize: 11.5, color: 'var(--mf-faint)' }}>검색 결과가 없어요</span>}
      </div>
    </div>
  );
}

/** 원본의 회의실(건물) 글리프 — 고른 행에서는 강조색으로. */
function RoomGlyph({ on }: { on?: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={on ? 'var(--mf-accent-strong)' : 'var(--mf-faint)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: '0 0 auto' }} aria-hidden="true">
      <path d="M4 20V6.5a1 1 0 0 1 .7-.95l9-2.7A1 1 0 0 1 15 3.8V20" />
      <path d="M15 9h4.3a1 1 0 0 1 1 1V20M3 20h18" />
      <path d="M11 12h.01" />
    </svg>
  );
}

/** Google Meet 카메라 글리프(원본) — Meet의 초록. */
function MeetGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#2E9E63" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.5" y="6.5" width="12" height="11" rx="2.2" />
      <path d="m14.5 11 6-3.4v8.8l-6-3.4z" />
    </svg>
  );
}

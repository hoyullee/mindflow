// 구글 일정 전용 필드 — 디자인 원본 `Geurio 일정 캘린더.dc.html`의 `nIsGoogle` 블록.
//
// **반복과 알림은 이 묶음에 없다** — 반복은 Geurio 일정도 하므로 왼쪽 열의
// `RecurrenceField`가 두 목적지에 함께 뜨고, 알림은 아래 `ReminderField`가 왼쪽 열에서
// 늘 보인다(요청 #5 — 목적지가 Geurio면 비활성 표식). 여기 남은 것은 구글만 할 수 있는 일이다.
//
// **왜 구글일 때만 뜨나**: 여기 있는 것들은 구글이 **실제로 처리해 주는 일**이다 —
// 초대 메일 발송(참석자), 알림, 바쁨/한가함(다른 사람이 내 시간을 볼 때), Meet 링크.
// 우리 표(0033)에는 그걸 보낼 장치가 없다.
//
// **참석자·회의실은 선택 스코프에 달려 있다.** 이름 검색은 People API
// (`directory.readonly`·`contacts.other.readonly`), 회의실은 Admin SDK
// (`admin.directory.resource.calendar.readonly`)다. 받지 못했으면(개인 계정에는
// 디렉터리가 없고, 회의실은 조직이 막을 수 있다) **이름 검색 없이 이메일 입력**으로
// 남는다. 회의실 구획은 **항상 보인다**(요청: 굳이 비노출할 필요 없다) — 다만 검색
// 상자·목록은 회의실이 실제로 있을 때만 그리고, 없으면 디자인 원본의 안내 한 줄
// (`회의실 목록은 조직 캘린더에서 불러와요`)이 그 자리를 지킨다. 그래서 목록 요청이
// 403으로 끝나도 구획이 사라지지 않는다(예전의 "잠깐 나타났다 사라지는" 깜빡임).
//
// 디자인 원본과 일부러 다르게 둔 것: 회의실의 `사용 가능/사용 중` 배지와 "선택한
// 시간에 비어 있는 회의실만" 문구 — 그 정보는 freebusy 조회(별도 스코프)에서 오는데
// 우리는 아직 받지 않으므로, 모르는 것을 아는 척 칠하지 않는다. 참석자의 필수/선택
// 전환도 아직 모델에 없어 두지 않았다.

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { knownName, knownNamesFor, rememberName } from './nameBook';
import { createPortal } from 'react-dom';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { Field, Segments, SubText } from './fieldBits';
import type { GoogleRsvp, GoogleTransparency, GoogleVisibility, RecurrenceSpec } from './googleCalendar';
import { filterRooms, type DirectoryPerson, type MeetingRoom, type RoomBusy } from './googleDirectory';

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
  /**
   * 그 일정에 지정할 **색 번호**(요청 — `colorId`). 색 고르기는 이 묶음이 아니라
   * 왼쪽 열에 있지만(알림과 같은 자리) 값은 **구글 전용**이라 여기 담긴다.
   */
  colorId?: string;
  /**
   * **내 참석 여부**(요청) — 내가 참석자로 초대돼 있을 때만 값이 있다. 없으면
   * (내가 만든 일정·초대받지 않은 일정) 그 구획을 그리지 않는다.
   */
  rsvp?: GoogleRsvp;
  /** 구글이 알려 준 표시 이름(email → 이름) — 없는 사람만 디렉터리에 묻는다. */
  names?: Record<string, string>;
}

/** 선택 스코프로 열리는 것들 — `useGoogleCalendar`가 이 모양으로 내준다. */
export interface GoogleDirectoryApi {
  canSearchPeople: boolean;
  searchPeople: (query: string) => Promise<DirectoryPerson[] | null>;
  canPickRooms: boolean;
  rooms: readonly MeetingRoom[];
  /** 회의실 조회가 끝났는가 — 거짓인 동안은 "불러오는 중"이다. */
  roomsReady: boolean;
  loadRooms: () => void;
  /**
   * 그 시간대에 그 회의실이 차 있는가(요청) — `busy` 사용 중 여부이고, 조직이 회의실
   * 캘린더를 공개해 두면 **누가 언제까지** 쓰는지도 함께 온다(요청 ③). `null`은
   * `null` 알 수 없음(조직이 그 캘린더를 공개하지 않음). 모르는 것은 칠하지 않는다.
   */
  checkRoomBusy?: (roomEmail: string, fromIso: string, toIso: string, skipEventId?: string) => Promise<RoomBusy | null>;
}

export interface GoogleFieldsChange {
  attendees?: string[];
  rooms?: string[];
  visibility?: GoogleVisibility;
  transparency?: GoogleTransparency;
  reminderMinutes?: number | null | undefined;
  recurrence?: RecurrenceSpec;
  addMeet?: boolean;
  rsvp?: GoogleRsvp;
}

const VIS_OPTS: { v: GoogleVisibility; label: string; note: string }[] = [
  { v: 'default', label: '기본', note: '' },
  { v: 'public', label: '공개', note: '캘린더를 공유한 모두가 상세를 볼 수 있어요' },
  { v: 'private', label: '비공개', note: '참석자에게만 제목이 보여요' },
];

/**
 * 참석 여부(요청) — 구글 캘린더의 세 답(참석·미정·불참)이다. `needsAction`은
 * **선택지가 아니라 상태**다: 아직 답하지 않았으면 아무 칸도 켜지지 않고 라벨 옆이
 * 그렇게 말한다(없는 답을 골라 둔 척하지 않는다).
 */
const RSVP_OPTS: { v: GoogleRsvp; label: string }[] = [
  { v: 'accepted', label: '참석' },
  { v: 'tentative', label: '미정' },
  { v: 'declined', label: '불참' },
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
  organizer,
  directory,
  when,
}: {
  value: GoogleFieldsValue;
  onChange: (patch: GoogleFieldsChange) => void;
  mode: 'create' | 'edit';
  meetLink?: string;
  /**
   * **이 일정을 만든 사람**(요청) — 내가 만든 일정이면 넘기지 않는다(자기 이름을
   * 한 줄 더 읽을 이유가 없다). 고칠 수 없는 값이라 초안이 아니라 프롭이다.
   */
  /**
   * 주최자 — `self`면 내가 만든 일정이라 "일정을 만든 사람" 행은 그리지 않지만,
   * 참석자 목록에서는 여전히 **빼고 센다**(내가 나를 초대한 것이 아니다).
   */
  organizer?: { email: string; name?: string; self?: true };
  /** 선택 스코프로 열리는 것들 — 없으면 이름 검색·회의실이 빠진다. */
  directory?: GoogleDirectoryApi;
  /**
   * 이 일정이 차지하는 구간(요청 ③) — 회의실 행이 "그 시간에 비어 있는가"를 말하는
   * 근거다. 초안이 바뀌면 함께 바뀌어야 한다(저장된 값만 보면 시간을 고치는 동안
   * 어긋난 답을 보여 준다).
   */
  when?: { fromIso: string; toIso: string; skipEventId?: string };
}) {
  // 회의실 목록은 이 묶음이 처음 열릴 때 한 번 받는다(왕복 1회). 스코프가 없으면
  // `loadRooms`가 스스로 "받을 것 없음"으로 끝낸다 — 조건은 그쪽 한 곳에 둔다.
  useEffect(() => {
    directory?.loadRooms();
  }, [directory]);
  const visNote = VIS_OPTS.find((o) => o.v === value.visibility)?.note ?? '';
  /**
   * 주최자 이름(제보) — 구글이 `displayName`을 주지 않는 계정도 있다. 그때는
   * **디렉터리에 그 주소로 한 번** 물어 이름을 얻는다(참석자 행과 같은 규칙).
   * 못 찾으면 로컬파트로 남는다 — 없는 이름을 지어내지 않는다.
   */
  const [orgName, setOrgName] = useState('');
  const orgEmail = organizer?.email ?? '';
  const orgKnown = organizer?.name ?? value.names?.[orgEmail] ?? knownName(orgEmail) ?? '';
  const askOrg = directory?.canSearchPeople ? directory.searchPeople : undefined;
  useEffect(() => {
    setOrgName('');
    if (!orgEmail || orgKnown || !askOrg) return;
    let alive = true;
    void askOrg(orgEmail).then((hits) => {
      const hit = (hits ?? []).find((h) => h.email === orgEmail);
      if (alive && hit?.name) setOrgName(hit.name);
    });
    return () => {
      alive = false;
    };
  }, [orgEmail, orgKnown, askOrg]);
  const orgLabel = orgKnown || orgName || guestLabel(orgEmail, {});
  const rooms = directory?.canPickRooms ? directory.rooms : [];
  const roomName = (email: string): string => rooms.find((r) => r.email === email)?.name ?? email;
  // 구획은 늘 보이고 **상태만 갈린다**: 목록 / 불러오는 중 / 안내(스코프 없음·거절·빈 목록).
  const roomsLoading = !!directory?.canPickRooms && !directory.roomsReady;
  // 참석자 목록에 보이는 사람 — 주최자(나 자신 포함)는 뺀다.
  const guests = orgEmail ? value.attendees.filter((e) => e.toLowerCase() !== orgEmail.toLowerCase()) : value.attendees;

  return (
    <div data-google-fields style={{ display: 'flex', flexDirection: 'column', gap: 19 }}>
      {/* **초대**(요청) — 구글 캘린더가 초대받은 일정에만 따로 보여 주는 둘이다:
          누가 불렀는가(고칠 수 없다)와 내 참석 여부(고친다). 설정이 아니라 이
          초대 자체에 대한 것이라 묶음 맨 위에 서고 아래와 선으로 갈린다. */}
      {(organizer && !organizer.self) || value.rsvp !== undefined ? (
        <div data-gf-invite style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: 17, borderBottom: '1px solid var(--mf-border-soft)' }}>
          {organizer && !organizer.self ? (
            <Field label="일정을 만든 사람">
              <span data-gf-organizer style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 9px', borderRadius: 11, background: 'var(--mf-card)', border: '1px solid var(--mf-border-soft)', minWidth: 0 }}>
                <Avatar label={orgLabel} i={0} />
                <span style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--mf-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{orgLabel}</span>
                  <span style={{ fontSize: 10.5, color: 'var(--mf-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{organizer.email}</span>
                </span>
              </span>
            </Field>
          ) : null}
          {value.rsvp !== undefined ? (
            <Field label="참석 여부" {...(value.rsvp === 'needsAction' ? { sub: '아직 응답하지 않았어요' } : {})}>
              <Segments
                aria="참석 여부"
                items={RSVP_OPTS.map((o) => ({ value: o.v, label: o.label }))}
                value={value.rsvp === 'needsAction' ? '' : value.rsvp}
                onChange={(v) => onChange({ rsvp: v as GoogleRsvp })}
                attr="data-gf-rsvp"
                wide
              />
            </Field>
          ) : null}
        </div>
      ) : null}

      {/* Google Meet — 디자인 원본의 **토글 카드**(아이콘 칩 + 상태 문구 + 스위치).
          **이미 등록된 일정에서도 켜고 끈다**(요청) — 예전에는 만들 때만 토글이고
          수정할 때는 링크만 보여 줘서, 회의 링크를 뒤늦게 붙이거나 뗄 길이 없었다.
          링크는 구글이 만들어 주므로 토글 아래에 **있을 때만** 따라 붙는다. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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
              {meetNote(mode, !!value.addMeet, !!meetLink)}
            </span>
          </span>
          {/* 스위치는 장식이다 — 켜짐/꺼짐은 카드 전체(aria-pressed)가 말한다. */}
          <span aria-hidden style={{ flex: '0 0 auto', width: 38, height: 22, borderRadius: 999, background: value.addMeet ? 'var(--mf-accent)' : 'var(--mf-scroll)', padding: 2, boxSizing: 'border-box', display: 'inline-flex', justifyContent: value.addMeet ? 'flex-end' : 'flex-start', transition: 'background .16s ease' }}>
            <span style={{ width: 18, height: 18, borderRadius: 999, background: '#FFFFFF', boxShadow: '0 1px 3px rgba(46,42,38,.3)', display: 'block' }} />
          </span>
        </button>
        {meetLink && value.addMeet ? (
          /* 원본 `nHasMeetLink` 행 — 링크는 등폭으로, 복사 버튼과 함께. */
          <span style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 12px', borderRadius: 12, background: 'var(--mf-card)', border: '1px solid var(--mf-border-soft)', minWidth: 0 }}>
            <span data-gf-meet-link style={{ flex: 1, minWidth: 0, fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5, color: 'var(--mf-accent-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meetLink}</span>
            <button type="button" className="mf-ctl" data-gf-meet-copy onClick={() => void navigator.clipboard?.writeText(meetLink).catch(() => undefined)} style={{ flex: '0 0 auto', whiteSpace: 'nowrap', height: 28, padding: '0 12px', borderRadius: 999, border: '1px solid var(--mf-border)', background: 'var(--mf-panel2)', color: 'var(--mf-accent-strong)', font: 'inherit', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>
              링크 복사
            </button>
          </span>
        ) : null}
      </div>

      {/* **일정을 만든 사람은 참석자 목록에서 뺀다**(요청) — 구글은 주최자도 참석자 배열에
          싣지만, 초대한 사람과 초대받은 사람은 다른 자리다. 배열 자체에서는 지우지
          않는다(PATCH가 배열을 통째로 바꾸므로 빼고 보내면 주최자가 참석자에서
          떨어진다) — 화면에서만 가르고, 고칠 때 제자리에 되돌려 넣는다. */}
      <Field label="참석자" sub={guestSub(guests.length, !!organizer && !organizer.self)}>
        <Attendees list={guests} onChange={(next) => onChange({ attendees: withOrganizer(value.attendees, orgEmail, next) })} seedNames={{ ...knownNamesFor(value.attendees), ...(value.names ?? {}) }} {...(directory?.canSearchPeople ? { search: directory.searchPeople } : {})} />
      </Field>

      {/* 회의실 — 구획은 **항상 보인다**(요청). 목록이 있으면 검색 + 목록, 아직이면
          "불러오는 중", 없으면(스코프 없음·조직 거절·등록 0) 디자인 원본의 안내 한 줄.
          목록이 있을 때의 안내 문구는 두지 않는다(제보 #4) — 검색 상자와 목록이
          이미 무엇을 하는 자리인지 말한다. 라벨 옆 요약은 **예약한 것**만 알린다. */}
      <Field label="회의실" {...(value.rooms.length ? { sub: `${value.rooms.map(roomName).join(' · ')} 예약됨` } : {})}>
        {rooms.length > 0 ? (
          <Rooms
          all={rooms}
          picked={value.rooms}
          onChange={(next) => onChange({ rooms: next })}
          {...(when && directory?.checkRoomBusy ? { when, check: directory.checkRoomBusy } : {})}
        />
        ) : roomsLoading ? (
          // 도착하기 전에는 **실제 목록과 같은 크기의 상자**에 스켈레톤 세 줄(요청 ①) —
          // 글자 한 줄로 두면 목록이 오는 순간 상자가 튄다.
          <RoomsLoading />
        ) : (
          <span data-gf-room-note style={{ padding: '10px 12px', borderRadius: 12, background: 'var(--mf-card)', border: '1px solid var(--mf-border-soft)', fontSize: 11.5, color: 'var(--mf-faint)', lineHeight: 1.6 }}>
            회의실 목록은 조직 캘린더에서 불러와요 — 이 계정에서는 불러올 회의실이 없어요.
          </span>
        )}
      </Field>

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
    </div>
  );
}

/**
 * 알림 — **목적지와 무관하게 왼쪽 열에 늘 보인다**(요청 #5). 예전에는 구글 전용
 * 묶음 안에 있어 Geurio를 고르면 통째로 사라졌다: 알림은 일정의 기본 속성으로
 * 읽히므로 "고를 수 있는 자리"가 사라지는 편이 더 혼란스럽다.
 *
 * 다만 **보내는 것은 구글이다** — 우리 표(0033)에는 알림을 띄울 장치가 없다. 그래서
 * 목적지가 Geurio면 같은 칩을 그리되 **비활성 표식**으로 두고 왜 그런지 한 줄로
 * 말한다(저장할 캘린더 줄의 비활성 칩과 같은 문법 — 눌리는 척하지 않는다).
 */
export function ReminderField({ value, onChange, disabled }: { value: number | null | undefined; onChange: (minutes: number | null | undefined) => void; disabled?: boolean }) {
  const key = REMIND_OPTS.find((o) => o.minutes === value)?.key ?? 'default';
  return (
    <Field label="알림">
      {disabled ? (
        <>
          <span data-gf-remind-off style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', opacity: 0.5 }}>
            {REMIND_OPTS.map((o) => (
              <span key={o.key} aria-disabled style={{ height: 30, padding: '0 12px', borderRadius: 999, border: '1px solid var(--mf-border)', background: 'var(--mf-card)', color: 'var(--mf-subtext)', fontSize: 12, fontWeight: o.key === 'default' ? 800 : 600, display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
                {o.label}
              </span>
            ))}
          </span>
          <SubText>Google 캘린더에 저장하면 알림을 함께 등록할 수 있어요</SubText>
        </>
      ) : (
        <Segments aria="알림" items={REMIND_OPTS.map((o) => ({ value: o.key, label: o.label }))} value={key} onChange={(k) => onChange(REMIND_OPTS.find((o) => o.key === k)?.minutes)} attr="data-gf-remind" wide />
      )}
    </Field>
  );
}

/** 디자인 원본의 아바타 팔레트(`AV`) — 행 순서대로 돌려 쓴다. */
const AV = ['#E8845C', '#7C9BD8', '#69B08A', '#C58AC0', '#D8A24F'];

/**
 * 초대된 사람의 **표시 이름** — 이름을 알면 그 이름, 모르면 **이메일 로컬파트**다
 * (이 앱의 프로필명 규칙과 같다: 저장된 이름 → 공급자 이름 → 로컬파트). 이름을
 * 모를 때도 행의 꼴이 후보 리스트와 같아진다(요청: 아바타 + 이름 + 이메일) —
 * 예전에는 이름을 모르면 이메일 한 줄만 남아 같은 사람이 자리마다 달라 보였다.
 */
export function guestLabel(email: string, names: Record<string, string>): string {
  const known = (names[email] ?? '').trim();
  if (known) return known;
  const at = email.indexOf('@');
  return at > 0 ? email.slice(0, at) : email;
}

/**
 * Meet 토글 카드의 한 줄 안내 — **지금 누르면 무슨 일이 일어나는지**를 말한다.
 * 이미 등록된 일정에서도 토글이 뜨므로(요청) 링크가 있는지에 따라 문장이 갈린다.
 */
export function meetNote(mode: 'create' | 'edit', on: boolean, hasLink: boolean): string {
  if (mode === 'create') return on ? '등록하면 회의 링크가 자동으로 만들어져요' : '켜면 초대장에 회의 링크가 함께 들어가요';
  if (on) return hasLink ? '회의 링크가 초대장에 들어가 있어요' : '저장하면 회의 링크가 만들어져요';
  return hasLink ? '저장하면 회의 링크가 사라져요' : '켜면 저장할 때 회의 링크가 만들어져요';
}

/** 참석자 구획 머리의 한 줄 — 주최자가 따로 있으면 "일정을 만든 사람 외 N명 초대"(요청). */
export function guestSub(n: number, hasOrganizer: boolean): string {
  if (n === 0) return hasOrganizer ? '일정을 만든 사람 외에 초대한 사람이 없어요' : '아직 초대한 사람이 없어요';
  return hasOrganizer ? `일정을 만든 사람 외 ${n}명 초대` : `${n}명 초대`;
}

/**
 * 화면에서 뺀 주최자를 배열의 **제자리에** 되돌려 넣는다 — 순서를 지켜야 "바뀐 것만
 * 보낸다"는 PATCH 판정이 주최자 자리 이동을 변경으로 오해하지 않는다.
 */
export function withOrganizer(original: readonly string[], orgEmail: string, guests: readonly string[]): string[] {
  if (!orgEmail) return [...guests];
  const idx = original.findIndex((e) => e.toLowerCase() === orgEmail.toLowerCase());
  if (idx < 0) return [...guests];
  const at = Math.min(idx, guests.length);
  return [...guests.slice(0, at), original[idx]!, ...guests.slice(at)];
}

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
 * 검색 상자 곁에 뜨는 **툴팁 리스트**(요청 — 참석자 후보가 팝업 안에서 자리를 차지해
 * 새 일정 팝업이 길어졌다). 일별 리스트 팝업과 같은 결: body 포털 + fixed, 실측해
 * 화면 안으로 당기고 아래가 모자라면 상자 위로 뒤집는다. 스크롤·리사이즈에 따라온다.
 */
function AnchoredList({ anchor, attrs, children }: { anchor: HTMLElement | null; attrs: Record<string, string>; children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const update = (): void => {
      const r = anchor?.getBoundingClientRect();
      const el = ref.current;
      if (!r || !el) return;
      const h = el.offsetHeight;
      const below = r.bottom + 6;
      const top = below + h + 8 > window.innerHeight ? Math.max(8, r.top - 6 - h) : below;
      setPos({ left: r.left, top, width: r.width });
    };
    update();
    window.addEventListener('resize', update);
    // 팝업 본문이 스크롤돼도 상자를 따라간다(캡처 — 스크롤러가 어느 층이든).
    document.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      document.removeEventListener('scroll', update, true);
    };
  }, [anchor, children]);
  return createPortal(
    <div
      ref={ref}
      {...attrs}
      className="lnb-scroll"
      style={{
        position: 'fixed',
        left: pos?.left ?? 0,
        top: pos?.top ?? 0,
        width: pos?.width ?? 240,
        // 첫 커밋(실측 전)의 프레임이 화면에 나가지 않게 — 자리가 서면 보인다.
        visibility: pos ? 'visible' : 'hidden',
        // **모달 위의 포털은 포인터를 되찾아야 한다**(제보 #9: hover도 스크롤도 초대도
        // 안 됐다). Radix Dialog가 열려 있는 동안 `document.body`는 `pointer-events:
        // none`이고, body 포털인 이 층은 그것을 상속한다(실측: `pointerEvents: 'none'`,
        // `elementFromPoint`가 후보 행을 집지 못함).
        pointerEvents: 'auto',
        zIndex: 400,
        boxSizing: 'border-box',
        maxHeight: 186,
        ...listCard,
        boxShadow: '0 18px 40px -18px rgba(46,42,38,.45), 0 2px 8px rgba(46,42,38,.08)',
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

/**
 * 초대 목록이 차지하는 **칸 수**(요청) — 셋까지는 사람이 그대로 서고, 넷부터는
 * 마지막 칸이 `외 N명`이 된다(둘 + 접힌 줄 = 세 칸).
 */
const ROWS_MAX = 3;

/** 이름 조회를 이만큼까지 기다린다 — 넘으면 아는 만큼 드러낸다(영원한 로딩 금지). */
const NAME_WAIT_MS = 4000;
/** 접힌 사람들을 배경에서 채울 때의 묶음 크기 — 한꺼번에 날리면 속도 제한에 걸린다. */
const NAME_BATCH = 4;

/** 이름을 채우는 중의 한 자리 — 실제 행과 같은 높이·모양(자리가 튀지 않게). */
function GuestSkeleton() {
  return (
    <span data-gf-guest-loading style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 9px', borderRadius: 11, background: 'var(--mf-card)', border: '1px solid var(--mf-border-soft)', minWidth: 0 }}>
      <span className="mf-skel" style={{ width: 24, height: 24, flex: '0 0 auto', borderRadius: 999 }} />
      <span style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: 1 }}>
        <span className="mf-skel" style={{ width: '42%', height: 9, borderRadius: 5 }} />
        <span className="mf-skel" style={{ width: '64%', height: 8, borderRadius: 5 }} />
      </span>
    </span>
  );
}

/**
 * 회의실 목록을 기다리는 동안의 한 자리 — **실제 행과 같은 높이·모양**이다(요청).
 *
 * 예전에는 "회의실 목록을 불러오는 중…" 한 줄이었는데, 그러면 목록이 도착하는 순간
 * 상자가 한 줄에서 세 줄로 튄다. 참석자 쪽(`GuestSkeleton`)과 같은 처방으로 자리를
 * 미리 잡아 두면 도착해도 화면이 움직이지 않는다.
 */
function RoomSkeleton() {
  return (
    <span data-gf-room-loading style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', minWidth: 0 }}>
      <span className="mf-skel" style={{ width: 22, height: 22, flex: '0 0 auto', borderRadius: 7 }} />
      <span style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: 1 }}>
        <span className="mf-skel" style={{ width: '46%', height: 9, borderRadius: 5 }} />
        <span className="mf-skel" style={{ width: '28%', height: 8, borderRadius: 5 }} />
      </span>
    </span>
  );
}

/**
 * 회의실 자리의 로딩 화면 — **목록을 기다릴 때와 상태를 기다릴 때가 같은 모습**이다.
 *
 * 둘을 갈라 두면 목록이 먼저 도착해 행이 그려지고 그다음 상태가 붙으면서 행이
 * `확인 중` → `사용 가능`/`사용 중`으로 재배치돼 **깜빡인다**(제보). 그래서 상태까지
 * 정해질 때까지 이 화면을 유지한다 — 검색 상자도 그동안 두지 않는다(걸러 볼 것이
 * 아직 없다).
 */
function RoomsLoading() {
  return (
    <div data-gf-room-list className="lnb-scroll" style={{ ...listCard, height: 3 * 42 + 2 }}>
      {[0, 1, 2].map((i) => (
        <RoomSkeleton key={i} />
      ))}
    </div>
  );
}

/**
 * 초대된 한 사람 — 아바타 + **이름·이메일** + 제외(요청). 이름을 모르는 주소(직접
 * 적은 것)는 주소 한 줄이다 — 같은 값을 두 줄로 되풀이하지 않는다. 후보 목록과 같은
 * 꼴이라 "고른 그 사람"이 그대로 남은 것으로 읽힌다.
 */
function GuestRow({ email, name, i, onRemove }: { email: string; name: string; i: number; onRemove: () => void }) {
  return (
    <span data-gf-guest={email} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 9px', borderRadius: 11, background: 'var(--mf-card)', border: '1px solid var(--mf-border-soft)', minWidth: 0 }}>
      <Avatar label={name} i={i} />
      <span style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--mf-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
        <span style={{ fontSize: 10.5, color: 'var(--mf-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email}</span>
      </span>
      <button type="button" aria-label={`${email} 초대 취소`} title="제외" className="mf-ctl" onClick={onRemove} style={{ flex: '0 0 auto', width: 22, height: 22, border: 0, borderRadius: 999, background: 'transparent', color: 'var(--mf-faint)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
    </span>
  );
}

/**
 * 참석자 — 원본의 검색 상자 + 후보 리스트(아바타·이름·이메일·`초대`) + 초대된 사람
 * 카드 행(두 줄까지, 나머지는 `외 N명` 툴팁). 이름 검색이 없으면(선택 스코프 미승인)
 * 이메일 직접 입력으로 남는다. 초대 메일은 구글이 보낸다.
 */
function Attendees({ list, onChange, search, seedNames }: { list: string[]; onChange: (next: string[]) => void; search?: (q: string) => Promise<DirectoryPerson[] | null>; seedNames?: Record<string, string> }) {
  const [draft, setDraft] = useState('');
  const [hits, setHits] = useState<DirectoryPerson[]>([]);
  const [active, setActive] = useState(0);
  // 후보 툴팁이 붙을 자리(검색 상자) — 상자를 감싸는 span의 실측 사각형을 쓴다.
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  // 마지막 검색이 **끝난** 질의 — "일치하는 사람이 없어요"가 검색 중에 깜빡이지 않게.
  const [settled, setSettled] = useState('');
  // 고른 후보의 이름 — 초대된 행이 이메일 대신 이름을 보여 준다(직접 적은 주소는 주소 그대로).
  const [names, setNames] = useState<Record<string, string>>({});
  /**
   * 아직 이름을 물어보는 중인 주소들(제보 ①) — 예전에는 이름을 모르는 사람을 **이메일
   * 앞부분으로 먼저 그리고** 답이 오는 대로 한 명씩 이름으로 바뀌어, 팝업을 열면 글자가
   * 차례로 갈리는 것이 보였다. 이제 **다 채워질 때까지 자리만 보여 주고**(스켈레톤)
   * 한 번에 드러낸다 — 이름은 이 목록의 정체라 반쯤 맞는 이름을 먼저 보여 줄 이유가 없다.
   */
  const [resolving, setResolving] = useState<string[]>([]);
  // 구글이 알려 준 이름이 **먼저**다(제보: 이름 대신 이메일 앞부분이 나왔다) —
  // 검색으로 찾은 이름은 그것이 없는 사람만 메운다.
  // 장부(`nameBook`)가 맨 뒤 — 이 일정이 준 이름·직접 고른 이름이 먼저고, 없으면
  // 다른 일정·다른 자리에서 알게 된 이름으로 메운다(제보: 같은 사람이 두 이름).
  const label = (email: string): string => guestLabel(email, { ...knownNamesFor([email]), ...names, ...seedNames });
  // 접힌 사람들(`외 N명`) 툴팁 — 여기서 지울 수 있어야 한다(요청).
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreAnchor, setMoreAnchor] = useState<HTMLElement | null>(null);
  // **셋까지는 그대로 보이고 넷부터 접힌다**(요청): 넷이면 둘 + `외 2명`으로 세 칸이다.
  // 접는 이유는 자리다 — 초대가 늘수록 팝업이 그만큼 길어져 아래 필드가 밀린다.
  const shown = list.length > ROWS_MAX ? list.slice(0, ROWS_MAX - 1) : list;
  const rest = list.slice(shown.length);
  // **보이는 줄만** 기다린다(제보: 초대가 많으면 스켈레톤이 너무 길다) — 접힌
  // 사람(`외 N명`)의 이름은 나중에 도착해도 그 줄에는 개수만 보이므로 첫 화면을
  // 붙잡아 둘 이유가 없다. 예전에는 목록 전체를 기다려, 열 명을 초대한 일정이면
  // 마지막 사람이 올 때까지(또는 4초 대기가 끝날 때까지) 두 줄이 자리표시자였다.
  const namesLoading = shown.length > 0 && resolving.some((e) => shown.includes(e));
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

  /**
   * **이미 등록된 참석자의 이름을 채운다**(요청) — 구글 일정이 돌려주는 참석자는
   * 이메일뿐이고 직접 적은 주소도 이름이 없다. 이름 검색을 쓸 수 있으면 그 사람의
   * 이메일로 한 번 물어 이름을 얻는다(디렉터리에 없으면 로컬파트로 남는다).
   * 이메일 하나에 **한 번만** 묻는다 — 없는 사람을 매 렌더 다시 찾지 않는다.
   */
  const askedRef = useRef<Set<string>>(new Set());
  const listKey = list.join(',');
  // 배열·객체는 렌더마다 새 참조라 효과의 계기가 될 수 없다 — 문자열 키로 되짚는다.
  const seedKey = Object.keys(seedNames ?? {}).join(',');
  // **답은 마운트되어 있는 동안 받는다**(제보 — 기존 일정의 참석자 일부가 영영 로컬파트).
  // 예전에는 효과별 `cancelled` 플래그였는데, 첫 사람의 이름이 도착해 상태가 바뀌는 순간
  // 효과가 다시 돌아 **진행 중인 루프를 취소**했고, 남은 사람들은 이미 "물어봤다"로
  // 적혀 다시 묻지도 않았다(회의실 배지에서 겪은 것과 같은 함정). 효과가 다시 돌아도
  // 이미 나간 조회는 끝까지 받아 적는다.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  // 보이는 줄(첫 두 명)은 **먼저, 나란히** 묻는다 — 그 답 하나만 오면 목록이 드러난다.
  const shownKey = shown.join(',');
  useEffect(() => {
    if (!search) return;
    // `list`가 아니라 문자열 키에서 되짚는다 — 배열은 렌더마다 새 참조라 이 효과의
    // 계기가 될 수 없고, 키가 바뀌는 순간이 곧 "초대가 늘거나 줄었다"다.
    // 구글이 이미 이름을 알려 준 사람은 묻지 않는다(왕복을 아끼고, 그 이름이 더 정확하다).
    const need = (e: string): boolean => !seedKey.includes(e) && !knownName(e) && !askedRef.current.has(e);
    const all = (listKey ? listKey.split(',') : []).filter(need);
    if (all.length === 0) return;
    // **보이는 사람이 먼저**(제보: 스켈레톤이 너무 길다). 접힌 사람들은 그 뒤에
    // 배경으로 채우고, 도착하면 `외 N명` 툴팁·얼굴이 그때 이름으로 바뀐다.
    const visible = shownKey ? shownKey.split(',') : [];
    const head = all.filter((e) => visible.includes(e));
    const tail = all.filter((e) => !visible.includes(e));
    for (const e of all) askedRef.current.add(e);
    // 자리표시자는 **보이는 줄**에만 세운다 — 접힌 사람을 여기 넣으면 그들 때문에
    // 첫 화면이 다시 붙잡힌다(`namesLoading`이 `shown`만 보므로 실제로는 무해하지만,
    // 뜻을 코드로 못박아 둔다).
    if (head.length > 0) setResolving((r) => [...new Set([...r, ...head])]);
    // 조회가 늦거나 응답이 오지 않아도 **영원히 로딩이지 않게** — 이 시간이 지나면
    // 아는 만큼 드러낸다(모르는 사람은 예전처럼 주소로 남는다).
    const bail = setTimeout(() => mountedRef.current && setResolving([]), NAME_WAIT_MS);
    /** 한 사람 — 답이 오면 이름을 적고 그 사람의 기다림을 끝낸다. */
    const one = async (email: string): Promise<void> => {
      const found = await search(email).catch(() => null);
      if (!mountedRef.current) return;
      // 디렉터리는 별칭으로 물어도 **기본 주소**로 답한다 — 그 사람의 모든 주소와 맞춰 본다.
      const want = email.toLowerCase();
      const hit = found?.find((p) => p.email.toLowerCase() === want || (p.emails ?? []).includes(want));
      if (hit?.name) {
        setNames((m) => ({ ...m, [email]: hit.name }));
        rememberName(email, hit.name);
      }
      setResolving((r) => r.filter((e) => e !== email));
    };
    void (async () => {
      // 보이는 둘은 한꺼번에 — 예전에는 목록 전체를 **한 명씩 차례로** 물어서
      // 열 명이면 왕복 열 번이 직렬로 쌓였다(그게 체감 지연의 정체다).
      await Promise.all(head.map(one));
      // 나머지는 네 명씩 — 한꺼번에 날리면 구글이 속도 제한으로 되돌려 보낸다
      // (회의실 조회와 같은 묶음 크기).
      for (let i = 0; i < tail.length; i += NAME_BATCH) {
        if (!mountedRef.current) return;
        await Promise.all(tail.slice(i, i + NAME_BATCH).map(one));
      }
    })();
    return () => clearTimeout(bail);
  }, [listKey, shownKey, search, seedKey]);

  // 접힌 목록은 바깥을 누르거나 Escape로 닫는다(팝오버의 관례 — 모달 위의 층이라
  // Radix가 대신 닫아 주지 않는다).
  useEffect(() => {
    if (!moreOpen) return;
    const close = (e: Event): void => {
      const t = e.target as Node | null;
      if (t && (moreAnchor?.contains(t) || (t as HTMLElement).closest?.('[data-gf-guest-list]'))) return;
      setMoreOpen(false);
    };
    // `KeyboardEvent`는 이 파일에서 리액트 타입으로 가려져 있다 — DOM 이벤트로 읽는다.
    const key = (e: Event): void => {
      if ((e as globalThis.KeyboardEvent).key === 'Escape') setMoreOpen(false);
    };
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', close, true);
      document.removeEventListener('keydown', key);
    };
  }, [moreOpen, moreAnchor]);

  const addEmail = (email: string, name?: string): void => {
    const e = email.trim().toLowerCase();
    setDraft('');
    setHits([]);
    if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || list.includes(e)) return;
    if (name) {
      setNames((m) => ({ ...m, [e]: name }));
      rememberName(e, name);
    }
    onChange([...list, e]);
  };
  const add = (): void => addEmail(draft);
  const noHit = !!search && !!draft.trim() && settled === draft.trim() && hits.length === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <span ref={setAnchor} style={{ display: 'block', minWidth: 0 }}>
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

      </span>

      {/* 후보는 팝업 안의 상자가 아니라 **검색 상자 곁에 뜨는 툴팁**이다(요청 —
          상자로 두면 후보 수만큼 새 일정 팝업이 길어졌다). */}
      {(hits.length > 0 || noHit) && (
        <AnchoredList anchor={anchor} attrs={{ 'data-gf-guest-hits': '1' }}>
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
        </AnchoredList>
      )}

      {/* 초대된 사람 — **검색 상자 아래**에 쌓인다(요청: 회의실과 같은 순서로).
          원본의 카드 행(아바타 + 이름·이메일 + 제외)이고, 셋까지는 그대로 보이다
          넷부터 마지막 칸이 `외 N명`으로 접힌다. 접힌 사람은 그 줄을 눌러 뜨는
          툴팁에서 보고 지운다. */}
      {namesLoading
        ? // 이름을 채우는 중 — 같은 크기의 자리만 둔다(글자가 하나씩 갈리는 것보다 낫다).
          shown.map((email) => <GuestSkeleton key={email} />)
        : shown.map((email, i) => (
            <GuestRow key={email} email={email} name={label(email)} i={i} onRemove={() => onChange(list.filter((e) => e !== email))} />
          ))}
      {rest.length > 0 && (
        <>
          <button
            type="button"
            ref={setMoreAnchor}
            data-gf-guest-more
            aria-expanded={moreOpen}
            className="mf-ctl"
            onClick={() => setMoreOpen((v) => !v)}
            style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 9px', borderRadius: 11, background: 'var(--mf-card)', border: '1px solid var(--mf-border-soft)', minWidth: 0, font: 'inherit', cursor: 'pointer', textAlign: 'left' }}
          >
            {/* 접힌 사람들의 얼굴을 겹쳐 보여 준다 — 몇 명인지 숫자로도 함께. */}
            <span aria-hidden style={{ display: 'inline-flex', flex: '0 0 auto', paddingRight: Math.min(rest.length, 3) > 1 ? 7 : 0 }}>
              {rest.slice(0, 3).map((email, i) => (
                <span key={email} style={{ marginLeft: i === 0 ? 0 : -7, borderRadius: 999, boxShadow: '0 0 0 2px var(--mf-card)', display: 'inline-flex' }}>
                  <Avatar label={label(email)} i={shown.length + i} />
                </span>
              ))}
            </span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 700, color: 'var(--mf-subtext)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>외 {rest.length}명</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--mf-faint)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: '0 0 auto', transform: moreOpen ? 'rotate(180deg)' : 'none', transition: 'transform .14s ease' }}>
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
          {moreOpen && (
            <AnchoredList anchor={moreAnchor} attrs={{ 'data-gf-guest-list': '1' }}>
              {list.map((email, i) => (
                <span key={email} data-gf-guest-item={email} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', minWidth: 0, ...rowDivider(i) }}>
                  <Avatar label={label(email)} i={i} />
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--mf-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label(email)}</span>
                    <span style={{ fontSize: 10.5, color: 'var(--mf-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email}</span>
                  </span>
                  <button
                    type="button"
                    aria-label={`${email} 초대 취소`}
                    title="제외"
                    className="mf-ctl"
                    onClick={() => {
                      const next = list.filter((e) => e !== email);
                      onChange(next);
                      // 접을 것이 없어지면(셋 이하) 툴팁도 함께 닫는다.
                      if (next.length <= ROWS_MAX) setMoreOpen(false);
                    }}
                    style={{ flex: '0 0 auto', width: 22, height: 22, border: 0, borderRadius: 999, background: 'transparent', color: 'var(--mf-faint)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                      <path d="M6 6l12 12M18 6 6 18" />
                    </svg>
                  </button>
                </span>
              ))}
            </AnchoredList>
          )}
        </>
      )}
    </div>
  );
}

/** 한 번에 확인할 회의실 수 — 구글의 속도 제한을 넘지 않게 이어 달린다. */
const ROOM_ASK_LIMIT = 4;
/** 확인할 회의실 상한 — 아주 많은 조직에서는 보이는·검색된 앞쪽부터 채운다. */
const ROOM_ASK_MAX = 60;
/**
 * 상태를 이만큼까지 기다린다 — 넘으면 아는 만큼 드러낸다(영원한 로딩 금지, 이름
 * 조회의 `NAME_WAIT_MS`와 같은 처방). 회의실이 많은 조직에서는 네 개씩 이어 달리는
 * 왕복이 길어질 수 있어서 목록을 영영 감춰 두지 않는다.
 */
const ROOM_WAIT_MS = 4000;

/**
 * 회의실 — 원본의 검색 상자 + **늘 보이는 목록**(검색은 좁히기만 한다). 고른 회의실은
 * 그 행이 강조되고 `예약됨` 배지가 붙는다(원본의 그 상태) — 다시 누르면 취소.
 * 구글에서는 `resource: true`인 참석자로 저장되므로 **실제로 예약된다**.
 */
function Rooms({
  all,
  picked,
  onChange,
  when,
  check,
}: {
  all: readonly MeetingRoom[];
  picked: string[];
  onChange: (next: string[]) => void;
  when?: { fromIso: string; toIso: string; skipEventId?: string };
  check?: (roomEmail: string, fromIso: string, toIso: string, skipEventId?: string) => Promise<RoomBusy | null>;
}) {
  const [q, setQ] = useState('');
  /**
   * **그 시간에 비어 있는가**(요청 ③) — 구글 캘린더는 달력에 겹쳐 보여 주지만 우리는
   * 팝업이라 그럴 자리가 없다. 그래서 회의실 행 자체가 말한다.
   *
   * `undefined` 아직 확인 안 함 / `true` 사용 중 / `false` 사용 가능 / `null` 알 수
   * 없음(조직이 그 캘린더를 공개하지 않음) — **모르는 것은 칠하지 않는다**.
   *
   * 왕복을 아끼려고 **보이는 행 + 예약한 회의실**만 묻고, `이메일|구간`으로 기억한다
   * (시간을 고치면 구간이 바뀌므로 그때는 다시 묻는다).
   */
  const [busy, setBusy] = useState<Record<string, RoomBusy | null>>({});
  // 예약한 회의실이 **맨 위**로 온다(제보 #17) — 목록이 길면 고른 것이 스크롤 아래로
  // 숨어 무엇을 잡아 뒀는지 보이지 않는다. 안에서는 원래 순서를 지킨다(안정 정렬).
  const rows = (q.trim() ? filterRooms(all, q) : [...all]).slice().sort((a, b) => Number(picked.includes(b.email)) - Number(picked.includes(a.email)));
  // 박스 높이는 **전체 목록 기준으로 고정**한다(요청) — 검색으로 행이 줄어도 박스가
  // 오르내리지 않고, 결과는 그 안에서 스크롤·빈 안내로만 갈린다(팝업 높이도 흔들리지
  // 않아 크기 애니메이션이 검색마다 돌지 않는다). 행 높이 ≈ 42px(패딩 9×2 + 내용 24).
  // **세 줄까지**(제보 #4) — 넷을 보여 주면 팝업이 그만큼 길어진다.
  const boxH = Math.min(3 * 42 + 2, all.length * 42 + 2);
  // **목록 전부**를 확인한다(제보 — 첫 세 줄만 배지가 붙어, 스크롤한 회의실은 비어
  // 있는지 알 수 없었고 검색해야 그때 붙었다). 왕복은 두 가지로 묶는다: 한 번에 네
  // 개까지만 날리고(`ROOM_ASK_LIMIT`), 회의실이 아주 많은 조직에서는 `rows` 순서로
  // 앞의 60개까지(검색하면 그 결과가 곧 앞이라 찾는 회의실은 언제나 들어온다).
  const askOrder = when ? [...new Set([...picked, ...rows.map((r) => r.email)])].slice(0, ROOM_ASK_MAX) : [];
  const askKey = askOrder.join(',');
  const from = when?.fromIso ?? '';
  const to = when?.toIso ?? '';
  const skip = when?.skipEventId;
  // 이미 물어본 조합은 다시 묻지 않는다 — 답을 상태로 들고 그 상태를 효과의 의존성에
  // 넣으면 답이 올 때마다 효과가 다시 돌아 끝이 없다(참석자 이름 조회와 같은 처방).
  const askedRef = useRef<Set<string>>(new Set());
  // **답은 마운트되어 있는 동안만** 받는다 — 효과가 다시 도는 것(확인 함수의 참조가
  // 바뀌는 것만으로도 돈다)과 언마운트는 다르다. 예전에는 효과별 `alive`로 막아서,
  // 답이 오기 전에 효과가 한 번만 다시 돌면 **이미 물어본 조합**이라 다시 묻지도
  // 않고 결과도 버려져 배지가 영영 뜨지 않았다(테스트가 잡았다).
  // 답은 `이메일|구간`으로 저장하므로 늦게 와도 엉뚱한 자리에 쓰이지 않는다.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  useEffect(() => {
    if (!check || !askKey || !from || !to) return;
    const emails = askKey.split(',').filter(Boolean);
    let stop = false;
    const t = setTimeout(() => {
      // 네 개씩 **이어 달린다** — 수십 개를 한꺼번에 날리면 구글이 속도 제한으로
      // 되돌려 보내 배지가 통째로 빈다. 앞의 것부터라 보이는 줄이 먼저 채워지고,
      // 답이 오는 대로 그 자리에 붙는다.
      let i = 0;
      const next = (): void => {
        if (stop) return;
        const email = emails[i];
        i += 1;
        if (email === undefined) return;
        const key = `${email}|${from}|${to}`;
        // 이미 물어본 조합은 건너뛴다(검색을 치면 순서가 바뀌어 효과가 다시 돈다).
        if (askedRef.current.has(key)) {
          next();
          return;
        }
        askedRef.current.add(key);
        void check(email, from, to, skip).then((r) => {
          if (mountedRef.current) setBusy((m) => ({ ...m, [key]: r }));
          next();
        });
      };
      for (let k = 0; k < ROOM_ASK_LIMIT; k += 1) next();
    }, 250);
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, [askKey, check, from, to, skip]);
  const busyOf = (email: string): RoomBusy | null | undefined => (when ? busy[`${email}|${from}|${to}`] : undefined);
  /** 묶음·배지가 보는 것은 "차 있는가"뿐이다 — 세부(누가·언제)는 고른 행만 쓴다. */
  const busyFlag = (email: string): boolean | null | undefined => {
    const r = busyOf(email);
    return r === undefined ? undefined : r === null ? null : r.busy;
  };
  // **사용 가능 / 사용 중을 갈라 보여 준다**(요청) — 가능한 방이 먼저다. 아직 답이 안 온
  // 방과 물어볼 수 없는 방(403)은 그 사이 어디에도 끼우지 않고 **뒤의 제 묶음**에 둔다:
  // "모르는 것은 칠하지 않는다"의 목록 판이다(가능하다고 올려 두면 거짓말이 된다).
  // 묶음 안에서는 예약한 방이 위(제보 #17 — 잡아 둔 것이 스크롤 아래로 숨지 않게).
  const groups = when ? groupRooms(rows, busyFlag) : [{ key: 'all' as const, label: '', rooms: rows }];
  // 사용 중인 방을 눌렀다 — **바로 고르지 않고** 한 번 묻는다(요청 ②). 그 방을 쓰는
  // 일정이 무엇인지 그 자리에서 보여 주므로, 겹쳐 잡는 것이 의도인지 사용자가 안다.
  // 이미 고른 방을 **빼는** 클릭은 묻지 않는다(잃을 것이 없다).
  const [confirm, setConfirm] = useState<string | null>(null);
  // 목록은 세 줄 상자라 물음이 접힌 자리에서 열릴 수 있다 — 그 자리로 민다(이미 다
  // 보이면 아무것도 움직이지 않는다: `block: 'nearest'`).
  const askRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    // `?.` — jsdom에는 `scrollIntoView`가 없다(테스트에서 던진다, CommentPanel과 같은 처방).
    if (confirm) askRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [confirm]);
  // 구간이 바뀌면 답이 달라지므로 물어보던 것을 접는다(옛 답으로 묻고 있게 두지 않는다).
  useEffect(() => setConfirm(null), [from, to]);
  const pick = (email: string): void => {
    setConfirm(null);
    onChange(picked.includes(email) ? picked.filter((p) => p !== email) : [...picked, email]);
  };
  /**
   * **상태까지 정해질 때까지 스켈레톤**(제보: 목록이 먼저 뜨고 상태가 붙으면서 행이
   * 재배치돼 깜빡인다). 아직 답이 없는 행이 하나라도 있으면 기다린다.
   *
   * 한 번 드러낸 뒤에는 **다시 감추지 않는다**(`revealed`) — 시간을 고치면 구간이
   * 바뀌어 상태를 다시 묻는데, 그때마다 목록이 사라지면 방금 보던 자리를 잃는다.
   * 그 뒤의 갱신은 각 행의 배지가 제자리에서 바꿔 말한다.
   */
  // 판정 대상은 **우리가 실제로 묻는 것**(`askOrder`)이다 — 회의실이 아주 많은
  // 조직에서 상한(60) 밖의 행은 영영 답이 없으므로, 그걸 기다리면 스켈레톤이
  // 시간 제한까지 남는다.
  const pendingStatus = !!when && !!check && askOrder.some((e) => busy[`${e}|${from}|${to}`] === undefined);
  const [revealed, setRevealed] = useState(!pendingStatus);
  useEffect(() => {
    if (!pendingStatus) setRevealed(true);
  }, [pendingStatus]);
  useEffect(() => {
    const t = setTimeout(() => setRevealed(true), ROOM_WAIT_MS);
    return () => clearTimeout(t);
  }, []);
  // 상자 높이는 **세 줄 고정**이다(검색으로 행이 줄어도 팝업이 오르내리지 않게 —
  // #68). 다만 우리가 여는 블록(사용 중 두 줄·겹쳐 예약 확인)은 그 안에서 잘리면
  // 정작 읽어야 할 내용이 가려지므로, 열려 있는 동안만 그 몫을 더한다. 둘 다 검색과
  // 무관하게 열리므로 "검색해도 안 흔들린다"는 성질은 그대로다.
  const openExtra = (confirm ? 92 : 0) + (rows.some((r) => picked.includes(r.email) && busyOf(r.email)?.busy) ? 54 : 0);
  if (!revealed) return <RoomsLoading />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <SearchBox label="회의실 검색" attrs={{ 'data-gf-room-input': '1' }} value={q} placeholder="회의실 이름 또는 층 검색" onChange={setQ} />
      <div data-gf-room-list className="lnb-scroll" style={{ ...listCard, height: boxH + openExtra }}>
        {groups.map((g, gi) => (
          <div key={g.key} data-gf-room-group={g.key}>
            {g.label && (
              <div style={{ padding: gi === 0 ? '7px 11px 3px' : '9px 11px 3px', fontSize: 10.5, fontWeight: 800, letterSpacing: '.04em', color: g.key === 'busy' ? 'var(--mf-danger)' : g.key === 'free' ? 'var(--mf-success-ink)' : 'var(--mf-faint)', ...(gi === 0 ? {} : { borderTop: '1px solid var(--mf-border-soft)' }) }}>
                {g.label} <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, opacity: 0.8 }}>{g.rooms.length}</span>
              </div>
            )}
        {g.rooms.map((r, i) => {
          const on = picked.includes(r.email);
          const sub = [r.where, r.capacity ? `${r.capacity}인` : null].filter(Boolean).join(' · ');
          // 사용 중인 방은 **이름에 취소선**(요청) — 묶음 머리·배지와 함께 세 겹으로
          // "이 시간엔 못 쓴다"를 말한다. 그래도 고를 수는 있다(회의실 정책상
          // 겹쳐 잡는 일이 있고, 우리가 대신 막을 근거는 없다).
          const info = busyOf(r.email);
          const busyRow = info?.busy === true;
          // **누가 쓰고 있는지**(요청 ③) — 고른 행에는 **아래 전폭 두 줄**로 펴고,
          // 아직 고르지 않은 사용 중인 행에는 툴팁 한 줄로 둔다(목록에 줄을 늘리지
          // 않는다). 조직이 "한가함/바쁨만" 공개하면 이름·제목이 없어 시각만 남는다.
          const busyWho = busyRow ? roomBusyLabel(info) : '';
          const busyLines = roomBusyLines(info);
          return (
            <Fragment key={r.email}>
            <button
              type="button"
              {...(busyWho && !on ? { title: busyWho } : {})}
              data-gf-room-hit={r.email}
              {...(on ? { 'data-gf-room': r.email } : {})}
              aria-pressed={on}
              onMouseDown={(e) => {
                e.preventDefault();
                // 사용 중인 방을 새로 고르려는 클릭만 되묻는다(요청 ②).
                if (busyRow && !on) {
                  setConfirm(confirm === r.email ? null : r.email);
                  return;
                }
                pick(r.email);
              }}
              className="mf-ctl"
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', border: 0, ...rowDivider(g.label ? i + 1 : i), background: on ? 'var(--mf-accent-soft)' : 'transparent', cursor: 'pointer', font: 'inherit', textAlign: 'left', minWidth: 0, width: '100%', transition: 'background .12s ease' }}
            >
              <span style={{ width: 22, height: 22, flex: '0 0 auto', borderRadius: 7, background: on ? 'var(--mf-accent-mute)' : 'var(--mf-panel2)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                <RoomGlyph on={on} />
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: 1 }}>
                <span data-gf-room-name style={{ fontSize: 12, fontWeight: on ? 800 : 600, color: on ? 'var(--mf-accent-strong)' : 'var(--mf-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', ...(busyRow ? { textDecoration: 'line-through', textDecorationColor: 'var(--mf-danger)' } : {}) }}>{r.name}</span>
                {sub && <span style={{ fontSize: 10.5, color: 'var(--mf-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</span>}

              </span>
              <RoomState on={on} busy={busyFlag(r.email)} />
            </button>
            {/* 고른 방이 사용 중이면 **행 아래 전폭**으로 두 줄(요청 ②) — 행 안에
                한 줄로 두면 아이콘·배지에 눌려 말줄임으로 잘린다. */}
            {on && busyWho && (
              <span data-gf-room-busy style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '0 11px 9px 43px', background: 'var(--mf-accent-soft)', fontSize: 11, lineHeight: 1.5, minWidth: 0 }}>
                <span style={{ fontWeight: 800, color: 'var(--mf-danger)' }}>{busyLines.head}</span>
                {busyLines.detail && <span style={{ color: 'var(--mf-subtext)' }}>{busyLines.detail}</span>}
              </span>
            )}
            {/* 확인 단계(요청 ②) — 팝업을 하나 더 띄우지 않고 **그 행 아래**에서 묻는다:
                모달 위에 모달을 얹으면 무엇을 고르던 중인지 흐려진다. */}
            {confirm === r.email && (
              <div ref={askRef} data-gf-room-confirm={r.email} style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: '9px 11px 11px 43px', background: 'var(--mf-danger-bg)', borderTop: '1px solid var(--mf-border-soft)' }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--mf-danger)', lineHeight: 1.5 }}>{busyWho || '사용 중'}</span>
                <span style={{ fontSize: 11.5, color: 'var(--mf-subtext)', lineHeight: 1.5 }}>이미 사용 중인 회의실이에요. 그래도 예약할까요?</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <button
                    type="button"
                    data-gf-room-confirm-yes
                    className="mf-ctl"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pick(r.email);
                    }}
                    style={{ height: 28, padding: '0 12px', borderRadius: 999, border: '1px solid var(--mf-danger-line)', background: 'var(--mf-card)', color: 'var(--mf-danger)', font: 'inherit', fontSize: 11.5, fontWeight: 800, cursor: 'pointer' }}
                  >
                    그래도 예약
                  </button>
                  <button
                    type="button"
                    data-gf-room-confirm-no
                    className="mf-ctl"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setConfirm(null);
                    }}
                    style={{ height: 28, padding: '0 12px', borderRadius: 999, border: '1px solid var(--mf-border)', background: 'var(--mf-card)', color: 'var(--mf-muted)', font: 'inherit', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}
                  >
                    취소
                  </button>
                </span>
              </div>
            )}
            </Fragment>
          );
        })}
          </div>
        ))}
        {rows.length === 0 && <span style={{ padding: 10, fontSize: 11.5, color: 'var(--mf-faint)' }}>검색 결과가 없어요</span>}
      </div>
    </div>
  );
}

/**
 * 사용 중인 회의실의 한 줄 — `사용 중 · 홍길동 · 팀 회의 · 14:00–15:00`.
 *
 * 아는 것만 잇는다: 조직이 회의실 캘린더를 "한가함/바쁨만" 공개하면 제목·주최자가
 * 없이 시각만 오고, 아무것도 없으면 `사용 중`만 남는다(없는 것을 지어내지 않는다).
 */
export function roomBusyLabel(info: RoomBusy | null | undefined): string {
  if (!info?.busy) return '';
  const when = info.from && info.to ? `${info.from}–${info.to}` : (info.from ?? '');
  return ['사용 중', info.by, info.title, when].filter(Boolean).join(' · ');
}

/**
 * 같은 정보를 **두 줄**로 — 고른 회의실 아래에 펴서 보여 줄 때 쓴다(요청 ②).
 *
 * 한 줄로 두면 좁은 행에서 말줄임으로 잘려 정작 "누가 쓰는지"가 사라진다. 그래서
 * 첫 줄은 **누가**, 둘째 줄은 **언제·무엇**이다. 조직이 회의실 캘린더를 "한가함/
 * 바쁨만"으로 공개하면 이름·제목이 없어 시각만 남는다 — 없는 것은 지어내지 않고
 * 그 줄을 통째로 비운다(호출부가 빈 문자열이면 그리지 않는다).
 */
export function roomBusyLines(info: RoomBusy | null | undefined): { head: string; detail: string } {
  if (!info?.busy) return { head: '', detail: '' };
  const when = info.from && info.to ? `${info.from}–${info.to}` : (info.from ?? '');
  return {
    head: ['사용 중', info.by].filter(Boolean).join(' · '),
    detail: [when, info.title].filter(Boolean).join(' '),
  };
}

export type RoomGroupKey = 'free' | 'busy' | 'pending' | 'unknown' | 'all';

/**
 * 회의실을 **사용 가능 → 사용 중 → 확인 중 → 확인 불가** 순으로 묶는다(요청 — 가능한
 * 방이 먼저). 빈 묶음은 그리지 않는다. 순수 함수라 테스트가 그대로 부른다.
 */
export function groupRooms<T extends { email: string }>(rows: readonly T[], busyOf: (email: string) => boolean | null | undefined): { key: RoomGroupKey; label: string; rooms: T[] }[] {
  const free: T[] = [];
  const busy: T[] = [];
  const pending: T[] = [];
  const unknown: T[] = [];
  for (const r of rows) {
    const b = busyOf(r.email);
    (b === false ? free : b === true ? busy : b === null ? unknown : pending).push(r);
  }
  return [
    { key: 'free' as const, label: '사용 가능', rooms: free },
    { key: 'busy' as const, label: '사용 중', rooms: busy },
    { key: 'pending' as const, label: '확인 중', rooms: pending },
    { key: 'unknown' as const, label: '확인할 수 없음', rooms: unknown },
  ].filter((g) => g.rooms.length > 0);
}

/**
 * 회의실 행의 오른쪽 배지 — **한 자리에 한 마디**만 쓴다. 순서는 중요도다:
 * 사용 중(충돌) > 예약됨 > 사용 가능. 고른 행은 이미 강조색 면이 "잡아 뒀다"고
 * 말하므로, 충돌이 있으면 그 사실을 먼저 알리는 편이 맞다.
 * 모르는 것(`null`·아직)은 아무 말도 하지 않는다.
 */
function RoomState({ on, busy }: { on: boolean; busy: boolean | null | undefined }) {
  const pill = (bg: string, fg: string, text: string, attr: string) => (
    <span data-gf-room-state={attr} style={{ flex: '0 0 auto', height: 20, padding: '0 8px', borderRadius: 999, background: bg, color: fg, fontSize: 10, fontWeight: 700, display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
      {text}
    </span>
  );
  // 겹쳐 잡은 방은 **두 사실을 함께** 말한다(요청 ② — 확인을 거쳐 고른 뒤에도 그냥
  // `사용 중`이면 내가 잡았다는 사실이 사라지고, `예약됨`이면 겹친 사실이 사라진다).
  if (on && busy === true) return pill('var(--mf-danger-bg)', 'var(--mf-danger)', '겹쳐 예약', 'booked-busy');
  if (busy === true) return pill('var(--mf-danger-bg)', 'var(--mf-danger)', '사용 중', 'busy');
  if (on) return pill('var(--mf-success-soft)', 'var(--mf-success-ink)', '예약됨', 'booked');
  if (busy === false) return pill('var(--mf-success-soft)', 'var(--mf-success-ink)', '사용 가능', 'free');
  return null;
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

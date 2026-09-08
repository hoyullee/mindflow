// 설정 → 계정 설정 → **캘린더 연동** 구획(PR5). 구글 캘린더를 일정 화면에 겹쳐
// 볼지 정하고, 무엇을 보여 줄지 고르고, 공휴일 국가를 정한다. 구획 제목("캘린더
// 연동")은 호출부가 달고 이 컴포넌트는 카드들만 그린다(첨부 이미지).
//
// 이 구획의 규칙 넷:
//  ① 배포에 구글 클라이언트 ID가 없으면 **그리지 않는다** — 눌러도 아무 일 없는
//     버튼을 두지 않는다(이 프로젝트의 정직한 어포던스 규칙).
//  ② 켜는 것은 사용자가 **직접 누를 때만**이다(동의 창이 그때 뜬다). 화면을 여는
//     것만으로 팝업이 뜨면 브라우저가 막고, 사용자도 놀란다.
//  ③ 카드의 색이 상태를 말한다 — 연결 전은 강조색 틴트 + 코랄 `연결하기`, 연결
//     뒤는 초록 틴트 + 중립 `해제`(그리고 그 아래에 보여 줄 캘린더 목록이 열린다).
//  ④ 스코프를 넓힌 뒤 옛 토큰이 남으면 **다시 연결**을 권한다 — 켜져 있는데 저장이
//     안 되는 상태를 조용히 두지 않는다.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { GoogleCalendarApi } from '../../calendar/useGoogleCalendar';
import type { DirectoryPerson } from '../../calendar/googleDirectory';
import { HOLIDAY_COUNTRIES, HOLIDAY_OFF, isManagedHolidayId, type HolidayCountry } from '../../calendar/googleCalendar';
import { Segmented } from '../../../../components/Segmented';
import { SectionLabel, SettingsGroup } from './AccountSettingsModal';

export function GoogleCalendarSection({ api }: { api: GoogleCalendarApi }) {
  if (!api.available) return null;
  // 연결은 돼 있는데 토큰이 없으면(재로그인 뒤) "불러오는 중"이 아니다 — 다시 연결해야
  // 목록이 온다(제보: 창을 닫아도 "캘린더를 불러오는 중…"이 그대로 남았다).
  const live = api.enabled && api.connected && !api.needsReauth;
  // 구글 계정 이메일은 **기본 캘린더의 id**다(구글이 그렇게 만든다) — 우리 앱의
  // 로그인 이메일과 다를 수 있으므로 그걸 쓰지 않는다.
  const account = api.calendars.find((c) => c.primary)?.id ?? '';
  const ym = monthKey();
  const monthly = api.events.filter((e) => e.startDate.startsWith(ym)).length;
  // 공휴일 캘린더(우리 표의 세 나라)는 이 목록에 두지 않는다 — 그 자리는 아래
  // **공휴일 국가** 세그먼트가 맡는다(제보: 같은 결정을 두 곳에서 하게 되어 있어
  // 공휴일이 두 번 표시되는 것처럼 보였다). 우리 표에 없는 공휴일 캘린더(예: 사용자가
  // 주소로 더한 `en.south_korea#holiday`)는 평범한 행으로 남는다 — 세그먼트가 관리하지
  // 않으므로 그것을 켜고 끄는 곳이 여기뿐이다.
  const rows = api.calendars.filter((c) => !isManagedHolidayId(c.id));
  // 개수는 **보이는 행** 기준이다 — 목록에 없는 공휴일 캘린더까지 세면 숫자와
  // 눈에 보이는 것이 어긋난다.
  const shown = rows.filter((c) => api.pickedIds.includes(c.id)).length;
  return (
    <>
      <div
        data-google-section
        data-google-live={live ? '1' : undefined}
        style={{ borderRadius: 16, border: '1px solid var(--mf-border-soft)', background: live ? 'var(--mf-success-soft)' : 'var(--mf-accent-soft)', overflow: 'hidden' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '14px 15px' }}>
          <span aria-hidden="true" style={{ flexShrink: 0, width: 38, height: 38, borderRadius: 12, background: 'var(--mf-card)', border: '1px solid var(--mf-border-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <GoogleCalendarGlyph />
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14.5 }}>Google 캘린더</div>
            <div data-google-sub style={{ fontSize: 12.5, color: 'var(--mf-muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {api.enabled && api.needsReauth
                ? // **연동이 해제된 것이 아니다** — 고른 캘린더는 그대로 남아 있다.
                  // 평소에는 서버가 갱신 토큰으로 조용히 이어 주므로 이 문구가 뜨지
                  // 않는다. 뜬다면 구글에서 권한을 회수했거나(계정 › 타사 앱) 서버
                  // 흐름이 없는 환경이다 — 어느 쪽이든 답은 "다시 허용"이다.
                  '구글 권한을 다시 허용해야 이어져요 — 고른 캘린더는 그대로예요'
                : live
                  ? // 연결된 뒤에는 **무엇이 걸려 있는지**를 말한다(첨부 이미지).
                    [account, `이번 달 일정 ${monthly}개`].filter(Boolean).join(' · ')
                  : '연결하면 구글 일정도 함께 보여요'}
            </div>
          </div>
          {api.enabled && api.needsReauth ? (
            <button type="button" className="btn mf-ctl" data-google-reconnect onClick={() => void api.connect()} style={neutralPill}>
              다시 연결
            </button>
          ) : api.enabled ? (
            <button type="button" className="btn mf-ctl" data-google-disconnect onClick={() => void api.disconnect()} style={neutralPill}>
              해제
            </button>
          ) : (
            // 켜는 버튼만 강조색이다 — 이 구획에서 사용자가 할 일이 그것 하나다.
            <button type="button" className="btn mf-ctl-primary" data-google-connect onClick={() => void api.connect()} style={primaryPill}>
              연결하기
            </button>
          )}
        </div>

        {api.error && (
          <div data-google-error style={{ padding: '0 15px 12px 66px', fontSize: 12.5, color: 'var(--mf-danger)' }}>
            {api.error}
          </div>
        )}

        {live && (
          <div style={{ borderTop: '1px solid var(--mf-hairline)', padding: '12px 15px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '0 0 8px 3px' }}>
              <SectionLabel>보여 줄 캘린더</SectionLabel>
              <span data-google-shown style={{ fontSize: 11.5, color: 'var(--mf-muted)' }}>{shown}개 표시 중</span>
            </div>
            {rows.length === 0 && api.calendars.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--mf-muted)', padding: '2px 3px' }}>캘린더를 불러오는 중…</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1, maxHeight: 208, overflowY: 'auto' }} className="lnb-scroll">
                {rows.map((c) => {
                  const on = api.pickedIds.includes(c.id);
                  return (
                    <label
                      key={c.id}
                      data-google-cal={c.id}
                      style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '7px 8px', borderRadius: 10, cursor: 'pointer', minHeight: 38 }}
                      className="menu-row"
                    >
                      <input type="checkbox" className="mf-cb" checked={on} onChange={() => api.toggleCalendar(c.id)} />
                      <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: 999, background: c.color ?? 'var(--mf-accent)', flexShrink: 0 }} />
                      <span style={{ minWidth: 0, flex: 1, fontSize: 13.5, fontWeight: on ? 700 : 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.summary}</span>
                      {c.primary ? (
                        <Badge>내 캘린더</Badge>
                      ) : c.holiday ? (
                        <Badge tone="accent">공휴일</Badge>
                      ) : (
                        // 쓸 수 없는 캘린더는 그렇게 말한다 — 새 일정 목적지에도 오르지 않는다.
                        !c.writable && <Badge attrs={{ 'data-google-readonly': '' }}>보기 전용</Badge>
                      )}
                      {/* 우리가 더한 캘린더만 뺄 수 있다 — 구독 목록의 캘린더는 구글이 들고 있다.
                          공휴일 캘린더는 예외다: 그 자리는 아래 **공휴일 국가**가 맡으므로
                          여기서 빼면 국가 설정만 남아 둘이 어긋난다. */}
                      {c.external && !c.holiday && (
                        <button
                          type="button"
                          className="btn mf-ctl"
                          data-google-cal-remove={c.id}
                          aria-label={`${c.summary} 목록에서 빼기`}
                          title="목록에서 빼기"
                          onClick={(e) => {
                            e.preventDefault();
                            api.removeCalendar(c.id);
                          }}
                          style={{ flexShrink: 0, width: 22, height: 22, display: 'grid', placeItems: 'center', border: 'none', borderRadius: 999, background: 'transparent', color: 'var(--mf-faint)', cursor: 'pointer', fontSize: 13, lineHeight: 1 }}
                        >
                          ✕
                        </button>
                      )}
                    </label>
                  );
                })}
              </div>
            )}
            <AddCalendar api={api} />
            {/* 체크는 이 화면에서 보여 줄지만 정하는 것 — 구글 쪽 구독 목록은 그대로다. */}
            <div style={{ display: 'flex', gap: 8, marginTop: 10, padding: '10px 11px', borderRadius: 12, border: '1px solid var(--mf-border-soft)', background: 'var(--mf-card)', fontSize: 11.5, color: 'var(--mf-faint)', lineHeight: 1.55 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--mf-faint)" strokeWidth="2" strokeLinecap="round" aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }}>
                <circle cx="12" cy="12" r="9" />
                <path d="M12 11v5.5M12 7.6v.6" />
              </svg>
              <span>체크를 풀거나 연동을 끄면 이 화면에서만 사라지고 구글에는 그대로 남아요.</span>
            </div>
          </div>
        )}
      </div>

      {/*
        공휴일 국가(요청) — **연결된 뒤에만** 보여 준다. 공휴일은 구글의 공개 캘린더에서
        오므로 연결 전에는 고를 수 있는 척만 하게 된다(첨부 이미지는 연결 전에도 이 줄을
        두지만, 이 앱은 "할 수 없는 것은 보이지 않는다"를 지킨다).
      */}
      {live && (
        <SettingsGroup style={{ marginTop: 10 }} attrs={{ 'data-holiday-row': '' }}>
          {/* 좁은 화면에서는 **두 묶음 사이에서만** 접힌다(세그먼트는 `flexShrink: 0`이라
              쪼개지지 않는다) — 폰에서 설명이 세 줄로 접히며 트랙 옆에 매달리던 것. */}
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 13, padding: '14px 15px' }}>
            <div style={{ minWidth: 0, flex: '1 1 200px' }}>
              <div style={{ fontWeight: 700, fontSize: 14.5 }}>공휴일 국가</div>
              <div style={{ fontSize: 12.5, color: 'var(--mf-muted)', marginTop: 2 }}>고른 국가의 공휴일을 일정 칩 대신 날짜 색으로 표시해요 — 일정 화면과 위젯 모두</div>
            </div>
            {/* 세그먼트 트랙 — 속성 패널의 크기 세그먼트와 같은 문법(가라앉은 트랙
                위에서 고른 칸만 카드 면 + 진한 강조 잉크). */}
            <Segmented
              value={api.holidayCountry}
              onChange={api.setHolidayCountry}
              label="공휴일 국가"
              trackAttrs={{ 'data-holiday-seg': '' }}
              track={{ display: 'flex', gap: 3, padding: 3, borderRadius: 11, background: 'var(--mf-panel2)', border: '1px solid var(--mf-border-soft)', boxSizing: 'border-box', flexShrink: 0 }}
              items={HOLIDAY_ITEMS.map((c) => ({
                value: c.value,
                label: c.label,
                style: (on: boolean) => ({
                  minWidth: 54,
                  height: 30,
                  border: 0,
                  borderRadius: 8,
                  padding: '0 10px',
                  background: on ? 'var(--mf-card)' : 'transparent',
                  fontFamily: 'inherit',
                  fontSize: 12.5,
                  fontWeight: 700,
                  color: on ? 'var(--mf-accent-strong)' : 'var(--mf-subtext)',
                  boxShadow: on ? '0 2px 5px -3px rgba(46,42,38,.35)' : 'none',
                  cursor: 'pointer',
                }),
              }))}
            />
          </div>
        </SettingsGroup>
      )}
    </>
  );
}

/**
 * 세그먼트의 칸 — 세 나라 + **없음**. `없음`이 있어야 공휴일을 끄는 길이 남는다
 * (공휴일 캘린더가 목록에서 빠졌으므로 여기가 유일한 스위치다).
 */
const HOLIDAY_ITEMS: { value: HolidayCountry; label: string }[] = [
  ...HOLIDAY_COUNTRIES.map((c) => ({ value: c.key as HolidayCountry, label: c.label })),
  { value: HOLIDAY_OFF, label: '없음' },
];

/** 이 달의 `YYYY-MM` — 카드 부제의 "이번 달 일정 N개"가 이 달로 거른다. */
function monthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** 목록 행의 오른쪽 표식(첨부 이미지) — 내 캘린더 / 공휴일 / 보기 전용. */
function Badge({ children, tone, attrs }: { children: ReactNode; tone?: 'accent'; attrs?: Record<string, string> }) {
  return (
    <span
      {...attrs}
      style={{
        flexShrink: 0,
        height: 22,
        padding: '0 9px',
        display: 'inline-flex',
        alignItems: 'center',
        borderRadius: 999,
        background: tone === 'accent' ? 'var(--mf-accent-soft)' : 'var(--mf-panel2)',
        color: tone === 'accent' ? 'var(--mf-accent-strong)' : 'var(--mf-muted)',
        fontSize: 11,
        fontWeight: 700,
      }}
    >
      {children}
    </span>
  );
}

const neutralPill = {
  flexShrink: 0,
  height: 34,
  padding: '0 15px',
  border: '1px solid var(--mf-border)',
  borderRadius: 999,
  background: 'var(--mf-card)',
  color: 'var(--mf-text)',
  fontFamily: 'inherit',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
} as const;

const primaryPill = {
  flexShrink: 0,
  height: 34,
  padding: '0 16px',
  border: 0,
  borderRadius: 999,
  background: 'var(--mf-accent)',
  color: 'var(--mf-accent-ink)',
  fontFamily: 'inherit',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
} as const;

/**
 * **캘린더 더하기**(요청: 구독한 캘린더만 목록에 떠서 불편하다).
 *
 * 구글의 구독(`calendarList.insert`)은 쓰기 스코프가 따로라 동의 화면을 고치고
 * 검수를 다시 받아야 한다. 그래서 **그리오 목록에만** 더한다 — 지금 스코프로
 * `events.list`를 그 주소에 한 번 물어 "볼 수 있는가 + 이름"을 확인하고 목록에
 * 올린다(`probeCalendar`). 구글 쪽 구독 목록은 그대로다.
 *
 * 이름으로 찾을 수 있으면(선택 스코프) 후보를 보여 주고, 아니면 주소를 직접 받는다.
 */
function AddCalendar({ api }: { api: GoogleCalendarApi }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [people, setPeople] = useState<DirectoryPerson[]>([]);
  const seqRef = useRef(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // 검색 함수는 렌더마다 새 참조다(`api`가 새 객체) — deps에 넣으면 타이머가 매
  // 렌더 취소돼 **디바운스가 영영 안 터진다**. 최신 함수는 ref로 읽는다.
  const searchRef = useRef(api.searchPeople);
  searchRef.current = api.searchPeople;
  const canSearch = api.canSearchPeople;

  // 이름 검색 — 220ms 디바운스 + 마지막 응답만 채택(느린 앞 요청이 뒤 결과를 덮지 않게).
  useEffect(() => {
    const query = q.trim();
    // 주소를 적는 중이면 검색하지 않는다 — 그때는 그 주소가 곧 답이다.
    if (!open || !canSearch || query.length < 2 || query.includes('@')) {
      setPeople([]);
      return;
    }
    const seq = ++seqRef.current;
    const t = window.setTimeout(() => {
      void searchRef.current(query).then((got) => {
        if (seq !== seqRef.current) return;
        setPeople(got ?? []);
      });
    }, 220);
    return () => window.clearTimeout(t);
  }, [open, q, canSearch]);

  const add = async (id: string): Promise<void> => {
    setBusy(true);
    setErr(null);
    const message = await api.addCalendar(id);
    setBusy(false);
    if (message) {
      setErr(message);
      return;
    }
    // 성공하면 접는다 — 더한 캘린더는 위 목록에 켜진 채로 나타난다.
    setQ('');
    setPeople([]);
    setOpen(false);
  };

  if (!open) {
    return (
      <button type="button" className="btn mf-ctl" data-google-cal-add onClick={() => setOpen(true)} style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 7, width: '100%', padding: '8px 6px', border: 'none', borderRadius: 10, background: 'transparent', color: 'var(--mf-accent)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', minHeight: 36 }}>
        <span aria-hidden="true" style={{ fontSize: 14, lineHeight: 1 }}>＋</span>
        캘린더 추가
      </button>
    );
  }

  return (
    <div data-google-cal-add-form style={{ marginTop: 8 }}>
      {/*
        좁은 화면(폰 바텀 시트)에서는 [입력]과 [추가·취소]가 줄로 나뉜다. 버튼 둘을
        **한 묶음으로 감싸** 두었으므로 접히는 지점이 묶음 사이뿐이다 — 서식 툴바에서
        배운 규칙(#279): 한 줄에 wrap만 걸면 묶음 중간에서 접혀 어긋난다.
      */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <input
          ref={inputRef}
          data-google-cal-add-input
          aria-label={api.canSearchPeople ? '이름 또는 캘린더 주소' : '캘린더 주소'}
          placeholder={api.canSearchPeople ? '이름 또는 캘린더 주소' : '캘린더 주소(이메일)'}
          value={q}
          autoComplete="off"
          onChange={(e) => {
            setQ(e.target.value);
            setErr(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (!busy && q.trim()) void add(q.trim());
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setOpen(false);
            }
          }}
          // 150px 아래로는 줄지 않는다 — 그보다 좁아지면 버튼 묶음이 다음 줄로 내려간다.
          style={{ flex: 1, minWidth: 150, height: 34, padding: '0 11px', boxSizing: 'border-box', border: '1px solid var(--mf-border)', borderRadius: 11, background: 'var(--mf-card)', font: 'inherit', fontSize: 12.5, color: 'var(--mf-text)', outline: 'none' }}
        />
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, marginLeft: 'auto' }}>
        <button type="button" className="btn mf-ctl-primary" data-google-cal-add-submit disabled={busy || !q.trim()} onClick={() => void add(q.trim())} style={{ flexShrink: 0, height: 34, padding: '0 13px', border: 'none', borderRadius: 999, background: q.trim() && !busy ? 'var(--mf-accent)' : 'var(--mf-accent-mute)', color: 'var(--mf-accent-ink)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, cursor: busy || !q.trim() ? 'default' : 'pointer' }}>
          {busy ? '확인 중…' : '추가'}
        </button>
        <button type="button" className="btn mf-ctl" onClick={() => setOpen(false)} style={{ flexShrink: 0, height: 34, padding: '0 10px', border: '1px solid var(--mf-border)', borderRadius: 999, background: 'var(--mf-panel2)', color: 'var(--mf-text)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
          취소
        </button>
        </span>
      </div>

      {people.length > 0 && (
        <div data-google-cal-add-list style={{ marginTop: 6, display: 'flex', flexDirection: 'column', borderRadius: 11, border: '1px solid var(--mf-border)', background: 'var(--mf-card)', maxHeight: 132, overflowY: 'auto' }} className="lnb-scroll">
          {people.map((p, i) => (
            <button
              key={p.email}
              type="button"
              className="btn mf-ctl"
              data-google-cal-candidate={p.email}
              disabled={busy}
              onClick={() => void add(p.email)}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1, padding: '7px 10px', border: 'none', borderTop: i === 0 ? 'none' : '1px solid var(--mf-border-soft)', background: 'transparent', fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer' }}
            >
              <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--mf-text)' }}>{p.name}</span>
              <span style={{ fontSize: 11, color: 'var(--mf-muted)' }}>{p.email}</span>
            </button>
          ))}
        </div>
      )}

      {err && (
        <div data-google-cal-add-error style={{ marginTop: 6, fontSize: 12, color: 'var(--mf-danger)' }}>
          {err}
        </div>
      )}
      <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--mf-faint)', lineHeight: 1.5 }}>
        구독하지 않은 캘린더도 주소로 더할 수 있어요 — 상대가 공유해 둔 캘린더만 보이고, <b style={{ fontWeight: 700 }}>보기 전용</b>이라 일정을 만들 수는 없어요.
      </div>
    </div>
  );
}

/** 구글 캘린더 마크 — 브랜드 로고를 흉내내지 않고 우리 선 아이콘 언어로 그린다. */
function GoogleCalendarGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--mf-subtext)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
      <path d="M8 3v4M16 3v4M3.5 10h17" />
    </svg>
  );
}

// 설정 → 계정 설정 → **연동** 구획의 구글 캘린더 행(PR5). 구글 캘린더를 일정 화면에
// 겹쳐 볼지 정한다. 구획 제목("연동")은 호출부(계정 설정 화면)가 달고 이 컴포넌트는
// 행 하나만 그린다 — 같은 구획의 `Google 연동`(로그인 수단) 행과 **같은 꼴**이다(요청:
// 두 연동을 한 묶음으로).
//
// 이 구획의 규칙 셋:
//  ① 배포에 구글 클라이언트 ID가 없으면 **그리지 않는다** — 눌러도 아무 일 없는
//     버튼을 두지 않는다(이 프로젝트의 정직한 어포던스 규칙).
//  ② 켜는 것은 사용자가 **직접 누를 때만**이다(동의 창이 그때 뜬다). 화면을 여는
//     것만으로 팝업이 뜨면 브라우저가 막고, 사용자도 놀란다.
//  ③ 무엇을 할 수 있는지 문구가 말한다 — 겹쳐 보고(읽기) 그리오에서 만들고 고칠
//     수 있다(쓰기, PR6). 쓸 수 없는 캘린더(공휴일·보기 전용 공유)는 그렇게 표시한다.
//  ④ 스코프를 넓힌 뒤 옛 토큰이 남으면 **다시 연결**을 권한다 — 켜져 있는데 저장이
//     안 되는 상태를 조용히 두지 않는다.

import { useEffect, useRef, useState } from 'react';
import type { GoogleCalendarApi } from '../../calendar/useGoogleCalendar';
import type { DirectoryPerson } from '../../calendar/googleDirectory';

export function GoogleCalendarSection({ api }: { api: GoogleCalendarApi }) {
  if (!api.available) return null;
  // 연결은 돼 있는데 토큰이 없으면(재로그인 뒤) "불러오는 중"이 아니다 — 다시 연결해야
  // 목록이 온다(제보: 창을 닫아도 "캘린더를 불러오는 중…"이 그대로 남았다).
  const showList = api.enabled && api.connected && !api.needsReauth;
  return (
    <div data-google-section style={{ padding: '15px 16px', borderRadius: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
        <span style={{ display: 'flex', flexShrink: 0, width: 18, justifyContent: 'center' }}>
          <GoogleCalendarGlyph />
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14.5 }}>Google 캘린더 연동</div>
          <div style={{ fontSize: 12.5, color: 'var(--mf-muted)', marginTop: 2 }}>
            {api.needsReauth
              ? // **연동이 해제된 것이 아니다** — 고른 캘린더는 그대로 남아 있다.
                // 평소에는 서버가 갱신 토큰으로 조용히 이어 주므로 이 문구가 뜨지
                // 않는다. 뜬다면 구글에서 권한을 회수했거나(계정 › 타사 앱) 서버
                // 흐름이 없는 환경이다 — 어느 쪽이든 답은 "다시 허용"이다.
                '구글 권한을 다시 허용해야 이어져요 — 고른 캘린더는 그대로예요'
              : api.enabled
                ? '일정 화면에 겹쳐 보고, 여기서 만들고 고칠 수 있어요'
                : '내 구글 일정을 겹쳐 보고 그리오에서 만들고 고칠 수 있어요'}
          </div>
        </div>
        {api.enabled && api.needsReauth ? (
          <button type="button" className="btn mf-ctl" data-google-reconnect onClick={() => void api.connect()} style={btn()}>
            다시 연결
          </button>
        ) : api.enabled ? (
          <button type="button" className="btn mf-ctl" data-google-disconnect onClick={() => void api.disconnect()} style={btn()}>
            연결 해제
          </button>
        ) : (
          <button type="button" className="btn mf-ctl" data-google-connect onClick={() => void api.connect()} style={btn()}>
            연결
          </button>
        )}
      </div>

      {api.error && (
        <div data-google-error style={{ marginTop: 10, marginLeft: 31, fontSize: 12.5, color: 'var(--mf-danger)' }}>
          {api.error}
        </div>
      )}

      {showList && (
        <div style={{ marginTop: 12, marginLeft: 31, borderTop: '1px solid var(--mf-hairline)', paddingTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--mf-faint)', marginBottom: 8 }}>보여 줄 캘린더</div>
          {api.calendars.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--mf-muted)' }}>캘린더를 불러오는 중…</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 190, overflowY: 'auto' }} className="lnb-scroll">
              {api.calendars.map((c) => {
                const on = api.pickedIds.includes(c.id);
                return (
                  <label
                    key={c.id}
                    data-google-cal={c.id}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 6px', borderRadius: 10, cursor: 'pointer', minHeight: 36 }}
                    className="menu-row"
                  >
                    <input type="checkbox" checked={on} onChange={() => api.toggleCalendar(c.id)} style={{ width: 15, height: 15, accentColor: 'var(--mf-accent)', cursor: 'pointer', flexShrink: 0 }} />
                    <span style={{ width: 9, height: 9, borderRadius: 999, background: c.color ?? 'var(--mf-accent)', flexShrink: 0 }} />
                    <span style={{ minWidth: 0, flex: 1, fontSize: 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.summary}</span>
                    {c.holiday ? (
                      <span style={{ flexShrink: 0, fontSize: 11, color: 'var(--mf-muted)' }}>공휴일</span>
                    ) : (
                      // 쓸 수 없는 캘린더는 그렇게 말한다 — 새 일정 목적지에도 오르지 않는다.
                      !c.writable && (
                        <span data-google-readonly style={{ flexShrink: 0, fontSize: 11, color: 'var(--mf-muted)' }}>보기 전용</span>
                      )
                    )}
                    {/* 우리가 더한 캘린더만 뺄 수 있다 — 구독 목록의 캘린더는 구글이 들고 있다. */}
                    {c.external && (
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
          {/* 공휴일 캘린더는 칩이 아니라 **날짜 색**으로 그린다 — 고를 때 그걸 알려 준다. */}
          <div style={{ fontSize: 11.5, color: 'var(--mf-faint)', marginTop: 8, lineHeight: 1.5 }}>
            공휴일 캘린더는 일정 칩 대신 날짜를 빨갛게 표시해요. 여기서 만든 일정은 <b style={{ fontWeight: 700 }}>구글에만</b> 남아요 — 연동을 끄면 화면에서 사라집니다(구글에는 그대로 있어요).
          </div>
        </div>
      )}
    </div>
  );
}

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

/** 같은 구획의 `Google 연동` 행 버튼과 **같은 꼴**(중립 알약) — 한 묶음으로 읽혀야 한다. */
function btn() {
  return {
    marginLeft: 'auto',
    flexShrink: 0,
    height: 34,
    padding: '0 14px',
    border: '1px solid var(--mf-border)',
    borderRadius: 999,
    background: 'var(--mf-panel2)',
    color: 'var(--mf-text)',
    fontFamily: 'inherit',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
  } as const;
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

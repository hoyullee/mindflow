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

import type { GoogleCalendarApi } from '../../calendar/useGoogleCalendar';

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
              ? '권한을 다시 허용해야 일정을 읽고 쓸 수 있어요'
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
                  </label>
                );
              })}
            </div>
          )}
          {/* 공휴일 캘린더는 칩이 아니라 **날짜 색**으로 그린다 — 고를 때 그걸 알려 준다. */}
          <div style={{ fontSize: 11.5, color: 'var(--mf-faint)', marginTop: 8, lineHeight: 1.5 }}>
            공휴일 캘린더는 일정 칩 대신 날짜를 빨갛게 표시해요. 여기서 만든 일정은 <b style={{ fontWeight: 700 }}>구글에만</b> 남아요 — 연동을 끄면 화면에서 사라집니다(구글에는 그대로 있어요).
          </div>
        </div>
      )}
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

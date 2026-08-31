// 설정 → **연동** 구획(PR5). 구글 캘린더를 일정 화면에 겹쳐 볼지 정한다.
//
// 이 구획의 규칙 셋:
//  ① 배포에 구글 클라이언트 ID가 없으면 **그리지 않는다** — 눌러도 아무 일 없는
//     버튼을 두지 않는다(이 프로젝트의 정직한 어포던스 규칙).
//  ② 켜는 것은 사용자가 **직접 누를 때만**이다(동의 창이 그때 뜬다). 화면을 여는
//     것만으로 팝업이 뜨면 브라우저가 막고, 사용자도 놀란다.
//  ③ 읽기 전용임을 문구가 말한다 — 우리는 구글에 쓰지 않는다.

import type { GoogleCalendarApi } from '../../calendar/useGoogleCalendar';

export function GoogleCalendarSection({ api }: { api: GoogleCalendarApi }) {
  if (!api.available) return null;
  return (
    <div data-google-section>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--mf-faint)', letterSpacing: '.02em', marginTop: 18, marginBottom: 10 }}>연동</div>
      <div style={{ padding: 16, borderRadius: 16, background: 'var(--mf-bg)', border: '1px solid var(--mf-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <GoogleCalendarGlyph />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14.5 }}>Google 캘린더</div>
            <div style={{ fontSize: 12.5, color: 'var(--mf-muted)', marginTop: 2 }}>
              {api.enabled ? '내 일정 화면에 겹쳐 보여요. 읽기만 해요' : '내 구글 일정을 일정 화면에 겹쳐 볼 수 있어요'}
            </div>
          </div>
          {api.enabled ? (
            <button type="button" className="mf-ctl" data-google-disconnect onClick={() => void api.disconnect()} style={btn(false)}>
              연결 해제
            </button>
          ) : (
            <button type="button" className="mf-ctl mf-ctl-primary" data-google-connect onClick={() => void api.connect()} style={btn(true)}>
              연결
            </button>
          )}
        </div>

        {api.error && (
          <div data-google-error style={{ marginTop: 12, fontSize: 12.5, color: 'var(--mf-danger)' }}>
            {api.error}
          </div>
        )}

        {api.enabled && (
          <div style={{ marginTop: 14, borderTop: '1px solid var(--mf-hairline)', paddingTop: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--mf-faint)', marginBottom: 8 }}>보여 줄 캘린더</div>
            {api.calendars.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--mf-muted)' }}>{api.connected ? '캘린더가 없어요.' : '캘린더를 불러오는 중…'}</div>
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
                      {c.holiday && <span style={{ flexShrink: 0, fontSize: 11, color: 'var(--mf-muted)' }}>공휴일</span>}
                    </label>
                  );
                })}
              </div>
            )}
            {/* 공휴일 캘린더는 칩이 아니라 **날짜 색**으로 그린다 — 고를 때 그걸 알려 준다. */}
            <div style={{ fontSize: 11.5, color: 'var(--mf-faint)', marginTop: 8, lineHeight: 1.5 }}>
              공휴일 캘린더는 일정 칩 대신 날짜를 빨갛게 표시해요. 구글 일정은 <b style={{ fontWeight: 700 }}>고칠 수 없어요</b> — 겹쳐 보여 주기만 해요.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function btn(primary: boolean) {
  return {
    flexShrink: 0,
    height: 34,
    padding: '0 16px',
    borderRadius: 999,
    border: primary ? 0 : '1px solid var(--mf-border)',
    background: primary ? 'linear-gradient(180deg, var(--mf-accent), var(--mf-accent-strong))' : 'var(--mf-card)',
    color: primary ? 'var(--mf-accent-ink)' : 'var(--mf-subtext)',
    font: 'inherit',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
  } as const;
}

/** 구글 캘린더 마크 — 브랜드 로고를 흉내내지 않고 우리 선 아이콘 언어로 그린다. */
function GoogleCalendarGlyph() {
  return (
    <span style={{ width: 38, height: 38, borderRadius: 11, background: 'var(--mf-card)', border: '1px solid var(--mf-border)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="var(--mf-subtext)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
        <path d="M8 3v4M16 3v4M3.5 10h17" />
      </svg>
    </span>
  );
}

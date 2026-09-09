// LNB `일정` — 상단 바로가기 카드 + **하위 메뉴**.
//
// 하위 메뉴는 일정 화면이 열려 있을 때만 펼친다(요청: "일정을 누르면 노출").
// 별도 토글 상태를 두지 않은 이유: 이 목록은 그 화면에 딸린 설정이라, 화면을
// 떠나면 접히는 것이 맞고 "열렸는데 화면은 다른 곳"이라는 상태를 만들 수 없다.
//
// 무엇을 담는가는 연동 상태가 정한다:
//   ① 클라이언트 ID가 없는 배포 → **아무것도 그리지 않는다**(눌러도 아무 일 없는
//      항목을 두지 않는다 — 설정의 연동 구획과 같은 규칙).
//   ② 연동 안 됨 → `Google 캘린더 연동` 한 행. 누르면 **동의 창이 아니라 설정의
//      연동 구획**을 연다 — 무엇을 켜는지 읽고 켜는 편이 맞고, 실수로 누른 사람에게
//      구글 로그인 창이 뜨지 않는다(일정 화면 헤더의 연동 아이콘과 같은 판단).
//   ③ 권한이 만료됨 → `다시 연결`. 고른 캘린더는 그대로다.
//   ④ 연동됨 → `보여 줄 캘린더` 체크 목록(설정 화면의 그 목록과 같은 값·같은 동작).

import type { HomeController } from '../useHomeController';
import type { HomeState } from '../types';
import { calendarBriefLine, type CalendarBrief } from '../calendar/model';
import { CalendarGlyph } from '../calendar/CalendarView';
import { googlePrefsOf, useGoogleCalendar } from '../calendar/useGoogleCalendar';
import { NavCard } from './NavCard';

/** 연동 상태 표식(첨부 디자인) — **스위치가 아니다**: 켜고 끄는 일은 설정의 연동
 * 구획이 맡는다(같은 동작의 진입점을 둘로 두면 어느 쪽이 진짜인지 흐려진다).
 * 그래서 점을 알약 **가운데**에 두고 눌리지 않는 `span`으로 그린다.
 * 연동됨 = 초록, 권한 만료 = 경고, 연동 전 = 아무것도 그리지 않는다(모르는 것을
 * 칠하지 않는다 — 이 앱의 "정직한 표식" 규칙). */
function LinkPill({ tone }: { tone: 'ok' | 'warn' }) {
  const ok = tone === 'ok';
  return (
    <span
      data-cal-link={tone}
      aria-hidden="true"
      style={{
        width: 22,
        height: 14,
        borderRadius: 999,
        background: ok ? 'var(--mf-success-soft)' : 'var(--mf-danger-soft)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 999, background: ok ? 'var(--mf-success)' : 'var(--mf-danger)', display: 'block' }} />
    </span>
  );
}

export function CalendarNavSection({ state, controller, isMobile, brief }: { state: HomeState; controller: HomeController; isMobile: boolean; brief: CalendarBrief }) {
  const active = state.activeCal;
  const line = calendarBriefLine(brief);
  // 목록만 필요하다(`list`) — 일정은 일정 화면의 훅이 받는다. 하위 메뉴가 접혀
  // 있으면 `off`라 조회가 아예 나가지 않는다.
  const google = useGoogleCalendar(
    1970,
    1,
    googlePrefsOf(state.google),
    controller.setGoogleCalendars,
    active ? 'list' : 'off',
  );

  // 연동 상태 — 켜져 있고 끊긴 바 없으면 초록, 권한이 만료되면 경고.
  const linkTone: 'ok' | 'warn' | null = !google.available
    ? null
    : google.connected
      ? 'ok'
      : google.enabled && google.needsReauth
        ? 'warn'
        : null;

  return (
    <>
      <NavCard
        data-cal-nav
        isMobile={isMobile}
        // **테두리 타일 + 오늘 날짜**(첨부 디자인) — 알림의 채운 코랄 타일과 갈린다.
        tile="plain"
        // 면은 **언제나 칠한다**(요청) — 그러면 틴트가 "지금 이 화면"을 말할 수
        // 없으므로 활성 신호를 `current`(안쪽 링)로 옮긴다.
        surface="tint"
        current={active}
        tone={active ? 'hot' : 'quiet'}
        expanded={active && google.available}
        aria-current={active ? 'page' : undefined}
        aria-label={`일정 · ${line}${linkTone === 'ok' ? ' · Google 캘린더 연동됨' : linkTone === 'warn' ? ' · Google 캘린더 권한 만료' : ''}`}
        title={line}
        onClick={controller.openCalendar}
        label="일정"
        // 오늘 며칠인가 — 달력 아이콘 하나보다 이 자리에서 더 말이 된다(자리를
        // 늘리지 않고 정보를 하나 더 얹는다).
        glyph={
          <span data-cal-date style={{ fontSize: 13, fontWeight: 800, letterSpacing: '-.02em', lineHeight: 1 }}>
            {new Date().getDate()}
          </span>
        }
        trailing={linkTone ? <LinkPill tone={linkTone} /> : undefined}
        badge={
          brief.overdue > 0 ? (
            <span
              data-cal-overdue
              aria-hidden="true"
              style={{
                minWidth: 18,
                height: 18,
                padding: '0 5px',
                borderRadius: 999,
                background: 'var(--mf-danger-soft)',
                color: 'var(--mf-danger)',
                fontSize: 10.5,
                fontWeight: 800,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxSizing: 'border-box',
                flexShrink: 0,
              }}
            >
              {brief.overdue > 9 ? '9+' : brief.overdue}
            </span>
          ) : undefined
        }
        summary={<span data-cal-summary style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{line}</span>}
      />
      {active && google.available && (
        <div data-cal-sub style={{ margin: '4px 2px 0', padding: '7px 7px 6px', borderRadius: 12, background: 'var(--mf-bg)', border: '1px solid var(--mf-hairline)' }}>
          {google.connected ? (
            <>
              <div style={SUB_LABEL}>보여 줄 캘린더</div>
              {google.calendars.length === 0 ? (
                <div style={{ padding: '5px 8px 6px', fontSize: 12, color: 'var(--mf-muted)' }}>불러오는 중…</div>
              ) : (
                <div className="lnb-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 1, maxHeight: 168, overflowY: 'auto' }}>
                  {google.calendars.map((c) => (
                    <label
                      key={c.id}
                      className="menu-row"
                      data-cal-sub-item={c.id}
                      title={c.summary}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 7px', minHeight: isMobile ? 40 : 28, borderRadius: 8, cursor: 'pointer' }}
                    >
                      <input
                        type="checkbox"
                        checked={google.pickedIds.includes(c.id)}
                        onChange={() => google.toggleCalendar(c.id)}
                        style={{ width: 13, height: 13, accentColor: 'var(--mf-accent)', cursor: 'pointer', flexShrink: 0 }}
                      />
                      <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: c.color ?? 'var(--mf-accent)', flexShrink: 0 }} />
                      <span style={{ minWidth: 0, flex: 1, fontSize: 12, color: 'var(--mf-subtext)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.summary}</span>
                    </label>
                  ))}
                </div>
              )}
              {/*
                목록에 없는 캘린더를 더하는 길(요청) — 실제 흐름(주소 확인·이름 검색·
                빼기)은 **설정의 연동 구획 한 곳**이 맡는다. LNB는 250px이라 검색
                상자를 두면 좁고, 같은 동작의 진입점을 둘로 두면 어느 쪽이 진짜인지
                흐려진다(바로 위 `연동` 행과 같은 판단).

                여기서 들어가면 그 화면의 **주소 입력에 커서가 놓인다**(요청) — 이 버튼을
                누른 사람은 주소를 적으러 온 것이므로 그 칸을 한 번 더 찾아 누를 이유가
                없다.
              */}
              <button type="button" className="nav-item" data-cal-sub-add onClick={controller.openGoogleCalendarAdd} style={{ ...SUB_ROW, minHeight: isMobile ? 40 : 28, color: 'var(--mf-accent)', fontWeight: 700 }}>
                <span aria-hidden="true" style={{ flexShrink: 0, width: 13, textAlign: 'center', fontSize: 13, lineHeight: 1 }}>
                  ＋
                </span>
                <span style={{ minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>캘린더 추가</span>
              </button>
            </>
          ) : (
            // 연동 전(또는 권한 만료) — 무엇을 하면 되는지 한 행이 말한다.
            <button
              type="button"
              className="nav-item"
              data-cal-sub-connect
              onClick={google.enabled && google.needsReauth ? () => void google.connect() : controller.openGoogleCalendarSetup}
              style={{ ...SUB_ROW, minHeight: isMobile ? 40 : 30, fontWeight: 600, color: 'var(--mf-subtext)' }}
            >
              <span style={{ display: 'inline-flex', flexShrink: 0, color: 'var(--mf-accent)' }}>
                <CalendarGlyph />
              </span>
              <span style={{ minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {google.enabled && google.needsReauth ? 'Google 캘린더 다시 연결' : 'Google 캘린더 연동'}
              </span>
            </button>
          )}
        </div>
      )}
    </>
  );
}

/** 하위 메뉴의 행 — 연동·추가 두 버튼이 같은 꼴을 쓴다(값을 각자 적으면 갈린다). */
const SUB_ROW = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  border: 'none',
  background: 'transparent',
  fontFamily: 'inherit',
  textAlign: 'left',
  padding: '6px 7px',
  borderRadius: 8,
  cursor: 'pointer',
  fontSize: 12,
} as const;

const SUB_LABEL = {
  padding: '2px 8px 5px',
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: '.07em',
  color: 'var(--mf-faint2)',
} as const;

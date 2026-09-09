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

import type { CSSProperties } from 'react';
import type { HomeController } from '../useHomeController';
import type { HomeState } from '../types';
import { calendarBriefLine, type CalendarBrief } from '../calendar/model';
import { CalendarGlyph } from '../calendar/CalendarView';
import { isManagedHolidayId } from '../calendar/googleCalendar';
import { googlePrefsOf, useGoogleCalendar } from '../calendar/useGoogleCalendar';
import { NavCard } from './NavCard';
import { LnbRail } from './LnbSection';

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

  // **설정이 소유한 공휴일 캘린더는 목록에 두지 않는다** — 어느 나라를 볼지는 설정의
  // `공휴일 국가` 세그먼트가 정하고(끄는 것까지), 여기에 체크를 또 두면 한 캘린더에
  // 스위치가 둘이 된다(제보로 이미 고친 것 — 설정 목록과 같은 필터). 주소로 직접 더한
  // 공휴일 캘린더는 세그먼트가 모르므로 평범한 행으로 남고 `공휴일` 배지가 붙는다.
  const rows = google.calendars.filter((c) => !isManagedHolidayId(c.id));
  // 감춘 캘린더 수 — `모두 보기`가 이 값으로 뜨고 사라진다.
  const hidden = rows.filter((c) => !google.pickedIds.includes(c.id)).length;

  return (
    <>
      <NavCard
        data-cal-nav
        isMobile={isMobile}
        // **테두리 타일 + 오늘 날짜**(첨부 디자인) — 알림의 채운 코랄 타일과 갈린다.
        tile="plain"
        // 면은 **일정 화면을 보고 있을 때만** 칠한다(제보: 늘 칠하면 "언제나 활성"
        // 으로 읽힌다) — 그 틴트가 곧 "지금 이 화면"이라, 링을 따로 두지 않는다.
        tone={active ? 'hot' : 'quiet'}
        expanded={active && google.available}
        aria-current={active ? 'page' : undefined}
        aria-label={`일정 · ${line}${linkTone === 'ok' ? ' · Google 캘린더 연동됨' : linkTone === 'warn' ? ' · Google 캘린더 권한 만료' : ''}`}
        title={line}
        onClick={controller.openCalendar}
        label="일정"
        // 오늘 며칠인가 — 달력 아이콘 하나보다 이 자리에서 더 말이 된다(자리를
        // 늘리지 않고 정보를 하나 더 얹는다). 숫자 위의 **가로 바**가 달력의 머리
        // 띠 노릇을 해서 이 타일이 "달력 한 장"으로 읽힌다(첨부 디자인).
        glyph={
          <span data-cal-date style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2.5, lineHeight: 1 }}>
            <span data-cal-date-bar aria-hidden="true" style={{ width: 13, height: 1.8, borderRadius: 1, background: 'currentColor', flexShrink: 0 }} />
            <span style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: '-.02em' }}>{new Date().getDate()}</span>
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
        // 가라앉은 판이 아니라 **왼쪽 rail**이다(첨부 디자인) — 즐겨찾기·공유받음·
        // 휴지통과 같은 결이라 같은 부품을 쓴다.
        <LnbRail cap={false} attrs={{ 'data-cal-sub': '' }}>
          {google.connected ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 7px 5px' }}>
                <span style={SUB_LABEL}>보여 줄 캘린더</span>
                {/*
                  `모두 보기`(첨부 디자인) — 목록의 캘린더를 전부 켠다. **감춘 것이
                  있을 때만** 뜬다: 이미 전부 켜져 있으면 눌러도 아무 일이 없으므로
                  그때는 자리에 두지 않는다(이 앱의 "죽은 버튼을 두지 않는다").
                */}
                {hidden > 0 && (
                  <button
                    type="button"
                    className="mf-ctl"
                    data-cal-sub-all
                    onClick={google.showAllCalendars}
                    title={`감춘 캘린더 ${hidden}개를 모두 보여 줍니다`}
                    style={{ marginLeft: 'auto', border: 'none', background: 'transparent', fontFamily: 'inherit', fontSize: 11, color: 'var(--mf-muted)', cursor: 'pointer', padding: '1px 4px', borderRadius: 6, flexShrink: 0 }}
                  >
                    모두 보기
                  </button>
                )}
              </div>
              {!google.listLoaded ? (
                <div style={{ padding: '5px 8px 6px', fontSize: 12, color: 'var(--mf-muted)' }}>불러오는 중…</div>
              ) : (
                <div className="lnb-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 1, maxHeight: 168, overflowY: 'auto' }}>
                  {rows.map((c) => {
                    const on = google.pickedIds.includes(c.id);
                    return (
                      <label
                        key={c.id}
                        className="menu-row"
                        data-cal-sub-item={c.id}
                        title={c.summary}
                        style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '4px 7px', minHeight: isMobile ? 40 : 30, borderRadius: 8, cursor: 'pointer' }}
                      >
                        {/*
                          색 점을 따로 두지 않는다 — **체크 칩 자체가 그 캘린더의 색**이다
                          (첨부 디자인). 신호가 하나면 어느 색이 어느 캘린더인지 헷갈리지
                          않고, 250px 열에서 이름 자리도 그만큼 넓어진다.
                        */}
                        <input
                          type="checkbox"
                          className="mf-cb mf-cb-sm"
                          checked={on}
                          onChange={() => google.toggleCalendar(c.id)}
                          style={{ ['--mf-cb-fill' as string]: c.color ?? 'var(--mf-accent)' } as CSSProperties}
                        />
                        <span style={{ minWidth: 0, flex: 1, fontSize: 12.5, fontWeight: on ? 600 : 500, color: on ? 'var(--mf-text)' : 'var(--mf-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.summary}</span>
                        {/* 공휴일 캘린더는 그렇게 말한다 — 어느 나라를 볼지는 설정의
                            **공휴일 국가**가 정하고, 여기 체크는 보여 줄지만 정한다. */}
                        {c.holiday && (
                          <span data-cal-sub-holiday style={{ flexShrink: 0, padding: '1px 6px', borderRadius: 999, fontSize: 9.5, fontWeight: 700, background: 'var(--mf-accent-soft)', color: 'var(--mf-accent-strong)' }}>
                            공휴일
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              )}
              {/*
                목록에 없는 캘린더를 더하는 길(요청) — 실제 흐름(주소 확인·이름 검색·
                빼기)은 **설정의 연동 구획 한 곳**이 맡는다. LNB는 250px이라 검색
                상자를 두면 좁고, 같은 동작의 진입점을 둘로 두면 어느 쪽이 진짜인지
                흐려진다.

                여기서 들어가면 그 화면의 **주소 입력에 커서가 놓인다**(요청) — 이 버튼을
                누른 사람은 주소를 적으러 온 것이므로 그 칸을 한 번 더 찾아 누를 이유가
                없다.
              */}
              <button type="button" className="nav-item" data-cal-sub-add onClick={controller.openGoogleCalendarAdd} style={{ ...SUB_ROW, minHeight: isMobile ? 40 : 30, color: 'var(--mf-accent)', fontWeight: 700 }}>
                {/* 점선 원 안의 ＋ — "여기에 하나 더"를 말하는 첨부 디자인의 글리프. */}
                <span aria-hidden="true" style={{ flexShrink: 0, width: 18, height: 18, borderRadius: 999, border: '1px dashed var(--mf-accent)', display: 'grid', placeItems: 'center', fontSize: 11, lineHeight: 1 }}>
                  +
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
        </LnbRail>
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

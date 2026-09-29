// LNB `일정` — 오늘 묶음의 둘째 줄 + **하위 메뉴**(보여 줄 캘린더).
//
// 하위 메뉴는 **행 안의 캐럿**으로 여닫는다(스펙: 홈·LNB 변경 2.3 — 기본 접힘). 행을
// 누르면 일정 화면으로 가고, 캐럿을 누르면 목록만 펼친다 — 두 동작을 한 번의 클릭에
// 묶으면(예전: 일정 화면에 들어가면 저절로 펼쳐졌다) 화면을 보러 왔을 뿐인데 LNB가
// 200px 넘게 자라 스페이스 목록을 밀어냈다. 어느 화면에서든 펼칠 수 있다: 이 목록은
// 일정 화면에서 보일 캘린더를 고르는 곳이라, 고르고 들어가도 결과는 같다.
//
// 무엇을 담는가는 연동 상태가 정한다:
//   ① 클라이언트 ID가 없는 배포 → **아무것도 그리지 않는다**(눌러도 아무 일 없는
//      항목을 두지 않는다 — 설정의 연동 구획과 같은 규칙).
//   ② 연동 안 됨 → `Google 캘린더 연동` 한 행. 누르면 **동의 창이 아니라 설정의
//      연동 구획**을 연다 — 무엇을 켜는지 읽고 켜는 편이 맞고, 실수로 누른 사람에게
//      구글 로그인 창이 뜨지 않는다(일정 화면 헤더의 연동 아이콘과 같은 판단).
//   ③ 권한이 만료됨 → `다시 연결`. 고른 캘린더는 그대로다.
//   ④ 연동됨 → `보여 줄 캘린더` 체크 목록(설정 화면의 그 목록과 같은 값·같은 동작).

import { useState, type CSSProperties } from 'react';
import type { HomeController } from '../useHomeController';
import type { HomeState } from '../types';
import { todayISO, type CalendarBrief } from '../calendar/model';
import { CalendarGlyph } from '../calendar/CalendarView';
import { isManagedHolidayId } from '../calendar/googleCalendar';
import { googlePrefsOf, useGoogleCalendar } from '../calendar/useGoogleCalendar';
import { CalendarColorPicker } from '../calendar/CalendarColorPicker';
import { NavCard } from './NavCard';
import { LnbCollapse, LnbRail } from './LnbSection';
import { MONO_FONT } from '../chrome';
import { calendarRowLine, weekdayKo, type CalendarNext } from '../viewModel';

export function CalendarNavSection({ state, controller, isMobile, brief, next }: { state: HomeState; controller: HomeController; isMobile: boolean; brief: CalendarBrief; next: CalendarNext | null }) {
  const active = state.activeCal;
  const today = todayISO();
  const { text: line, urgent } = calendarRowLine(brief, next, today);
  /** 보여 줄 캘린더를 펼쳤는가 — **기본 접힘**(스펙). 서랍(폰)이 닫히면 함께 잊는다. */
  const [open, setOpen] = useState(false);
  // 목록만 필요하다(`list`) — 일정은 일정 화면의 훅이 받는다. 하위 메뉴가 접혀
  // 있으면 `off`라 조회가 아예 나가지 않는다.
  const google = useGoogleCalendar(
    1970,
    1,
    googlePrefsOf(state.google),
    controller.setGoogleCalendars,
    open ? 'list' : 'off',
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
  const now = new Date();

  return (
    <>
      {/* 행과 캐럿은 **형제**다 — 버튼 안에 버튼을 둘 수 없고(HTML), 두 동작(화면 이동 ·
          목록 펼치기)이 갈려야 한다. 캐럿은 행의 오른쪽 안쪽 여백(40px) 위에 얹힌다. */}
      <div data-cal-row style={{ position: 'relative', flexShrink: 0 }}>
        <NavCard
          data-cal-nav
          isMobile={isMobile}
          // 면은 **일정 화면을 보고 있을 때만** 깐다(제보: 늘 칠하면 "언제나 활성"으로
          // 읽힌다) — 그 면이 곧 "지금 이 화면"이라 링을 따로 두지 않는다.
          active={active}
          padRight={google.available ? 40 : 8}
          aria-current={active ? 'page' : undefined}
          aria-label={`일정 · ${line}${linkTone === 'ok' ? ' · Google 캘린더 연동됨' : linkTone === 'warn' ? ' · Google 캘린더 권한 만료' : ''}`}
          title={line}
          onClick={controller.openCalendar}
          label="일정"
          // **상자 없는 날짜 숫자 + 요일**(스펙) — 달력 아이콘 하나보다 이 자리에서 더
          // 말이 된다(자리를 늘리지 않고 "오늘이 며칠인가"를 얹는다). 일정 화면에서는
          // 강조색으로 선다 — 옆의 면과 함께 "지금 이 화면"을 두 겹으로 말한다.
          glyph={
            <span data-cal-date aria-hidden="true" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1 }}>
              <span data-cal-date-num style={{ fontFamily: MONO_FONT, fontSize: 17, fontWeight: 700, letterSpacing: '-.06em', color: active ? 'var(--mf-accent-strong)' : 'var(--mf-text)' }}>
                {now.getDate()}
              </span>
              <span data-cal-date-dow style={{ marginTop: 2, fontSize: 8.5, fontWeight: 800, letterSpacing: '.04em', color: active ? 'var(--mf-accent)' : 'var(--mf-muted)' }}>
                {weekdayKo(today)}
              </span>
            </span>
          }
          summary={
            <span data-cal-summary data-urgent={urgent ? '1' : undefined} style={{ display: 'block', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', color: urgent ? 'var(--mf-danger)' : undefined }}>
              {line}
            </span>
          }
        />
        {/* 펼칠 것이 없는 배포(클라이언트 ID 없음)에는 캐럿이 없다 — 눌러도 아무 일
            없는 단추는 없느니만 못하다(이 앱의 규칙). */}
        {google.available && (
          <button
            type="button"
            className="mf-cal-caret"
            data-cal-caret
            data-on={open || active ? '1' : undefined}
            aria-expanded={open}
            aria-label={open ? '보여 줄 캘린더 접기' : '보여 줄 캘린더 펼치기'}
            title="보여 줄 캘린더"
            onClick={() => setOpen((v) => !v)}
            style={{
              position: 'absolute',
              right: 6,
              top: '50%',
              marginTop: -13,
              width: 26,
              height: 26,
              padding: 0,
              border: 'none',
              borderRadius: 8,
              background: 'transparent',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .17s ease' }}>
              <path d="m6 9 6 6 6-6" />
            </svg>
            {/* 권한이 만료됐으면 캐럿 모서리에 경고 점 — 연동 알약을 걷어낸 자리에서
                **다시 연결이 필요하다**만은 접힌 채로도 보여야 한다(펼치면 그 행이 있다).
                잘 연결된 상태는 따로 칠하지 않는다(스펙: 행 오른쪽에는 캐럿뿐). */}
            {linkTone === 'warn' && (
              <span data-cal-link="warn" aria-hidden="true" style={{ position: 'absolute', top: 3, right: 3, width: 6, height: 6, borderRadius: 999, background: 'var(--mf-danger)', boxShadow: '0 0 0 1.5px var(--mf-card)' }} />
            )}
          </button>
        )}
      </div>
      {google.available && (
        // 가라앉은 판이 아니라 **왼쪽 rail**이다(첨부 디자인) — 즐겨찾기·공유받음·
        // 휴지통과 같은 결이라 같은 부품을 쓴다. 열고 닫히는 것도 **그 셋과 같은
        // 상자**(`LnbCollapse`)가 맡는다(요청: 일정도 같은 효과로) — 그래서 조건부로
        // 넣었다 빼는 대신 늘 그려 두고 높이로 접는다(그래야 닫는 동작에도
        // 애니메이션이 걸린다).
        <LnbCollapse open={open}>
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
                          {/*
                            **색을 바꾸는 자리도 여기다**(요청: 각 구글 캘린더의 색을
                            바꿀 방법이 없을까). 색을 보고 있는 자리에서 바꾸는 것이
                            맞아 설정 목록과 **같은 부품·같은 값**을 그대로 쓴다(진입점이
                            둘이어도 하는 일이 하나면 흐려지지 않는다 — 여기 체크는
                            켜진 캘린더만 칠하므로 꺼 둔 캘린더의 색은 이 점에서만 보인다).
                            `<label>` 안의 `<button>`은 체크를 건드리지 않는다(HTML: 상호작용
                            자손을 누르면 라벨은 아무 일도 하지 않는다).
                          */}
                          <CalendarColorPicker
                            id={c.id}
                            summary={c.summary}
                            color={c.color}
                            palette={google.eventColors}
                            custom={!!google.calendarColors[c.id]}
                            onPick={(hex) => google.setCalendarColor(c.id, hex)}
                            dot={8}
                          />
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
        </LnbCollapse>
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

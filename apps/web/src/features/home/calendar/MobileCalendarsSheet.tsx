// 「보여 줄 캘린더」 시트(모바일 홈 디자인 N7) — 일정 탭의 목록 아이콘과 전체 › 보여 줄 캘린더가 연다.
//
// 데스크톱 LNB `일정` 하위 메뉴(`CalendarNavSection`)와 **같은 값·같은 동작**이다: 구글 캘린더를
// 켜고 끄기, 감춘 것이 있으면 모두 보기, 캘린더 추가(설정의 연동 구획으로 — 주소 입력에 커서),
// 공휴일 국가. 설정이 소유한 공휴일 캘린더는 목록에 두지 않는다(한 캘린더에 스위치가 둘이 된다).
//
// 디자인의 Geurio 묶음(「칸반 마감」 켜고 끄기)은 두지 않았다 — 칸반 마감은 **보드마다** 고른다
// (홈 카드 메뉴의 「일정에 반영」), 한꺼번에 끄는 스위치를 하나 더 두면 둘이 서로 어긋난다.

import type { CSSProperties } from 'react';
import type { HomeController } from '../useHomeController';
import type { HomeState } from '../types';
import { googlePrefsOf, useGoogleCalendar } from './useGoogleCalendar';
import { HOLIDAY_COUNTRIES, HOLIDAY_OFF, isManagedHolidayId, type HolidayCountry } from './googleCalendar';
import { MONO_FONT } from '../chrome';
import { MobileSheet, SheetClose } from '../mobile/parts';

const HOLIDAY_OPTIONS: { value: HolidayCountry; label: string }[] = [...HOLIDAY_COUNTRIES.map((c) => ({ value: c.key as HolidayCountry, label: c.label })), { value: HOLIDAY_OFF, label: '없음' }];

const ROW: CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, minHeight: 54, padding: '0 14px 0 16px', border: 0, background: 'transparent', fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer', width: '100%', boxSizing: 'border-box' };

function Check({ on }: { on: boolean }) {
  return (
    <span aria-hidden="true" style={{ width: 26, height: 26, flex: '0 0 auto', boxSizing: 'border-box', borderRadius: 8, border: `1.5px solid ${on ? 'var(--mf-accent)' : 'var(--mf-m-btn-line)'}`, background: on ? 'var(--mf-accent)' : 'var(--mf-m-card)', color: 'var(--mf-accent-ink)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      {on && (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
          <path d="m5 13 4.5 4.5L19 7" />
        </svg>
      )}
    </span>
  );
}

export function MobileCalendarsSheet({ open, onClose, state, controller }: { open: boolean; onClose: () => void; state: HomeState; controller: HomeController }) {
  // 목록만 필요하다 — 닫혀 있으면 조회가 아예 나가지 않는다(LNB 하위 메뉴와 같은 규칙).
  const google = useGoogleCalendar(1970, 1, googlePrefsOf(state.google), controller.setGoogleCalendars, open ? 'list' : 'off');
  const rows = google.calendars.filter((c) => !isManagedHolidayId(c.id));
  const hidden = rows.filter((c) => !google.pickedIds.includes(c.id)).length;
  const goSettings = (fn: () => void) => {
    onClose();
    fn();
  };

  return (
    <MobileSheet open={open} onClose={onClose} label="보여 줄 캘린더" attrs={{ 'data-m-calendars-sheet': '' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '16px 20px 6px', flex: '0 0 auto' }}>
        <span style={{ flex: 1, fontSize: 20, fontWeight: 800, letterSpacing: '-.03em', color: 'var(--mf-m-ink)' }}>보여 줄 캘린더</span>
        {google.connected && hidden > 0 && (
          <button type="button" className="btn" data-m-calendars-all onClick={google.showAllCalendars} style={{ height: 32, padding: '0 4px', border: 0, background: 'transparent', color: 'var(--mf-m-mut)', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            모두 보기
          </button>
        )}
        <SheetClose onClick={onClose} />
      </div>
      <div className="mf-m-scroll" style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', paddingBottom: 8 }}>
        {!google.available ? (
          <div style={{ padding: '18px 24px', fontSize: 13.5, lineHeight: 1.6, color: 'var(--mf-m-mut)' }}>이 배포에는 Google 캘린더 연동이 없어요.</div>
        ) : !google.connected ? (
          <div style={{ margin: '8px 16px 0', borderRadius: 14, background: 'var(--mf-m-bg)', overflow: 'hidden' }}>
            <button
              type="button"
              className="btn mf-m-press"
              data-m-calendars-connect
              onClick={google.enabled && google.needsReauth ? () => void google.connect() : () => goSettings(controller.openGoogleCalendarSetup)}
              style={{ ...ROW, color: 'var(--mf-accent)', fontSize: 15, fontWeight: 800 }}
            >
              {google.enabled && google.needsReauth ? 'Google 캘린더 다시 연결' : 'Google 캘린더 연동'}
            </button>
          </div>
        ) : (
          <>
            <span style={{ display: 'flex', alignItems: 'baseline', gap: 6, padding: '10px 20px 6px', fontSize: 12, fontWeight: 800, color: 'var(--mf-m-faint)' }}>
              Google <span style={{ fontFamily: MONO_FONT, fontWeight: 600, color: 'var(--mf-m-faint2)' }}>{rows.length}</span>
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', margin: '0 16px', borderRadius: 14, background: 'var(--mf-m-bg)', overflow: 'hidden' }}>
              {!google.listLoaded ? (
                <div style={{ padding: '16px', fontSize: 13, color: 'var(--mf-m-mut)' }}>불러오는 중…</div>
              ) : (
                rows.map((c, i) => {
                  const on = google.pickedIds.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      className="btn mf-m-press"
                      data-m-calendar={c.id}
                      onClick={() => google.toggleCalendar(c.id)}
                      style={{ ...ROW, borderTop: i ? '1px solid var(--mf-m-line)' : 0 }}
                    >
                      <span aria-hidden="true" style={{ width: 10, height: 10, flex: '0 0 auto', borderRadius: 99, background: on ? (c.color ?? 'var(--mf-accent)') : 'var(--mf-m-faint2)', display: 'block' }} />
                      <span style={{ flex: 1, minWidth: 0, fontSize: 14.5, fontWeight: on ? 700 : 600, color: on ? 'var(--mf-m-ink)' : 'var(--mf-m-mut)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.summary}</span>
                      {c.holiday && <span style={{ flex: '0 0 auto', padding: '1px 7px', borderRadius: 99, fontSize: 10.5, fontWeight: 800, background: 'var(--mf-accent-soft)', color: 'var(--mf-accent-strong)' }}>공휴일</span>}
                      <Check on={on} />
                    </button>
                  );
                })
              )}
              <button type="button" className="btn mf-m-press" data-m-calendars-add onClick={() => goSettings(controller.openGoogleCalendarAdd)} style={{ ...ROW, minHeight: 50, borderTop: '1px solid var(--mf-m-line)', color: 'var(--mf-m-danger)', fontSize: 14, fontWeight: 800 }}>
                <span aria-hidden="true" style={{ width: 10, display: 'inline-flex', justifyContent: 'center', fontSize: 16, lineHeight: 1 }}>
                  +
                </span>
                캘린더 추가
              </button>
            </div>
            <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '18px 20px 6px', fontSize: 12, fontWeight: 800, color: 'var(--mf-m-faint)' }}>
              공휴일 국가 <span style={{ fontWeight: 600, color: 'var(--mf-m-faint2)' }}>달력에 빨갛게 표시돼요</span>
            </span>
            <div role="radiogroup" aria-label="공휴일 국가" style={{ display: 'grid', gridTemplateColumns: `repeat(${HOLIDAY_OPTIONS.length}, 1fr)`, gap: 4, margin: '0 16px', padding: 4, borderRadius: 12, background: 'var(--mf-m-soft)' }}>
              {HOLIDAY_OPTIONS.map((o) => {
                const on = google.holidayCountry === o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    className="btn"
                    data-m-holiday={o.value}
                    onClick={() => google.setHolidayCountry(o.value)}
                    style={{ height: 36, border: 0, borderRadius: 9, background: on ? 'var(--mf-m-card)' : 'transparent', boxShadow: on ? '0 1px 3px rgba(46,42,38,.12)' : 'none', color: on ? 'var(--mf-m-danger)' : 'var(--mf-m-mut)', fontFamily: 'inherit', fontSize: 13.5, fontWeight: on ? 800 : 600, cursor: 'pointer' }}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </MobileSheet>
  );
}

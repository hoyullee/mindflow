import { useMemo, useState } from 'react';
import type { HomeState } from '../types';
import type { HomeController } from '../useHomeController';
import { calendarEntries, type CalendarEntry, type CalendarSource } from './entries';
import { homeChipSurface } from '../theme';
import { calendarStats, filterByStat, monthCells, monthLabel, todayISO } from './model';
import { MonthGrid } from './MonthGrid';
import { CalendarSide } from './CalendarSide';
import { CalendarDetailHost } from './CalendarDetail';
import { NewEventModal } from './NewEventModal';
import { EventDetail } from './EventDetail';
import { useCalendarEvents } from './useCalendarEvents';
import { eventEntries } from './entries';

/**
 * 일정 화면 — 디자인 원본 `Geurio 일정 캘린더.dc.html`의 `isCal` 화면.
 *
 * 대시보드·스페이스와 나란한 세 번째 화면이고, 그리는 항목의 **원천이 둘**이다:
 * ① 전 스페이스의 **칸반 마감** — 본문은 썸네일이 이미 받아 둔 것을 그대로 읽으므로
 *    이 화면을 여는 것만으로 새로 내려받는 것이 없다(모자란 스페이스는 컨트롤러가
 *    검색과 같은 경로로 마저 받는다). 정본은 그 칸반 문서다.
 * ② **Geurio 일정**(`calendar_events`, 0033) — 칸반에 없는 일정(회의·휴가·약속)을
 *    적는 자리. 정본이 우리 표라 여기서 고치면 곧바로 저장된다.
 *
 * 둘을 같은 `CalendarEntry` 모양으로 만들어 격자·통계·목록·시간표가 종류를 가리지
 * 않고 그린다. 항목을 누르면 상세 팝업이 뜨는데 **고칠 것이 달라 팝업이 갈린다**
 * (칸반=상태·시작일·기한 / 일정=종일·시각·위치·메모). 칩·바를 다른 칸에 끌어 놓으면
 * 날짜가 움직인다(칸반 카드만 — 일정은 팝업에서 고친다).
 *
 * 이번 단계에 **없는 것**(다음 PR): 구글 겹치기·공휴일 · 대시보드 캘린더 위젯.
 * 눌러도 아무 일이 없는 버튼은 두지 않는다 — 그래서 `구글 연결` 버튼은 아직 없다.
 */
export function CalendarView({
  state,
  controller,
  isMobile,
  onOpenNav,
}: {
  state: HomeState;
  controller: HomeController;
  isMobile: boolean;
  onOpenNav: () => void;
}) {
  const today = todayISO();
  const cardEntries = useCalendarEntries(state);
  // Geurio 일정(0033) — 칸반 마감과 나란한 두 번째 원천. 같은 `CalendarEntry` 모양으로
  // 만들어 격자·통계·목록·시간표가 종류를 가리지 않고 그린다.
  const eventsApi = useCalendarEvents(state.calY, state.calM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const entries = useMemo(() => {
    const evs = eventEntries(eventsApi.events);
    return [...cardEntries, ...evs].sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : (a.startTime ?? '') < (b.startTime ?? '') ? -1 : a.title < b.title ? -1 : 1));
  }, [cardEntries, eventsApi.events]);
  const shown = useMemo(() => filterByStat(entries, state.calFilter, today), [entries, state.calFilter, today]);
  const stats = useMemo(() => calendarStats(entries, today), [entries, today]);
  // 모바일은 칸이 좁아 칩 하나 + 접힌 개수만 — 사이드는 아예 접는다(공간이 없다).
  const perCell = isMobile ? 1 : 2;
  const cells = useMemo(() => monthCells(state.calY, state.calM, shown, today, perCell), [state.calY, state.calM, shown, today, perCell]);
  const selectedDay = state.calDay ?? today;
  // 칩이 얹히는 면 — hue는 칸반 팔레트, 밝기는 지금 홈 테마의 면에서(다크 대응).
  const surface = useMemo(() => homeChipSurface(state.theme), [state.theme]);
  const notNow = (() => {
    const now = new Date();
    return state.calY !== now.getFullYear() || state.calM !== now.getMonth() + 1;
  })();

  // 항목 클릭 = **상세 팝업**. 그 칸반으로 가는 길은 팝업 발치의 `이 칸반 열기`다 —
  // 클릭이 곧바로 화면을 떠나면 "날짜만 하루 미루기"에도 맵을 열어야 한다.
  const openEntry = (e: CalendarEntry): void => {
    // Geurio 일정과 칸반 카드는 고칠 것이 달라 팝업이 갈린다.
    if (e.event) controller.openCalendarEvent(e.event.id);
    else controller.openCalendarCard(e.docId, e.cardId);
  };

  return (
    <div data-calendar-view style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* 헤더 — 대시보드의 다크 히어로와 달리 **밝은 면**이다(디자인 원본). */}
      <div
        style={{
          flex: '0 0 auto',
          position: 'relative',
          background: 'var(--mf-panel2)',
          borderBottom: '1px solid var(--mf-border)',
          padding: isMobile ? '16px 16px 14px' : '24px 28px 20px',
          display: 'flex',
          alignItems: 'flex-end',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        {/* 캔버스의 점 격자를 축소한 바탕(디자인 원본) — 일정도 우리 화면임을 말한다. */}
        <div aria-hidden="true" style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(var(--mf-dot-grid) 1px, transparent 1px)', backgroundSize: '18px 18px', pointerEvents: 'none' }} />

        <div style={{ position: 'relative', flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ display: 'flex', alignItems: 'baseline', gap: 9, minWidth: 0 }}>
            {isMobile && (
              <button type="button" aria-label="메뉴 열기" onClick={onOpenNav} className="mf-ctl" style={{ width: 30, height: 30, marginRight: 2, border: 0, background: 'transparent', color: 'var(--mf-muted)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M4 7h16M4 12h16M4 17h16" />
                </svg>
              </button>
            )}
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--mf-accent-strong)', whiteSpace: 'nowrap' }}>마감을 한 달 단위로</span>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, color: 'var(--mf-faint)', whiteSpace: 'nowrap' }}>{dateLine(today)}</span>
          </span>

          <span style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', minWidth: 0 }}>
            <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 9, fontSize: isMobile ? 21 : 25, fontWeight: 800, letterSpacing: '-.035em', color: 'var(--mf-text)', whiteSpace: 'nowrap' }}>
              <span style={{ width: 30, height: 30, flexShrink: 0, borderRadius: 10, background: 'var(--mf-accent-soft)', color: 'var(--mf-accent-strong)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                <CalendarGlyph size={16} />
              </span>
              일정
            </h2>
            <span aria-hidden="true" style={{ width: 1, height: 20, background: 'var(--mf-border)', flexShrink: 0 }} />
            {/* 월 이동 */}
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, height: 32, padding: '0 3px', borderRadius: 999, border: '1px solid var(--mf-border)', background: 'var(--mf-card)' }}>
              <MonthNav label="이전 달" d="m15 6-6 6 6 6" onClick={() => controller.calShiftMonth(-1)} />
              <span data-cal-month style={{ minWidth: 92, textAlign: 'center', fontSize: 12.5, fontWeight: 800, letterSpacing: '-.02em', color: 'var(--mf-text)' }}>{monthLabel(state.calY, state.calM)}</span>
              <MonthNav label="다음 달" d="m9 6 6 6-6 6" onClick={() => controller.calShiftMonth(1)} />
            </span>
            <button
              type="button"
              data-cal-new
              onClick={() => controller.openNewEvent(state.calDay ?? today, true)}
              className="mf-ctl"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 14px', borderRadius: 999, border: 0, background: 'linear-gradient(180deg, var(--mf-accent), var(--mf-accent-strong))', color: 'var(--mf-accent-ink)', font: 'inherit', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap', boxShadow: '0 8px 18px -12px rgba(var(--mf-accent-rgb), .9)' }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
              새 일정
            </button>
            {notNow && (
              <button type="button" onClick={controller.calGoToday} className="mf-ctl" style={{ height: 28, padding: '0 13px', borderRadius: 999, border: '1px solid var(--mf-accent-mute)', background: 'var(--mf-accent-soft)', color: 'var(--mf-accent-strong)', font: 'inherit', fontSize: 11.5, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                오늘로
              </button>
            )}
          </span>
        </div>

        {/* 우측: 사이드가 보여 줄 것 고르기(데스크톱 전용 — 모바일엔 사이드가 없다) */}
        {!isMobile && (
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, paddingBottom: 2 }}>
            <SideToggle on={state.calSide === 'list'} label="마감 목록" onClick={() => controller.setCalSide('list')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M8 6h13M8 12h13M8 18h13" />
                <circle cx="3.5" cy="6" r="1.2" fill="currentColor" stroke="none" />
                <circle cx="3.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
                <circle cx="3.5" cy="18" r="1.2" fill="currentColor" stroke="none" />
              </svg>
            </SideToggle>
            <SideToggle on={state.calSide === 'day'} label="날짜별 보기" onClick={() => controller.setCalSide('day')}>
              <CalendarGlyph size={14} />
            </SideToggle>
          </div>
        )}
      </div>

      {/* 본문 */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'stretch', minWidth: 0, background: 'var(--mf-bg)' }}>
        <div className="lnb-scroll" style={{ flex: '1 1 0', minWidth: 0, minHeight: 0, padding: isMobile ? '12px 14px 18px' : '16px 8px 20px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* 통계 = 필터.
              디자인 원본의 칩은 **면도 테두리도 없다**(`chipBg: 'transparent'`, hover에서만
              옅은 면) — 점 + 라벨 + 등폭 숫자만으로 읽힌다. 예전 판은 테두리 있는 알약이라
              태그 무리처럼 보였다(제보). 켜진 칩만 옅은 강조 면으로 알린다(원본에는 없는
              상태 — 우리 칩은 필터이므로 켜짐이 보여야 한다). */}
          <div data-cal-stats style={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', flexShrink: 0 }}>
            {stats.map((s) => {
              const on = state.calFilter === s.key;
              const zero = s.count === 0;
              return (
                <button
                  key={s.key}
                  type="button"
                  data-cal-stat={s.key}
                  aria-pressed={on}
                  onClick={() => controller.toggleCalFilter(s.key)}
                  // 면(꺼짐·hover·켜짐)은 `home.css`의 `.mf-cal-chip`이 정한다 —
                  // 인라인으로 두면 hover 규칙과 싸운다(그래서 `.mf-ctl`을 쓰지 않는다).
                  className="mf-cal-chip"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 7,
                    height: 30,
                    padding: '0 10px',
                    borderRadius: 999,
                    border: 0,
                    font: 'inherit',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: 999, background: zero ? 'var(--mf-border)' : STAT_DOT[s.key], flexShrink: 0 }} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--mf-muted)', whiteSpace: 'nowrap' }}>{s.label}</span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5, fontWeight: zero ? 600 : s.key === 'over' || s.key === 'today' ? 800 : 700, color: zero ? 'var(--mf-faint)' : STAT_FG[s.key], whiteSpace: 'nowrap' }}>
                    {s.count}
                    {s.unit}
                  </span>
                </button>
              );
            })}
          </div>

          <MonthGrid
            cells={cells}
            selected={state.calDay}
            surface={surface}
            compact={isMobile}
            onPickDay={controller.selectCalDay}
            onPickEntry={openEntry}
            onMore={controller.selectCalDay}
            onShift={(e, days) => void controller.shiftCalendarCard(e.docId, e.cardId, days)}
          />
        </div>

        {!isMobile && (
          <CalendarSide
            entries={shown}
            todayIso={today}
            y={state.calY}
            m={state.calM}
            side={state.calSide}
            surface={surface}
            selectedDay={selectedDay}
            onPickDay={controller.selectCalDay}
            onPickEntry={openEntry}
            onSetMonth={controller.setCalMonth}
            onNewEvent={(iso) => controller.openNewEvent(iso, true)}
          />
        )}
      </div>

      {/* 항목 상세 — 열려 있으면 그 항목을 찾아 그린다(사라졌으면 조용히 닫힌다). */}
      <CalendarDetailHost state={state} controller={controller} entries={entries} isMobile={isMobile} />

      {/* Geurio 일정: 새로 만들기 · 상세 */}
      {state.calNewEvent && (
        <NewEventModal
          draft={state.calNewEvent}
          isMobile={isMobile}
          saving={saving}
          error={saveError}
          onClose={() => {
            setSaveError(null);
            controller.closeNewEvent();
          }}
          onSubmit={(input) => {
            setSaving(true);
            void eventsApi.create(input).then((err) => {
              setSaving(false);
              setSaveError(err);
              if (!err) controller.closeNewEvent();
            });
          }}
        />
      )}
      {(() => {
        const ev = state.calEventDetail ? eventsApi.events.find((e) => e.id === state.calEventDetail) : null;
        if (!ev) return null;
        return (
          <EventDetail
            event={ev}
            isMobile={isMobile}
            onClose={controller.closeCalendarEvent}
            onPatch={(patch) => eventsApi.update(ev.id, patch)}
            onDelete={() => eventsApi.remove(ev.id)}
          />
        );
      })()}
    </div>
  );
}

/** 전 스페이스 + 공유받은 맵의 칸반 마감. 본문은 `previewDocs`(썸네일이 받아 둔 것). */
function useCalendarEntries(state: HomeState): CalendarEntry[] {
  return useMemo(() => {
    const sources: CalendarSource[] = [];
    for (const sp of state.spaces) {
      if (sp.id === 'drive') continue; // Drive 데모에는 우리 문서가 없다
      for (const mp of Array.isArray(sp.maps) ? sp.maps : []) {
        if (mp.docId) sources.push({ docId: mp.docId, boardName: mp.title, spaceName: sp.name });
      }
    }
    // 공유받은 맵도 내 일정이다 — 다만 스페이스가 없으므로 구획 이름으로 표기한다.
    // 보기 전용(role='view')이면 그대로 실어 보낸다: 끌리지도, 고쳐지지도 않는다.
    for (const sm of state.sharedMaps) sources.push({ docId: sm.docId, boardName: sm.title, spaceName: '공유받음', ...(sm.role === 'view' ? { readOnly: true } : {}) });
    return calendarEntries(sources, state.previewDocs);
  }, [state.spaces, state.sharedMaps, state.previewDocs]);
}

// 중요도 순서(디자인 원본의 TONE): 지난 마감(놓친 것) > 오늘 > 이번 주 > 기간.
const STAT_DOT: Record<string, string> = { over: 'var(--mf-danger)', today: 'var(--mf-accent)', week: 'var(--mf-star)', span: 'var(--mf-faint2)' };
const STAT_FG: Record<string, string> = { over: 'var(--mf-danger)', today: 'var(--mf-accent-strong)', week: 'var(--mf-star)', span: 'var(--mf-muted)' };

/** `8월 26일 수요일` — 헤더의 오늘 표기. */
function dateLine(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return '';
  const d = new Date(+m[1]!, +m[2]! - 1, +m[3]!);
  return `${+m[2]!}월 ${+m[3]!}일 ${['일', '월', '화', '수', '목', '금', '토'][d.getDay()]}요일`;
}

function MonthNav({ label, d, onClick }: { label: string; d: string; onClick: () => void }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} className="mf-ctl" style={{ width: 26, height: 26, borderRadius: 999, border: 0, background: 'transparent', color: 'var(--mf-muted)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={d} />
      </svg>
    </button>
  );
}

function SideToggle({ on, label, onClick, children }: { on: boolean; label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={on}
      onClick={onClick}
      className="mf-ctl"
      style={{
        width: 34,
        height: 34,
        borderRadius: 999,
        border: `1px solid ${on ? 'var(--mf-accent-mute)' : 'var(--mf-border)'}`,
        background: on ? 'var(--mf-accent-soft)' : 'var(--mf-card)',
        color: on ? 'var(--mf-accent-strong)' : 'var(--mf-muted)',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {children}
    </button>
  );
}

/** 일정의 표식 — LNB 행·헤더 칩·사이드 토글이 같은 글리프를 쓴다(디자인 원본). */
export function CalendarGlyph({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
      <path d="M8 3v4M16 3v4M3.5 10h17" />
      <circle cx="12" cy="15.5" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

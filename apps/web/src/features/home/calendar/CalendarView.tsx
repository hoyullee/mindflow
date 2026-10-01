import { useEffect, useMemo, useRef, useState } from 'react';
import type { HomeState } from '../types';
import type { HomeController } from '../useHomeController';
import type { CalendarEntry } from './entries';
import { useCalendarEntries } from './useCalendarEntries';
import { homeChipSurface, UNREAD_BADGE_BG } from '../theme';
import { useNavDot } from '../components/navDot';
import { DOW, addDays, calendarBrief, gridRange, monthCells, monthLabel, partsOf, todayISO } from './model';
import { MonthGrid } from './MonthGrid';
import { DayListPopup } from './DayListPopup';
import { CalendarSide } from './CalendarSide';
import { MonthPicker } from './MonthPicker';
import { CalendarDetailHost } from './CalendarDetail';
import { NewEventModal } from './NewEventModal';
import { geurioColorOptions } from './eventColor';
import { submitNewEvent } from './newEventSubmit';
import { googleDirectoryOf, googleTargetsOf } from './googleWiring';
import { EventDetail, geurioCalendarChips } from './EventDetail';
import { GoogleDetailHost, patchFrom } from './GoogleEventDetail';
import { WorkLocationModal } from './WorkLocationModal';
import { findWorkLocation, type WorkLocationDraft } from './googleCalendar';
import { CalendarContextMenu, type CalMenuState } from './CalendarContextMenu';
import { DeleteConfirm } from './DeleteConfirm';
import { useCalendarEvents } from './useCalendarEvents';
import { eventEntries, googleEntries, holidayMap, workMap } from './entries';
import { googlePrefsOf, useGoogleCalendar } from './useGoogleCalendar';
import { MobileCalendar } from './MobileCalendar';
import { MobileCalendarsSheet } from './MobileCalendarsSheet';

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
/** 모델은 접지 않는다 — 몇 줄이 들어가는지는 격자가 실측해서 정한다(제보 #1). */
const MONTH_CELL_ALL = 99;
/** 본문 행이 이보다 좁으면 오른쪽 패널이 달력 위에 **겹친다**(스펙 4 — 오버레이 324px). */
const SIDE_OVERLAY_BELOW = 880;

export function CalendarView({
  state,
  controller,
  isMobile,
  onOpenNav,
}: {
  state: HomeState;
  controller: HomeController;
  isMobile: boolean;
  /** 폰의 ☰(서랍 열기). 하단 탭이 생긴 뒤로 홈은 넘기지 않는다 — 없으면 단추도 없다. */
  onOpenNav?: () => void;
}) {
  const today = todayISO();
  // 폰 ☰의 점 — 알림이 LNB로 옮겨 갔으므로 이 화면의 문에도 표시가 있어야 한다.
  const navDot = useNavDot();
  const cardEntries = useCalendarEntries(state);
  // Geurio 일정(0033) — 칸반 마감과 나란한 두 번째 원천. 같은 `CalendarEntry` 모양으로
  // 만들어 격자·통계·목록·시간표가 종류를 가리지 않고 그린다.
  const eventsApi = useCalendarEvents(state.calY, state.calM);
  // 구글 캘린더(PR5 겹치기 + PR6 쓰기). 연동하지 않았으면 빈 배열이라 아래 계산이
  // 예전과 한 글자도 다르지 않다.
  const google = useGoogleCalendar(state.calY, state.calM, googlePrefsOf(state.google), controller.setGoogleCalendars);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // 날짜 칸 더블클릭·`+N개 더`가 여는 "그 날의 일정 전부"(디자인 원본 `dayList`).
  // 툴팁이라 누른 지점(화면 좌표)까지 함께 든다 — 그 곁에 선다.
  const [dayList, setDayList] = useState<{ iso: string; at: { x: number; y: number } } | null>(null);
  // 우클릭 메뉴(요청 ④) — 대상은 우클릭한 자리가 정한다(항목·날짜·화면).
  const [menu, setMenu] = useState<CalMenuState | null>(null);
  // 폰의 「보여 줄 캘린더」 시트(N7).
  const [calendarsSheet, setCalendarsSheet] = useState(false);
  // 메뉴에서 고른 삭제는 **한 번 묻는다** — 파괴적 동작이 메뉴 클릭 하나로 끝나지
  // 않게(상세 팝업의 삭제와 같은 확인창을 쓴다).
  const [confirmDel, setConfirmDel] = useState<CalendarEntry | null>(null);
  const [deleting, setDeleting] = useState(false);
  // 근무 위치를 고치는 날(요청) — 열려 있으면 그 날짜다.
  const [workDay, setWorkDay] = useState<string | null>(null);
  // 저장·지우기 중에는 **어느 쪽이 도는지**까지 들고 있다 — 지우는 중에 저장
  // 버튼이 "저장 중…"이라 말하면 거짓말이 된다(팝업이 버튼마다 갈라 쓴다).
  const [workSaving, setWorkSaving] = useState<'save' | 'clear' | null>(null);
  const [workError, setWorkError] = useState<string | null>(null);
  const entries = useMemo(() => {
    // 반복 일정은 보이는 구간에서 회차로 펼쳐진다 — 격자가 그리는 그 6주다.
    const evs = eventEntries(eventsApi.events, gridRange(state.calY, state.calM));
    const gs = googleEntries(google.events);
    return [...cardEntries, ...evs, ...gs].sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : (a.startTime ?? '') < (b.startTime ?? '') ? -1 : a.title < b.title ? -1 : 1));
  }, [cardEntries, eventsApi.events, google.events, state.calY, state.calM]);
  // 공휴일은 칩이 아니라 **날짜 색**이다(PR1부터 비워 둔 `MonthCell.holiday` 자리).
  const holidays = useMemo(() => holidayMap(google.events), [google.events]);
  // 근무 위치(재택·사무실)는 일정 목록이 아니라 칸 우측 상단에 그린다(제보 ⑥).
  const works = useMemo(() => workMap(google.events), [google.events]);
  /**
   * 근무 위치를 **쓸 수 있는가**(요청) — 구글은 이 일정을 기본 캘린더에만 받는다.
   * 게다가 그 캘린더를 지금 보고 있지 않으면 고른 값이 화면에 나타나지 않으므로
   * (고장으로 읽힌다) 켜져 있을 때만 진입점을 낸다.
   */
  const workCalendar = useMemo(() => {
    const primary = google.writableCalendars.find((c) => c.primary);
    return primary && google.pickedIds.includes(primary.id) ? primary : null;
  }, [google.writableCalendars, google.pickedIds]);
  // 헤더 요약 줄의 세 수(스펙 2.1) — **칸반 마감만** 센다. LNB `일정` 행과 같은 함수·같은
  // 원천이라 두 자리가 다른 수를 말하지 않는다(구글·Geurio 일정은 "마감"이 아니다).
  const brief = useMemo(() => calendarBrief(cardEntries, today), [cardEntries, today]);
  // 오른쪽 패널이 설 자리가 있는가 — 본문 행의 **실제 폭**으로 정한다(창 폭이 아니라:
  // LNB를 접고 펴는 것만으로도 달라진다). 못 재는 환경(0)에서는 나란히 선다.
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const read = (): void => {
      const w = el.clientWidth;
      setNarrow(w > 0 && w < SIDE_OVERLAY_BELOW);
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // 새 일정의 목적지·선택 스코프 — **공책의 날짜 칩 팝오버도 같은 팝업을 띄우므로**
  // 파생은 한 자리에 둔다(`googleWiring`). 둘로 흩어지면 한쪽만 고쳐진다.
  const googleTargets = useMemo(() => googleTargetsOf(google), [google]);
  const googleDirectory = useMemo(() => googleDirectoryOf(google), [google]);
  // 칸에 몇 개를 보여 줄지는 **격자가 자기 칸 높이를 재서** 정한다(제보: 여유가
  // 남는데도 `+N개 더`가 떴다). 모델은 접지 않고 그 날의 항목을 전부 싣는다.
  const cells = useMemo(() => monthCells(state.calY, state.calM, entries, today, MONTH_CELL_ALL, 6, holidays, works), [state.calY, state.calM, entries, today, holidays, works]);
  const selectedDay = state.calDay ?? today;
  // 칩이 얹히는 면 — hue는 칸반 팔레트, 밝기는 지금 홈 테마의 면에서(다크 대응).
  const surface = useMemo(() => homeChipSurface(state.theme), [state.theme]);
  // 연/월 피커가 "이번 달"을 알아보는 기준.
  const nowYM = (() => {
    const n = new Date();
    return { y: n.getFullYear(), m: n.getMonth() + 1 };
  })();
  const notNow = (() => {
    const now = new Date();
    return state.calY !== now.getFullYear() || state.calM !== now.getMonth() + 1;
  })();

  /** 근무 위치 팝업 열기 — 열 때 이전 오류를 비운다(지난 실패가 새 시도를 덮지 않게). */
  const openWork = (iso: string): void => {
    setWorkError(null);
    setWorkDay(iso);
  };

  /**
   * 근무 위치를 쓴다 — 고른 구간의 **하루하루**에 건다(있으면 고치고 없으면 만든다).
   *
   * 구간을 일정 하나에 담지 않는 이유는 구글이 그렇게 못박아 뒀기 때문이다(라이브
   * 제보의 400 `malformedWorkingLocationEvent`: 종일 근무 위치는 반드시 하루).
   * 하루하루를 도는 일은 훅이 맡는다 — 저장·새로 읽기·오류 문장이 한 곳에 있다.
   */
  const saveWork = (draft: WorkLocationDraft): void => {
    if (!workCalendar) return;
    setWorkSaving('save');
    void google.saveWorkLocation(workCalendar.id, draft).then((err) => {
      setWorkSaving(null);
      setWorkError(err);
      if (!err) setWorkDay(null);
    });
  };

  const clearWork = (iso: string): void => {
    const cur = findWorkLocation(google.events, iso);
    if (!cur) {
      setWorkDay(null);
      return;
    }
    setWorkSaving('clear');
    void google.deleteEvent(cur).then((err) => {
      setWorkSaving(null);
      setWorkError(err);
      if (!err) setWorkDay(null);
    });
  };

  /**
   * 끌어서 날짜를 옮긴다 — **원천마다 쓰는 곳이 다르다.** 예전에는 칸반 카드만
   * 보고 있어서 Geurio 일정을 끌면 조용히 아무 일도 없었다(구글은 읽기 전용이었다).
   */
  const shiftEntry = async (e: CalendarEntry, days: number): Promise<void> => {
    if (!days) return;
    if (e.google) {
      const g = e.google;
      if (!g.writable) return;
      // 옮기는 것은 날짜뿐이다 — PATCH도 그 짝만 싣는다(제목·참석자를 다시 쓰지 않는다).
      const err = await google.updateEvent(g, patchFrom(g, { startDate: addDays(g.startDate, days), endDate: addDays(g.endDate, days) }));
      if (err) controller.showCalendarToast('구글 일정을 옮기지 못했어요', err);
      return;
    }
    if (e.event) {
      const ev = e.event;
      const err = await eventsApi.update(ev.id, { startDate: addDays(ev.startDate, days), endDate: addDays(ev.endDate, days) });
      if (err) controller.showCalendarToast('일정을 옮기지 못했어요', err);
      return;
    }
    await controller.shiftCalendarCard(e.docId, e.cardId, days);
  };

  // 항목 클릭 = **상세 팝업**. 그 칸반으로 가는 길은 팝업 발치의 `이 칸반 열기`다 —
  // 클릭이 곧바로 화면을 떠나면 "날짜만 하루 미루기"에도 맵을 열어야 한다.

  const openEntry = (e: CalendarEntry): void => {
    // Geurio 일정과 칸반 카드는 고칠 것이 달라 팝업이 갈린다.
    // 구글 일정은 **읽기 전용 팝업**으로 — 우리 상세는 고칠 수 있는 척한다.
    if (e.google) controller.openCalendarGoogle(e.google.id);
    // 반복 일정은 눌린 **회차**(그 회차의 시작일)까지 — 삭제 범위의 기준이 된다.
    else if (e.event) controller.openCalendarEvent(e.event.id, e.event.recurrence ? (e.start ?? e.due) : undefined);
    else controller.openCalendarCard(e.docId, e.cardId);
  };

  /** 그 항목의 원천으로 — 칸반이면 그 보드, 구글이면 구글 캘린더(새 탭). */
  const openSource = (e: CalendarEntry): void => {
    if (e.google) {
      if (e.google.htmlLink) window.open(e.google.htmlLink, '_blank', 'noopener,noreferrer');
      return;
    }
    if (e.event) return;
    controller.openWithLoader(`/editor?map=${encodeURIComponent(e.docId)}&title=${encodeURIComponent(e.boardName)}&docId=${encodeURIComponent(e.docId)}`, e.boardName, e.docId);
  };

  /** 메뉴에서 고른 삭제 — 원천마다 지우는 곳이 다르다(옮기기와 같은 갈림). */
  const removeEntry = async (e: CalendarEntry): Promise<string | null> => {
    if (e.google) return e.google.writable ? google.deleteEvent(e.google) : '이 캘린더에는 쓸 수 없어요';
    if (e.event) return eventsApi.remove(e.event.id);
    const ok = await controller.deleteCalendarCard(e.docId, e.cardId);
    return ok ? null : '카드를 지우지 못했어요';
  };

  // 요약 줄(스펙 2.1) — 오늘 날짜 + 0이 아닌 수만, **오늘 마감 → 이번 주 → 지난 마감** 순.
  const todayParts = partsOf(today);
  const todayText = todayParts ? `${todayParts.m}월 ${todayParts.d}일 ${DOW[new Date(todayParts.y, todayParts.m - 1, todayParts.d).getDay()]}요일` : today;
  const summary = [
    { key: 'today', label: '오늘 마감', n: brief.today, color: 'var(--mf-accent-strong)' },
    { key: 'week', label: '이번 주', n: brief.week, color: 'var(--mf-subtext)' },
    { key: 'over', label: '지난 마감', n: brief.overdue, color: 'var(--mf-stat-over)' },
  ].filter((it) => it.n > 0);
  const sideOpen = !isMobile && state.calSide === 'day';
  const overlay = sideOpen && narrow;
  const closeSide = (): void => controller.setCalSide('day');

  return (
    <div data-calendar-view style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {isMobile ? (
        /* 폰 — 달력엔 점만, 고른 날은 아래 목록(모바일 홈 디자인 M3). 상세·새 일정 팝업은
           아래의 같은 호스트가 띄운다. */
        <MobileCalendar
          y={state.calY}
          m={state.calM}
          todayIso={today}
          selectedDay={selectedDay}
          cells={cells}
          entries={entries}
          holidays={holidays}
          brief={brief}
          surface={surface}
          onSetMonth={controller.setCalMonth}
          onPickDay={controller.selectCalDay}
          onPickEntry={openEntry}
          onNewEvent={(iso) => controller.openNewEvent(iso, true)}
          onOpenCalendars={() => setCalendarsSheet(true)}
        />
      ) : (
        <>
        {/* 헤더 — **월 제목이 곧 타이틀**이다(스펙 2). 아이콘 타일·`일정` 제목·부제·알약형 월
            이동기는 걷었다(스펙 6): 이 화면에서 "지금 어디를 보고 있는가"의 답은 `2026년 8월`
            하나다. 바탕은 캔버스의 점 격자를 옅게 축소한 띠 — 아래 경계선은 **없다**(요일 줄의
            위 선이 헤더와 달력의 유일한 경계). */}
        <header
          data-cal-head
          style={{
            flex: '0 0 auto',
            position: 'relative',
            padding: isMobile ? '12px 14px 12px 16px' : '20px 20px 16px 32px',
            backgroundColor: 'var(--mf-cal-head)',
            backgroundImage: 'radial-gradient(var(--mf-cal-head-dot) 1px, transparent 1px)',
            backgroundSize: '18px 18px',
            backgroundPosition: '-9px -9px',
            display: 'flex',
            alignItems: isMobile ? 'flex-start' : 'center',
            // 폰은 줄을 넘기지 않는다 — 요약 줄이 제목 묶음 **안에서** 접히고, ＋는 제목 줄 끝에 선다.
            flexWrap: isMobile ? 'nowrap' : 'wrap',
            gap: isMobile ? 8 : 14,
          }}
        >
          <div data-cal-title-group style={{ display: 'flex', flexDirection: 'column', minWidth: 0, ...(isMobile ? { flex: '1 1 0' } : {}) }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: -8, minWidth: 0 }}>
              {isMobile && onOpenNav && (
                <button type="button" title={navDot.title} aria-label={navDot.label} onClick={onOpenNav} className="mf-ctl" style={{ position: 'relative', width: 30, height: 30, border: 0, borderRadius: 10, background: 'transparent', color: 'var(--mf-muted)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <path d="M4 7h16M4 12h16M4 17h16" />
                  </svg>
                  {/* 알림은 이제 LNB에 있다 — 서랍이 닫혀 있어도 그 사실이 보이게. */}
                  {navDot.on && <span data-unread-dot aria-hidden="true" style={{ position: 'absolute', top: 2, right: 2, width: 8, height: 8, borderRadius: '50%', background: UNREAD_BADGE_BG, border: '2px solid var(--mf-page)' }} />}
                </button>
              )}
              <MonthNav label="이전 달" d="m15 6-6 6 6 6" onClick={() => controller.calShiftMonth(-1)} />
              {/* 월 제목을 누르면 연/월을 바로 고른다(달을 여러 번 넘기지 않게). */}
              <MonthPicker y={state.calY} m={state.calM} now={nowYM} label={monthLabel(state.calY, state.calM)} onPick={controller.setCalMonth} compact={isMobile} />
              <MonthNav label="다음 달" d="m9 6 6 6-6 6" onClick={() => controller.calShiftMonth(1)} />
              {notNow && (
                <button
                  type="button"
                  data-cal-today
                  onClick={controller.calGoToday}
                  className="mf-cal-pill"
                  style={{ flexShrink: 0, height: 28, marginLeft: 6, padding: '0 12px', borderRadius: 99, border: '1px solid var(--mf-border)', background: 'var(--mf-card)', color: 'var(--mf-subtext)', font: 'inherit', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
                >
                  오늘
                </button>
              )}
            </div>
            {/* 요약 한 줄 — 예전의 통계 칩(줄 하나 + 팝오버)을 **글자**로 접었다(스펙 2.1).
                0인 항목은 적지 않는다: "지난 마감 0"은 읽을 거리가 아니다. 들여쓰기는 월
                제목의 글자 시작에 맞춘다(‹ 버튼 폭만큼). */}
            <div data-cal-head-summary style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, paddingLeft: isMobile ? 66 : 32, marginTop: 2, rowGap: 2, minWidth: 0 }}>
              <span data-cal-head-date style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: '-.01em', color: 'var(--mf-cal-num)', whiteSpace: 'nowrap' }}>
                {todayText}
              </span>
              {summary.map((it) => (
                <span key={it.key} data-cal-head-stat={it.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 10, whiteSpace: 'nowrap' }}>
                  <span aria-hidden="true" style={{ width: 3, height: 3, borderRadius: 99, background: 'var(--mf-faint2)', flexShrink: 0 }} />
                  <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 5 }}>
                    <span style={{ fontSize: 12.5, color: 'var(--mf-muted)' }}>{it.label}</span>
                    <span data-cal-head-n style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 700, color: it.color }}>
                      {it.n}
                    </span>
                  </span>
                </span>
              ))}
            </div>
          </div>

          {!isMobile && <span aria-hidden="true" style={{ flex: '1 1 0', minWidth: 0 }} />}

          {/* 우측: 만들기 + 날짜별 보기. 구글 연결(G) 단추는 **두지 않는다**(스펙 6) — 연동은
              설정 › 계정에서 켜고, 다시 이어야 할 때는 LNB 일정 행의 경고 점이 말한다. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, alignSelf: isMobile ? 'flex-start' : undefined }}>
            <button
              type="button"
              data-cal-new
              onClick={() => controller.openNewEvent(state.calDay ?? today, true)}
              // 단색 코랄 알약(스펙 2.2) — 그라디언트·그늘 없이, hover는 한 톤 짙은 면.
              // 폰에서는 32px 원 ＋ 하나 — 글자까지 두면 월 제목 줄에 서지 못하고 한 줄을
              // 통째로 차지한다(실측: 390px 폭에서 60px이 빈 줄이 됐다).
              className="mf-cal-new"
              aria-label="새 일정"
              title="새 일정"
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, height: 32, width: isMobile ? 32 : undefined, padding: isMobile ? 0 : '0 15px', borderRadius: 99, border: 0, background: 'var(--mf-accent)', color: 'var(--mf-accent-ink)', font: 'inherit', fontSize: 13, fontWeight: 800, letterSpacing: '-.015em', cursor: 'pointer', whiteSpace: 'nowrap', flex: '0 0 auto' }}
            >
              <svg width={isMobile ? 14 : 12} height={isMobile ? 14 : 12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
              {!isMobile && '새 일정'}
            </button>
            {!isMobile && (
              <SideToggle on={state.calSide === 'day'} label="날짜별 보기" onClick={() => controller.setCalSide('day')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
                  <path d="M14.5 4.5v15" />
                </svg>
              </SideToggle>
            )}
          </div>
        </header>

        {/* 본문 행 — 달력(남는 폭 전부) + 오른쪽 패널(300px). 패널은 **헤더 아래에서** 시작한다
            (헤더는 전체 폭). 폭이 모자라면 패널이 달력 위에 겹치고 막이 깔린다(스펙 4). */}
        <div ref={bodyRef} data-cal-body data-cal-side-mode={sideOpen ? (overlay ? 'overlay' : 'dock') : undefined} style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', alignItems: 'stretch', minWidth: 0, background: 'var(--mf-page)' }}>
          <div
            data-cal-canvas
            className="lnb-scroll"
            // 칸·칩이 아닌 자리의 우클릭 = **화면 메뉴**(새 일정 · 오늘로 · 사이드 토글).
            // 칸·칩은 자기 메뉴를 열고 전파를 끊으므로 여기까지 오지 않는다.
            onContextMenu={(e) => {
              const t = e.target as HTMLElement;
              if (t.closest?.('input, textarea, [contenteditable="true"], .mf-home-ctx')) return;
              e.preventDefault();
              setMenu({ target: { view: true }, x: e.clientX, y: e.clientY });
            }}
            // 카드도 여백도 없다(스펙 3) — 격자가 스크롤 영역을 좌우 끝까지, 남은 높이까지 채운다.
            style={{ flex: '1 1 0', minWidth: 0, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column' }}
          >
            <MonthGrid
              cells={cells}
              selected={state.calDay ?? today}
              surface={surface}
              compact={isMobile}
              onPickDay={controller.selectCalDay}
              onOpenDayList={(iso, at) => setDayList({ iso, at })}
              onPickEntry={openEntry}
              // `+N개 더`도 같은 팝업이다 — 접힌 것을 보려는 클릭이니 전부를 보여 준다
              // (디자인 원본 `onMore`도 dayList를 연다).
              onMore={(iso, at) => setDayList({ iso, at })}
              onShift={(e, days) => void shiftEntry(e, days)}
              onCtxMenu={(target, at) => setMenu({ target, x: at.x, y: at.y })}
              // 칸의 근무 위치 태그를 누르면 그 날의 팝업(요청 ③) — 쓸 수 없으면 넘기지
              // 않아 태그가 누를 것 없는 표식으로 남는다(정직한 어포던스).
              {...(workCalendar ? { onWorkLoc: openWork } : {})}
            />
          </div>

          {overlay && <div data-cal-scrim aria-hidden="true" onClick={closeSide} style={{ position: 'absolute', inset: 0, zIndex: 5, background: 'rgba(46,42,38,.18)', animation: 'mf-dim-in .18s ease' }} />}
          {sideOpen && (
            <CalendarSide
              frame="page"
              overlay={overlay}
              holidays={holidays}
              entries={entries}
              todayIso={today}
              y={state.calY}
              m={state.calM}
              surface={surface}
              selectedDay={selectedDay}
              onPickDay={controller.selectCalDay}
              onPickEntry={openEntry}
              onSetMonth={controller.setCalMonth}
              // 시간표의 빈 시간대에서 열면 **시각이 있는** 일정으로 시작한다.
              onNewEvent={(iso, at) => controller.openNewEvent(iso, !at, at)}
            />
          )}
        </div>
        </>
      )}
      {isMobile && <MobileCalendarsSheet open={calendarsSheet} onClose={() => setCalendarsSheet(false)} state={state} controller={controller} />}

      {/* 그 날의 일정 전부 — 행을 고르면 닫고 그 항목의 상세로 잇는다. */}
      {dayList && (
        <DayListPopup
          iso={dayList.iso}
          at={dayList.at}
          entries={entries}
          {...(holidays[dayList.iso] ? { holiday: holidays[dayList.iso] } : {})}
          surface={surface}
          {...(workCalendar ? { onWorkLocation: (iso: string) => { setDayList(null); openWork(iso); } } : {})}
          {...(works[dayList.iso] ? { workLocation: works[dayList.iso] } : {})}
          onClose={() => setDayList(null)}
          onPickEntry={(e) => {
            setDayList(null);
            openEntry(e);
          }}
          onNew={(iso) => {
            setDayList(null);
            controller.openNewEvent(iso, true);
          }}
        />
      )}

      {/* 항목 상세 — 열려 있으면 그 항목을 찾아 그린다(사라졌으면 조용히 닫힌다). */}
      <CalendarDetailHost state={state} controller={controller} entries={entries} isMobile={isMobile} />
      <GoogleDetailHost
        calendarDefaults={google.calendarDefaults}
        openId={state.calGoogleDetail ?? null}
        events={google.events}
        isMobile={isMobile}
        onClose={controller.closeCalendarGoogle}
        onPatch={google.updateEvent}
        onDelete={google.deleteEvent}
        directory={googleDirectory}
        colors={google.eventColors}
      />

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
          googleTargets={googleTargets}
          directory={googleDirectory}
          googleColors={google.eventColors}
          onSubmit={(input, target) => {
            setSaving(true);
            void submitNewEvent(
              input,
              target,
              {
                createGeurio: eventsApi.create,
                createGoogle: google.createEvent,
              },
              google.selfEmail,
            ).then((err) => {
              setSaving(false);
              setSaveError(err);
              if (!err) controller.closeNewEvent();
            });
          }}
        />
      )}
      {/* 근무 위치(요청) — 구글의 기본 캘린더에 쓴다(구간은 하루씩 여러 개). */}
      {workDay && (
        <WorkLocationModal
          iso={workDay}
          current={(() => {
            const cur = findWorkLocation(google.events, workDay);
            if (!cur) return null;
            return {
              kind: cur.workLocationKind ?? null,
              label: cur.workLocation ?? '',
              startDate: cur.startDate,
              endDate: cur.endDate,
              ...(cur.startTime ? { startTime: cur.startTime } : {}),
              ...(cur.endTime ? { endTime: cur.endTime } : {}),
              // 반복 회차인가 — 그러면 되풀이는 고르는 값이 아니라 상태다(요청 ④).
              ...(cur.recurringEventId ? { recurring: true } : {}),
            };
          })()}
          isMobile={isMobile}
          saving={workSaving}
          error={workError}
          onClose={() => setWorkDay(null)}
          onSave={(draft) => saveWork(draft)}
          onClear={() => clearWork(workDay)}
        />
      )}
      {/* 우클릭 메뉴 — 껍데기는 홈의 그 메뉴이고 항목만 이 화면의 것이다. */}
      <CalendarContextMenu
        menu={menu}
        ctx={{
          todayIso: today,
          selectedDay,
          y: state.calY,
          m: state.calM,
          dayCount: (iso) => entries.filter((e) => (e.start ?? e.due) <= iso && iso <= e.due).length,
          sideOpen: state.calSide === 'day',
          isMobile,
          workLocation: (iso) => works[iso],
        }}
        actions={{
          onClose: () => setMenu(null),
          openEntry,
          openSource,
          shiftEntry: (e, days) => void shiftEntry(e, days),
          askDelete: (e) => setConfirmDel(e),
          newEvent: (iso) => controller.openNewEvent(iso, true),
          openDayList: (iso, at) => setDayList({ iso, at }),
          ...(workCalendar ? { openWorkLocation: (iso: string) => openWork(iso) } : {}),
          // 그 날을 골라 날짜별 보기를 **편다**(이미 펴져 있으면 그대로 — 예전에는 토글을
          // 거쳐 열려 있던 패널이 닫혔다).
          openDaySide: (iso) => controller.showCalDay(iso),
          toggleSide: () => controller.setCalSide('day'),
          goToday: () => {
            controller.calGoToday();
            controller.selectCalDay(today);
          },
        }}
      />

      {confirmDel && (
        <DeleteConfirm
          title={confirmDel.google || confirmDel.event ? '일정을 삭제할까요?' : '카드를 삭제할까요?'}
          body={`${confirmDel.title.trim() ? `'${confirmDel.title.trim()}'` : '이 항목'}이 사라지고, 되돌릴 수 없어요.`}
          isMobile={isMobile}
          deleting={deleting}
          onCancel={() => setConfirmDel(null)}
          onConfirm={() => {
            const target = confirmDel;
            void (async () => {
              setDeleting(true);
              const err = await removeEntry(target);
              setDeleting(false);
              setConfirmDel(null);
              if (err) controller.showCalendarToast('삭제하지 못했어요', err);
            })();
          }}
        />
      )}

      {(() => {
        // `id#회차시작일` — 반복 일정은 눌린 회차가 삭제 범위(이 일정만/이후)의 기준이다.
        const [evId, evOcc] = (state.calEventDetail ?? '').split('#');
        const ev = evId ? eventsApi.events.find((e) => e.id === evId) : null;
        if (!ev) return null;
        return (
          <EventDetail
            key={ev.id}
            event={ev}
            isMobile={isMobile}
            {...(evOcc ? { occurrence: evOcc } : {})}
            calendarChips={geurioCalendarChips(googleTargets)}
            color={{ value: ev.color ?? null, options: geurioColorOptions() }}
            onClose={controller.closeCalendarEvent}
            onPatch={(patch) => eventsApi.update(ev.id, patch)}
            onDelete={() => eventsApi.remove(ev.id)}
          />
        );
      })()}
    </div>
  );
}

/** 헤더의 ‹ › — 30px 면 없는 단추(스펙 2.1). 손을 얹으면 가라앉은 면에 본문 잉크. */
function MonthNav({ label, d, onClick }: { label: string; d: string; onClick: () => void }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} className="mf-cal-ghost" style={{ width: 30, height: 30, flexShrink: 0, borderRadius: 10, border: 0, background: 'transparent', color: 'var(--mf-faint)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={d} />
      </svg>
    </button>
  );
}

/** 날짜별 보기 토글 — 32px 원(스펙 2.2). 켜지면 옅은 코랄 면·테두리에 코랄 아이콘. */
function SideToggle({ on, label, onClick, children }: { on: boolean; label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      data-cal-side-toggle
      title={label}
      aria-label={label}
      aria-pressed={on}
      onClick={onClick}
      className="mf-cal-pill"
      style={{
        width: 32,
        height: 32,
        flexShrink: 0,
        boxSizing: 'border-box',
        borderRadius: 999,
        border: `1px solid ${on ? 'color-mix(in srgb, var(--mf-accent) 24%, var(--mf-card))' : 'var(--mf-border)'}`,
        background: on ? 'var(--mf-accent-soft)' : 'var(--mf-card)',
        color: on ? 'var(--mf-accent-strong)' : 'var(--mf-subtext)',
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

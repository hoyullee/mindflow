import { useMemo, useState } from 'react';
import type { HomeState } from '../types';
import type { HomeController } from '../useHomeController';
import type { CalendarEntry } from './entries';
import { useCalendarEntries } from './useCalendarEntries';
import { homeChipSurface } from '../theme';
import { addDays, calendarStats, gridRange, monthCells, monthLabel, todayISO } from './model';
import { MonthGrid } from './MonthGrid';
import { DayListPopup } from './DayListPopup';
import { CalendarSide } from './CalendarSide';
import { DeadlinePanel } from './DeadlinePanel';
import { StatChips } from './StatChips';
import { MonthPicker } from './MonthPicker';
import { CalendarDetailHost } from './CalendarDetail';
import { NewEventModal } from './NewEventModal';
import { geurioColorOptions } from './eventColor';
import { submitNewEvent } from './newEventSubmit';
import { EventDetail, geurioCalendarChips } from './EventDetail';
import { GoogleDetailHost, patchFrom } from './GoogleEventDetail';
import { GoogleConnectButton } from './GoogleConnectButton';
import { WorkLocationModal } from './WorkLocationModal';
import { findWorkLocation, workLocationPatch, workLocationWhenChanged, type WorkLocationDraft } from './googleCalendar';
import { CalendarContextMenu, type CalMenuState } from './CalendarContextMenu';
import { DeleteConfirm } from './DeleteConfirm';
import { useCalendarEvents } from './useCalendarEvents';
import { eventEntries, googleEntries, holidayMap, workMap } from './entries';
import { useGoogleCalendar } from './useGoogleCalendar';

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
  // 구글 캘린더(PR5 겹치기 + PR6 쓰기). 연동하지 않았으면 빈 배열이라 아래 계산이
  // 예전과 한 글자도 다르지 않다.
  const google = useGoogleCalendar(state.calY, state.calM, { enabled: !!state.google, calendars: state.google?.calendars ?? [] }, controller.setGoogleCalendars);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // 날짜 칸 더블클릭·`+N개 더`가 여는 "그 날의 일정 전부"(디자인 원본 `dayList`).
  // 툴팁이라 누른 지점(화면 좌표)까지 함께 든다 — 그 곁에 선다.
  const [dayList, setDayList] = useState<{ iso: string; at: { x: number; y: number } } | null>(null);
  // 우클릭 메뉴(요청 ④) — 대상은 우클릭한 자리가 정한다(항목·날짜·화면).
  const [menu, setMenu] = useState<CalMenuState | null>(null);
  // 메뉴에서 고른 삭제는 **한 번 묻는다** — 파괴적 동작이 메뉴 클릭 하나로 끝나지
  // 않게(상세 팝업의 삭제와 같은 확인창을 쓴다).
  const [confirmDel, setConfirmDel] = useState<CalendarEntry | null>(null);
  const [deleting, setDeleting] = useState(false);
  // 근무 위치를 고치는 날(요청) — 열려 있으면 그 날짜다.
  const [workDay, setWorkDay] = useState<string | null>(null);
  const [workSaving, setWorkSaving] = useState(false);
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
  const stats = useMemo(() => calendarStats(entries, today), [entries, today]);
  // 새 일정의 목적지 — **쓸 수 있는** 구글 캘린더만(공휴일·보기 전용은 뺀다).
  const googleTargets = useMemo(() => google.writableCalendars.map((c) => ({ id: c.id, name: c.summary, ...(c.color ? { color: c.color } : {}) })), [google.writableCalendars]);
  // 선택 스코프로 열리는 것들(이름 검색·회의실) — 두 팝업이 같은 것을 쓴다.
  const googleDirectory = useMemo(
    () => ({ canSearchPeople: google.canSearchPeople, searchPeople: google.searchPeople, canPickRooms: google.canPickRooms, rooms: google.rooms, roomsReady: google.roomsReady, loadRooms: google.loadRooms, checkRoomBusy: google.checkRoomBusy }),
    [google.canSearchPeople, google.searchPeople, google.canPickRooms, google.rooms, google.roomsReady, google.loadRooms],
  );
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
   * 그 날의 근무 위치를 쓴다 — **걸려 있으면 고치고, 없으면 만든다.**
   *
   * 여러 날에 걸친 일정도 고친다(구간은 구글의 정식 모양이다 — 팝업이 그 구간을
   * 그대로 보여 준다). 고칠 때는 **바뀐 것만** 보낸다: 구간이 그대로면 `start`/`end`를
   * 싣지 않아, 그 사이 구글이 스스로 판을 올려도(#548) 저장이 막히지 않는다.
   */
  const saveWork = (iso: string, draft: WorkLocationDraft): void => {
    if (!workCalendar) return;
    const cur = findWorkLocation(google.events, iso);
    setWorkSaving(true);
    const run = cur
      ? google.updateEvent(cur, workLocationPatch(draft, workLocationWhenChanged(cur, draft)))
      : google.setWorkLocation(workCalendar.id, draft);
    void run.then((err) => {
      setWorkSaving(false);
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
    setWorkSaving(true);
    void google.deleteEvent(cur).then((err) => {
      setWorkSaving(false);
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
  /**
   * 날짜 칸을 골랐다 — **마감 목록은 닫는다**(제보 #12). 그 판은 달력 위에 겹쳐
   * 뜨는 훑어보기용 목록이라, 사용자가 달력으로 돌아온 순간 자리를 비켜 주는 것이
   * 맞다(날짜별 보기는 고른 날을 보여 주는 짝이라 그대로 둔다).
   */
  const pickDay = (iso: string): void => {
    if (state.calDeadline) controller.toggleCalDeadline();
    controller.selectCalDay(iso);
  };

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

  return (
    <div data-calendar-view style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* 헤더 — 대시보드의 다크 히어로와 달리 **밝은 면**이다(디자인 원본). */}
      <div
        style={{
          flex: '0 0 auto',
          position: 'relative',
          background: 'var(--mf-panel2)',
          borderBottom: '1px solid var(--mf-border)',
          padding: isMobile ? '14px 16px' : '18px 28px',
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        {/* 캔버스의 점 격자를 축소한 바탕(디자인 원본) — 일정도 우리 화면임을 말한다. */}
        <div aria-hidden="true" style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(var(--mf-dot-grid) 1px, transparent 1px)', backgroundSize: '18px 18px', pointerEvents: 'none' }} />

        {/* 킥커("마감을 한 달 단위로")와 날짜 줄은 없앴다(요청) — 타이틀 한 줄만 남기고
            양쪽 묶음을 가운데 정렬한다(대시보드 히어로와 같은 정리). */}
        <div style={{ position: 'relative', flex: '1 1 auto', minWidth: 0 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', minWidth: 0 }}>
            {isMobile && (
              <button type="button" aria-label="메뉴 열기" onClick={onOpenNav} className="mf-ctl" style={{ width: 30, height: 30, marginRight: -4, border: 0, background: 'transparent', color: 'var(--mf-muted)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M4 7h16M4 12h16M4 17h16" />
                </svg>
              </button>
            )}
            <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 9, fontSize: isMobile ? 21 : 25, fontWeight: 800, letterSpacing: '-.035em', color: 'var(--mf-text)', whiteSpace: 'nowrap' }}>
              <span style={{ width: 30, height: 30, flexShrink: 0, borderRadius: 10, background: 'var(--mf-accent-soft)', color: 'var(--mf-accent-strong)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                <CalendarGlyph size={16} />
              </span>
              일정
            </h2>
            <span aria-hidden="true" style={{ width: 1, height: 20, background: 'var(--mf-border)', flexShrink: 0 }} />
            {/* 월 이동 — 가운데 글자를 누르면 연/월을 바로 고른다(달을 여러 번 넘기지 않게). */}
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, height: 32, padding: '0 3px', borderRadius: 999, border: '1px solid var(--mf-border)', background: 'var(--mf-card)' }}>
              <MonthNav label="이전 달" d="m15 6-6 6 6 6" onClick={() => controller.calShiftMonth(-1)} />
              <MonthPicker y={state.calY} m={state.calM} now={nowYM} label={monthLabel(state.calY, state.calM)} onPick={controller.setCalMonth} />
              <MonthNav label="다음 달" d="m9 6 6 6-6 6" onClick={() => controller.calShiftMonth(1)} />
            </span>
            {notNow && (
              <button type="button" data-cal-today onClick={controller.calGoToday} className="mf-ctl" style={{ height: 28, padding: '0 13px', borderRadius: 999, border: '1px solid var(--mf-accent-mute)', background: 'var(--mf-accent-soft)', color: 'var(--mf-accent-strong)', font: 'inherit', fontSize: 11.5, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                오늘
              </button>
            )}
          </span>
        </div>

        {/* 우측: 만들기 + 사이드가 보여 줄 것 고르기(디자인 원본의 자리).
            `새 일정`은 이 묶음의 맨 앞이다 — 왼쪽은 "지금 어디를 보고 있는가"이고
            오른쪽은 "무엇을 할 수 있는가"라 성격이 다르다. */}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <button
            type="button"
            data-cal-new
            onClick={() => controller.openNewEvent(state.calDay ?? today, true)}
            // 그라디언트 버튼은 `mf-ctl`을 쓰지 않는다 — 그 hover가 면을 갈아 끼워
            // 그라디언트를 지운다(제보). `mf-ctl-primary`는 밝기만 올린다(원본).
            className="mf-ctl-primary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 34, padding: '0 17px', borderRadius: 999, border: 0, background: 'linear-gradient(180deg, var(--mf-accent), var(--mf-accent-strong))', color: 'var(--mf-accent-ink)', font: 'inherit', fontSize: 12.5, fontWeight: 800, letterSpacing: '-.015em', cursor: 'pointer', whiteSpace: 'nowrap', flex: '0 0 auto', boxShadow: '0 10px 20px -12px rgba(var(--mf-accent-rgb), .95)' }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            새 일정
          </button>
          {/* 구글 캘린더 연동(요청) — 아직 켜지 않았을 때만 뜬다. */}
          <GoogleConnectButton api={google} onOpen={controller.openGoogleCalendarSetup} />
          {!isMobile && (
            <>
            {/* 마감 목록은 날짜별 보기와 **별개**다(원본 `dlOpen`) — 달력 위에 겹치는
                판으로 뜨고, 둘 다 켜면 날짜별 보기 왼쪽에 나란히 선다. */}
            <SideToggle on={state.calDeadline} label="마감 목록" onClick={controller.toggleCalDeadline}>
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
            </>
          )}
        </div>
      </div>

      {/* 본문 */}
      <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', alignItems: 'stretch', minWidth: 0, background: 'var(--mf-bg)' }}>
        {/* 달력 영역 — 디자인 원본처럼 캔버스의 점 격자를 축소해 깐다(일정도 우리 화면). */}
        <div
          className="lnb-scroll"
          // 칸·칩이 아닌 자리의 우클릭 = **화면 메뉴**(새 일정 · 오늘로 · 사이드 토글).
          // 칸·칩은 자기 메뉴를 열고 전파를 끊으므로 여기까지 오지 않는다.
          onContextMenu={(e) => {
            const t = e.target as HTMLElement;
            if (t.closest?.('input, textarea, [contenteditable="true"], .mf-home-ctx')) return;
            e.preventDefault();
            setMenu({ target: { view: true }, x: e.clientX, y: e.clientY });
          }}
          style={{
            flex: '1 1 0',
            minWidth: 0,
            minHeight: 0,
            padding: isMobile ? '12px 14px 18px' : '16px 24px 24px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            backgroundImage: 'radial-gradient(var(--mf-dot-grid) 1px, transparent 1px)',
            backgroundSize: '17px 17px',
          }}
        >
          {/* 통계 칩 — **필터가 아니라 목록**이다(디자인 원본). 누르면 그 통계에 든
              항목이 팝오버로 뜨고, 골라서 상세로 간다. 예전에는 칩이 달력을 걸러
              나머지를 통째로 감췄다(제보: 캘린더가 변한다). */}
          <StatChips stats={stats} todayIso={today} onPickEntry={openEntry} />

          <MonthGrid
            cells={cells}
            selected={state.calDay}
            surface={surface}
            compact={isMobile}
            onPickDay={pickDay}
            onOpenDayList={(iso, at) => setDayList({ iso, at })}
            onPickEntry={openEntry}
            // `+N개 더`도 같은 팝업이다 — 접힌 것을 보려는 클릭이니 전부를 보여 준다
            // (디자인 원본 `onMore`도 dayList를 연다).
            onMore={(iso, at) => setDayList({ iso, at })}
            onShift={(e, days) => void shiftEntry(e, days)}
            onCtxMenu={(target, at) => setMenu({ target, x: at.x, y: at.y })}
          />
        </div>

        {!isMobile && state.calDeadline && (
          <DeadlinePanel
            entries={entries}
            todayIso={today}
            surface={surface}
            offsetRight={state.calSide ? 300 : 0}
            onPickEntry={openEntry}
            onClose={controller.toggleCalDeadline}
          />
        )}

        {!isMobile && state.calSide && (
          <CalendarSide
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
            onClose={() => controller.setCalSide(null)}
          />
        )}
      </div>

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
            void submitNewEvent(input, target, { createGeurio: eventsApi.create, createGoogle: google.createEvent }).then((err) => {
              setSaving(false);
              setSaveError(err);
              if (!err) controller.closeNewEvent();
            });
          }}
        />
      )}
      {/* 근무 위치(요청) — 구글의 기본 캘린더에 쓴다(구간·시각 모두). */}
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
            };
          })()}
          isMobile={isMobile}
          saving={workSaving}
          error={workError}
          onClose={() => setWorkDay(null)}
          onSave={(draft) => saveWork(workDay, draft)}
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
          deadlineOpen: state.calDeadline,
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
          openDaySide: (iso) => {
            controller.selectCalDay(iso);
            controller.setCalSide('day');
          },
          goToday: () => {
            controller.calGoToday();
            controller.selectCalDay(today);
          },
          toggleDeadline: controller.toggleCalDeadline,
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

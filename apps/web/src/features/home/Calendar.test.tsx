import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Home } from './Home';
import { BackendProvider } from '../../adapters/BackendContext';
import { mockMatchMedia } from '../../test/matchMedia';
import { LocalAuth } from '../../adapters/local/localAuth';
import { LocalSpaceStore } from '../../adapters/local/localSpaceStore';
import { LocalShareStore } from '../../adapters/local/localShareStore';
import { LocalFeedbackStore } from '../../adapters/local/localFeedbackStore';
import { LocalTagStore } from '../../adapters/local/localTagStore';
import { LocalCommentStore } from '../../adapters/local/localCommentStore';
import { LocalNotificationStore } from '../../adapters/local/localNotificationStore';
import { LocalEventStore } from '../../adapters/local/localEventStore';
import { LocalImageStore } from '../../adapters/local/localImageStore';
import type { Backend, DocMeta, DocStore, LoadedDoc } from '../../adapters/ports';
import { onCalendarChanged } from '../reminders/calendarChanged';
import { ACTIVE_VIEW_KEY } from './storage';
import { focusCalendar } from './calendarFocus';
import { addDays, addMonth, dateLabel, daysBetween, hhmm, isoOf, minutesOf, nextTimeSlot, timeLabel, todayISO } from './calendar/model';
import { tagColor } from '../editor/kanbanMeta';
import { UI_THEME } from '../editor/theme';

/**
 * 일정 화면(캘린더 PR1) 통합 테스트 — 디자인 원본 `Geurio 일정 캘린더.dc.html` 이식.
 *
 * 데이터는 **전 스페이스의 칸반 마감**이고 본문은 썸네일 프리페치가 받아 둔 것을
 * 그대로 읽는다. 순수 계산(격자·통계·목록)은 `calendar/model.test.ts`가 덮으므로
 * 여기서는 홈이 실제로 하는 흐름만 본다: LNB에서 열고, 걸러 보고, 항목을 눌러
 * 그 칸반으로 가고, 돌아오면 다시 일정 화면.
 */

afterEach(() => cleanup());
/**
 * 월 격자는 칸 높이를 **실측해서** 몇 줄을 그릴지 정한다(제보 #1) — jsdom에는
 * 레이아웃도 ResizeObserver도 없으므로, 콜백을 손에 쥐고 원할 때 흘려 보내는
 * 스텁을 둔다(재지 못한 동안은 아무것도 접지 않는 것이 기본 동작이다).
 */
let roCallbacks: (() => void)[] = [];
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  roCallbacks = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(cb: () => void) {
        roCallbacks.push(cb);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

class MockDocStore implements DocStore {
  listEditorNames = vi.fn(async (): Promise<Record<string, never>> => ({}));
  setFavorite = vi.fn(async (): Promise<void> => undefined);
  remove = vi.fn(async (): Promise<void> => undefined);
  restore = vi.fn(async (): Promise<void> => undefined);
  purge = vi.fn(async (): Promise<void> => undefined);
  rename = vi.fn(async (): Promise<void> => undefined);
  // 포트의 시그니처로 mock을 세운다 — `mock.calls`를 그대로 읽는 단정(무엇을 어떤
  // 버전으로 저장했나)이 타입 검사를 지나려면 빈 시그니처로는 안 된다.
  save = vi.fn<DocStore['save']>(async () => ({ ok: true, version: 1 }));
  load = vi.fn(async (id: string): Promise<LoadedDoc | null> => this.bodies[id] ?? null);
  loadPreview = vi.fn(async (id: string): Promise<string | null> => {
    const b = this.bodies[id];
    return b ? JSON.stringify(b.doc) : null;
  });

  constructor(
    private metas: DocMeta[] = [],
    private bodies: Record<string, LoadedDoc> = {},
  ) {}

  /** 목록 왕복 횟수 — "보지 않는 화면에서는 묻지 않는다"를 세는 데 쓴다. */
  listCalls = 0;

  async list(): Promise<DocMeta[]> {
    this.listCalls += 1;
    return this.metas;
  }

  /**
   * **다른 기기·다른 사람이 그 보드를 고친 상황.** 판(version·updatedAt)과 본문을
   * 함께 바꾼다 — 판만 바꾸면 캐시가 옛 본문을 돌려주고, 본문만 바꾸면 우리 쪽이
   * 바뀐 줄 알 길이 없다(그 판별이 곧 이 갱신의 규칙이다).
   */
  remoteEdit(id: string, cards: Record<string, unknown>[]): void {
    const m = this.metas.find((x) => x.id === id);
    if (m) {
      m.version += 1;
      m.updatedAt = new Date(Date.parse(m.updatedAt) + 60_000).toISOString();
    }
    this.bodies[id] = kanbanBody(cards);
  }
}

function renderHome(metas: DocMeta[], bodies: Record<string, LoadedDoc>) {
  const docStore = new MockDocStore(metas, bodies);
  const backend: Backend = {
    auth: new LocalAuth(),
    docStore,
    spaceStore: new LocalSpaceStore(),
    shareStore: new LocalShareStore(),
    feedbackStore: new LocalFeedbackStore(), tagStore: new LocalTagStore(),
    imageStore: new LocalImageStore(),
    commentStore: new LocalCommentStore(),
    notificationStore: new LocalNotificationStore(), eventStore: new LocalEventStore(),
    mode: 'local',
  };
  const utils = render(
    <MemoryRouter initialEntries={['/home']}>
      <BackendProvider backend={backend}>
        <Routes>
          <Route path="/home" element={<Home />} />
          <Route path="/editor" element={<div>EDITOR_PLACEHOLDER</div>} />
          <Route path="/login" element={<div>LOGIN_PAGE</div>} />
        </Routes>
      </BackendProvider>
    </MemoryRouter>,
  );
  return { ...utils, docStore, commentStore: backend.commentStore };
}

const META = (id: string, title: string): DocMeta => ({ id, title, version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null });

/** 오늘을 기준으로 만든 날짜 — 하드코딩하면 언젠가 과거가 되어 테스트가 흔들린다. */
function shiftDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return isoOf(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/**
 * 이 달 안에 머무는 날 — 달력 격자는 이제 이웃 달 칸도 누를 수 있지만(제보 #3),
 * 미니 달력·통계처럼 **이 달을 기준으로 세는** 단정이 많아 그대로 쓴다.
 */
function shiftInMonth(n: number): string {
  const now = new Date();
  const fwd = new Date(now);
  fwd.setDate(fwd.getDate() + n);
  if (fwd.getMonth() === now.getMonth()) return isoOf(fwd.getFullYear(), fwd.getMonth() + 1, fwd.getDate());
  const back = new Date(now);
  back.setDate(back.getDate() - n);
  return isoOf(back.getFullYear(), back.getMonth() + 1, back.getDate());
}

/**
 * 이 달 안에 온전히 드는 닷새짜리 기간(시작~기한) — **오늘을 품는다.** 시작을 그냥
 * `오늘-1`로 두면 월초에 시작 칸이 이웃 달로 넘어가 라벨 조각이 사라지고(격자는
 * 이웃 달 칸에 칩·바를 놓지 않는다 — 9월 1일에 실제로 깨졌다), 월말에는 기한이
 * 다음 달로 넘어가 같은 문제가 된다. 그래서 달 안쪽으로 클램프한다.
 */
const SPAN = (() => {
  const now = new Date();
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const day = Math.min(Math.max(now.getDate() - 1, 1), Math.min(now.getDate(), last - 4));
  const start = isoOf(now.getFullYear(), now.getMonth() + 1, day);
  return { start, due: addDays(start, 4) };
})();

/**
 * **한 주 안에** 온전히 드는 엿새(일~금)의 첫날.
 *
 * lane 배정은 **주 단위**라(#485) 기간이 주를 넘으면 다음 주에서 다시 배정되고 제목도
 * 그 주의 첫 칸에 다시 쓰인다 — 옳은 동작이다. 그 규칙 자체를 보는 테스트가 아니라
 * "한 주 안에서 lane이 어떻게 놓이는가"를 보는 테스트는 **주 경계를 넘으면 안 된다**.
 * `SPAN`은 오늘을 기준으로 잡히므로 요일에 따라 중간에 일요일이 끼어들 수 있어서
 * (2026-09-04에 실제로 깨졌다) 그런 테스트는 이 값을 쓴다.
 */
const WEEK_START = (() => {
  const now = new Date();
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  for (let d = 1; d + 5 <= last; d += 1) {
    if (new Date(now.getFullYear(), now.getMonth(), d).getDay() === 0) return isoOf(now.getFullYear(), now.getMonth() + 1, d);
  }
  return isoOf(now.getFullYear(), now.getMonth() + 1, 1);
})();

function kanbanBody(cards: Record<string, unknown>[]): LoadedDoc {
  return {
    doc: {
      v: 1,
      kind: 'kanban',
      nodes: {},
      floats: [],
      lines: [],
      zones: [],
      layoutMode: 'right',
      themeKey: 'coral',
      columns: [
        { id: 'c1', title: '할 일' },
        { id: 'c2', title: '진행 중' },
        { id: 'c3', title: '완료' },
      ],
      cards,
    } as unknown as LoadedDoc['doc'],
    version: 1,
    title: '보드',
  };
}

function seedSpaces(): void {
  localStorage.setItem(
    'mf_spaces',
    JSON.stringify({
      spaces: [
        { id: 's1', name: '업무', home: true, color: '#f0663f', maps: [{ title: '스프린트 보드', when: '방금', hue: '#f0663f', docId: 'd1' }], folders: [] },
        { id: 's2', name: '원티드랩', color: '#3f8fd0', maps: [{ title: '이슈 트리아지', when: '어제', hue: '#3f8fd0', docId: 'd2' }], folders: [] },
      ],
      activeSpace: 's1',
    }),
  );
}

const BODIES = () => ({
  d1: kanbanBody([
    { id: 'k1', col: 'c2', pos: 1, text: '오늘 마감 카드', due: todayISO() },
    { id: 'k2', col: 'c1', pos: 2, text: '지난 마감 카드', due: shiftDays(-5) },
    { id: 'k3', col: 'c3', pos: 3, text: '완료된 카드', due: todayISO() },
    { id: 'k4', col: 'c2', pos: 4, text: '기간 카드', due: SPAN.due, start: SPAN.start },
  ]),
  d2: kanbanBody([{ id: 'x1', col: 'c1', pos: 1, text: '다른 스페이스 카드', due: shiftDays(1) }]),
});

async function openCalendar() {
  await waitFor(() => expect(document.querySelector('[data-cal-nav]')).toBeTruthy());
  // 본문 프리페치가 도착해 요약이 서기까지 기다린다(카드의 둘째 줄).
  await waitFor(() => expect(document.querySelector('[data-cal-summary]')!.textContent).not.toBe('예정된 일정이 없어요'));
  fireEvent.click(document.querySelector('[data-cal-nav]')!);
  await waitFor(() => expect(document.querySelector('[data-calendar-view]')).toBeTruthy());
}

/**
 * 칩의 **제목**만 읽는다 — 시간 일정은 제목 앞에 시작 시각이 붙으므로(요청 ②)
 * 칩 전체 글자로 비교하면 `오전 9시회의`가 된다.
 */
const chipTitle = (c: Element): string => (c.querySelector('[data-cal-chip-title]') ?? c).textContent!.trim();
const chipTexts = (): string[] => [...document.querySelectorAll('[data-cal-chip]')].map(chipTitle);
const chipFor = (title: string): HTMLElement => [...document.querySelectorAll('[data-cal-chip]')].find((c) => chipTitle(c) === title) as HTMLElement;
// 바는 [제목][N/M일째] 두 스팬이다(요청 ⑤) — 제목 스팬으로 찾는다(바 전체
// textContent에는 진행 표기가 딸려 온다).
const barFor = (title: string): HTMLElement =>
  [...document.querySelectorAll('[data-cal-bar]')].find(
    (c) => (c.querySelector('[data-cal-bar-title]')?.textContent ?? c.textContent ?? '').trim() === title,
  ) as HTMLElement;
const detail = (): HTMLElement => document.querySelector('[role="dialog"][aria-label="일정 상세"]') as HTMLElement;
/** 고른 칸의 안쪽 테두리(Jira 작업 현황 달력과 같은 1.5px `#E8A25F`) — jsdom은 색을 rgb로 바꿔 둘 수 있다. */
const SEL_RING_RE = /inset.*1\.5px.*(#E8A25F|rgb\(232, 162, 95\))|(#E8A25F|rgb\(232, 162, 95\)).*1\.5px.*inset/i;

/** 날짜 팝오버를 열어 그 날을 고른다 — 디자인 원본의 `pk` 달력(native input이 아니다). */
async function pickDate(triggerSel: string, iso: string): Promise<void> {
  fireEvent.click(document.querySelector(triggerSel)!);
  await waitFor(() => expect(document.querySelector('[data-datepop-month]')).toBeTruthy());
  // 목표 날이 이 달 격자에 없으면(월 경계 — 9월 1일에 실제로 깨졌다) 팝오버 안의
  // 이전/다음 달 화살표로 넘긴다. 방향은 오늘과의 비교로 충분하다(테스트는 몇 달씩
  // 떨어진 날을 고르지 않는다).
  for (let i = 0; i < 3 && !document.querySelector(`[data-datepop-day="${iso}"]`); i += 1) {
    const pop = document.querySelector('[data-datepop-month]')!.parentElement as HTMLElement;
    fireEvent.click(pop.querySelector(`[aria-label="${iso < todayISO() ? '이전 달' : '다음 달'}"]`)!);
  }
  await waitFor(() => expect(document.querySelector(`[data-datepop-day="${iso}"]`)).toBeTruthy());
  fireEvent.click(document.querySelector(`[data-datepop-day="${iso}"]`)!);
}

/** jsdom엔 PointerEvent가 없다 — MouseEvent를 pointer 이름으로 던진다(에디터 테스트와 같은 처방). */
function firePointer(target: Element | Window, type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel', init: { clientX?: number; clientY?: number; pointerType?: string } = {}): void {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: init.clientX ?? 0, clientY: init.clientY ?? 0 });
  Object.defineProperty(ev, 'pointerType', { value: init.pointerType ?? 'mouse', configurable: true });
  Object.defineProperty(ev, 'pointerId', { value: 1, configurable: true });
  fireEvent(target as Element, ev);
}

/**
 * jsdom에는 레이아웃이 없어 `document.elementFromPoint`가 늘 null이다 — 우리 히트
 * 테스트가 그 함수로 날짜 칸을 찾으므로, x 좌표를 **칸 하나당 100px**로 정해 두고
 * 그 좌표를 칸으로 되돌려 주는 스텁을 심는다(실브라우저 프로브가 실기하를 맡는다).
 */
function stubCellHitTest(order: string[]): () => void {
  const orig = document.elementFromPoint;
  document.elementFromPoint = ((x: number): Element | null => {
    const iso = order[Math.floor(x / 100)];
    return iso ? (document.querySelector(`[data-day-cell="${iso}"]`) as Element | null) : null;
  }) as typeof document.elementFromPoint;
  return () => {
    document.elementFromPoint = orig;
  };
}

/**
 * 마우스로 칩을 잡아 그 좌표까지 끌고 놓는다(4px 문턱을 넘긴다).
 * 브라우저는 pointerup 뒤에 **click까지** 쏘므로 그것도 흉내 낸다 — 그 클릭이
 * 상세 팝업을 열면 안 된다(끌고 난 자리에서 팝업이 뜨는 것이 곧 버그다).
 */
function dragTo(el: HTMLElement, fromX: number, toX: number): void {
  firePointer(el, 'pointerdown', { clientX: fromX, clientY: 10 });
  firePointer(window, 'pointermove', { clientX: fromX + 10, clientY: 10 });
  firePointer(window, 'pointermove', { clientX: toX, clientY: 10 });
  firePointer(window, 'pointerup', { clientX: toX, clientY: 10 });
  fireEvent.click(el, { clientX: toX, clientY: 10 });
}

describe('일정 화면', () => {
  beforeEach(() => {
    mockMatchMedia(false);
    seedSpaces();
  });

  it('LNB `일정` 부제는 Geurio 일정도 부른다 — 칸반 마감이 없어도 「이번 주 일정 없음」이 아니다(요청)', async () => {
    // 종일 일정 — 시각 있는 일정은 테스트가 도는 시각에 따라 "끝났음"이 갈린다(F5).
    await new LocalEventStore().create({ title: '팀 워크숍', startDate: todayISO(), endDate: todayISO(), allDay: true });
    renderHome([], {});
    await waitFor(() => expect(document.querySelector('[data-cal-summary]')!.textContent).toBe('오늘 · 팀 워크숍'));
  });

  it('LNB `일정` 부제 — 칸반 마감도 일정도 없으면 「이번 주 일정 없음」', async () => {
    renderHome([], {});
    await waitFor(() => expect(document.querySelector('[data-cal-summary]')).toBeTruthy());
    expect(document.querySelector('[data-cal-summary]')!.textContent).toBe('이번 주 일정 없음');
  });

  it('LNB `일정`은 알림과 함께 오늘 묶음이다 — 지난 마감이 있으면 그것부터, 경고색으로(제보·스펙 2.3)', async () => {
    renderHome([META('d1', '스프린트 보드'), META('d2', '이슈 트리아지')], BODIES());
    await openCalendar();
    const nav = document.querySelector('[data-cal-nav]') as HTMLElement;
    // 둘째 줄은 급한 것부터 — 지난 마감(1) · 오늘(1). 완료 열은 빠진다. 다음 마감의 이름이
    // 이 자리를 차지하면 "이미 늦은 것이 있다"가 가려지므로 이때는 개수를 말한다.
    const sum = nav.querySelector('[data-cal-summary]') as HTMLElement;
    // 기간 카드의 기한은 달 안쪽으로 클램프되므로 **달의 마지막 날에는 오늘**이 되어
    // 오늘 마감에 함께 세어진다(옳은 동작 — 2026-09-30에 실제로 갈렸다).
    const todayCount = SPAN.due === todayISO() ? 2 : 1;
    expect(sum.textContent).toBe(`지난 마감 1건 · 오늘 ${todayCount}건`);
    // 알약을 걷어낸 자리에서 **경고색**이 그 급함을 말한다.
    expect(sum.dataset.urgent).toBe('1');
    expect(sum.style.color).toBe('var(--mf-danger)');
    expect(nav.querySelector('[data-cal-overdue]')).toBeNull();
    // 알림과 **같은 껍데기**(44px 두 줄 행)라 나란히 서도 서로 달라 보이지 않는다.
    expect(nav.querySelector('[data-nav-card-summary]')).toBeTruthy();
    expect(nav.style.minHeight).toBe('44px');
    // 자리: 알림 **바로 아래**, 스페이스 구획보다 **앞** — 둘이 한 블록(`data-lnb-today`)이다.
    const bell = document.querySelector('[data-notification-nav]')!;
    const today = document.querySelector('[data-lnb-today]')!;
    const spaceLabel = screen.getByText('스페이스');
    expect(today.contains(bell) && today.contains(nav)).toBe(true);
    expect(bell.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(nav.compareDocumentPosition(spaceLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('LNB `일정` 글리프는 **상자 없는 날짜 숫자 + 요일**이다 — 일정 화면에서는 강조색, 면은 활성일 때만(스펙 2.3)', async () => {
    // 제보(두 카드가 너무 똑같다)는 여전히 글리프가 가른다 — 알림은 원 안의 벨,
    // 일정은 상자·테두리 없이 오늘 날짜와 요일 글자.
    renderHome([META('d1', '스프린트 보드')], BODIES());
    await openCalendar();
    const nav = document.querySelector('[data-cal-nav]') as HTMLElement;
    const tile = nav.querySelector('[data-nav-card-glyph]') as HTMLElement;
    expect(tile.style.background).toBe('');
    expect(tile.style.border).toBe('');
    const now = new Date();
    const num = nav.querySelector('[data-cal-date-num]') as HTMLElement;
    const dow = nav.querySelector('[data-cal-date-dow]') as HTMLElement;
    expect(num.textContent).toBe(String(now.getDate()));
    expect(dow.textContent).toBe(['일', '월', '화', '수', '목', '금', '토'][now.getDay()]);
    expect(num.style.fontFamily).toContain('JetBrains Mono');
    expect(num.style.fontSize).toBe('17px');
    expect(dow.style.fontSize).toBe('8.5px');
    // 일정 화면을 보는 중 — 숫자·요일이 강조색으로 선다(옆의 면과 함께 두 겹).
    expect(num.style.color).toBe('var(--mf-accent-strong)');
    expect(dow.style.color).toBe('var(--mf-accent)');
    // 알림 쪽은 원이다(같은 껍데기여도 한눈에 구별된다).
    expect(document.querySelector('[data-notification-nav] [data-notification-glyph]')).toBeTruthy();
    // 면은 **일정 화면을 보고 있을 때만**(제보 ①: 늘 칠하면 "언제나 활성"으로 읽힌다).
    expect(nav.style.background).toBe('var(--mf-panel2)');
    expect(nav.getAttribute('aria-current')).toBe('page');
    // 연동 경고 점은 **권한이 만료됐을 때만** — 이 환경에는 클라이언트 ID가 없어 캐럿조차 없다
    // (펼칠 것이 없는 단추는 두지 않는다).
    expect(document.querySelector('[data-cal-caret]')).toBeNull();
    expect(nav.querySelector('[data-cal-link]')).toBeNull();

    // 다른 화면으로 가면 면이 걷히고 숫자가 본문색으로 돌아온다.
    const spaceRow = [...document.querySelectorAll('aside [role="button"], aside button')].find((e) => e.textContent?.trim().startsWith('업무')) as HTMLElement;
    fireEvent.click(spaceRow);
    await waitFor(() => expect((document.querySelector('[data-cal-nav]') as HTMLElement).style.background).toBe('transparent'));
    expect((document.querySelector('[data-cal-date-num]') as HTMLElement).style.color).toBe('var(--mf-text)');
  });

  it('전 스페이스의 칸반 마감을 그리고, 완료 열은 빼고, 기간 일정은 칩이 아니라 바로 그린다', async () => {
    renderHome([META('d1', '스프린트 보드'), META('d2', '이슈 트리아지')], BODIES());
    await openCalendar();
    // 항상 6주 = 42칸
    expect(document.querySelectorAll('[data-day-cell]').length).toBe(42);
    // 다른 스페이스 카드는 D+1이라 **월말에는 다음 달 칸**이고, 격자는 이웃 달 칸에
    // 칩을 놓지 않는다(설계) — 그때는 그 달로 넘겨서 확인한다. 이 단정의 요지는
    // "전 스페이스를 함께 모으는가"이지 그 카드가 이 달에 있는가가 아니다.
    await waitFor(() => expect(chipTexts().length).toBeGreaterThan(0));
    if (!chipTexts().includes('다른 스페이스 카드')) {
      fireEvent.click(document.querySelector('[aria-label="다음 달"]')!);
      await waitFor(() => expect(chipTexts()).toContain('다른 스페이스 카드'));
      fireEvent.click(document.querySelector('[aria-label="이전 달"]')!);
      await waitFor(() => expect(chipTexts()).toContain('오늘 마감 카드'));
    }
    expect(chipTexts()).toContain('오늘 마감 카드');
    // 완료 열 카드는 어디에도 없다
    expect(document.body.textContent).not.toContain('완료된 카드');
    // 기간 카드는 칩이 아니다 — 칸의 바(제목은 시작 칸/일요일에만)
    expect(chipTexts()).not.toContain('기간 카드');
    expect([...document.querySelectorAll('[data-cal-bar] [data-cal-bar-title]')].some((b) => b.textContent === '기간 카드')).toBe(true);
  });

  it('헤더 요약 줄 — 오늘 날짜 + 0이 아닌 수만, 오늘 마감 → 이번 주 → 지난 마감 순(스펙 2.1)', async () => {
    renderHome([META('d1', '스프린트 보드'), META('d2', '이슈 트리아지')], BODIES());
    await openCalendar();
    const head = () => document.querySelector('[data-cal-head-summary]') as HTMLElement;
    await waitFor(() => expect(head().querySelector('[data-cal-head-stat="over"]')).toBeTruthy());
    const now = new Date();
    expect(head().querySelector('[data-cal-head-date]')!.textContent).toBe(`${now.getMonth() + 1}월 ${now.getDate()}일 ${'일월화수목금토'[now.getDay()]}요일`);
    // 순서는 급한 것 먼저가 아니라 **스펙의 순서**다(오늘 → 이번 주 → 지난). 칸반 마감만 센다.
    // 이번 주에는 오늘 카드가 늘 든다 — 셋 다 선다.
    const keys = [...head().querySelectorAll('[data-cal-head-stat]')].map((el) => el.getAttribute('data-cal-head-stat'));
    expect(keys).toEqual(['today', 'week', 'over']);
    const n = (k: string) => head().querySelector(`[data-cal-head-stat="${k}"] [data-cal-head-n]`)!.textContent;
    expect(n('over')).toBe('1');
    // 오늘 마감 = 오늘 카드(완료 열은 빠진다) + 달의 끝이면 기간 카드도 오늘 마감이다.
    expect(Number(n('today'))).toBe(SPAN.due === todayISO() ? 2 : 1);
    // 숫자는 등폭 글꼴이다(스펙 — 숫자·카운트는 JetBrains Mono).
    expect((head().querySelector('[data-cal-head-n]') as HTMLElement).style.fontFamily).toContain('JetBrains Mono');
    // 예전의 통계 칩·팝오버는 없다(스펙 6).
    expect(document.querySelector('[data-cal-stat]')).toBeNull();
    expect(document.querySelector('[data-cal-stats]')).toBeNull();
  });

  it('0인 항목은 요약 줄에 적지 않는다 — "지난 마감 0"은 읽을 거리가 아니다(스펙 2.1)', async () => {
    // 앞으로 올 마감 하나뿐 — 지난 마감·오늘 마감은 0건이다.
    renderHome([META('d1', '스프린트 보드')], { d1: kanbanBody([{ id: 'k1', col: 'c2', pos: 1, text: '앞날 카드', due: shiftDays(2) }]) });
    await openCalendar();
    const head = document.querySelector('[data-cal-head-summary]') as HTMLElement;
    expect(head.querySelector('[data-cal-head-date]')).toBeTruthy();
    expect(head.querySelector('[data-cal-head-stat="over"]')).toBeNull();
    expect(head.querySelector('[data-cal-head-stat="today"]')).toBeNull();
  });

  it('`새 일정`은 헤더 **오른쪽 묶음**에 있다 — 왼쪽은 지금 보는 자리, 오른쪽은 할 수 있는 일', async () => {
    renderHome([META('d1', '스프린트 보드')], BODIES());
    await openCalendar();
    const newBtn = document.querySelector('[data-cal-new]')!;
    const monthBtn = document.querySelector('[data-cal-month]')!;
    // 월 표기(왼쪽 묶음)와 다른 부모에 있고, 문서 순서상 뒤에 온다.
    expect(newBtn.parentElement).not.toBe(monthBtn.parentElement);
    expect(monthBtn.compareDocumentPosition(newBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // 보기 토글과 같은 묶음
    expect(newBtn.parentElement!.querySelector('[aria-label="날짜별 보기"]')).toBeTruthy();
  });

  it('월 표기를 누르면 연/월을 고르는 팝오버가 열린다', async () => {
    renderHome([META('d1', '스프린트 보드')], BODIES());
    await openCalendar();
    const now = new Date();
    fireEvent.click(document.querySelector('[data-cal-month]')!);
    await waitFor(() => expect(document.querySelector('[data-ym-month="1"]')).toBeTruthy());
    // 12개월 + 연도 전환 + `이번 달`
    expect(document.querySelectorAll('[data-ym-month]')).toHaveLength(12);
    // 연도를 누르면 15년 목록으로 바뀐다
    fireEvent.click(document.querySelector('[data-ym-head]')!);
    await waitFor(() => expect(document.querySelectorAll('[data-ym-year]')).toHaveLength(15));
    fireEvent.click(document.querySelector(`[data-ym-year="${now.getFullYear() + 1}"]`)!);
    await waitFor(() => expect(document.querySelectorAll('[data-ym-month]')).toHaveLength(12));
    // 달을 고르면 달력이 그 달로 간다
    fireEvent.click(document.querySelector('[data-ym-month="3"]')!);
    await waitFor(() => expect(document.querySelector('[data-cal-month-label]')!.textContent).toBe(`${now.getFullYear() + 1}년 3월`));
    expect(document.querySelector('[data-ym-month="1"]')).toBeNull(); // 고르면 닫힌다
  });

  it('다른 달로 가면 `오늘` 버튼이 뜨고, 누르면 이번 달로 돌아온다', async () => {
    renderHome([META('d1', '스프린트 보드')], BODIES());
    await openCalendar();
    expect(document.querySelector('[data-cal-today]')).toBeNull();
    // 헤더의 것 — 사이드 미니 달력에도 같은 이름의 버튼이 있다.
    fireEvent.click(document.querySelector('[data-cal-month]')!.parentElement!.querySelector('[aria-label="다음 달"]')!);
    // 문구는 `오늘로`가 아니라 `오늘`(디자인 원본)
    await waitFor(() => expect(document.querySelector('[data-cal-today]')).toBeTruthy());
    expect(document.querySelector('[data-cal-today]')!.textContent).toBe('오늘');
    expect(screen.queryByText('오늘로')).toBeNull();
    fireEvent.click(document.querySelector('[data-cal-today]')!);
    await waitFor(() => expect(document.querySelector('[data-cal-today]')).toBeNull());
  });

  it('토요일은 하늘색, 일요일은 분홍색 면을 쓴다(이번 달 칸만)', async () => {
    renderHome([META('d1', '스프린트 보드')], BODIES());
    await openCalendar();
    const cells = [...document.querySelectorAll('[data-day-cell]')] as HTMLElement[];
    const inMonth = cells.filter((c) => !c.dataset.outMonth);
    const sun = inMonth.find((c) => new Date(c.dataset.dayCell!).getDay() === 0)!;
    const sat = inMonth.find((c) => new Date(c.dataset.dayCell!).getDay() === 6)!;
    const wed = inMonth.find((c) => new Date(c.dataset.dayCell!).getDay() === 3 && !c.style.background.includes('cal-today'))!;
    expect(sun.style.background).toContain('--mf-cal-sun');
    expect(sat.style.background).toContain('--mf-cal-sat');
    expect(wed.style.background).toContain('--mf-card');
  });

  it('날짜별 보기는 기본으로 열려 있고 헤더의 원 토글이 접고 편다 — 마감 목록은 어디에도 없다(스펙 2.2·6)', async () => {
    renderHome([META('d1', '스프린트 보드'), META('d2', '이슈 트리아지')], BODIES());
    await openCalendar();
    const side = () => document.querySelector('[data-cal-side]');
    // 날짜별 보기는 기본으로 열려 있고, **오늘이 골라져 있다**(스펙 5 — 진입하면 오늘).
    await waitFor(() => expect(side()).toBeTruthy());
    expect(within(side() as HTMLElement).getByText('오늘 마감 카드')).toBeTruthy();
    // 날짜별 항목은 **왼쪽 색 바가 붙은 납작한 행**이다(스펙 4.2). 우측 메모는 열 이름,
    // 기간이면 `N/M일째`.
    const chips = [...document.querySelectorAll('[data-cal-day-chip]')] as HTMLElement[];
    // 순서에 기대지 않는다 — 달의 마지막 날에는 기간 카드도 오늘 마감이라 앞에 설 수 있다.
    const dueToday = chips.find((c) => c.textContent!.includes('오늘 마감 카드'))!;
    expect(dueToday.style.borderLeft).toMatch(/^3px solid/);
    expect(dueToday.style.borderRadius).toBe('4px 9px 9px 4px');
    expect(dueToday.style.padding).toBe('6px 9px');
    expect(dueToday.textContent).toContain('진행 중');
    // 오늘은 기간 카드(닷새짜리)의 며칠째다 — 시작이 월초·월말 클램프로 움직이므로 계산해 단정한다
    expect(side()!.textContent).toContain(`${daysBetween(SPAN.start, todayISO()) + 1}/5일째`);
    const toggle = () => document.querySelector('[aria-label="날짜별 보기"]') as HTMLElement;
    expect(toggle().getAttribute('aria-pressed')).toBe('true');
    // 32px 원(스펙 2.2)
    expect(toggle().style.width).toBe('32px');
    expect(toggle().style.borderRadius).toBe('999px');
    // 누르면 접히고 달력이 오른쪽 끝까지 넓어진다.
    fireEvent.click(toggle());
    await waitFor(() => expect(side()).toBeNull());
    expect(toggle().getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle());
    await waitFor(() => expect(side()).toBeTruthy());
    // 마감 목록 판·토글은 걷었다(스펙 6).
    expect(document.querySelector('[aria-label="마감 목록"]')).toBeNull();
    expect(document.querySelector('[data-cal-deadline]')).toBeNull();
  });

  it('본문 행이 880px보다 좁으면 패널이 달력 위에 **겹치고** 막이 깔린다 — 막을 누르면 접힌다(스펙 4)', async () => {
    renderHome([META('d1', '스프린트 보드')], BODIES());
    await openCalendar();
    const body = document.querySelector('[data-cal-body]') as HTMLElement;
    const side = () => document.querySelector('[data-cal-side]') as HTMLElement | null;
    // 넉넉하면 300px 붙박이 열
    Object.defineProperty(body, 'clientWidth', { configurable: true, value: 1180 });
    act(() => { for (const cb of roCallbacks) cb(); });
    await waitFor(() => expect(body.dataset.calSideMode).toBe('dock'));
    expect(side()!.style.flex).toBe('0 0 300px');
    expect(document.querySelector('[data-cal-scrim]')).toBeNull();
    // 좁아지면 324px 판 + 막
    Object.defineProperty(body, 'clientWidth', { configurable: true, value: 860 });
    act(() => { for (const cb of roCallbacks) cb(); });
    await waitFor(() => expect(body.dataset.calSideMode).toBe('overlay'));
    expect(side()!.style.position).toBe('absolute');
    expect(side()!.style.width).toBe('324px');
    const scrim = document.querySelector('[data-cal-scrim]') as HTMLElement;
    expect(scrim.style.background).toBe('rgba(46, 42, 38, 0.18)');
    fireEvent.click(scrim);
    await waitFor(() => expect(side()).toBeNull());
    expect(document.querySelector('[data-cal-scrim]')).toBeNull();
    expect(document.querySelector('[aria-label="날짜별 보기"]')!.getAttribute('aria-pressed')).toBe('false');
  });

  it('LNB `일정`으로 들어오면 **이번 달, 오늘**이다 — 다른 달을 보다 나갔다 와도(스펙 5)', async () => {
    renderHome([META('d1', '스프린트 보드')], BODIES());
    await openCalendar();
    const label = () => document.querySelector('[data-cal-month-label]')!.textContent;
    const now = new Date();
    const here = `${now.getFullYear()}년 ${now.getMonth() + 1}월`;
    expect(label()).toBe(here);
    fireEvent.click(document.querySelector('[data-cal-month]')!.parentElement!.querySelector('[aria-label="다음 달"]')!);
    await waitFor(() => expect(label()).not.toBe(here));
    fireEvent.click(document.querySelector('[data-cal-nav]')!);
    await waitFor(() => expect(label()).toBe(here));
    expect(document.querySelector(`[data-day-cell="${todayISO()}"] [data-day-num]`)!.getAttribute('data-selected')).toBe('1');
  });

  it('패널의 미니 달력 — 21px 알약 날짜 아래 3.5px 점(그 날 첫 항목의 종류 색), 오늘은 코랄 알약(스펙 4.1)', async () => {
    renderHome([META('d1', '스프린트 보드')], BODIES());
    await openCalendar();
    const mini = document.querySelector('[data-cal-side] [data-mini-cal]') as HTMLElement;
    expect(mini.dataset.miniVariant).toBe('side');
    const today = mini.querySelector(`[data-mini-day="${todayISO()}"]`) as HTMLElement;
    const pill = today.querySelector('[data-mini-num]') as HTMLElement;
    expect(pill.style.height).toBe('21px');
    expect(pill.style.borderRadius).toBe('99px');
    expect(pill.style.background).toBe('var(--mf-accent)');
    // 오늘 카드(분류 없음) — 점은 칸반 초록.
    const dot = today.querySelector('[data-mini-dot]') as HTMLElement;
    expect(dot.style.width).toBe('3.5px');
    expect(dot.style.background).toBe('rgb(78, 140, 103)');
    // 항목 없는 날의 점은 투명하다(자리는 지킨다 — 줄 높이가 흔들리지 않게).
    const empty = [...mini.querySelectorAll<HTMLElement>('[data-mini-day]')].find((b) => !b.querySelector('[data-mini-dot="1"]'))!;
    expect((empty.querySelector('span[aria-hidden]') as HTMLElement).style.background).toBe('transparent');
    // 누르면 큰 달력의 그 날이 골라진다.
    fireEvent.click(empty);
    await waitFor(() => expect(document.querySelector(`[data-day-cell="${empty.dataset.miniDay}"] [data-day-num]`)?.getAttribute('data-selected')).toBe('1'));
  });

  it('시간 일정이 없는 날 — 시계 + 안내 + `일정 추가`, **시간표는 그대로** 남아 빈 시간대를 누를 수 있다(스펙 4.2·제보 #20)', async () => {
    renderHome([META('d1', '스프린트 보드')], BODIES());
    await openCalendar();
    const empty = await waitFor(() => {
      const el = document.querySelector('[data-cal-timed-empty]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    expect(empty.textContent).toContain('이 날에는 시간 일정이 없어요');
    expect(document.querySelectorAll('[data-cal-hour]')).toHaveLength(24);
    fireEvent.click(empty.querySelector('[data-cal-timed-add]')!);
    await waitFor(() => expect(document.querySelector('[role="dialog"][aria-label="새 일정"]')).toBeTruthy());
  });

  it('날짜 칸 클릭은 **고르기만** 한다 — 접어 둔 날짜별 보기를 다시 펴지 않는다(스펙 5: 토글은 세션 동안 유지)', async () => {
    renderHome([META('d1', '스프린트 보드')], BODIES());
    await openCalendar();
    fireEvent.click(document.querySelector('[aria-label="날짜별 보기"]')!);
    await waitFor(() => expect(document.querySelector('[data-cal-side]')).toBeNull());
    const iso = shiftInMonth(1);
    fireEvent.click(document.querySelector(`[data-day-cell="${iso}"]`)!);
    await waitFor(() => expect(document.querySelector(`[data-day-cell="${iso}"] [data-day-num]`)!.getAttribute('data-selected')).toBe('1'));
    expect(document.querySelector('[data-cal-side]')).toBeNull();
    // 폈을 때 보이는 날은 방금 고른 그 날이다.
    fireEvent.click(document.querySelector('[aria-label="날짜별 보기"]')!);
    const [, m, d] = /(\d{2})-(\d{2})$/.exec(iso)!.map(Number) as unknown as number[];
    await waitFor(() => expect(document.querySelector('[data-cal-agenda-head]')!.textContent).toContain(`${+m!}월 ${+d!}일`));
  });

  it('이웃 달 칸도 평범한 칸처럼 고를 수 있다(제보 #3)', async () => {
    renderHome([META('d1', '스프린트 보드')], BODIES());
    await openCalendar();
    const out = await waitFor(() => {
      const el = document.querySelector('[data-out-month]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    expect(out.getAttribute('role')).toBe('button');
    expect(out.style.background).toBe('var(--mf-cal-out)');
    fireEvent.click(out);
    // 고른 표시는 **안쪽 테두리**다(요청 — 면은 이웃 달 그대로: 고른 면이 이웃 달 면과
    // 거의 같아 보였다). 숫자 상자는 오늘만 채운다.
    await waitFor(() => expect(out.querySelector('[data-day-num][data-selected]')).toBeTruthy());
    expect(out.style.background).toBe('var(--mf-cal-out)');
    expect(out.style.boxShadow).toMatch(SEL_RING_RE);
    expect((out.querySelector('[data-day-num]') as HTMLElement).style.background).toBe('transparent');
    // 사이드가 그 날을 보여 준다 — 이번 달이 아니어도 고를 수 있다.
    const iso = out.getAttribute('data-day-cell')!;
    const [, m, d] = /(\d{2})-(\d{2})$/.exec(iso)!.map(Number) as unknown as number[];
    await waitFor(() => expect(document.querySelector('[data-cal-side]')!.textContent).toContain(`${+m!}월 ${+d!}일`));
  });

  it('이웃 달 칸의 날짜도 토·일 색조를 지킨다(요청 ④) — 이번 달이 아님은 면과 흐림이 말한다', async () => {
    renderHome([META('d1', '스프린트 보드')], BODIES());
    await openCalendar();
    const cells = await waitFor(() => {
      const list = [...document.querySelectorAll('[data-day-cell]')] as HTMLElement[];
      expect(list).toHaveLength(42);
      return list;
    });
    const numOf = (el: HTMLElement) => (el.querySelector('[data-day-num]') as HTMLElement).style.color;
    const out = cells.filter((c) => c.dataset.outMonth === '1');
    expect(out.length).toBeGreaterThan(0);
    for (const cell of out) {
      const dow = cells.indexOf(cell) % 7;
      // 이웃 달의 일요일은 붉은 기, 토요일은 푸른 기를 지닌 채 흐려지고 — 평일만 가라앉은 회색이다.
      if (dow === 0) expect(numOf(cell)).toContain('--mf-cal-num-sun');
      else if (dow === 6) expect(numOf(cell)).toContain('--mf-cal-num-sat');
      else expect(numOf(cell)).toBe('var(--mf-cal-num-out)');
    }
  });

  it('항목을 누르면 상세 팝업이 뜨고, 그 칸반으로 가는 길은 발치 버튼이다', async () => {
    renderHome([META('d1', '스프린트 보드'), META('d2', '이슈 트리아지')], BODIES());
    await openCalendar();
    await waitFor(() => expect(chipTexts().length).toBeGreaterThan(0));
    fireEvent.click(chipFor('오늘 마감 카드'));
    // 클릭이 곧바로 화면을 떠나지 않는다 — "하루 미루기"에 맵을 열 이유가 없다.
    await waitFor(() => expect(detail()).toBeTruthy());
    expect(document.body.textContent).not.toContain('불러오고');
    expect(document.querySelector('[data-cal-detail-title]')!.textContent).toBe('오늘 마감 카드');
    expect(within(detail()).getByText('칸반 카드')).toBeTruthy();
    // 발치 버튼이 그 칸반으로 보낸다(카드 열기와 같은 전체 화면 로더).
    fireEvent.click(within(detail()).getByText('이 칸반 열기'));
    expect(document.body.textContent).toContain('잠시만 기다려 주세요');
    await waitFor(() => expect(screen.getByText('EDITOR_PLACEHOLDER')).toBeTruthy(), { timeout: 3000 });
  });

  it('이 탭이 일정 화면을 보고 있었으면 돌아왔을 때 일정 화면으로 착지한다', async () => {
    // 세션에 남은 화면 = 일정. (예전에는 `loadActiveView`가 이 필드를 걸러 버려
    // 대시보드로 착지했다 — 실브라우저 프로브가 잡은 회귀.)
    sessionStorage.setItem(ACTIVE_VIEW_KEY, JSON.stringify({ activeSpace: 's1', curFolder: null, activeCal: true }));
    renderHome([META('d1', '스프린트 보드'), META('d2', '이슈 트리아지')], BODIES());
    await waitFor(() => expect(document.querySelector('[data-calendar-view]')).toBeTruthy());
    expect(localStorage.getItem('mf_home_landing')).toBe('cal');
  });

  // 폰(모바일 홈 디자인 M3·N6·N7) — 달력엔 점만, 고른 날은 아래 목록. 데이터·상세 팝업은 데스크톱과 같다.
  describe('폰', () => {
    async function openMobileCalendar() {
      mockMatchMedia(true);
      renderHome([META('d1', '스프린트 보드'), META('d2', '이슈 트리아지')], BODIES());
      // LNB(서랍)가 없다 — 일정은 하단 탭이다.
      await waitFor(() => expect(document.querySelector('[data-m-tab="cal"]')).toBeTruthy());
      expect(document.querySelector('aside')).toBeNull();
      fireEvent.click(document.querySelector('[data-m-tab="cal"]')!);
      await waitFor(() => expect(document.querySelector('[data-m-cal]')).toBeTruthy());
    }
    const day = (iso: string) => document.querySelector(`[data-m-cal-day="${iso}"]`) as HTMLElement;
    const titles = () => [...document.querySelectorAll('[data-m-cal-item]')].map((r) => r.querySelector('span:nth-child(3) > span')!.textContent);

    it('6주 42칸 — 칸에는 점, 오늘을 고른 채 들어오고 아래 목록이 그 날을 읽는다', async () => {
      await openMobileCalendar();
      expect(document.querySelector('[data-m-tab="cal"]')!.getAttribute('aria-current')).toBe('page');
      expect(screen.queryByLabelText(/메뉴 열기/)).toBeNull();
      // 데스크톱의 칩 격자·사이드는 그리지 않는다.
      expect(document.querySelectorAll('[data-m-cal-day]').length).toBe(42);
      expect(document.querySelector('[data-day-cell]')).toBeNull();
      expect(document.querySelector('[data-cal-side]')).toBeNull();
      const today = todayISO();
      expect(day(today).getAttribute('aria-selected')).toBe('true');
      await waitFor(() => expect(titles()).toContain('오늘 마감 카드'));
      expect(day(today).querySelectorAll('[data-m-cal-dot]').length).toBeGreaterThan(0);
      expect(day(today).querySelectorAll('[data-m-cal-dot]').length).toBeLessThanOrEqual(3);
      // 요약 — 지난 마감 하나(지난 마감 카드).
      expect(document.querySelector('[data-m-cal-stat="over"]')!.textContent).toBe('지난 마감1');
      // 줄을 누르면 데스크톱과 같은 상세 팝업.
      const row = [...document.querySelectorAll('[data-m-cal-item]')].find((r) => r.textContent!.includes('오늘 마감 카드')) as HTMLElement;
      fireEvent.click(row);
      await waitFor(() => expect(document.querySelector('[data-cal-detail]')).toBeTruthy());
    });

    it('다른 날을 고르면 목록이 그 날로 — 빈 날은 비어 있다고 말한다', async () => {
      await openMobileCalendar();
      await waitFor(() => expect(titles()).toContain('오늘 마감 카드'));
      const tomorrow = shiftDays(1);
      fireEvent.click(day(tomorrow));
      await waitFor(() => expect(titles()).toContain('다른 스페이스 카드'));
      expect(day(tomorrow).getAttribute('aria-selected')).toBe('true');
      // 일정이 하나도 없는 날(이번 달 밖의 먼 날을 고르면 그 달로 넘어간다 — 다음 달 마지막 칸).
      const cells = [...document.querySelectorAll('[data-m-cal-day]')];
      const empty = cells.find((c) => !c.querySelector('[data-m-cal-dot]')) as HTMLElement;
      fireEvent.click(empty);
      await waitFor(() => expect(document.querySelector('[data-m-cal-empty]')).toBeTruthy());
    });

    it('제목을 누르면 월 고르기 시트 — 해를 넘겨 고르면 그 달 1일이 골라진다 · 오늘로', async () => {
      await openMobileCalendar();
      const now = new Date();
      fireEvent.click(document.querySelector('[data-m-cal-title]')!);
      const sheet = await waitFor(() => {
        const el = document.querySelector('[data-m-month-sheet]');
        if (!el) throw new Error('no sheet');
        return el as HTMLElement;
      });
      expect(sheet.querySelector('[data-m-month-year]')!.textContent).toBe(String(now.getFullYear()));
      fireEvent.click(within(sheet).getByRole('button', { name: '다음 해' }));
      expect(sheet.querySelector('[data-m-month-year]')!.textContent).toBe(String(now.getFullYear() + 1));
      fireEvent.click(sheet.querySelector('[data-m-month="3"]')!);
      await waitFor(() => expect(document.querySelector('[data-m-month-sheet]')).toBeNull());
      expect(document.querySelector('[data-m-cal-title]')!.textContent).toContain('3월');
      expect(document.querySelector('[data-m-cal-title]')!.textContent).toContain(String(now.getFullYear() + 1));
      expect(day(isoOf(now.getFullYear() + 1, 3, 1)).getAttribute('aria-selected')).toBe('true');

      fireEvent.click(document.querySelector('[data-m-cal-title]')!);
      fireEvent.click(await waitFor(() => document.querySelector('[data-m-month-today]') as HTMLElement));
      await waitFor(() => expect(day(todayISO()).getAttribute('aria-selected')).toBe('true'));
    });

    it('달력을 옆으로 밀면 달을 넘긴다 — 세로로 민 것은 넘기지 않는다', async () => {
      await openMobileCalendar();
      const grid = document.querySelector('[data-m-cal-grid]')!;
      const now = new Date();
      const next = addMonth(now.getFullYear(), now.getMonth() + 1, 1);
      const swipe = (dx: number, dy: number) => {
        fireEvent.touchStart(grid, { touches: [{ clientX: 200, clientY: 300 }] });
        fireEvent.touchEnd(grid, { changedTouches: [{ clientX: 200 + dx, clientY: 300 + dy }] });
      };
      swipe(-20, 120); // 세로 스크롤
      expect(document.querySelector('[data-m-cal-title]')!.textContent).toContain(`${now.getMonth() + 1}월`);
      swipe(-120, 10); // 왼쪽으로 = 다음 달
      await waitFor(() => expect(document.querySelector('[data-m-cal-title]')!.textContent).toContain(`${next.m}월`));
      expect(day(isoOf(next.y, next.m, 1)).getAttribute('aria-selected')).toBe('true');
      swipe(120, 0); // 오른쪽 = 이전 달(이번 달 — 고른 날은 오늘)
      await waitFor(() => expect(day(todayISO()).getAttribute('aria-selected')).toBe('true'));
    });

    it('목록 아이콘은 「보여 줄 캘린더」 시트를 연다', async () => {
      await openMobileCalendar();
      fireEvent.click(document.querySelector('[data-m-cal-calendars]')!);
      await waitFor(() => expect(document.querySelector('[data-m-calendars-sheet]')).toBeTruthy());
    });

    it('＋는 고른 날로 **전체 화면** 새 일정을 연다 — 종일을 끄면 시각, 등록하면 그 날 목록에 선다', async () => {
      await openMobileCalendar();
      const tomorrow = shiftDays(1);
      fireEvent.click(day(tomorrow));
      fireEvent.click(document.querySelector('[data-m-cal] [data-m-fab]')!);
      const form = await waitFor(() => {
        const el = document.querySelector('[data-new-event-mobile]');
        if (!el) throw new Error('no form');
        return el as HTMLElement;
      });
      // 머리 [취소 · 새 일정 · 등록] — 제목이 없으면 등록이 눌리지 않는다.
      const submit = form.querySelector('[data-new-submit]') as HTMLButtonElement;
      expect(submit.disabled).toBe(true);
      expect(form.querySelector('[data-new-date]')!.textContent).toContain(dateLabel(tomorrow));
      // 종일이 기본 — 끄면 시작·종료 시각이 선다.
      expect(form.querySelector('[data-new-start]')).toBeNull();
      fireEvent.click(within(form).getByRole('switch', { name: '종일' }));
      await waitFor(() => expect(form.querySelector('[data-new-start]')).toBeTruthy());
      expect(form.querySelector('[data-new-end]')).toBeTruthy();
      fireEvent.click(within(form).getByRole('switch', { name: '종일' }));
      fireEvent.change(form.querySelector('[data-new-title]')!, { target: { value: '폰에서 만든 일정' } });
      expect(submit.disabled).toBe(false);
      fireEvent.click(submit);
      await waitFor(() => expect(document.querySelector('[data-new-event]')).toBeNull());
      await waitFor(() => expect(titles()).toContain('폰에서 만든 일정'));
    });

    it('새 일정의 취소는 아무것도 남기지 않는다', async () => {
      await openMobileCalendar();
      fireEvent.click(document.querySelector('[data-m-cal] [data-m-fab]')!);
      const form = await waitFor(() => {
        const el = document.querySelector('[data-new-event-mobile]');
        if (!el) throw new Error('no form');
        return el as HTMLElement;
      });
      fireEvent.change(form.querySelector('[data-new-title]')!, { target: { value: '버릴 일정' } });
      fireEvent.click(form.querySelector('[data-new-cancel]')!);
      await waitFor(() => expect(document.querySelector('[data-new-event]')).toBeNull());
      expect(JSON.parse(localStorage.getItem('mf_events') ?? '[]')).toHaveLength(0);
    });
  });

  // ── 제보 3건(프리뷰 확인) ────────────────────────────────────────────────
  //
  // ① 캘린더가 화면을 다 채우지 않고 "90% 배율"처럼 보였다 — `main`의 패딩
  //    (24/32/44) 안에 들어 있어 사방이 밀리고 격자가 높이까지 자라지 못했다.
  // ② 통계(태그) 칩이 테두리 있는 알약이라 태그 무리처럼 보였다 — 디자인 원본의
  //    칩은 면도 테두리도 없다.
  // ③ 오늘 칸과 고른 칸의 색이 부자연스러웠다 — 강조색 면(soft/mute)을 그대로 써서
  //    칸이 통째로 진하게 칠해졌다.
  it('일정 화면은 본문 패딩 없이 화면을 채운다(제보 ①)', async () => {
    renderHome([META('d1', '스프린트 보드'), META('d2', '이슈 트리아지')], BODIES());
    const main = document.querySelector('main')!;
    // 스페이스 화면에서는 예전 패딩 그대로
    expect(main.style.padding).not.toBe('0px');
    await openCalendar();
    expect(main.style.padding === '0' || main.style.padding === '0px').toBe(true);
    // 안쪽 두 영역이 각자 스크롤하므로 본문은 스크롤을 넘긴다
    expect(main.style.overflowY).toBe('hidden');
  });

  it('오늘도 고른 칸도 면을 바꾸지 않는다 — 고른 칸은 Jira 달력과 같은 안쪽 테두리, 날짜 숫자는 19px 둥근 사각(스펙 3.4)', async () => {
    renderHome([META('d1', '스프린트 보드'), META('d2', '이슈 트리아지')], BODIES());
    await openCalendar();
    const cell = () => document.querySelector('[data-day-cell][data-today="1"]') as HTMLElement;
    const num = () => cell().querySelector('[data-day-num]') as HTMLElement;
    // 진입하면 오늘이 골라져 있다(스펙 5) — 면은 그 날이 무슨 날인가 그대로, 테두리만.
    const dayFaces = ['var(--mf-card)', 'var(--mf-cal-sat)', 'var(--mf-cal-sun)'];
    expect(dayFaces).toContain(cell().style.background);
    expect(cell().style.boxShadow).toMatch(SEL_RING_RE);
    expect(num().style.background).toBe('var(--mf-accent)');
    expect(num().style.width).toBe('19px');
    expect(num().style.borderRadius).toBe('6px');
    expect(num().style.fontSize).toBe('10.5px');
    // 다른 날을 고르면 오늘은 **그 날이 무슨 날인가**의 면(평일·토·일/공휴일)으로 —
    // 코랄 틴트의 오늘 면은 평일인데도 휴일처럼 붉게 읽혔다(요청).
    const other = [...document.querySelectorAll<HTMLElement>('[data-day-cell]')].find((c) => !c.dataset.today && !c.dataset.outMonth)!;
    const otherFace = other.style.background;
    fireEvent.click(other);
    await waitFor(() => expect(other.style.boxShadow).toMatch(SEL_RING_RE));
    // 고른 칸의 면은 고르기 전 그대로, 테두리는 오늘에서 떠난다.
    expect(other.style.background).toBe(otherFace);
    expect(dayFaces).toContain(cell().style.background);
    expect(cell().style.boxShadow).toBe('');
    // 고른 날의 숫자는 면을 채우지 않는다 — 테두리가 이미 말한다.
    expect((other.querySelector('[data-day-num]') as HTMLElement).style.background).toBe('transparent');
  });

  // ── 제보 라운드: 텍스트 선택·선택 표시·우클릭 메뉴·통계 팝오버 ────────────────
  describe('일정 화면 UI(제보 ②③④⑨)', () => {
    beforeEach(() => {
      mockMatchMedia(false);
      seedSpaces();
    });

    it('날짜 칸은 글자를 선택할 수 없다(제보 ② — 더블클릭에 칸 글자가 파랗게 남았다)', () => {
      // jsdom은 실제 선택을 흉내 내지 않으므로 **규칙**을 고정한다(홈 카드와 같은 처방).
      const css = readFileSync(resolve(__dirname, '../../index.css'), 'utf8');
      const rule = /\[data-day-cell\],\s*\[data-cal-widget-cell\]\s*\{[^}]*\}/.exec(css)?.[0] ?? '';
      expect(rule).toContain('user-select: none');
      expect(rule).toContain('-webkit-user-select: none');
    });

    it('달력은 카드가 아니다 — 테두리·모서리·그늘 없이 스크롤 영역을 끝까지 채우고, 뒤에 점 격자가 없다(스펙 3·6)', async () => {
      renderHome([META('d1', '스프린트 보드')], BODIES());
      await openCalendar();
      const canvas = document.querySelector('[data-cal-canvas]') as HTMLElement;
      expect(canvas.style.backgroundImage).toBe('');
      expect(canvas.style.padding).toBe('');
      const grid = document.querySelector('[data-month-grid]') as HTMLElement;
      expect(grid.style.borderRadius).toBe('');
      expect(grid.style.boxShadow).toBe('');
      expect(grid.style.border).toBe('');
      expect(grid.style.background).toBe('var(--mf-cal-frame)');
      // 7 × 92px보다 좁으면 가로로 굴린다.
      expect(grid.style.minWidth).toBe('644px');
      // 요일 줄의 위 선이 헤더와 달력의 유일한 경계 — 오른쪽 패널의 위 선과 같은 토큰이다.
      const dow = document.querySelector('[data-cal-dow-row]') as HTMLElement;
      expect(dow.style.borderTop).toBe('1px solid var(--mf-cal-grid)');
      expect((document.querySelector('[data-cal-side]') as HTMLElement).style.borderTop).toBe('1px solid var(--mf-cal-grid)');
      expect((document.querySelector('[data-cal-head]') as HTMLElement).style.borderBottom).toBe('');
    });

    it('헤더는 점 격자 띠 위의 **월 제목**이다 — 아이콘 타일·부제·알약 월 이동기·G 단추는 없다(스펙 2·6)', async () => {
      renderHome([META('d1', '스프린트 보드')], BODIES());
      await openCalendar();
      const head = document.querySelector('[data-cal-head]') as HTMLElement;
      expect(head.style.backgroundColor).toBe('var(--mf-cal-head)');
      expect(head.style.backgroundImage).toContain('--mf-cal-head-dot');
      expect(head.style.backgroundSize).toBe('18px 18px');
      expect(head.style.padding).toBe('20px 20px 16px 32px');
      const title = document.querySelector('[data-cal-month]') as HTMLElement;
      expect(title.style.fontSize).toBe('26px');
      expect(title.style.fontWeight).toBe('800');
      expect(title.style.height).toBe('38px');
      expect(head.querySelector('h2')).toBeNull();
      expect(head.textContent).not.toContain('마감과 회의를');
      expect(head.querySelector('[data-google-connect-cal]')).toBeNull();
      // 새 일정은 단색 코랄 알약 — 그라디언트·그늘 없음(스펙 2.2).
      const btn = document.querySelector('[data-cal-new]') as HTMLElement;
      expect(btn.style.background).toBe('var(--mf-accent)');
      expect(btn.style.boxShadow).toBe('');
      expect(btn.style.height).toBe('32px');
      expect(btn.style.borderRadius).toBe('99px');
    });

    it('연/달 버튼은 1자리 달과 2자리 달에서 **폭이 같다**(제보 ⑥)', async () => {
      renderHome([META('d1', '스프린트 보드')], BODIES());
      await openCalendar();
      const btn = document.querySelector('[data-cal-month]') as HTMLElement;
      // jsdom에는 레이아웃이 없으므로 **규칙**을 고정한다: 가장 넓은 표기(`…년 12월`)를
      // 같은 칸에 숨겨 두고 그 폭을 쓰고, 숫자는 등폭이다.
      const sizer = btn.querySelector('[aria-hidden="true"]') as HTMLElement;
      expect(sizer.textContent).toMatch(/^\d{4}년 12월$/);
      expect(sizer.style.visibility).toBe('hidden');
      const box = sizer.parentElement as HTMLElement;
      expect(box.style.display).toBe('inline-grid');
      expect(box.style.fontVariantNumeric).toBe('tabular-nums');
      // 보이는 라벨은 자와 같은 칸에 겹친다.
      expect(btn.querySelector('[data-cal-month-label]')!.getAttribute('style')).toContain('grid-area: 1 / 1');
    });

    it('날짜 칸 우클릭 = 그 날의 메뉴 — `이 날에 새 일정`이 그 날짜로 열린다(제보 ④)', async () => {
      renderHome([META('d1', '스프린트 보드')], BODIES());
      await openCalendar();
      const iso = shiftInMonth(3);
      fireEvent.contextMenu(document.querySelector(`[data-day-cell="${iso}"]`)!);
      await waitFor(() => expect(document.querySelector('[data-home-ctx="cal-day"]')).toBeTruthy());
      const menu = document.querySelector('[data-home-ctx="cal-day"]') as HTMLElement;
      expect(menu.textContent).toContain('이 날에 새 일정');
      expect(menu.textContent).toContain('날짜별 보기로 열기');
      fireEvent.click(within(menu).getByText('이 날에 새 일정'));
      await waitFor(() => expect(document.querySelector('[role="dialog"][aria-label="새 일정"]')).toBeTruthy());
      // 누른 그 날이 기본값이다(헤더 ＋와 같은 규칙).
      const [, m, d] = /(\d{2})-(\d{2})$/.exec(iso)!.map(Number) as unknown as number[];
      expect(document.querySelector('[data-new-date]')!.textContent).toContain(`${+m!}월 ${+d!}일`);
    });

    it('칩 우클릭 = 그 항목의 메뉴 — 하루 뒤로 옮기고, 삭제는 한 번 묻는다(제보 ④)', async () => {
      const { docStore } = renderHome([META('d1', '스프린트 보드')], { d1: kanbanBody([{ id: 'k1', col: 'c2', pos: 1, text: '오늘 마감 카드', due: shiftInMonth(0) }]) });
      await openCalendar();
      await waitFor(() => expect(chipFor('오늘 마감 카드')).toBeTruthy());
      fireEvent.contextMenu(chipFor('오늘 마감 카드'));
      await waitFor(() => expect(document.querySelector('[data-home-ctx="cal-entry"]')).toBeTruthy());
      const menu = () => document.querySelector('[data-home-ctx="cal-entry"]') as HTMLElement;
      expect(menu().textContent).toContain('열기');
      expect(menu().textContent).toContain('이 칸반 열기');
      fireEvent.click(within(menu()).getByText('하루 뒤로'));
      // 그 문서에 새 기한이 저장된다(상세·드래그와 같은 write-back 경로).
      await waitFor(() => expect(docStore.save).toHaveBeenCalled());
      const [, next] = docStore.save.mock.calls.at(-1)!;
      expect((next.cards ?? []).find((c) => c.id === 'k1')!.due).toBe(addDays(shiftInMonth(0), 1));

      // 삭제는 확인창을 지난다 — 메뉴 클릭 하나로 사라지지 않는다.
      await waitFor(() => expect(chipFor('오늘 마감 카드')).toBeTruthy());
      fireEvent.contextMenu(chipFor('오늘 마감 카드'));
      await waitFor(() => expect(document.querySelector('[data-home-ctx="cal-entry"]')).toBeTruthy());
      fireEvent.click(within(menu()).getByText('삭제'));
      await waitFor(() => expect(document.querySelector('[data-delete-confirm]')).toBeTruthy());
      expect(document.querySelector('[data-delete-confirm]')!.textContent).toContain('카드를 삭제할까요?');
      fireEvent.click(document.querySelector('[data-confirm-cancel]')!);
      await waitFor(() => expect(document.querySelector('[data-delete-confirm]')).toBeNull());
      expect(chipFor('오늘 마감 카드')).toBeTruthy();
    });

    it('칸·칩이 아닌 자리의 우클릭 = 화면 메뉴(새 일정 · 사이드 토글) — 마감 목록 항목은 없다', async () => {
      renderHome([META('d1', '스프린트 보드')], BODIES());
      await openCalendar();
      fireEvent.contextMenu(document.querySelector('[data-cal-canvas]')!);
      await waitFor(() => expect(document.querySelector('[data-home-ctx="cal-view"]')).toBeTruthy());
      const menu = document.querySelector('[data-home-ctx="cal-view"]') as HTMLElement;
      expect(menu.textContent).toContain('새 일정');
      expect(menu.textContent).not.toContain('마감 목록');
      // 열려 있으니 `닫기` — 고르면 접힌다.
      fireEvent.click(within(menu).getByText('날짜별 보기 닫기'));
      await waitFor(() => expect(document.querySelector('[data-cal-side]')).toBeNull());
    });

    it('날짜 칸의 `날짜별 보기로 열기`는 펴져 있으면 **그대로 둔다**(예전에는 토글을 거쳐 닫혔다)', async () => {
      renderHome([META('d1', '스프린트 보드')], BODIES());
      await openCalendar();
      const iso = shiftInMonth(2);
      fireEvent.contextMenu(document.querySelector(`[data-day-cell="${iso}"]`)!);
      await waitFor(() => expect(document.querySelector('[data-home-ctx="cal-day"]')).toBeTruthy());
      fireEvent.click(within(document.querySelector('[data-home-ctx="cal-day"]') as HTMLElement).getByText('날짜별 보기로 열기'));
      const [, m, d] = /(\d{2})-(\d{2})$/.exec(iso)!.map(Number) as unknown as number[];
      await waitFor(() => expect(document.querySelector('[data-cal-agenda-head]')!.textContent).toContain(`${+m!}월 ${+d!}일`));
      expect(document.querySelector('[data-cal-side]')).toBeTruthy();
    });

  });

  // ── 제보 ⑦⑧: 기간 일정의 진행 바 · 주 단위 줄 고정 ─────────────────────────
  describe('다일 일정(제보 ⑦⑧)', () => {
    beforeEach(() => {
      mockMatchMedia(false);
      seedSpaces();
    });

    it('기간 일정의 줄은 주 내내 고정이다 — 짧은 것이 끝나도 빈 자리가 남는다(제보 ⑧)', async () => {
      // 같은 주에 시작해 종료일이 다른 둘. 예전에는 짧은 것이 끝난 칸부터 남은
      // 바가 한 줄 위로 올라와 **계단처럼** 보였다.
      const iso = (n: number) => addDays(WEEK_START, n);
      renderHome([META('d1', '스프린트 보드')], {
        d1: kanbanBody([
          { id: 'a', col: 'c2', pos: 1, text: '짧은 기간', due: iso(1), start: WEEK_START },
          { id: 'b', col: 'c2', pos: 2, text: '긴 기간', due: iso(3), start: WEEK_START },
        ]),
      });
      await openCalendar();
      await waitFor(() => expect(barFor('긴 기간')).toBeTruthy());
      const rowsOf = (day: string) =>
        [...(document.querySelector(`[data-day-cell="${day}"]`) as HTMLElement).children]
          .filter((el) => el.hasAttribute('data-cal-bar') || el.hasAttribute('data-cal-bar-gap'))
          .map((el) => (el.hasAttribute('data-cal-bar-gap') ? '_' : (el.querySelector('[data-cal-bar-title]')?.textContent ?? el.textContent ?? '').trim() || '·'));
      // 첫 칸: 긴 것이 위(같이 시작하면 긴 것 먼저), 짧은 것이 아래.
      expect(rowsOf(WEEK_START)).toEqual(['긴 기간', '짧은 기간']);
      // 짧은 것이 끝난 뒤에도 긴 것은 **첫 줄 그대로**다(예전에는 아래 것이 올라왔다).
      expect(rowsOf(iso(2))).toEqual(['·']);
    });

    it('위쪽 줄이 빈 칸에는 **빈 자리**가 들어간다 — 그래야 아래 바가 제 높이에 남는다', async () => {
      // 먼저 시작한 짧은 것(lane 0)과 늦게 시작해 더 가는 것(lane 1).
      const iso = (n: number) => addDays(WEEK_START, n);
      renderHome([META('d1', '스프린트 보드')], {
        d1: kanbanBody([
          { id: 'x', col: 'c2', pos: 1, text: '먼저 끝', due: iso(1), start: WEEK_START },
          { id: 'y', col: 'c2', pos: 2, text: '늦게 시작', due: iso(4), start: iso(1) },
        ]),
      });
      await openCalendar();
      await waitFor(() => expect(barFor('늦게 시작')).toBeTruthy());
      const rowsOf = (day: string) =>
        [...(document.querySelector(`[data-day-cell="${day}"]`) as HTMLElement).children]
          .filter((el) => el.hasAttribute('data-cal-bar') || el.hasAttribute('data-cal-bar-gap'))
          .map((el) => (el.hasAttribute('data-cal-bar-gap') ? '_' : (el.querySelector('[data-cal-bar-title]')?.textContent ?? el.textContent ?? '').trim() || '·'));
      // 이어지는 칸에는 제목을 쓰지 않으므로(시작 칸·주 첫 칸만) 첫 줄은 글자 없는 바다.
      expect(rowsOf(iso(1))).toEqual(['·', '늦게 시작']);
      // lane 0이 비었으니 빈 자리를 두고 둘째 줄에 그린다.
      expect(rowsOf(iso(2))).toEqual(['_', '·']);
    });

    it('빈 줄에 새 일정이 들어간다 — 아래로 밀리지 않는다(제보 ①)', async () => {
      // A(0~5) · B(1~2) · C(2~5) → 한 주에서 A=0 · B=1 · C=2 줄. 3일째 칸은 B가
      // 끝나 **가운데 줄이 비는데**, 그 칸의 하루짜리 일정이 예전에는 맨 아래로 갔다.
      const iso = (n: number) => addDays(WEEK_START, n);
      renderHome([META('d1', '스프린트 보드')], {
        d1: kanbanBody([
          { id: 'a', col: 'c2', pos: 1, text: 'A', due: iso(5), start: WEEK_START },
          { id: 'b', col: 'c2', pos: 2, text: 'B', due: iso(2), start: iso(1) },
          { id: 'c', col: 'c2', pos: 3, text: 'C', due: iso(5), start: iso(2) },
          { id: 'n', col: 'c2', pos: 4, text: '새 일정', due: iso(3) },
        ]),
      });
      await openCalendar();
      await waitFor(() => expect(barFor('C')).toBeTruthy());
      const rows = [...(document.querySelector(`[data-day-cell="${iso(3)}"]`) as HTMLElement).children]
        .filter((el) => el.hasAttribute('data-cal-bar') || el.hasAttribute('data-cal-bar-gap') || el.hasAttribute('data-cal-chip'))
        .map((el) => (el.hasAttribute('data-cal-bar-gap') ? '_' : (el.querySelector('[data-cal-bar-title]')?.textContent ?? el.textContent ?? '').trim() || '·'));
      // 빈 자리(_)가 남지 않고 그 줄을 새 일정이 채운다 — C는 제 줄 그대로.
      expect(rows).toEqual(['·', '새 일정', '·']);
    });

    it('기간 일정과 하루짜리가 섞여도 `+N개 더`가 뜬다(제보 ②)', async () => {
      // 예전에는 접힘 표시가 칩만 세고 바는 세지 않아, 이 조합에서 아예 안 나왔다.
      const iso = (n: number) => addDays(WEEK_START, n);
      renderHome([META('d1', '스프린트 보드')], {
        d1: kanbanBody([
          { id: 's1', col: 'c2', pos: 1, text: '기간 하나', due: iso(4), start: WEEK_START },
          { id: 's2', col: 'c2', pos: 2, text: '기간 둘', due: iso(4), start: WEEK_START },
          { id: 'd1', col: 'c2', pos: 3, text: '하루 하나', due: iso(1) },
          { id: 'd2', col: 'c2', pos: 4, text: '하루 둘', due: iso(1) },
        ]),
      });
      await openCalendar();
      await waitFor(() => expect(barFor('기간 하나')).toBeTruthy());
      // 칸이 세 줄만 담으면 마지막 줄이 `+2개`(하루짜리 둘)로 바뀐다.
      const grid = document.querySelector('[data-month-grid]')!.querySelector('[data-day-cell]')!.parentElement as HTMLElement;
      // 칸 113px — 여백 10 + 숫자 19 + 간격 2 + 격자선 1을 빼면 81px: 칩만이면 세 줄, 접힘
      // 표시를 붙이면 두 줄(23·2 + 13 = 59 ✓ / 23·3 + 13 = 82 ✗).
      Object.defineProperty(grid, 'clientHeight', { configurable: true, value: 6 * 113 });
      act(() => { for (const cb of roCallbacks) cb(); });
      const cell = document.querySelector(`[data-day-cell="${iso(1)}"]`) as HTMLElement;
      await waitFor(() => expect(cell.querySelector('[data-cal-more]')).toBeTruthy());
      expect(cell.querySelector('[data-cal-more]')!.textContent).toContain('+2개');
    });

    it('구글 다일 일정 상세에도 진행 바가 뜬다(제보 ⑦)', async () => {
      // Geurio 일정과 구글 일정은 **같은 상세 팝업**을 쓴다 — 우리 표의 다일 일정으로
      // 그 팝업의 바를 확인한다(구글 경로는 라이브 계정이 필요하다).
      renderHome([META('d1', '스프린트 보드')], BODIES());
      localStorage.setItem('mf_events', JSON.stringify([{ id: 'e1', title: '3일 휴가', startDate: shiftInMonth(0), endDate: addDays(shiftInMonth(0), 2), allDay: true, source: 'geurio' }]));
      await openCalendar();
      await waitFor(() => expect(barFor('3일 휴가')).toBeTruthy());
      fireEvent.click(barFor('3일 휴가'));
      await waitFor(() => expect(document.querySelector('[data-event-detail]')).toBeTruthy());
      const span = document.querySelector('[data-event-detail] [data-cal-span]') as HTMLElement;
      expect(span).toBeTruthy();
      expect(span.textContent).toContain('3일 중 1일째');
      expect(span.textContent).toContain('2일 남음');
    });

    it('하루짜리 일정에는 진행 바가 없다(그릴 기간이 없다)', async () => {
      renderHome([META('d1', '스프린트 보드')], BODIES());
      localStorage.setItem('mf_events', JSON.stringify([{ id: 'e1', title: '하루 일정', startDate: shiftInMonth(0), endDate: shiftInMonth(0), allDay: true, source: 'geurio' }]));
      await openCalendar();
      await waitFor(() => expect(chipFor('하루 일정')).toBeTruthy());
      fireEvent.click(chipFor('하루 일정'));
      await waitFor(() => expect(document.querySelector('[data-event-detail]')).toBeTruthy());
      expect(document.querySelector('[data-event-detail] [data-cal-span]')).toBeNull();
    });
  });

  // ── PR2: 상세 팝업(칸반 write-back) + 드래그로 날짜 변경 ────────────────────
  //
  // 정본은 **그 칸반 문서**다. 여기서 고치면 `patchCardMeta`/`moveCard`로 그 문서에
  // 쓰고(`prevVersion` 낙관 잠금), 실패하면 낙관 반영을 되돌리며 알린다.
  describe('상세 팝업과 날짜 변경', () => {
    beforeEach(() => {
      mockMatchMedia(false);
      seedSpaces();
    });

    it('상태 세그먼트로 열을 옮기면 그 칸반에 저장된다(완료로 옮기면 팝업이 닫힌다)', async () => {
      const { docStore } = renderHome([META('d1', '스프린트 보드'), META('d2', '이슈 트리아지')], BODIES());
      await openCalendar();
      await waitFor(() => expect(chipTexts()).toContain('오늘 마감 카드'));
      fireEvent.click(chipFor('오늘 마감 카드'));
      await waitFor(() => expect(detail()).toBeTruthy());

      // 열 셋 모두 고를 수 있고 지금 열이 켜져 있다(라디오 의미 — Radix RadioGroup).
      const seg = document.querySelector('.mf-cal-state')!;
      expect(seg.getAttribute('role')).toBe('radiogroup');
      expect([...seg.querySelectorAll('[data-cal-state-item]')].map((b) => b.textContent)).toEqual(['할 일', '진행 중', '완료']);
      expect(seg.querySelector('[data-cal-state-item="c2"]')!.getAttribute('aria-checked')).toBe('true');

      fireEvent.click(seg.querySelector('[data-cal-state-item="c1"]')!);
      await waitFor(() => expect(docStore.save).toHaveBeenCalled());
      const [id, next, opts] = docStore.save.mock.calls[0]!;
      expect(id).toBe('d1');
      expect((next.cards ?? []).find((c) => c.id === 'k1')!.col).toBe('c1');
      expect(opts?.prevVersion).toBe(1); // 낙관 잠금
      // 화면도 그 열로(낙관 반영 → 저장된 본문으로 덮음)
      await waitFor(() => expect(document.querySelector('[data-cal-state-item="c1"]')!.getAttribute('aria-checked')).toBe('true'));

      // 완료(마지막) 열로 옮기면 달력에서 빠지므로 팝업도 닫는다.
      fireEvent.click(document.querySelector('[data-cal-state-item="c3"]')!);
      await waitFor(() => expect(detail()).toBeNull());
      expect(chipTexts()).not.toContain('오늘 마감 카드');
    });

    it('기한을 고치면 그 칸반에 저장되고 달력에서 그 날로 옮겨진다', async () => {
      const { docStore } = renderHome([META('d1', '스프린트 보드'), META('d2', '이슈 트리아지')], BODIES());
      await openCalendar();
      await waitFor(() => expect(chipTexts()).toContain('오늘 마감 카드'));
      fireEvent.click(chipFor('오늘 마감 카드'));
      await waitFor(() => expect(detail()).toBeTruthy());

      const target = shiftInMonth(2);
      await pickDate('[data-cal-due]', target);
      await waitFor(() => expect(docStore.save).toHaveBeenCalled());
      const [, next] = docStore.save.mock.calls[0]!;
      expect((next.cards ?? []).find((c) => c.id === 'k1')!.due).toBe(target);
      // 그 날 칸으로 옮겨졌다
      await waitFor(() => expect(document.querySelector(`[data-day-cell="${target}"]`)!.textContent).toContain('오늘 마감 카드'));
    });

    it('칩을 다른 칸에 끌어 놓으면 기한이 그 날로 저장된다(드래그 뒤의 클릭은 팝업을 열지 않는다)', async () => {
      const { docStore } = renderHome([META('d1', '스프린트 보드'), META('d2', '이슈 트리아지')], BODIES());
      await openCalendar();
      await waitFor(() => expect(chipTexts()).toContain('오늘 마감 카드'));
      const from = todayISO();
      const to = shiftDays(4);
      const restore = stubCellHitTest([from, to]);
      try {
        const chip = chipFor('오늘 마감 카드');
        expect(chip.style.cursor).toBe('grab');
        dragTo(chip, 10, 150);
      } finally {
        restore();
      }
      await waitFor(() => expect(docStore.save).toHaveBeenCalled());
      const [, next] = docStore.save.mock.calls[0]!;
      expect((next.cards ?? []).find((c) => c.id === 'k1')!.due).toBe(to);
      // 놓은 자리에서 상세 팝업이 뜨지 않는다.
      expect(detail()).toBeNull();
    });

// ── 디자인 원본(`evOpen`) 이식분 ──────────────────────────────────────────
    it('제목·담당·분류를 고치면 그 칸반에 저장되고, 삭제는 카드를 없앤다', async () => {
      localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
      localStorage.setItem('mf_doc_shares', JSON.stringify([{ documentId: 'd1', email: 'mate@example.com', role: 'edit', createdAt: '2026-01-01T00:00:00.000Z', seenAt: null }]));
      const { docStore } = renderHome([META('d1', '스프린트 보드'), META('d2', '이슈 트리아지')], BODIES());
      await openCalendar();
      await waitFor(() => expect(chipTexts()).toContain('오늘 마감 카드'));
      fireEvent.click(chipFor('오늘 마감 카드'));
      await waitFor(() => expect(detail()).toBeTruthy());

      // 제목 — 확정(blur)에 한 번만 저장한다.
      const titleBox = within(detail()).getByLabelText('카드 제목');
      fireEvent.change(titleBox, { target: { value: '고친 제목' } });
      expect(docStore.save).not.toHaveBeenCalled();
      fireEvent.blur(titleBox);
      await waitFor(() => expect(docStore.save).toHaveBeenCalled());
      expect((docStore.save.mock.calls[0]![1].cards ?? []).find((c) => c.id === 'k1')!.text).toBe('고친 제목');

      // 담당 — 공유 참가자에서 고른다(소유자 + 초대받은 사람).
      await waitFor(() => expect(document.querySelector('[data-cal-owner-item="mate@example.com"]')).toBeTruthy());
      docStore.save.mockClear();
      fireEvent.click(document.querySelector('[data-cal-owner-item="mate@example.com"]')!);
      await waitFor(() => expect(docStore.save).toHaveBeenCalled());
      expect((docStore.save.mock.calls[0]![1].cards ?? []).find((c) => c.id === 'k1')!.owner).toBe('mate@example.com');

      // 분류 — 문서의 분류 목록 + `직접 입력`.
      docStore.save.mockClear();
      fireEvent.click(document.querySelector('[data-cal-tag-custom]')!);
      const tagInput = within(detail()).getByLabelText('분류 직접 입력');
      fireEvent.change(tagInput, { target: { value: '기획' } });
      fireEvent.keyDown(tagInput, { key: 'Enter' });
      await waitFor(() => expect(docStore.save).toHaveBeenCalled());
      expect((docStore.save.mock.calls[0]![1].cards ?? []).find((c) => c.id === 'k1')!.tag).toBe('기획');

      // 삭제 — **한 번 묻는다**(요청). 확인 팝업에서 지워야 카드가 사라지고 팝업이 닫힌다.
      docStore.save.mockClear();
      fireEvent.click(document.querySelector('[data-cal-detail-delete]')!);
      await waitFor(() => expect(document.querySelector('[data-delete-confirm]')).toBeTruthy());
      expect(docStore.save).not.toHaveBeenCalled();
      fireEvent.click(document.querySelector('[data-confirm-delete]')!);
      await waitFor(() => expect(docStore.save).toHaveBeenCalled());
      expect((docStore.save.mock.calls[0]![1].cards ?? []).some((c) => c.id === 'k1')).toBe(false);
      await waitFor(() => expect(detail()).toBeNull());
      expect(chipTexts()).not.toContain('고친 제목');
    });

    it('오른쪽 열은 우리 댓글 표를 그대로 쓴다 — 남긴 글이 그 카드에 저장된다', async () => {
      const backend = renderHome([META('d1', '스프린트 보드'), META('d2', '이슈 트리아지')], BODIES());
      await openCalendar();
      await waitFor(() => expect(chipTexts()).toContain('오늘 마감 카드'));
      fireEvent.click(chipFor('오늘 마감 카드'));
      await waitFor(() => expect(detail()).toBeTruthy());
      expect(document.querySelector('[data-cal-comments]')).toBeTruthy();

      const box = within(detail()).getByLabelText('댓글 입력');
      fireEvent.change(box, { target: { value: '이 카드 오늘까지죠?' } });
      fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
      await waitFor(() => expect(within(detail()).getByText('이 카드 오늘까지죠?')).toBeTruthy());
      // 대상은 그 카드다(문서 전체가 아니다).
      const saved = await backend.commentStore.list('d1');
      expect(saved.map((c) => c.nodeId)).toEqual(['k1']);
    });

    it('제자리에 놓으면 아무것도 저장되지 않고, 그 클릭으로 팝업이 뜨지도 않는다', async () => {
      const { docStore } = renderHome([META('d1', '스프린트 보드'), META('d2', '이슈 트리아지')], BODIES());
      await openCalendar();
      await waitFor(() => expect(chipTexts()).toContain('오늘 마감 카드'));
      const restore = stubCellHitTest([todayISO()]);
      try {
        // 같은 칸 안에서 조금 끌었다 놓았다 — 문서는 그대로고, 그 뒤의 `click`이
        // 상세 팝업을 열어서도 안 된다(끌려던 손이 팝업을 부르는 것이 곧 버그다).
        dragTo(chipFor('오늘 마감 카드'), 10, 60);
      } finally {
        restore();
      }
      expect(docStore.save).not.toHaveBeenCalled();
      expect(detail()).toBeNull();
      // 잡기 전과 같은 자리에 그대로 있다(그리고 다시 누르면 팝업은 열린다).
      fireEvent.click(chipFor('오늘 마감 카드'));
      await waitFor(() => expect(detail()).toBeTruthy());
    });

    it('기간 일정을 끌면 시작일과 기한이 함께 움직인다', async () => {
      const { docStore } = renderHome([META('d1', '스프린트 보드'), META('d2', '이슈 트리아지')], BODIES());
      await openCalendar();
      await waitFor(() => expect(barFor('기간 카드')).toBeTruthy());

      // 기간 항목은 상세에 진행 바가 뜨고(원본 `evHasSpan`), 시작일 팝오버에는
      // `지우기`가 있지만 기한 팝오버에는 없다 — 기한을 지우면 달력에서 사라진다.
      fireEvent.click(barFor('기간 카드'));
      await waitFor(() => expect(detail()).toBeTruthy());
      expect(document.querySelector('[data-cal-span]')!.textContent).toMatch(/일 중 .*일째/);
      fireEvent.click(document.querySelector('[data-cal-start]')!);
      await waitFor(() => expect(document.querySelector('[data-datepop-month]')).toBeTruthy());
      expect([...document.querySelectorAll('button')].some((b) => b.textContent === '지우기')).toBe(true);
      fireEvent.keyDown(document, { key: 'Escape' });
      fireEvent.click(document.querySelector('[data-cal-due]')!);
      await waitFor(() => expect(document.querySelector('[data-datepop-month]')).toBeTruthy());
      expect([...document.querySelectorAll('button')].some((b) => b.textContent === '지우기')).toBe(false);
      fireEvent.keyDown(document, { key: 'Escape' });
      // 팝오버가 닫힌 뒤 팝업을 닫는다(발치 `완료`).
      await waitFor(() => expect(document.querySelector('[data-datepop-month]')).toBeNull());
      fireEvent.click(document.querySelector('[data-cal-detail-done]')!);
      await waitFor(() => expect(detail()).toBeNull());

      // 막을 눌러도 닫힌다 — 아직 저장되지 않은 입력이 없으므로 잃을 것이 없다
      // (Radix는 pointerdown으로 '바깥'을 판정한다).
      fireEvent.click(barFor('기간 카드'));
      await waitFor(() => expect(detail()).toBeTruthy());
      fireEvent.pointerDown(detail().parentElement!, { bubbles: true });
      await waitFor(() => expect(detail()).toBeNull());

      // 기간 카드: 시작 칸(제목이 붙는 칸)을 잡아 두 칸 뒤로 → 시작·기한이 +2일씩.
      const grab = SPAN.start;
      const drop = addDays(SPAN.start, 2);
      const restore = stubCellHitTest([grab, drop]);
      try {
        dragTo(barFor('기간 카드'), 10, 150);
      } finally {
        restore();
      }
      await waitFor(() => expect(docStore.save).toHaveBeenCalled());
      const [, next] = docStore.save.mock.calls[0]!;
      const card = (next.cards ?? []).find((c) => c.id === 'k4')!;
      expect(card.start).toBe(addDays(SPAN.start, 2));
      expect(card.due).toBe(addDays(SPAN.due, 2));
    });

    it('보기 전용으로 공유받은 보드는 끌리지도 고쳐지지도 않는다', async () => {
      // 공유받은 문서 = `list()`가 `ownedByMe: false`로 돌려주는 메타 + 내 이메일로 온 초대.
      // (그 본문은 일정 화면에서 함께 프리페치된다 — 스페이스 목록에 없기 때문.)
      localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
      localStorage.setItem('mf_doc_shares', JSON.stringify([{ documentId: 'd3', email: 'me@example.com', role: 'view', createdAt: '2026-01-01T00:00:00.000Z', seenAt: '2026-01-01T00:00:00.000Z' }]));
      const bodies = { ...BODIES(), d3: kanbanBody([{ id: 'v1', col: 'c1', pos: 1, text: '남의 카드', due: todayISO() }]) };
      const shared: DocMeta = { ...META('d3', '남의 보드'), ownedByMe: false, sharedRole: 'view' };
      const { docStore } = renderHome([META('d1', '스프린트 보드'), META('d2', '이슈 트리아지'), shared], bodies);
      await openCalendar();
      await waitFor(() => expect(chipTexts()).toContain('남의 카드'));
      const chip = chipFor('남의 카드');
      // 끌리지 않는다(잡아도 고스트가 없고 저장도 없다)
      expect(chip.style.cursor).toBe('pointer');
      const restore = stubCellHitTest([todayISO(), shiftDays(3)]);
      try {
        dragTo(chip, 10, 150);
      } finally {
        restore();
      }
      expect(document.querySelector('[data-cal-ghost]')).toBeNull();
      expect(docStore.save).not.toHaveBeenCalled();

      // 팝업은 열리지만 고칠 것이 없다 — 안내만(고쳐지는 척하지 않는다).
      fireEvent.click(chip);
      await waitFor(() => expect(detail()).toBeTruthy());
      expect(within(detail()).getByText('보기 전용')).toBeTruthy();
      expect(document.querySelector('[data-cal-detail-ro]')).toBeTruthy();
      // 고칠 수 있는 것이 아무것도 없다 — 상태·날짜·담당·분류·삭제 전부.
      expect(document.querySelector('.mf-cal-state')).toBeNull();
      expect(document.querySelector('[data-cal-due]')).toBeNull();
      expect(document.querySelector('[data-cal-owner]')).toBeNull();
      expect(document.querySelector('[data-cal-tag]')).toBeNull();
      expect(document.querySelector('[data-cal-detail-delete]')).toBeNull();
      expect((within(detail()).getByLabelText('카드 제목') as HTMLTextAreaElement).readOnly).toBe(true);
    });

    it('끌고 있는 동안 고스트가 손끝을 따라오고 놓일 칸이 강조된다', async () => {
      renderHome([META('d1', '스프린트 보드'), META('d2', '이슈 트리아지')], BODIES());
      await openCalendar();
      await waitFor(() => expect(chipTexts()).toContain('오늘 마감 카드'));
      const from = todayISO();
      const to = shiftDays(4);
      const restore = stubCellHitTest([from, to]);
      try {
        const chip = chipFor('오늘 마감 카드');
        firePointer(chip, 'pointerdown', { clientX: 10, clientY: 10 });
        firePointer(window, 'pointermove', { clientX: 150, clientY: 10 });
        const ghost = document.querySelector('[data-cal-ghost]') as HTMLElement;
        expect(ghost).toBeTruthy();
        expect(ghost.textContent).toContain('오늘 마감 카드');
        expect(ghost.textContent).toContain('+4일'); // 며칠 움직이는지 미리 말한다
        expect(ghost.style.left).toBe('160px');
        // 놓일 칸은 강조색 링 + 옅은 면
        const cell = document.querySelector(`[data-day-cell="${to}"]`) as HTMLElement;
        expect(cell.style.boxShadow).toContain('var(--mf-accent)');
        expect(cell.style.background).toBe('var(--mf-accent-soft)');
        // 원본 칩은 자리에서 흐려진다(옮기는 것은 고스트가 말한다)
        expect(chipFor('오늘 마감 카드').style.opacity).toBe('0.4');
        firePointer(window, 'pointercancel', {});
      } finally {
        restore();
      }
      // 취소는 이동이 아니다 — 고스트가 걷히고 아무것도 저장되지 않는다.
      await waitFor(() => expect(document.querySelector('[data-cal-ghost]')).toBeNull());
    });
  });
  /**
   * Geurio 일정(0033) — 칸반 마감과 나란한 두 번째 원천. 로컬 어댑터가 실제로 쓰고
   * 읽으므로(`mf_events`) 저장까지 이어지는 흐름을 그대로 본다.
   */
  describe('Geurio 일정', () => {
    /**
     * **시계를 낮으로 고정한다** — 이 구획의 새 일정은 `nextTimeSlot()`(지금 기준 다음
     * 눈금)에서 시작하는데, 저녁 늦게 돌리면 `start + 120`이 23:59로 잘려 `2시간`이
     * `1시간 59분`이 된다. 실제로 23:35 KST에 CI가 깨졌다(밤에만 깨지는 테스트 —
     * `docs/probe-pitfalls.md` F5와 같은 계열). 오프셋이 아니라 **앵커**를 쓴다.
     */
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const anchor = new Date();
      anchor.setHours(10, 5, 0, 0);
      vi.setSystemTime(anchor);
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    const events = (): Array<Record<string, unknown>> => JSON.parse(localStorage.getItem('mf_events') ?? '[]') as Array<Record<string, unknown>>;
    const newEv = (): HTMLElement => document.querySelector('[data-new-event]') as HTMLElement;
    const evDetail = (): HTMLElement => document.querySelector('[data-event-detail]') as HTMLElement;

    it('`새 일정`으로 종일 일정을 만들면 그 날 칸에 뜨고 우리 표에 저장된다', async () => {
      renderHome([META('d1', '스프린트 보드'), META('d2', '이슈 트리아지')], BODIES());
      await openCalendar();
      fireEvent.click(document.querySelector('[data-cal-new]')!);
      await waitFor(() => expect(newEv()).toBeTruthy());
      // 종일이 기본 — 저장할 곳이 하나뿐이므로 고르기 대신 배지로 알린다.
      expect(document.querySelector('[data-new-allday]')!.getAttribute('aria-pressed')).toBe('true');
      expect(within(newEv()).getByText('Geurio 캘린더')).toBeTruthy();
      // 제목이 없으면 저장 버튼이 눌리지 않는다.
      expect((document.querySelector('[data-new-submit]') as HTMLButtonElement).disabled).toBe(true);
      fireEvent.change(document.querySelector('[data-new-title]')!, { target: { value: '팀 워크숍' } });
      fireEvent.change(document.querySelector('[data-new-loc]')!, { target: { value: '3층 회의실' } });
      fireEvent.click(document.querySelector('[data-new-submit]')!);

      await waitFor(() => expect(document.querySelector('[data-new-event]')).toBeNull());
      expect(events()).toHaveLength(1);
      expect(events()[0]).toMatchObject({ title: '팀 워크숍', allDay: true, location: '3층 회의실', source: 'geurio', startDate: todayISO() });
      // 칸반 마감과 같은 칩으로 격자에 그려진다(원천을 가리지 않는다).
      await waitFor(() => expect(chipTexts()).toContain('팀 워크숍'));
    });

    it('반복을 걸면 RRULE로 저장되고 달력에 회차가 여러 개 뜬다 — Geurio 일정도 반복한다', async () => {
      renderHome([META('d1', '스프린트 보드')], BODIES());
      await openCalendar();
      fireEvent.click(document.querySelector('[data-cal-new]')!);
      await waitFor(() => expect(newEv()).toBeTruthy());
      // 반복 구획은 목적지와 무관하게 뜬다(구글 전용이 아니다).
      expect(document.querySelector('[data-recurrence]')).toBeTruthy();
      fireEvent.change(document.querySelector('[data-new-title]')!, { target: { value: '주간 스탠드업' } });
      // 시작을 이 달 5일로 — 오늘이 월말이면 회차가 다음 달로 넘어가 이 격자의 '이 달'
      // 칸에는 하나만 들어온다(달 밖 칸에는 칩을 그리지 않는다).
      await pickDate('[data-new-date]', `${todayISO().slice(0, 8)}05`);
      // 매일로 걸면 이번 달 격자에 회차가 여러 번 그려진다.
      fireEvent.click(document.querySelector('[data-rep-preset="daily"]')!);
      await waitFor(() => expect(document.querySelector('[data-rep-summary]')!.textContent).toContain('매일'));
      fireEvent.click(document.querySelector('[data-new-submit]')!);

      await waitFor(() => expect(document.querySelector('[data-new-event]')).toBeNull());
      expect(events()[0]).toMatchObject({ title: '주간 스탠드업', recurrence: 'RRULE:FREQ=DAILY' });
      // 이번 달 격자에 회차가 여러 번 그려진다(한 행이 여러 날에 뜬다).
      await waitFor(() => expect(chipTexts().filter((t) => t === '주간 스탠드업').length).toBeGreaterThan(1));
    });

    it('맞춤 반복은 간격·종료를 고른다 — 횟수만큼만 회차가 나온다', async () => {
      renderHome([META('d1', '스프린트 보드')], BODIES());
      await openCalendar();
      fireEvent.click(document.querySelector('[data-cal-new]')!);
      await waitFor(() => expect(newEv()).toBeTruthy());
      fireEvent.change(document.querySelector('[data-new-title]')!, { target: { value: '격주 회고' } });
      fireEvent.click(document.querySelector('[data-rep-preset="custom"]')!);
      await waitFor(() => expect(document.querySelector('[data-rep-custom]')).toBeTruthy());
      // 2주마다 · 2회 반복 후 종료
      fireEvent.click(within(document.querySelector('[data-rep-custom]') as HTMLElement).getAllByLabelText('늘리기')[0]!);
      fireEvent.click(document.querySelector('[data-rep-unit="week"]')!);
      fireEvent.click(document.querySelector('[data-rep-endmode="count"]')!);
      await waitFor(() => expect(document.querySelector('[data-rep-summary]')!.textContent).toContain('2주마다'));
      fireEvent.click(document.querySelector('[data-new-submit]')!);

      await waitFor(() => expect(document.querySelector('[data-new-event]')).toBeNull());
      // `횟수`를 고르면 기본 횟수가 함께 정해진다 — COUNT 없이 "횟수"라 적히면 거짓말이다.
      expect(events()[0]!.recurrence).toBe('RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=5');
      // 상세 팝업은 "고치면 전체 반복에 적용된다"를 숨기지 않는다.
      await waitFor(() => expect(chipTexts()).toContain('격주 회고'));
      fireEvent.click(screen.getAllByText('격주 회고')[0]!.closest('[data-cal-chip]')!);
      await waitFor(() => expect(document.querySelector('[data-event-repeat]')!.textContent).toContain('전체 반복'));
    });

    it('종일을 끄면 시각을 고르고, 빠른 칩이 종료 시각을 정한다', async () => {
      renderHome([META('d1', '스프린트 보드')], BODIES());
      await openCalendar();
      fireEvent.click(document.querySelector('[data-cal-new]')!);
      await waitFor(() => expect(newEv()).toBeTruthy());
      fireEvent.click(document.querySelector('[data-new-allday]')!);
      await waitFor(() => expect(document.querySelector('[data-new-start]')).toBeTruthy());
      // 기본은 **지금 기준 다음 눈금**부터 한 시간(요청) — 고정 09:00이 아니다.
      const slot = nextTimeSlot();
      expect(document.querySelector('[data-new-dur]')!.textContent).toBe('1시간');
      expect(document.querySelector('[data-new-start]')!.textContent).toBe(timeLabel(minutesOf(slot.start)!));
      fireEvent.click(document.querySelector('[data-new-quick="120"]')!);
      await waitFor(() => expect(document.querySelector('[data-new-dur]')!.textContent).toBe('2시간'));
      fireEvent.change(document.querySelector('[data-new-title]')!, { target: { value: '설계 회의' } });
      fireEvent.click(document.querySelector('[data-new-submit]')!);
      await waitFor(() => expect(events()).toHaveLength(1));
      expect(events()[0]).toMatchObject({
        title: '설계 회의',
        allDay: false,
        startTime: slot.start,
        endTime: hhmm(Math.min(23 * 60 + 59, minutesOf(slot.start)! + 120)),
      });
    });

    it('알림을 걸면 저장되고, 종일 일정에서는 그 자리가 비활성 + 이유를 말한다(0038)', async () => {
      renderHome([META('d1', '스프린트 보드')], BODIES());
      await openCalendar();
      fireEvent.click(document.querySelector('[data-cal-new]')!);
      await waitFor(() => expect(newEv()).toBeTruthy());

      // 기본은 종일 — 그때는 알림을 걸 수 없다(자정 10분 전은 뜻이 어긋난다).
      expect(document.querySelector('[data-gf-remind-off]')).toBeTruthy();
      expect(newEv().textContent).toContain('종일 일정에는 알림을 걸 수 없어요');
      expect(document.querySelector('[data-gf-remind]')).toBeNull();
      // **저장되지 않을 값을 굵게 칠하지 않는다** — 초기값이 10분이 된 뒤로도 종일
      // 일정에는 그 값이 실리지 않으므로(`submit`·`inputToGoogleDraft`의 가드),
      // 굵은 칩이 하나도 없어야 "걸 수 없어요"와 한 말이 된다.
      const off = [...document.querySelectorAll('[data-gf-remind-off] span')];
      expect(off.filter((c) => (c as HTMLElement).style.fontWeight === '800')).toHaveLength(0);

      fireEvent.click(document.querySelector('[data-new-allday]')!);
      await waitFor(() => expect(document.querySelector('[data-gf-remind]')).toBeTruthy());
      // **`없음`이 맨 뒤고 `기본`은 없다**(요청) — 실제로 고르는 것은 앞의 셋이고
      // `없음`은 끄는 칸이라 첫 자리에 두면 기본값처럼 읽힌다. `기본`(구글의
      // `useDefault`)은 우리 표에 대응하는 값이 아예 없었고, 구글 쪽에서도 뺐다.
      const chips = [...document.querySelectorAll('[data-gf-remind]')].map((c) => c.textContent);
      expect(chips).toEqual(['10분 전', '1시간 전', '1일 전', '없음']);
      // **10분 전이 기본값이다**(요청) — 고르지 않아도 켜져 있다.
      expect(screen.getByRole('radio', { name: '10분 전' }).getAttribute('aria-checked')).toBe('true');

      fireEvent.change(document.querySelector('[data-new-title]')!, { target: { value: '팀 회의' } });
      fireEvent.click(document.querySelector('[data-new-submit]')!);
      await waitFor(() => expect(events()).toHaveLength(1));
      expect(events()[0]).toMatchObject({ title: '팀 회의', allDay: false, reminderMinutes: 10 });
    });

    it('알림의 `일정 보기`는 **그 일정**을 보여 준다 — 이미 일정 화면이어도(제보)', async () => {
      renderHome([META('d1', '스프린트 보드')], BODIES());
      const day = todayISO();
      localStorage.setItem(
        'mf_events',
        JSON.stringify([{ id: 'e1', title: '팀 회의', startDate: day, endDate: day, allDay: false, startTime: '10:30', endTime: '11:30', reminderMinutes: 10 }]),
      );
      await openCalendar();
      // 이미 일정 화면이고 **다른 달을 보고 있다** — 예전에는 이 상태에서 알림의
      // `일정 보기`를 눌러도 화면만 "일정"으로 바뀌어(이미 그 화면이다) 아무 일도
      // 일어나지 않았다.
      expect(document.querySelector('[data-calendar-view]')).toBeTruthy();
      // 두 달 뒤 — 다음 달 격자는 이웃 칸으로 오늘을 담을 수 있다(달의 마지막 주).
      const next = () => document.querySelector('[data-cal-month]')!.parentElement!.querySelector('[aria-label="다음 달"]')!;
      fireEvent.click(next());
      fireEvent.click(next());
      await waitFor(() => expect(document.querySelector(`[data-day-cell="${day}"]`)).toBeNull());
      expect(evDetail()).toBeNull();

      // 토스트·OS 알림이 지나는 그 길(`ReminderHost` → `focusCalendar`).
      await act(async () => {
        focusCalendar({ date: day, eventId: 'e1', source: 'geurio' });
      });

      // 그 회차가 놓인 달로 돌아오고, 그 날이 골라지고, 그 일정의 상세가 뜬다.
      await waitFor(() => expect(evDetail()).toBeTruthy());
      expect(document.querySelector(`[data-day-cell="${day}"]`)).toBeTruthy();
      expect(document.querySelector(`[data-day-cell="${day}"] [data-day-num][data-selected]`)).toBeTruthy();
      // 고른 날은 하나뿐이다.
      expect(document.querySelectorAll('[data-day-num][data-selected]').length).toBe(1);
      expect((document.querySelector('[data-event-title]') as HTMLInputElement).value).toBe('팀 회의');
    });

    it('상세에서 알림을 바꾸면 완료가 함께 저장하고, `없음`은 끈 것으로 저장된다', async () => {
      renderHome([META('d1', '스프린트 보드')], BODIES());
      const day = todayISO();
      localStorage.setItem(
        'mf_events',
        JSON.stringify([{ id: 'e1', title: '팀 회의', startDate: day, endDate: day, allDay: false, startTime: '10:30', endTime: '11:30', reminderMinutes: 10, source: 'geurio' }]),
      );
      await openCalendar();
      await waitFor(() => expect(chipFor('팀 회의')).toBeTruthy());
      fireEvent.click(chipFor('팀 회의'));
      await waitFor(() => expect(evDetail()).toBeTruthy());
      // 지금 값이 켜져 있다.
      expect(screen.getByRole('radio', { name: '10분 전' }).getAttribute('aria-checked')).toBe('true');

      fireEvent.click(screen.getByRole('radio', { name: '1시간 전' }));
      // 저장은 `완료`에서 한 번 — 고르기만 한 시점에는 표가 그대로다.
      expect(events()[0]).toMatchObject({ reminderMinutes: 10 });
      fireEvent.click(document.querySelector('[data-event-done]')!);
      await waitFor(() => expect(events()[0]).toMatchObject({ reminderMinutes: 60 }));

      // `없음`은 "안 바꾼다"가 아니라 끈 것이다.
      fireEvent.click(chipFor('팀 회의'));
      await waitFor(() => expect(evDetail()).toBeTruthy());
      fireEvent.click(screen.getByRole('radio', { name: '없음' }));
      fireEvent.click(document.querySelector('[data-event-done]')!);
      await waitFor(() => expect(events()[0]!.reminderMinutes).toBeUndefined());
    });

    it('알림을 저장하면 **스케줄러에 곧바로 알린다**(제보: 걸어 둔 알림이 오지 않았다)', async () => {
      // 스케줄러는 화면과 따로 돌며 5분 주기로 일정을 받는다. 그 주기를 기다리면
      // "10분 뒤 일정 + 10분 전 알림"처럼 알림 시각이 곧 지금인 경우가 유예를 넘겨
      // 영영 뜨지 않는다 — 그래서 우리가 고친 변경은 그 자리에서 알린다.
      const seen: number[] = [];
      const off = onCalendarChanged(() => seen.push(1));
      try {
        renderHome([META('d1', '스프린트 보드')], BODIES());
        const day = todayISO();
        localStorage.setItem(
          'mf_events',
          JSON.stringify([{ id: 'e1', title: '팀 회의', startDate: day, endDate: day, allDay: false, startTime: '10:30', endTime: '11:30', source: 'geurio' }]),
        );
        await openCalendar();
        await waitFor(() => expect(chipFor('팀 회의')).toBeTruthy());
        fireEvent.click(chipFor('팀 회의'));
        await waitFor(() => expect(evDetail()).toBeTruthy());
        fireEvent.click(screen.getByRole('radio', { name: '10분 전' }));
        expect(seen).toHaveLength(0); // 고르기만 한 시점에는 저장도 신호도 없다
        fireEvent.click(document.querySelector('[data-event-done]')!);
        await waitFor(() => expect(events()[0]).toMatchObject({ reminderMinutes: 10 }));
        expect(seen.length).toBeGreaterThan(0);
      } finally {
        off();
      }
    });

    it('시작 날짜를 앞으로 당기면 종료 날짜도 따라온다(하루짜리가 기간 일정이 되지 않는다)', async () => {
      // 클램프만 있던 판에서는 시작을 당기는 순간 그 사이만큼 긴 기간 일정이 됐다
      // (실브라우저 프로브가 잡은 자리 — 하루가 24일짜리 바로 그려졌다).
      renderHome([META('d1', '스프린트 보드')], BODIES());
      await openCalendar();
      fireEvent.click(document.querySelector('[data-cal-new]')!);
      await waitFor(() => expect(newEv()).toBeTruthy());
      fireEvent.change(document.querySelector('[data-new-title]')!, { target: { value: '앞으로 당긴 일정' } });
      const back = shiftDays(-3);
      await pickDate('[data-new-date]', back);
      await waitFor(() => expect(events().length + 1).toBeGreaterThan(0));
      fireEvent.click(document.querySelector('[data-new-submit]')!);
      await waitFor(() => expect(events()).toHaveLength(1));
      // 하루짜리 그대로 — 시작과 끝이 같다.
      expect(events()[0]).toMatchObject({ startDate: back, endDate: back });
    });

    it('상세에서도 시작 날짜를 옮기면 기간 길이가 유지된다', async () => {
      renderHome([META('d1', '스프린트 보드')], BODIES());
      const from = todayISO();
      localStorage.setItem('mf_events', JSON.stringify([{ id: 'e1', title: '3일 휴가', startDate: from, endDate: shiftDays(2), allDay: true, source: 'geurio' }]));
      await openCalendar();
      await waitFor(() => expect(barFor('3일 휴가')).toBeTruthy());
      fireEvent.click(barFor('3일 휴가'));
      await waitFor(() => expect(evDetail()).toBeTruthy());
      const back = shiftDays(-4);
      await pickDate('[data-event-date]', back);
      // 저장은 완료 버튼에서 한 번(요청) — 고르기만 한 시점에는 표가 그대로다.
      expect(events()[0]).toMatchObject({ startDate: from });
      fireEvent.click(document.querySelector('[data-event-done]')!);
      // 3일간이 그대로 — 시작만 옮겨진다.
      await waitFor(() => expect(events()[0]).toMatchObject({ startDate: back, endDate: shiftDays(-2) }));
    });

    it('시작 시각을 옮기면 길이를 지킨 채 종료 시각도 따라온다', async () => {
      // 그러지 않으면 늦은 시각을 고르는 순간 종료가 시작보다 앞서고 저장이 막힌다
      // (실브라우저 프로브가 잡은 자리 — 90분 칩 뒤에 시작을 오후로 옮긴 흐름).
      renderHome([META('d1', '스프린트 보드')], BODIES());
      await openCalendar();
      fireEvent.click(document.querySelector('[data-cal-new]')!);
      await waitFor(() => expect(newEv()).toBeTruthy());
      fireEvent.change(document.querySelector('[data-new-title]')!, { target: { value: '오후 회의' } });
      fireEvent.click(document.querySelector('[data-new-allday]')!);
      await waitFor(() => expect(document.querySelector('[data-new-start]')).toBeTruthy());
      fireEvent.click(document.querySelector('[data-new-quick="120"]')!); // 09:00–11:00
      // 시각 팝오버에서 오후 2시를 고른다
      fireEvent.click(document.querySelector('[data-new-start]')!);
      await waitFor(() => expect(document.querySelector('[data-timepop-time="14:00"]')).toBeTruthy());
      fireEvent.click(document.querySelector('[data-timepop-time="14:00"]')!);
      // 길이(2시간)가 그대로라 저장이 막히지 않는다
      await waitFor(() => expect(document.querySelector('[data-new-dur]')!.textContent).toBe('2시간'));
      expect((document.querySelector('[data-new-submit]') as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(document.querySelector('[data-new-submit]')!);
      await waitFor(() => expect(events()).toHaveLength(1));
      expect(events()[0]).toMatchObject({ startTime: '14:00', endTime: '16:00' });
    });

    it('상세에서도 시작 시각을 옮기면 종료가 따라온다(시각이 사라지지 않는다)', async () => {
      renderHome([META('d1', '스프린트 보드')], BODIES());
      localStorage.setItem('mf_events', JSON.stringify([{ id: 'e1', title: '회의', startDate: todayISO(), endDate: todayISO(), allDay: false, startTime: '09:00', endTime: '10:00', source: 'geurio' }]));
      await openCalendar();
      await waitFor(() => expect(chipTexts()).toContain('회의'));
      fireEvent.click(chipFor('회의'));
      await waitFor(() => expect(evDetail()).toBeTruthy());
      fireEvent.click(document.querySelector('[data-event-start]')!);
      await waitFor(() => expect(document.querySelector('[data-timepop-time="16:00"]')).toBeTruthy());
      fireEvent.click(document.querySelector('[data-timepop-time="16:00"]')!);
      fireEvent.click(document.querySelector('[data-event-done]')!);
      // 종료가 앞섰다면 정규화가 종일로 되돌려 시각이 통째로 사라진다.
      await waitFor(() => expect(events()[0]).toMatchObject({ allDay: false, startTime: '16:00', endTime: '17:00' }));
    });

    // 제보 — 화면을 열어 둔 채 **다른 곳**에서 일정이 바뀌면 잡지 못했다(구글 캘린더가
    // 그 경우였고, 우리 일정도 다른 기기에서 바뀌면 같은 처지다). 탭으로 돌아오는
    // 순간이 자연스러운 계기다(새 배포 감지·알림 벨과 같은 규칙).
    it('열어 둔 채 다른 기기에서 일정이 늘면, 탭으로 돌아올 때 잡아 온다', async () => {
      renderHome([META('d1', '스프린트 보드')], BODIES());
      localStorage.setItem('mf_events', JSON.stringify([{ id: 'e1', title: '주간 회의', startDate: todayISO(), endDate: todayISO(), allDay: true, source: 'geurio' }]));
      await openCalendar();
      await waitFor(() => expect(chipTexts()).toContain('주간 회의'));
      expect(chipTexts()).not.toContain('다른 기기에서 추가');

      // 저장소가 곧 다른 기기다 — 그 사이 한 건이 늘었다.
      localStorage.setItem(
        'mf_events',
        JSON.stringify([
          { id: 'e1', title: '주간 회의', startDate: todayISO(), endDate: todayISO(), allDay: true, source: 'geurio' },
          { id: 'e2', title: '다른 기기에서 추가', startDate: todayISO(), endDate: todayISO(), allDay: true, source: 'geurio' },
        ]),
      );
      fireEvent(window, new Event('focus'));
      await waitFor(() => expect(chipTexts()).toContain('다른 기기에서 추가'));
    });

    it('일정을 누르면 **칸반과 다른 팝업**이 뜨고, 저장은 완료 버튼에서 한 번이다', async () => {
      renderHome([META('d1', '스프린트 보드')], BODIES());
      localStorage.setItem('mf_events', JSON.stringify([{ id: 'e1', title: '주간 회의', startDate: todayISO(), endDate: todayISO(), allDay: true, source: 'geurio' }]));
      await openCalendar();
      await waitFor(() => expect(chipTexts()).toContain('주간 회의'));
      fireEvent.click(chipFor('주간 회의'));
      await waitFor(() => expect(evDetail()).toBeTruthy());
      // 칸반 상세가 아니다 — 상태·담당·분류가 없고 종일 토글·위치·메모가 있다.
      expect(document.querySelector('[data-cal-detail]')).toBeNull();
      expect(within(evDetail()).queryByText('이 칸반 열기')).toBeNull();
      expect(document.querySelector('[data-event-allday]')).toBeTruthy();
      // "자동으로 저장" 문구는 이제 거짓말이라 없다(요청 — 저장은 완료가 한다).
      expect(evDetail().textContent).not.toContain('자동으로 저장');

      // 위치를 적고 종일을 꺼도 **완료 전에는 저장되지 않는다**(요청 — 초안 모델).
      fireEvent.change(document.querySelector('[data-event-loc]')!, { target: { value: '2층 라운지' } });
      fireEvent.click(document.querySelector('[data-event-allday]')!);
      expect(events()[0]).toMatchObject({ allDay: true });
      expect(events()[0]!.location).toBeUndefined();

      // 완료 한 번이 바뀐 것을 모아 저장하고 팝업을 닫는다.
      fireEvent.click(document.querySelector('[data-event-done]')!);
      // 시각이 없던 일정을 시간 일정으로 바꾸면 **지금 기준 다음 눈금**부터 한 시간이다
      // (요청). 정확한 값은 `nextTimeSlot` 유닛이 보고, 여기서는 그 모양만 본다 —
      // 실제 시계로 도는 통합 테스트라 15분 경계를 넘길 수 있다.
      await waitFor(() => expect(events()[0]).toMatchObject({ allDay: false, location: '2층 라운지' }));
      const saved = events()[0] as { startTime: string; endTime: string };
      expect(minutesOf(saved.startTime)! % 15).toBe(0);
      expect(minutesOf(saved.endTime)! - minutesOf(saved.startTime)!).toBe(60);
      await waitFor(() => expect(document.querySelector('[data-event-detail]')).toBeNull());
    });

    it('일정 색을 골라 저장한다 — Geurio는 앱 팔레트의 hex다(요청 ⑤)', async () => {
      renderHome([META('d1', '스프린트 보드')], BODIES());
      localStorage.setItem('mf_events', JSON.stringify([{ id: 'e1', title: '주간 회의', startDate: todayISO(), endDate: todayISO(), allDay: true, source: 'geurio' }]));
      await openCalendar();
      await waitFor(() => expect(chipTexts()).toContain('주간 회의'));
      fireEvent.click(chipFor('주간 회의'));
      await waitFor(() => expect(evDetail()).toBeTruthy());

      // 기본 칸(지정 없음) + 앱 팔레트 아홉 색.
      const swatches = evDetail().querySelectorAll('[data-event-color]');
      expect(swatches).toHaveLength(10);
      expect(evDetail().querySelector('[data-event-color="기본"]')).toBeTruthy();
      // 저장은 완료에서 한 번 — 고르기만으로는 아무것도 쓰지 않는다.
      fireEvent.click(evDetail().querySelector('[data-event-color="#3f8fd0"]')!);
      expect(events()[0]!.color).toBeUndefined();
      fireEvent.click(document.querySelector('[data-event-done]')!);
      await waitFor(() => expect(events()[0]!.color).toBe('#3f8fd0'));

      // 다시 열어 '기본'을 고르면 **지정이 지워진다**(키를 실어 보낸다).
      fireEvent.click(chipFor('주간 회의'));
      await waitFor(() => expect(evDetail()).toBeTruthy());
      fireEvent.click(evDetail().querySelector('[data-event-color="기본"]')!);
      fireEvent.click(document.querySelector('[data-event-done]')!);
      await waitFor(() => expect(events()[0]!.color).toBeUndefined());
    });

    // 요청 — 구글 캘린더와 같은 편집(굵게·기울임·밑줄·번호·글머리·링크·서식 제거).
    // 저장은 HTML이라 두 원천이 같은 문자열을 담는다(`richMemo.ts` 머리말).
    it('메모는 서식 편집기다 — 도구 모음이 명령을 걸고 값은 HTML로 저장된다', async () => {
      const exec = vi.fn(() => true);
      (document as Document & { execCommand?: unknown }).execCommand = exec;
      renderHome([META('d1', '스프린트 보드')], BODIES());
      localStorage.setItem('mf_events', JSON.stringify([{ id: 'e1', title: '주간 회의', startDate: todayISO(), endDate: todayISO(), allDay: true, source: 'geurio', note: '<b>준비물</b><br>노트북' }]));
      await openCalendar();
      await waitFor(() => expect(chipTexts()).toContain('주간 회의'));
      fireEvent.click(chipFor('주간 회의'));
      await waitFor(() => expect(evDetail()).toBeTruthy());

      // 저장된 HTML이 그대로 편집기에 들어온다(평문이었다면 줄바꿈만 옮긴다).
      const note = document.querySelector('[data-event-note]') as HTMLElement;
      expect(note.innerHTML).toBe('<b>준비물</b><br>노트북');

      // 도구 모음 — 구글 캘린더의 그 일곱 + 형광펜·체크리스트(폰의 막대 N8과 같은 명령 — 폰에서 칠한 것을 여기서도 걷는다).
      const cmds = [...document.querySelectorAll('[data-memo-cmd]')].map((b) => b.getAttribute('data-memo-cmd'));
      expect(cmds).toEqual(['bold', 'italic', 'underline', 'mark', 'ol', 'ul', 'check', 'link', 'clear']);
      fireEvent.click(document.querySelector('[data-memo-cmd="ol"]')!);
      expect(exec).toHaveBeenCalledWith('insertOrderedList', false, undefined);

      // 편집한 값은 **위생 처리를 지나** 저장된다.
      note.innerHTML = '<b>준비물</b><script>alert(1)</script>';
      fireEvent.input(note);
      fireEvent.click(document.querySelector('[data-event-done]')!);
      await waitFor(() => expect(events()[0]!.note).toBe('<b>준비물</b>alert(1)'));
    });

    it('상세 팝업은 새 일정 팝업과 같은 얼굴이다 — 저장할 캘린더는 소속만 켜진다(제보 #10·#11)', async () => {
      renderHome([META('d1', '스프린트 보드')], BODIES());
      localStorage.setItem('mf_events', JSON.stringify([{ id: 'e1', title: '주간 회의', startDate: todayISO(), endDate: todayISO(), allDay: true, source: 'geurio' }]));
      await openCalendar();
      await waitFor(() => expect(chipTexts()).toContain('주간 회의'));

      // 우리 칩은 **칸 폭 전체의 상자**다(스펙 3.5) — 면·테두리·왼쪽 색 바가 누르는 자리를
      // 보여 준다. (예전에 글자 폭으로 좁힌 이유는 면이 없는 칩의 빈 옆자리를 눌러도
      // 팝업이 열려서였다(제보 #1) — 면 없는 구글 시간 일정은 그대로 글자 폭이다.)
      const chip = chipFor('주간 회의');
      expect(chip.style.alignSelf).toBe('stretch');
      expect(chip.style.borderLeft).toMatch(/^3px solid/);
      expect(chip.style.borderRadius).toBe('6px');
      // 색을 고르지 않은 Geurio 일정은 **종류 색**(Geurio 캘린더 보라)이다.
      expect(chip.style.borderLeftColor).toBe('rgb(139, 92, 246)');

      fireEvent.click(chip);
      await waitFor(() => expect(evDetail()).toBeTruthy());
      // 제목은 새 일정과 같은 한 줄 입력이고, 발치에 취소가 있다(#10 파리티).
      const title = document.querySelector('[data-event-title]') as HTMLInputElement;
      expect(title.tagName).toBe('INPUT');
      expect(title.value).toBe('주간 회의');
      expect(document.querySelector('[data-event-cancel]')).toBeTruthy();
      // 메모는 새 일정 팝업과 같은 **서식 편집기**다(요청) — 같은 최소 높이.
      const note = document.querySelector('[data-event-note]') as HTMLElement;
      expect(note.getAttribute('contenteditable')).toBe('true');
      expect(note.style.minHeight).toBe('110px');
      // 저장할 캘린더(#11) — Geurio 일정이니 Geurio 칩이 켜진다(구글 미연결이라 칩 하나뿐).
      expect(evDetail().textContent).toContain('저장할 캘린더');
      expect(document.querySelector('[data-event-cal="geurio"]')?.getAttribute('aria-disabled')).toBe('false');
    });

    it('✕로 닫으면 초안이 버려진다 — 적던 위치가 저장되지 않는다', async () => {
      renderHome([META('d1', '스프린트 보드')], BODIES());
      localStorage.setItem('mf_events', JSON.stringify([{ id: 'e1', title: '주간 회의', startDate: todayISO(), endDate: todayISO(), allDay: true, source: 'geurio' }]));
      await openCalendar();
      await waitFor(() => expect(chipTexts()).toContain('주간 회의'));
      fireEvent.click(chipFor('주간 회의'));
      await waitFor(() => expect(evDetail()).toBeTruthy());
      fireEvent.change(document.querySelector('[data-event-loc]')!, { target: { value: '버려질 입력' } });
      fireEvent.click(within(evDetail()).getByLabelText('닫기'));
      await waitFor(() => expect(document.querySelector('[data-event-detail]')).toBeNull());
      expect(events()[0]!.location).toBeUndefined();
    });

    it('반복 일정 삭제는 범위를 묻는다 — 이 일정만(EXDATE) / 이후(UNTIL) / 모든 일정', async () => {
      renderHome([META('d1', '스프린트 보드')], BODIES());
      // 날짜를 달 안쪽에 고정한다 — 오늘 기준 +1/+2는 월말에 6주 격자 밖으로 나갈
      // 수 있다(오늘이 9/1이라 통과하다 월말에 깨지는 종류의 함정).
      const now = new Date();
      const dayN = (n: number): string => isoOf(now.getFullYear(), now.getMonth() + 1, n);
      const from = dayN(1);
      localStorage.setItem('mf_events', JSON.stringify([{ id: 'e1', title: '데일리', startDate: from, endDate: from, allDay: true, recurrence: 'RRULE:FREQ=DAILY', source: 'geurio' }]));
      await openCalendar();
      await waitFor(() => expect(chipTexts()).toContain('데일리'));
      // 2일 회차를 눌렀다 — 삭제 범위의 기준은 눌린 회차다.
      const tomorrow = dayN(2);
      const chips = [...document.querySelectorAll('[data-cal-chip]')] as HTMLElement[];
      const chip = chips.find((c) => c.textContent!.includes('데일리') && c.closest('[data-day-cell]')?.getAttribute('data-day-cell') === tomorrow)!;
      fireEvent.click(chip);
      await waitFor(() => expect(evDetail()).toBeTruthy());

      // 삭제 → 곧바로 지우지 않고 범위를 묻는다. 초점은 취소에 — 파괴적 갈래가
      // 기본 초점이면 Enter 한 번에 지워진다(열 삭제 확인창의 규칙).
      fireEvent.click(document.querySelector('[data-event-delete]')!);
      await waitFor(() => expect(document.querySelector('[data-event-scope]')).toBeTruthy());
      await waitFor(() => expect(document.activeElement?.hasAttribute('data-event-scope-cancel')).toBe(true));
      expect(events()).toHaveLength(1);

      // 취소는 아무것도 바꾸지 않는다.
      fireEvent.click(document.querySelector('[data-event-scope-cancel]')!);
      await waitFor(() => expect(document.querySelector('[data-event-scope]')).toBeNull());
      expect(events()[0]!.recurrence).toBe('RRULE:FREQ=DAILY');

      // "이 일정만" — 그 회차가 EXDATE로 빠지고 달력에서 사라진다(다른 회차는 남는다).
      fireEvent.click(document.querySelector('[data-event-delete]')!);
      await waitFor(() => expect(document.querySelector('[data-event-scope]')).toBeTruthy());
      fireEvent.click(document.querySelector('[data-event-scope-one]')!);
      await waitFor(() => expect(events()[0]!.recurrence).toBe(`RRULE:FREQ=DAILY\nEXDATE:${tomorrow.replaceAll('-', '')}`));
      await waitFor(() => expect(document.querySelector('[data-event-detail]')).toBeNull());
      await waitFor(() => {
        const cell = document.querySelector(`[data-day-cell="${tomorrow}"]`)!;
        expect(cell.textContent).not.toContain('데일리');
      });
      // 1일 회차는 그대로다.
      expect(document.querySelector(`[data-day-cell="${from}"]`)!.textContent).toContain('데일리');

      // "이 일정과 이후 일정" — 3일 회차부터 규칙이 끝난다(UNTIL = 전날).
      const dayAfter = dayN(3);
      const chips2 = [...document.querySelectorAll('[data-cal-chip]')] as HTMLElement[];
      fireEvent.click(chips2.find((c) => c.textContent!.includes('데일리') && c.closest('[data-day-cell]')?.getAttribute('data-day-cell') === dayAfter)!);
      await waitFor(() => expect(evDetail()).toBeTruthy());
      fireEvent.click(document.querySelector('[data-event-delete]')!);
      await waitFor(() => expect(document.querySelector('[data-event-scope]')).toBeTruthy());
      fireEvent.click(document.querySelector('[data-event-scope-following]')!);
      await waitFor(() => expect(events()[0]!.recurrence).toBe(`RRULE:FREQ=DAILY;UNTIL=${tomorrow.replaceAll('-', '')}\nEXDATE:${tomorrow.replaceAll('-', '')}`));

      // "모든 일정" — 행이 통째로 사라진다.
      fireEvent.click(chipFor('데일리'));
      await waitFor(() => expect(evDetail()).toBeTruthy());
      fireEvent.click(document.querySelector('[data-event-delete]')!);
      await waitFor(() => expect(document.querySelector('[data-event-scope]')).toBeTruthy());
      fireEvent.click(document.querySelector('[data-event-scope-all]')!);
      await waitFor(() => expect(events()).toEqual([]));
    });

    it('삭제는 한 번 묻고(요청), 확인하면 표에서 사라지고 팝업이 닫힌다', async () => {
      renderHome([META('d1', '스프린트 보드')], BODIES());
      localStorage.setItem('mf_events', JSON.stringify([{ id: 'e1', title: '지울 일정', startDate: todayISO(), endDate: todayISO(), allDay: true, source: 'geurio' }]));
      await openCalendar();
      await waitFor(() => expect(chipTexts()).toContain('지울 일정'));
      fireEvent.click(chipFor('지울 일정'));
      await waitFor(() => expect(evDetail()).toBeTruthy());

      // 삭제 버튼은 **묻기만** 한다 — 되돌릴 수 없는 일이라 한 번 눌린 것으로는 실행하지 않는다.
      fireEvent.click(document.querySelector('[data-event-delete]')!);
      const confirm = await waitFor(() => {
        const el = document.querySelector('[data-delete-confirm]');
        expect(el).toBeTruthy();
        return el as HTMLElement;
      });
      expect(confirm.textContent).toContain("'지울 일정' 일정이 사라져요.");
      expect(confirm.textContent).toContain('되돌릴 수 없어요');
      expect(events()).toHaveLength(1);

      // 취소하면 아무 일도 없다.
      fireEvent.click(document.querySelector('[data-confirm-cancel]')!);
      await waitFor(() => expect(document.querySelector('[data-delete-confirm]')).toBeNull());
      expect(events()).toHaveLength(1);
      expect(evDetail()).toBeTruthy();

      // 확인하면 지워지고 상세째 닫힌다.
      fireEvent.click(document.querySelector('[data-event-delete]')!);
      await waitFor(() => expect(document.querySelector('[data-delete-confirm]')).toBeTruthy());
      fireEvent.click(document.querySelector('[data-confirm-delete]')!);
      await waitFor(() => expect(document.querySelector('[data-event-detail]')).toBeNull());
      expect(events()).toEqual([]);
      await waitFor(() => expect(chipTexts()).not.toContain('지울 일정'));
    });

    it('날짜별 보기의 시간표에 시각 일정을 놓고, 겹치면 열을 나눈다', async () => {
      renderHome([META('d1', '스프린트 보드')], BODIES());
      const t = todayISO();
      localStorage.setItem(
        'mf_events',
        JSON.stringify([
          { id: 'e1', title: '아침 회의', startDate: t, endDate: t, allDay: false, startTime: '09:00', endTime: '11:00', source: 'geurio' },
          { id: 'e2', title: '겹친 회의', startDate: t, endDate: t, allDay: false, startTime: '10:00', endTime: '12:00', source: 'geurio' },
        ]),
      );
      await openCalendar();
      await waitFor(() => expect(document.querySelector('[data-cal-timeline]')).toBeTruthy());
      const blocks = [...document.querySelectorAll('[data-cal-block]')] as HTMLElement[];
      expect(blocks.map((b) => b.getAttribute('data-cal-block'))).toEqual(['e1', 'e2']);
      // 09:00 = 9 * 36px, 두 시간 = 72 - 2
      expect(blocks[0]!.style.top).toBe(`${9 * 36}px`);
      expect(blocks[0]!.style.height).toBe('70px');
      // 겹치므로 두 열로 갈라 나란히(jsdom이 calc를 정규화하므로 계수로 본다)
      expect(blocks[0]!.style.width).toContain('0.5');
      expect(blocks[1]!.style.left).toContain('0.5');
      expect(blocks[0]!.style.left).not.toBe(blocks[1]!.style.left);
      // 오늘이면 현재 시각 선도 그린다
      expect(document.querySelector('[data-cal-now]')).toBeTruthy();
      // 종일 항목(칸반 마감)은 시간표가 아니라 위의 납작한 행으로 남는다
      expect([...document.querySelectorAll('[data-cal-day-chip]')].map((c) => c.textContent)).not.toContain('아침 회의');
    });

    it('시각 일정이 없어도 시간표는 하루를 다 보여 준다 — 12AM에서 12AM까지(제보 #19·#20)', async () => {
      renderHome([META('d1', '스프린트 보드')], BODIES());
      await openCalendar();
      // 예전에는 시간 일정이 없으면 표가 통째로 사라지고 안내만 떴다(제보).
      await waitFor(() => expect(document.querySelector('[data-cal-timeline]')).toBeTruthy());
      expect(document.querySelectorAll('[data-cal-hour]').length).toBe(24);
      // 11PM 아래가 선 없이 비어 있던 것을 자정으로 닫는다.
      expect(document.querySelector('[data-cal-hour-end]')?.textContent).toBe('12AM');

      // 빈 시간대를 누르면 **그 시각으로** 새 일정이 열린다(사라진 버튼의 자리).
      fireEvent.click(document.querySelector('[data-cal-hour="14"]')!);
      await waitFor(() => expect(newEv()).toBeTruthy());
      expect(document.querySelector<HTMLElement>('[data-new-start]')?.textContent).toContain('오후 2:00');
      fireEvent.click(document.querySelector('[data-new-cancel]')!);
      await waitFor(() => expect(newEv()).toBeNull());

      // 고른 날짜가 곧 기본값 — 며칠 뒤 칸을 고르고 만들면 그 날에 놓인다.
      const target = shiftInMonth(2);
      fireEvent.click(document.querySelector(`[data-mini-day="${target}"]`)!);
      await waitFor(() => expect(document.querySelector('[data-cal-day-new]')).toBeTruthy());
      fireEvent.click(document.querySelector('[data-cal-day-new]')!);
      await waitFor(() => expect(newEv()).toBeTruthy());
      fireEvent.change(document.querySelector('[data-new-title]')!, { target: { value: '이틀 뒤 일정' } });
      fireEvent.click(document.querySelector('[data-new-submit]')!);
      await waitFor(() => expect(events()).toHaveLength(1));
      expect(events()[0]!.startDate).toBe(target);
    });

    it('여러 날 일정은 칩이 아니라 기간 바로 그려지고, 상세가 남은 날을 말한다', async () => {
      renderHome([META('d1', '스프린트 보드')], BODIES());
      localStorage.setItem('mf_events', JSON.stringify([{ id: 'e1', title: '휴가', startDate: todayISO(), endDate: shiftDays(2), allDay: true, source: 'geurio' }]));
      await openCalendar();
      await waitFor(() => expect(barFor('휴가')).toBeTruthy());
      fireEvent.click(barFor('휴가'));
      await waitFor(() => expect(evDetail()).toBeTruthy());
      expect(document.querySelector('[data-event-when]')!.textContent).toBe('3일간');
      // 예전의 `3일간 · 1일 남음` 한 줄은 **진행 바**가 대신한다(제보 ⑦ — 날짜 아래).
      expect(document.querySelector('[data-cal-span]')!.textContent).toContain('3일 중 1일째');
      expect(document.querySelector('[data-cal-span]')!.textContent).toContain('2일 남음');
    });
  });


  it('날짜 칸을 더블클릭하면 그 날의 일정 팝업이 뜨고, 행을 고르면 상세로 이어진다(제보 — 디자인 원본 dayList)', async () => {
    renderHome([META('d1', '스프린트 보드'), META('d2', '이슈 트리아지')], BODIES());
    await openCalendar();
    await waitFor(() => expect(chipTexts()).toContain('오늘 마감 카드'));
    const cell = document.querySelector(`[data-day-cell="${todayISO()}"]`) as HTMLElement;
    // 더블클릭의 뜻을 hover 툴팁이 미리 말한다(디자인 원본 `dayTitle`)
    expect(cell.getAttribute('title')).toContain('더블 클릭하면 일정을 모두 봐요');
    fireEvent.doubleClick(cell);
    const pop = await waitFor(() => {
      const el = document.querySelector('[data-day-list]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    // **툴팁 리스트**다(요청 — 첨부 시안): 막(dim) 없이 누른 칸 곁에 fixed로 선다.
    expect(pop.style.position).toBe('fixed');
    expect(document.querySelector('[data-modal-overlay]')).toBeNull();
    // 머리 = 날짜 + `일정 N개`, 행 = 그 날을 덮는 항목 **전부**(칸에서 바로만 그리던
    // 기간 카드도 여기서는 한 행이다 — `8.24–8.30 · N일째` 꼴의 부제와 함께)
    expect(pop.querySelector('[data-day-list-sub]')!.textContent).toMatch(/일정 \d+개/);
    // 행의 오른쪽에는 **상태 점**이 선다(태그 알약이 아니라 — 시안).
    expect(pop.querySelector('[data-day-list-item]')).toBeTruthy();
    expect(within(pop).getByText('오늘 마감 카드')).toBeTruthy();
    expect(within(pop).getByText('기간 카드')).toBeTruthy();
    expect(pop.textContent).toContain('일째');
    // 행을 고르면 팝업이 닫히고 그 항목의 상세가 뜬다
    fireEvent.click(within(pop).getByText('오늘 마감 카드'));
    await waitFor(() => expect(document.querySelector('[data-day-list]')).toBeNull());
    await waitFor(() => expect(document.querySelector('[data-cal-detail]')).toBeTruthy());
  });

  it('우클릭 메뉴의 앵커는 **body 밑**이다 — 본문 안이면 좌표가 밀린다(제보 ③)', async () => {
    // `.mf-home-main`은 첫 등장 애니메이션이 `fill: both`라 끝난 뒤에도 항등
    // transform이 남는다 → 그 안의 `position: fixed`는 본문 기준으로 자리를 잡아
    // 메뉴가 LNB 폭만큼 오른쪽으로 밀렸다(실측). 자리표시자는 뷰포트에 붙어야 한다.
    renderHome([META('d1', '스프린트 보드')], BODIES());
    await openCalendar();
    fireEvent.contextMenu(document.querySelector(`[data-day-cell="${shiftInMonth(3)}"]`)!, { clientX: 420, clientY: 300 });
    await waitFor(() => expect(document.querySelector('[data-home-ctx="cal-day"]')).toBeTruthy());
    const anchorEl = [...document.querySelectorAll<HTMLElement>('[aria-hidden="true"][tabindex="-1"]')].find((el) => el.style.position === 'fixed');
    expect(anchorEl).toBeTruthy();
    expect(anchorEl!.style.left).toBe('420px');
    expect(anchorEl!.style.top).toBe('300px');
    // 본문(`.mf-home-main`) 안이 아니라 body 직속이어야 한다.
    expect(anchorEl!.closest('.mf-home-main')).toBeNull();
    expect(anchorEl!.parentElement).toBe(document.body);
  });

  it('기간 바는 그 칸이 며칠째인지 오른쪽 끝에 적는다(요청 ⑤)', async () => {
    const iso = (n: number) => addDays(SPAN.start, n);
    renderHome([META('d1', '스프린트 보드')], {
      d1: kanbanBody([{ id: 's1', col: 'c2', pos: 1, text: '출장', due: iso(4), start: SPAN.start }]),
    });
    await openCalendar();
    await waitFor(() => expect(barFor('출장')).toBeTruthy());
    // 시작 칸은 1/5일째, 사흘째 칸은 3/5일째 — 제목이 없는 이어지는 칸에서도 적는다.
    const progOf = (day: string) =>
      (document.querySelector(`[data-day-cell="${day}"] [data-cal-bar] [data-cal-bar-progress]`) as HTMLElement | null)?.textContent;
    expect(progOf(SPAN.start)).toBe('1/5일째');
    expect(progOf(iso(2))).toBe('3/5일째');
    // 하루짜리 칩에는 붙지 않는다(진행이라 할 것이 없다).
    expect(document.querySelector('[data-cal-chip] [data-cal-bar-progress]')).toBeNull();
  });

  it('일별 팝업의 왼쪽 색 바 = 칸의 칩과 같은 색, 상태 점은 칸반 카드만(제보 ②)', async () => {
    // 예전에는 바가 출처 hue 넷 중 하나라 칸에서 분류색으로 본 일정이 팝업에서
    // 초록 바로 바뀌었다 — 같은 일정으로 읽히지 않는다는 제보.
    renderHome([META('d1', '스프린트 보드')], {
      d1: kanbanBody([
        { id: 'k1', col: 'c1', pos: 1, text: '분류 있는 카드', due: todayISO(), tag: '기획' },
      ]),
    });
    localStorage.setItem('mf_events', JSON.stringify([{ id: 'e1', title: '내 일정', startDate: todayISO(), endDate: todayISO(), allDay: true, source: 'geurio' }]));
    await openCalendar();
    const chip = await waitFor(() => {
      const el = [...document.querySelectorAll<HTMLElement>('[data-cal-chip]')].find((c) => c.textContent?.includes('분류 있는 카드'));
      expect(el).toBeTruthy();
      return el!;
    });
    // 칸의 칩이 쓰는 정체성 색 — 채운 칩의 면이 이 색에서 나온다.
    const cellFill = chip.style.background;
    fireEvent.doubleClick(document.querySelector(`[data-day-cell="${todayISO()}"]`)!);
    const pop = await waitFor(() => {
      const el = document.querySelector('[data-day-list]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    const rows = [...pop.querySelectorAll<HTMLElement>('[data-day-list-item]')];
    const kanbanRow = rows.find((r) => r.textContent?.includes('분류 있는 카드'))!;
    const eventRow = rows.find((r) => r.textContent?.includes('내 일정'))!;
    // 바 색은 그 카드의 **분류색 그대로**다 — 옛 출처 hue(초록 `#69B08A`)가 아니고,
    // 칸의 칩 면(그 색을 카드 면에 섞은 값)도 이 색에서 나온다.
    const bar = kanbanRow.firstElementChild as HTMLElement;
    // jsdom은 인라인 hex를 `rgb(...)`로 정규화한다 — 같은 자리에 심어 비교한다.
    const asRgb = (hex: string): string => {
      const probe = document.createElement('span');
      probe.style.background = hex;
      return probe.style.background;
    };
    const want = tagColor('기획', UI_THEME.palette);
    expect(bar.style.background).toBe(asRgb(want));
    expect(bar.style.background).not.toBe('#69B08A');
    // 칩 면은 같은 색을 카드 면에 섞은 값이라 바보다 옅다(같은 색은 아니다).
    expect(cellFill).not.toBe(asRgb(want));
    expect(cellFill).toBeTruthy();
    // 상태 점은 **칸반 카드에만** — 열이 없는 Geurio 일정에는 아무 뜻이 없었다.
    expect(kanbanRow.querySelector('[data-day-list-state]')).toBeTruthy();
    expect(kanbanRow.querySelector('[data-day-list-state]')!.getAttribute('title')).toContain('상태 · ');
    expect(eventRow.querySelector('[data-day-list-state]')).toBeNull();
  });

  it('일별 팝업: 빈 날은 안내가 뜨고, 발치 `이 날에 새 일정`이 그 날짜로 새 일정을 연다', async () => {
    renderHome([META('d1', '스프린트 보드'), META('d2', '이슈 트리아지')], BODIES());
    await openCalendar();
    // 확실히 빈 날 — 오늘·기간에서 멀리 떨어진 이 달 안의 날을 하나 찾는다.
    const empty = (() => {
      for (const cand of [10, 20, 6, 24].map((n) => {
        const now = new Date();
        return isoOf(now.getFullYear(), now.getMonth() + 1, n);
      })) {
        const cell = document.querySelector(`[data-day-cell="${cand}"]`);
        if (cell && !cell.querySelector('[data-cal-chip],[data-cal-bar]')) return cand;
      }
      throw new Error('빈 칸을 찾지 못했다');
    })();
    fireEvent.doubleClick(document.querySelector(`[data-day-cell="${empty}"]`)!);
    const pop = await waitFor(() => {
      const el = document.querySelector('[data-day-list]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    expect(within(pop).getByText('이 날에는 일정이 없어요')).toBeTruthy();
    fireEvent.click(pop.querySelector('[data-day-list-new]')!);
    await waitFor(() => expect(document.querySelector('[data-day-list]')).toBeNull());
    const dialog = await screen.findByRole('dialog', { name: '새 일정' });
    // 누른 날이 곧 기본 날짜다
    const want = `${Number(empty.slice(5, 7))}월 ${Number(empty.slice(8, 10))}일`;
    expect([...dialog.querySelectorAll('button')].some((b) => b.textContent?.includes(want))).toBe(true);
  });

  it('`+N개 더`도 같은 팝업이다 — 접힌 항목까지 전부 나열한다', async () => {
    const bodies = {
      d1: kanbanBody([
        { id: 'm1', col: 'c1', pos: 1, text: '겹친 카드 하나', due: todayISO() },
        { id: 'm2', col: 'c1', pos: 2, text: '겹친 카드 둘', due: todayISO() },
        { id: 'm3', col: 'c1', pos: 3, text: '겹친 카드 셋', due: todayISO() },
        { id: 'm4', col: 'c1', pos: 4, text: '겹친 카드 넷', due: todayISO() },
      ]),
    };
    // 칸에 몇 줄이 들어가는지는 **실측**이 정한다(제보 #1) — jsdom에는 레이아웃이
    // 없으므로 낮은 칸(한 줄만 들어가는 높이)을 흉내 내 접히는 경로를 만든다.
    const shrinkCells = (px: number): void => {
      const grid = document.querySelector('[data-month-grid]')!.querySelector('[data-day-cell]')!.parentElement as HTMLElement;
      Object.defineProperty(grid, 'clientHeight', { configurable: true, value: px });
      for (const cb of roCallbacks) cb();
    };
    renderHome([META('d1', '스프린트 보드')], bodies);
    await openCalendar();
    await waitFor(() => expect(document.querySelector('[data-cal-chip]')).toBeTruthy());
    // 넓은 칸에서는 넷 다 그대로 보인다 — 여유가 있는데 접지 않는다.
    expect(chipTexts()).toHaveLength(4);
    expect(document.querySelector('[data-cal-more]')).toBeNull();

    act(() => shrinkCells(6 * 46));
    const more = await waitFor(() => {
      const el = document.querySelector('[data-cal-more]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    fireEvent.click(more);
    const pop = await waitFor(() => {
      const el = document.querySelector('[data-day-list]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    for (const t of ['겹친 카드 하나', '겹친 카드 둘', '겹친 카드 셋', '겹친 카드 넷']) expect(within(pop).getByText(t)).toBeTruthy();
  });

  it('칩·바 위에서 온 더블클릭은 일별 팝업이 아니다 — 그 항목의 일이다', async () => {
    renderHome([META('d1', '스프린트 보드'), META('d2', '이슈 트리아지')], BODIES());
    await openCalendar();
    const chip = await waitFor(() => {
      const el = document.querySelector('[data-cal-chip]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    fireEvent.doubleClick(chip);
    expect(document.querySelector('[data-day-list]')).toBeNull();
  });

  // 우리 일정·카드는 종일이든 시간 일정이든 **스펙 3.5의 상자**다(종류의 옅은 면 + 왼쪽 색
  // 바) — 시간 일정은 그 안에서 시작 시각을 제목 앞에 세운다. 면 없는 글자 칩은 구글 시간
  // 일정만의 규칙으로 남는다(스펙 3.7 — `GoogleCalendar.test.tsx`).
  it('우리 칩은 종일·시간 모두 상자, 시간 일정은 시작 시각을 제목 앞에 세운다(스펙 3.5)', async () => {
    localStorage.setItem(
      'mf_events',
      JSON.stringify([{ id: 'e1', title: '회의', startDate: todayISO(), endDate: todayISO(), allDay: false, startTime: '09:00', endTime: '10:00', source: 'geurio' }]),
    );
    renderHome([META('d1', '스프린트 보드'), META('d2', '이슈 트리아지')], BODIES());
    await openCalendar();
    await waitFor(() => expect(chipTexts()).toContain('오늘 마감 카드'));
    // 칸반 마감은 종일이다 — 종류의 옅은 면을 채운다. 분류가 없는 카드는 **칸반 초록**.
    const card = chipFor('오늘 마감 카드');
    expect(card.style.background).not.toBe('transparent');
    expect(card.style.borderLeftColor).toBe('rgb(78, 140, 103)');
    // 점은 5px **둥근 사각**(스페이스 카드 태그와 같은 언어) — 칸반이면 열(상태) 색.
    const dot = card.querySelector('[data-cal-chip-dot]') as HTMLElement;
    expect(dot.style.borderRadius).toBe('1.5px');
    // 시각이 있는 일정도 상자이고, 시각을 제목 앞에 세운다.
    await waitFor(() => expect(chipTexts()).toContain('회의'));
    const timed = chipFor('회의');
    expect(timed.style.background).not.toBe('transparent');
    expect(timed.querySelector('[data-cal-chip-time]')?.textContent).toBe('오전 9시');
    // 기간 바는 이어진 띠로 읽혀야 하므로 면을 유지한다
    const bar = document.querySelector('[data-cal-bar]') as HTMLElement;
    expect(bar.style.background).not.toBe('transparent');
    expect(bar.style.background).not.toBe('');
  });

  it('일정 화면의 우클릭은 스페이스 메뉴를 열지 않는다(제보) — 기본 메뉴만 막는다', async () => {
    renderHome([META('d1', '스프린트 보드'), META('d2', '이슈 트리아지')], BODIES());
    await openCalendar();
    const view = document.querySelector('[data-calendar-view]') as HTMLElement;
    const notPrevented = fireEvent.contextMenu(view);
    expect(notPrevented).toBe(false); // 브라우저 기본 메뉴는 막는다(본문의 우클릭 규칙 유지)
    // 스페이스의 빈 자리 메뉴(새로 만들기·새 폴더·가져오기)는 뜨지 않는다 — 그 항목들은
    // 지금 보이지 않는 스페이스에 폴더를 만든다.
    expect(document.querySelector('.mf-home-ctx')).toBeNull();
  });
});

describe('일정 화면 후속(제보 6건)', () => {
  beforeEach(() => {
    mockMatchMedia(false);
    seedSpaces();
  });

  it('LNB 활성 표시는 지금 보고 있는 화면 하나에만 — 일정을 열면 스페이스 행이 꺼진다', async () => {
    renderHome([META('d1', '스프린트 보드'), META('d2', '이슈 트리아지')], BODIES());
    const spaceRow = () => [...document.querySelectorAll('aside [role="button"], aside button')].find((e) => e.textContent?.trim().startsWith('업무')) as HTMLElement;
    await waitFor(() => expect(spaceRow()).toBeTruthy());
    // 스페이스 화면일 때는 켜져 있다
    fireEvent.click(spaceRow());
    await waitFor(() => expect(spaceRow().style.background).toBe('var(--mf-accent-soft)'));
    await openCalendar();
    // 일정 화면에서는 어느 스페이스도 켜지지 않는다(제보: 이전 스페이스에 포커스가 남는다)
    expect(spaceRow().style.background).toBe('transparent');
    expect(document.querySelector('[data-cal-nav]')!.getAttribute('aria-current')).toBe('page');
  });

  it('상세 팝업: 제목은 늘릴 수 없고, 상태·완료 버튼이 손을 얹으면 반응한다', async () => {
    renderHome([META('d1', '스프린트 보드'), META('d2', '이슈 트리아지')], BODIES());
    await openCalendar();
    await waitFor(() => expect(chipTexts()).toContain('오늘 마감 카드'));
    fireEvent.click(chipFor('오늘 마감 카드'));
    await waitFor(() => expect(detail()).toBeTruthy());
    // ③ 손잡이로 늘리지 않는다 — 고정 높이 두 열이라 아래 필드가 밀린다
    expect((document.querySelector('[data-cal-detail-title]') as HTMLElement).style.resize).toBe('none');
    // ② 상태 알약은 hover 규칙이 닿는 클래스를 단다(고른 칸은 `aria-checked`라 틴트를 지킨다)
    const on = document.querySelector('[data-cal-state-item="c2"]') as HTMLElement;
    expect(on.className).toContain('mf-ctl');
    expect(on.getAttribute('aria-checked')).toBe('true');
    // ② `완료`는 그라디언트라 `mf-ctl`이면 hover에서 면이 갈린다 — 밝기만 움직이는 쪽
    const done = document.querySelector('[data-cal-detail-done]') as HTMLElement;
    expect(done.className).toBe('mf-ctl-primary');
    expect(done.style.background).toContain('linear-gradient');
  });

  it('날짜 숫자는 10.5px(스펙 3.4)이고 격자선·이웃 달 칸은 전용 토큰을 쓴다(요청)', async () => {
    renderHome([META('d1', '스프린트 보드'), META('d2', '이슈 트리아지')], BODIES());
    await openCalendar();
    const cell = document.querySelector('[data-day-cell]') as HTMLElement;
    // 격자선은 일반 경계선보다 한 단계 또렷한 전용 토큰(기본 테마는 #d6c3b5)
    expect(cell.style.borderRight).toBe('1px solid var(--mf-cal-grid)');
    expect(cell.style.borderBottom).toBe('1px solid var(--mf-cal-grid)');
    // 이웃 달 칸은 전용 토큰(디자인 원본 #F5EFE7)
    const out = document.querySelector('[data-day-cell][data-out-month="1"]') as HTMLElement;
    expect(out.style.background).toBe('var(--mf-cal-out)');
    const num = cell.querySelector('[data-day-num]') as HTMLElement;
    expect(num.style.fontSize).toBe('10.5px');
    expect(num.style.fontFamily).toContain('JetBrains Mono');
  });

  it('댓글은 읽어 오는 동안 스켈레톤을 보여 준다(제보: 빈 화면이었다)', async () => {
    const { commentStore } = renderHome([META('d1', '스프린트 보드'), META('d2', '이슈 트리아지')], BODIES());
    let release: (() => void) | null = null;
    const slow = new Promise<void>((r) => {
      release = r;
    });
    const orig = commentStore.list.bind(commentStore);
    vi.spyOn(commentStore, 'list').mockImplementation(async (docId: string) => {
      await slow;
      return orig(docId);
    });
    await openCalendar();
    await waitFor(() => expect(chipTexts()).toContain('오늘 마감 카드'));
    fireEvent.click(chipFor('오늘 마감 카드'));
    await waitFor(() => expect(document.querySelector('[data-comment-skeleton]')).toBeTruthy());
    expect(document.body.textContent).not.toContain('불러오는 중');
    release!();
    await waitFor(() => expect(document.querySelector('[data-comment-skeleton]')).toBeNull());
  });

  it('달력 칩과 날짜별 항목의 글자를 키웠다(제보: 너무 작아 읽기 힘들다)', async () => {
    renderHome([META('d1', '스프린트 보드'), META('d2', '이슈 트리아지')], BODIES());
    await openCalendar();
    await waitFor(() => expect(chipTexts()).toContain('오늘 마감 카드'));
    const chip = chipFor('오늘 마감 카드');
    expect(parseFloat(chip.style.fontSize)).toBeGreaterThanOrEqual(11);
    expect(parseFloat(chip.style.height)).toBeGreaterThanOrEqual(20);
    const bar = document.querySelector('[data-cal-bar]') as HTMLElement;
    expect(parseFloat(bar.style.fontSize)).toBeGreaterThanOrEqual(11);
    // RNB(날짜별 보기)의 항목
    fireEvent.click(document.querySelector(`[data-mini-day="${todayISO()}"]`)!);
    await waitFor(() => expect(document.querySelector('[data-cal-day-chip]')).toBeTruthy());
    const row = document.querySelector('[data-cal-day-chip]') as HTMLElement;
    const title = row.querySelector('span') as HTMLElement;
    expect(parseFloat(title.style.fontSize)).toBeGreaterThanOrEqual(13);
  });
});

describe('팝업·팝오버 안의 버튼 hover(제보)', () => {
  // 모달·팝오버는 **포털로 body 밑에** 그려진다(Radix) — `.mf-home` 안이 아니라서
  // 홈의 hover 규칙이 닿지 않았고, 팝업 안 버튼에는 반응이 아예 없었다.
  // 그리고 **켜진 것**(`aria-pressed`)은 면을 갈아 끼우면 꺼진 것처럼 보인다
  // (제보: 고른 날짜가 주황이 아니다) — 밝기만 움직인다.
  it('home.css가 포털에도 hover를 걸고, 켜진 것은 자기 틴트를 지킨다', () => {
    const css = readFileSync(resolve('src/features/home/home.css'), 'utf8');
    expect(css).toContain("[data-modal-overlay] .mf-ctl:hover:not([aria-pressed='true'])");
    expect(css).toContain("[data-radix-popper-content-wrapper] .mf-ctl:hover:not([aria-pressed='true'])");
    // 면을 갈아 끼우는 규칙은 셋 다 `:not([aria-pressed='true'])`가 붙어 있다.
    for (const m of css.matchAll(/^(.*\.mf-ctl:hover.*)$/gm)) expect(m[1]).toContain("aria-pressed='true'");
    // 라디오 묶음은 `aria-checked`를 쓴다(상태 알약) — 둘 다 지켜져야 한다.
    expect(css).toContain("[data-modal-overlay] .mf-ctl[aria-checked='true']:hover");
    // 켜진 것에는 밝기만 — `background`를 다시 칠하지 않는다.
    const on = css.slice(css.indexOf(".mf-home .mf-ctl[aria-pressed='true']:hover"));
    expect(on.slice(0, on.indexOf('}'))).toContain('brightness(var(--mf-hover-bright))');
    // 그라디언트 1차 버튼(새 일정·새로 만들기)도 포털 안에서 밝기만 움직인다.
    expect(css).toContain('[data-modal-overlay] .mf-ctl-primary:hover');
  });

  // 제보(#7) — 종일·반복을 바꾸면 "가로 길이가 줄어들었다가 늘어난다": 내용이 커지는
  // 순간 스크롤바가 생겨 그만큼 글줄이 좁아졌다 다시 넓어진다. 자리를 늘 비워 두면
  // 그 흔들림이 없다(팝업 밖 목록은 내용이 그렇게 변하지 않아 그대로 둔다).
  it('팝업 안 스크롤러는 스크롤바 자리를 늘 비워 둔다', () => {
    const css = readFileSync(resolve('src/features/home/home.css'), 'utf8');
    const rule = css.slice(css.indexOf('[data-modal-overlay] .lnb-scroll'));
    expect(rule.slice(0, rule.indexOf('}'))).toContain('scrollbar-gutter: stable');
  });

  // 제보 — 종일을 끄면 "일정 제목" 박스가 짧아졌다 돌아온다: 세로 flex 스크롤 열
  // 안에서 내용이 넘치면 flex-shrink가 먼저 일해 고정 높이 입력까지 눌린다(실측
  // 52px → 23px). 스크롤러는 눌리는 게 아니라 스크롤해야 한다. jsdom엔 레이아웃이
  // 없어(모든 크기가 0) 눌림을 재현할 수 없으므로 규칙 자체를 고정한다.
  it('팝업 안 스크롤러의 자식은 줄어들지 않는다', () => {
    const css = readFileSync(resolve('src/features/home/home.css'), 'utf8');
    const rule = css.slice(css.indexOf('[data-modal-overlay] .lnb-scroll > *'));
    expect(rule.slice(0, rule.indexOf('}'))).toContain('flex-shrink: 0');
  });
});

describe('열어 둔 화면이 다른 기기의 변경을 잡는다', () => {
  /**
   * 구글 일정·Geurio 일정은 자기 훅이 다시 물었는데(#74) 칸반 마감만 낡아 있었다 —
   * 그 출처는 홈이 하이드레이션 때 받아 둔 썸네일 본문이라 다시 묻는 사람이 없었다.
   */
  it('일정 화면을 열어 둔 채 칸반이 바뀌면 탭으로 돌아올 때 반영된다', async () => {
    seedSpaces();
    const { docStore } = renderHome([META('d1', '스프린트 보드'), META('d2', '이슈 트리아지')], BODIES());
    await openCalendar();
    await waitFor(() => expect(chipTexts()).toContain('오늘 마감 카드'));

    // 다른 기기가 그 보드를 고쳤다 — 우리 탭은 아직 모른다.
    docStore.remoteEdit('d1', [{ id: 'k1', col: 'c2', pos: 1, text: '다른 기기에서 고친 카드', due: todayISO() }]);
    expect(chipTexts()).toContain('오늘 마감 카드');

    // 확인하러 탭으로 돌아온다(창 포커스 = 깨어남).
    fireEvent(window, new Event('focus'));
    await waitFor(() => expect(chipTexts()).toContain('다른 기기에서 고친 카드'));
    // 낡은 값이 남아 있으면 안 된다 — 갱신은 덮어쓰기다.
    expect(chipTexts()).not.toContain('오늘 마감 카드');
  });

  it('보지 않는 화면에서는 묻지 않는다 — 스페이스 그리드', async () => {
    // 문서 **내용**을 지켜보는 화면은 일정 하나뿐이다(카드 썸네일은 낡아도 뜻이
    // 흐려지지 않는다). 스페이스 그리드에서 탭으로 돌아와도 다시 묻지 않는다.
    seedSpaces();
    const { docStore } = renderHome([META('d1', '스프린트 보드'), META('d2', '이슈 트리아지')], BODIES());
    await waitFor(() => expect(docStore.listCalls).toBeGreaterThan(0)); // 하이드레이션
    expect(document.querySelector('[data-cal-canvas]')).toBeNull();
    const before = docStore.listCalls;
    fireEvent(window, new Event('focus'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(docStore.listCalls).toBe(before);
  });

});

describe('보드별 일정 반영(요청 — 보드 카드 메뉴)', () => {
  beforeEach(() => {
    mockMatchMedia(false);
    seedSpaces();
  });

  const cardEl = (title: string): HTMLElement => document.querySelector(`.map-card[data-title="${title}"]`) as HTMLElement;
  const savedHidden = (): unknown => JSON.parse(localStorage.getItem('mf_spaces') ?? '{}').calendarHidden;

  it('메뉴의 「일정에 반영하지 않기」로 **그 보드만** 달력에서 빠지고, 설정은 워크스페이스에 남는다', async () => {
    renderHome([META('d1', '스프린트 보드'), META('d2', '이슈 트리아지')], BODIES());
    await waitFor(() => expect(cardEl('스프린트 보드')).toBeTruthy());
    // 본문이 도착해야 칸반인 줄 안다(메뉴의 이 줄은 칸반에만 선다).
    await waitFor(() => expect(document.querySelector('[data-cal-summary]')!.textContent).not.toBe('예정된 일정이 없어요'));
    fireEvent.contextMenu(cardEl('스프린트 보드'));
    fireEvent.click(await screen.findByText('일정에 반영하지 않기'));
    await waitFor(() => expect(savedHidden()).toEqual(['d1']));

    await openCalendar();
    await waitFor(() => expect(chipTexts().length).toBeGreaterThan(0));
    if (!chipTexts().includes('다른 스페이스 카드')) {
      fireEvent.click(document.querySelector('[aria-label="다음 달"]')!);
      await waitFor(() => expect(chipTexts()).toContain('다른 스페이스 카드'));
    }
    // 뺀 보드(스프린트 보드)의 카드는 어디에도 없다 — 다른 보드는 그대로.
    expect(document.body.textContent).not.toContain('오늘 마감 카드');
    expect(document.body.textContent).not.toContain('지난 마감 카드');
  });

  it('저장된 설정으로 시작하면 그 보드가 빠져 있고, 메뉴로 다시 켜면 돌아온다(LNB 요약까지)', async () => {
    const raw = JSON.parse(localStorage.getItem('mf_spaces')!);
    localStorage.setItem('mf_spaces', JSON.stringify({ ...raw, calendarHidden: ['d1'] }));
    renderHome([META('d1', '스프린트 보드'), META('d2', '이슈 트리아지')], BODIES());
    await waitFor(() => expect(document.querySelector('[data-cal-nav]')).toBeTruthy());
    fireEvent.click(document.querySelector('[data-cal-nav]')!);
    await waitFor(() => expect(document.querySelector('[data-calendar-view]')).toBeTruthy());
    const other = async () => {
      await waitFor(() => expect(chipTexts().length).toBeGreaterThan(0));
      if (!chipTexts().includes('다른 스페이스 카드')) {
        fireEvent.click(document.querySelector('[aria-label="다음 달"]')!);
        await waitFor(() => expect(chipTexts()).toContain('다른 스페이스 카드'));
        fireEvent.click(document.querySelector('[aria-label="이전 달"]')!);
      }
    };
    await other();
    expect(document.body.textContent).not.toContain('오늘 마감 카드');
    // LNB 요약도 같은 목록이다 — 뺀 보드의 지난 마감을 세지 않는다.
    expect(document.querySelector('[data-cal-summary]')!.textContent).not.toContain('지난 마감');

    // 스페이스로 돌아가 다시 켠다.
    const spaceRow = [...document.querySelectorAll('aside [role="button"], aside button')].find((e) => e.textContent?.trim().startsWith('업무')) as HTMLElement;
    fireEvent.click(spaceRow);
    await waitFor(() => expect(cardEl('스프린트 보드')).toBeTruthy());
    fireEvent.contextMenu(cardEl('스프린트 보드'));
    fireEvent.click(await screen.findByText('일정에 반영하기'));
    await waitFor(() => expect(document.querySelector('[data-cal-summary]')!.textContent).toContain('지난 마감 1건'));
    // 비면 키를 싣지 않는다(예전 블롭과 같은 모양).
    await waitFor(() => expect(savedHidden()).toBeUndefined());
  });

  it('칸반이 아닌 문서의 메뉴에는 이 줄이 없다', async () => {
    const bodies = { ...BODIES(), d2: { doc: { v: 1, kind: 'board', nodes: {}, floats: [], lines: [], zones: [], layoutMode: 'right', themeKey: 'white' } as unknown as LoadedDoc['doc'], version: 1, title: '보드' } };
    renderHome([META('d1', '스프린트 보드'), META('d2', '이슈 트리아지')], bodies);
    await waitFor(() => expect(document.querySelector('[data-cal-summary]')!.textContent).not.toBe('예정된 일정이 없어요'));
    fireEvent.click(document.querySelector('aside')!.querySelector('[data-space-id="s2"], [data-space="s2"]') ?? [...document.querySelectorAll('aside [role="button"], aside button')].find((e) => e.textContent?.trim().startsWith('원티드랩'))!);
    await waitFor(() => expect(cardEl('이슈 트리아지')).toBeTruthy());
    fireEvent.contextMenu(cardEl('이슈 트리아지'));
    await screen.findByText('이름 변경');
    expect(screen.queryByText('일정에 반영하지 않기')).toBeNull();
    expect(screen.queryByText('일정에 반영하기')).toBeNull();
  });
});

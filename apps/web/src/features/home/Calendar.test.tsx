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
import { LocalCommentStore } from '../../adapters/local/localCommentStore';
import { LocalNotificationStore } from '../../adapters/local/localNotificationStore';
import { LocalEventStore } from '../../adapters/local/localEventStore';
import { LocalImageStore } from '../../adapters/local/localImageStore';
import type { Backend, DocMeta, DocStore, LoadedDoc } from '../../adapters/ports';
import { ACTIVE_VIEW_KEY } from './storage';
import { addDays, daysBetween, isoOf, todayISO } from './calendar/model';
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
  listEditorNames = vi.fn(async (): Promise<Record<string, string>> => ({}));
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

  async list(): Promise<DocMeta[]> {
    return this.metas;
  }
}

function renderHome(metas: DocMeta[], bodies: Record<string, LoadedDoc>) {
  const docStore = new MockDocStore(metas, bodies);
  const backend: Backend = {
    auth: new LocalAuth(),
    docStore,
    spaceStore: new LocalSpaceStore(),
    shareStore: new LocalShareStore(),
    feedbackStore: new LocalFeedbackStore(),
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
      dashboards: [{ id: 'dash1', name: '주간 현황', items: [] }],
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
  // 본문 프리페치가 도착해 개수가 서기까지 기다린다.
  await waitFor(() => expect(document.querySelector('[data-cal-nav]')!.textContent).toMatch(/일정\d/));
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

  it('LNB `일정` 행은 대시보드 구획과 스페이스 구획 사이에 있고 다가오는 마감 수를 센다', async () => {
    renderHome([META('d1', '스프린트 보드'), META('d2', '이슈 트리아지')], BODIES());
    await openCalendar();
    // 다가오는 마감 = 오늘(1) + D+1(1) + 기간 카드 기한(1) = 3. 완료 열은 빠진다.
    expect(document.querySelector('[data-cal-nav]')!.textContent).toBe('일정3');
    // 순서: 대시보드 구획 → 일정 → 스페이스 구획
    const nav = document.querySelector('[data-cal-nav]')!;
    const dash = screen.getByText('주간 현황');
    const spaceLabel = screen.getByText('스페이스');
    expect(dash.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(nav.compareDocumentPosition(spaceLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

  it('통계 칩은 **필터가 아니라 목록**이다 — 누르면 그 항목이 팝오버로 뜨고 골라서 상세로 간다', async () => {
    renderHome([META('d1', '스프린트 보드'), META('d2', '이슈 트리아지')], BODIES());
    await openCalendar();
    await waitFor(() => expect(chipTexts().length).toBeGreaterThan(1));
    const before = chipTexts().length;
    const over = document.querySelector('[data-cal-stat="over"]')!;
    expect(over.textContent).toContain('1건');
    fireEvent.click(over);
    // 팝오버가 뜨고 **달력은 그대로다**(예전에는 나머지가 통째로 사라졌다).
    await waitFor(() => expect(document.querySelector('[data-cal-stat-item]')).toBeTruthy());
    expect(chipTexts().length).toBe(before);
    const row = document.querySelector('[data-cal-stat-item]') as HTMLElement;
    expect(row.textContent).toContain('지난 마감 카드');
    expect(row.textContent).toContain('-5일'); // 며칠 지났는지까지 말한다
    // 목록에서 고르면 그 항목의 상세
    fireEvent.click(row);
    await waitFor(() => expect(detail()).toBeTruthy());
    expect(document.querySelector('[data-cal-detail-title]')!.textContent).toBe('지난 마감 카드');
  });

  it('항목이 없는 통계 칩은 빈 안내를 보여 준다(눌러도 아무 일 없는 칩이 아니다)', async () => {
    // 앞으로 올 마감 하나뿐 — `지난 마감`은 0건이다.
    renderHome([META('d1', '스프린트 보드')], { d1: kanbanBody([{ id: 'k1', col: 'c2', pos: 1, text: '앞날 카드', due: shiftDays(2) }]) });
    await openCalendar();
    const over = document.querySelector('[data-cal-stat="over"]')!;
    expect(over.textContent).toContain('0건');
    fireEvent.click(over);
    await waitFor(() => expect(document.body.textContent).toContain('해당하는 일정이 없어요'));
    expect(document.querySelector('[data-cal-stat-item]')).toBeNull();
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

  it('날짜별 보기(RNB)와 마감 목록은 각자 켜고 끈다 — 마감 목록은 달력 위에 겹친다', async () => {
    renderHome([META('d1', '스프린트 보드'), META('d2', '이슈 트리아지')], BODIES());
    await openCalendar();
    const side = () => document.querySelector('[data-cal-side]')!;
    // 날짜별 보기는 기본으로 열려 있고, 미니 달력에서 오늘을 고르면 그 날 목록이 된다.
    await waitFor(() => expect(side()).toBeTruthy());
    fireEvent.click(document.querySelector(`[data-mini-day="${todayISO()}"]`)!);
    await waitFor(() => expect(side().textContent).toContain('일정 '));
    expect(within(side() as HTMLElement).getByText('오늘 마감 카드')).toBeTruthy();
    // 날짜별 항목은 **왼쪽 색 바가 붙은 납작한 행**이다(디자인 원본) — 마감 목록의
    // 두 줄 카드와 다른 물건. 우측 메모는 열 이름, 기간이면 `N/M일째`.
    const chips = [...document.querySelectorAll('[data-cal-day-chip]')] as HTMLElement[];
    expect(chips.length).toBeGreaterThan(0);
    expect(chips[0]!.style.borderLeft).toMatch(/^3px solid/);
    expect(chips[0]!.style.borderRadius).toBe('4px 10px 10px 4px');
    expect(chips[0]!.textContent).toContain('진행 중');
    // 오늘은 기간 카드(닷새짜리)의 며칠째다 — 시작이 월초·월말 클램프로 움직이므로 계산해 단정한다
    expect(side().textContent).toContain(`${daysBetween(SPAN.start, todayISO()) + 1}/5일째`);
    expect(document.querySelector('[aria-label="날짜별 보기"]')!.getAttribute('aria-pressed')).toBe('true');

    // 마감 목록은 **다른 물건**이다(원본 `dlOpen`) — 날짜별 보기를 갈아 끼우지 않고
    // 달력 위에 겹치는 판으로 뜬다. 둘 다 켜지면 나란히 선다.
    fireEvent.click(document.querySelector('[aria-label="마감 목록"]')!);
    const dl = () => document.querySelector('[data-cal-deadline]') as HTMLElement | null;
    await waitFor(() => expect(dl()).toBeTruthy());
    expect(dl()!.textContent).toContain('다가오는 마감');
    expect(side()).toBeTruthy();
    // 겹치는 판이라 날짜별 보기가 열려 있으면 그 폭만큼 왼쪽으로 비켜선다.
    expect(dl()!.style.right).toBe('300px');
    // 다시 누르면 접힌다(날짜별 보기는 그대로).
    fireEvent.click(document.querySelector('[aria-label="마감 목록"]')!);
    await waitFor(() => expect(dl()).toBeNull());
    expect(document.querySelector('[data-cal-side]')).toBeTruthy();
  });

  it('마감 목록이 열려 있을 때 날짜 칸을 고르면 목록이 닫힌다(제보 #12)', async () => {
    renderHome([META('d1', '스프린트 보드')], BODIES());
    await openCalendar();
    fireEvent.click(document.querySelector('[aria-label="마감 목록"]')!);
    await waitFor(() => expect(document.querySelector('[data-cal-deadline]')).toBeTruthy());
    // 달력 칸을 누르는 순간 그 판은 자리를 비켜 준다(달력으로 돌아온 것이므로).
    fireEvent.click(document.querySelector(`[data-day-cell="${shiftInMonth(1)}"]`)!);
    await waitFor(() => expect(document.querySelector('[data-cal-deadline]')).toBeNull());
    // 날짜별 보기는 고른 날의 짝이라 그대로 남는다.
    expect(document.querySelector('[data-cal-side]')).toBeTruthy();
  });

  it('마감 배지는 급한 정도로 색이 갈리고, 목록이 길면 접힌다(제보 #14·#15)', async () => {
    // 오늘 / 이틀 뒤 / 먼 뒤 — 세 등급이 한 목록에 서게 만든다.
    const many = Array.from({ length: 9 }, (_, i) => ({ id: `n${i}`, col: 'c1', pos: i + 1, text: `일감 ${i}`, due: shiftInMonth(i === 0 ? 0 : i === 1 ? 2 : 10 + i) }));
    renderHome([META('d1', '스프린트 보드')], { d1: kanbanBody(many) });
    await openCalendar();
    fireEvent.click(document.querySelector('[aria-label="마감 목록"]')!);
    const dl = await waitFor(() => {
      const el = document.querySelector('[data-cal-deadline]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    // 중요도 사다리: 오늘 / 사흘 안 / 그 뒤가 서로 다른 색을 쓴다.
    const tones = [...dl.querySelectorAll('[data-cal-due]')].map((b) => b.getAttribute('data-cal-due'));
    expect(new Set(tones).size).toBeGreaterThan(1);
    const today = dl.querySelector<HTMLElement>('[data-cal-due="today"]')!;
    const later = dl.querySelector<HTMLElement>('[data-cal-due="later"]')!;
    expect(today.style.color).not.toBe(later.style.color);
    // 아홉 개는 한 번에 다 펼치지 않는다 — 나머지는 `+N개 더 보기`로.
    const more = dl.querySelector<HTMLElement>('[data-cal-more-upcoming]')!;
    expect(more.textContent).toBe('+2개 더 보기');
    fireEvent.click(more);
    await waitFor(() => expect(dl.querySelectorAll('[data-cal-row]').length).toBe(9));
    expect(dl.querySelector('[data-cal-more-upcoming]')).toBeNull();
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
    // 고른 표시는 **날짜 숫자의 링**이다(제보 — 배경으로 표시하니 이웃 달의 가라앉은
    // 면·주말 톤·드롭 대기와 뜻이 겹쳐 계속 문제가 났다). 칸 배경은 그대로다.
    await waitFor(() => expect(out.querySelector('[data-day-num][data-selected]')).toBeTruthy());
    expect(out.style.background).toBe('var(--mf-cal-out)');
    // 고른 날의 숫자는 **채운 원**이다 — 속 빈 링은 튀어 보였다(제보). 요일에 따라
    // 그 색이 갈린다(요청 ④: 토·일·공휴일은 파랑·빨강을 지킨다).
    const outDow = new Date(`${out.getAttribute('data-day-cell')}T12:00:00`).getDay();
    expect((out.querySelector('[data-day-num]') as HTMLElement).style.background).toBe(
      outDow === 0 ? 'var(--mf-danger)' : outDow === 6 ? 'var(--mf-info)' : 'var(--mf-text)',
    );
    // 사이드가 그 날을 보여 준다 — 이번 달이 아니어도 고를 수 있다.
    const iso = out.getAttribute('data-day-cell')!;
    const [, m, d] = /(\d{2})-(\d{2})$/.exec(iso)!.map(Number) as unknown as number[];
    await waitFor(() => expect(document.querySelector('[data-cal-side]')!.textContent).toContain(`${+m!}월 ${+d!}일`));
  });

  it('이웃 달 칸의 날짜도 토·일 색을 쓴다(요청 ④) — 이번 달이 아님은 면과 흐림이 말한다', async () => {
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
      // 이웃 달 칸의 일요일은 붉게, 토요일은 파랗게 — 평일만 흐린 회색이다.
      if (dow === 0) expect(numOf(cell)).toBe('var(--mf-danger)');
      else if (dow === 6) expect(numOf(cell)).toBe('var(--mf-info)');
      else expect(numOf(cell)).toBe('var(--mf-faint)');
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
    expect(document.body.textContent).toContain('불러오고');
    await waitFor(() => expect(screen.getByText('EDITOR_PLACEHOLDER')).toBeTruthy(), { timeout: 3000 });
  });

  it('이 탭이 일정 화면을 보고 있었으면 돌아왔을 때 일정 화면으로 착지한다', async () => {
    // 세션에 남은 화면 = 일정. (예전에는 `loadActiveView`가 이 필드를 걸러 버려
    // 대시보드로 착지했다 — 실브라우저 프로브가 잡은 회귀.)
    sessionStorage.setItem(ACTIVE_VIEW_KEY, JSON.stringify({ activeSpace: 's1', curFolder: null, activeDash: null, activeCal: true }));
    renderHome([META('d1', '스프린트 보드'), META('d2', '이슈 트리아지')], BODIES());
    await waitFor(() => expect(document.querySelector('[data-calendar-view]')).toBeTruthy());
    expect(localStorage.getItem('mf_home_landing')).toBe('cal');
  });

  it('폰에서는 사이드를 접고, 화면이 바뀌면 서랍이 닫힌다', async () => {
    mockMatchMedia(true);
    renderHome([META('d1', '스프린트 보드'), META('d2', '이슈 트리아지')], BODIES());
    // 서랍을 열고 일정으로
    await waitFor(() => expect(screen.getByLabelText('메뉴 열기')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('메뉴 열기'));
    await openCalendar();
    // 고른 화면을 서랍이 가리지 않는다
    await waitFor(() => expect(document.querySelector('aside.mf-drawer')).toBeNull());
    // 좁은 화면에는 사이드가 없다(달력만)
    expect(document.querySelector('[data-cal-side]')).toBeNull();
    expect(document.querySelectorAll('[data-day-cell]').length).toBe(42);
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

  it('통계 칩은 면도 테두리도 없고, 켜짐은 CSS 클래스가 정한다(제보 ②)', async () => {
    renderHome([META('d1', '스프린트 보드'), META('d2', '이슈 트리아지')], BODIES());
    await openCalendar();
    const chip = document.querySelector('[data-cal-stat="today"]') as HTMLElement;
    expect(chip.style.border).toBe('0px');
    // 인라인 배경을 두지 않는다 — 두면 hover 규칙(`.mf-cal-chip:hover`)과 싸운다.
    expect(chip.style.background).toBe('');
    expect(chip.className).toContain('mf-cal-chip');
    expect(chip.className).not.toContain('mf-ctl');
  });

  it('칸 배경은 요일만 말하고, 고른 날은 **숫자 링**이 진다(제보 — 배경 표시가 계속 문제였다)', async () => {
    renderHome([META('d1', '스프린트 보드'), META('d2', '이슈 트리아지')], BODIES());
    await openCalendar();
    const cell = () => document.querySelector('[data-day-cell][data-today="1"]') as HTMLElement;
    const num = () => cell().querySelector('[data-day-num]') as HTMLElement;
    // 오늘은 숫자가 이미 채운 원으로 말한다 — 배경까지 바꾸면 "고른 칸"과 헷갈린다.
    expect(cell().style.background).not.toContain('cal-today');
    const before = cell().style.background;
    fireEvent.click(document.querySelector(`[data-mini-day="${todayISO()}"]`)!);
    // 고르면 **칸 배경은 그대로**이고 숫자만 표시된다 — 오늘은 이미 채운 원이라
    // 안쪽 링이 보이지 않으므로 바깥 후광으로 두른다.
    await waitFor(() => expect(num().dataset.selected).toBe('1'));
    expect(cell().style.background).toBe(before);
    expect(cell().style.boxShadow).not.toContain('inset');
    // 오늘+선택은 강조색 원에 **옅은 후광**(딱딱한 링이 아니라 물 탄 강조색).
    // 예전 값(`--mf-cal-ring`)은 테마에서 지워진 토큰이라 아무 표시도 나오지 않았다.
    expect(num().style.boxShadow).toBe('0 0 0 3px var(--mf-accent-mute)');
    expect(num().style.background).toBe('var(--mf-accent)');
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

    it('달력 뒤의 면은 **바닥 면**(`--mf-page`)이고 점 격자는 그대로다(요청)', async () => {
      renderHome([META('d1', '스프린트 보드')], BODIES());
      await openCalendar();
      const body = document.querySelector('[data-cal-body]') as HTMLElement;
      expect(body.style.background).toContain('--mf-page');
      // 점 격자는 그 위에 그대로(요청: dot 표시는 유지).
      const canvas = document.querySelector('[data-cal-canvas]') as HTMLElement;
      expect(canvas.style.backgroundImage).toContain('--mf-dot-grid');
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

    it('고른 날은 **채운 원**이고, 토·일·공휴일은 그 색을 지킨다(제보 ③④)', async () => {
      renderHome([META('d1', '스프린트 보드')], BODIES());
      await openCalendar();
      const num = (iso: string) => document.querySelector(`[data-day-cell="${iso}"] [data-day-num]`) as HTMLElement;
      const pick = async (iso: string) => {
        fireEvent.click(document.querySelector(`[data-day-cell="${iso}"]`)!);
        await waitFor(() => expect(num(iso).dataset.selected).toBe('1'));
      };
      // 이 달 안의 평일·토·일을 각각 찾는다(월말에도 흔들리지 않게 DOM에서 고른다).
      const cells = [...document.querySelectorAll<HTMLElement>('[data-day-cell]')].filter((c) => !c.dataset.outMonth && !c.dataset.today);
      const dowOf = (c: HTMLElement) => new Date(`${c.dataset.dayCell}T12:00:00`).getDay();
      const weekday = cells.find((c) => dowOf(c) > 0 && dowOf(c) < 6)!.dataset.dayCell!;
      const sat = cells.find((c) => dowOf(c) === 6)!.dataset.dayCell!;
      const sun = cells.find((c) => dowOf(c) === 0)!.dataset.dayCell!;

      // 속 빈 링(`inset ... 2px accent`)이 아니라 채운 원 — 그 링이 튀어 보였다(제보 ③).
      await pick(weekday);
      expect(num(weekday).style.background).toBe('var(--mf-text)');
      expect(num(weekday).style.color).toBe('var(--mf-card)');
      expect(num(weekday).style.boxShadow).toBe('');
      // 요청 ④ — 고른 뒤에도 파랑·빨강이 남는다(예전에는 잉크색이 덮어 요일 신호가 사라졌다).
      await pick(sat);
      expect(num(sat).style.background).toBe('var(--mf-info)');
      await pick(sun);
      expect(num(sun).style.background).toBe('var(--mf-danger)');
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

    it('칸·칩이 아닌 자리의 우클릭 = 화면 메뉴(새 일정 · 사이드 토글)', async () => {
      renderHome([META('d1', '스프린트 보드')], BODIES());
      await openCalendar();
      const area = document.querySelector('[data-cal-stats]')!.parentElement as HTMLElement;
      fireEvent.contextMenu(area);
      await waitFor(() => expect(document.querySelector('[data-home-ctx="cal-view"]')).toBeTruthy());
      const menu = document.querySelector('[data-home-ctx="cal-view"]') as HTMLElement;
      expect(menu.textContent).toContain('새 일정');
      expect(menu.textContent).toContain('마감 목록 보기');
      fireEvent.click(within(menu).getByText('마감 목록 보기'));
      await waitFor(() => expect(document.querySelector('[data-cal-deadline]')).toBeTruthy());
    });

    it('통계 팝오버의 `+N개 더 보기`를 누르면 목록이 전부 보인다(제보 ⑨)', async () => {
      const many = Array.from({ length: 8 }, (_, i) => ({ id: `o${i}`, col: 'c1', pos: i + 1, text: `지난 카드 ${i + 1}`, due: shiftDays(-(i + 1)) }));
      // LNB의 `일정 N`은 **다가오는** 마감을 센다 — 지난 것만 있으면 개수가 서지 않아
      // `openCalendar`가 기다리다 만다(앞으로 올 카드 하나를 함께 심는다).
      renderHome([META('d1', '스프린트 보드')], { d1: kanbanBody([...many, { id: 'up', col: 'c1', pos: 9, text: '앞날 카드', due: shiftDays(2) }]) });
      await openCalendar();
      const over = document.querySelector('[data-cal-stat="over"]')!;
      fireEvent.click(over);
      await waitFor(() => expect(document.querySelectorAll('[data-cal-stat-item]').length).toBe(5));
      const more = document.querySelector('[data-cal-stat-more]') as HTMLElement;
      expect(more.textContent).toBe('+3개 더 보기');
      fireEvent.click(more);
      await waitFor(() => expect(document.querySelectorAll('[data-cal-stat-item]').length).toBe(8));
      expect(document.querySelector('[data-cal-stat-more]')).toBeNull();
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
      Object.defineProperty(grid, 'clientHeight', { configurable: true, value: 6 * 115 });
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
      // 기본 09:00–10:00 = 1시간
      expect(document.querySelector('[data-new-dur]')!.textContent).toBe('1시간');
      fireEvent.click(document.querySelector('[data-new-quick="120"]')!);
      await waitFor(() => expect(document.querySelector('[data-new-dur]')!.textContent).toBe('2시간'));
      fireEvent.change(document.querySelector('[data-new-title]')!, { target: { value: '설계 회의' } });
      fireEvent.click(document.querySelector('[data-new-submit]')!);
      await waitFor(() => expect(events()).toHaveLength(1));
      expect(events()[0]).toMatchObject({ title: '설계 회의', allDay: false, startTime: '09:00', endTime: '11:00' });
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
      await waitFor(() => expect(events()[0]).toMatchObject({ allDay: false, startTime: '09:00', endTime: '10:00', location: '2층 라운지' }));
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

    it('상세 팝업은 새 일정 팝업과 같은 얼굴이다 — 저장할 캘린더는 소속만 켜진다(제보 #10·#11)', async () => {
      renderHome([META('d1', '스프린트 보드')], BODIES());
      localStorage.setItem('mf_events', JSON.stringify([{ id: 'e1', title: '주간 회의', startDate: todayISO(), endDate: todayISO(), allDay: true, source: 'geurio' }]));
      await openCalendar();
      await waitFor(() => expect(chipTexts()).toContain('주간 회의'));

      // 칸의 칩은 글자 폭만큼만 눌린다 — 칸 전체로 늘어나면 빈 옆자리 클릭이
      // 팝업을 열었다(제보 #1. jsdom엔 히트 영역이 없어 스타일 계약으로 지킨다).
      const chip = chipFor('주간 회의');
      expect(chip.style.alignSelf).toBe('flex-start');

      fireEvent.click(chip);
      await waitFor(() => expect(evDetail()).toBeTruthy());
      // 제목은 새 일정과 같은 한 줄 입력이고, 발치에 취소가 있다(#10 파리티).
      const title = document.querySelector('[data-event-title]') as HTMLInputElement;
      expect(title.tagName).toBe('INPUT');
      expect(title.value).toBe('주간 회의');
      expect(document.querySelector('[data-event-cancel]')).toBeTruthy();
      // 메모는 새 일정 팝업과 같은 높이(#9).
      expect((document.querySelector('[data-event-note]') as HTMLElement).style.height).toBe('110px');
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

  // 요청 ①② — 종일은 **채운 칩**(하루를 통째로 쓰는 일), 시간 일정은 **표식 + 시작
  // 시각 + 제목**(구글 캘린더의 관례). 그래서 칸을 훑을 때 둘이 갈린다.
  it('종일 항목은 채운 칩, 시간 일정은 시작 시각을 앞에 붙인 글자다', async () => {
    localStorage.setItem(
      'mf_events',
      JSON.stringify([{ id: 'e1', title: '회의', startDate: todayISO(), endDate: todayISO(), allDay: false, startTime: '09:00', endTime: '10:00', source: 'geurio' }]),
    );
    renderHome([META('d1', '스프린트 보드'), META('d2', '이슈 트리아지')], BODIES());
    await openCalendar();
    await waitFor(() => expect(chipTexts()).toContain('오늘 마감 카드'));
    // 칸반 마감은 종일이다 — 면을 채운다.
    expect(chipFor('오늘 마감 카드').style.background).not.toBe('transparent');
    // 시각이 있는 일정은 면 없이 시각을 앞에 세운다.
    await waitFor(() => expect(chipTexts()).toContain('회의'));
    const timed = chipFor('회의');
    expect(timed.style.background).toBe('transparent');
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

  it('날짜 숫자는 12px이고 격자선·이웃 달 칸은 전용 토큰을 쓴다(요청)', async () => {
    renderHome([META('d1', '스프린트 보드'), META('d2', '이슈 트리아지')], BODIES());
    await openCalendar();
    const cell = document.querySelector('[data-day-cell]') as HTMLElement;
    // 격자선은 일반 경계선보다 한 단계 또렷한 전용 토큰(기본 테마는 #d6c3b5)
    expect(cell.style.borderRight).toBe('1px solid var(--mf-cal-grid)');
    expect(cell.style.borderBottom).toBe('1px solid var(--mf-cal-grid)');
    // 이웃 달 칸은 전용 토큰(디자인 원본 #F5EFE7)
    const out = document.querySelector('[data-day-cell][data-out-month="1"]') as HTMLElement;
    expect(out.style.background).toBe('var(--mf-cal-out)');
    const num = cell.querySelector('span > span') as HTMLElement;
    expect(num.style.fontSize).toBe('12px');
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

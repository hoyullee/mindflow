import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
import { isoOf, todayISO } from './calendar/model';

/**
 * 일정 화면(캘린더 PR1) 통합 테스트 — 디자인 원본 `Geurio 일정 캘린더.dc.html` 이식.
 *
 * 데이터는 **전 스페이스의 칸반 마감**이고 본문은 썸네일 프리페치가 받아 둔 것을
 * 그대로 읽는다. 순수 계산(격자·통계·목록)은 `calendar/model.test.ts`가 덮으므로
 * 여기서는 홈이 실제로 하는 흐름만 본다: LNB에서 열고, 걸러 보고, 항목을 눌러
 * 그 칸반으로 가고, 돌아오면 다시 일정 화면.
 */

afterEach(() => cleanup());
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
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
    { id: 'k4', col: 'c2', pos: 4, text: '기간 카드', due: shiftDays(3), start: shiftDays(-1) },
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

const chipTexts = (): string[] => [...document.querySelectorAll('[data-cal-chip]')].map((c) => c.textContent!.trim());
const chipFor = (title: string): HTMLElement => [...document.querySelectorAll('[data-cal-chip]')].find((c) => c.textContent!.trim() === title) as HTMLElement;
const barFor = (title: string): HTMLElement => [...document.querySelectorAll('[data-cal-bar]')].find((c) => c.textContent!.trim() === title) as HTMLElement;
const detail = (): HTMLElement => document.querySelector('[role="dialog"][aria-label="일정 상세"]') as HTMLElement;

/** 날짜 팝오버를 열어 그 날을 고른다 — 디자인 원본의 `pk` 달력(native input이 아니다). */
async function pickDate(triggerSel: string, iso: string): Promise<void> {
  fireEvent.click(document.querySelector(triggerSel)!);
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
    // 다가오는 마감 = 오늘(1) + D+1(1) + 기간 카드 기한 D+3(1) = 3. 완료 열은 빠진다.
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
    await waitFor(() => expect(chipTexts()).toContain('다른 스페이스 카드'));
    expect(chipTexts()).toContain('오늘 마감 카드');
    // 완료 열 카드는 어디에도 없다
    expect(document.body.textContent).not.toContain('완료된 카드');
    // 기간 카드는 칩이 아니다 — 칸의 바(제목은 시작 칸/일요일에만)
    expect(chipTexts()).not.toContain('기간 카드');
    expect([...document.querySelectorAll('[data-day-cell] button')].some((b) => b.textContent === '기간 카드')).toBe(true);
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
    await waitFor(() => expect(document.querySelector('[data-cal-month]')!.textContent).toBe(`${now.getFullYear() + 1}년 3월`));
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
    // 오늘은 기간 카드(시작 -1일 · 기한 +3일)의 2일째다
    expect(side().textContent).toContain('2/5일째');
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

  it('오늘 칸에는 배경이 없고(요청), 고른 칸은 가라앉은 면 쪽 파생 토큰만 쓴다', async () => {
    renderHome([META('d1', '스프린트 보드'), META('d2', '이슈 트리아지')], BODIES());
    await openCalendar();
    const cell = () => document.querySelector('[data-day-cell][data-today="1"]') as HTMLElement;
    // 오늘은 숫자가 이미 채운 원으로 말한다 — 배경까지 바꾸면 "고른 칸"과 헷갈린다.
    expect(cell().style.background).not.toContain('cal-today');
    fireEvent.click(document.querySelector(`[data-mini-day="${todayISO()}"]`)!);
    await waitFor(() => expect(cell().style.background).toBe('var(--mf-cal-sel)'));
    // 고른 칸에는 링을 두르지 않는다(원본 `selRing: 'none'`) — 면만으로 알린다.
    expect(cell().style.boxShadow).not.toContain('inset');
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

      const target = shiftDays(2);
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

      // 삭제 — 카드가 사라지고 팝업도 닫힌다.
      docStore.save.mockClear();
      fireEvent.click(document.querySelector('[data-cal-detail-delete]')!);
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

      // 기간 카드: 시작 D-1 · 기한 D+3. 시작 칸(제목이 붙는 칸)을 잡아 D+1 칸으로 → +2일.
      const grab = shiftDays(-1);
      const drop = shiftDays(1);
      const restore = stubCellHitTest([grab, drop]);
      try {
        dragTo(barFor('기간 카드'), 10, 150);
      } finally {
        restore();
      }
      await waitFor(() => expect(docStore.save).toHaveBeenCalled());
      const [, next] = docStore.save.mock.calls[0]!;
      const card = (next.cards ?? []).find((c) => c.id === 'k4')!;
      expect(card.start).toBe(shiftDays(1));
      expect(card.due).toBe(shiftDays(5));
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
      // 종료가 앞섰다면 정규화가 종일로 되돌려 시각이 통째로 사라진다.
      await waitFor(() => expect(events()[0]).toMatchObject({ allDay: false, startTime: '16:00', endTime: '17:00' }));
    });

    it('일정을 누르면 **칸반과 다른 팝업**이 뜨고, 고치면 곧바로 저장된다', async () => {
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

      // 위치는 blur에 한 번 커밋한다(타이핑마다 저장하지 않는다).
      const loc = document.querySelector('[data-event-loc]') as HTMLInputElement;
      fireEvent.change(loc, { target: { value: '2층 라운지' } });
      expect(events()[0]!.location).toBeUndefined();
      fireEvent.blur(loc);
      await waitFor(() => expect(events()[0]!.location).toBe('2층 라운지'));

      // 종일을 끄면 시각이 붙는다(표의 제약대로 쌍으로).
      fireEvent.click(document.querySelector('[data-event-allday]')!);
      await waitFor(() => expect(events()[0]).toMatchObject({ allDay: false, startTime: '09:00', endTime: '10:00' }));
    });

    it('상세에서 삭제하면 표에서 사라지고 팝업이 닫힌다', async () => {
      renderHome([META('d1', '스프린트 보드')], BODIES());
      localStorage.setItem('mf_events', JSON.stringify([{ id: 'e1', title: '지울 일정', startDate: todayISO(), endDate: todayISO(), allDay: true, source: 'geurio' }]));
      await openCalendar();
      await waitFor(() => expect(chipTexts()).toContain('지울 일정'));
      fireEvent.click(chipFor('지울 일정'));
      await waitFor(() => expect(evDetail()).toBeTruthy());
      fireEvent.click(document.querySelector('[data-event-delete]')!);
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

    it('시각 일정이 없는 날은 빈 상태가 그 날짜로 일정 만들기를 권한다', async () => {
      renderHome([META('d1', '스프린트 보드')], BODIES());
      await openCalendar();
      await waitFor(() => expect(document.querySelector('[data-cal-timeline-empty]')).toBeTruthy());
      expect(document.querySelector('[data-cal-timeline]')).toBeNull();
      // 고른 날짜가 곧 기본값 — 며칠 뒤 칸을 고르고 만들면 그 날에 놓인다.
      const target = shiftDays(2);
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
      expect(document.querySelector('[data-event-span]')!.textContent).toContain('3일간');
    });
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
});

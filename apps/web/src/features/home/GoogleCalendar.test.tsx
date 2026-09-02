import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
import type { Backend, DocMeta, DocStore } from '../../adapters/ports';
import { isoOf } from './calendar/model';
import { GOOGLE_CALENDAR_SCOPE, GOOGLE_SCOPE_REQUIRED } from './calendar/googleCalendar';

/**
 * 클라이언트 ID는 `import.meta.env`에서 오는데 Vite가 그 값을 **변환 시점에 굳혀**
 * `vi.stubEnv`가 닿지 않는다(실측). 그래서 읽는 함수 하나만 갈아 끼운다 —
 * 나머지(GIS 스크립트 로더)는 원본 그대로 둔다.
 */
let clientId: string | null = null;
vi.mock('../auth/googleIdentity', async (orig) => ({
  ...(await orig<typeof import('../auth/googleIdentity')>()),
  readGoogleClientId: () => clientId,
}));

/**
 * 구글 캘린더 겹치기(PR5) 통합 — 홈이 실제로 하는 흐름.
 *
 * 진짜 구글에는 붙지 않는다. GIS 토큰 클라이언트(`window.google.accounts.oauth2`)와
 * `fetch`를 **가짜로 세워** 우리 쪽 배선만 본다: 설정에서 연결하면 캘린더 목록이
 * 뜨고, 고른 캘린더의 일정이 달력에 겹치고, 공휴일은 칩이 아니라 날짜 색이 되고,
 * 구글 항목을 누르면 **읽기 전용** 팝업이 뜬다.
 */

afterEach(() => cleanup());
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  clientId = null;
});

class MockDocStore implements DocStore {
  listEditorNames = vi.fn(async (): Promise<Record<string, string>> => ({}));
  setFavorite = vi.fn(async (): Promise<void> => undefined);
  remove = vi.fn(async (): Promise<void> => undefined);
  restore = vi.fn(async (): Promise<void> => undefined);
  purge = vi.fn(async (): Promise<void> => undefined);
  load = vi.fn(async () => null);
  loadPreview = vi.fn(async () => null);
  save = vi.fn(async () => ({ ok: true as const, version: 1, updatedAt: '' }));
  listSharedWithMe = vi.fn(async (): Promise<DocMeta[]> => []);
  rename = vi.fn(async (): Promise<void> => undefined);
  async list(): Promise<DocMeta[]> {
    return [];
  }
}

const HOLIDAY_ID = 'ko.south_korea#holiday@group.v.calendar.google.com';
/** 남이 **보기 전용**으로 공유한 캘린더 — 그 일정은 고칠 수 없다(PR6). */
const SHARED_ID = 'shared@example.com';

/** 종일 일정의 end.date는 배타적 — 하루짜리 공휴일이면 다음 날을 적는다. */
function nextDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y!, m! - 1, d! + 1);
  return isoOf(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

/** 이 달 안에 머무는 날 — 이웃 달 칸은 누를 수 없다(Calendar.test.tsx와 같은 이유). */
function inMonth(n: number): string {
  const now = new Date();
  const fwd = new Date(now);
  fwd.setDate(fwd.getDate() + n);
  if (fwd.getMonth() === now.getMonth()) return isoOf(fwd.getFullYear(), fwd.getMonth() + 1, fwd.getDate());
  const back = new Date(now);
  back.setDate(back.getDate() - n);
  return isoOf(back.getFullYear(), back.getMonth() + 1, back.getDate());
}

/**
 * 이 달 안의 **평일** — 공휴일 표시를 검증할 날. 일·토를 고르면 그 칸은 원래
 * 주말 색이라 "공휴일이라서 빨간가"를 구분할 수 없다(가짜 통과).
 */
function weekdayInMonth(nth = 0): string {
  const now = new Date();
  let seen = 0;
  for (const step of [2, 3, 4, 5, -2, -3, -4, -5, 1, -1]) {
    const d = new Date(now);
    d.setDate(d.getDate() + step);
    if (d.getMonth() === now.getMonth() && d.getDay() !== 0 && d.getDay() !== 6) {
      if (seen === nth) return isoOf(d.getFullYear(), d.getMonth() + 1, d.getDate());
      seen += 1;
    }
  }
  return isoOf(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/**
 * GIS 토큰 클라이언트 흉내 — 누르면 곧바로 토큰을 준다.
 *
 * @param grantedScope 구글이 **실제로 승인한** 스코프. 기본은 우리가 요구한 전부이고,
 *   좁게 주면 동의 화면에서 일부만 체크한 경우(또는 옛 승인이 남은 경우)가 된다.
 */
function stubGis(grantedScope?: string): { requested: string[] } {
  const requested: string[] = [];
  (window as unknown as { google: unknown }).google = {
    accounts: {
      oauth2: {
        initTokenClient: (cfg: { scope: string; prompt?: string; callback: (r: unknown) => void }) => ({
          requestAccessToken: () => {
            requested.push(cfg.prompt ?? '');
            cfg.callback({ access_token: 'tok', expires_in: 3600, ...(grantedScope ? { scope: grantedScope } : {}) });
          },
        }),
        revoke: () => undefined,
      },
    },
  };
  return { requested };
}

/** 구글 REST 흉내 — 캘린더 둘(내 캘린더 + 공휴일)과 그 일정. */
function stubFetch(): ReturnType<typeof vi.fn> {
  const meeting = inMonth(1);
  const holiday = weekdayInMonth();
  // 구글의 공휴일 캘린더에는 절기·기념일도 섞여 온다 — 그건 칠하지 않는다(제보).
  const season = weekdayInMonth(1);
  const f = vi.fn(async (url: string) => {
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
    // People API — 이름 검색(선택 스코프 `directory.readonly`)
    if (url.includes('people.googleapis.com')) {
      return ok({ people: [{ names: [{ displayName: '여은진' }], emailAddresses: [{ value: 'eunjin@example.com' }] }] });
    }
    // Admin SDK — 회의실 목록(선택 스코프)
    if (url.includes('admin.googleapis.com')) {
      return ok({
        items: [
          { resourceEmail: 'room-35-01@resource.calendar.google.com', generatedResourceName: '회의실-35-01', resourceCategory: 'CONFERENCE_ROOM', capacity: 23 },
          { resourceEmail: 'room-42-07@resource.calendar.google.com', generatedResourceName: '회의실-42-07', resourceCategory: 'CONFERENCE_ROOM', capacity: 8 },
        ],
      });
    }
    if (url.includes('/users/me/calendarList')) {
      return ok({
        items: [
          { id: 'me@example.com', summary: '내 캘린더', primary: true, backgroundColor: '#4285f4', accessRole: 'owner' },
          { id: SHARED_ID, summary: '남의 캘린더', accessRole: 'reader' },
          { id: HOLIDAY_ID, summary: '대한민국의 휴일' },
        ],
      });
    }
    if (url.includes(encodeURIComponent(SHARED_ID))) {
      return ok({ items: [{ id: 's1', summary: '남의 회의', start: { dateTime: `${meeting}T14:00:00+09:00` }, end: { dateTime: `${meeting}T15:00:00+09:00` }, htmlLink: 'https://calendar.google.com/s' }] });
    }
    if (url.includes(encodeURIComponent(HOLIDAY_ID))) {
      return ok({
        items: [
          { id: 'h1', summary: '테스트 공휴일', description: 'Public holiday', start: { date: holiday }, end: { date: nextDay(holiday) } },
          { id: 'h2', summary: '테스트 절기', description: 'Season', start: { date: season }, end: { date: nextDay(season) } },
        ],
      });
    }
    return ok({
      items: [{ id: 'g1', summary: '구글 회의', start: { dateTime: `${meeting}T09:00:00+09:00` }, end: { dateTime: `${meeting}T10:00:00+09:00` }, htmlLink: 'https://calendar.google.com/x' }],
    });
  });
  vi.stubGlobal('fetch', f);
  return f as unknown as ReturnType<typeof vi.fn>;
}

function seed(google?: { calendars: string[] }): void {
  localStorage.setItem(
    'mf_spaces',
    JSON.stringify({
      spaces: [{ id: 's1', name: '업무', home: true, color: '#f0663f', maps: [], folders: [] }],
      activeSpace: 's1',
      mapFolders: {},
      ...(google ? { google } : {}),
    }),
  );
  localStorage.setItem('mf_demo_session', JSON.stringify({ user: { email: 'me@example.com' }, email: 'me@example.com', name: '나' }));
}

/**
 * 연동된 탭의 실제 상태 — 토큰은 sessionStorage에 산다. 화면은 이제 토큰을 스스로
 * 요청하지 않으므로(**GIS 요청은 조용한 갱신도 팝업을 연다** — 제보의 재로그인 팝업),
 * "이미 연동돼 있다"로 시작하는 테스트는 진짜 탭처럼 토큰을 직접 심는다.
 */
function seedToken(scope: string = GOOGLE_CALENDAR_SCOPE): void {
  sessionStorage.setItem('mf_gcal_token', JSON.stringify({ accessToken: 'tok', expiresAt: Date.now() + 3_600_000, scope }));
}

function renderHome() {
  const backend: Backend = {
    auth: new LocalAuth(),
    docStore: new MockDocStore(),
    spaceStore: new LocalSpaceStore(),
    shareStore: new LocalShareStore(),
    feedbackStore: new LocalFeedbackStore(),
    imageStore: new LocalImageStore(),
    commentStore: new LocalCommentStore(),
    notificationStore: new LocalNotificationStore(),
    eventStore: new LocalEventStore(),
    mode: 'local',
  };
  return render(
    <MemoryRouter initialEntries={['/home']}>
      <BackendProvider backend={backend}>
        <Routes>
          <Route path="/home" element={<Home />} />
          <Route path="/editor" element={<div>EDITOR</div>} />
          <Route path="/login" element={<div>LOGIN</div>} />
        </Routes>
      </BackendProvider>
    </MemoryRouter>,
  );
}

async function openCalendar(container: HTMLElement, user: ReturnType<typeof userEvent.setup>) {
  const aside = await waitFor(() => {
    const el = container.querySelector('aside');
    expect(el).toBeTruthy();
    return el as HTMLElement;
  });
  await user.click(within(aside).getByText('일정'));
  await waitFor(() => expect(container.querySelector('[data-month-grid]')).toBeTruthy());
}

describe('구글 캘린더 겹치기(PR5)', () => {
  beforeEach(() => mockMatchMedia(false));

  it('클라이언트 ID가 없으면 설정에 연동 구획을 그리지 않는다 — 눌러도 아무 일 없는 버튼을 두지 않는다', async () => {
    seed();
    const user = userEvent.setup();
    renderHome();
    await user.click(await screen.findByRole('button', { name: '계정 메뉴' }));
    await user.click(await screen.findByText('설정'));
    await screen.findByRole('dialog', { name: '설정' });
    expect(document.querySelector('[data-google-section]')).toBeNull();
  });

  it('설정에서 연결하면 캘린더 목록이 뜨고, 기본·공휴일만 켜진 채 저장된다', async () => {
    seed();
    stubGis();
    stubFetch();
    clientId = 'test-client.apps.googleusercontent.com';
    const user = userEvent.setup();
    renderHome();
    await user.click(await screen.findByRole('button', { name: '계정 메뉴' }));
    await user.click(await screen.findByText('설정'));
    const section = await waitFor(() => {
      const el = document.querySelector('[data-google-section]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    await user.click(within(section).getByText('연결'));
    // 목록이 뜨고 **기본 + 공휴일만** 켜져 있다 — 캘린더가 스무 개인 사람에게 전부
    // 켜 주면 첫 화면이 남의 일정으로 뒤덮인다(남이 공유한 것은 꺼진 채).
    await waitFor(() => expect(document.querySelector('[data-google-cal="me@example.com"]')).toBeTruthy());
    const boxes = document.querySelectorAll<HTMLInputElement>('[data-google-cal] input');
    expect(boxes.length).toBe(3);
    expect([...boxes].filter((b) => b.checked).length).toBe(2);
    // 쓸 수 없는 캘린더는 그렇게 표시된다(새 일정 목적지에도 오르지 않는다)
    expect(document.querySelector(`[data-google-cal="${SHARED_ID}"] [data-google-readonly]`)).toBeTruthy();
    // 워크스페이스 블롭에 남는다(기기 간 동기화 — 토큰은 남지 않는다)
    await waitFor(() => {
      const ws = JSON.parse(localStorage.getItem('mf_spaces') ?? '{}') as { google?: { calendars: string[] } };
      expect(ws.google?.calendars).toContain('me@example.com');
    });
    expect(localStorage.getItem('mf_spaces')).not.toContain('tok');
    expect(sessionStorage.getItem('mf_gcal_token')).toContain('tok');
  });

  it('연동을 켜 두면 일정 화면에 구글 일정이 겹치고, 공휴일은 칩이 아니라 날짜 색·이름이 된다', async () => {
    seed({ calendars: ['me@example.com', HOLIDAY_ID] });
    seedToken();
    stubGis();
    stubFetch();
    clientId = 'test-client.apps.googleusercontent.com';
    const user = userEvent.setup();
    const { container } = renderHome();
    await openCalendar(container, user);
    // 구글 일정은 칩으로
    await waitFor(() => expect(screen.getAllByText(/구글 회의/).length).toBeGreaterThan(0));
    // 공휴일은 칩이 아니다 — 숫자 옆 **이름표**로만 나온다(디자인 원본)
    const holidayCell = container.querySelector<HTMLElement>(`[data-day-cell="${weekdayInMonth()}"]`);
    expect(holidayCell).toBeTruthy();
    expect(holidayCell!.querySelector('[data-holiday-name]')?.textContent).toBe('테스트 공휴일');
    expect(holidayCell!.querySelector('[data-cal-chip]')).toBeNull();
    // 쉬는 날이라 칸은 **일요일과 같은 색**
    expect(holidayCell!.style.background).toBe('var(--mf-cal-sun)');

    // 절기는 이름만 남고 칸은 평일 색 그대로다 — 구글의 공휴일 캘린더에 섞여 오는
    // 절기·기념일까지 칠하면 달이 통째로 분홍이 된다(제보).
    const seasonCell = container.querySelector<HTMLElement>(`[data-day-cell="${weekdayInMonth(1)}"]`);
    expect(seasonCell).toBeTruthy();
    expect(seasonCell!.querySelector('[data-holiday-name]')?.textContent).toBe('테스트 절기');
    expect(seasonCell!.style.background).toBe('var(--mf-card)');
  });

  /** 그 칩을 눌러 구글 상세 팝업을 연다. */
  async function openGoogleChip(container: HTMLElement, user: ReturnType<typeof userEvent.setup>, text: RegExp): Promise<HTMLElement> {
    await openCalendar(container, user);
    const chip = await waitFor(() => {
      const el = screen.getAllByText(text)[0];
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    await user.click(chip);
    return waitFor(() => {
      const el = document.querySelector('[data-google-detail]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
  }

  it('쓸 수 있는 캘린더의 구글 일정은 그 자리에서 고친다 — 완료를 누르면 구글에 PATCH 한 번', async () => {
    seed({ calendars: ['me@example.com'] });
    seedToken();
    stubGis();
    const f = stubFetch();
    clientId = 'test-client.apps.googleusercontent.com';
    const user = userEvent.setup();
    const { container } = renderHome();
    const pop = await openGoogleChip(container, user, /구글 회의/);
    // 읽기 전용 안내가 아니라 **입력**이 있다
    expect(pop.querySelector('[data-event-notice]')).toBeNull();
    const title = pop.querySelector<HTMLTextAreaElement>('[data-event-title]');
    expect(title).toBeTruthy();
    expect(title!.readOnly).toBe(false);
    // 삭제도 그 자리에서(구글로 보내는 링크는 그대로 남는다)
    expect(pop.querySelector('[data-event-delete]')).toBeTruthy();
    expect(pop.querySelector('[data-google-open]')?.getAttribute('href')).toBe('https://calendar.google.com/x');
    await user.clear(title!);
    await user.type(title!, '이름 바꿈');
    // 저장은 완료 버튼에서 한 번(요청) — 타이핑·blur만으로는 아무것도 보내지 않는다.
    title!.blur();
    expect(f.mock.calls.find((c) => (c[1] as { method?: string } | undefined)?.method === 'PATCH')).toBeUndefined();
    await user.click(pop.querySelector('[data-event-done]')!);
    await waitFor(() => {
      const patch = f.mock.calls.find((c) => (c[1] as { method?: string } | undefined)?.method === 'PATCH');
      expect(patch).toBeTruthy();
      expect(String(patch![0])).toContain('/events/g1');
      expect(JSON.parse((patch![1] as { body: string }).body)).toMatchObject({ summary: '이름 바꿈' });
    });
    // 저장이 끝나면 팝업이 닫힌다 — 구글이 돌려준 값은 달을 다시 받아 그린다.
    await waitFor(() => expect(document.querySelector('[data-google-detail]')).toBeNull());
  });

  it('상세 팝업이 저장할 캘린더를 보여 준다 — 소속(구글)만 켜지고 Geurio는 비활성(제보 #11)', async () => {
    seed({ calendars: ['me@example.com'] });
    seedToken();
    stubGis();
    stubFetch();
    clientId = 'test-client.apps.googleusercontent.com';
    const user = userEvent.setup();
    const { container } = renderHome();
    const pop = await openGoogleChip(container, user, /구글 회의/);
    expect(within(pop).getByText('저장할 캘린더')).toBeTruthy();
    // 소속(내 캘린더)만 켜진다 — 일정을 캘린더 사이로 옮기는 기능이 아니라 표식이다.
    const own = pop.querySelector('[data-event-cal="me@example.com"]');
    expect(own?.getAttribute('aria-disabled')).toBe('false');
    expect(own?.textContent).toContain('내 캘린더');
    expect(pop.querySelector('[data-event-cal="geurio"]')?.getAttribute('aria-disabled')).toBe('true');
  });

  it('설정에서 다시 연결하면 열려 있는 일정 화면에 곧바로 구글 일정이 뜬다(제보 — 새로고침 불필요)', async () => {
    seed({ calendars: ['me@example.com'] });
    // 토큰 없음(재로그인 뒤의 탭) — 화면은 스스로 GIS 팝업을 열지 않는다(#66의 규칙).
    stubGis();
    stubFetch();
    clientId = 'test-client.apps.googleusercontent.com';
    const user = userEvent.setup();
    const { container } = renderHome();
    await openCalendar(container, user);
    expect(screen.queryAllByText(/구글 회의/).length).toBe(0);
    // 설정 모달의 "다시 연결"은 일정 화면과 **다른 훅 인스턴스**다 — 토큰은 탭
    // 저장소에만 살아, storeToken의 신호(onTokenChange)가 없으면 저쪽 화면은
    // 새로고침해야 알았다(제보의 뿌리).
    await user.click(await screen.findByRole('button', { name: '계정 메뉴' }));
    await user.click(await screen.findByText('설정'));
    const btn = await waitFor(() => {
      const el = document.querySelector('[data-google-reconnect]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    await user.click(btn);
    await waitFor(() => expect(screen.getAllByText(/구글 회의/).length).toBeGreaterThan(0));
  });

  it('보기 전용으로 공유된 캘린더의 일정은 고칠 수 없다고 말한다', async () => {
    seed({ calendars: [SHARED_ID] });
    seedToken();
    stubGis();
    stubFetch();
    clientId = 'test-client.apps.googleusercontent.com';
    const user = userEvent.setup();
    const { container } = renderHome();
    const pop = await openGoogleChip(container, user, /남의 회의/);
    expect(within(pop).getByText(/쓸 권한이 없어요/)).toBeTruthy();
    expect(pop.querySelector('[data-event-delete]')).toBeNull();
    expect(pop.querySelector<HTMLTextAreaElement>('[data-event-title]')?.readOnly).toBe(true);
    expect(pop.querySelector('[data-google-open]')?.getAttribute('href')).toBe('https://calendar.google.com/s');
    // 우리 편집 팝업(칸반 카드)은 열리지 않는다
    expect(document.querySelector('[data-cal-detail]')).toBeNull();
  });

  it('연동을 켜 두어도 설정을 열기 전에는 아무 요청도 하지 않는다 — 조회는 공짜가 아니다', async () => {
    seed({ calendars: ['me@example.com'] });
    seedToken();
    stubGis();
    const f = stubFetch();
    clientId = 'test-client.apps.googleusercontent.com';
    renderHome();
    await screen.findByRole('button', { name: '계정 메뉴' });
    // 홈(스페이스 화면)은 달력을 그리지 않는다 — 캘린더 목록도 일정도 받지 않는다
    await new Promise((r) => setTimeout(r, 60));
    expect(f.mock.calls.filter(([u]) => String(u).includes('googleapis.com')).length).toBe(0);
  });

  it('블롭에는 고른 캘린더만 남는다 — "켰는가"는 키의 존재가 말한다', async () => {
    seed();
    stubGis();
    stubFetch();
    clientId = 'test-client.apps.googleusercontent.com';
    const user = userEvent.setup();
    renderHome();
    await user.click(await screen.findByRole('button', { name: '계정 메뉴' }));
    await user.click(await screen.findByText('설정'));
    await user.click(await waitFor(() => document.querySelector('[data-google-connect]') as HTMLElement));
    await waitFor(() => {
      const ws = JSON.parse(localStorage.getItem('mf_spaces') ?? '{}') as { google?: Record<string, unknown> };
      expect(ws.google).toBeTruthy();
      expect(Object.keys(ws.google!)).toEqual(['calendars']);
    });
  });

  it('연동 전에는 일정 화면 머리에 연동 아이콘이 뜨고, 누르면 곧바로 동의 창이다(요청)', async () => {
    seed();
    const gis = stubGis();
    stubFetch();
    clientId = 'test-client.apps.googleusercontent.com';
    const user = userEvent.setup();
    const { container } = renderHome();
    await openCalendar(container, user);
    const btn = await waitFor(() => {
      const el = document.querySelector('[data-google-connect-cal]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    await user.click(btn);
    expect(gis.requested).toEqual(['consent']);
    // 켜고 나면 할 일이 끝났으므로 아이콘은 사라진다(세부 조정은 설정이 맡는다)
    await waitFor(() => expect(document.querySelector('[data-google-connect-cal]')).toBeNull());
  });

  it('클라이언트 ID가 없으면 연동 아이콘도 없다 — 눌러도 아무 일 없는 버튼을 두지 않는다', async () => {
    seed();
    const user = userEvent.setup();
    const { container } = renderHome();
    await openCalendar(container, user);
    expect(document.querySelector('[data-google-connect-cal]')).toBeNull();
  });

  it('연결을 해제하면 설정이 지워지고 토큰도 버린다', async () => {
    seed({ calendars: ['me@example.com'] });
    seedToken();
    stubGis();
    stubFetch();
    clientId = 'test-client.apps.googleusercontent.com';
    const user = userEvent.setup();
    renderHome();
    await user.click(await screen.findByRole('button', { name: '계정 메뉴' }));
    await user.click(await screen.findByText('설정'));
    const btn = await waitFor(() => {
      const el = document.querySelector('[data-google-disconnect]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    await user.click(btn);
    await waitFor(() => expect(document.querySelector('[data-google-connect]')).toBeTruthy());
    await waitFor(() => {
      const ws = JSON.parse(localStorage.getItem('mf_spaces') ?? '{}') as { google?: unknown };
      expect(ws.google).toBeUndefined();
    });
    expect(sessionStorage.getItem('mf_gcal_token')).toBeNull();
  });

  it('새 일정을 구글에 저장한다 — 목적지를 고르면 그 캘린더에 POST', async () => {
    seed({ calendars: ['me@example.com'] });
    seedToken();
    stubGis();
    const f = stubFetch();
    clientId = 'test-client.apps.googleusercontent.com';
    const user = userEvent.setup();
    const { container } = renderHome();
    await openCalendar(container, user);
    // 목록이 도착해야 목적지가 생긴다(쓸 수 있는 캘린더만 오른다)
    await waitFor(() => expect(screen.getAllByText(/구글 회의/).length).toBeGreaterThan(0));
    await user.click(screen.getByText('새 일정'));
    const dlg = await waitFor(() => {
      const el = document.querySelector('[data-new-event]') ?? document.querySelector('[role="dialog"]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    await user.type(within(dlg).getByLabelText('일정 제목'), '팀 회의');
    // 보기 전용 캘린더는 목적지에 없다 — 고를 수 있는 것은 Geurio와 내 캘린더뿐
    expect(dlg.querySelector(`[data-new-cal="${SHARED_ID}"]`)).toBeNull();
    const target = dlg.querySelector<HTMLElement>('[data-new-cal="me@example.com"]');
    expect(target).toBeTruthy();
    await user.click(target!);
    await user.click(within(dlg).getByText('등록'));
    await waitFor(() => {
      const post = f.mock.calls.find((c) => (c[1] as { method?: string } | undefined)?.method === 'POST');
      expect(post).toBeTruthy();
      expect(String(post![0])).toContain(`/calendars/${encodeURIComponent('me@example.com')}/events`);
      expect(JSON.parse((post![1] as { body: string }).body)).toMatchObject({ summary: '팀 회의' });
    });
    // 우리 표에는 남지 않는다 — 구글이 정본이다
    expect(localStorage.getItem('mf_events')).toBeNull();
  });

  it('구글 목적지가 없으면 고르기를 그리지 않는다 — 배지 하나만', async () => {
    seed();
    clientId = 'test-client.apps.googleusercontent.com';
    const user = userEvent.setup();
    const { container } = renderHome();
    await openCalendar(container, user);
    await user.click(screen.getByText('새 일정'));
    await waitFor(() => expect(document.querySelector('[data-new-cal]')).toBeTruthy());
    expect(document.querySelectorAll('[data-new-cal]').length).toBe(1);
    expect(document.querySelector('[data-new-cal="geurio"]')).toBeNull();
  });

  it('읽기 권한만 승인돼 있으면 "다시 연결"을 권한다 — 쓰기가 조용히 죽지 않게', async () => {
    seed({ calendars: ['me@example.com'] });
    // 옛 배포의 **읽기 전용** 토큰이 남아 있다 — `readStoredToken`이 없는 것으로 보고,
    // 화면은 새로 요청하는 대신(팝업 금지) "다시 연결"을 권한다.
    seedToken('https://www.googleapis.com/auth/calendar.readonly');
    stubGis('https://www.googleapis.com/auth/calendar.readonly');
    stubFetch();
    clientId = 'test-client.apps.googleusercontent.com';
    const user = userEvent.setup();
    const { container } = renderHome();
    await openCalendar(container, user);
    // 머리의 연동 아이콘이 다시 뜬다(정상 연동이면 사라져 있다)
    await waitFor(() => {
      const btn = container.querySelector('[data-google-connect-cal]');
      expect(btn?.getAttribute('aria-label')).toBe('Google 캘린더 다시 연결');
    });
  });

  it('목적지가 구글이면 참석자·회의실·알림 필드가 오른쪽 열로 뜬다 — 반복은 두 목적지 공통', async () => {
    seed({ calendars: ['me@example.com'] });
    seedToken();
    stubGis();
    stubFetch();
    clientId = 'test-client.apps.googleusercontent.com';
    const user = userEvent.setup();
    const { container } = renderHome();
    await openCalendar(container, user);
    await waitFor(() => expect(screen.getAllByText(/구글 회의/).length).toBeGreaterThan(0));
    await user.click(screen.getByText('새 일정'));
    await waitFor(() => expect(document.querySelector('[data-new-cal="me@example.com"]')).toBeTruthy());

    // 기본 목적지는 우리 표 — 구글 전용 필드는 뜨지 않지만 **반복은 뜬다**(둘 다 저장한다).
    expect(document.querySelector('[data-google-fields]')).toBeNull();
    expect(document.querySelector('[data-new-google-col]')).toBeNull();
    expect(document.querySelector('[data-recurrence]')).toBeTruthy();
    // 알림도 늘 보인다(요청 #5) — 다만 Geurio에는 알림을 띄울 장치가 없어 비활성 표식이다.
    expect(document.querySelector('[data-gf-remind-off]')).toBeTruthy();
    expect(document.querySelector('[data-gf-remind]')).toBeNull();

    await user.click(document.querySelector<HTMLElement>('[data-new-cal="me@example.com"]')!);
    const fields = await waitFor(() => {
      const el = document.querySelector('[data-google-fields]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    // 구글 전용 필드는 **오른쪽 열** 안에 있다(원본의 두 열 구조 — 아래가 아니다).
    const col = document.querySelector('[data-new-google-col]');
    expect(col).toBeTruthy();
    expect(col!.contains(fields)).toBe(true);
    // 반복은 오른쪽 열이 아니라 **왼쪽 열**(일정 자체를 다루는 자리)에 남는다.
    expect(col!.querySelector('[data-recurrence]')).toBeNull();
    expect(document.querySelector('[data-new-main]')!.querySelector('[data-recurrence]')).toBeTruthy();
    // 디자인 원본의 nIsGoogle 블록 — Meet·참석자·회의실·공개·참여
    for (const sel of ['[data-gf-meet]', '[data-gf-guest-input]', '[data-gf-vis]', '[data-gf-busy]']) {
      expect(fields.querySelector(sel)).toBeTruthy();
    }
    // 알림은 **왼쪽 열**에 남아 고칠 수 있게 된다(요청 #5) — 오른쪽 열이 아니다.
    expect(col!.querySelector('[data-gf-remind]')).toBeNull();
    expect(document.querySelector('[data-new-main]')!.querySelector('[data-gf-remind]')).toBeTruthy();
    expect(document.querySelector('[data-gf-remind-off]')).toBeNull();
    // 회의실 구획은 목록이 **도착한 뒤에야** 그려진다(깜빡임 방지) — 그래서 기다린다.
    await waitFor(() => expect(fields.querySelector('[data-gf-room-input]')).toBeTruthy());
    // Meet는 원본의 토글 카드다 — 상태 문구와 스위치(aria-pressed)로 말한다.
    const meet = fields.querySelector('[data-gf-meet]') as HTMLElement;
    expect(meet.textContent).toContain('Google Meet 꺼짐');
    expect(meet.getAttribute('aria-pressed')).toBe('false');
  });

  it('이름으로 사람을 찾아 참석자로 넣는다(선택 스코프)', async () => {
    seed({ calendars: ['me@example.com'] });
    seedToken();
    stubGis();
    stubFetch();
    clientId = 'test-client.apps.googleusercontent.com';
    const user = userEvent.setup();
    const { container } = renderHome();
    await openCalendar(container, user);
    await waitFor(() => expect(screen.getAllByText(/구글 회의/).length).toBeGreaterThan(0));
    await user.click(screen.getByText('새 일정'));
    await waitFor(() => expect(document.querySelector('[data-new-cal="me@example.com"]')).toBeTruthy());
    await user.click(document.querySelector<HTMLElement>('[data-new-cal="me@example.com"]')!);
    await waitFor(() => expect(document.querySelector('[data-gf-guest-input]')).toBeTruthy());

    // 이름 검색이 열려 있으면 라벨이 이메일 전용이 아니다
    expect(screen.getByLabelText('참석자 이름 또는 이메일')).toBeTruthy();
    await user.type(screen.getByLabelText('참석자 이름 또는 이메일'), '여은');
    const hit = await waitFor(() => {
      const el = document.querySelector('[data-gf-guest-hit="eunjin@example.com"]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    // 후보에 **이름과 이메일이 함께** 보인다(스크린샷의 그 모습) + 우측 `초대` 액션
    expect(hit.textContent).toContain('여은진');
    expect(hit.textContent).toContain('eunjin@example.com');
    expect(hit.textContent).toContain('초대');
    fireEvent.mouseDown(hit);
    await waitFor(() => expect(document.querySelector('[data-gf-guest="eunjin@example.com"]')).toBeTruthy());
  });

  it('회의실을 검색해 예약한다 — 구글에서는 참석자(resource)로 저장된다', async () => {
    seed({ calendars: ['me@example.com'] });
    seedToken();
    stubGis();
    const f = stubFetch();
    clientId = 'test-client.apps.googleusercontent.com';
    const user = userEvent.setup();
    const { container } = renderHome();
    await openCalendar(container, user);
    await waitFor(() => expect(screen.getAllByText(/구글 회의/).length).toBeGreaterThan(0));
    await user.click(screen.getByText('새 일정'));
    await waitFor(() => expect(document.querySelector('[data-new-cal="me@example.com"]')).toBeTruthy());
    await user.type(screen.getByLabelText('일정 제목'), '주간 회의');
    await user.click(document.querySelector<HTMLElement>('[data-new-cal="me@example.com"]')!);
    await waitFor(() => expect(document.querySelector('[data-gf-room-input]')).toBeTruthy());

    await user.type(screen.getByLabelText('회의실 검색'), '35');
    const room = await waitFor(() => {
      const el = document.querySelector('[data-gf-room-hit]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    expect(room.textContent).toContain('회의실-35-01');
    fireEvent.mouseDown(room);
    await waitFor(() => expect(document.querySelector('[data-gf-room]')).toBeTruthy());

    await user.click(screen.getByText('등록', { exact: true }));
    await waitFor(() => {
      const post = f.mock.calls.find((c) => (c[1] as { method?: string } | undefined)?.method === 'POST');
      expect(post).toBeTruthy();
      const body = JSON.parse((post![1] as { body: string }).body) as { attendees: { email: string; resource?: boolean }[] };
      // 회의실은 `resource: true`인 참석자다 — 사람과 같은 배열에 실린다
      expect(body.attendees).toEqual([{ email: 'room-35-01@resource.calendar.google.com', resource: true }]);
    });
  });

  it('참석자 후보는 팝업 안 상자가 아니라 입력 곁의 툴팁이다 — 팝업이 길어지지 않는다(제보 #7)', async () => {
    seed({ calendars: ['me@example.com'] });
    seedToken();
    stubGis();
    stubFetch();
    clientId = 'test-client.apps.googleusercontent.com';
    const user = userEvent.setup();
    const { container } = renderHome();
    await openCalendar(container, user);
    await waitFor(() => expect(screen.getAllByText(/구글 회의/).length).toBeGreaterThan(0));
    await user.click(screen.getByText('새 일정'));
    await waitFor(() => expect(document.querySelector('[data-new-cal="me@example.com"]')).toBeTruthy());
    await user.click(document.querySelector<HTMLElement>('[data-new-cal="me@example.com"]')!);
    await waitFor(() => expect(document.querySelector('[data-gf-guest-input]')).toBeTruthy());
    await user.type(screen.getByLabelText('참석자 이름 또는 이메일'), '여은');
    const hits = await waitFor(() => {
      const el = document.querySelector('[data-gf-guest-hits]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    // body 포털의 fixed 층 — 카드 흐름 안에 있으면 후보가 뜰 때마다 팝업이 자랐다.
    expect(hits.style.position).toBe('fixed');
    expect(document.querySelector('[data-new-event]')!.contains(hits)).toBe(false);
  });

  it('회의실 상자는 높이가 고정이다 — 검색으로 목록이 줄어도 상자가 오르내리지 않는다(제보 #8)', async () => {
    seed({ calendars: ['me@example.com'] });
    seedToken();
    stubGis();
    stubFetch();
    clientId = 'test-client.apps.googleusercontent.com';
    const user = userEvent.setup();
    const { container } = renderHome();
    await openCalendar(container, user);
    await waitFor(() => expect(screen.getAllByText(/구글 회의/).length).toBeGreaterThan(0));
    await user.click(screen.getByText('새 일정'));
    await waitFor(() => expect(document.querySelector('[data-new-cal="me@example.com"]')).toBeTruthy());
    await user.click(document.querySelector<HTMLElement>('[data-new-cal="me@example.com"]')!);
    await waitFor(() => expect(document.querySelector('[data-gf-room-list]')).toBeTruthy());
    const h = (document.querySelector('[data-gf-room-list]') as HTMLElement).style.height;
    expect(h).not.toBe(''); // maxHeight가 아니라 **height** — 결과 수와 무관하게 같은 상자
    await user.type(screen.getByLabelText('회의실 검색'), '없는회의실');
    expect((document.querySelector('[data-gf-room-list]') as HTMLElement).style.height).toBe(h);
  });

  it('새 일정 카드에 인라인 width transition을 두지 않는다 — 폭·높이 전이는 morph 훅의 실측이 맡는다(제보 #6)', async () => {
    // CSS transition이 폭을 맡으면 목적지를 구글로 바꾸는 순간 ResizeObserver가
    // **아직 좁은(두 열이 짜부라진) 상태의 높이**를 목표로 재서, 크게 늘었다가
    // 줄어드는 리사이즈로 보였다(제보: "100까지 늘어났다가 90으로").
    seed();
    clientId = 'test-client.apps.googleusercontent.com';
    const user = userEvent.setup();
    const { container } = renderHome();
    await openCalendar(container, user);
    await user.click(screen.getByText('새 일정'));
    const card = await waitFor(() => {
      const el = document.querySelector('[data-new-event]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    expect(card.style.transition).toBe('');
  });

  it('회의실 목록을 못 받으면(403) 구획은 남고 안내 한 줄이 된다 — 검색 상자만 없다(요청: 상시 노출)', async () => {
    seed({ calendars: ['me@example.com'] });
    seedToken();
    stubGis();
    stubFetch();
    // Admin SDK만 거절하는 서버(API 미사용·관리자 승인 필요) — 나머지는 그대로.
    const inner = global.fetch;
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (String(url).includes('admin.googleapis.com')) return { ok: false, status: 403, json: async () => ({}) } as unknown as Response;
      return (inner as (u: string, i?: RequestInit) => Promise<Response>)(url, init);
    });
    clientId = 'test-client.apps.googleusercontent.com';
    const user = userEvent.setup();
    const { container } = renderHome();
    await openCalendar(container, user);
    await waitFor(() => expect(screen.getAllByText(/구글 회의/).length).toBeGreaterThan(0));
    await user.click(screen.getByText('새 일정'));
    await waitFor(() => expect(document.querySelector('[data-new-cal="me@example.com"]')).toBeTruthy());
    await user.click(document.querySelector<HTMLElement>('[data-new-cal="me@example.com"]')!);
    await waitFor(() => expect(document.querySelector('[data-gf-guest-input]')).toBeTruthy());

    // 목록 요청이 끝날 시간을 주고 — 구획은 남되 **안내 한 줄**이 되고(요청: 굳이
    // 비노출할 필요 없다), 결과가 영영 비는 검색 상자는 두지 않는다.
    await waitFor(() => expect(document.querySelector('[data-gf-room-note]')?.textContent).toContain('조직 캘린더에서 불러와요'));
    expect(document.querySelector('[data-gf-room-input]')).toBeNull();
    expect(screen.getByText('회의실')).toBeTruthy();
    // 나머지 구글 필드는 그대로다(이름 검색 포함 — 사람 검색 스코프는 살아 있다).
    expect(document.querySelector('[data-gf-meet]')).toBeTruthy();
    expect(screen.getByLabelText('참석자 이름 또는 이메일')).toBeTruthy();
  });

  it('선택 스코프가 없으면 이름 검색·회의실이 빠진다 — 이메일 입력으로 남는다', async () => {
    seed({ calendars: ['me@example.com'] });
    // 구글이 **필수 스코프만** 승인한 토큰(개인 계정·조직이 막은 경우)
    seedToken(GOOGLE_SCOPE_REQUIRED.join(' '));
    stubGis(GOOGLE_SCOPE_REQUIRED.join(' '));
    stubFetch();
    clientId = 'test-client.apps.googleusercontent.com';
    const user = userEvent.setup();
    const { container } = renderHome();
    await openCalendar(container, user);
    await waitFor(() => expect(screen.getAllByText(/구글 회의/).length).toBeGreaterThan(0));
    await user.click(screen.getByText('새 일정'));
    await waitFor(() => expect(document.querySelector('[data-new-cal="me@example.com"]')).toBeTruthy());
    await user.click(document.querySelector<HTMLElement>('[data-new-cal="me@example.com"]')!);
    const fields = await waitFor(() => {
      const el = document.querySelector('[data-google-fields]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    // 연동 자체는 그대로 살아 있다(필수만 있어도 만들고 고칠 수 있다)
    expect(fields.querySelector('[data-gf-guest-input]')).toBeTruthy();
    // 이름 검색은 없다 — 라벨이 이메일 전용이다
    expect(screen.getByLabelText('참석자 이메일')).toBeTruthy();
    // 회의실은 안내 한 줄로 남는다 — 검색 상자는 없다(결과가 영영 비는 상자 금지)
    expect(fields.querySelector('[data-gf-room-input]')).toBeNull();
    expect(fields.querySelector('[data-gf-room-note]')?.textContent).toContain('조직 캘린더에서 불러와요');
  });

  it('구글 목적지의 참석자·반복·알림이 POST 본문에 실린다', async () => {
    seed({ calendars: ['me@example.com'] });
    seedToken();
    stubGis();
    const f = stubFetch();
    clientId = 'test-client.apps.googleusercontent.com';
    const user = userEvent.setup();
    const { container } = renderHome();
    await openCalendar(container, user);
    await waitFor(() => expect(screen.getAllByText(/구글 회의/).length).toBeGreaterThan(0));
    await user.click(screen.getByText('새 일정'));
    await waitFor(() => expect(document.querySelector('[data-new-cal="me@example.com"]')).toBeTruthy());
    await user.type(screen.getByLabelText('일정 제목'), '팀 회의');
    await user.click(document.querySelector<HTMLElement>('[data-new-cal="me@example.com"]')!);
    await waitFor(() => expect(document.querySelector('[data-gf-guest-input]')).toBeTruthy());

    await user.type(screen.getByLabelText('참석자 이름 또는 이메일'), 'a@b.com{Enter}');
    await user.click(document.querySelector<HTMLElement>('[data-gf-remind="10"]')!);
    await user.click(document.querySelector<HTMLElement>('[data-gf-vis="private"]')!);
    // 반복은 왼쪽 열의 프리셋 다섯 칸에서 고른다(`매주` = FREQ=WEEKLY).
    await user.click(document.querySelector<HTMLElement>('[data-rep-preset="weekly"]')!);
    await waitFor(() => expect(document.querySelector('[data-rep-summary]')).toBeTruthy());

    await user.click(screen.getByText('등록', { exact: true }));
    await waitFor(() => {
      const post = f.mock.calls.find((c) => (c[1] as { method?: string } | undefined)?.method === 'POST');
      expect(post).toBeTruthy();
      const body = JSON.parse((post![1] as { body: string }).body) as Record<string, unknown>;
      expect(body.attendees).toEqual([{ email: 'a@b.com' }]);
      expect(body.visibility).toBe('private');
      expect(body.reminders).toMatchObject({ useDefault: false, overrides: [{ minutes: 10 }] });
      expect(body.recurrence).toEqual(['RRULE:FREQ=WEEKLY']);
    });
  });

  it('연동이 켜져 있는데 토큰이 없으면(재로그인 뒤) 구글 팝업을 열지 않고 "다시 연결"을 권한다(제보)', async () => {
    // 재로그인한 탭의 상태 그대로 — 블롭에는 연동이 켜져 있지만 sessionStorage 토큰이 없다.
    seed({ calendars: ['me@example.com'] });
    const gis = stubGis();
    stubFetch();
    clientId = 'test-client.apps.googleusercontent.com';
    const user = userEvent.setup();
    const { container } = renderHome();
    await openCalendar(container, user);
    // 다시 연결 버튼이 뜬다 — 화면을 여는 것만으로는 GIS 요청이 **한 번도** 나가지 않는다
    // (조용한 갱신도 팝업 창을 연다 — 그게 제보의 "로그인 팝업"이었다).
    await waitFor(() => {
      const btn = container.querySelector('[data-google-connect-cal]');
      expect(btn?.getAttribute('aria-label')).toBe('Google 캘린더 다시 연결');
    });
    expect(gis.requested).toEqual([]);
    // 누르는 것은 사용자 제스처다 — 그때만 동의 창이 뜨고 달력이 채워진다.
    await user.click(container.querySelector('[data-google-connect-cal]') as HTMLElement);
    expect(gis.requested).toEqual(['consent']);
    await waitFor(() => expect(screen.getAllByText(/구글 회의/).length).toBeGreaterThan(0));
  });

  it('연결을 끊고 다른 계정으로 다시 연결하면 이전 계정의 회의실이 남지 않는다(제보)', async () => {
    seed({ calendars: ['me@example.com'] });
    seedToken();
    stubGis();
    stubFetch();
    clientId = 'test-client.apps.googleusercontent.com';
    const user = userEvent.setup();
    const { container } = renderHome();
    await openCalendar(container, user);
    await waitFor(() => expect(screen.getAllByText(/구글 회의/).length).toBeGreaterThan(0));
    // A 계정: 새 일정에서 구글 목적지를 고르면 회의실 목록이 뜬다.
    await user.click(screen.getByText('새 일정'));
    await waitFor(() => expect(document.querySelector('[data-new-cal="me@example.com"]')).toBeTruthy());
    await user.click(document.querySelector<HTMLElement>('[data-new-cal="me@example.com"]')!);
    await waitFor(() => expect(document.querySelector('[data-gf-room-hit="room-35-01@resource.calendar.google.com"]')).toBeTruthy());
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(document.querySelector('[data-new-event],[data-google-fields]')).toBeNull());

    // 연동 해제 — 계정에 딸린 캐시(회의실·스코프)도 함께 버려진다.
    await user.click(await screen.findByRole('button', { name: '계정 메뉴' }));
    await user.click(await screen.findByText('설정'));
    const off = await waitFor(() => {
      const el = document.querySelector('[data-google-disconnect]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    await user.click(off);
    await waitFor(() => expect(document.querySelector('[data-google-connect]')).toBeTruthy());

    // B 계정(회의실이 없는 조직)으로 다시 연결 — Admin SDK가 빈 목록을 준다.
    const inner = global.fetch;
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (String(url).includes('admin.googleapis.com')) return { ok: true, status: 200, json: async () => ({ items: [] }) } as unknown as Response;
      return (inner as (u: string, i?: RequestInit) => Promise<Response>)(url, init);
    });
    await user.click(document.querySelector('[data-google-connect]') as HTMLElement);
    await waitFor(() => expect(document.querySelector('[data-google-cal="me@example.com"]')).toBeTruthy());
    fireEvent.keyDown(document, { key: 'Escape' });

    // 새 일정의 회의실 구획에 A의 회의실이 **남아 있지 않다** — 안내 한 줄뿐.
    await user.click(screen.getByText('새 일정'));
    await waitFor(() => expect(document.querySelector('[data-new-cal="me@example.com"]')).toBeTruthy());
    await user.click(document.querySelector<HTMLElement>('[data-new-cal="me@example.com"]')!);
    await waitFor(() => expect(document.querySelector('[data-google-fields]')).toBeTruthy());
    await waitFor(() => expect(document.querySelector('[data-gf-room-note]')).toBeTruthy());
    expect(document.querySelector('[data-gf-room-hit="room-35-01@resource.calendar.google.com"]')).toBeNull();
    expect(document.querySelector('[data-gf-room-input]')).toBeNull();
  });

  /** 새 일정을 열고 목적지를 구글로 바꿔 구글 전용 필드를 띄운다(여러 테스트의 앞머리). */
  async function openGoogleDraft(user: ReturnType<typeof userEvent.setup>, container: HTMLElement): Promise<void> {
    await openCalendar(container, user);
    await waitFor(() => expect(screen.getAllByText(/구글 회의/).length).toBeGreaterThan(0));
    await user.click(screen.getByText('새 일정'));
    await waitFor(() => expect(document.querySelector('[data-new-cal="me@example.com"]')).toBeTruthy());
    await user.click(document.querySelector<HTMLElement>('[data-new-cal="me@example.com"]')!);
    await waitFor(() => expect(document.querySelector('[data-google-fields]')).toBeTruthy());
  }

  it('초대가 셋이면 두 줄만 보이고 나머지는 `외 N명` 툴팁에서 지운다(제보 #6)', async () => {
    seed({ calendars: ['me@example.com'] });
    seedToken();
    stubGis();
    stubFetch();
    clientId = 'test-client.apps.googleusercontent.com';
    const user = userEvent.setup();
    const { container } = renderHome();
    await openGoogleDraft(user, container);

    const input = screen.getByLabelText('참석자 이름 또는 이메일');
    for (const email of ['a@example.com', 'b@example.com', 'c@example.com']) {
      await user.type(input, `${email}{Enter}`);
    }
    // 두 줄 + `외 1명` — 초대가 늘어도 팝업이 그만큼 길어지지 않는다.
    await waitFor(() => expect(document.querySelectorAll('[data-gf-guest]').length).toBe(2));
    const more = document.querySelector('[data-gf-guest-more]') as HTMLElement;
    expect(more).toBeTruthy();
    expect(more.textContent).toContain('외 1명');

    // 접힌 목록은 툴팁으로 뜨고 **거기서 지울 수 있다**.
    await user.click(more);
    await waitFor(() => expect(document.querySelector('[data-gf-guest-list]')).toBeTruthy());
    expect(document.querySelectorAll('[data-gf-guest-item]').length).toBe(3);
    await user.click(screen.getByLabelText('c@example.com 초대 취소'));
    // 둘만 남으면 접을 것이 없다 — 접힌 줄도 툴팁도 사라진다.
    await waitFor(() => expect(document.querySelector('[data-gf-guest-more]')).toBeNull());
    expect(document.querySelectorAll('[data-gf-guest]').length).toBe(2);
    expect(document.querySelector('[data-gf-guest-list]')).toBeNull();
  });

  it('회의실은 세 줄까지 보이고 안내 문구를 두지 않는다 · 예약한 것이 맨 위로 온다(제보 #4·#17)', async () => {
    seed({ calendars: ['me@example.com'] });
    seedToken();
    stubGis();
    stubFetch();
    clientId = 'test-client.apps.googleusercontent.com';
    const user = userEvent.setup();
    const { container } = renderHome();
    await openGoogleDraft(user, container);
    await waitFor(() => expect(document.querySelector('[data-gf-room-input]')).toBeTruthy());

    // 목록이 있으면 라벨 옆 안내 문구를 두지 않는다 — 검색 상자와 목록이 이미 말한다.
    const roomField = document.querySelector('[data-gf-room-input]')!.closest('div')!.parentElement!;
    expect(roomField.textContent).not.toContain('조직 캘린더의 회의실을 골라');

    const order = (): string[] => [...document.querySelectorAll('[data-gf-room-hit]')].map((el) => el.getAttribute('data-gf-room-hit') ?? '');
    expect(order()[0]).toBe('room-35-01@resource.calendar.google.com');
    // 둘째 회의실을 예약하면 그 줄이 맨 위로 — 목록이 길어도 잡아 둔 것이 보인다.
    fireEvent.mouseDown(document.querySelector('[data-gf-room-hit="room-42-07@resource.calendar.google.com"]') as HTMLElement);
    await waitFor(() => expect(order()[0]).toBe('room-42-07@resource.calendar.google.com'));
  });

  it('머리 배지는 캘린더 이름이 아니라 `Google`이다 — 기본 캘린더 이름은 계정 이메일이다(제보 #11·#22)', async () => {
    seed({ calendars: ['me@example.com'] });
    seedToken();
    stubGis();
    stubFetch();
    clientId = 'test-client.apps.googleusercontent.com';
    const user = userEvent.setup();
    const { container } = renderHome();
    await openGoogleDraft(user, container);
    expect(document.querySelector('[data-new-cal-pill]')!.textContent).toBe('Google');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(document.querySelector('[data-new-event]')).toBeNull());

    // 이미 등록된 구글 일정도 같다 — 어느 캘린더인지는 "저장할 캘린더" 줄이 말한다.
    await user.click(screen.getAllByText(/구글 회의/)[0]!);
    const badge = await waitFor(() => {
      const el = document.querySelector('[data-event-badge]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    expect(badge.textContent).toBe('Google');
    expect(document.querySelector('[data-event-cal="me@example.com"]')!.textContent).toContain('내 캘린더');
  });

  it('구글 일정 상세도 구글 필드를 오른쪽 열에 놓는다 — 아래로 길어지지 않는다(제보 #16)', async () => {
    seed({ calendars: ['me@example.com'] });
    seedToken();
    stubGis();
    stubFetch();
    clientId = 'test-client.apps.googleusercontent.com';
    const user = userEvent.setup();
    const { container } = renderHome();
    await openCalendar(container, user);
    await waitFor(() => expect(screen.getAllByText(/구글 회의/).length).toBeGreaterThan(0));
    await user.click(screen.getAllByText(/구글 회의/)[0]!);

    const side = await waitFor(() => {
      const el = document.querySelector('[data-event-side]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    // 구글 전용 필드는 오른쪽 열 안이고, 본문 열에는 없다.
    expect(side.querySelector('[data-google-fields]')).toBeTruthy();
    expect(document.querySelector('[data-event-main]')!.querySelector('[data-google-fields]')).toBeNull();
    // 알림은 반대다 — 왼쪽 열의 늘 보이는 자리(요청 #5).
    expect(document.querySelector('[data-event-main]')!.querySelector('[data-gf-remind]')).toBeTruthy();
    expect(side.querySelector('[data-gf-remind]')).toBeNull();
    // 열이 붙으면 카드가 넓어진다(새 일정 팝업과 같은 900px).
    expect((document.querySelector('[data-event-detail]') as HTMLElement).style.width).toBe('900px');
  });
});

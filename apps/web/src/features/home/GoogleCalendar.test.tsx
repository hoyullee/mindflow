import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
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
function weekdayInMonth(): string {
  const now = new Date();
  for (const step of [2, 3, 4, 5, -2, -3, -4, -5, 1, -1]) {
    const d = new Date(now);
    d.setDate(d.getDate() + step);
    if (d.getMonth() === now.getMonth() && d.getDay() !== 0 && d.getDay() !== 6) return isoOf(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }
  return isoOf(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** GIS 토큰 클라이언트 흉내 — 누르면 곧바로 토큰을 준다. */
function stubGis(): { requested: string[] } {
  const requested: string[] = [];
  (window as unknown as { google: unknown }).google = {
    accounts: {
      oauth2: {
        initTokenClient: (cfg: { scope: string; prompt?: string; callback: (r: unknown) => void }) => ({
          requestAccessToken: () => {
            requested.push(cfg.prompt ?? '');
            cfg.callback({ access_token: 'tok', expires_in: 3600 });
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
  const f = vi.fn(async (url: string) => {
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
    if (url.includes('/users/me/calendarList')) {
      return ok({
        items: [
          { id: 'me@example.com', summary: '내 캘린더', primary: true, backgroundColor: '#4285f4' },
          { id: HOLIDAY_ID, summary: '대한민국의 휴일' },
        ],
      });
    }
    if (url.includes(encodeURIComponent(HOLIDAY_ID))) {
      return ok({ items: [{ id: 'h1', summary: '테스트 공휴일', start: { date: holiday }, end: { date: nextDay(holiday) } }] });
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
    // 목록이 뜨고 둘 다 켜져 있다(기본 + 공휴일)
    await waitFor(() => expect(document.querySelector('[data-google-cal="me@example.com"]')).toBeTruthy());
    const boxes = document.querySelectorAll<HTMLInputElement>('[data-google-cal] input');
    expect(boxes.length).toBe(2);
    expect([...boxes].every((b) => b.checked)).toBe(true);
    // 워크스페이스 블롭에 남는다(기기 간 동기화 — 토큰은 남지 않는다)
    await waitFor(() => {
      const ws = JSON.parse(localStorage.getItem('mf_spaces') ?? '{}') as { google?: { calendars: string[] } };
      expect(ws.google?.calendars).toContain('me@example.com');
    });
    expect(localStorage.getItem('mf_spaces')).not.toContain('tok');
    expect(sessionStorage.getItem('mf_gcal_token')).toContain('tok');
  });

  it('연동을 켜 두면 일정 화면에 구글 일정이 겹치고, 공휴일은 칩이 아니라 날짜 색이 된다', async () => {
    seed({ calendars: ['me@example.com', HOLIDAY_ID] });
    stubGis();
    stubFetch();
    clientId = 'test-client.apps.googleusercontent.com';
    const user = userEvent.setup();
    const { container } = renderHome();
    await openCalendar(container, user);
    // 구글 일정은 칩으로
    await waitFor(() => expect(screen.getAllByText(/구글 회의/).length).toBeGreaterThan(0));
    // 공휴일은 칩이 아니다 — 이름이 달력에 글자로 나오지 않는다
    expect(screen.queryByText('테스트 공휴일')).toBeNull();
    // 그 날 칸은 공휴일로 표시된다(일요일과 같은 색 규칙)
    // 공휴일 칸은 **일요일과 같은 색**이 된다(칩이 아니라 날짜 색 — PR1이 비워 둔 자리)
    const holidayCell = container.querySelector<HTMLElement>(`[data-day-cell="${weekdayInMonth()}"]`);
    expect(holidayCell).toBeTruthy();
    expect(holidayCell!.style.background).toBe('var(--mf-cal-sun)');
    // 연동 전에는 그 칸이 평일 색이었다 — 대조군은 공휴일이 아닌 다른 평일 칸
    const plain = [...container.querySelectorAll<HTMLElement>('[data-day-cell]')].find(
      (el) => el.style.background === 'var(--mf-card)',
    );
    expect(plain).toBeTruthy();
  });

  it('구글 일정을 누르면 읽기 전용 팝업 — 고칠 수 없다고 말하고 구글로 보낸다', async () => {
    seed({ calendars: ['me@example.com'] });
    stubGis();
    stubFetch();
    clientId = 'test-client.apps.googleusercontent.com';
    const user = userEvent.setup();
    const { container } = renderHome();
    await openCalendar(container, user);
    const chip = await waitFor(() => {
      const el = screen.getAllByText(/구글 회의/)[0];
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    await user.click(chip);
    const pop = await waitFor(() => {
      const el = document.querySelector('[data-google-detail]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    expect(within(pop).getByText(/고칠 수 없어요/)).toBeTruthy();
    expect(pop.querySelector('[data-google-open]')?.getAttribute('href')).toBe('https://calendar.google.com/x');
    // 우리 편집 팝업(칸반 카드·Geurio 일정)은 열리지 않는다
    expect(document.querySelector('[data-cal-detail]')).toBeNull();
  });

  it('연동을 켜 두어도 설정을 열기 전에는 아무 요청도 하지 않는다 — 조회는 공짜가 아니다', async () => {
    seed({ calendars: ['me@example.com'] });
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
});

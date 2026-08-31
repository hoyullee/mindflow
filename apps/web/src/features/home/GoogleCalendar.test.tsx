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

  it('쓸 수 있는 캘린더의 구글 일정은 그 자리에서 고친다 — 제목을 바꾸면 구글에 PATCH', async () => {
    seed({ calendars: ['me@example.com'] });
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
    await user.clear(title!);
    await user.type(title!, '이름 바꿈');
    title!.blur();
    await waitFor(() => {
      const patch = f.mock.calls.find((c) => (c[1] as { method?: string } | undefined)?.method === 'PATCH');
      expect(patch).toBeTruthy();
      expect(String(patch![0])).toContain('/events/g1');
      expect(JSON.parse((patch![1] as { body: string }).body)).toMatchObject({ summary: '이름 바꿈' });
    });
    // 삭제도 그 자리에서(구글로 보내는 링크는 그대로 남는다)
    expect(pop.querySelector('[data-event-delete]')).toBeTruthy();
    expect(pop.querySelector('[data-google-open]')?.getAttribute('href')).toBe('https://calendar.google.com/x');
  });

  it('보기 전용으로 공유된 캘린더의 일정은 고칠 수 없다고 말한다', async () => {
    seed({ calendars: [SHARED_ID] });
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

  it('새 일정을 구글에 저장한다 — 목적지를 고르면 그 캘린더에 POST', async () => {
    seed({ calendars: ['me@example.com'] });
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
    // 구글이 **읽기만** 승인한다(PR5의 옛 승인이 남은 상태·동의 화면에서 일부만 체크)
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
});

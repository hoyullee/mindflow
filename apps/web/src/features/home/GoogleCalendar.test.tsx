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
import { GOOGLE_CALENDAR_SCOPE, GOOGLE_SCOPE_DIRECTORY, GOOGLE_SCOPE_REQUIRED } from './calendar/googleCalendar';
import { clearGoogleSessionCache } from './calendar/useGoogleCalendar';

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
  // 한 탭이 곧 한 세션이다 — 테스트마다 새 탭이므로 앞 테스트가 남긴 기억을 지운다.
  clearGoogleSessionCache();
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
  localStorage.setItem('mf_gcal_token', JSON.stringify({ accessToken: 'tok', expiresAt: Date.now() + 3_600_000, scope }));
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
    // 연동 행은 **계정 설정** 화면에 있다(요청 — 프로필 설정에서 옮겨 Google 연동과 한 구획으로).
    await user.click(await screen.findByText('계정 설정'));
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
    // 연동 행은 **계정 설정** 화면에 있다(요청 — 프로필 설정에서 옮겨 Google 연동과 한 구획으로).
    await user.click(await screen.findByText('계정 설정'));
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
    // 토큰은 워크스페이스 블롭이 아니라 **기기 저장소의 제 키**에 산다(제보 ⑩ — 탭 저장소는 새 탭에서 풀렸다).
    expect(localStorage.getItem('mf_gcal_token')).toContain('tok');
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
    // 요청 — 그 링크는 **발치의 취소 왼쪽**에 선다(본문 끝이 아니다: 스크롤을 내려야
    // 보이면 "어디서 여는가"가 자리를 잃는다).
    const open = pop.querySelector('[data-google-open]')!;
    expect(open.getAttribute('href')).toBe('https://calendar.google.com/x');
    const cancel = pop.querySelector('[data-event-cancel]')!;
    expect(open.parentElement).toBe(cancel.parentElement);
    expect(open.compareDocumentPosition(cancel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
      // **바뀐 것만** 실린다(제보) — 제목을 고쳤는데 `start`가 따라가면, 구글이 그
      // 시각을 거절할 때(400 `Invalid start time.`) 제목 수정까지 통째로 막힌다.
      expect(Object.keys(JSON.parse((patch![1] as { body: string }).body))).toEqual(['summary']);
    });
    // 저장이 끝나면 팝업이 닫힌다 — 구글이 돌려준 값은 달을 다시 받아 그린다.
    await waitFor(() => expect(document.querySelector('[data-google-detail]')).toBeNull());
  });

  it('상세 팝업에서 일정 색을 고치면 PATCH에 colorId 하나만 실린다(요청 ⑤)', async () => {
    seed({ calendars: ['me@example.com'] });
    seedToken();
    stubGis();
    const f = stubFetch();
    clientId = 'test-client.apps.googleusercontent.com';
    const user = userEvent.setup();
    const { container } = renderHome();
    const pop = await openGoogleChip(container, user, /구글 회의/);
    // 팔레트는 **구글의 열한 색**이고 앞에 '기본 색'(지정 없음) 칸이 하나 더 붙는다.
    const swatches = pop.querySelectorAll('[data-event-color]');
    expect(swatches).toHaveLength(12);
    expect(pop.querySelector('[data-event-color="기본"]')).toBeTruthy();
    // 이름은 구글이 부르는 그 이름이다(hex에서 유도한 '빨강'이 아니다).
    expect(pop.querySelector('[data-event-color="#d50000"]')?.getAttribute('aria-label')).toBe('토마토');
    await user.click(pop.querySelector<HTMLElement>('[data-event-color="#d50000"]')!);
    await user.click(pop.querySelector('[data-event-done]')!);
    await waitFor(() => {
      const patch = f.mock.calls.find((c) => (c[1] as { method?: string } | undefined)?.method === 'PATCH');
      expect(patch).toBeTruthy();
      const body = JSON.parse((patch![1] as { body: string }).body) as Record<string, unknown>;
      // 실은 것이 곧 바꿀 것이다 — 색만 고쳤으니 `colorId` 하나뿐이다.
      expect(Object.keys(body)).toEqual(['colorId']);
      expect(body.colorId).toBe('11');
    });
  });

  it('색 칸은 **구글 팔레트가 정하는 만큼** 뜬다 — 스물넷을 주면 스물넷이다(요청 ⑥)', async () => {
    seed({ calendars: ['me@example.com'] });
    seedToken();
    stubGis();
    const inner = stubFetch();
    // 구글이 넓힌 팔레트 — 번호 1~24. 앞의 열한 개는 우리가 이름을 알고, 나머지는
    // 이름을 hex에서 계산한다(글자 없는 동그라미에 접근 이름이 없으면 안 된다).
    const wide: Record<string, { background: string }> = {};
    const HEX = ['#7986cb', '#33b679', '#8e24aa', '#e67c73', '#f6bf26', '#f4511e', '#039be5', '#616161', '#3f51b5', '#0b8043', '#d50000', '#a79b8e', '#b26b3f', '#7a4fa3', '#c2185b', '#00897b', '#5d4037', '#455a64', '#9e9d24', '#ef6c00', '#6d4c41', '#00acc1', '#8d6e63', '#546e7a'];
    HEX.forEach((hex, i) => {
      wide[String(i + 1)] = { background: hex };
    });
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (String(url).includes('/colors')) return { ok: true, status: 200, json: async () => ({ event: wide }) } as unknown as Response;
      return (inner as unknown as (u: string, i?: RequestInit) => Promise<Response>)(url, init);
    });
    clientId = 'test-client.apps.googleusercontent.com';
    const user = userEvent.setup();
    const { container } = renderHome();
    const pop = await openGoogleChip(container, user, /구글 회의/);
    // 24색 + '기본 색' 칸 하나.
    await waitFor(() => expect(pop.querySelectorAll('[data-event-color]')).toHaveLength(25));
    // 아는 번호는 구글의 낱말, 모르는 번호도 **이름이 있다**(hex에서 계산).
    expect(pop.querySelector('[data-event-color="#d50000"]')?.getAttribute('aria-label')).toBe('토마토');
    const extra = pop.querySelector('[data-event-color="#00acc1"]');
    expect(extra).toBeTruthy();
    expect(extra!.getAttribute('aria-label')).toBeTruthy();
    expect(extra!.getAttribute('aria-label')).not.toBe('');
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

  it('저장 실패는 발치 한 곳에서만 말한다 — 본문 끝에 같은 문장을 두 번 두지 않는다(제보)', async () => {
    seed({ calendars: ['me@example.com'] });
    seedToken();
    stubGis();
    const inner = stubFetch();
    // 사람이 고친 판이 와서 진짜 충돌 — 덮지 않고 그대로 막는다(그 문장을 화면이 말한다).
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const method = (init?.method ?? 'GET') as string;
      if (method === 'PATCH') return { ok: false, status: 412, json: async () => ({}) } as unknown as Response;
      if (String(url).includes('/events/') && method === 'GET') {
        return { ok: true, status: 200, json: async () => ({ id: 'g1', etag: '"v9"', summary: '남이 고친 제목', start: { dateTime: `${inMonth(1)}T09:00:00+09:00` }, end: { dateTime: `${inMonth(1)}T10:00:00+09:00` } }) } as unknown as Response;
      }
      return (inner as unknown as (u: string, i?: RequestInit) => Promise<Response>)(url, init);
    });
    clientId = 'test-client.apps.googleusercontent.com';
    const user = userEvent.setup();
    const { container } = renderHome();
    await openCalendar(container, user);
    await waitFor(() => expect(screen.getAllByText(/구글 회의/).length).toBeGreaterThan(0));
    await user.click(screen.getAllByText(/구글 회의/)[0]!);
    await waitFor(() => expect(document.querySelector('[data-event-detail]')).toBeTruthy());

    await user.clear(screen.getByLabelText('일정 제목'));
    await user.type(screen.getByLabelText('일정 제목'), '내가 고친 제목');
    await user.click(screen.getByText('완료'));

    const foot = await waitFor(() => {
      const el = document.querySelector('[data-event-foot]') as HTMLElement;
      expect(el.textContent).toContain('그 사이 구글에서 이 값이 바뀌었어요');
      return el;
    });
    // 팝업 전체를 통틀어 **한 번만** 나온다.
    const card = document.querySelector('[data-event-detail]') as HTMLElement;
    const hits = [...card.querySelectorAll('*')].filter((el) => el.children.length === 0 && el.textContent?.includes('그 사이 구글에서 이 값이 바뀌었어요'));
    expect(hits).toEqual([foot]);
    vi.unstubAllGlobals();
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
    // 연동 행은 **계정 설정** 화면에 있다(요청 — 프로필 설정에서 옮겨 Google 연동과 한 구획으로).
    await user.click(await screen.findByText('계정 설정'));
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
    // 연동 행은 **계정 설정** 화면에 있다(요청 — 프로필 설정에서 옮겨 Google 연동과 한 구획으로).
    await user.click(await screen.findByText('계정 설정'));
    await user.click(await waitFor(() => document.querySelector('[data-google-connect]') as HTMLElement));
    await waitFor(() => {
      const ws = JSON.parse(localStorage.getItem('mf_spaces') ?? '{}') as { google?: Record<string, unknown> };
      expect(ws.google).toBeTruthy();
      expect(Object.keys(ws.google!)).toEqual(['calendars']);
    });
  });

  it('연동 전 일정 화면 머리의 버튼은 **무엇인지 말하고**, 누르면 구글 창이 아니라 설정을 연다(제보 ⑤)', async () => {
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
    // 아이콘만으로는 "달력 보기"로도 읽혔다 — 이제 구글 G 마크 + 글자다.
    expect(btn.getAttribute('aria-label')).toBe('Google 캘린더 연동');
    expect(btn.textContent).toContain('Google 캘린더');
    await user.click(btn);
    // 예고 없는 동의 창 대신 **설정 › 계정 설정 › 연동**이 열린다.
    expect(gis.requested).toEqual([]);
    await screen.findByRole('dialog', { name: '설정' });
    await waitFor(() => expect(document.querySelector('[data-google-section]')).toBeTruthy());
    expect(document.querySelector('[data-settings-link-group]')?.textContent).toBe('연동');
    // 거기서 연결하면 켜지고, 할 일이 끝났으므로 머리의 버튼은 사라진다.
    await user.click(within(document.querySelector('[data-google-section]') as HTMLElement).getByText('연결'));
    expect(gis.requested).toEqual(['consent']);
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
    // 연동 행은 **계정 설정** 화면에 있다(요청 — 프로필 설정에서 옮겨 Google 연동과 한 구획으로).
    await user.click(await screen.findByText('계정 설정'));
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
    // **왜**인지 툴팁이 말한다(제보: 배포되면 연동이 해제되는 것 같다) — 해제된 것이
    // 아니라 구글 권한이 한 시간마다 만료되는 것이고, 고른 캘린더는 그대로 남아 있다.
    expect(container.querySelector('[data-google-connect-cal]')?.getAttribute('title')).toContain('한 시간마다 만료');
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

  // 제보 — 등록·이미 등록된 참석자는 **이메일 한 줄**이라 같은 사람이 자리마다 달라
  // 보였다(후보 리스트는 아바타 + 이름 + 이메일). 구글이 돌려주는 참석자는 이메일뿐이니
  // 이름은 디렉터리에서 찾고, 못 찾으면 로컬파트를 이름 자리에 둔다.
  it('이미 등록된 참석자도 후보와 같은 꼴 — 아바타 + 이름 + 이메일', async () => {
    seed({ calendars: ['me@example.com'] });
    seedToken(`${GOOGLE_CALENDAR_SCOPE} ${GOOGLE_SCOPE_DIRECTORY}`);
    stubGis();
    const meeting = inMonth(1);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
        if (url.includes('people.googleapis.com')) {
          // 이메일로 물으면 그 사람을 돌려준다(디렉터리에 있는 사람만).
          const q = decodeURIComponent((url.match(/query=([^&]*)/) ?? [])[1] ?? '');
          return ok(q.includes('eunjin') ? { people: [{ names: [{ displayName: '여은진' }], emailAddresses: [{ value: 'eunjin@example.com' }] }] } : { people: [] });
        }
        if (url.includes('admin.googleapis.com')) return ok({ items: [] });
        if (url.includes('/users/me/calendarList')) return ok({ items: [{ id: 'me@example.com', summary: '내 캘린더', primary: true, accessRole: 'owner' }] });
        return ok({
          items: [
            {
              id: 'g1',
              summary: '구글 회의',
              htmlLink: 'https://calendar.google.com/x',
              start: { dateTime: `${meeting}T09:00:00+09:00` },
              end: { dateTime: `${meeting}T10:00:00+09:00` },
              attendees: [{ email: 'eunjin@example.com' }, { email: 'nobody@example.com' }],
            },
          ],
        });
      }),
    );
    clientId = 'test-client.apps.googleusercontent.com';
    const user = userEvent.setup();
    const { container } = renderHome();
    const pop = await openGoogleChip(container, user, /구글 회의/);

    // 디렉터리에 있는 사람 — 이름을 찾아 온다
    const known = await waitFor(() => {
      const el = pop.querySelector('[data-gf-guest="eunjin@example.com"]');
      expect(el?.textContent).toContain('여은진');
      return el as HTMLElement;
    });
    expect(known.textContent).toContain('eunjin@example.com');
    // 못 찾은 사람도 **같은 꼴**이다 — 이름 줄은 로컬파트, 이메일은 둘째 줄.
    const row = pop.querySelector('[data-gf-guest="nobody@example.com"]') as HTMLElement;
    expect([...(row.children[1] as HTMLElement).children].map((n) => n.textContent)).toEqual(['nobody', 'nobody@example.com']);
    expect(row.querySelector('span[aria-hidden]')?.textContent).toBe('N');
  });

  // 제보 — 일정 화면을 열어 둔 채 구글 캘린더에서 일정을 더해도 우리 달력은 그대로였다.
  // 구글이 정본이므로 다시 물어야 한다: 탭으로 **돌아오는 순간**이 그 계기다.
  it('열어 둔 채 구글에서 일정이 늘면, 탭으로 돌아올 때 잡아 온다', async () => {
    seed({ calendars: ['me@example.com'] });
    seedToken();
    stubGis();
    const meeting = inMonth(1);
    let extra = false;
    const ev = (id: string, title: string, h: number) => ({
      id,
      summary: title,
      htmlLink: `https://calendar.google.com/${id}`,
      start: { dateTime: `${meeting}T${String(h).padStart(2, '0')}:00:00+09:00` },
      end: { dateTime: `${meeting}T${String(h + 1).padStart(2, '0')}:00:00+09:00` },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
        if (url.includes('people.googleapis.com') || url.includes('admin.googleapis.com')) return ok({ items: [] });
        if (url.includes('/users/me/calendarList')) return ok({ items: [{ id: 'me@example.com', summary: '내 캘린더', primary: true, accessRole: 'owner' }] });
        return ok({ items: extra ? [ev('g1', '구글 회의', 9), ev('g2', '구글에서 방금 추가', 15)] : [ev('g1', '구글 회의', 9)] });
      }),
    );
    clientId = 'test-client.apps.googleusercontent.com';
    const user = userEvent.setup();
    const { container } = renderHome();
    await openCalendar(container, user);
    await waitFor(() => expect(screen.getAllByText(/구글 회의/).length).toBeGreaterThan(0));
    expect(screen.queryByText(/구글에서 방금 추가/)).toBeNull();

    // 구글 쪽에서 일정이 하나 늘었다 → 사용자가 이 탭으로 돌아온다
    extra = true;
    fireEvent(window, new Event('focus'));
    await waitFor(() => expect(screen.getAllByText(/구글에서 방금 추가/).length).toBeGreaterThan(0));
  });

  // 제보 ⑦ — 화면을 다시 열 때마다 구글 일정이 깜빡였다. 뿌리는 **세션 캐시를 지우는
  // 지점**이었다: 예전에는 "연동이 꺼졌다" 분기에서 곧바로 캐시를 비웠는데, 그 분기는
  // 홈이 늘 마운트해 두는 **설정 모달 인스턴스**(mode 'off')와 문서 위젯도 지나간다.
  // 즉 캐시가 계속 지워져 매번 처음부터 다시 받았다. 이제 **켜져 있던 것이 꺼질 때만**
  // 버린다 — 그래서 화면을 떠났다 돌아오면 기억한 일정이 **곧바로** 그려진다.
  it('초대받은 일정은 주최자와 참석 여부를 보여 준다 — 내 응답만 바뀌고 남의 응답은 그대로(요청 ③)', async () => {
    seed({ calendars: ['me@example.com'] });
    seedToken();
    stubGis();
    const day = inMonth(1);
    const call = vi.fn(async (url: string) => {
      const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
      if (url.includes('people.googleapis.com') || url.includes('admin.googleapis.com')) return ok({ items: [] });
      if (url.includes('/colors')) return ok({ event: {} });
      if (url.includes('/users/me/calendarList')) return ok({ items: [{ id: 'me@example.com', summary: '내 캘린더', primary: true, accessRole: 'owner' }] });
      return ok({
        items: [
          {
            id: 'inv',
            summary: '팀 회의',
            start: { dateTime: `${day}T09:00:00+09:00` },
            end: { dateTime: `${day}T10:00:00+09:00` },
            organizer: { email: 'boss@example.com', displayName: '팀장' },
            attendees: [
              { email: 'boss@example.com', displayName: '팀장', responseStatus: 'accepted' },
              { email: 'me@example.com', self: true, responseStatus: 'needsAction' },
              { email: 'mate@example.com', responseStatus: 'declined' },
            ],
          },
        ],
      });
    });
    // 다른 테스트의 `stubFetch`와 같은 꼴 — 기록된 호출의 `init`을 읽으려면 느슨한 mock이어야 한다.
    const f = call as unknown as ReturnType<typeof vi.fn>;
    vi.stubGlobal('fetch', f);
    clientId = 'test-client.apps.googleusercontent.com';
    const user = userEvent.setup();
    const { container } = renderHome();
    const pop = await openGoogleChip(container, user, /팀 회의/);

    // 누가 불렀는가 — 이름과 이메일이 함께(참석자 행과 같은 꼴)
    const org = pop.querySelector('[data-gf-organizer]')!;
    expect(org.textContent).toContain('팀장');
    expect(org.textContent).toContain('boss@example.com');
    // 제보 ⑤ — 구글이 준 이름을 쓴다(이메일 앞부분 `boss`로 떨어지지 않는다)
    expect(org.textContent).not.toContain('boss\n');
    // **일정을 만든 사람은 참석자 목록에 없다**(요청) — 머리가 "외 N명"으로 셈한다.
    expect(pop.querySelector('[data-gf-guest="boss@example.com"]')).toBeNull();
    expect(pop.querySelector('[data-gf-guest="mate@example.com"]')).toBeTruthy();
    expect(pop.textContent).toContain('일정을 만든 사람 외 2명 초대');
    // 아직 답하지 않았으면 **아무 칸도 켜지지 않는다** — 라벨 옆이 그렇게 말한다
    const rsvp = [...pop.querySelectorAll<HTMLElement>('[data-gf-rsvp]')];
    expect(rsvp.map((b) => b.textContent)).toEqual(['참석', '미정', '불참']);
    expect(rsvp.filter((b) => b.getAttribute('aria-checked') === 'true')).toHaveLength(0);
    expect(pop.querySelector('[data-gf-invite]')!.textContent).toContain('아직 응답하지 않았어요');

    await user.click(rsvp[0]!);
    await user.click(pop.querySelector('[data-event-done]')!);
    await waitFor(() => {
      const patch = f.mock.calls.find((c) => (c[1] as { method?: string } | undefined)?.method === 'PATCH');
      expect(patch).toBeTruthy();
      const body = JSON.parse((patch![1] as { body: string }).body) as Record<string, unknown>;
      // 참석자 배열 하나만 간다(구글은 이 배열로만 응답을 받는다)
      expect(Object.keys(body)).toEqual(['attendees']);
      expect(body.attendees).toEqual([
        { email: 'boss@example.com', responseStatus: 'accepted' },
        { email: 'me@example.com', responseStatus: 'accepted' },
        { email: 'mate@example.com', responseStatus: 'declined' },
      ]);
    });
  });

  it('내가 만든 일정에는 참석 여부를 묻지 않는다 — 주최자 줄도 없다', async () => {
    seed({ calendars: ['me@example.com'] });
    seedToken();
    stubGis();
    const day = inMonth(1);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
        if (url.includes('people.googleapis.com') || url.includes('admin.googleapis.com')) return ok({ items: [] });
        if (url.includes('/colors')) return ok({ event: {} });
        if (url.includes('/users/me/calendarList')) return ok({ items: [{ id: 'me@example.com', summary: '내 캘린더', primary: true, accessRole: 'owner' }] });
        return ok({ items: [{ id: 'own', summary: '내 회의', start: { dateTime: `${day}T09:00:00+09:00` }, end: { dateTime: `${day}T10:00:00+09:00` }, organizer: { email: 'me@example.com', self: true } }] });
      }),
    );
    clientId = 'test-client.apps.googleusercontent.com';
    const user = userEvent.setup();
    const { container } = renderHome();
    const pop = await openGoogleChip(container, user, /내 회의/);
    expect(pop.querySelector('[data-gf-invite]')).toBeNull();
    expect(pop.querySelector('[data-gf-rsvp]')).toBeNull();
    // 나머지 구글 필드는 그대로 있다(참석자·공개 설정 등)
    expect(pop.querySelector('[data-google-fields]')).toBeTruthy();
  });

  it('구글 일정 팝업에서 안내 문구를 두지 않는다(요청 ②)', async () => {
    seed({ calendars: ['me@example.com'] });
    seedToken();
    stubGis();
    stubFetch();
    clientId = 'test-client.apps.googleusercontent.com';
    const user = userEvent.setup();
    const { container } = renderHome();
    const pop = await openGoogleChip(container, user, /구글 회의/);
    // 늘 같은 말을 걸어 두면 정작 알려야 할 때 눈에 띌 자리가 없다(발치는 상황 문구용).
    for (const phrase of ['내 응답만 바뀌어요', '초대 메일은 구글이 보내요', '캘린더 기본 공개 설정을 따라요', 'Google 캘린더에 저장돼요', '반복 일정이에요']) {
      expect(pop.textContent).not.toContain(phrase);
    }
    expect(pop.querySelector('[data-gf-repeat-note]')).toBeNull();
  });

  it('위치에 적어 둔 주소는 지도에서 열 수 있다(요청 ④ — 자동완성은 Places API 몫)', async () => {
    seed({ calendars: ['me@example.com'] });
    seedToken();
    stubGis();
    stubFetch();
    clientId = 'test-client.apps.googleusercontent.com';
    const user = userEvent.setup();
    const { container } = renderHome();
    const pop = await openGoogleChip(container, user, /구글 회의/);
    // 비어 있으면 그리지 않는다 — 눌러도 아무 데도 못 가는 버튼을 두지 않는다.
    expect(pop.querySelector('[data-map-link]')).toBeNull();
    await user.type(pop.querySelector('[data-event-loc]') as HTMLInputElement, '서울시청');
    const link = await waitFor(() => {
      const el = pop.querySelector('[data-map-link]');
      expect(el).toBeTruthy();
      return el as HTMLAnchorElement;
    });
    expect(link.getAttribute('href')).toBe(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('서울시청')}`);
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('구글에서 일정에 지정한 색을 그대로 쓴다 — 시간 일정·종일·기간 모두(요청 ⑤)', async () => {
    seed({ calendars: ['me@example.com'] });
    seedToken();
    stubGis();
    const day = inMonth(1);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
        if (url.includes('people.googleapis.com') || url.includes('admin.googleapis.com')) return ok({ items: [] });
        // 팔레트는 `/colors`에서 온다 — 번호(colorId)를 hex로 풀어야 한다.
        if (url.includes('/colors')) return ok({ event: { '11': { background: '#d50000' }, '5': { background: '#f6bf26' } } });
        if (url.includes('/users/me/calendarList')) return ok({ items: [{ id: 'me@example.com', summary: '내 캘린더', primary: true, backgroundColor: '#4285f4', accessRole: 'owner' }] });
        return ok({
          items: [
            { id: 'g1', summary: '빨간 회의', colorId: '11', start: { dateTime: `${day}T09:00:00+09:00` }, end: { dateTime: `${day}T10:00:00+09:00` } },
            { id: 'g2', summary: '노란 종일', colorId: '5', start: { date: day }, end: { date: nextDay(day) } },
            { id: 'g3', summary: '색 없는 회의', start: { dateTime: `${day}T13:00:00+09:00` }, end: { dateTime: `${day}T14:00:00+09:00` } },
          ],
        });
      }),
    );
    clientId = 'test-client.apps.googleusercontent.com';
    const user = userEvent.setup();
    const { container } = renderHome();
    await openCalendar(container, user);
    const cell = await waitFor(() => {
      const el = container.querySelector<HTMLElement>(`[data-day-cell="${day}"]`);
      expect(el?.textContent).toContain('빨간 회의');
      return el as HTMLElement;
    });
    const markOf = (title: string) => {
      const chip = [...cell.querySelectorAll<HTMLElement>('[data-cal-chip]')].find((c) => c.textContent?.includes(title))!;
      return chip.querySelector<HTMLElement>('span[style*="border-radius"]')?.style.background ?? '';
    };
    // 시간 일정 — 그 일정에 지정한 색(막대)
    expect(markOf('빨간 회의')).toBe('rgb(213, 0, 0)');
    // 종일 일정 — 칩 면이 그 색에서 나온다(칩은 채운 면이라 표식이 없다)
    const allDay = [...cell.querySelectorAll<HTMLElement>('[data-cal-chip]')].find((c) => c.textContent?.includes('노란 종일'))!;
    expect(allDay.style.background).not.toBe('transparent');
    expect(allDay.querySelector('span[style*="border-radius"]')).toBeNull();
    // 색을 지정하지 않은 일정은 그 캘린더 색으로 남는다
    expect(markOf('색 없는 회의')).toBe('rgb(66, 133, 244)');
  });

  it('대시보드를 떠났다 돌아오면 구글 일정이 곧바로 그려진다 — 문서 위젯이 세션 캐시를 비우지 않는다(제보 ⑦)', async () => {
    // 제보: 대시보드 재진입마다 구글 일정이 깜빡였다. 원인은 **연동이 꺼진 것과
    // 아직 안 켜진 것을 같게 본 것** — 조회하지 않는 소비처(문서 위젯 `mode: 'off'`,
    // 닫힌 설정 모달)가 마운트할 때마다 탭의 세션 캐시를 통째로 비웠다. 그래서
    // 캘린더 위젯은 매번 처음부터 받아야 했고 그 사이 달력이 비었다.
    localStorage.setItem(
      'mf_spaces',
      JSON.stringify({
        spaces: [{ id: 's1', name: '업무', home: true, color: '#f0663f', maps: [], folders: [] }],
        activeSpace: 's1',
        mapFolders: {},
        google: { calendars: ['me@example.com'] },
        // 문서 위젯이 **먼저** 온다 — 그 인스턴스의 mode는 'off'다.
        dashboards: [{ id: 'd1', name: '이번 주', items: [{ id: 'w-doc', docId: 'doc-a', size: '1x1' }, { id: 'w-cal', kind: 'cal', size: '4x3' }] }],
      }),
    );
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { email: 'me@example.com' }, email: 'me@example.com', name: '나' }));
    seedToken();
    stubGis();
    const meeting = inMonth(1);
    let slow = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
        if (url.includes('people.googleapis.com') || url.includes('admin.googleapis.com')) return ok({ items: [] });
        if (url.includes('/colors')) return ok({ event: {} });
        if (url.includes('/users/me/calendarList')) {
          if (slow) return new Promise<Response>(() => {});
          return ok({ items: [{ id: 'me@example.com', summary: '내 캘린더', primary: true, accessRole: 'owner' }] });
        }
        // 두 번째 방문부터는 조회가 **영원히 응답하지 않는다** — 그래도 화면에 일정이
        // 보이면 그건 기억(캐시)에서 온 것이다.
        if (slow) return new Promise<Response>(() => {});
        return ok({ items: [{ id: 'g1', summary: '구글 회의', start: { dateTime: `${meeting}T09:00:00+09:00` }, end: { dateTime: `${meeting}T10:00:00+09:00` }, htmlLink: 'https://calendar.google.com/x' }] });
      }),
    );
    clientId = 'test-client.apps.googleusercontent.com';
    const user = userEvent.setup();
    const { container } = renderHome();
    const aside = await waitFor(() => {
      const el = container.querySelector('aside');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    await user.click(within(aside).getByText('이번 주'));
    await waitFor(() => expect(container.querySelector('[data-cal-widget-month]')).toBeTruthy());
    await waitFor(() => expect(screen.getAllByText(/구글 회의/).length).toBeGreaterThan(0));

    // 스페이스로 나갔다가 다시 대시보드로 — 이제 조회는 응답하지 않는다.
    slow = true;
    await user.click(within(aside).getByText('업무'));
    await waitFor(() => expect(container.querySelector('[data-dashboard-view]')).toBeNull());
    await user.click(within(aside).getByText('이번 주'));
    await waitFor(() => expect(container.querySelector('[data-cal-widget-month]')).toBeTruthy());
    expect(screen.getAllByText(/구글 회의/).length).toBeGreaterThan(0);
  });

  it('회의실 행이 그 시간에 비어 있는지 말한다 — 모르는 것은 칠하지 않는다(요청 ③)', async () => {
    seed({ calendars: ['me@example.com'] });
    seedToken();
    stubGis();
    // 35-01은 그 시간에 이미 잡혀 있고, 42-07은 비어 있고, 세 번째는 조직이 그
    // 캘린더를 공개하지 않는다(403) — 그 방은 아무 배지도 붙지 않아야 한다.
    const busyRoom = 'room-35-01@resource.calendar.google.com';
    const freeRoom = 'room-42-07@resource.calendar.google.com';
    const hiddenRoom = 'room-99-99@resource.calendar.google.com';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
        if (url.includes('people.googleapis.com')) return ok({ people: [] });
        if (url.includes('admin.googleapis.com')) {
          return ok({
            items: [
              { resourceEmail: busyRoom, generatedResourceName: '회의실-35-01', resourceCategory: 'CONFERENCE_ROOM', capacity: 23 },
              { resourceEmail: freeRoom, generatedResourceName: '회의실-42-07', resourceCategory: 'CONFERENCE_ROOM', capacity: 8 },
              { resourceEmail: hiddenRoom, generatedResourceName: '회의실-99-99', resourceCategory: 'CONFERENCE_ROOM' },
            ],
          });
        }
        if (url.includes('/colors')) return ok({ event: {} });
        if (url.includes('/users/me/calendarList')) return ok({ items: [{ id: 'me@example.com', summary: '내 캘린더', primary: true, accessRole: 'owner' }] });
        // 회의실 캘린더의 그 구간 조회 — 새 스코프 없이 `events.list`로 묻는다.
        if (url.includes(encodeURIComponent(busyRoom))) return ok({ items: [{ id: 'other', summary: '선점된 회의' }] });
        if (url.includes(encodeURIComponent(freeRoom))) return ok({ items: [] });
        if (url.includes(encodeURIComponent(hiddenRoom))) return { ok: false, status: 403, json: async () => ({}) } as unknown as Response;
        return ok({ items: [] });
      }),
    );
    clientId = 'test-client.apps.googleusercontent.com';
    const user = userEvent.setup();
    const { container } = renderHome();
    await openCalendar(container, user);
    await user.click(screen.getByText('새 일정'));
    await waitFor(() => expect(document.querySelector('[data-new-cal="me@example.com"]')).toBeTruthy());
    await user.click(document.querySelector<HTMLElement>('[data-new-cal="me@example.com"]')!);
    await waitFor(() => expect(document.querySelector('[data-gf-room-hit]')).toBeTruthy());

    const stateOf = (email: string) => document.querySelector(`[data-gf-room-hit="${email}"] [data-gf-room-state]`)?.getAttribute('data-gf-room-state') ?? null;
    await waitFor(() => expect(stateOf(busyRoom)).toBe('busy'), { timeout: 3000 });
    expect(document.querySelector(`[data-gf-room-hit="${busyRoom}"]`)!.textContent).toContain('사용 중');
    expect(stateOf(freeRoom)).toBe('free');
    // 물어볼 수 없는 방은 **아무 말도 하지 않는다** — "사용 가능"이라 잘못 말하지 않는다.
    expect(stateOf(hiddenRoom)).toBeNull();

    // 잡아 두면 그 행은 `예약됨`이 된다(비어 있던 방)
    fireEvent.mouseDown(document.querySelector(`[data-gf-room-hit="${freeRoom}"]`)!);
    await waitFor(() => expect(stateOf(freeRoom)).toBe('booked'));
  });

  it('사용 중인 회의실은 **한 번 묻고** 고른다 — 취소하면 예약되지 않는다(요청 ②)', async () => {
    seed({ calendars: ['me@example.com'] });
    seedToken();
    stubGis();
    const busyRoom = 'room-35-01@resource.calendar.google.com';
    const freeRoom = 'room-42-07@resource.calendar.google.com';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
        if (url.includes('people.googleapis.com')) return ok({ people: [] });
        if (url.includes('admin.googleapis.com')) {
          return ok({
            items: [
              { resourceEmail: busyRoom, generatedResourceName: '회의실-35-01', resourceCategory: 'CONFERENCE_ROOM', capacity: 23 },
              { resourceEmail: freeRoom, generatedResourceName: '회의실-42-07', resourceCategory: 'CONFERENCE_ROOM', capacity: 8 },
            ],
          });
        }
        if (url.includes('/colors')) return ok({ event: {} });
        if (url.includes('/users/me/calendarList')) return ok({ items: [{ id: 'me@example.com', summary: '내 캘린더', primary: true, accessRole: 'owner' }] });
        if (url.includes(encodeURIComponent(busyRoom)))
          return ok({ items: [{ id: 'other', summary: '디자인 리뷰', organizer: { email: 'lee@example.com', displayName: '이호율' } }] });
        return ok({ items: [] });
      }),
    );
    clientId = 'test-client.apps.googleusercontent.com';
    const user = userEvent.setup();
    const { container } = renderHome();
    await openCalendar(container, user);
    await user.click(screen.getByText('새 일정'));
    await waitFor(() => expect(document.querySelector('[data-new-cal="me@example.com"]')).toBeTruthy());
    await user.click(document.querySelector<HTMLElement>('[data-new-cal="me@example.com"]')!);
    await waitFor(() => expect(document.querySelector('[data-gf-room-hit]')).toBeTruthy());
    const stateOf = (email: string) => document.querySelector(`[data-gf-room-hit="${email}"] [data-gf-room-state]`)?.getAttribute('data-gf-room-state') ?? null;
    await waitFor(() => expect(stateOf(busyRoom)).toBe('busy'), { timeout: 3000 });

    // 사용 중인 방을 누르면 **아직 예약되지 않고** 확인 블록이 뜬다(누가 쓰는지 포함).
    fireEvent.mouseDown(document.querySelector(`[data-gf-room-hit="${busyRoom}"]`)!);
    const ask = await waitFor(() => {
      const el = document.querySelector(`[data-gf-room-confirm="${busyRoom}"]`);
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    expect(stateOf(busyRoom)).toBe('busy');
    expect(ask.textContent).toContain('이호율');
    expect(ask.textContent).toContain('그래도 예약할까요?');

    // 취소하면 아무것도 바뀌지 않는다.
    fireEvent.mouseDown(ask.querySelector('[data-gf-room-confirm-no]')!);
    await waitFor(() => expect(document.querySelector(`[data-gf-room-confirm="${busyRoom}"]`)).toBeNull());
    expect(stateOf(busyRoom)).toBe('busy');

    // 다시 눌러 `그래도 예약`을 고르면 그때 예약된다.
    fireEvent.mouseDown(document.querySelector(`[data-gf-room-hit="${busyRoom}"]`)!);
    await waitFor(() => expect(document.querySelector(`[data-gf-room-confirm="${busyRoom}"]`)).toBeTruthy());
    fireEvent.mouseDown(document.querySelector('[data-gf-room-confirm-yes]')!);
    // 겹쳐 잡았으면 배지가 두 사실을 함께 말한다 — 내가 잡았고, 그래도 사용 중이다.
    await waitFor(() => expect(stateOf(busyRoom)).toBe('booked-busy'));

    // 비어 있는 방은 그대로 한 번에 골라진다(묻지 않는다).
    fireEvent.mouseDown(document.querySelector(`[data-gf-room-hit="${freeRoom}"]`)!);
    await waitFor(() => expect(stateOf(freeRoom)).toBe('booked'));
    expect(document.querySelector(`[data-gf-room-confirm="${freeRoom}"]`)).toBeNull();
  });

  it('회의실 **전부**의 사용 여부를 확인한다 — 스크롤해야 보이는 방도 배지가 붙어 있다(제보)', async () => {
    seed({ calendars: ['me@example.com'] });
    seedToken();
    stubGis();
    // 여섯 개 — 예전에는 앞의 세 줄만 물어서, 스크롤한 방은 검색해야 배지가 붙었다.
    const rooms = Array.from({ length: 6 }, (_, i) => `room-${i}@resource.calendar.google.com`);
    const asked: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
        if (url.includes('people.googleapis.com')) return ok({ people: [] });
        if (url.includes('admin.googleapis.com')) {
          return ok({ items: rooms.map((email, i) => ({ resourceEmail: email, generatedResourceName: `회의실-${i}`, resourceCategory: 'CONFERENCE_ROOM', capacity: 4 })) });
        }
        if (url.includes('/colors')) return ok({ event: {} });
        if (url.includes('/users/me/calendarList')) return ok({ items: [{ id: 'me@example.com', summary: '내 캘린더', primary: true, accessRole: 'owner' }] });
        const hit = rooms.find((email) => url.includes(encodeURIComponent(email)));
        if (hit) {
          asked.push(hit);
          // 마지막 방만 잡혀 있다 — 목록 끝까지 물어야 이 배지가 뜬다.
          return ok({ items: hit === rooms[5] ? [{ id: 'other', summary: '선점' }] : [] });
        }
        return ok({ items: [] });
      }),
    );
    clientId = 'test-client.apps.googleusercontent.com';
    const user = userEvent.setup();
    const { container } = renderHome();
    await openCalendar(container, user);
    await user.click(screen.getByText('새 일정'));
    await waitFor(() => expect(document.querySelector('[data-new-cal="me@example.com"]')).toBeTruthy());
    await user.click(document.querySelector<HTMLElement>('[data-new-cal="me@example.com"]')!);
    await waitFor(() => expect(document.querySelector('[data-gf-room-hit]')).toBeTruthy());

    const stateOf = (email: string) => document.querySelector(`[data-gf-room-hit="${email}"] [data-gf-room-state]`)?.getAttribute('data-gf-room-state') ?? null;
    // 검색하지 않았는데도 마지막 방까지 배지가 붙는다.
    await waitFor(() => expect(stateOf(rooms[5]!)).toBe('busy'), { timeout: 5000 });
    await waitFor(() => expect(new Set(asked).size).toBe(6), { timeout: 5000 });
    expect(stateOf(rooms[0]!)).toBe('free');
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

  it('새 일정 팝업의 색이 목적지에 따라 갈린다 — 구글은 색 번호로 POST에 실린다(요청 ⑤)', async () => {
    seed({ calendars: ['me@example.com'] });
    seedToken();
    stubGis();
    const f = stubFetch();
    clientId = 'test-client.apps.googleusercontent.com';
    const user = userEvent.setup();
    const { container } = renderHome();
    await openCalendar(container, user);
    await user.click(screen.getByText('새 일정'));
    const modal = await waitFor(() => {
      const el = document.querySelector('[data-new-event]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    // Geurio 목적지 — 앱 팔레트 아홉 색 + 기본 칸.
    expect(modal.querySelectorAll('[data-event-color]')).toHaveLength(10);
    await user.type(screen.getByLabelText('일정 제목'), '색 회의');
    await user.click(document.querySelector<HTMLElement>('[data-new-cal="me@example.com"]')!);
    // 구글 목적지로 바꾸면 팔레트도 구글 것으로 바뀐다(값은 번호).
    await waitFor(() => expect(modal.querySelectorAll('[data-event-color]')).toHaveLength(12));
    await user.click(modal.querySelector<HTMLElement>('[data-event-color="#f6bf26"]')!);
    await user.click(screen.getByText('등록', { exact: true }));
    await waitFor(() => {
      const post = f.mock.calls.find((c) => (c[1] as { method?: string } | undefined)?.method === 'POST');
      expect(post).toBeTruthy();
      expect((JSON.parse((post![1] as { body: string }).body) as { colorId?: string }).colorId).toBe('5');
    });
  });

  it('연동이 켜져 있는데 토큰이 없으면(재로그인 뒤) 구글 팝업을 열지 않고 "다시 연결"을 권한다(제보)', async () => {
    // 재로그인한 기기의 상태 그대로 — 블롭에는 연동이 켜져 있지만 저장된 토큰이 없다.
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
    // 누르면 설정이 열리고(제보 ⑤), 거기서 다시 연결하면 그때 동의 창이 뜬다.
    await user.click(container.querySelector('[data-google-connect-cal]') as HTMLElement);
    expect(gis.requested).toEqual([]);
    await user.click(await waitFor(() => document.querySelector('[data-google-reconnect]') as HTMLElement));
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
    // 연동 행은 **계정 설정** 화면에 있다(요청 — 프로필 설정에서 옮겨 Google 연동과 한 구획으로).
    await user.click(await screen.findByText('계정 설정'));
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

  it('초대는 셋까지 그대로 보이고 넷부터 마지막 칸이 `외 N명`이다 · 목록은 검색 상자 아래(요청)', async () => {
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
    // 셋까지는 접지 않는다 — 그리고 목록은 **검색 상자 아래**다(회의실과 같은 순서).
    await waitFor(() => expect(document.querySelectorAll('[data-gf-guest]').length).toBe(3));
    expect(document.querySelector('[data-gf-guest-more]')).toBeNull();
    const box = document.querySelector('[data-gf-guest-input]')!.closest('span')!;
    const first = document.querySelector('[data-gf-guest]')!;
    expect(box.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // 넷째부터 마지막 칸이 접힌다: 둘 + `외 2명` = 세 칸.
    await user.type(input, 'd@example.com{Enter}');
    await waitFor(() => expect(document.querySelectorAll('[data-gf-guest]').length).toBe(2));
    const more = document.querySelector('[data-gf-guest-more]') as HTMLElement;
    expect(more.textContent).toContain('외 2명');

    // 접힌 목록은 툴팁으로 뜨고 **거기서 지울 수 있다**.
    await user.click(more);
    await waitFor(() => expect(document.querySelector('[data-gf-guest-list]')).toBeTruthy());
    expect(document.querySelectorAll('[data-gf-guest-item]').length).toBe(4);
    await user.click(screen.getByLabelText('d@example.com 초대 취소'));
    // 셋이 되면 접을 것이 없다 — 접힌 줄도 툴팁도 사라진다.
    await waitFor(() => expect(document.querySelector('[data-gf-guest-more]')).toBeNull());
    expect(document.querySelectorAll('[data-gf-guest]').length).toBe(3);
    expect(document.querySelector('[data-gf-guest-list]')).toBeNull();
  });

  it('고른 사람은 이름과 이메일이 함께 남는다', async () => {
    seed({ calendars: ['me@example.com'] });
    seedToken();
    stubGis();
    stubFetch();
    clientId = 'test-client.apps.googleusercontent.com';
    const user = userEvent.setup();
    const { container } = renderHome();
    await openGoogleDraft(user, container);

    await user.type(screen.getByLabelText('참석자 이름 또는 이메일'), '여은');
    const hit = await waitFor(() => {
      const el = document.querySelector('[data-gf-guest-hit]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    fireEvent.mouseDown(hit);
    const row = await waitFor(() => {
      const el = document.querySelector('[data-gf-guest]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    expect(row.textContent).toContain('여은진');
    expect(row.textContent).toContain('eunjin@example.com');

    // 직접 적은 주소도 **같은 두 줄**이다(제보) — 예전에는 이메일 한 줄만 남아
    // 같은 사람이 자리마다 달라 보였다. 이름 자리는 로컬파트가 채운다.
    await user.type(screen.getByLabelText('참석자 이름 또는 이메일'), 'typed@example.com{Enter}');
    const typed = await waitFor(() => {
      const el = document.querySelector('[data-gf-guest="typed@example.com"]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    expect([...(typed.children[1] as HTMLElement).children].map((n) => n.textContent)).toEqual(['typed', 'typed@example.com']);
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

  it('화면을 떠났다 돌아오면 구글 일정이 곧바로 보인다 — 받아 오는 동안 빈 달력이 되지 않는다(제보 #21)', async () => {
    seed({ calendars: ['me@example.com'] });
    seedToken();
    stubGis();
    stubFetch();
    clientId = 'test-client.apps.googleusercontent.com';
    const user = userEvent.setup();
    const { container } = renderHome();
    await openCalendar(container, user);
    await waitFor(() => expect(screen.getAllByText(/구글 회의/).length).toBeGreaterThan(0));

    // 두 번째 방문의 일정 조회를 **붙잡아 둔다** — 그동안 화면이 어떤지 보려는 것이다.
    let release = (): void => undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const inner = global.fetch as unknown as (u: string, i?: RequestInit) => Promise<Response>;
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (String(url).includes('googleapis.com/calendar') && !String(url).includes('calendarList')) await gate;
      return inner(url, init);
    });

    const aside = container.querySelector('aside') as HTMLElement;
    await user.click(within(aside).getByText('업무'));
    await waitFor(() => expect(container.querySelector('[data-month-grid]')).toBeNull());
    await user.click(within(aside).getByText('일정'));
    await waitFor(() => expect(container.querySelector('[data-month-grid]')).toBeTruthy());

    // 응답이 아직 오지 않았는데도 지난번에 받아 둔 일정이 그려져 있다.
    expect(screen.getAllByText(/구글 회의/).length).toBeGreaterThan(0);
    release();
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

  it('이미 등록된 구글 일정에서도 Meet를 켜고 끈다(요청 ④)', async () => {
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

    // 예전에는 만들 때만 토글이고 수정할 때는 링크 행뿐이라, 뒤늦게 붙일 길이 없었다.
    const meet = await waitFor(() => {
      const el = document.querySelector('[data-gf-meet]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    expect(meet.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(meet);
    await waitFor(() => expect(document.querySelector('[data-gf-meet]')!.getAttribute('aria-pressed')).toBe('true'));

    // 완료에서 한 번에 저장 — 바뀐 것만 실린다(회의 링크 요청 + 그 전용 쿼리).
    fireEvent.click(screen.getByText('완료'));
    const patch = await waitFor(() => {
      const call = (global.fetch as unknown as { mock: { calls: [string, RequestInit?][] } }).mock.calls
        .filter(([, init]) => init?.method === 'PATCH')
        .at(-1);
      expect(call).toBeTruthy();
      return call!;
    });
    expect(patch[0]).toContain('conferenceDataVersion=1');
    const body = JSON.parse(String(patch[1]!.body)) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(['conferenceData']);
    expect(body.conferenceData).toMatchObject({ createRequest: { requestId: expect.any(String) } });
  });

  it('구글 창을 닫거나 거절하면 **아무 일도 없다** — 오류 문구도, 불러오는 중도 남지 않는다(제보)', async () => {
    seed();
    stubFetch();
    // GIS가 창 닫힘을 `error_callback({ type: 'popup_closed', message: 'Popup window closed' })`로 알린다.
    (window as unknown as { google: unknown }).google = {
      accounts: {
        oauth2: {
          initTokenClient: (cfg: { error_callback?: (e: { type: string; message: string }) => void }) => ({
            requestAccessToken: () => cfg.error_callback?.({ type: 'popup_closed', message: 'Popup window closed' }),
          }),
          revoke: () => undefined,
        },
      },
    };
    clientId = 'test-client.apps.googleusercontent.com';
    const user = userEvent.setup();
    renderHome();
    await user.click(await screen.findByRole('button', { name: '계정 메뉴' }));
    await user.click(await screen.findByText('설정'));
    await user.click(await screen.findByText('계정 설정'));
    const section = await waitFor(() => {
      const el = document.querySelector('[data-google-section]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    await user.click(within(section).getByText('연결'));
    // 취소는 결정이다 — 누르기 전 그대로: 오류 없음, 연결 버튼 그대로, 목록 없음.
    await new Promise((r) => setTimeout(r, 50));
    expect(document.querySelector('[data-google-error]')).toBeNull();
    expect(section.textContent).not.toContain('Popup');
    expect(section.textContent).not.toContain('불러오는 중');
    expect(document.querySelector('[data-google-connect]')).toBeTruthy();
    expect(localStorage.getItem('mf_spaces')).not.toContain('"google"');
  });

  it('연결은 됐는데 토큰이 없으면 "불러오는 중"이 아니라 다시 연결을 권한다(제보 — 창을 닫아도 그 문구가 남았다)', async () => {
    seed({ calendars: ['me@example.com'] });
    // 토큰을 심지 않는다 — 재로그인한 탭의 상태.
    stubGis();
    stubFetch();
    clientId = 'test-client.apps.googleusercontent.com';
    const user = userEvent.setup();
    renderHome();
    await user.click(await screen.findByRole('button', { name: '계정 메뉴' }));
    await user.click(await screen.findByText('설정'));
    await user.click(await screen.findByText('계정 설정'));
    const section = await waitFor(() => {
      const el = document.querySelector('[data-google-section]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    await waitFor(() => expect(document.querySelector('[data-google-reconnect]')).toBeTruthy());
    expect(section.textContent).not.toContain('불러오는 중');
  });

  it('구글 연동 두 행은 계정 설정의 **연동** 구획에 함께 있고, 첫 화면·프로필 설정에는 없다(요청)', async () => {
    seed();
    seedToken();
    stubGis();
    stubFetch();
    clientId = 'test-client.apps.googleusercontent.com';
    const user = userEvent.setup();
    renderHome();
    await user.click(await screen.findByRole('button', { name: '계정 메뉴' }));
    await user.click(await screen.findByText('설정'));
    await screen.findByRole('dialog', { name: '설정' });
    expect(document.querySelector('[data-google-section]')).toBeNull();
    await user.click(await screen.findByText('프로필 설정'));
    await new Promise((r) => setTimeout(r, 30));
    expect(document.querySelector('[data-google-section]')).toBeNull();
    // 뒤로 → 계정 설정
    await user.click(screen.getByRole('button', { name: /뒤로/ }));
    await user.click(await screen.findByText('계정 설정'));
    const group = await waitFor(() => {
      const el = document.querySelector('[data-settings-link-group]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    expect(group.textContent).toBe('연동');
    // 구획 라벨 뒤에 Google 연동(로그인 수단) → Google 캘린더 연동 순서로 이어진다.
    const link = document.querySelector('[data-google-link-row]')!;
    const cal = document.querySelector('[data-google-section]')!;
    expect(group.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(link.compareDocumentPosition(cal) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(cal.textContent).toContain('Google 캘린더 연동');
  });

  it('회의실 목록은 사용 가능 → 사용 중으로 갈려 뜨고, 가능한 방이 먼저다(요청)', async () => {
    seed({ calendars: ['me@example.com'] });
    seedToken();
    stubGis();
    const busyRoom = 'room-a@resource.calendar.google.com';
    const freeRoom = 'room-b@resource.calendar.google.com';
    const hiddenRoom = 'room-c@resource.calendar.google.com';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
        if (url.includes('people.googleapis.com')) return ok({ people: [] });
        if (url.includes('admin.googleapis.com')) {
          // 목록 순서는 사용 중 → 사용 가능 → 알 수 없음 — 화면은 이 순서를 뒤집어 가능한 방을 먼저 둔다.
          return ok({
            items: [
              { resourceEmail: busyRoom, generatedResourceName: '회의실 A', resourceCategory: 'CONFERENCE_ROOM', capacity: 8 },
              { resourceEmail: freeRoom, generatedResourceName: '회의실 B', resourceCategory: 'CONFERENCE_ROOM', capacity: 4 },
              { resourceEmail: hiddenRoom, generatedResourceName: '회의실 C', resourceCategory: 'CONFERENCE_ROOM' },
            ],
          });
        }
        if (url.includes('/colors')) return ok({ event: {} });
        if (url.includes('/users/me/calendarList')) return ok({ items: [{ id: 'me@example.com', summary: '내 캘린더', primary: true, accessRole: 'owner' }] });
        if (url.includes(encodeURIComponent(busyRoom))) return ok({ items: [{ id: 'other', summary: '선점' }] });
        if (url.includes(encodeURIComponent(freeRoom))) return ok({ items: [] });
        if (url.includes(encodeURIComponent(hiddenRoom))) return { ok: false, status: 403, json: async () => ({}) } as unknown as Response;
        return ok({ items: [] });
      }),
    );
    clientId = 'test-client.apps.googleusercontent.com';
    const user = userEvent.setup();
    const { container } = renderHome();
    await openCalendar(container, user);
    await user.click(screen.getByText('새 일정'));
    await waitFor(() => expect(document.querySelector('[data-new-cal="me@example.com"]')).toBeTruthy());
    await user.click(document.querySelector<HTMLElement>('[data-new-cal="me@example.com"]')!);
    await waitFor(() => expect(document.querySelector('[data-gf-room-hit]')).toBeTruthy());
    await waitFor(() => expect(document.querySelector(`[data-gf-room-hit="${busyRoom}"] [data-gf-room-state="busy"]`)).toBeTruthy(), { timeout: 3000 });
    const groups = [...document.querySelectorAll<HTMLElement>('[data-gf-room-group]')].map((g) => [g.dataset.gfRoomGroup, [...g.querySelectorAll('[data-gf-room-hit]')].map((r) => r.getAttribute('data-gf-room-hit'))]);
    expect(groups).toEqual([
      ['free', [freeRoom]],
      ['busy', [busyRoom]],
      ['unknown', [hiddenRoom]],
    ]);
    const list = document.querySelector('[data-gf-room-list]')!.textContent!;
    expect(list.indexOf('사용 가능')).toBeLessThan(list.indexOf('사용 중'));
    // 사용 중인 방은 **이름에 취소선**(요청 ⑤) — 묶음 머리·배지와 함께 세 겹으로 말한다.
    const nameOf = (email: string) => document.querySelector<HTMLElement>(`[data-gf-room-hit="${email}"] [data-gf-room-name]`)!;
    expect(nameOf(busyRoom).style.textDecoration).toBe('line-through');
    expect(nameOf(freeRoom).style.textDecoration).toBe('');
    expect(nameOf(hiddenRoom).style.textDecoration).toBe('');
  });

  it('같은 사람은 어느 자리에서나 같은 이름이다 — 한 일정의 주최자 이름이 다른 일정의 참석자 행을 메운다(제보 ⑤)', async () => {
    seed({ calendars: ['me@example.com'] });
    seedToken();
    stubGis();
    const d1 = inMonth(1);
    const d2 = inMonth(2);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
        // 디렉터리는 그 사람을 모른다 — 구글이 다른 자리에 실어 준 이름만이 단서다.
        if (url.includes('people.googleapis.com') || url.includes('admin.googleapis.com')) return ok({ items: [], people: [] });
        if (url.includes('/colors')) return ok({ event: {} });
        if (url.includes('/users/me/calendarList')) return ok({ items: [{ id: 'me@example.com', summary: '내 캘린더', primary: true, accessRole: 'owner' }] });
        return ok({
          items: [
            // 여은진이 만든 일정 — 주최자에는 이름이 온다
            { id: 'a', summary: '기획 리뷰', start: { date: d1 }, end: { date: d1 }, organizer: { email: 'eunjin.yeo@example.com', displayName: '여은진' }, attendees: [{ email: 'eunjin.yeo@example.com', organizer: true, responseStatus: 'accepted' }, { email: 'me@example.com', self: true, responseStatus: 'accepted' }] },
            // 내가 만든 일정 — 같은 사람이 참석자로만, 이름 없이 온다
            { id: 'b', summary: '내 회의', start: { date: d2 }, end: { date: d2 }, organizer: { email: 'me@example.com', self: true }, attendees: [{ email: 'me@example.com', self: true, organizer: true, responseStatus: 'accepted' }, { email: 'eunjin.yeo@example.com', responseStatus: 'needsAction' }] },
          ],
        });
      }),
    );
    clientId = 'test-client.apps.googleusercontent.com';
    const user = userEvent.setup();
    const { container } = renderHome();
    const pop = await openGoogleChip(container, user, /내 회의/);
    // 내가 만든 일정 — "일정을 만든 사람" 행은 없고 나는 참석자에서 빠지며, 그 사람만 남는다.
    expect(pop.querySelector('[data-gf-organizer]')).toBeNull();
    expect(pop.querySelector('[data-gf-guest="me@example.com"]')).toBeNull();
    const guest = pop.querySelector('[data-gf-guest="eunjin.yeo@example.com"]')!;
    // 예전에는 `eunjin.yeo`(로컬파트)였다 — 이제 다른 일정의 주최자 이름을 가져다 쓴다.
    expect(guest.textContent).toContain('여은진');
    expect(guest.textContent).not.toMatch(/eunjin\.yeo(?!@)/);
    expect(pop.textContent).toContain('1명 초대');
  });

  it('기존 일정의 참석자 이름을 **전부** 채운다 — 첫 답이 와도 남은 조회가 취소되지 않고, 별칭 주소도 그 사람으로 맞춘다(라이브 제보)', async () => {
    seed({ calendars: ['me@example.com'] });
    seedToken();
    stubGis();
    const day = inMonth(1);
    // 라이브 로그 그대로: 디렉터리는 질의가 별칭(`johan.kim@mail.…`)이어도 **기본 주소가
    // 첫 번째**인 사람 하나를 돌려준다. 참석자 셋 모두 이름이 없다(구글이 비워 보냄).
    const people: Record<string, { name: string; emails: string[] }> = {
      'sungkwang@example.com': { name: '김성광', emails: ['sungkwang@example.com', 'sungkwang@mail.example.com'] },
      'myeongyun.seong@example.com': { name: '성명윤', emails: ['myeongyun.seong@example.com', 'myeongyun.seong@mail.example.com'] },
      'johan.kim@mail.example.com': { name: '김요한 (Johan Kim)', emails: ['johan.kim@example.com', 'johan.kim@mail.example.com'] },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
        if (url.includes('searchDirectoryPeople')) {
          const q = decodeURIComponent(/query=([^&]+)/.exec(url)?.[1] ?? '');
          const hit = people[q];
          return ok(hit ? { people: [{ names: [{ displayName: hit.name }], emailAddresses: hit.emails.map((v, i) => ({ value: v, ...(i === 0 ? { metadata: { primary: true } } : {}) })) }] } : { people: [] });
        }
        if (url.includes('people.googleapis.com') || url.includes('admin.googleapis.com')) return ok({ items: [], results: [] });
        if (url.includes('/colors')) return ok({ event: {} });
        if (url.includes('/users/me/calendarList')) return ok({ items: [{ id: 'me@example.com', summary: '내 캘린더', primary: true, accessRole: 'owner' }] });
        return ok({
          items: [
            {
              id: 'x',
              summary: '주간 회의',
              start: { dateTime: `${day}T09:00:00+09:00` },
              end: { dateTime: `${day}T10:00:00+09:00` },
              organizer: { email: 'me@example.com', self: true },
              attendees: [
                { email: 'me@example.com', self: true, organizer: true, responseStatus: 'accepted' },
                { email: 'sungkwang@example.com', responseStatus: 'accepted' },
                { email: 'myeongyun.seong@example.com', responseStatus: 'needsAction' },
                { email: 'johan.kim@mail.example.com', responseStatus: 'accepted' },
              ],
            },
          ],
        });
      }),
    );
    clientId = 'test-client.apps.googleusercontent.com';
    const user = userEvent.setup();
    const { container } = renderHome();
    const pop = await openGoogleChip(container, user, /주간 회의/);
    const nameOf = (email: string) => pop.querySelector(`[data-gf-guest="${email}"]`)?.textContent ?? '';
    // 셋 다 이름으로 — 예전에는 첫 사람만 이름이고 나머지는 `myeongyun.seong`·`johan.kim`으로 남았다.
    await waitFor(() => expect(nameOf('sungkwang@example.com')).toContain('김성광'), { timeout: 4000 });
    await waitFor(() => expect(nameOf('myeongyun.seong@example.com')).toContain('성명윤'), { timeout: 4000 });
    await waitFor(() => expect(nameOf('johan.kim@mail.example.com')).toContain('김요한'), { timeout: 4000 });
    // 이름 검색 상자 라벨이 열려 있음을 말한다(디렉터리 스코프가 있다)
    expect(within(pop).getByLabelText('참석자 이름 또는 이메일')).toBeTruthy();
  });

  it('보이는 두 줄의 이름이 **먼저** 온다 — 접힌 사람의 조회가 끝나기 전에 목록이 드러난다(제보)', async () => {
    seed({ calendars: ['me@example.com'] });
    seedToken();
    stubGis();
    const day = inMonth(1);
    // 다섯 명 초대 — 셋을 넘으니 두 줄 + `외 3명`이다. 접힌 셋은 **아주 늦게** 답한다:
    // 예전에는 목록 전체를 기다려 그동안 두 줄이 자리표시자였다(제보의 그 지연).
    const slow = new Set(['c@example.com', 'd@example.com', 'e@example.com']);
    const names: Record<string, string> = {
      'a@example.com': '가나다',
      'b@example.com': '라마바',
      'c@example.com': '사아자',
      'd@example.com': '차카타',
      'e@example.com': '파하가',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
        if (url.includes('searchDirectoryPeople')) {
          const q = decodeURIComponent(/query=([^&]+)/.exec(url)?.[1] ?? '');
          if (slow.has(q)) await new Promise((r) => setTimeout(r, 3000));
          const n = names[q];
          return ok(n ? { people: [{ names: [{ displayName: n }], emailAddresses: [{ metadata: { primary: true }, value: q }] }] } : { people: [] });
        }
        if (url.includes('people.googleapis.com') || url.includes('admin.googleapis.com')) return ok({ items: [], results: [] });
        if (url.includes('/colors')) return ok({ event: {} });
        if (url.includes('/users/me/calendarList')) return ok({ items: [{ id: 'me@example.com', summary: '내 캘린더', primary: true, accessRole: 'owner' }] });
        return ok({
          items: [
            {
              id: 'x',
              summary: '다섯 명 회의',
              start: { dateTime: `${day}T09:00:00+09:00` },
              end: { dateTime: `${day}T10:00:00+09:00` },
              organizer: { email: 'me@example.com', self: true },
              attendees: [{ email: 'me@example.com', self: true, organizer: true }, ...Object.keys(names).map((email) => ({ email }))],
            },
          ],
        });
      }),
    );
    clientId = 'test-client.apps.googleusercontent.com';
    const user = userEvent.setup();
    const { container } = renderHome();
    const pop = await openGoogleChip(container, user, /다섯 명 회의/);
    // 보이는 둘의 이름이 오면 그걸로 목록이 드러난다 — 접힌 셋(3초)은 아직 오지 않았다.
    await waitFor(() => expect(pop.querySelector('[data-gf-guest="a@example.com"]')?.textContent).toContain('가나다'), { timeout: 2000 });
    expect(pop.querySelector('[data-gf-guest="b@example.com"]')?.textContent).toContain('라마바');
    expect(pop.querySelectorAll('[data-gf-guest-loading]')).toHaveLength(0);
    // 접힌 줄은 개수만 말하므로 그 이름이 늦어도 첫 화면을 붙잡지 않는다.
    expect(pop.querySelector('[data-gf-guest-more]')?.textContent).toContain('외 3명');
  });

  it('사용 중인 회의실을 고르면 **누가 언제까지** 쓰는지 한 줄로 말한다(요청 ③)', async () => {
    seed({ calendars: ['me@example.com'] });
    seedToken();
    stubGis();
    const day = inMonth(1);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
        if (url.includes('admin.googleapis.com')) return ok({ items: [{ resourceEmail: 'room1@example.com', resourceName: '회의실 A', capacity: 8, floorName: '3층' }] });
        if (url.includes('people.googleapis.com')) return ok({ people: [] });
        if (url.includes('/colors')) return ok({ event: {} });
        if (url.includes('/users/me/calendarList')) return ok({ items: [{ id: 'me@example.com', summary: '내 캘린더', primary: true, accessRole: 'owner' }] });
        // 회의실 캘린더 조회 — 그 구간을 잡고 있는 일정(주최자·제목·시각까지 공개)
        if (url.includes('room1%40example.com')) {
          return ok({
            items: [
              {
                id: 'busy1',
                summary: '팀 회의',
                organizer: { displayName: '홍길동', email: 'gil@example.com' },
                // 오프셋 없이 — 어느 시간대에서 돌려도 로컬 09:00으로 읽힌다(테스트 안정).
                start: { dateTime: `${day}T09:00:00` },
                end: { dateTime: `${day}T10:00:00` },
              },
            ],
          });
        }
        return ok({ items: [] });
      }),
    );
    clientId = 'test-client.apps.googleusercontent.com';
    const user = userEvent.setup();
    const { container } = renderHome();
    await openCalendar(container, user);
    await user.click(screen.getByText('새 일정'));
    await waitFor(() => expect(document.querySelector('[data-new-cal="me@example.com"]')).toBeTruthy());
    await user.click(document.querySelector<HTMLElement>('[data-new-cal="me@example.com"]')!);
    await waitFor(() => expect(document.querySelector('[data-gf-room-hit="room1@example.com"]')).toBeTruthy(), { timeout: 3000 });
    // 배지가 `사용 중`이 될 때까지 — 그 답에 세부가 함께 실려 온다.
    await waitFor(() => expect(document.querySelector('[data-gf-room-group="busy"]')).toBeTruthy(), { timeout: 3000 });
    // 고르기 전에는 툴팁으로만(세 줄 상자에 줄을 더 늘리지 않는다).
    expect(document.querySelector('[data-gf-room-hit="room1@example.com"]')!.getAttribute('title')).toContain('홍길동');
    expect(document.querySelector('[data-gf-room-busy]')).toBeNull();
    // 답이 오면 묶음이 갈리며 행이 다시 마운트된다 — 그 자리에서 다시 집어야 한다.
    // 사용 중인 방은 **한 번 묻고** 고른다(요청 ②) — 확인을 거쳐야 예약된다.
    fireEvent.mouseDown(document.querySelector('[data-gf-room-hit="room1@example.com"]')!);
    await waitFor(() => expect(document.querySelector('[data-gf-room-confirm-yes]')).toBeTruthy());
    fireEvent.mouseDown(document.querySelector('[data-gf-room-confirm-yes]')!);
    const line = await waitFor(() => {
      const el = document.querySelector('[data-gf-room-busy]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    expect(line.textContent).toBe('사용 중 · 홍길동 · 팀 회의 · 09:00–10:00');
  });

  it('근무 위치는 일정이 아니다 — 칩이 아니라 칸 우측 상단의 한 마디(제보 ⑥)', async () => {
    seed({ calendars: ['me@example.com'] });
    seedToken();
    stubGis();
    const day = inMonth(1);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
        if (url.includes('people.googleapis.com') || url.includes('admin.googleapis.com')) return ok({ items: [], people: [] });
        if (url.includes('/colors')) return ok({ event: {} });
        if (url.includes('/users/me/calendarList')) return ok({ items: [{ id: 'me@example.com', summary: '내 캘린더', primary: true, accessRole: 'owner' }] });
        return ok({
          items: [
            { id: 'w', summary: '재택근무', eventType: 'workingLocation', workingLocationProperties: { type: 'homeOffice', homeOffice: {} }, start: { date: day }, end: { date: nextDay(day) } },
            { id: 'e', summary: '진짜 회의', start: { dateTime: `${day}T09:00:00+09:00` }, end: { dateTime: `${day}T10:00:00+09:00` } },
          ],
        });
      }),
    );
    clientId = 'test-client.apps.googleusercontent.com';
    const user = userEvent.setup();
    const { container } = renderHome();
    await openCalendar(container, user);
    const cell = await waitFor(() => {
      const el = container.querySelector(`[data-day-cell="${day}"] [data-work-loc]`);
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    expect(cell.textContent).toContain('재택');
    // 일정 칩으로는 서지 않는다 — 진짜 회의만 칩이다.
    const chips = [...container.querySelectorAll(`[data-day-cell="${day}"] [data-cal-chip]`)].map((c) => c.textContent);
    expect(chips.some((t) => t?.includes('진짜 회의'))).toBe(true);
    expect(chips.some((t) => t?.includes('재택'))).toBe(false);
  });

  // ── 근무 위치 쓰기(요청) — 읽는 쪽은 위 테스트가 지키고, 여기는 **쓰는 쪽**이다.
  describe('근무 위치 설정(요청)', () => {
    /** 그 날에 걸린 근무 위치 일정(있으면) — 목록 응답을 갈아 끼운다. */
    const stubWork = (day: string, work?: { id: string; from: string; to: string; props: unknown }) => {
      const f = vi.fn(async (url: string, init?: RequestInit) => {
        const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
        if (url.includes('people.googleapis.com') || url.includes('admin.googleapis.com')) return ok({ items: [], people: [] });
        if (url.includes('/colors')) return ok({ event: {} });
        if (url.includes('/users/me/calendarList')) return ok({ items: [{ id: 'me@example.com', summary: '내 캘린더', primary: true, accessRole: 'owner' }] });
        if ((init?.method ?? 'GET') !== 'GET') return ok({});
        return ok({
          items: [
            { id: 'e', summary: '진짜 회의', start: { dateTime: `${day}T09:00:00+09:00` }, end: { dateTime: `${day}T10:00:00+09:00` } },
            ...(work ? [{ id: work.id, eventType: 'workingLocation', workingLocationProperties: work.props, start: { date: work.from }, end: { date: nextDay(work.to) } }] : []),
          ],
        });
      });
      vi.stubGlobal('fetch', f);
      return f as unknown as ReturnType<typeof vi.fn>;
    };

    const openWorkModal = async (container: HTMLElement, user: ReturnType<typeof userEvent.setup>, iso: string) => {
      fireEvent.contextMenu(container.querySelector(`[data-day-cell="${iso}"]`)!, { clientX: 400, clientY: 300 });
      const menu = await waitFor(() => {
        const el = document.querySelector('[data-home-ctx="cal-day"]');
        expect(el).toBeTruthy();
        return el as HTMLElement;
      });
      return { menu, open: async () => {
        fireEvent.click(within(menu).getByText(/근무 위치/));
        return waitFor(() => {
          const el = document.querySelector('[data-work-modal]');
          expect(el).toBeTruthy();
          return el as HTMLElement;
        });
      } };
    };

    it('없는 날에 재택을 걸면 기본 캘린더에 종일 하루치로 POST된다', async () => {
      seed({ calendars: ['me@example.com'] });
      seedToken();
      stubGis();
      const day = inMonth(2);
      const f = stubWork(day);
      clientId = 'test-client.apps.googleusercontent.com';
      const user = userEvent.setup();
      const { container } = renderHome();
      await openCalendar(container, user);
      await waitFor(() => expect(screen.getAllByText(/진짜 회의/).length).toBeGreaterThan(0));

      const { menu, open } = await openWorkModal(container, user, day);
      // 걸린 것이 없으면 `설정`이다(무엇을 고치는지 눌러 보기 전에 안다).
      expect(menu.textContent).toContain('근무 위치 설정');
      const modal = await open();
      // 재택은 이름이 없다 — 갈래 셋 중 하나만 켜져 있다.
      expect(modal.querySelector('[data-work-label]')).toBeNull();
      expect(modal.querySelector('[data-work-kind="homeOffice"]')?.getAttribute('aria-checked')).toBe('true');
      // 걸린 것이 없으니 지울 것도 없다.
      expect(modal.querySelector('[data-work-clear]')).toBeNull();
      fireEvent.click(modal.querySelector('[data-work-save]')!);
      await waitFor(() => {
        const post = f.mock.calls.find((c) => (c[1] as { method?: string } | undefined)?.method === 'POST');
        expect(post).toBeTruthy();
        expect(String(post![0])).toContain('/calendars/me%40example.com/events');
        const body = JSON.parse((post![1] as { body: string }).body) as Record<string, unknown>;
        expect(body.eventType).toBe('workingLocation');
        expect(body.start).toEqual({ date: day });
        expect(body.workingLocationProperties).toMatchObject({ type: 'homeOffice' });
      });
      await waitFor(() => expect(document.querySelector('[data-work-modal]')).toBeNull());
    });

    it('사무실은 이름을 함께 보내고, 걸려 있는 날은 지울 수 있다', async () => {
      seed({ calendars: ['me@example.com'] });
      seedToken();
      stubGis();
      const day = inMonth(2);
      const f = stubWork(day, { id: 'w1', from: day, to: day, props: { type: 'homeOffice', homeOffice: {} } });
      clientId = 'test-client.apps.googleusercontent.com';
      const user = userEvent.setup();
      const { container } = renderHome();
      await openCalendar(container, user);
      await waitFor(() => expect(container.querySelector(`[data-day-cell="${day}"] [data-work-loc]`)).toBeTruthy());

      const { menu, open } = await openWorkModal(container, user, day);
      // 걸려 있으면 그 값을 이름에 담는다.
      expect(menu.textContent).toContain('근무 위치 · 재택');
      const modal = await open();
      fireEvent.click(modal.querySelector('[data-work-kind="officeLocation"]')!);
      const label = await waitFor(() => {
        const el = modal.querySelector<HTMLInputElement>('[data-work-label]');
        expect(el).toBeTruthy();
        return el!;
      });
      await user.type(label, '판교 5층');
      fireEvent.click(modal.querySelector('[data-work-save]')!);
      await waitFor(() => {
        const patch = f.mock.calls.find((c) => (c[1] as { method?: string } | undefined)?.method === 'PATCH');
        expect(patch).toBeTruthy();
        const body = JSON.parse((patch![1] as { body: string }).body) as Record<string, unknown>;
        // 갈래·이름만 — 날짜는 그대로다(그 날의 상태만 바뀐다).
        expect(Object.keys(body)).toEqual(['workingLocationProperties']);
        expect(body.workingLocationProperties).toEqual({ type: 'officeLocation', officeLocation: { label: '판교 5층' } });
      });

      // 다시 열어 지우면 그 일정을 삭제한다.
      const again = await openWorkModal(container, user, day);
      const m2 = await again.open();
      fireEvent.click(m2.querySelector('[data-work-clear]')!);
      await waitFor(() => expect(f.mock.calls.some((c) => (c[1] as { method?: string } | undefined)?.method === 'DELETE')).toBe(true));
    });

    // 라이브 제보의 400(`malformedWorkingLocationEvent`): 종일 근무 위치는 **반드시
    // 하루**다. 그래서 구간은 일정 하나가 아니라 **하루하루에 하나씩**이다.
    it('구간을 고르면 하루하루에 하나씩 쓴다 — 걸려 있는 날은 고치고 나머지는 만든다', async () => {
      seed({ calendars: ['me@example.com'] });
      seedToken();
      stubGis();
      const day = inMonth(2);
      const f = stubWork(day, { id: 'w1', from: day, to: day, props: { type: 'homeOffice', homeOffice: {} } });
      clientId = 'test-client.apps.googleusercontent.com';
      const user = userEvent.setup();
      const { container } = renderHome();
      await openCalendar(container, user);
      await waitFor(() => expect(container.querySelector(`[data-day-cell="${day}"] [data-work-loc]`)).toBeTruthy());
      const { open } = await openWorkModal(container, user, day);
      const modal = await open();
      // 종료 날짜를 이틀 뒤로 → 사흘에 걸린다.
      fireEvent.click(modal.querySelector('[data-work-to]')!);
      fireEvent.click(document.querySelector(`[data-datepop-day="${inMonth(4)}"]`)!);
      await waitFor(() => expect(modal.querySelector('[data-work-foot]')?.textContent).toContain('3일에 걸어요'));
      fireEvent.click(modal.querySelector('[data-work-save]')!);
      await waitFor(() => {
        const writes = f.mock.calls.filter((c) => ['POST', 'PATCH'].includes((c[1] as { method?: string } | undefined)?.method ?? ''));
        expect(writes).toHaveLength(3);
      });
      const writes = f.mock.calls.filter((c) => ['POST', 'PATCH'].includes((c[1] as { method?: string } | undefined)?.method ?? ''));
      // 걸려 있던 첫 날은 PATCH, 나머지 두 날은 POST.
      expect(writes.map((c) => (c[1] as { method: string }).method)).toEqual(['PATCH', 'POST', 'POST']);
      const bodies = writes.map((c) => JSON.parse((c[1] as { body: string }).body) as Record<string, unknown>);
      // 첫 날은 그 날짜가 그대로라 갈래·이름만 간다(#552의 그 규칙).
      expect(Object.keys(bodies[0]!)).toEqual(['workingLocationProperties']);
      // 만드는 두 날은 **각각 정확히 하루**다(끝은 배타적 다음 날).
      expect(bodies[1]).toMatchObject({ start: { date: inMonth(3) }, end: { date: inMonth(4) } });
      expect(bodies[2]).toMatchObject({ start: { date: inMonth(4) }, end: { date: inMonth(5) } });
    });

    it('여러 날을 실은 본문은 어디에도 없다 — 구글이 하루만 받는다', async () => {
      seed({ calendars: ['me@example.com'] });
      seedToken();
      stubGis();
      const day = inMonth(2);
      const f = stubWork(day);
      clientId = 'test-client.apps.googleusercontent.com';
      const user = userEvent.setup();
      const { container } = renderHome();
      await openCalendar(container, user);
      await waitFor(() => expect(screen.getAllByText(/진짜 회의/).length).toBeGreaterThan(0));
      const { open } = await openWorkModal(container, user, day);
      const modal = await open();
      fireEvent.click(modal.querySelector('[data-work-to]')!);
      fireEvent.click(document.querySelector(`[data-datepop-day="${inMonth(4)}"]`)!);
      fireEvent.click(modal.querySelector('[data-work-save]')!);
      await waitFor(() => expect(f.mock.calls.filter((c) => (c[1] as { method?: string } | undefined)?.method === 'POST')).toHaveLength(3));
      for (const c of f.mock.calls.filter((x) => (x[1] as { method?: string } | undefined)?.method === 'POST')) {
        const b = JSON.parse((c[1] as { body: string }).body) as { start: { date: string }; end: { date: string } };
        expect(Date.parse(b.end.date) - Date.parse(b.start.date)).toBe(86400000);
      }
    });

    it('`시간 추가`를 켜면 하루 안의 시각 구간이 된다 — 종료 날짜는 사라진다', async () => {
      seed({ calendars: ['me@example.com'] });
      seedToken();
      stubGis();
      const day = inMonth(2);
      const f = stubWork(day);
      clientId = 'test-client.apps.googleusercontent.com';
      const user = userEvent.setup();
      const { container } = renderHome();
      await openCalendar(container, user);
      await waitFor(() => expect(screen.getAllByText(/진짜 회의/).length).toBeGreaterThan(0));
      const { open } = await openWorkModal(container, user, day);
      const modal = await open();
      // 종일이면 시작–종료 두 칸이다.
      expect(modal.querySelector('[data-work-to]')).toBeTruthy();
      fireEvent.click(modal.querySelector('[data-work-time]')!);
      // 시각을 켜면 구간이 접힌다(구글이 시각 근무 위치를 하루로 제한한다).
      await waitFor(() => expect(modal.querySelector('[data-work-to]')).toBeNull());
      expect(modal.querySelector('[data-work-t1]')).toBeTruthy();
      fireEvent.click(modal.querySelector('[data-work-save]')!);
      await waitFor(() => {
        const post = f.mock.calls.find((c) => (c[1] as { method?: string } | undefined)?.method === 'POST');
        expect(post).toBeTruthy();
        const body = JSON.parse((post![1] as { body: string }).body) as Record<string, unknown>;
        expect(body.start).toMatchObject({ dateTime: `${day}T09:00:00` });
        expect(body.end).toMatchObject({ dateTime: `${day}T18:00:00` });
      });
    });

    it('구간이 상한을 넘으면 저장 자체를 막고 이유를 말한다 — 조용히 잘라 저장하지 않는다', async () => {
      seed({ calendars: ['me@example.com'] });
      seedToken();
      stubGis();
      const day = inMonth(2);
      const f = stubWork(day);
      clientId = 'test-client.apps.googleusercontent.com';
      const user = userEvent.setup();
      const { container } = renderHome();
      await openCalendar(container, user);
      await waitFor(() => expect(screen.getAllByText(/진짜 회의/).length).toBeGreaterThan(0));
      const { open } = await openWorkModal(container, user, day);
      const modal = await open();
      // 다음 달 20일까지 → 31일을 넘는다.
      fireEvent.click(modal.querySelector('[data-work-to]')!);
      fireEvent.click(document.querySelector('[data-radix-popper-content-wrapper] [aria-label="다음 달"]')!);
      const nextMonth = `${new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 20).getFullYear()}-${String(new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 20).getMonth() + 1).padStart(2, '0')}-20`;
      fireEvent.click(document.querySelector(`[data-datepop-day="${nextMonth}"]`)!);
      await waitFor(() => expect(modal.querySelector('[data-work-foot]')?.textContent).toContain('31일까지'));
      expect(modal.querySelector<HTMLButtonElement>('[data-work-save]')?.disabled).toBe(true);
      fireEvent.click(modal.querySelector('[data-work-save]')!);
      expect(f.mock.calls.filter((c) => (c[1] as { method?: string } | undefined)?.method === 'POST')).toHaveLength(0);
    });

    it('일별 팝업 발치에도 같은 길이 있다 — 우클릭은 알아야 쓰는 조작이다', async () => {
      seed({ calendars: ['me@example.com'] });
      seedToken();
      stubGis();
      const day = inMonth(2);
      stubWork(day, { id: 'w1', from: day, to: day, props: { type: 'homeOffice', homeOffice: {} } });
      clientId = 'test-client.apps.googleusercontent.com';
      const user = userEvent.setup();
      const { container } = renderHome();
      await openCalendar(container, user);
      await waitFor(() => expect(container.querySelector(`[data-day-cell="${day}"] [data-work-loc]`)).toBeTruthy());
      fireEvent.doubleClick(container.querySelector(`[data-day-cell="${day}"]`)!, { clientX: 400, clientY: 300 });
      const list = await waitFor(() => {
        const el = document.querySelector('[data-day-list]');
        expect(el).toBeTruthy();
        return el as HTMLElement;
      });
      const row = list.querySelector<HTMLElement>('[data-day-list-work]');
      // 걸려 있으면 그 값을 말한다(우클릭 메뉴와 같은 규칙).
      expect(row?.textContent).toContain('근무 위치 · 재택');
      fireEvent.click(row!);
      await waitFor(() => expect(document.querySelector('[data-work-modal]')).toBeTruthy());
      // 같은 팝업이다 — 지금 값이 켜져 있다.
      expect(document.querySelector('[data-work-kind="homeOffice"]')?.getAttribute('aria-checked')).toBe('true');
    });

    it('칸의 근무 위치 태그를 누르면 그 날의 팝업이 열린다(요청 ③)', async () => {
      seed({ calendars: ['me@example.com'] });
      seedToken();
      stubGis();
      const day = inMonth(2);
      stubWork(day, { id: 'w1', from: day, to: day, props: { type: 'officeLocation', officeLocation: { label: '판교 5층' } } });
      clientId = 'test-client.apps.googleusercontent.com';
      const user = userEvent.setup();
      const { container } = renderHome();
      await openCalendar(container, user);
      const tag = await waitFor(() => {
        const el = container.querySelector<HTMLElement>(`[data-day-cell="${day}"] [data-work-loc]`);
        expect(el).toBeTruthy();
        return el!;
      });
      // 누를 수 있는 표식이다 — 쓸 수 있을 때만 버튼이 된다(정직한 어포던스).
      expect(tag.getAttribute('role')).toBe('button');
      fireEvent.click(tag);
      const modal = await waitFor(() => {
        const el = document.querySelector('[data-work-modal]');
        expect(el).toBeTruthy();
        return el as HTMLElement;
      });
      // 그 날에 걸린 값이 그대로 켜져 있다.
      expect(modal.querySelector('[data-work-kind="officeLocation"]')?.getAttribute('aria-checked')).toBe('true');
      expect(modal.querySelector<HTMLInputElement>('[data-work-label]')?.value).toBe('판교 5층');
    });

    it('하루짜리에는 `선택한 날짜만 / …부터 매주` 되풀이가 뜨고, 매주는 규칙으로 저장된다(요청 ④)', async () => {
      seed({ calendars: ['me@example.com'] });
      seedToken();
      stubGis();
      const day = inMonth(3);
      const f = stubWork(day);
      clientId = 'test-client.apps.googleusercontent.com';
      const user = userEvent.setup();
      const { container } = renderHome();
      await openCalendar(container, user);
      await waitFor(() => expect(screen.getAllByText(/진짜 회의/).length).toBeGreaterThan(0));
      const { open } = await openWorkModal(container, user, day);
      const modal = await open();
      // 두 선택이 있고 기본은 `선택한 날짜만`이다(요청한 이미지와 같은 구성).
      expect(modal.querySelector('[data-work-repeat="once"]')?.getAttribute('aria-checked')).toBe('true');
      const weekly = modal.querySelector<HTMLElement>('[data-work-repeat="weekly"]')!;
      const dow = ['일', '월', '화', '수', '목', '금', '토'][new Date(`${day}T00:00:00`).getDay()]!;
      expect(weekly.textContent).toContain(`${dow}요일`);
      fireEvent.click(weekly);
      fireEvent.click(modal.querySelector('[data-work-save]')!);
      await waitFor(() => {
        const post = f.mock.calls.find((c) => (c[1] as { method?: string } | undefined)?.method === 'POST');
        expect(post).toBeTruthy();
        const body = JSON.parse((post![1] as { body: string }).body) as Record<string, unknown>;
        // 회차를 우리가 만들지 않는다 — 규칙 한 줄이고 펼치는 일은 구글이 한다.
        expect(body.recurrence).toEqual([`RRULE:FREQ=WEEKLY;BYDAY=${['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][new Date(`${day}T00:00:00`).getDay()]}`]);
        expect(body.start).toEqual({ date: day });
      });
      // POST는 딱 하나다(구간처럼 여러 날에 나누지 않는다).
      expect(f.mock.calls.filter((c) => (c[1] as { method?: string } | undefined)?.method === 'POST')).toHaveLength(1);
    });

    it('구간을 고르면 되풀이 선택이 사라지고, 안내 문구도 없다(요청 ④⑤)', async () => {
      seed({ calendars: ['me@example.com'] });
      seedToken();
      stubGis();
      const day = inMonth(2);
      stubWork(day);
      clientId = 'test-client.apps.googleusercontent.com';
      const user = userEvent.setup();
      const { container } = renderHome();
      await openCalendar(container, user);
      await waitFor(() => expect(screen.getAllByText(/진짜 회의/).length).toBeGreaterThan(0));
      const { open } = await openWorkModal(container, user, day);
      const modal = await open();
      // 지워진 안내 문구(요청 ⑤).
      expect(modal.querySelector('[data-work-note]')).toBeNull();
      expect(modal.textContent).not.toContain('Google 캘린더 설정에서');
      expect(modal.querySelector('[data-work-repeat="weekly"]')).toBeTruthy();
      // 종료 날짜를 뒤로 밀면 하루짜리가 아니므로 되풀이는 뜻이 없다.
      fireEvent.click(modal.querySelector('[data-work-to]')!);
      const cell = await waitFor(() => {
        const el = document.querySelector(`[data-datepop-day="${inMonth(4)}"]`);
        expect(el).toBeTruthy();
        return el as HTMLElement;
      });
      fireEvent.click(cell);
      await waitFor(() => expect(document.querySelector('[data-work-repeat="weekly"]')).toBeNull());
    });

    it('연동하지 않았으면 항목 자체가 없다 — 눌러도 아무 일 없는 항목을 두지 않는다', async () => {
      seed();
      clientId = '';
      const user = userEvent.setup();
      const { container } = renderHome();
      await openCalendar(container, user);
      fireEvent.contextMenu(container.querySelector(`[data-day-cell="${inMonth(2)}"]`)!, { clientX: 400, clientY: 300 });
      const menu = await waitFor(() => {
        const el = document.querySelector('[data-home-ctx="cal-day"]');
        expect(el).toBeTruthy();
        return el as HTMLElement;
      });
      expect(menu.textContent).toContain('이 날에 새 일정');
      expect(menu.textContent).not.toContain('근무 위치');
    });
  });

  it('참석자 이름은 **다 채워진 뒤** 한 번에 뜬다 — 하나씩 갈리는 것을 보이지 않는다(제보 ①)', async () => {
    seed({ calendars: ['me@example.com'] });
    seedToken();
    stubGis();
    const day = inMonth(1);
    // 붙잡아 둔 답을 풀 손잡이 — 초기값을 두어야 TS가 `never`로 좁히지 않는다.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
        if (url.includes('searchDirectoryPeople')) {
          const q = decodeURIComponent(/query=([^&]+)/.exec(url)?.[1] ?? '');
          // 둘째 사람의 답을 붙잡아 둔다 — 그 사이 화면이 어떻게 보이는지가 이 테스트다.
          if (q.startsWith('bbb')) await gate;
          return ok({ people: [{ names: [{ displayName: q.startsWith('aaa') ? '가나다' : '라마바' }], emailAddresses: [{ value: q }] }] });
        }
        if (url.includes('people.googleapis.com') || url.includes('admin.googleapis.com')) return ok({ items: [], results: [] });
        if (url.includes('/colors')) return ok({ event: {} });
        if (url.includes('/users/me/calendarList')) return ok({ items: [{ id: 'me@example.com', summary: '내 캘린더', primary: true, accessRole: 'owner' }] });
        return ok({
          items: [
            {
              id: 'x',
              summary: '이름 회의',
              start: { dateTime: `${day}T09:00:00+09:00` },
              end: { dateTime: `${day}T10:00:00+09:00` },
              organizer: { email: 'me@example.com', self: true },
              attendees: [
                { email: 'me@example.com', self: true, organizer: true, responseStatus: 'accepted' },
                { email: 'aaa@example.com', responseStatus: 'accepted' },
                { email: 'bbb@example.com', responseStatus: 'accepted' },
              ],
            },
          ],
        });
      }),
    );
    clientId = 'test-client.apps.googleusercontent.com';
    const user = userEvent.setup();
    const { container } = renderHome();
    const pop = await openGoogleChip(container, user, /이름 회의/);
    // 채우는 중에는 **자리표시자**만 — 이메일 앞부분이 먼저 보이지 않는다.
    await waitFor(() => expect(pop.querySelectorAll('[data-gf-guest-loading]').length).toBe(2));
    expect(pop.querySelector('[data-gf-guest]')).toBeNull();
    expect(pop.textContent).not.toContain('aaa');
    release();
    // 다 오면 둘이 함께 이름으로 뜬다.
    await waitFor(() => expect(pop.querySelectorAll('[data-gf-guest]').length).toBe(2), { timeout: 4000 });
    expect(pop.querySelector('[data-gf-guest-loading]')).toBeNull();
    expect(pop.querySelector('[data-gf-guest="aaa@example.com"]')!.textContent).toContain('가나다');
    expect(pop.querySelector('[data-gf-guest="bbb@example.com"]')!.textContent).toContain('라마바');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { BackendProvider } from '../../adapters/BackendContext';
import { LocalAuth } from '../../adapters/local/localAuth';
import { LocalSpaceStore } from '../../adapters/local/localSpaceStore';
import { LocalShareStore } from '../../adapters/local/localShareStore';
import { LocalFeedbackStore } from '../../adapters/local/localFeedbackStore';
import { LocalTagStore } from '../../adapters/local/localTagStore';
import { LocalCommentStore } from '../../adapters/local/localCommentStore';
import { LocalNotificationStore } from '../../adapters/local/localNotificationStore';
import { LocalEventStore } from '../../adapters/local/localEventStore';
import { LocalImageStore } from '../../adapters/local/localImageStore';
import type { Backend, CalendarEvent, DocMeta, DocStore, LoadedDoc, SaveResult } from '../../adapters/ports';
import { ACTIVE_VIEW_KEY } from '../home/storage';
import { takeCalendarFocus } from '../home/calendarFocus';
import { ReminderHost } from './ReminderHost';
import { REMINDER_TICK_MS } from './reminders';
import { notifyCalendarChanged } from './calendarChanged';
import { listReminderNotices, markReminderNoticesRead } from './reminderInbox';
import { setGoogleRemindersEnabled, setRemindersEnabled } from './reminderPrefs';
import { GOOGLE_CALENDAR_SCOPE, storeReminderCalendars } from '../home/calendar/googleCalendar';

/**
 * 일정 알림 통합 — **앱이 켜져 있는 동안** 알림 시각이 되면 인앱 토스트와 OS 알림이
 * 함께 뜬다(요청). 순수 판단은 `reminders.test.ts`가 덮으므로 여기서는 실제 흐름만
 * 본다: 조회 → 발화 → 중복 방지 → 끄면 아무 일도 없음 → 누르면 일정 화면.
 */

/** 알림 시각을 지금으로 맞춘 시각: 10:22에 서서 10:30 일정 + 10분 알림 → 알림은 10:20(2분 전). */
const NOW = new Date(2026, 8, 15, 10, 22, 0);

const EVENT: CalendarEvent = {
  id: 'ev1',
  title: '팀 회의',
  startDate: '2026-09-15',
  endDate: '2026-09-15',
  allDay: false,
  startTime: '10:30',
  endTime: '11:30',
  reminderMinutes: 10,
  source: 'geurio',
};

class StubDocStore implements DocStore {
  listEditorNames = vi.fn(async (): Promise<Record<string, never>> => ({}));
  setFavorite = vi.fn(async (): Promise<void> => undefined);
  remove = vi.fn(async (): Promise<void> => undefined);
  restore = vi.fn(async (): Promise<void> => undefined);
  purge = vi.fn(async (): Promise<void> => undefined);
  list = vi.fn(async (): Promise<DocMeta[]> => []);
  load = vi.fn(async (): Promise<LoadedDoc | null> => null);
  loadPreview = vi.fn(async (): Promise<string | null> => null);
  rename = vi.fn(async (): Promise<void> => undefined);
  save = vi.fn(async (): Promise<SaveResult> => ({ ok: true, version: 1 }));
  listSharedWithMe = vi.fn(async (): Promise<DocMeta[]> => []);
  markSharesSeen = vi.fn(async (): Promise<void> => undefined);
}

let osNotifications: { title: string; body: string }[] = [];
/** 마지막 OS 알림에 걸린 클릭 핸들러 — 브라우저가 하는 일을 테스트가 대신 한다. */
let lastNotificationClick: (() => void) | null = null;
/** 구글에 나간 요청 — "켜지 않으면 왕복이 한 번도 없다"를 이 목록으로 본다. */
let googleCalls: string[] = [];

/**
 * 연동된 기기 흉내 — 토큰(이 기기)과 **캘린더 거울**(홈이 적어 두는 것)을 심고,
 * 구글 응답을 세워 둔다. 스케줄러는 이 둘만 보므로 에디터에서도 그대로 돈다.
 */
function seedGoogle(items: unknown[], defaultMinutes?: number): void {
  localStorage.setItem('mf_gcal_token', JSON.stringify({ accessToken: 'tok', expiresAt: Date.now() + 3_600_000, scope: GOOGLE_CALENDAR_SCOPE }));
  storeReminderCalendars([{ id: 'cal-a', ...(defaultMinutes === undefined ? {} : { defaultMinutes }) }]);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      googleCalls.push(url);
      return { ok: true, status: 200, json: async () => ({ items }) } as unknown as Response;
    }),
  );
}

/**
 * 구글은 시각을 **오프셋이 붙은 ISO**로 준다. 고정 문자열을 쓰면 테스트를 돌리는
 * 기기의 시간대에 따라 다른 시각이 되므로, 로컬 10:30을 그대로 가리키는 ISO를 만든다.
 */
const GOOGLE_EVENT = {
  id: 'g1',
  summary: '구글 회의',
  start: { dateTime: new Date(2026, 8, 15, 10, 30).toISOString() },
  end: { dateTime: new Date(2026, 8, 15, 11, 30).toISOString() },
};

function fakeNotification(permission: 'granted' | 'denied' | 'default'): void {
  class FakeNotification {
    static permission = permission;
    // 물어보면 **지금 값**을 돌려준다 — 브라우저처럼(테스트가 값을 바꿔 허용을 흉내낸다).
    static requestPermission = vi.fn(async () => FakeNotification.permission);
    close = vi.fn();
    // 앱이 `n.onclick = …`으로 심는 그 함수를 그대로 받아 둔다.
    set onclick(fn: (() => void) | null) {
      lastNotificationClick = fn;
    }
    get onclick(): (() => void) | null {
      return lastNotificationClick;
    }
    constructor(title: string, opts: { body?: string }) {
      osNotifications.push({ title, body: opts.body ?? '' });
    }
  }
  vi.stubGlobal('Notification', FakeNotification);
}

function renderHost(events: CalendarEvent[]) {
  localStorage.setItem('mf_events', JSON.stringify(events));
  const backend: Backend = {
    auth: new LocalAuth(),
    docStore: new StubDocStore(),
    spaceStore: new LocalSpaceStore(),
    shareStore: new LocalShareStore(),
    feedbackStore: new LocalFeedbackStore(), tagStore: new LocalTagStore(),
    imageStore: new LocalImageStore(),
    commentStore: new LocalCommentStore(),
    notificationStore: new LocalNotificationStore(),
    eventStore: new LocalEventStore(),
    mode: 'local',
  };
  return render(
    // 에디터에서 시작한다 — 알림은 **로그인한 화면이면 어디서든** 와야 한다.
    <MemoryRouter initialEntries={['/editor']}>
      <BackendProvider backend={backend}>
        <ReminderHost />
        <Routes>
          <Route path="/editor" element={<div>EDITOR</div>} />
          <Route path="/home" element={<div>HOME</div>} />
        </Routes>
      </BackendProvider>
    </MemoryRouter>,
  );
}

/** 조회(약속) → 첫 확인까지 흘려 보낸다. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  osNotifications = [];
  lastNotificationClick = null;
  googleCalls = [];
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('일정 알림', () => {
  it('알림 시각이 되면 인앱 토스트와 OS 알림이 함께 뜬다', async () => {
    fakeNotification('granted');
    renderHost([EVENT]);
    await settle();

    const toast = document.querySelector('[data-reminder-toast]') as HTMLElement;
    expect(toast).toBeTruthy();
    expect(toast.querySelector('[data-reminder-title]')!.textContent).toBe('팀 회의');
    // 시각과 "몇 분 후"를 함께 말한다 — 언제 시작하는지가 이 알림의 내용이다.
    expect(toast.textContent).toContain('오전 10:30');
    expect(toast.textContent).toContain('10분 후 시작');
    expect(osNotifications).toEqual([{ title: '팀 회의', body: '오전 10:30 · 10분 후 시작' }]);
  });

  it('OS 알림 권한이 없어도 **인앱 토스트는 뜬다** — 알림이 통째로 사라지지 않게', async () => {
    fakeNotification('denied');
    renderHost([EVENT]);
    await settle();
    expect(document.querySelector('[data-reminder-toast]')).toBeTruthy();
    expect(osNotifications).toEqual([]);
  });

  /**
   * 제보: 인앱 토스트는 떴는데 **OS 알림이 오지 않았고**, 설정의 `테스트 알림`을
   * 누르면 정상으로 떴다(Windows·macOS 동일). 두 길의 차이는 하나뿐이다 — 테스트
   * 버튼은 **물어본다**(그 클릭이 제스처다). 스케줄러의 주기 확인은 제스처가 아니라
   * 물어볼 수 없어, 권한이 `default`인 기기에서는 영영 인앱 토스트만 떴다.
   */
  it('권한을 아직 안 물은 기기: 토스트가 **그 자리에서 허용을 묻는다**(제보)', async () => {
    fakeNotification('default');
    renderHost([EVENT]);
    await settle();

    // 아직 OS 알림은 없다 — 대신 허용을 묻는 길이 토스트에 있다.
    expect(osNotifications).toEqual([]);
    const allow = document.querySelector('[data-reminder-allow]') as HTMLButtonElement;
    expect(allow).toBeTruthy();

    // 누르면(=제스처) 물어보고, 허용되면 **그 알림을 그 자리에서 띄운다**.
    (Notification as unknown as { permission: string }).permission = 'granted';
    await act(async () => {
      fireEvent.click(allow);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(Notification.requestPermission).toHaveBeenCalled();
    expect(osNotifications).toEqual([{ title: '팀 회의', body: '오전 10:30 · 10분 후 시작' }]);
    expect(document.querySelector('[data-reminder-allow]')).toBeNull();
  });

  it('막아 둔 기기에는 그 버튼을 내지 않는다 — 브라우저가 다시 묻지 않아 죽은 버튼이 된다', async () => {
    fakeNotification('denied');
    renderHost([EVENT]);
    await settle();
    expect(document.querySelector('[data-reminder-toast]')).toBeTruthy();
    expect(document.querySelector('[data-reminder-allow]')).toBeNull();
  });

  it('OS 알림이 떴으면 허용을 묻지 않는다(무회귀)', async () => {
    fakeNotification('granted');
    renderHost([EVENT]);
    await settle();
    expect(osNotifications).toHaveLength(1);
    expect(document.querySelector('[data-reminder-allow]')).toBeNull();
  });

  it('같은 알림은 두 번 뜨지 않는다 — 닫은 뒤 다음 확인에도 되돌아오지 않는다', async () => {
    fakeNotification('granted');
    renderHost([EVENT]);
    await settle();
    fireEvent.click(screen.getByLabelText('알림 닫기'));
    expect(document.querySelector('[data-reminder-toast]')).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(REMINDER_TICK_MS * 3);
      await Promise.resolve();
    });
    expect(document.querySelector('[data-reminder-toast]')).toBeNull();
    expect(osNotifications.length).toBe(1);
  });

  // ── 토스트 ↔ 우편함(요청) ──────────────────────────────────────────────
  //
  // 같은 알림이 두 자리에 있다. 한쪽에서 확인했는데 다른 쪽에 그대로 남으면
  // 사용자는 같은 알림을 두 번 처리해야 한다.

  it('토스트를 닫으면 **우편함 기록도 읽음**이 된다', async () => {
    fakeNotification('granted');
    renderHost([EVENT]);
    await settle();
    expect(listReminderNotices().map((n) => n.read)).toEqual([false]);

    fireEvent.click(screen.getByLabelText('알림 닫기'));
    expect(listReminderNotices().map((n) => n.read)).toEqual([true]);
  });

  it('`일정 보기`를 눌러도 읽음이 된다 — 그것도 액션이다', async () => {
    fakeNotification('granted');
    renderHost([EVENT]);
    await settle();

    fireEvent.click(screen.getByText('일정 보기'));
    expect(listReminderNotices().map((n) => n.read)).toEqual([true]);
  });

  it('OS 알림을 눌러도 읽음이 된다', async () => {
    fakeNotification('granted');
    renderHost([EVENT]);
    await settle();

    act(() => lastNotificationClick?.());
    expect(listReminderNotices().map((n) => n.read)).toEqual([true]);
  });

  it('**반대 방향** — 우편함을 열어 전부 읽음이 되면 떠 있던 토스트가 내려간다', async () => {
    fakeNotification('granted');
    renderHost([EVENT]);
    await settle();
    expect(document.querySelector('[data-reminder-toast]')).toBeTruthy();

    // 홈 LNB의 알림 패널을 여는 것이 하는 일(`NotificationsContext.markAllRead`).
    await act(async () => {
      markReminderNoticesRead();
      await Promise.resolve();
    });
    expect(document.querySelector('[data-reminder-toast]')).toBeNull();
  });

  it('설정에서 끄면 아무것도 뜨지 않는다', async () => {
    fakeNotification('granted');
    setRemindersEnabled(false);
    renderHost([EVENT]);
    await settle();
    await act(async () => {
      vi.advanceTimersByTime(REMINDER_TICK_MS * 2);
      await Promise.resolve();
    });
    expect(document.querySelector('[data-reminder-toast]')).toBeNull();
    expect(osNotifications).toEqual([]);
  });

  it('방금 건 알림은 **주기를 기다리지 않는다**(제보) — 그 자리에서 뜬다', async () => {
    fakeNotification('granted');
    // 알림 없는 일정으로 시작한다 — 사용자가 팝업에서 `10분 전`을 고르기 전 상태.
    renderHost([{ ...EVENT, reminderMinutes: undefined }]);
    await settle();
    expect(document.querySelector('[data-reminder-toast]')).toBeNull();

    // 팝업이 저장한 것과 같은 일을 한다: 표에 적고 **바뀌었다고 알린다**.
    localStorage.setItem('mf_events', JSON.stringify([EVENT]));
    await act(async () => {
      notifyCalendarChanged();
      await Promise.resolve();
    });

    // 5분(재조회 주기)을 흘려 보내지 않았는데도 떠 있어야 한다 — 그 주기를 기다리면
    // 알림 시각이 이미 유예를 넘겨 영영 뜨지 않는다(제보의 그 경우).
    expect(document.querySelector('[data-reminder-toast]')).toBeTruthy();
    expect(osNotifications).toEqual([{ title: '팀 회의', body: '오전 10:30 · 10분 후 시작' }]);
  });

  it('알림을 걸지 않은 일정은 대상이 아니다', async () => {
    fakeNotification('granted');
    renderHost([{ ...EVENT, reminderMinutes: undefined }]);
    await settle();
    expect(document.querySelector('[data-reminder-toast]')).toBeNull();
  });

  it('`일정 보기`를 누르면 일정 화면으로 간다 — 에디터에서도', async () => {
    fakeNotification('granted');
    renderHost([EVENT]);
    await settle();
    expect(screen.getByText('EDITOR')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByText('일정 보기'));
    });
    expect(screen.getByText('HOME')).toBeTruthy();
    // 홈이 새로 마운트될 때 읽는 "이 탭이 보던 화면"도 일정으로 고쳐 둔다.
    expect(JSON.parse(sessionStorage.getItem(ACTIVE_VIEW_KEY)!)).toMatchObject({ activeCal: true });
    // 누른 알림은 사라진다(같은 알림을 다시 보여 줄 이유가 없다).
    expect(document.querySelector('[data-reminder-toast]')).toBeNull();
  });

  it('`일정 보기`는 화면만 바꾸지 않는다 — **그 일정**을 함께 넘긴다(제보)', async () => {
    fakeNotification('granted');
    renderHost([EVENT]);
    await settle();
    await act(async () => {
      fireEvent.click(screen.getByText('일정 보기'));
    });
    // 컨트롤러가 이것으로 달을 옮기고 그 날을 골라 상세까지 연다 — 화면만 바꾸면
    // 이미 일정 화면이던 사람에게는 아무 일도 일어나지 않는다.
    expect(takeCalendarFocus()).toEqual({ date: '2026-09-15', eventId: 'ev1', source: 'geurio' });
  });

  it('OS 알림을 눌러도 같은 일정을 넘긴다', async () => {
    fakeNotification('granted');
    renderHost([EVENT]);
    await settle();
    await act(async () => {
      // 브라우저가 알림 클릭에 부르는 그 핸들러.
      lastNotificationClick!();
    });
    expect(takeCalendarFocus()).toEqual({ date: '2026-09-15', eventId: 'ev1', source: 'geurio' });
  });
});

describe('구글 일정 알림(2단계)', () => {
  it('켜 두면 구글 일정도 같은 토스트·OS 알림으로 뜬다(캘린더 기본 알림)', async () => {
    fakeNotification('granted');
    setGoogleRemindersEnabled(true);
    // 일정에 건 알림이 없는 평범한 구글 일정 — 그 캘린더의 기본(10분 전)을 따른다.
    seedGoogle([{ ...GOOGLE_EVENT, reminders: { useDefault: true } }], 10);
    renderHost([]);
    // 구글 조회는 토큰 → 캘린더별 요청 → json까지 여러 번 접히므로 넉넉히 흘린다.
    for (let i = 0; i < 8; i += 1) await settle();

    const toast = document.querySelector('[data-reminder-toast]') as HTMLElement;
    expect(toast).toBeTruthy();
    expect(toast.querySelector('[data-reminder-title]')!.textContent).toBe('구글 회의');
    expect(osNotifications).toEqual([{ title: '구글 회의', body: '오전 10:30 · 10분 후 시작' }]);
  });

  it('꺼져 있으면 구글에 **왕복이 한 번도 나가지 않는다**(기본값)', async () => {
    fakeNotification('granted');
    seedGoogle([{ ...GOOGLE_EVENT, reminders: { useDefault: true } }], 10);
    renderHost([]);
    await settle();
    await act(async () => {
      vi.advanceTimersByTime(REMINDER_TICK_MS * 2);
      await Promise.resolve();
    });
    expect(googleCalls).toEqual([]);
    expect(document.querySelector('[data-reminder-toast]')).toBeNull();
  });
});

// 알림 설정이 **계정을 따라 기기 간에 같아지는가**(제보: 크롬에는 알림이 오는데
// 설치형 앱에는 오지 않았다). 여기서 "앱"은 계정 값이 없는 새 기기다 — 크롬에서
// 켠 값을 받아 오는지, 그리고 캘린더 거울을 스스로 만드는지 본다.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpaceStore, WorkspaceData } from '../../adapters/ports';

const ensureGoogleToken = vi.fn();
const fetchCalendarList = vi.fn();

vi.mock('../home/calendar/googleCalendar', async () => {
  const actual = await vi.importActual<typeof import('../home/calendar/googleCalendar')>('../home/calendar/googleCalendar');
  return {
    ...actual,
    ensureGoogleToken: (...a: unknown[]) => ensureGoogleToken(...a),
    fetchCalendarList: (...a: unknown[]) => fetchCalendarList(...a),
  };
});

const { googleRemindersEnabled, remindersEnabled, setGoogleRemindersEnabled } = await import('./reminderPrefs');
const { readReminderCalendars } = await import('../home/calendar/googleCalendar');
const { noteSyncedReminderPrefs, resetReminderSync, syncRemindersFromAccount } = await import('./reminderSync');

function store(ws: WorkspaceData | null): SpaceStore & { load: ReturnType<typeof vi.fn> } {
  const load = vi.fn().mockResolvedValue(ws);
  return { load, save: vi.fn().mockResolvedValue(undefined) } as unknown as SpaceStore & { load: ReturnType<typeof vi.fn> };
}

const WS = (over: Partial<WorkspaceData> = {}): WorkspaceData => ({ spaces: [], mapFolders: {}, ...over });

beforeEach(() => {
  localStorage.clear();
  resetReminderSync();
  ensureGoogleToken.mockReset().mockResolvedValue({ token: { accessToken: 'tok' } });
  fetchCalendarList.mockReset().mockResolvedValue([{ id: 'cal-a', summary: 'A', defaultMinutes: 10 }]);
});

describe('알림 설정은 계정을 따라온다', () => {
  it('계정에 켜져 있으면 이 기기의 기본값(꺼짐)을 이긴다 — 제보의 그 상황', async () => {
    // 이 기기(앱)는 아무것도 고른 적이 없다 = 구글 일정 알림이 기본 꺼짐.
    expect(googleRemindersEnabled()).toBe(false);
    await syncRemindersFromAccount(store(WS({ reminders: { on: true, google: true } })));
    expect(googleRemindersEnabled()).toBe(true);
    expect(remindersEnabled()).toBe(true);
  });

  it('계정에 값이 없으면(옛 블롭) 이 기기의 설정을 덮지 않는다', async () => {
    setGoogleRemindersEnabled(true);
    await syncRemindersFromAccount(store(WS()));
    expect(googleRemindersEnabled()).toBe(true);
  });

  it('홈이 이미 넘겨 주었으면 에디터는 같은 조회를 내지 않는다', async () => {
    noteSyncedReminderPrefs({ google: true }, { calendars: [] });
    const s = store(WS());
    await syncRemindersFromAccount(s);
    expect(s.load).not.toHaveBeenCalled();
    expect(googleRemindersEnabled()).toBe(true);
  });

  it('조회가 실패해도 이 기기의 캐시로 그대로 돈다', async () => {
    setGoogleRemindersEnabled(true);
    const s = { load: vi.fn().mockRejectedValue(new Error('offline')), save: vi.fn() } as unknown as SpaceStore;
    await expect(syncRemindersFromAccount(s)).resolves.toBeUndefined();
    expect(googleRemindersEnabled()).toBe(true);
  });
});

describe('캘린더 거울을 계정 값에서 만든다', () => {
  it('일정 화면을 한 번도 열지 않은 기기도 구글 알림 대상을 안다', async () => {
    expect(readReminderCalendars()).toEqual([]);
    await syncRemindersFromAccount(store(WS({ reminders: { google: true }, google: { calendars: ['cal-a'] } })));
    await vi.waitFor(() => expect(readReminderCalendars()).toEqual([{ id: 'cal-a', defaultMinutes: 10 }]));
  });

  it('공휴일 캘린더는 담지 않는다 — 종일이라 알림이 없다', async () => {
    await syncRemindersFromAccount(
      store(WS({ reminders: { google: true }, google: { calendars: ['cal-a', 'ko.south_korea#holiday@group.v.calendar.google.com'] } })),
    );
    await vi.waitFor(() => expect(readReminderCalendars().map((c) => c.id)).toEqual(['cal-a']));
  });

  it('꺼 둔 사람에게는 왕복이 한 번도 나가지 않는다', async () => {
    await syncRemindersFromAccount(store(WS({ reminders: { google: false }, google: { calendars: ['cal-a'] } })));
    expect(ensureGoogleToken).not.toHaveBeenCalled();
    expect(fetchCalendarList).not.toHaveBeenCalled();
  });

  it('나중에 켜도 거울을 만든다 — 켠 뒤 일정 화면을 열어야 알림이 오면 안 된다', async () => {
    await syncRemindersFromAccount(store(WS({ google: { calendars: ['cal-a'] } })));
    expect(fetchCalendarList).not.toHaveBeenCalled();
    setGoogleRemindersEnabled(true);
    await vi.waitFor(() => expect(readReminderCalendars()).toEqual([{ id: 'cal-a', defaultMinutes: 10 }]));
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { BackendProvider } from '../../adapters/BackendContext';
import { LocalAuth } from '../../adapters/local/localAuth';
import { LocalSpaceStore } from '../../adapters/local/localSpaceStore';
import { LocalShareStore } from '../../adapters/local/localShareStore';
import { LocalFeedbackStore } from '../../adapters/local/localFeedbackStore';
import { LocalCommentStore } from '../../adapters/local/localCommentStore';
import { LocalNotificationStore } from '../../adapters/local/localNotificationStore';
import { LocalEventStore } from '../../adapters/local/localEventStore';
import { LocalImageStore } from '../../adapters/local/localImageStore';
import type { Backend, CalendarEvent, DocMeta, DocStore, LoadedDoc, SaveResult } from '../../adapters/ports';
import { ReminderHost } from './ReminderHost';
import { reminderNotificationId } from './nativeSchedule';
import { setRemindersEnabled } from './reminderPrefs';

/**
 * 모바일 로컬 알림(3단계) — **OS가 예약을 들고 있다**.
 *
 * 여기서 보는 것은 세 가지다: ① 앞으로의 알림이 OS에 맡겨지고 ② 그동안 우리는
 * 띄우지 않으며(같은 알림이 둘이 되지 않게) ③ 권한이 없으면 맡길 수 없으므로
 * 예전처럼 우리가 띄운다. 플러그인은 목이고, 순수 계획은 `nativeSchedule.test.ts`.
 */

const H = vi.hoisted(() => ({
  native: true,
  permission: 'granted' as 'granted' | 'denied' | 'prompt',
  pending: [] as { id: number }[],
  scheduled: [] as { id: number; title: string; body: string; schedule: { at: Date }; extra: unknown }[],
  cancelled: [] as number[],
  listeners: {} as Record<string, ((e: unknown) => void)[]>,
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => H.native,
    getPlatform: () => (H.native ? 'android' : 'web'),
  },
}));

vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    checkPermissions: async () => ({ display: H.permission }),
    requestPermissions: async () => ({ display: H.permission }),
    getPending: async () => ({ notifications: H.pending }),
    schedule: async (o: { notifications: typeof H.scheduled }) => {
      H.scheduled.push(...o.notifications);
      H.pending = [...H.pending, ...o.notifications.map((n) => ({ id: n.id }))];
    },
    cancel: async (o: { notifications: { id: number }[] }) => {
      const ids = o.notifications.map((n) => n.id);
      H.cancelled.push(...ids);
      H.pending = H.pending.filter((p) => !ids.includes(p.id));
    },
    addListener: async (ev: string, fn: (e: unknown) => void) => {
      (H.listeners[ev] ||= []).push(fn);
      return { remove: async () => undefined };
    },
  },
}));

/** 10:22에 선다: 10:30 일정(10분 알림)은 **이미 지났고**(10:20) 14:00 일정은 앞으로다. */
const NOW = new Date(2026, 8, 15, 10, 22, 0);

const PAST: CalendarEvent = {
  id: 'ev-past',
  title: '팀 회의',
  startDate: '2026-09-15',
  endDate: '2026-09-15',
  allDay: false,
  startTime: '10:30',
  endTime: '11:30',
  reminderMinutes: 10,
  source: 'geurio',
};

const SOON: CalendarEvent = {
  ...PAST,
  id: 'ev-soon',
  title: '오후 리뷰',
  startTime: '14:00',
  endTime: '15:00',
};

class StubDocStore implements DocStore {
  listEditorNames = vi.fn(async (): Promise<Record<string, string>> => ({}));
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

function renderHost(events: CalendarEvent[]) {
  localStorage.setItem('mf_events', JSON.stringify(events));
  const backend: Backend = {
    auth: new LocalAuth(),
    docStore: new StubDocStore(),
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

/** 조회·권한 확인·예약이 전부 약속이라 여러 번 흘려 보낸다. */
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  H.native = true;
  H.permission = 'granted';
  H.pending = [];
  H.scheduled = [];
  H.cancelled = [];
  H.listeners = {};
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('모바일 로컬 알림', () => {
  it('앞으로의 알림을 OS에 맡기고, 그동안 우리는 띄우지 않는다', async () => {
    renderHost([PAST, SOON]);
    await settle();

    // 지난 알림은 OS에 맡기지 않는다(미래만 뜻이 있다) — 앞으로의 것 하나뿐.
    expect(H.scheduled).toHaveLength(1);
    const n = H.scheduled[0]!;
    expect(n.title).toBe('오후 리뷰');
    expect(n.body).toBe('오후 2:00 · 10분 후 시작');
    expect(n.schedule.at.getTime()).toBe(new Date(2026, 8, 15, 13, 50).getTime());
    expect(n.id).toBe(reminderNotificationId('ev-soon#2026-09-15', n.schedule.at.getTime(), '오후 리뷰'));

    // OS가 들고 있으므로 우리 주기 확인은 띄우지 않는다 — 유예 안쪽의 지난 알림도.
    expect(document.querySelector('[data-reminder-toast]')).toBeNull();
  });

  it('같은 목록을 다시 동기화해도 다시 심지 않는다(멱등)', async () => {
    renderHost([SOON]);
    await settle();
    expect(H.scheduled).toHaveLength(1);
    await act(async () => {
      vi.advanceTimersByTime(5 * 60_000);
    });
    await settle();
    expect(H.scheduled).toHaveLength(1);
    expect(H.cancelled).toEqual([]);
  });

  it('알림을 끄면 걸려 있던 예약을 전부 거둔다', async () => {
    renderHost([SOON]);
    await settle();
    const id = H.scheduled[0]!.id;

    await act(async () => {
      setRemindersEnabled(false);
    });
    await settle();
    expect(H.cancelled).toEqual([id]);
  });

  it('권한이 없으면 맡기지 않고 **예전처럼 우리가 띄운다**', async () => {
    H.permission = 'denied';
    renderHost([PAST, SOON]);
    await settle();

    expect(H.scheduled).toEqual([]);
    const toast = document.querySelector('[data-reminder-toast]');
    expect(toast).toBeTruthy();
    expect(toast!.textContent).toContain('팀 회의');
  });

  it('OS가 띄운 알림은 인앱 토스트로 잇고, 탭하면 일정 화면으로 간다', async () => {
    renderHost([SOON]);
    await settle();
    const extra = H.scheduled[0]!.extra;

    await act(async () => {
      for (const fn of H.listeners.localNotificationReceived ?? []) fn({ extra });
    });
    expect(document.querySelector('[data-reminder-toast]')!.textContent).toContain('오후 리뷰');

    await act(async () => {
      for (const fn of H.listeners.localNotificationActionPerformed ?? []) fn({ notification: { extra } });
    });
    expect(screen.getByText('HOME')).toBeTruthy();
  });

  it('웹에서는 플러그인을 건드리지 않는다(무회귀)', async () => {
    H.native = false;
    renderHost([PAST, SOON]);
    await settle();
    expect(H.scheduled).toEqual([]);
    expect(H.listeners).toEqual({});
    // 웹은 예전 경로 그대로 — 유예 안쪽의 지난 알림을 우리가 띄운다.
    expect(document.querySelector('[data-reminder-toast]')!.textContent).toContain('팀 회의');
  });
});

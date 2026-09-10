import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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
import { ACTIVE_VIEW_KEY } from '../home/storage';
import { ReminderHost } from './ReminderHost';
import { REMINDER_TICK_MS } from './reminders';
import { setRemindersEnabled } from './reminderPrefs';

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

let osNotifications: { title: string; body: string }[] = [];

function fakeNotification(permission: 'granted' | 'denied' | 'default'): void {
  class FakeNotification {
    static permission = permission;
    static requestPermission = vi.fn(async () => permission);
    onclick: (() => void) | null = null;
    close = vi.fn();
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
    feedbackStore: new LocalFeedbackStore(),
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
    expect(JSON.parse(sessionStorage.getItem(ACTIVE_VIEW_KEY)!)).toMatchObject({ activeCal: true, activeDash: null });
    // 누른 알림은 사라진다(같은 알림을 다시 보여 줄 이유가 없다).
    expect(document.querySelector('[data-reminder-toast]')).toBeNull();
  });
});

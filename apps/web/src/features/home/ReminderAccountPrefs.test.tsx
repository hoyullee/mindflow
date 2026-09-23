// 알림 설정의 정본이 **계정**인가(제보: 크롬에는 알림이 왔는데 설치형 앱에는 오지
// 않았다 — 두 클라이언트에 따로 켜져 있었다).
//
// 여기서 보는 것은 두 방향이다: 설정에서 끄면 계정에 실리는가, 그리고 계정에 실린
// 값이 이 기기의 기본값을 이기는가(= 다른 기기에서 켠 것이 따라오는가).

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Home } from './Home';
import { BackendProvider } from '../../adapters/BackendContext';
import type { Backend, WorkspaceData } from '../../adapters/ports';
import { LocalAuth } from '../../adapters/local/localAuth';
import { LocalSpaceStore } from '../../adapters/local/localSpaceStore';
import { LocalShareStore } from '../../adapters/local/localShareStore';
import { LocalFeedbackStore } from '../../adapters/local/localFeedbackStore';
import { LocalTagStore } from '../../adapters/local/localTagStore';
import { LocalImageStore } from '../../adapters/local/localImageStore';
import { LocalCommentStore } from '../../adapters/local/localCommentStore';
import { LocalNotificationStore } from '../../adapters/local/localNotificationStore';
import { LocalEventStore } from '../../adapters/local/localEventStore';
import { LocalDocStore } from '../../adapters/local/localDocStore';
import { googleRemindersEnabled, remindersEnabled, setGoogleRemindersEnabled } from '../reminders/reminderPrefs';
import { resetReminderSync } from '../reminders/reminderSync';
import { mockMatchMedia } from '../../test/matchMedia';

const SPACES_KEY = 'mf_spaces';

function seedWorkspace(over: Partial<WorkspaceData>): void {
  localStorage.setItem(SPACES_KEY, JSON.stringify({ v: 1, spaces: [{ id: 's1', name: '일반 스페이스', color: '#f0663f', maps: [] }], mapFolders: {}, recent: [], dashboards: [], ...over }));
}

function savedWorkspace(): WorkspaceData {
  return JSON.parse(localStorage.getItem(SPACES_KEY) ?? '{}') as WorkspaceData;
}

function renderHome() {
  const backend: Backend = {
    auth: new LocalAuth(),
    docStore: new LocalDocStore(),
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
    <MemoryRouter initialEntries={['/home']}>
      <BackendProvider backend={backend}>
        <Routes>
          <Route path="/home" element={<Home />} />
        </Routes>
      </BackendProvider>
    </MemoryRouter>,
  );
}

/** 설정 → 알림 화면(세 스위치가 거기 있다). */
async function openNotifySettings(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await user.click(await screen.findByRole('button', { name: '계정 메뉴' }));
  await user.click(screen.getByRole('button', { name: '설정' }));
  const dialog = screen.getByRole('dialog', { name: '설정' });
  const row = await waitFor(() => {
    const el = dialog.querySelector('[data-notify-detail-row]');
    expect(el).toBeTruthy();
    return el as HTMLElement;
  });
  await user.click(row);
  return dialog;
}

beforeEach(() => {
  localStorage.clear();
  resetReminderSync();
  mockMatchMedia(false);
  vi.stubGlobal('Notification', Object.assign(function () {}, { permission: 'granted', requestPermission: async () => 'granted' }));
});

describe('일정 알림 설정은 계정에 저장된다', () => {
  it('설정에서 끄면 워크스페이스 블롭에 실린다 — 다른 기기도 따라오게', async () => {
    seedWorkspace({});
    const user = userEvent.setup();
    renderHome();
    const dialog = await openNotifySettings(user);
    await user.click(await waitFor(() => dialog.querySelector('[role="switch"][aria-label="일정 알림"]') as HTMLElement));
    await waitFor(() => expect(savedWorkspace().reminders).toEqual({ on: false }));
    expect(remindersEnabled()).toBe(false);
  });

  it('계정에 켜져 있으면 이 기기의 기본값(꺼짐)을 이긴다 — 제보의 그 상황', async () => {
    // 크롬에서 켠 사람: 계정에는 `google: true`가 실려 있고, 이 기기(앱)는 처음이다.
    seedWorkspace({ reminders: { google: true } });
    expect(googleRemindersEnabled()).toBe(false);
    renderHome();
    await waitFor(() => expect(googleRemindersEnabled()).toBe(true));
  });

  it('계정에 값이 없으면(옛 블롭) 이 기기가 고른 값을 올려 준다', async () => {
    seedWorkspace({});
    setGoogleRemindersEnabled(true);
    renderHome();
    await waitFor(() => expect(savedWorkspace().reminders).toEqual({ google: true }));
  });
});

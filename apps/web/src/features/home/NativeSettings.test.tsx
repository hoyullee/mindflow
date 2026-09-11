// 모바일 앱의 설정 — **알림 행이 그려지는가**(3단계).
//
// 이 화면이 이 단계에서 가장 조용히 깨져 있던 자리다: Capacitor WebView에는 웹
// `Notification`이 아예 없어서 `notifyPermission()`이 늘 `unsupported`였고, 그
// 결과 **모바일 앱에서만** 일정 알림 행이 통째로 사라졌다 — 정작 OS 알림이 가장
// 값진 곳에서. 권한은 이제 로컬 알림 플러그인에 묻는다.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const H = vi.hoisted(() => ({
  permission: 'granted' as 'granted' | 'denied' | 'prompt',
  requested: 0,
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' },
}));

vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    checkPermissions: async () => ({ display: H.permission }),
    requestPermissions: async () => {
      H.requested += 1;
      return { display: H.permission };
    },
    getPending: async () => ({ notifications: [] }),
    schedule: async () => undefined,
    cancel: async () => undefined,
    addListener: async () => ({ remove: async () => undefined }),
  },
}));

import { Home } from './Home';
import { BackendProvider } from '../../adapters/BackendContext';
import type { Backend } from '../../adapters/ports';
import { LocalAuth } from '../../adapters/local/localAuth';
import { LocalSpaceStore } from '../../adapters/local/localSpaceStore';
import { LocalShareStore } from '../../adapters/local/localShareStore';
import { LocalFeedbackStore } from '../../adapters/local/localFeedbackStore';
import { LocalImageStore } from '../../adapters/local/localImageStore';
import { LocalCommentStore } from '../../adapters/local/localCommentStore';
import { LocalNotificationStore } from '../../adapters/local/localNotificationStore';
import { LocalEventStore } from '../../adapters/local/localEventStore';
import { LocalDocStore } from '../../adapters/local/localDocStore';
import { mockMatchMedia } from '../../test/matchMedia';

function renderHome() {
  const backend: Backend = {
    auth: new LocalAuth(),
    docStore: new LocalDocStore(),
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
        </Routes>
      </BackendProvider>
    </MemoryRouter>,
  );
}

async function openSettings(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await user.click(await screen.findByRole('button', { name: '계정 메뉴' }));
  await user.click(screen.getByRole('button', { name: '설정' }));
  return screen.getByRole('dialog', { name: '설정' });
}

describe('모바일 앱의 일정 알림 설정', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u1', email: 'me@example.com' } }));
    H.permission = 'granted';
    H.requested = 0;
  });
  afterEach(cleanup);

  it('웹 `Notification`이 없어도 행이 뜨고, 권한은 OS에서 읽는다', async () => {
    // jsdom 기본값 그대로 — `Notification`을 스텁하지 않는다(모바일 WebView와 같다).
    expect(typeof Notification).toBe('undefined');
    const user = userEvent.setup();
    renderHome();
    const dialog = await openSettings(user);

    const group = dialog.querySelector('[data-remind-group]') as HTMLElement;
    expect(group).toBeTruthy();
    await waitFor(() => {
      expect(group.querySelector('[data-remind-note]')!.textContent).toContain('함께 떠요');
    });
    // 이미 허용돼 있으므로 물어볼 자리는 없다.
    expect(group.querySelector('[data-remind-allow]')).toBeNull();
  });

  it('아직 안 물었으면 허용 버튼이 뜨고, 누르면 **플러그인에** 권한을 요청한다', async () => {
    H.permission = 'prompt';
    const user = userEvent.setup();
    renderHome();
    const dialog = await openSettings(user);
    const group = dialog.querySelector('[data-remind-group]') as HTMLElement;

    const allow = await waitFor(() => {
      const el = group.querySelector('[data-remind-allow]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    await user.click(allow);
    await waitFor(() => expect(H.requested).toBe(1));
  });
});

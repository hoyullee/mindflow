// 설정 › 알림의 **멘션 메일** 스위치(0039).
//
// 이 행은 일정 알림 구획과 달리 **권한과 무관하게 언제나** 서야 한다 — 웹
// `Notification`이 없는 환경(jsdom·모바일 WebView)에서도 메일은 나가기 때문이다.
// 아래 첫 테스트가 그것을 못박는다(`Notification`을 스텁하지 않는다).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { Home } from './Home';
import { BackendProvider } from '../../adapters/BackendContext';
import { DEFAULT_NOTIFICATION_PREFS, type Backend, type NotificationPrefs } from '../../adapters/ports';
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

/** 저장이 실패하는 저장소 — 스위치가 제자리로 돌아오는지 보려고. */
function renderHome(store = new LocalNotificationStore()) {
  const backend: Backend = {
    auth: new LocalAuth(),
    docStore: new LocalDocStore(),
    spaceStore: new LocalSpaceStore(),
    shareStore: new LocalShareStore(),
    feedbackStore: new LocalFeedbackStore(),
    imageStore: new LocalImageStore(),
    commentStore: new LocalCommentStore(),
    notificationStore: store,
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

describe('설정 › 알림 — 멘션 메일', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u1', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  it('OS 알림을 못 띄우는 환경에서도 행이 선다(메일은 권한과 무관하다)', async () => {
    expect(typeof Notification).toBe('undefined');
    const user = userEvent.setup();
    renderHome();
    const dialog = await openNotifySettings(user);

    const group = await waitFor(() => {
      const el = dialog.querySelector('[data-mention-mail-group]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    // 기본은 켜짐 — 서버의 "행이 없으면 켜짐"과 같은 값이다.
    await waitFor(() => {
      expect(group.querySelector('[data-mention-mail-note]')!.textContent).toContain('30분에 한 번');
    });
  });

  it('끄면 저장되고, 다시 열어도 꺼진 채다', async () => {
    const store = new LocalNotificationStore();
    const user = userEvent.setup();
    const { unmount } = renderHome(store);
    let dialog = await openNotifySettings(user);
    let group = dialog.querySelector('[data-mention-mail-group]') as HTMLElement;
    await waitFor(() => expect(group.querySelector('[data-mention-mail-note]')!.textContent).toContain('30분에 한 번'));

    await user.click(group.querySelector('[role="switch"]') as HTMLElement);
    await waitFor(() => {
      expect(group.querySelector('[data-mention-mail-note]')!.textContent).toContain('메일로 알리지 않아요');
    });
    await waitFor(async () => {
      expect((await store.loadPrefs()).emailMentions).toBe(false);
    });

    // 다시 열었을 때 꺼진 채로 복원되는가(저장이 진짜인가).
    unmount();
    cleanup();
    const user2 = userEvent.setup();
    renderHome(new LocalNotificationStore());
    dialog = await openNotifySettings(user2);
    group = dialog.querySelector('[data-mention-mail-group]') as HTMLElement;
    await waitFor(() => {
      expect(group.querySelector('[data-mention-mail-note]')!.textContent).toContain('메일로 알리지 않아요');
    });
  });

  it('저장이 실패하면 스위치가 제자리로 돌아온다(거짓말하지 않는다)', async () => {
    const store = new LocalNotificationStore();
    vi.spyOn(store, 'savePrefs').mockResolvedValue({ error: '저장 실패' });
    vi.spyOn(store, 'loadPrefs').mockResolvedValue(DEFAULT_NOTIFICATION_PREFS satisfies NotificationPrefs);
    const user = userEvent.setup();
    renderHome(store);
    const dialog = await openNotifySettings(user);
    const group = dialog.querySelector('[data-mention-mail-group]') as HTMLElement;
    await waitFor(() => expect(group.querySelector('[data-mention-mail-note]')!.textContent).toContain('30분에 한 번'));

    await user.click(group.querySelector('[role="switch"]') as HTMLElement);
    await waitFor(() => {
      expect(group.querySelector('[data-mention-mail-note]')!.textContent).toContain('30분에 한 번');
    });
  });
});

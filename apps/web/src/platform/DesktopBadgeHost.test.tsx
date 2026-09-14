// 작업 표시줄 배지가 **어느 화면에서든** 지금 개수를 보여 준다(요청).
//
// 배지는 앱이 화면 밖에 있을 때 보이는 표시인데, 그때 렌더러가 들고 있는 화면은
// 홈일 수도 에디터일 수도 있다 — 그래서 알림 상태·배지 호스트가 **문지기 안**에
// 있다. 이 테스트는 그 자리를 지킨다(홈으로 되돌리면 실패한다).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { RequireAuth } from '../App';
import { BackendProvider } from '../adapters/BackendContext';
import { DEFAULT_NOTIFICATION_PREFS, type AppNotification, type Backend } from '../adapters/ports';
import { LocalAuth } from '../adapters/local/localAuth';
import { LocalDocStore } from '../adapters/local/localDocStore';
import { LocalSpaceStore } from '../adapters/local/localSpaceStore';
import { LocalShareStore } from '../adapters/local/localShareStore';
import { LocalFeedbackStore } from '../adapters/local/localFeedbackStore';
import { LocalImageStore } from '../adapters/local/localImageStore';
import { LocalCommentStore } from '../adapters/local/localCommentStore';
import { LocalEventStore } from '../adapters/local/localEventStore';

beforeEach(() => {
  // jsdom에는 캔버스가 없다 — 그대로 두면 `getContext`가 가상 콘솔에 오류를 흘린다
  // (던지지는 않는다). 배지는 **그림 없이도 개수를 보내는** 것이 계약이라, 여기서는
  // 그 경로를 또렷하게 만든다.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null as never);
});

afterEach(() => {
  cleanup();
  delete (window as { geurio?: unknown }).geurio;
  localStorage.clear();
  vi.restoreAllMocks();
});

function unreadItem(id: string): AppNotification {
  return {
    id,
    kind: 'mention',
    documentId: 'd1',
    nodeId: null,
    actorName: '여은진',
    preview: '확인 부탁해요',
    docTitle: '기획',
    createdAt: new Date().toISOString(),
    read: false,
  };
}

function renderGuarded(items: AppNotification[], path = '/editor') {
  const backend: Backend = {
    auth: new LocalAuth(),
    docStore: new LocalDocStore(),
    spaceStore: new LocalSpaceStore(),
    shareStore: new LocalShareStore(),
    feedbackStore: new LocalFeedbackStore(),
    imageStore: new LocalImageStore(),
    commentStore: new LocalCommentStore(),
    notificationStore: {
      list: async () => items,
      markAllRead: async () => ({}),
      subscribe: () => () => undefined,
      loadPrefs: async () => DEFAULT_NOTIFICATION_PREFS,
      savePrefs: async () => ({}),
      savePushSubscription: async () => ({}),
      removePushSubscription: async () => ({}),
    },
    eventStore: new LocalEventStore(),
    mode: 'local',
  };
  return render(
    <MemoryRouter initialEntries={[path]}>
      <BackendProvider backend={backend}>
        <Routes>
          <Route
            path={path}
            element={
              <RequireAuth>
                <div>CHILD</div>
              </RequireAuth>
            }
          />
        </Routes>
      </BackendProvider>
    </MemoryRouter>,
  );
}

describe('작업 표시줄 배지', () => {
  it('에디터 화면에서도 안 읽은 알림 수를 셸에 알린다', async () => {
    const setBadge = vi.fn().mockResolvedValue(true);
    (window as unknown as { geurio: unknown }).geurio = {
      desktop: true,
      version: '0.3.0',
      platform: 'win32',
      openExternal: async () => true,
      onDeepLink: () => () => undefined,
      takePendingDeepLink: async () => null,
      setBadge,
    };

    renderGuarded([unreadItem('n1'), unreadItem('n2')]);

    await waitFor(() => {
      const counts = setBadge.mock.calls.map((c) => (c[0] as { count: number }).count);
      expect(counts).toContain(2);
    });
  });

  it('브라우저(셸 없음)에서는 아무 일도 하지 않는다', async () => {
    const { findByText } = renderGuarded([unreadItem('n1')]);
    // 배지 호스트가 화면을 막지 않는다 — 창구가 없으면 조용히 물러날 뿐이다.
    expect(await findByText('CHILD')).toBeTruthy();
  });
});

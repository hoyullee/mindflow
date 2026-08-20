import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { RequireAuth } from '../../App';
import { BackendProvider } from '../../adapters/BackendContext';
import { LocalAuth } from '../../adapters/local/localAuth';
import { LocalSpaceStore } from '../../adapters/local/localSpaceStore';
import { LocalShareStore } from '../../adapters/local/localShareStore';
import { LocalFeedbackStore } from '../../adapters/local/localFeedbackStore';
import { LocalCommentStore } from '../../adapters/local/localCommentStore';
import { LocalNotificationStore } from '../../adapters/local/localNotificationStore';
import { LocalImageStore } from '../../adapters/local/localImageStore';
import { LocalDocStore } from '../../adapters/local/localDocStore';
import type { AuthSession, Backend } from '../../adapters/ports';
import { takeLoginNotice } from './sessionNotice';

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

/** supabase 모드(문지기가 실제로 도는 모드)로 고정한 백엔드 — 세션만 갈아 끼운다. */
function renderGuard(session: AuthSession | null) {
  const auth = new LocalAuth();
  vi.spyOn(auth, 'getSession').mockResolvedValue(session);
  vi.spyOn(auth, 'onAuthChange').mockImplementation(() => () => undefined);
  const signOut = vi.spyOn(auth, 'signOut').mockResolvedValue(undefined);
  const backend: Backend = {
    auth,
    docStore: new LocalDocStore(),
    spaceStore: new LocalSpaceStore(),
    shareStore: new LocalShareStore(),
    feedbackStore: new LocalFeedbackStore(),
    imageStore: new LocalImageStore(),
    commentStore: new LocalCommentStore(),
    notificationStore: new LocalNotificationStore(),
    mode: 'supabase',
  };
  render(
    <MemoryRouter initialEntries={['/home']}>
      <BackendProvider backend={backend}>
        <Routes>
          <Route
            path="/home"
            element={
              <RequireAuth>
                <div>HOME_CONTENT</div>
              </RequireAuth>
            }
          />
          <Route path="/login" element={<div>LOGIN_PAGE</div>} />
        </Routes>
      </BackendProvider>
    </MemoryRouter>,
  );
  return { signOut };
}

// 제보: ① 이메일로 A@ 가입 → ② 같은 주소로 Google 로그인 → 두 수단이 연결된다.
// 리다이렉트 방식(`signInWithOAuth`)은 돌아온 시점에 이미 세션이 있어 사전 확인이
// 불가능하므로, 문지기가 그 세션을 보고 거절한다.
describe('Google 연결 거절 — 리다이렉트 경로(문지기)', () => {
  it('이메일 계정에 Google로 들어온 세션은 로그아웃시키고 안내와 함께 로그인으로 보낸다', async () => {
    const { signOut } = renderGuard({ user: { id: 'u1', email: 'a@google.com', signInProvider: 'google', linkedProviders: ['email', 'google'] } });

    await waitFor(() => expect(screen.getByText('LOGIN_PAGE')).toBeTruthy());
    expect(screen.queryByText('HOME_CONTENT')).toBeNull();
    expect(signOut).toHaveBeenCalled();
    expect(takeLoginNotice()).toContain('비밀번호로 가입한 계정');
    // 의도적 로그아웃이므로 "만료" 판정 마커를 남기지 않는다(다음 방문에 거짓 안내 금지).
    expect(localStorage.getItem('mf_had_session')).toBeNull();
  });

  it('Google 전용 계정은 그대로 통과한다', async () => {
    renderGuard({ user: { id: 'u2', email: 'g@google.com', signInProvider: 'google', linkedProviders: ['google'] } });
    await waitFor(() => expect(screen.getByText('HOME_CONTENT')).toBeTruthy());
    expect(takeLoginNotice()).toBeNull();
  });

  it('두 수단이 연결된 계정에 비밀번호로 들어오면 막지 않는다(계정을 잃지 않게)', async () => {
    renderGuard({ user: { id: 'u3', email: 'a@google.com', signInProvider: 'email', linkedProviders: ['email', 'google'] } });
    await waitFor(() => expect(screen.getByText('HOME_CONTENT')).toBeTruthy());
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Login } from './Login';
import { DesktopHandoff } from './DesktopHandoff';
import { buildAuthDeepLink, DESKTOP_HANDOFF_PATH, resetDesktopAuthToken } from './desktopGoogle';
import { mockMatchMedia } from '../../test/matchMedia';
import { BackendProvider } from '../../adapters/BackendContext';
import { LocalAuth } from '../../adapters/local/localAuth';
import { LocalSpaceStore } from '../../adapters/local/localSpaceStore';
import { LocalShareStore } from '../../adapters/local/localShareStore';
import { LocalFeedbackStore } from '../../adapters/local/localFeedbackStore';
import { LocalCommentStore } from '../../adapters/local/localCommentStore';
import { LocalNotificationStore } from '../../adapters/local/localNotificationStore';
import { LocalEventStore } from '../../adapters/local/localEventStore';
import { LocalImageStore } from '../../adapters/local/localImageStore';
import type { AuthResult, Backend, DocStore } from '../../adapters/ports';

const stubDocStore = { list: async () => [] } as unknown as DocStore;

function makeBackend(auth: LocalAuth): Backend {
  return {
    auth,
    docStore: stubDocStore,
    spaceStore: new LocalSpaceStore(),
    shareStore: new LocalShareStore(),
    feedbackStore: new LocalFeedbackStore(),
    imageStore: new LocalImageStore(),
    commentStore: new LocalCommentStore(),
    notificationStore: new LocalNotificationStore(),
    eventStore: new LocalEventStore(),
    mode: 'supabase',
  };
}

/** 설치형 셸이 심어 주는 창구(apps/desktop/src/preload.ts)를 흉내 낸다. */
function installShell() {
  const handlers: Array<(url: string) => void> = [];
  const openExternal = vi.fn(async () => true);
  const takePendingDeepLink = vi.fn(async () => null as string | null);
  (window as unknown as { geurio: unknown }).geurio = {
    desktop: true,
    version: '0.1.0',
    platform: 'win32',
    openExternal,
    onDeepLink: (h: (url: string) => void) => {
      handlers.push(h);
      return () => {
        const i = handlers.indexOf(h);
        if (i >= 0) handlers.splice(i, 1);
      };
    },
    takePendingDeepLink,
  };
  return { openExternal, takePendingDeepLink, fire: (url: string) => handlers.forEach((h) => h(url)) };
}

afterEach(() => {
  cleanup();
  resetDesktopAuthToken();
  window.history.replaceState({}, '', '/');
  delete (window as { geurio?: unknown }).geurio;
  vi.restoreAllMocks();
});

describe('설치형 데스크톱 앱의 Google 로그인', () => {
  it('앱 창에서 열지 않고 **시스템 브라우저**로 넘긴 뒤, 딥링크로 인가 코드를 이어받는다', async () => {
    mockMatchMedia(false);
    const shell = installShell();
    const auth = new LocalAuth();
    const urlSpy = vi.spyOn(auth, 'googleAuthUrl').mockResolvedValue({ url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1' });
    // 앱 창 안에서 도는 리다이렉트 흐름은 **쓰이지 않아야** 한다 — Google이 임베드
    // 웹뷰의 OAuth를 막으므로 그 길로 가면 사용자는 경고 화면을 본다.
    const redirectSpy = vi.spyOn(auth, 'signInWithOAuth');
    const resumeSpy = vi
      .spyOn(auth, 'resumeSession')
      .mockResolvedValue({ session: { user: { id: 'u1', email: 'me@example.com' } } } as AuthResult);
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/login']}>
        <BackendProvider backend={makeBackend(auth)}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/home" element={<div>홈 도착</div>} />
          </Routes>
        </BackendProvider>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Google 계정으로 계속하기' }));

    await waitFor(() => expect(shell.openExternal).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth?x=1'));
    expect(urlSpy).toHaveBeenCalledWith('http://localhost:3000/auth/desktop');
    expect(redirectSpy).not.toHaveBeenCalled();
    // 아무 반응 없이 멈춘 것처럼 보이지 않게 — 브라우저에서 이어서 해야 한다고 말한다.
    expect(document.querySelector('[data-desktop-waiting]')).not.toBe(null);
    expect(screen.getByText(/브라우저에서 Google 로그인을 계속해 주세요/)).toBeTruthy();

    // 브라우저가 끝내고 셸이 딥링크를 넘겨준다. (jsdom은 `geurio://` 이동을
    // "Not implemented: navigation"으로 로그에 남긴다 — 실제 OS에서 앱을 깨우는
    // 그 한 줄이고, 여기서는 그 로그가 정상이다.)
    await act(async () => {
      shell.fire(buildAuthDeepLink('rt-from-browser'));
    });
    // 앱이 그 토큰으로 자기 세션을 세운다 — 브라우저에는 세션이 서지 않았으므로
    // 이 호출이 그 토큰의 첫 사용이다(쓰는 순간 회전한다).
    expect(resumeSpy).toHaveBeenCalledWith('rt-from-browser');
    await waitFor(() => expect(screen.getByText('홈 도착')).toBeTruthy(), { timeout: 3000 });
  });

  it('앱이 꺼져 있는 동안 온 딥링크도 놓치지 않는다(셸이 들고 있다가 넘긴다)', async () => {
    mockMatchMedia(false);
    const shell = installShell();
    shell.takePendingDeepLink.mockResolvedValue(buildAuthDeepLink('rt-cold-start'));
    const auth = new LocalAuth();
    const resumeSpy = vi
      .spyOn(auth, 'resumeSession')
      .mockResolvedValue({ session: { user: { id: 'u1', email: 'me@example.com' } } } as AuthResult);

    render(
      <MemoryRouter initialEntries={['/login']}>
        <BackendProvider backend={makeBackend(auth)}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/home" element={<div>홈 도착</div>} />
          </Routes>
        </BackendProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(resumeSpy).toHaveBeenCalledWith('rt-cold-start'));
  });

  it('브라우저(셸 없음)에서는 지금까지처럼 리다이렉트 흐름을 쓴다', async () => {
    mockMatchMedia(false);
    const auth = new LocalAuth();
    const redirectSpy = vi.spyOn(auth, 'signInWithOAuth').mockResolvedValue({});
    const urlSpy = vi.spyOn(auth, 'googleAuthUrl');
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <BackendProvider backend={makeBackend(auth)}>
          <Login />
        </BackendProvider>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Google 계정으로 계속하기' }));
    await waitFor(() => expect(redirectSpy).toHaveBeenCalled());
    expect(urlSpy).not.toHaveBeenCalled();
    expect(document.querySelector('[data-desktop-waiting]')).toBe(null);
  });
});

describe('/auth/desktop — 브라우저가 앱에 로그인을 넘기는 자리', () => {
  it('해시의 갱신 토큰을 딥링크로 넘긴다 — **세션은 손대지 않는다**', async () => {
    mockMatchMedia(false);
    window.history.replaceState({}, '', `${DESKTOP_HANDOFF_PATH}#access_token=at&refresh_token=rt-handoff`);
    const auth = new LocalAuth();
    // 이 페이지는 Supabase를 쓰지 않는다. 첫 판은 브라우저에 선 세션의 토큰을
    // 넘기고 `signOut('local')`로 사본을 지웠는데, GoTrue의 `local`은 저장소만
    // 비우는 것이 아니라 **그 세션을 서버에서 끊는다** — 앱이 이어받을 토큰이 그
    // 자리에서 무효가 됐다(제보: "인증 코드가 올바르지 않거나 만료되었어요").
    const sessionSpy = vi.spyOn(auth, 'getSession');
    const signOutSpy = vi.spyOn(auth, 'signOut');

    render(
      <MemoryRouter>
        <BackendProvider backend={makeBackend(auth)}>
          <DesktopHandoff />
        </BackendProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('Geurio 앱으로 돌아가세요')).toBeTruthy());
    // 자동 이동이 막혔을 때의 손잡이 — 같은 딥링크를 손으로 누를 수 있다.
    const back = screen.getByRole('link', { name: '앱으로 돌아가기' });
    expect(back.getAttribute('href')).toBe(buildAuthDeepLink('rt-handoff'));
    expect(signOutSpy).not.toHaveBeenCalled();
    expect(sessionSpy).not.toHaveBeenCalled();
  });

  it('넘길 것이 없으면(앱 없이 이 주소를 직접 열었다) 딥링크를 쏘지 않고 안내한다', async () => {
    mockMatchMedia(false);
    window.history.replaceState({}, '', DESKTOP_HANDOFF_PATH);
    const auth = new LocalAuth();

    render(
      <MemoryRouter>
        <BackendProvider backend={makeBackend(auth)}>
          <DesktopHandoff />
        </BackendProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText('로그인 정보를 받지 못했어요')).toBeTruthy();
    expect(screen.queryByRole('link', { name: '앱으로 돌아가기' })).toBe(null);
  });
});

describe('설치형 앱에서는 랜딩(소개 페이지)으로 갈 수 없다', () => {
  function renderLogin() {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <BackendProvider backend={makeBackend(new LocalAuth())}>
          <Routes>
            <Route path="/login" element={<Login />} />
          </Routes>
        </BackendProvider>
      </MemoryRouter>,
    );
  }

  it('로그인 화면의 Geurio 표식이 링크가 아니다(누르면 화면이 틀어지던 제보)', () => {
    mockMatchMedia(false);
    installShell();
    renderLogin();

    // 표식 자체는 그대로 보인다 — 사라지는 것은 "이동"뿐이다.
    expect(screen.getByText('Geurio')).toBeTruthy();
    const links = Array.from(document.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(links).not.toContain('https://geurio.com/');
    expect(document.querySelector('a.mf-login-brand')).toBe(null);
    expect(document.querySelector('span.mf-login-brand')).toBeTruthy();
  });

  it('브라우저에서는 예전처럼 랜딩으로 가는 링크다(무회귀)', () => {
    mockMatchMedia(false);
    renderLogin();

    const brand = document.querySelector('a.mf-login-brand');
    expect(brand?.getAttribute('href')).toBe('https://geurio.com/');
  });
});

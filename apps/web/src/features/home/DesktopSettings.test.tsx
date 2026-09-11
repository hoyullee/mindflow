// 설치형 앱의 상주 설정 — **창을 닫아도 알림을 받는가**(4단계).
//
// 이 두 행은 셸이 있을 때만 뜻이 있다: 브라우저·PWA에는 닫아도 남을 창이 없고,
// 4단계 이전 설치본에는 그 창구 자체가 없다. 그래서 "언제 그리는가"가 곧 계약이다.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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
import type { DesktopBackground } from '../../platform/desktopBridge';

interface Shell {
  state: DesktopBackground;
  setBackground: ReturnType<typeof vi.fn>;
  setOpenAtLogin: ReturnType<typeof vi.fn>;
}

/** 셸을 심는다. `extra`가 없으면 4단계 창구가 통째로 없는 **옛 셸**이다. */
function installShell(state?: DesktopBackground): Shell | null {
  const base = {
    desktop: true,
    version: '0.3.0',
    platform: 'win32',
    titleBarHeight: 0,
    openExternal: () => Promise.resolve(true),
    onDeepLink: () => () => undefined,
    takePendingDeepLink: () => Promise.resolve(null),
  };
  if (!state) {
    (window as unknown as { geurio: unknown }).geurio = base;
    return null;
  }
  const shell: Shell = {
    state,
    setBackground: vi.fn(),
    setOpenAtLogin: vi.fn(),
  };
  shell.setBackground.mockImplementation((on: boolean) => {
    shell.state = { ...shell.state, enabled: on };
    return Promise.resolve(shell.state);
  });
  shell.setOpenAtLogin.mockImplementation((on: boolean) => {
    shell.state = { ...shell.state, openAtLogin: on };
    return Promise.resolve(shell.state);
  });
  (window as unknown as { geurio: unknown }).geurio = {
    ...base,
    backgroundState: () => Promise.resolve(shell.state),
    setBackground: shell.setBackground,
    setOpenAtLogin: shell.setOpenAtLogin,
    focusWindow: () => Promise.resolve(true),
  };
  return shell;
}

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

/** jsdom에는 `Notification`이 없다 — 알림 구획 자체가 뜨려면 스텁이 필요하다. */
class FakeNotification {
  static permission = 'granted';
  static requestPermission = vi.fn();
}

describe('설치형 앱 — 창을 닫아도 알림 받기(4단계)', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u1', email: 'me@example.com' } }));
    vi.stubGlobal('Notification', FakeNotification);
  });
  afterEach(() => {
    cleanup();
    delete (window as unknown as { geurio?: unknown }).geurio;
    vi.unstubAllGlobals();
  });

  it('브라우저에는 그 자리가 없다 — 닫아도 남을 창이 없다', async () => {
    const user = userEvent.setup();
    renderHome();
    const dialog = await openSettings(user);
    await waitFor(() => expect(dialog.querySelector('[data-remind-group]')).toBeTruthy());
    expect(dialog.querySelector('[data-remind-bg-row]')).toBeNull();
    expect(dialog.querySelector('[data-remind-login-row]')).toBeNull();
  });

  it('4단계 이전 셸에도 그리지 않는다 — 창구가 없으면 눌러도 아무 일이 없다', async () => {
    installShell();
    const user = userEvent.setup();
    renderHome();
    const dialog = await openSettings(user);
    await waitFor(() => expect(dialog.querySelector('[data-remind-group]')).toBeTruthy());
    expect(dialog.querySelector('[data-remind-bg-row]')).toBeNull();
  });

  it('되돌아올 길이 없는 환경(supported=false)에도 그리지 않는다', async () => {
    installShell({ supported: false, enabled: false, loginSupported: true, openAtLogin: false });
    const user = userEvent.setup();
    renderHome();
    const dialog = await openSettings(user);
    await waitFor(() => expect(dialog.querySelector('[data-remind-group]')).toBeTruthy());
    expect(dialog.querySelector('[data-remind-bg-row]')).toBeNull();
  });

  it('상주를 끄고 켜면 셸에 넘기고, 돌아온 상태를 그대로 그린다', async () => {
    const shell = installShell({ supported: true, enabled: true, loginSupported: true, openAtLogin: false })!;
    const user = userEvent.setup();
    renderHome();
    const dialog = await openSettings(user);

    const row = await waitFor(() => {
      const el = dialog.querySelector('[data-remind-bg-row]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    expect(row.querySelector('[data-remind-bg-note]')!.textContent).toContain('창을 닫아도 앱이 남아');

    await user.click(row.querySelector('[role="switch"]') as HTMLElement);
    expect(shell.setBackground).toHaveBeenCalledWith(false);
    await waitFor(() => {
      expect(
        dialog.querySelector('[data-remind-bg-note]')!.textContent,
      ).toContain('창을 닫으면 앱이 종료돼');
    });
    // 상주가 꺼져도 로그인 행은 남는다 — "컴퓨터를 켜면 앱이 열린다"는 그 자체로
    // 뜻이 있고, 감추면 끄는 길이 사라진다.
    expect(dialog.querySelector('[data-remind-login-row]')).toBeTruthy();
    expect(dialog.querySelector('[data-remind-login-note]')!.textContent).toContain('앱이 열려요');
  });

  it('로그인 자동 실행은 **OS에서 다시 읽은** 값을 그린다 — 받아들이지 않으면 제자리', async () => {
    const shell = installShell({ supported: true, enabled: true, loginSupported: true, openAtLogin: false })!;
    // MSIX 컨테이너처럼 설정이 먹히지 않는 환경: 셸은 읽은 그대로(거짓)를 돌려준다.
    shell.setOpenAtLogin.mockImplementation(() => Promise.resolve(shell.state));
    const user = userEvent.setup();
    renderHome();
    const dialog = await openSettings(user);
    const row = await waitFor(() => {
      const el = dialog.querySelector('[data-remind-login-row]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    const sw = row.querySelector('[role="switch"]') as HTMLElement;
    await user.click(sw);
    expect(shell.setOpenAtLogin).toHaveBeenCalledWith(true);
    await waitFor(() => expect(sw.getAttribute('aria-checked')).toBe('false'));
  });

  it('로그인 자동 실행이 없는 플랫폼(리눅스)에서는 그 행만 빠진다', async () => {
    installShell({ supported: true, enabled: true, loginSupported: false, openAtLogin: false });
    const user = userEvent.setup();
    renderHome();
    const dialog = await openSettings(user);
    await waitFor(() => expect(dialog.querySelector('[data-remind-bg-row]')).toBeTruthy());
    expect(dialog.querySelector('[data-remind-login-row]')).toBeNull();
  });
});

// ── 새 설치 버전 확인(요청) ───────────────────────────────────────────────────
//
// 껍데기는 스스로 갱신되지 않는다 — 자동 업데이트는 서명을 요구하고(macOS의
// Squirrel.Mac은 Developer ID 없이 거절, Windows는 검증되지 않은 바이너리를 자동
// 실행하게 된다) 우리는 무서명이다. 그래서 **알리고 릴리스 페이지를 연다**.
describe('설치형 앱 — 새 설치 버전 확인', () => {
  /** `/desktop-version.json`만 골라 답한다 — 다른 fetch(연결 확인 등)는 통과시킨다. */
  function stubManifest(body: unknown, ok = true) {
    const f = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/desktop-version.json')) return { ok, json: async () => body } as unknown as Response;
      return { ok: true, json: async () => ({}) } as unknown as Response;
    });
    vi.stubGlobal('fetch', f);
    return f;
  }

  async function openVersion(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
    const dialog = await openSettings(user);
    await user.click(dialog.querySelector('[data-version-detail-row]') as HTMLElement);
    return dialog;
  }

  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u1', email: 'me@example.com' } }));
    vi.stubGlobal('Notification', FakeNotification);
  });
  afterEach(() => {
    cleanup();
    delete (window as unknown as { geurio?: unknown }).geurio;
    vi.unstubAllGlobals();
  });

  it('새 판이 있으면 알리고, 다운로드가 릴리스 페이지를 시스템 브라우저로 연다', async () => {
    const user = userEvent.setup();
    installShell();
    const open = vi.fn(() => Promise.resolve(true));
    (window as unknown as { geurio: { openExternal: unknown } }).geurio.openExternal = open;
    stubManifest({ version: '0.4.0', url: 'https://github.com/hoyullee/mindflow/releases/latest' });
    renderHome();

    const dialog = await openVersion(user);
    const row = () => dialog.querySelector('[data-shell-update]') as HTMLElement;
    await waitFor(() => expect(row().getAttribute('data-shell-update-state')).toBe('available'));
    // 버전을 말한다 — "새 버전이 있어요"만으로는 무엇을 받는지 알 수 없다.
    expect(row().textContent).toContain('0.4.0');

    // 버튼 이름이 `업데이트`가 아니라 `다운로드`다 — 누르면 일어나는 일을 말한다.
    const btn = row().querySelector('[data-update-action]') as HTMLElement;
    expect(btn.textContent).toBe('다운로드');
    await user.click(btn);
    expect(open).toHaveBeenCalledWith('https://github.com/hoyullee/mindflow/releases/latest');
  });

  it('같은 판이면 최신이라 말하고, 읽지 못하면 그렇게 말한다 — 둘은 다르다', async () => {
    const user = userEvent.setup();
    installShell();
    stubManifest({ version: '0.3.0', url: 'https://example.com/r' });
    renderHome();
    let dialog = await openVersion(user);
    await waitFor(() =>
      expect(dialog.querySelector('[data-shell-update]')!.getAttribute('data-shell-update-state')).toBe('current'),
    );
    expect(within(dialog).getByText('설치 앱도 최신이에요')).toBeTruthy();
    cleanup();

    // 파일이 없다(배포 전) → `unknown`. **최신이라고 말하지 않는다.**
    installShell();
    stubManifest(null, false);
    renderHome();
    dialog = await openVersion(user);
    await waitFor(() =>
      expect(dialog.querySelector('[data-shell-update]')!.getAttribute('data-shell-update-state')).toBe('unknown'),
    );
    expect(within(dialog).queryByText('설치 앱도 최신이에요')).toBeNull();
  });

  it('브라우저에는 그 행이 없고, 버전 파일을 부르지도 않는다', async () => {
    const user = userEvent.setup();
    const f = stubManifest({ version: '9.9.9', url: 'https://example.com/r' });
    renderHome();
    const dialog = await openVersion(user);
    expect(dialog.querySelector('[data-shell-update]')).toBeNull();
    expect(f.mock.calls.some(([u]) => String(u).startsWith('/desktop-version.json'))).toBe(false);
  });
});

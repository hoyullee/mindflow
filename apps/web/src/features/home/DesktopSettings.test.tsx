// 설치형 앱의 상주 설정 — **창을 닫아도 알림을 받는가**(4단계).
//
// 이 두 행은 셸이 있을 때만 뜻이 있다: 브라우저·PWA에는 닫아도 남을 창이 없고,
// 4단계 이전 설치본에는 그 창구 자체가 없다. 그래서 "언제 그리는가"가 곧 계약이다.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
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
import { __resetUpdateControl, publishUpdateStatus, setUpdateControls, setUpdateShellChecker } from '../../pwa/updateControl';
import type { DesktopBackground } from '../../platform/desktopBridge';
import type { ShellUpdateState } from '../../platform/shellUpdate';

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

/** 설정 → **알림** 화면(요청으로 한 겹 안으로 들어갔다) — 상주 스위치가 거기 있다. */
async function openNotify(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  const dialog = await openSettings(user);
  const row = await waitFor(() => {
    const el = dialog.querySelector('[data-notify-detail-row]');
    expect(el).toBeTruthy();
    return el as HTMLElement;
  });
  await user.click(row);
  return dialog;
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
    const dialog = await openNotify(user);
    await waitFor(() => expect(dialog.querySelector('[data-remind-group]')).toBeTruthy());
    expect(dialog.querySelector('[data-remind-bg-row]')).toBeNull();
    expect(dialog.querySelector('[data-remind-login-row]')).toBeNull();
  });

  it('4단계 이전 셸에도 그리지 않는다 — 창구가 없으면 눌러도 아무 일이 없다', async () => {
    installShell();
    const user = userEvent.setup();
    renderHome();
    const dialog = await openNotify(user);
    await waitFor(() => expect(dialog.querySelector('[data-remind-group]')).toBeTruthy());
    expect(dialog.querySelector('[data-remind-bg-row]')).toBeNull();
  });

  it('되돌아올 길이 없는 환경(supported=false)에도 그리지 않는다', async () => {
    installShell({ supported: false, enabled: false, loginSupported: true, openAtLogin: false });
    const user = userEvent.setup();
    renderHome();
    const dialog = await openNotify(user);
    await waitFor(() => expect(dialog.querySelector('[data-remind-group]')).toBeTruthy());
    expect(dialog.querySelector('[data-remind-bg-row]')).toBeNull();
  });

  it('상주를 끄고 켜면 셸에 넘기고, 돌아온 상태를 그대로 그린다', async () => {
    const shell = installShell({ supported: true, enabled: true, loginSupported: true, openAtLogin: false })!;
    const user = userEvent.setup();
    renderHome();
    const dialog = await openNotify(user);

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
    const dialog = await openNotify(user);
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
    const dialog = await openNotify(user);
    await waitFor(() => expect(dialog.querySelector('[data-remind-bg-row]')).toBeTruthy());
    expect(dialog.querySelector('[data-remind-login-row]')).toBeNull();
  });
});

// ── 테스트 알림 — "왜 안 왔나"를 눌러서 읽는 답으로 ──────────────────────────
//
// 제보: Windows 앱에서 OS 알림이 오지 않았다. 일정 시각을 기다려야 하고, 안 뜨면
// 우리 스케줄러인지 권한인지 OS인지 갈리지 않는다 — 그래서 **지금 한 건 띄워 보는**
// 자리를 뒀다. 설치형 앱에서는 렌더러의 생성자가 아니라 **셸이** 띄운다.
describe('설치형 앱 — 테스트 알림', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u1', email: 'me@example.com' } }));
    // 렌더러 생성자는 **막혀 있는** 환경으로 둔다 — 그래야 셸이 유일한 길이고
    // 그 결과가 화면에 그대로 나타난다(실제 알림도 같은 순서로 물러선다).
    vi.stubGlobal(
      'Notification',
      class {
        static permission = 'denied';
        static requestPermission = vi.fn();
      },
    );
  });
  afterEach(() => {
    cleanup();
    delete (window as unknown as { geurio?: unknown }).geurio;
    vi.unstubAllGlobals();
  });

  function withNotify(notify: unknown, supported: boolean) {
    installShell({ supported: true, enabled: true, loginSupported: true, openAtLogin: false });
    Object.assign((window as unknown as { geurio: Record<string, unknown> }).geurio, {
      notify,
      notifySupported: () => Promise.resolve(supported),
      onNotificationClick: () => () => undefined,
    });
  }

  it('보내기를 누르면 **셸이** 띄우고 결과를 그 자리에 말한다', async () => {
    const notify = vi.fn((payload: { title: string; body: string; tag: string }) => {
      expect(payload.tag).toMatch(/^mf-test-/);
      return Promise.resolve(true);
    });
    withNotify(notify, true);
    const user = userEvent.setup();
    renderHome();
    const dialog = await openNotify(user);
    const row = await waitFor(() => {
      const el = dialog.querySelector('[data-remind-test-row]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    await user.click(row.querySelector('[data-remind-test]') as HTMLElement);
    await waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
    expect(notify.mock.calls[0]![0].title).toContain('테스트');
    await waitFor(() =>
      expect(dialog.querySelector('[data-remind-test-note]')!.textContent).toContain('보냈어요'),
    );
  });

  it('막혀 있으면 무엇을 해야 하는지까지 말한다', async () => {
    withNotify(() => Promise.resolve(false), true);
    const user = userEvent.setup();
    renderHome();
    const dialog = await openNotify(user);
    const row = await waitFor(() => {
      const el = dialog.querySelector('[data-remind-test-row]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    await user.click(row.querySelector('[data-remind-test]') as HTMLElement);
    await waitFor(() =>
      expect(dialog.querySelector('[data-remind-test-note]')!.textContent).toContain('허용해 주세요'),
    );
  });

  it('못 띄우는 기기면 **누르기 전에** 알려 준다(셸에게 물어본 답)', async () => {
    withNotify(() => Promise.resolve(false), false);
    const user = userEvent.setup();
    renderHome();
    const dialog = await openNotify(user);
    await waitFor(() =>
      expect(dialog.querySelector('[data-remind-test-note]')!.textContent).toContain('띄울 수 없어요'),
    );
  });
});

// ── 새 설치 버전 확인 — 업데이트 행은 **하나**다(요청) ───────────────────────
//
// 껍데기는 스스로 갱신되지 않는다 — 자동 설치는 서명을 요구하고(macOS의
// Squirrel.Mac은 Developer ID 없이 거절, Windows는 검증되지 않은 바이너리를 자동
// 실행하게 된다) 우리는 무서명이다. 그래서 **알리고 받는 페이지를 연다**.
//
// 행을 둘로 두면 "무엇을 먼저 눌러야 하는가"를 사용자가 정해야 하는데, 실은 정할
// 것이 없다: **껍데기를 설치하면 앱이 다시 실행되면서 대기 중인 서비스 워커가
// 활성화되므로 화면까지 함께 최신이 된다.**
describe('설치형 앱 — 새 설치 버전 확인', () => {
  /**
   * 껍데기의 판은 **`UpdatePrompt`가 물어 모듈에 올린다**(그 컴포넌트만 가상 모듈에
   * 닿는다) — 이 파일은 홈만 띄우므로 그 값을 직접 심는다. 버전 파일을 실제로 묻는
   * 경로는 `pwa/UpdatePrompt.test.tsx`가, 판 비교·파싱은 `platform/shellUpdate.test.ts`가
   * 본다. 여기서 보는 것은 **그 상태가 화면에 어떻게 드러나는가**다.
   */
  function publishShell(shell: ShellUpdateState) {
    act(() => publishUpdateStatus({ shell }));
  }

  async function openVersion(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
    const dialog = await openSettings(user);
    await user.click(dialog.querySelector('[data-version-detail-row]') as HTMLElement);
    return dialog;
  }

  const state = (d: HTMLElement) => d.querySelector('[data-update-row]')!.getAttribute('data-update-state');

  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u1', email: 'me@example.com' } }));
    vi.stubGlobal('Notification', FakeNotification);
  });
  afterEach(() => {
    cleanup();
    delete (window as unknown as { geurio?: unknown }).geurio;
    __resetUpdateControl();
    vi.unstubAllGlobals();
  });

  it('② 껍데기만 새 판이면 한 행이 그것을 말하고, 업데이트가 받는 페이지를 연다', async () => {
    const user = userEvent.setup();
    installShell();
    const open = vi.fn(() => Promise.resolve(true));
    (window as unknown as { geurio: { openExternal: unknown } }).geurio.openExternal = open;
    setUpdateControls({ check: vi.fn(), apply: vi.fn() });
    publishShell({ kind: 'available', version: '0.4.0', url: 'https://github.com/hoyullee/mindflow/releases/latest' });
    renderHome();

    const dialog = await openVersion(user);
    await waitFor(() => expect(state(dialog)).toBe('shell'));
    // 행은 **하나**다 — 껍데기 전용 행을 따로 두지 않는다.
    expect(dialog.querySelectorAll('[data-update-row]').length).toBe(1);
    const row = dialog.querySelector('[data-update-row]') as HTMLElement;
    // 버전을 말한다 — "새 버전이 있어요"만으로는 무엇을 받는지 알 수 없다.
    expect(row.textContent).toContain('0.4.0');
    // 웹 새 판이 없으므로 "화면까지"라 말하지 않는다.
    expect(row.textContent).toContain('설치하면 적용돼요');

    const btn = row.querySelector('[data-update-action]') as HTMLElement;
    expect(btn.textContent).toBe('업데이트');
    await user.click(btn);
    expect(open).toHaveBeenCalledWith('https://github.com/hoyullee/mindflow/releases/latest');
  });

  it('③ 둘이 함께 있으면 껍데기를 누르게 한다 — 설치가 화면까지 해결한다', async () => {
    const user = userEvent.setup();
    installShell();
    const open = vi.fn(() => Promise.resolve(true));
    (window as unknown as { geurio: { openExternal: unknown } }).geurio.openExternal = open;
    const apply = vi.fn();
    setUpdateControls({ check: vi.fn(), apply });
    publishShell({ kind: 'available', version: '0.4.0', url: 'https://example.com/r' });
    renderHome();

    const dialog = await openVersion(user);
    // 웹 새 판도 대기 중이다.
    act(() => publishUpdateStatus({ checking: false, ready: true }));
    await waitFor(() => expect(state(dialog)).toBe('shell'));
    const row = dialog.querySelector('[data-update-row]') as HTMLElement;
    expect(row.textContent).toContain('화면까지 함께 최신이 돼요');

    await user.click(row.querySelector('[data-update-action]') as HTMLElement);
    // 받는 페이지로 가고, **웹 적용은 부르지 않는다**(설치가 그것까지 해결한다).
    expect(open).toHaveBeenCalledWith('https://example.com/r');
    expect(apply).not.toHaveBeenCalled();
  });

  it('같은 판이면 최신이라 말하고, 읽지 못하면 그렇게 말한다 — 둘은 다르다', async () => {
    const user = userEvent.setup();
    installShell();
    setUpdateControls({ check: vi.fn(), apply: vi.fn() });
    publishShell({ kind: 'current' });
    renderHome();
    let dialog = await openVersion(user);
    await waitFor(() => expect(state(dialog)).toBe('latest'));
    expect(within(dialog).getByText('최신 버전이에요')).toBeTruthy();
    expect(dialog.querySelector('[data-update-row]')!.textContent).not.toContain('확인하지 못했어요');
    cleanup();

    // 읽지 못했다(배포 전·연결 실패) → 최신이라고 **뭉개지 않는다**.
    installShell();
    setUpdateControls({ check: vi.fn(), apply: vi.fn() });
    publishShell({ kind: 'unknown' });
    renderHome();
    dialog = await openVersion(user);
    await waitFor(() =>
      expect(dialog.querySelector('[data-update-row]')!.textContent).toContain('설치 버전은 확인하지 못했어요'),
    );
    expect(state(dialog)).toBe('latest');
  });

  it('이 화면을 열면 껍데기를 다시 묻는다 — 그 값에는 자동 확인 고리가 없다', async () => {
    const user = userEvent.setup();
    installShell();
    const shellCheck = vi.fn();
    setUpdateControls({ check: vi.fn(), apply: vi.fn() });
    setUpdateShellChecker(shellCheck);
    publishShell({ kind: 'current' });
    renderHome();

    expect(shellCheck).not.toHaveBeenCalled();
    await openVersion(user);
    // 웹 번들은 스스로 신선하다(등록·5분 주기·탭 복귀) — 껍데기만 다시 묻는다.
    expect(shellCheck).toHaveBeenCalledTimes(1);
  });

  it('브라우저에서는 설치 앱 행도 없고 웹만 본다 — 받을 설치 파일이 없다', async () => {
    const user = userEvent.setup();
    setUpdateControls({ check: vi.fn(), apply: vi.fn() });
    renderHome();
    const dialog = await openVersion(user);
    await waitFor(() => expect(state(dialog)).toBe('latest'));
    expect(dialog.querySelector('[data-version-shell]')).toBeNull();
    // 셸이 없으면 `UpdatePrompt`가 버전 파일을 묻지 않아 이 값은 언제나 비어 있다
    // (그 계약은 `pwa/UpdatePrompt.test.tsx`가 본다).
    expect(dialog.querySelector('[data-update-row]')!.textContent).not.toContain('설치 버전');
  });
});

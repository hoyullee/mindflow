import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  googleRemindersEnabled,
  markReminderFired,
  notifyPermission,
  onRemindersEnabledChange,
  remindersEnabled,
  setGoogleRemindersEnabled,
  setRemindersEnabled,
  sendTestNotification,
  showOsNotification,
  wasReminderFired,
} from './reminderPrefs';

beforeEach(() => localStorage.clear());

describe('알림의 기기 쪽 상태', () => {
  it('기본은 켜짐 — 이 스위치는 알림을 만들어 내지 않으므로(일정마다의 기본은 `없음`)', () => {
    expect(remindersEnabled()).toBe(true);
    setRemindersEnabled(false);
    expect(remindersEnabled()).toBe(false);
    setRemindersEnabled(true);
    expect(remindersEnabled()).toBe(true);
  });

  it('켜고 끄면 열려 있는 모든 화면에 알린다(스케줄러가 화면마다 있다)', () => {
    const fn = vi.fn();
    const off = onRemindersEnabledChange(fn);
    setRemindersEnabled(false);
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    setRemindersEnabled(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('이미 띄운 것은 기억하고, **일정을 옮기면 다시 띄운다**(알림 시각이 키에 들어 있다)', () => {
    expect(wasReminderFired('e1#2026-09-15', 1000)).toBe(false);
    markReminderFired('e1#2026-09-15', 1000);
    expect(wasReminderFired('e1#2026-09-15', 1000)).toBe(true);
    // 같은 일정이지만 알림 시각이 달라졌다 = 사용자가 시각·알림을 고쳤다 → 새 알림이다.
    expect(wasReminderFired('e1#2026-09-15', 2000)).toBe(false);
    // 다른 회차도 따로 센다.
    expect(wasReminderFired('e1#2026-09-16', 1000)).toBe(false);
  });

  it('오래된 기억은 버린다 — 저장소를 무한히 먹지 않게', () => {
    const old = Date.now() - 2 * 24 * 60 * 60_000;
    markReminderFired('old', 1, old);
    markReminderFired('new', 2);
    expect(wasReminderFired('old', 1)).toBe(false);
    expect(wasReminderFired('new', 2)).toBe(true);
  });

  it('권한이 없으면 OS 알림을 띄우지 않고 `false`를 돌려준다(호출부가 인앱 토스트로 대신한다)', async () => {
    // jsdom에는 `Notification`이 없다 — 그때는 그 자리를 그리지도 않는다.
    expect(notifyPermission()).toBe('unsupported');
    await expect(showOsNotification({ title: 'x', body: 'y', tag: 't' })).resolves.toBe(false);

    const ctor = vi.fn();
    class FakeNotification {
      static permission = 'denied';
      static requestPermission = vi.fn();
      onclick: (() => void) | null = null;
      close = vi.fn();
      constructor(title: string, opts: unknown) {
        ctor(title, opts);
      }
    }
    vi.stubGlobal('Notification', FakeNotification);
    expect(notifyPermission()).toBe('denied');
    await expect(showOsNotification({ title: 'x', body: 'y', tag: 't' })).resolves.toBe(false);
    expect(ctor).not.toHaveBeenCalled();

    FakeNotification.permission = 'granted';
    await expect(showOsNotification({ title: '팀 회의', body: '오전 10:30 · 10분 후 시작', tag: 'k' })).resolves.toBe(true);
    expect(ctor).toHaveBeenCalledWith('팀 회의', expect.objectContaining({ body: '오전 10:30 · 10분 후 시작', tag: 'k' }));
    vi.unstubAllGlobals();
  });

  it('알림을 누르면 **숨어 있던 데스크톱 창**을 되찾는다(4단계)', async () => {
    // 상주 중에는 창이 감춰져 있어 렌더러의 `window.focus()`로는 나타나지 않는다 —
    // 셸에게 띄워 달라고 해야 한다. 그 길이 빠지면 알림을 눌러도 아무 일이 없다.
    const focusWindow = vi.fn(() => Promise.resolve(true));
    (window as unknown as { geurio: unknown }).geurio = {
      desktop: true,
      version: '0.3.0',
      platform: 'win32',
      openExternal: () => Promise.resolve(true),
      onDeepLink: () => () => undefined,
      takePendingDeepLink: () => Promise.resolve(null),
      focusWindow,
    };
    class FakeNotification {
      static permission = 'granted';
      static requestPermission = vi.fn();
      onclick: (() => void) | null = null;
      close = vi.fn();
    }
    vi.stubGlobal('Notification', FakeNotification);
    const onClick = vi.fn();
    const made: FakeNotification[] = [];
    vi.stubGlobal(
      'Notification',
      class extends FakeNotification {
        constructor() {
          super();
          made.push(this);
        }
      },
    );
    await expect(showOsNotification({ title: 'x', body: 'y', tag: 't', onClick })).resolves.toBe(true);
    made[0]!.onclick!();
    expect(focusWindow).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledTimes(1);

    delete (window as unknown as { geurio?: unknown }).geurio;
    vi.unstubAllGlobals();
  });
});

describe('구글 일정 알림 설정(2단계)', () => {
  it('기본은 **꺼짐**이다 — 그 알림은 구글이 이미 보낸다', () => {
    expect(googleRemindersEnabled()).toBe(false);
    // 그리오 알림은 반대로 기본이 켜짐이다(스위치의 뜻이 다르다).
    expect(remindersEnabled()).toBe(true);
  });

  it('켜고 끈 값이 이 기기에 남고, 열려 있는 화면들이 따라온다', () => {
    const seen: boolean[] = [];
    const off = onRemindersEnabledChange(() => seen.push(googleRemindersEnabled()));
    setGoogleRemindersEnabled(true);
    expect(googleRemindersEnabled()).toBe(true);
    setGoogleRemindersEnabled(false);
    expect(googleRemindersEnabled()).toBe(false);
    expect(seen).toEqual([true, false]);
    off();
  });
});

describe('테스트 알림 — "왜 안 왔나"를 눌러서 읽는 답으로', () => {
  function shell(extra: Record<string, unknown>) {
    (window as unknown as { geurio: unknown }).geurio = {
      desktop: true,
      version: '0.3.0',
      platform: 'win32',
      openExternal: () => Promise.resolve(true),
      onDeepLink: () => () => undefined,
      takePendingDeepLink: () => Promise.resolve(null),
      ...extra,
    };
  }
  afterEach(() => {
    delete (window as unknown as { geurio?: unknown }).geurio;
    vi.unstubAllGlobals();
  });

  it('설치형 앱에서는 **셸이** 띄운다 — 렌더러 생성자를 쓰지 않는다', async () => {
    const notify = vi.fn(() => Promise.resolve(true));
    shell({ notify, notifySupported: () => Promise.resolve(true) });
    const ctor = vi.fn();
    vi.stubGlobal(
      'Notification',
      class {
        static permission = 'granted';
        constructor(...args: unknown[]) {
          ctor(...args);
        }
      },
    );
    await expect(sendTestNotification()).resolves.toBe('sent');
    expect(notify).toHaveBeenCalledTimes(1);
    // 웹 생성자는 거치지 않는다 — 두 길 중 하나만 지난다(알림이 둘 뜨지 않게).
    expect(ctor).not.toHaveBeenCalled();
  });

  it('셸이 못 띄우면 **실제 알림과 같은 순서로** 웹 생성자에 물러선다', async () => {
    shell({ notify: () => Promise.resolve(false), notifySupported: () => Promise.resolve(false) });
    const ctor = vi.fn();
    vi.stubGlobal(
      'Notification',
      class {
        static permission = 'granted';
        constructor(...args: unknown[]) {
          ctor(...args);
        }
      },
    );
    await expect(sendTestNotification()).resolves.toBe('sent');
    expect(ctor).toHaveBeenCalledTimes(1);
  });

  it('두 길이 다 막히면 **사유를 물어본다** — 못 띄우는 기기인가, 막혀 있는가', async () => {
    vi.stubGlobal(
      'Notification',
      class {
        static permission = 'denied';
      },
    );
    shell({ notify: () => Promise.resolve(false), notifySupported: () => Promise.resolve(false) });
    await expect(sendTestNotification()).resolves.toBe('unsupported');

    shell({ notify: () => Promise.resolve(false), notifySupported: () => Promise.resolve(true) });
    await expect(sendTestNotification()).resolves.toBe('blocked');
  });

  it('브라우저에서는 권한이 답을 가른다', async () => {
    // `Notification`이 아예 없는 환경(jsdom 기본).
    await expect(sendTestNotification()).resolves.toBe('unsupported');

    const ctor = vi.fn();
    class FakeNotification {
      static permission = 'denied';
      static requestPermission = vi.fn(() => Promise.resolve('denied'));
      onclick: (() => void) | null = null;
      close = vi.fn();
      constructor(title: string, opts: unknown) {
        ctor(title, opts);
      }
    }
    vi.stubGlobal('Notification', FakeNotification);
    await expect(sendTestNotification()).resolves.toBe('blocked');
    expect(ctor).not.toHaveBeenCalled();

    FakeNotification.permission = 'granted';
    await expect(sendTestNotification()).resolves.toBe('sent');
    expect(ctor).toHaveBeenCalledWith('Geurio 테스트 알림', expect.objectContaining({ body: expect.any(String) }));
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  desktopBridge,
  desktopNotifyAvailable,
  desktopNotifySupported,
  isDesktopShell,
  notifyViaDesktop,
  openExternalUrl,
} from './desktopBridge';

afterEach(() => {
  delete (window as { geurio?: unknown }).geurio;
  vi.restoreAllMocks();
});

describe('OS 알림을 셸이 띄운다(제보: Windows 앱에서 알림이 오지 않는다)', () => {
  function shell(extra: Record<string, unknown>) {
    (window as unknown as { geurio: unknown }).geurio = {
      desktop: true,
      version: '0.3.0',
      platform: 'win32',
      openExternal: async () => true,
      onDeepLink: () => () => undefined,
      takePendingDeepLink: async () => null,
      ...extra,
    };
  }

  it('옛 설치본(창구 없음)에서는 쓸 수 없다고 답한다 — 그때는 웹 생성자로 물러선다', async () => {
    shell({});
    expect(desktopNotifyAvailable()).toBe(false);
    expect(await notifyViaDesktop({ title: 'x', body: 'y', tag: 't' })).toBe(false);
    // 지원 여부도 **모른다**(`null`) — 못 띄운다고 단정하지 않는다.
    expect(await desktopNotifySupported()).toBe(null);
  });

  it('셸에 넘기고, 누르면 그 태그의 할 일이 돈다(셸은 태그만 돌려준다)', async () => {
    const notify = vi.fn(async () => true);
    let fire: ((tag: string) => void) | null = null;
    shell({
      notify,
      notifySupported: async () => true,
      onNotificationClick: (h: (tag: string) => void) => {
        fire = h;
        return () => undefined;
      },
    });
    const onClick = vi.fn();
    expect(desktopNotifyAvailable()).toBe(true);
    expect(await notifyViaDesktop({ title: '팀 회의', body: '10분 후', tag: 'k1', onClick })).toBe(true);
    expect(notify).toHaveBeenCalledWith({ title: '팀 회의', body: '10분 후', tag: 'k1' });
    fire!('k1');
    expect(onClick).toHaveBeenCalledTimes(1);
    // 한 번 쓴 기억은 지운다 — 같은 태그가 다시 눌려도 되살아나지 않는다.
    fire!('k1');
    expect(onClick).toHaveBeenCalledTimes(1);
    // 모르는 태그는 아무 일도 하지 않는다(터지지 않는다).
    fire!('없는태그');
  });

  it('셸이 못 띄우면 `false` — 호출부가 웹 생성자로 물러설 수 있다', async () => {
    shell({ notify: async () => false, notifySupported: async () => false });
    expect(await notifyViaDesktop({ title: 'x', body: 'y', tag: 't' })).toBe(false);
    expect(await desktopNotifySupported()).toBe(false);
  });
});

describe('desktopBridge — 셸이 없으면 아무 일도 하지 않는다', () => {
  it('브라우저·PWA·테스트에서는 셸이 아니다', () => {
    expect(isDesktopShell()).toBe(false);
    expect(desktopBridge()).toBe(null);
  });

  it('`desktop: true`가 아닌 값은 창구로 보지 않는다(우연히 같은 이름의 전역이 있어도)', () => {
    (window as unknown as { geurio: unknown }).geurio = { version: '1' };
    expect(isDesktopShell()).toBe(false);
  });

  it('셸이 있으면 외부 열기를 셸에 넘긴다', async () => {
    const openExternal = vi.fn(async () => true);
    (window as unknown as { geurio: unknown }).geurio = {
      desktop: true,
      version: '0.1.0',
      platform: 'darwin',
      openExternal,
      onDeepLink: () => () => undefined,
      takePendingDeepLink: async () => null,
    };
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await openExternalUrl('https://accounts.google.com/x');
    expect(openExternal).toHaveBeenCalledWith('https://accounts.google.com/x');
    // 셸에서는 새 탭을 열지 않는다 — 앱 창은 우리 출처만 띄운다.
    expect(open).not.toHaveBeenCalled();
  });

  it('셸이 없으면 새 탭으로 연다', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await openExternalUrl('https://geurio.com/privacy');
    expect(open).toHaveBeenCalledWith('https://geurio.com/privacy', '_blank', 'noopener,noreferrer');
  });
});

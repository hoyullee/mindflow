import { afterEach, describe, expect, it, vi } from 'vitest';
import { desktopBridge, isDesktopShell, openExternalUrl } from './desktopBridge';

afterEach(() => {
  delete (window as { geurio?: unknown }).geurio;
  vi.restoreAllMocks();
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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildJiraDeepLink, isDesktopState, readJiraDeepLink, stateOfAuthUrl } from './desktopJira';
import { beginJiraConnect, onJiraConnected, resetJiraStore } from './jiraStore';
import { setJiraSourceForTest, type JiraSource } from './jiraApi';
import { demoJira } from './jiraDemo';

// 설치형 앱의 Jira 연결(제보: 동의 뒤 앱으로 돌아오지 못하고 크롬의 웹 홈이 열렸다).

describe('딥링크 모양', () => {
  it('만든 것을 다시 읽는다 · 다른 대상과 모양이 틀린 것은 버린다', () => {
    const link = buildJiraDeepLink('c/1+', 'd.1.sig');
    expect(link).toBe('geurio://jira?code=c%2F1%2B&state=d.1.sig');
    expect(readJiraDeepLink(link)).toEqual({ code: 'c/1+', state: 'd.1.sig' });
    expect(readJiraDeepLink('geurio://gcal?code=x&state=y')).toBeNull();
    expect(readJiraDeepLink('geurio://jira?code=x')).toBeNull();
    expect(readJiraDeepLink('https://jira?code=x&state=y')).toBeNull();
    expect(readJiraDeepLink('nope')).toBeNull();
  });

  it('설치형 앱의 state는 `d.`로 시작한다', () => {
    expect(isDesktopState('d.1700.sig')).toBe(true);
    expect(isDesktopState('1700.sig')).toBe(false);
    expect(isDesktopState(null)).toBe(false);
    expect(stateOfAuthUrl('https://auth.atlassian.com/authorize?state=d.1.s&x=1')).toBe('d.1.s');
  });
});

describe('설치형 앱에서 연결하기', () => {
  let deepLink: ((url: string) => void) | null = null;
  const openExternal = vi.fn(async () => true);
  const exchange = vi.fn<JiraSource['exchange']>();
  const authorize = vi.fn<JiraSource['authorize']>();

  beforeEach(() => {
    resetJiraStore();
    deepLink = null;
    openExternal.mockClear();
    exchange.mockReset();
    authorize.mockReset();
    authorize.mockResolvedValue({ ok: true, url: 'https://auth.atlassian.com/authorize?state=d.1.mine' });
    exchange.mockResolvedValue({ ok: true, connected: true, site: { id: 's', url: 'https://x.atlassian.net', name: 'x' }, projects: [], startField: null, sites: [] });
    setJiraSourceForTest({ ...demoJira, demo: false, authorize, exchange });
    window.geurio = {
      desktop: true,
      platform: 'win32',
      openExternal,
      onDeepLink: (h: (url: string) => void) => {
        deepLink = h;
        return () => {
          deepLink = null;
        };
      },
      takePendingDeepLink: async () => null,
    } as unknown as Window['geurio'];
  });

  afterEach(() => {
    setJiraSourceForTest(null);
    delete window.geurio;
  });

  it('동의 화면은 시스템 브라우저로 열고(이 창은 떠나지 않는다) 서버에 설치형 앱이라고 알린다', async () => {
    const before = window.location.href;
    expect(await beginJiraConnect()).toBeNull();
    expect(authorize).toHaveBeenCalledWith(`${window.location.origin}/auth/jira`, true);
    expect(openExternal).toHaveBeenCalledWith('https://auth.atlassian.com/authorize?state=d.1.mine');
    expect(window.location.href).toBe(before);
  });

  it('돌아온 딥링크의 state가 우리가 시작한 것과 같을 때만 교환하고, 끝나면 홈에 알린다', async () => {
    const events: unknown[] = [];
    const off = onJiraConnected((e) => events.push(e));
    await beginJiraConnect();
    deepLink!(buildJiraDeepLink('code-1', 'd.1.someone-else'));
    await Promise.resolve();
    expect(exchange).not.toHaveBeenCalled();
    deepLink!(buildJiraDeepLink('code-1', 'd.1.mine'));
    await vi.waitFor(() => expect(events).toEqual([{ ok: true, needsSetup: true }]));
    expect(exchange).toHaveBeenCalledWith('code-1', 'd.1.mine', `${window.location.origin}/auth/jira`);
    // 한 번 쓴 state는 다시 받지 않는다
    deepLink!(buildJiraDeepLink('code-2', 'd.1.mine'));
    await Promise.resolve();
    expect(exchange).toHaveBeenCalledTimes(1);
    off();
  });

  it('교환이 실패하면 사유를 알린다', async () => {
    exchange.mockResolvedValue({ ok: false, reason: 'bad-state' });
    const events: unknown[] = [];
    const off = onJiraConnected((e) => events.push(e));
    await beginJiraConnect();
    deepLink!(buildJiraDeepLink('c', 'd.1.mine'));
    await vi.waitFor(() => expect(events).toEqual([{ ok: false, reason: 'bad-state' }]));
    off();
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { App } from './App';
import { mockMatchMedia } from './test/matchMedia';

/**
 * 설치형 데스크톱 앱에서는 랜딩(소개 페이지)이 열리지 않는다 — 그 화면은 설치를
 * 권하는 마케팅 페이지이고, 프로덕션의 `/`는 SPA가 아니라 정적 쌍둥이라 앱 창이
 * 그리로 가면 React 앱과 데스크톱 타이틀 바 배치가 통째로 사라진다(제보).
 * 셸도 같은 판단을 한 겹 더 한다(`apps/desktop/src/shell.ts`의 `isLandingPath`).
 */
afterEach(() => {
  cleanup();
  delete (window as { geurio?: unknown }).geurio;
  window.history.replaceState({}, '', '/');
});

function installShell() {
  (window as unknown as { geurio: unknown }).geurio = {
    desktop: true,
    version: '0.2.0',
    platform: 'win32',
    titleBarHeight: 40,
    openExternal: async () => true,
    onDeepLink: () => () => {},
    takePendingDeepLink: async () => null,
  };
}

describe('데스크톱 앱의 "/" 라우트', () => {
  it('랜딩 대신 앱으로 보낸다', async () => {
    mockMatchMedia(false);
    installShell();
    window.history.replaceState({}, '', '/');

    render(<App />);

    await waitFor(() => expect(window.location.pathname).not.toBe('/'));
    // 랜딩의 히어로 제목이 어디에도 없다.
    expect(document.querySelector('.lp-hero')).toBe(null);
  });

  it('브라우저에서는 예전처럼 랜딩이다(무회귀)', async () => {
    mockMatchMedia(false);
    window.history.replaceState({}, '', '/');

    render(<App />);

    await waitFor(() => expect(document.querySelector('.lp-hero h1')?.textContent).toContain('정리하는 방법은'));
    expect(window.location.pathname).toBe('/');
  });
});

describe('/auth/jira — 설치형 앱에서 시작한 Jira 연결', () => {
  it('state가 `d.`면 브라우저에서 교환하지 않고 딥링크로 앱에 넘긴다(제보: 크롬의 웹 홈이 열렸다)', async () => {
    mockMatchMedia(false);
    window.history.replaceState({}, '', '/auth/jira?code=c%2F1&state=d.1700.sig');
    render(<App />);
    const page = await waitFor(() => {
      const el = document.querySelector('[data-desktop-handoff="jira"]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    expect(page.textContent).toContain('Jira 연결이 이어졌어요');
    const back = page.querySelector('a[href^="geurio://"]');
    expect(back?.getAttribute('href')).toBe('geurio://jira?code=c%2F1&state=d.1700.sig');
  });

  it('웹에서 시작한 연결(표시 없음)은 예전처럼 이 브라우저에서 교환한다', async () => {
    mockMatchMedia(false);
    window.history.replaceState({}, '', '/auth/jira?code=c&state=1700.sig');
    render(<App />);
    await waitFor(() => expect(window.location.pathname).toBe('/home'));
    expect(document.querySelector('[data-desktop-handoff]')).toBe(null);
  });
});

/**
 * 구글 캘린더 **연결 유지**(refresh token) — 토큰을 받는 두 흐름과 그 사이의 규칙.
 *
 * 진짜 구글에도 서버에도 붙지 않는다: GIS(`window.google.accounts.oauth2`)와
 * 서버 포트(`./googleOAuthServer`)를 가짜로 세워 **우리 쪽 판단**만 본다 —
 * 언제 창을 여는가, 언제 조용히 갱신하는가, 서버가 없으면 어떻게 물러나는가.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerResult } from './googleOAuthServer';

let clientId: string | null = 'test-client.apps.googleusercontent.com';
vi.mock('../../auth/googleIdentity', async (orig) => ({
  ...(await orig<typeof import('../../auth/googleIdentity')>()),
  readGoogleClientId: () => clientId,
  loadGisScript: async () => undefined,
}));

const server = {
  refresh: vi.fn<() => Promise<ServerResult>>(),
  exchange: vi.fn<(code: string) => Promise<ServerResult>>(),
  disconnect: vi.fn<() => Promise<ServerResult>>(),
  unavailable: false,
};
vi.mock('./googleOAuthServer', () => ({
  refreshGoogleAccess: () => server.refresh(),
  exchangeGoogleCode: (code: string) => server.exchange(code),
  disconnectGoogleServer: () => server.disconnect(),
  serverKnownUnavailable: () => server.unavailable,
  resetGoogleOAuthServer: () => undefined,
}));

const { ensureGoogleToken, requestGoogleToken, revokeGoogleToken, storeToken, GOOGLE_CALENDAR_SCOPE } = await import('./googleCalendar');

/** 서버가 준 한 시간짜리 액세스 토큰. */
const serverToken = (scope = GOOGLE_CALENDAR_SCOPE): ServerResult => ({
  token: { accessToken: 'srv-token', expiresIn: 3600, scope, email: 'me@example.com', persistent: true },
});

/** GIS 가짜 — 어느 흐름이 몇 번 불렸는지 센다. */
function stubGis(opts: { code?: string; token?: string; withCodeClient?: boolean } = {}) {
  const calls = { code: 0, token: 0 };
  const oauth2 = {
    initCodeClient: opts.withCodeClient === false
      ? undefined
      : (cfg: { callback: (r: { code?: string; error?: string }) => void }) => ({
          requestCode: () => {
            calls.code += 1;
            cfg.callback({ code: opts.code ?? 'auth-code' });
          },
        }),
    initTokenClient: (cfg: { callback: (r: { access_token?: string; expires_in?: number; scope?: string }) => void }) => ({
      requestAccessToken: () => {
        calls.token += 1;
        cfg.callback({ access_token: opts.token ?? 'gis-token', expires_in: 3600, scope: GOOGLE_CALENDAR_SCOPE });
      },
    }),
    revoke: () => undefined,
  };
  (window as unknown as { google?: unknown }).google = { accounts: { oauth2 } };
  return calls;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  clientId = 'test-client.apps.googleusercontent.com';
  server.unavailable = false;
  server.refresh.mockReset();
  server.exchange.mockReset();
  server.disconnect.mockReset();
  server.disconnect.mockResolvedValue({ token: { accessToken: '', expiresIn: 0, scope: '', email: null, persistent: false } });
});

describe('연결 유지(refresh token)', () => {
  it('토큰이 만료돼도 **팝업 없이** 서버가 새로 발급한다', async () => {
    const calls = stubGis();
    server.refresh.mockResolvedValue(serverToken());
    const res = await ensureGoogleToken();
    expect('token' in res && res.token.accessToken).toBe('srv-token');
    // 창이 열리지 않았다는 것이 이 기능의 전부다.
    expect(calls.code + calls.token).toBe(0);
    // 다음 호출은 저장된 토큰을 쓴다 — 서버를 다시 부르지 않는다.
    await ensureGoogleToken();
    expect(server.refresh).toHaveBeenCalledTimes(1);
  });

  it('여러 곳이 동시에 토큰을 찾아도 갱신은 한 번뿐이다', async () => {
    stubGis();
    server.refresh.mockResolvedValue(serverToken());
    const [a, b, c] = await Promise.all([ensureGoogleToken(), ensureGoogleToken(), ensureGoogleToken()]);
    expect(server.refresh).toHaveBeenCalledTimes(1);
    for (const r of [a, b, c]) expect('token' in r).toBe(true);
  });

  it('서버에 자격 증명이 없으면 "다시 연결"을 요청한다', async () => {
    const calls = stubGis();
    server.refresh.mockResolvedValue({ needsConsent: true });
    const res = await ensureGoogleToken();
    expect('error' in res).toBe(true);
    expect(calls.code + calls.token).toBe(0);
  });

  it('승인 범위가 모자란 토큰은 저장하지 않는다', async () => {
    stubGis();
    server.refresh.mockResolvedValue(serverToken('https://www.googleapis.com/auth/calendar.events'));
    const res = await ensureGoogleToken();
    expect('error' in res).toBe(true);
    expect(localStorage.getItem('mf_gcal_token')).toBeNull();
  });

  it('서버 흐름이 없으면(로컬·데모·함수 미배포) 예전처럼 조용히 갱신하지 않는다', async () => {
    const calls = stubGis();
    server.unavailable = true;
    const res = await ensureGoogleToken();
    expect('error' in res).toBe(true);
    expect(server.refresh).not.toHaveBeenCalled();
    expect(calls.code + calls.token).toBe(0);
  });
});

describe('연결 버튼', () => {
  it('서버가 이미 자격 증명을 갖고 있으면 창을 열지 않는다', async () => {
    const calls = stubGis();
    server.refresh.mockResolvedValue(serverToken());
    const res = await requestGoogleToken(true);
    expect('token' in res).toBe(true);
    expect(calls.code + calls.token).toBe(0);
  });

  it('없으면 **인가 코드**를 받아 서버에 넘긴다 — 창은 한 번뿐이다', async () => {
    const calls = stubGis({ code: 'code-123' });
    server.refresh.mockResolvedValue({ needsConsent: true });
    server.exchange.mockResolvedValue(serverToken());
    const res = await requestGoogleToken(true);
    expect('token' in res).toBe(true);
    expect(server.exchange).toHaveBeenCalledWith('code-123');
    expect(calls.code).toBe(1);
    // 예전 흐름(브라우저 토큰)은 부르지 않는다 — 그러면 창이 두 번 뜬다.
    expect(calls.token).toBe(0);
  });

  it('서버 흐름이 없으면 예전 브라우저 토큰 흐름 그대로다(무회귀)', async () => {
    const calls = stubGis();
    server.unavailable = true;
    const res = await requestGoogleToken(true);
    expect('token' in res && res.token.accessToken).toBe('gis-token');
    expect(calls.token).toBe(1);
    expect(calls.code).toBe(0);
    expect(server.exchange).not.toHaveBeenCalled();
  });

  it('GIS가 코드 흐름을 모르는 브라우저에서도 예전 흐름으로 이어진다', async () => {
    const calls = stubGis({ withCodeClient: false });
    server.refresh.mockResolvedValue({ needsConsent: true });
    const res = await requestGoogleToken(true);
    expect('token' in res && res.token.accessToken).toBe('gis-token');
    expect(calls.token).toBe(1);
  });
});

describe('연결 해제', () => {
  it('이 기기의 토큰과 **서버의 자격 증명**을 함께 버린다', async () => {
    stubGis();
    storeToken({ accessToken: 'live', expiresAt: Date.now() + 3600_000, scope: GOOGLE_CALENDAR_SCOPE });
    await revokeGoogleToken();
    expect(localStorage.getItem('mf_gcal_token')).toBeNull();
    expect(server.disconnect).toHaveBeenCalledTimes(1);
  });
});

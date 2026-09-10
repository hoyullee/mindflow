import { describe, expect, it } from 'vitest';
import {
  buildGcalAuthUrl,
  buildGcalDeepLink,
  gcalRedirectUri,
  isGcalRedirectUri,
  newGcalState,
  readGcalDeepLink,
} from './desktopGoogleCalendar';

describe('설치형 앱의 구글 캘린더 동의 주소', () => {
  it('코드 흐름 + refresh token을 요구한다 — 서버가 조용히 갱신할 수 있어야 한다', () => {
    const u = new URL(buildGcalAuthUrl({ clientId: 'cid', redirectUri: 'https://geurio.com/auth/gcal', scope: 'a b', state: 'st' }));
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(u.searchParams.get('client_id')).toBe('cid');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('redirect_uri')).toBe('https://geurio.com/auth/gcal');
    expect(u.searchParams.get('scope')).toBe('a b');
    // 이 둘이 refresh token을 받는 짝이다 — 없으면 한 시간마다 다시 연결이 된다.
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('prompt')).toBe('consent');
    expect(u.searchParams.get('state')).toBe('st');
    expect(u.searchParams.get('login_hint')).toBeNull();
  });

  it('리디렉션 주소는 핸드오프 경로다', () => {
    expect(gcalRedirectUri('https://geurio.com')).toBe('https://geurio.com/auth/gcal');
    expect(isGcalRedirectUri('https://geurio.com/auth/gcal')).toBe(true);
    expect(isGcalRedirectUri('https://geurio.com/home')).toBe(false);
    expect(isGcalRedirectUri('postmessage')).toBe(false);
  });
});

describe('브라우저 → 앱 딥링크', () => {
  it('왕복한다', () => {
    const link = buildGcalDeepLink('4/abc def', 'st1');
    expect(readGcalDeepLink(link)).toEqual({ code: '4/abc def', state: 'st1' });
  });

  it('로그인 딥링크·남의 스킴·코드 없는 링크는 우리 것이 아니다', () => {
    // 로그인 딥링크도 같은 창구로 온다 — 대상이 다르면 조용히 버린다.
    expect(readGcalDeepLink('geurio://auth?refresh_token=rt')).toBeNull();
    expect(readGcalDeepLink('other://gcal?code=c')).toBeNull();
    expect(readGcalDeepLink('geurio://gcal?state=st')).toBeNull();
    expect(readGcalDeepLink('not a url')).toBeNull();
  });

  it('`geurio:gcal`처럼 정규화된 모양도 받는다 — OS마다 다르다', () => {
    expect(readGcalDeepLink('geurio:gcal?code=c&state=s')).toEqual({ code: 'c', state: 's' });
  });

  it('대조값은 매번 다르다', () => {
    expect(newGcalState()).not.toBe(newGcalState());
    expect(newGcalState()).toMatch(/^[0-9a-f]{32}$/);
  });
});

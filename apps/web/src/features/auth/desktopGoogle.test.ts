import { afterEach, describe, expect, it } from 'vitest';
import {
  buildAuthDeepLink,
  captureDesktopAuthToken,
  desktopAuthToken,
  DESKTOP_HANDOFF_PATH,
  handoffRedirectTo,
  readAuthDeepLink,
  resetDesktopAuthToken,
} from './desktopGoogle';

afterEach(() => {
  resetDesktopAuthToken();
  window.history.replaceState({}, '', '/');
});

describe('데스크톱 Google 로그인 핸드오프', () => {
  it('브라우저가 돌아올 주소는 공개 라우트다', () => {
    expect(handoffRedirectTo('https://geurio.com')).toBe(`https://geurio.com${DESKTOP_HANDOFF_PATH}`);
  });

  it('만든 딥링크를 그대로 되읽는다(브라우저가 만들고 앱이 읽는 유일한 형식)', () => {
    // 토큰에 URL에서 뜻이 있는 글자가 섞여도 왕복이 깨지지 않아야 한다.
    const token = 'v1.MTIz+/=?&#abc';
    expect(readAuthDeepLink(buildAuthDeepLink(token))).toEqual({ refreshToken: token });
  });

  it('해시로 온 것도 받는다', () => {
    expect(readAuthDeepLink('geurio://auth#refresh_token=rt2')).toEqual({ refreshToken: 'rt2' });
  });

  it('모르는 모양은 버린다 — OS가 넘긴 문자열은 아무나 만들 수 있다', () => {
    expect(readAuthDeepLink('geurio://auth')).toBe(null); // 토큰 없음
    expect(readAuthDeepLink('geurio://open?refresh_token=rt')).toBe(null); // 다른 대상
    expect(readAuthDeepLink('https://geurio.com/auth/desktop?refresh_token=rt')).toBe(null); // 다른 스킴
    expect(readAuthDeepLink('쓰레기')).toBe(null);
  });
});

describe('핸드오프 토큰 낚아채기 — Supabase 클라이언트가 읽기 전에', () => {
  it('해시의 갱신 토큰을 집고 **주소에서 지운다**', () => {
    // 우리 클라이언트는 `flowType: 'implicit'` + `detectSessionInUrl: true`라, 그냥
    // 두면 이 해시를 읽어 **브라우저에** 세션을 세우고 주소를 지운다. 그러면 앱에
    // 넘길 값이 사라지고 같은 세션이 두 곳에 남는다.
    window.history.replaceState({}, '', `${DESKTOP_HANDOFF_PATH}#access_token=at&refresh_token=rt-from-google&token_type=bearer`);
    expect(captureDesktopAuthToken()).toBe('rt-from-google');
    expect(window.location.hash).toBe('');
    // 페이지가 다시 그려져도 같은 값을 봐야 한다(비우지 않는다).
    expect(desktopAuthToken()).toBe('rt-from-google');
    expect(desktopAuthToken()).toBe('rt-from-google');
  });

  it('핸드오프 경로가 아니면 아무것도 하지 않는다 — 평범한 웹 로그인은 그대로다', () => {
    // 웹 로그인은 `detectSessionInUrl`이 이 해시를 읽어야 성립한다. 여기서 가로채면
    // 그 흐름이 통째로 깨진다.
    window.history.replaceState({}, '', '/login#access_token=at&refresh_token=web-rt');
    expect(captureDesktopAuthToken()).toBe(null);
    expect(window.location.hash).toBe('#access_token=at&refresh_token=web-rt');
  });

  it('넘길 것이 없으면 null — 앱 없이 이 주소를 직접 열었을 때', () => {
    window.history.replaceState({}, '', DESKTOP_HANDOFF_PATH);
    expect(captureDesktopAuthToken()).toBe(null);
  });
});

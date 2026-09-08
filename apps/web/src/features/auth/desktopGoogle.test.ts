import { afterEach, describe, expect, it } from 'vitest';
import {
  buildAuthDeepLink,
  captureDesktopAuthCode,
  desktopAuthCode,
  DESKTOP_HANDOFF_PATH,
  handoffRedirectTo,
  readAuthDeepLink,
  resetDesktopAuthCode,
} from './desktopGoogle';

afterEach(() => {
  resetDesktopAuthCode();
  window.history.replaceState({}, '', '/');
});

describe('데스크톱 Google 로그인 핸드오프', () => {
  it('브라우저가 돌아올 주소는 공개 라우트다', () => {
    expect(handoffRedirectTo('https://geurio.com')).toBe(`https://geurio.com${DESKTOP_HANDOFF_PATH}`);
  });

  it('만든 딥링크를 그대로 되읽는다(브라우저가 만들고 앱이 읽는 유일한 형식)', () => {
    // 코드에 URL에서 뜻이 있는 글자가 섞여도 왕복이 깨지지 않아야 한다.
    const code = 'abc123+/=?&#xyz';
    expect(readAuthDeepLink(buildAuthDeepLink(code))).toEqual({ code });
  });

  it('해시로 온 것도 받는다', () => {
    expect(readAuthDeepLink('geurio://auth#code=c2')).toEqual({ code: 'c2' });
  });

  it('모르는 모양은 버린다 — OS가 넘긴 문자열은 아무나 만들 수 있다', () => {
    expect(readAuthDeepLink('geurio://auth')).toBe(null); // 코드 없음
    expect(readAuthDeepLink('geurio://open?code=c')).toBe(null); // 다른 대상
    expect(readAuthDeepLink('https://geurio.com/auth/desktop?code=c')).toBe(null); // 다른 스킴
    expect(readAuthDeepLink('쓰레기')).toBe(null);
  });
});

describe('인가 코드 낚아채기 — Supabase 클라이언트가 손대기 전에', () => {
  it('핸드오프 주소의 코드를 집고 **주소에서 지운다**', () => {
    // 우리 클라이언트는 `detectSessionInUrl: true`라 그냥 두면 스스로 교환을
    // 시도하고(앱의 verifier가 없으니 실패한다) 주소에서 `?code=`를 지운다.
    // 그러면 앱에 넘길 것이 없어지므로 엔트리에서 먼저 집어야 한다.
    window.history.replaceState({}, '', `${DESKTOP_HANDOFF_PATH}?code=code-from-google`);
    expect(captureDesktopAuthCode()).toBe('code-from-google');
    expect(window.location.search).toBe('');
    // 페이지가 다시 그려져도 같은 값을 봐야 한다(비우지 않는다).
    expect(desktopAuthCode()).toBe('code-from-google');
    expect(desktopAuthCode()).toBe('code-from-google');
  });

  it('핸드오프 경로가 아니면 아무것도 하지 않는다 — 평범한 웹 로그인은 그대로다', () => {
    // 웹 로그인은 `detectSessionInUrl`이 코드를 소비해야 성립한다. 여기서 가로채면
    // 그 흐름이 통째로 깨진다.
    window.history.replaceState({}, '', '/login?code=web-login-code');
    expect(captureDesktopAuthCode()).toBe(null);
    expect(window.location.search).toBe('?code=web-login-code');
  });

  it('코드가 없으면 null — 앱 없이 이 주소를 직접 열었을 때', () => {
    window.history.replaceState({}, '', DESKTOP_HANDOFF_PATH);
    expect(captureDesktopAuthCode()).toBe(null);
  });
});

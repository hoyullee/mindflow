import { describe, expect, it } from 'vitest';
import { buildAuthDeepLink, DESKTOP_HANDOFF_PATH, handoffRedirectTo, readAuthDeepLink } from './desktopGoogle';

describe('데스크톱 Google 로그인 핸드오프', () => {
  it('브라우저가 돌아올 주소는 공개 라우트다', () => {
    expect(handoffRedirectTo('https://geurio.com')).toBe(`https://geurio.com${DESKTOP_HANDOFF_PATH}`);
  });

  it('만든 딥링크를 그대로 되읽는다(브라우저가 만들고 앱이 읽는 유일한 형식)', () => {
    // 토큰에 URL에서 뜻이 있는 글자가 섞여도 왕복이 깨지지 않아야 한다.
    const token = 'v1.MTIz+/=?&#abc';
    const link = buildAuthDeepLink(token);
    expect(readAuthDeepLink(link)).toEqual({ refreshToken: token });
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

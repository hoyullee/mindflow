import { describe, expect, it } from 'vitest';
import { googleLinkRefused } from './googleLink';

// 제보: ① 이메일로 A@ 가입 → ② 같은 주소로 Google 로그인 하면 Supabase가 자동으로
// 연결해 한 계정에 두 수단이 붙는다. 판정은 세션의 app_metadata 두 값으로 한다.
describe('googleLinkRefused', () => {
  it('이메일로 가입한 계정에 Google로 들어오면 거절한다(제보 흐름)', () => {
    expect(googleLinkRefused({ signInProvider: 'google', linkedProviders: ['email', 'google'] })).toBe(true);
  });

  it('Google로만 가입한 계정의 Google 로그인은 통과', () => {
    expect(googleLinkRefused({ signInProvider: 'google', linkedProviders: ['google'] })).toBe(false);
  });

  it('비밀번호 로그인은 두 수단이 이미 연결돼 있어도 막지 않는다', () => {
    // 이미 연결된 계정의 주인이 비밀번호로 들어오는 것을 막으면 계정을 잃는다.
    expect(googleLinkRefused({ signInProvider: 'email', linkedProviders: ['email', 'google'] })).toBe(false);
  });

  it('모르는 값(provider 없음·목록 없음)은 막지 않는다', () => {
    expect(googleLinkRefused({ signInProvider: null, linkedProviders: ['email'] })).toBe(false);
    expect(googleLinkRefused({ signInProvider: 'google' })).toBe(false);
    expect(googleLinkRefused({})).toBe(false);
    expect(googleLinkRefused(null)).toBe(false);
  });
});

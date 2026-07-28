import { describe, expect, it } from 'vitest';
import { initialLoginState } from './types';
import { loginUpdateRisk } from './updateRisk';

describe('loginUpdateRisk (로그인에서 새 버전 자동 적용 판단)', () => {
  it('손대지 않은 빈 폼은 안전 — 잃을 게 없다', () => {
    expect(loginUpdateRisk(initialLoginState)).toBe('safe');
  });

  it('한 글자라도 입력했으면 막는다', () => {
    expect(loginUpdateRisk({ ...initialLoginState, email: 'a@b.com' })).toBe('block');
    expect(loginUpdateRisk({ ...initialLoginState, password: 'x' })).toBe('block');
    expect(loginUpdateRisk({ ...initialLoginState, password2: 'x' })).toBe('block');
  });

  it('인증 코드 단계는 막는다 — 리로드하면 메일을 다시 받아야 한다', () => {
    expect(loginUpdateRisk({ ...initialLoginState, step: 'verify' })).toBe('block');
    expect(loginUpdateRisk({ ...initialLoginState, step: 'forgotVerify' })).toBe('block');
  });

  it('비밀번호 찾기 단계도 막는다', () => {
    expect(loginUpdateRisk({ ...initialLoginState, step: 'forgot' })).toBe('block');
  });

  it('요청이 날아가 있는 중이면 막는다 — 결과를 놓치지 않도록', () => {
    expect(loginUpdateRisk({ ...initialLoginState, busy: true })).toBe('block');
  });
});

import { describe, expect, it, beforeEach } from 'vitest';
import { authSessionStorage, rememberSession, setRememberSession } from './rememberSession';

describe('rememberSession', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('기본값은 유지 — 아무것도 고르지 않았으면 localStorage에 남는다', () => {
    expect(rememberSession()).toBe(true);
    authSessionStorage.setItem('sb-token', 'v1');
    expect(localStorage.getItem('sb-token')).toBe('v1');
    expect(sessionStorage.getItem('sb-token')).toBeNull();
  });

  it('유지를 끄면 탭 저장소에만 남는다(창을 닫으면 사라진다)', () => {
    setRememberSession(false);
    expect(rememberSession()).toBe(false);
    authSessionStorage.setItem('sb-token', 'v2');
    expect(sessionStorage.getItem('sb-token')).toBe('v2');
    expect(localStorage.getItem('sb-token')).toBeNull();
  });

  it('유지를 끄면 예전에 남아 있던 localStorage 사본도 치운다', () => {
    localStorage.setItem('sb-token', 'old');
    setRememberSession(false);
    authSessionStorage.setItem('sb-token', 'new');
    expect(localStorage.getItem('sb-token')).toBeNull();
    expect(authSessionStorage.getItem('sb-token')).toBe('new');
  });

  it('읽기는 두 곳을 본다 — 이미 로그인해 둔 세션이 체크를 끈다고 사라지지 않는다', () => {
    localStorage.setItem('sb-token', 'kept');
    setRememberSession(false);
    expect(authSessionStorage.getItem('sb-token')).toBe('kept');
  });

  it('지우기는 두 곳 모두 — 로그아웃이 반쪽으로 남지 않는다', () => {
    localStorage.setItem('sb-token', 'a');
    sessionStorage.setItem('sb-token', 'b');
    authSessionStorage.removeItem('sb-token');
    expect(localStorage.getItem('sb-token')).toBeNull();
    expect(sessionStorage.getItem('sb-token')).toBeNull();
  });
});

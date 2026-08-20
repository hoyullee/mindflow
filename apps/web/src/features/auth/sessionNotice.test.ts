import { beforeEach, describe, expect, it } from 'vitest';
import { SESSION_EXPIRED_MESSAGE, forgetSignedIn, hadSession, loginUrlWithNext, noteLoginNotice, noteSessionExpired, rememberSignedIn, safeNextPath, takeLoginNotice } from './sessionNotice';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

// 세션 정책 ② — 만료를 조용히 넘기지 않는다(backend.md §15).
describe('sessionNotice', () => {
  it('로그인한 적 있는 기기에서만 만료 판정의 근거가 남는다', () => {
    expect(hadSession()).toBe(false); // 첫 방문 = 그냥 문지기(만료 아님)
    rememberSignedIn();
    expect(hadSession()).toBe(true);
  });

  it('직접 로그아웃하면 마커가 지워진다 — 다음 방문에 "만료" 거짓말을 하지 않는다', () => {
    rememberSignedIn();
    noteSessionExpired();
    forgetSignedIn();
    expect(hadSession()).toBe(false);
    expect(takeLoginNotice()).toBeNull();
  });

  it('안내는 한 번만 꺼내진다 — 만료와 Google 거절이 같은 자리를 쓴다', () => {
    noteSessionExpired();
    expect(takeLoginNotice()).toBe(SESSION_EXPIRED_MESSAGE);
    expect(takeLoginNotice()).toBeNull();
    // 같은 채널에 다른 안내도 실린다(googleLink의 거절 문구 등).
    noteLoginNotice('다른 안내');
    expect(takeLoginNotice()).toBe('다른 안내');
  });

  it('next는 우리 앱 안의 경로만 통과한다(오픈 리다이렉트 차단)', () => {
    expect(safeNextPath('/editor?map=abc')).toBe('/editor?map=abc');
    expect(safeNextPath('//evil.com')).toBeNull();
    expect(safeNextPath('/\\evil.com')).toBeNull();
    expect(safeNextPath('https://evil.com')).toBeNull();
    expect(safeNextPath('')).toBeNull();
    expect(safeNextPath(null)).toBeNull();
    // 로그인·랜딩으로 되돌아가는 값은 뜻이 없다
    expect(safeNextPath('/login')).toBeNull();
    expect(safeNextPath('/')).toBeNull();
  });

  it('loginUrlWithNext는 지금 화면을 인코딩해 싣는다', () => {
    expect(loginUrlWithNext('/editor', '?map=m1&title=x')).toBe(`/login?next=${encodeURIComponent('/editor?map=m1&title=x')}`);
    expect(loginUrlWithNext('/login')).toBe('/login'); // 실을 것이 없으면 맨 주소
  });
});

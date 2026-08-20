import { beforeEach, describe, expect, it } from 'vitest';
import { DEMO_SETUP_CODE, LocalAuth } from './localAuth';

// 데모(로컬) 모드의 "로그인 수단" — 서버가 없으니 이 브라우저가 정본이다.
// Supabase 어댑터와 **같은 규칙**으로 움직여야 설정 화면을 데모에서 눌러 보는 것이
// 실제 동작을 대변한다(진짜 판정은 서버가 한다).
describe('LocalAuth 로그인 수단 (데모)', () => {
  beforeEach(() => localStorage.clear());

  it('기본은 이메일 가입 계정 — 비밀번호가 있다', async () => {
    expect(await new LocalAuth().signinMethods()).toEqual({ hasPassword: true, providers: ['email'] });
  });

  it('데모 Google 로그인으로 들어오면 Google 전용이 된다(비밀번호 설정 흐름을 눌러 볼 수 있게)', async () => {
    const auth = new LocalAuth();
    await auth.signInWithOAuth();
    expect(await auth.signinMethods()).toEqual({ hasPassword: false, providers: ['google'] });
  });

  it('코드가 틀리면 아무것도 바뀌지 않고, 맞으면 비밀번호만 걸린다(신원은 그대로)', async () => {
    const auth = new LocalAuth();
    await auth.signInWithOAuth();
    expect(await auth.setPasswordWithCode('999999', 'pw')).toMatchObject({ wrongCode: true });
    expect(await auth.signinMethods()).toEqual({ hasPassword: false, providers: ['google'] });

    expect(await auth.setPasswordWithCode(DEMO_SETUP_CODE, 'pw')).toEqual({});
    // 실제 Supabase와 같다 — `updateUser({ password })`는 identities를 건드리지 않는다.
    expect(await auth.signinMethods()).toEqual({ hasPassword: true, providers: ['google'] });
  });

  // 그 빈자리를 메우는 것이 신원 등록이다(0030) — 이게 있어야 Google을 뗄 수 있다.
  it('이메일 신원 등록은 비밀번호가 있을 때 한 번만 성립한다', async () => {
    const auth = new LocalAuth();
    await auth.signInWithOAuth();
    expect(await auth.registerEmailIdentity()).toBe(false); // 비밀번호 없음
    await auth.setPasswordWithCode(DEMO_SETUP_CODE, 'pw');
    expect(await auth.registerEmailIdentity()).toBe(true);
    expect((await auth.signinMethods())?.providers).toEqual(['google', 'email']);
    expect(await auth.registerEmailIdentity()).toBe(false); // 이미 있다
  });

  it('연결·해제가 수단 목록을 늘리고 줄인다', async () => {
    const auth = new LocalAuth();
    await auth.linkGoogle();
    expect((await auth.signinMethods())?.providers).toEqual(['email', 'google']);
    await auth.linkGoogle(); // 두 번 눌러도 하나다
    expect((await auth.signinMethods())?.providers).toEqual(['email', 'google']);
    await auth.unlinkGoogle();
    expect((await auth.signinMethods())?.providers).toEqual(['email']);
  });
});

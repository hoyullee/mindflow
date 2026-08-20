import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseAuth } from './supabaseAuth';

// Fake client exposing only what getSession() touches — no network, no real SDK.
function clientWithUser(user: Record<string, unknown> | null): SupabaseClient {
  return {
    auth: {
      getSession: async () => ({ data: { session: user ? { user } : null } }),
    },
  } as unknown as SupabaseClient;
}

describe('SupabaseAuth session mapping (OAuth identity metadata)', () => {
  it('surfaces the Google full_name and avatar_url on the session user', async () => {
    const auth = new SupabaseAuth(
      clientWithUser({
        id: 'u1',
        email: 'hoyul@gmail.com',
        user_metadata: { full_name: '이호율', avatar_url: 'https://lh3.googleusercontent.com/a/photo=s96-c' },
      }),
    );
    const session = await auth.getSession();
    expect(session?.user.name).toBe('이호율');
    expect(session?.user.avatarUrl).toBe('https://lh3.googleusercontent.com/a/photo=s96-c');
  });

  it('falls back to metadata name/picture when full_name/avatar_url are absent', async () => {
    const auth = new SupabaseAuth(clientWithUser({ id: 'u1', email: 'a@b.c', user_metadata: { name: 'Hoyul Lee', picture: 'https://p/x.jpg' } }));
    const session = await auth.getSession();
    expect(session?.user.name).toBe('Hoyul Lee');
    expect(session?.user.avatarUrl).toBe('https://p/x.jpg');
  });

  it('leaves name/avatar null-ish for email/password accounts (no metadata)', async () => {
    const auth = new SupabaseAuth(clientWithUser({ id: 'u1', email: 'a@b.c', user_metadata: {} }));
    const session = await auth.getSession();
    expect(session?.user.name ?? null).toBeNull();
    expect(session?.user.avatarUrl ?? null).toBeNull();
  });
});

describe('SupabaseAuth signInWithIdToken (GIS token exchange)', () => {
  function clientCapturingIdToken(result: { session?: Record<string, unknown> | null; errorMsg?: string }) {
    const captured: { args?: Record<string, unknown> } = {};
    const client = {
      auth: {
        signInWithIdToken: async (args: Record<string, unknown>) => {
          captured.args = args;
          if (result.errorMsg) return { data: { session: null }, error: { message: result.errorMsg } };
          return { data: { session: result.session ?? null }, error: null };
        },
      },
    } as unknown as SupabaseClient;
    return { client, captured };
  }

  it('passes provider/token/nonce through and maps the returned session (incl. Google metadata)', async () => {
    const { client, captured } = clientCapturingIdToken({
      session: { user: { id: 'u9', email: 'g@x.y', user_metadata: { full_name: '이호율', picture: 'https://p/a.jpg' } } },
    });
    const res = await new SupabaseAuth(client).signInWithIdToken('google', 'jwt-token', 'raw-nonce');
    expect(captured.args).toEqual({ provider: 'google', token: 'jwt-token', nonce: 'raw-nonce' });
    expect(res.error).toBeUndefined();
    expect(res.session?.user.email).toBe('g@x.y');
    expect(res.session?.user.name).toBe('이호율');
    expect(res.session?.user.avatarUrl).toBe('https://p/a.jpg');
  });

  it('omits the nonce key entirely when none was minted (WebCrypto unavailable path)', async () => {
    const { client, captured } = clientCapturingIdToken({ session: { user: { id: 'u1', email: 'a@b.c', user_metadata: {} } } });
    await new SupabaseAuth(client).signInWithIdToken('google', 'jwt-token');
    expect(captured.args).toEqual({ provider: 'google', token: 'jwt-token' });
    expect('nonce' in captured.args!).toBe(false);
  });

  it('surfaces the Supabase error message with a null session', async () => {
    const { client } = clientCapturingIdToken({ errorMsg: 'Invalid ID token' });
    const res = await new SupabaseAuth(client).signInWithIdToken('google', 'bad-token', 'n');
    expect(res.session).toBeNull();
    expect(res.error).toBe('Invalid ID token');
  });
});

describe('SupabaseAuth isEmailRegistered (email_is_registered RPC)', () => {
  function clientWithRpc(result: { data?: unknown; errorMsg?: string }) {
    const captured: { fn?: string; args?: Record<string, unknown> } = {};
    const client = {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        captured.fn = fn;
        captured.args = args;
        if (result.errorMsg) return { data: null, error: { message: result.errorMsg } };
        return { data: result.data, error: null };
      },
    } as unknown as SupabaseClient;
    return { client, captured };
  }

  it('calls the RPC with p_email and returns its boolean result', async () => {
    const yes = clientWithRpc({ data: true });
    expect(await new SupabaseAuth(yes.client).isEmailRegistered('a@b.c')).toBe(true);
    expect(yes.captured.fn).toBe('email_is_registered');
    expect(yes.captured.args).toEqual({ p_email: 'a@b.c' });

    const no = clientWithRpc({ data: false });
    expect(await new SupabaseAuth(no.client).isEmailRegistered('nope@x.y')).toBe(false);
  });

  it('returns null (unknown → caller proceeds) when the RPC errors or is missing', async () => {
    const { client } = clientWithRpc({ errorMsg: 'function email_is_registered does not exist' });
    expect(await new SupabaseAuth(client).isEmailRegistered('a@b.c')).toBeNull();
  });

  it('returns null when the RPC yields a non-boolean payload', async () => {
    const { client } = clientWithRpc({ data: null });
    expect(await new SupabaseAuth(client).isEmailRegistered('a@b.c')).toBeNull();
  });
});

describe('SupabaseAuth signInWithOAuth', () => {
  it('always requests the Google account chooser (prompt=select_account)', async () => {
    // Without this param Google silently reuses the signed-in browser account
    // after the first consent — the button then can't switch accounts at all.
    let captured: Record<string, unknown> | null = null;
    const client = {
      auth: {
        signInWithOAuth: async (args: Record<string, unknown>) => {
          captured = args;
          return { error: null };
        },
      },
    } as unknown as SupabaseClient;
    const auth = new SupabaseAuth(client);
    const res = await auth.signInWithOAuth('google');
    expect(res.error).toBeUndefined();
    expect(captured!.provider).toBe('google');
    const options = captured!.options as { queryParams?: Record<string, string> };
    expect(options.queryParams).toEqual({ prompt: 'select_account' });
  });
});


// 제보: Google로 가입한 이메일로 이메일 회원가입을 시도하면 인증번호 화면까지
// 넘어가는데 코드가 오지 않는다. Supabase `signUp`이 이메일 열거 방지로 이미
// 가입된 주소에도 성공을 돌려주기 때문(메일은 발송 안 됨) — 유일한 단서가
// `identities`가 빈 배열인 가짜 user다.
describe('SupabaseAuth signUp — 이미 가입된 이메일 감지', () => {
  function clientWithSignUp(result: { data: Record<string, unknown>; error: { message: string } | null }): SupabaseClient {
    return { auth: { signUp: async () => result } } as unknown as SupabaseClient;
  }

  it('identities가 빈 배열이면 성공이 아니라 "이미 가입됨" 오류로 돌려준다', async () => {
    const auth = new SupabaseAuth(clientWithSignUp({ data: { user: { id: 'fake', email: 'a@b.c', identities: [] }, session: null }, error: null }));
    const res = await auth.signUp('a@b.c', 'pw1234');
    expect(res.session).toBeNull();
    expect(res.needsVerification).toBeFalsy(); // 인증 화면으로 보내지 않는다
    expect(res.error).toMatch(/already registered/i);
  });

  it('진짜 신규 가입(identities 있음)은 인증 대기로 통과', async () => {
    const auth = new SupabaseAuth(clientWithSignUp({ data: { user: { id: 'u9', email: 'new@b.c', identities: [{ provider: 'email' }] }, session: null }, error: null }));
    const res = await auth.signUp('new@b.c', 'pw1234');
    expect(res.error).toBeUndefined();
    expect(res.needsVerification).toBe(true);
  });

  it('identities 필드가 아예 없는 응답은 기존대로 통과 (구버전 SDK 방어)', async () => {
    const auth = new SupabaseAuth(clientWithSignUp({ data: { user: { id: 'u9', email: 'new@b.c' }, session: null }, error: null }));
    const res = await auth.signUp('new@b.c', 'pw1234');
    expect(res.error).toBeUndefined();
    expect(res.needsVerification).toBe(true);
  });
});

describe('SupabaseAuth emailSignInProviders (email_signin_providers RPC)', () => {
  function clientWithRpc(impl: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>): SupabaseClient {
    return { rpc: impl } as unknown as SupabaseClient;
  }

  it('RPC가 돌려준 공급자 목록을 그대로 전달한다', async () => {
    const auth = new SupabaseAuth(
      clientWithRpc(async (fn, args) => {
        expect(fn).toBe('email_signin_providers');
        expect(args).toEqual({ p_email: 'g@example.com' });
        return { data: ['google'], error: null };
      }),
    );
    expect(await auth.emailSignInProviders('g@example.com')).toEqual(['google']);
  });

  it('미가입은 빈 배열', async () => {
    const auth = new SupabaseAuth(clientWithRpc(async () => ({ data: [], error: null })));
    expect(await auth.emailSignInProviders('none@example.com')).toEqual([]);
  });

  it('RPC 미배포/실패는 null — 호출부가 기존 흐름으로 진행하게 한다', async () => {
    const auth = new SupabaseAuth(clientWithRpc(async () => ({ data: null, error: { message: 'function does not exist' } })));
    expect(await auth.emailSignInProviders('x@example.com')).toBeNull();
  });

  it('문자열이 아닌 값은 걸러 낸다', async () => {
    const auth = new SupabaseAuth(clientWithRpc(async () => ({ data: ['email', 42, null, 'google'], error: null })));
    expect(await auth.emailSignInProviders('x@example.com')).toEqual(['email', 'google']);
  });
});

// 세션 정책 ①③(backend.md §15) — 로그아웃 범위와 비밀번호 변경 시 다른 세션 해지.
describe('SupabaseAuth 세션 정책 — signOut 범위 / 비밀번호 변경 후 다른 세션 해지', () => {
  function clientCapturingSignOut(updateError?: string) {
    /** 호출마다 넘어간 범위 — 옵션이 없으면(=SDK 기본, 로컬 세션만) null. */
    const calls: (string | null)[] = [];
    const client = {
      auth: {
        signOut: async (opts?: { scope?: string }) => {
          calls.push(opts?.scope ?? null);
          return { error: null };
        },
        updateUser: async () => (updateError ? { error: { message: updateError } } : { error: null }),
      },
    } as unknown as SupabaseClient;
    return { client, calls };
  }

  it('기본(local)은 SDK 기본 동작 — 이 기기만, 다른 기기는 그대로', async () => {
    const { client, calls } = clientCapturingSignOut();
    await new SupabaseAuth(client).signOut();
    expect(calls).toEqual([null]); // 옵션 없이 호출 = 로컬 세션만
  });

  it("'global'은 모든 기기의 세션을 해지한다(분실·공용 PC 회수)", async () => {
    const { client, calls } = clientCapturingSignOut();
    await new SupabaseAuth(client).signOut('global');
    expect(calls).toEqual(['global']);
  });

  it('비밀번호를 바꾸면 다른 세션을 해지하되(others) 지금 세션은 남긴다', async () => {
    const { client, calls } = clientCapturingSignOut();
    const res = await new SupabaseAuth(client).updatePassword('newpw123!');
    expect(res.error).toBeUndefined();
    expect(calls).toEqual(['others']);
  });

  it('비밀번호 변경이 실패하면 세션을 건드리지 않는다', async () => {
    const { client, calls } = clientCapturingSignOut('too weak');
    const res = await new SupabaseAuth(client).updatePassword('x');
    expect(res.error).toBe('too weak');
    expect(calls).toEqual([]);
  });
});

// 설정 → 비밀번호 변경(backend.md §15): 현재 비밀번호로 본인을 확인한 뒤 바꾸고,
// 다른 기기의 세션을 해지한다. Supabase는 세션만 있으면 비밀번호를 바꿔 주므로
// 이 확인이 공용 PC에 남은 로그인으로 계정을 가져가는 것을 막는 유일한 장치다.
describe('SupabaseAuth changePassword (현재 비밀번호 확인)', () => {
  function client(opts: { email?: string | null; signInError?: string; updateError?: string }) {
    const calls: string[] = [];
    const c = {
      auth: {
        getUser: async () => ({ data: { user: opts.email === null ? null : { email: opts.email ?? 'me@geurio.com' } } }),
        signInWithPassword: async (args: { email: string; password: string }) => {
          calls.push(`signIn:${args.email}:${args.password}`);
          return opts.signInError ? { data: { session: null }, error: { message: opts.signInError } } : { data: { session: { user: { id: 'u1' } } }, error: null };
        },
        updateUser: async () => {
          calls.push('update');
          return opts.updateError ? { error: { message: opts.updateError } } : { error: null };
        },
        signOut: async (o?: { scope?: string }) => {
          calls.push(`signOut:${o?.scope ?? 'local'}`);
          return { error: null };
        },
      },
    } as unknown as SupabaseClient;
    return { c, calls };
  }

  it('확인 → 변경 → 다른 세션 해지 순으로 진행한다', async () => {
    const { c, calls } = client({});
    const res = await new SupabaseAuth(c).changePassword('old-pw', 'new-pw');
    expect(res.error).toBeUndefined();
    expect(calls).toEqual(['signIn:me@geurio.com:old-pw', 'update', 'signOut:others']);
  });

  it('현재 비밀번호가 틀리면 wrongCurrent로 알리고 비밀번호를 건드리지 않는다', async () => {
    const { c, calls } = client({ signInError: 'Invalid login credentials' });
    const res = await new SupabaseAuth(c).changePassword('wrong', 'new-pw');
    expect(res.wrongCurrent).toBe(true);
    expect(calls).toEqual(['signIn:me@geurio.com:wrong']); // update/signOut 없음
  });

  it('새 비밀번호가 정책에 걸리면 그 오류를 돌려주고 세션을 해지하지 않는다', async () => {
    const { c, calls } = client({ updateError: 'Password should be at least 6 characters' });
    const res = await new SupabaseAuth(c).changePassword('old-pw', 'x');
    expect(res.error).toBe('Password should be at least 6 characters');
    expect(res.wrongCurrent).toBeUndefined();
    expect(calls).toEqual(['signIn:me@geurio.com:old-pw', 'update']);
  });

  it('세션이 없으면(이메일을 못 얻으면) 아무것도 하지 않는다', async () => {
    const { c, calls } = client({ email: null });
    const res = await new SupabaseAuth(c).changePassword('a', 'b');
    expect(res.error).toBeTruthy();
    expect(calls).toEqual([]);
  });
});

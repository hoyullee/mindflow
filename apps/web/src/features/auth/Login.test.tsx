import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Login } from './Login';
import { mockMatchMedia } from '../../test/matchMedia';
import { BackendProvider } from '../../adapters/BackendContext';
import { LocalAuth } from '../../adapters/local/localAuth';
import { LocalSpaceStore } from '../../adapters/local/localSpaceStore';
import type { AuthResult, Backend, DocStore } from '../../adapters/ports';

const stubDocStore = {
  list: async () => [],
  load: async () => null,
  save: async () => ({ ok: true, version: 1 }),
  setFavorite: async () => undefined,
  remove: async () => undefined,
  restore: async () => undefined,
  purge: async () => undefined,
  rename: async () => undefined,
} as unknown as DocStore;

/** A Supabase-mode auth whose signUp requires email confirmation (like the real
 * default project). resendSignup keeps LocalAuth's no-op body; the test spies on
 * it to assert the controller actually calls it with the signup email. */
class VerifyAuth extends LocalAuth {
  override async signUp(): Promise<AuthResult> {
    return { session: null, needsVerification: true };
  }
}

/** A Supabase-mode auth with the recovery path spied: verifyOtp('recovery')
 * yields a session for any code except '000000' (which fails, like a bad/expired
 * token). `vi.spyOn().mockImplementation` sidesteps LocalAuth's param-less base
 * signatures while still recording the real (email, code, type) / (newPw) args. */
function makeRecoveryAuth() {
  const auth = new LocalAuth();
  const verifySpy = vi.spyOn(auth, 'verifyOtp').mockImplementation(async (...args: unknown[]): Promise<AuthResult> => {
    const [email, token] = args as [string, string, string];
    if (token === '000000') return { session: null, error: '인증 코드가 올바르지 않아요.' };
    return { session: { user: { id: 'r1', email } } };
  });
  const updateSpy = vi.spyOn(auth, 'updatePassword').mockResolvedValue({});
  const resetSpy = vi.spyOn(auth, 'sendPasswordReset');
  return { auth, verifySpy, updateSpy, resetSpy };
}

function renderSupa(auth: LocalAuth) {
  const backend: Backend = { auth, docStore: stubDocStore, spaceStore: new LocalSpaceStore(), mode: 'supabase' };
  return render(
    <MemoryRouter>
      <BackendProvider backend={backend}>
        <Login />
      </BackendProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

function renderLogin() {
  return render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>,
  );
}

describe('Login', () => {
  it('renders the welcome heading and login submit button on initial render', () => {
    renderLogin();

    expect(screen.getByText('Geurio에 오신 것을 환영해요')).toBeTruthy();
    expect(screen.getByRole('button', { name: '로그인' })).toBeTruthy();
  });

  it('switches to signup mode and reveals the password-confirm field', async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.click(screen.getByText('가입하기'));

    // 가입 모드에선 제목도 '가입하기'(제출 버튼과 동일 문구) — 제목 div + 버튼 둘 다 존재.
    expect(screen.getAllByText('가입하기').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByPlaceholderText('비밀번호 재입력')).toBeTruthy();
    expect(screen.getByRole('button', { name: '가입하기' })).toBeTruthy();
  });

  it('shows a validation error when submitting an invalid email', async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByPlaceholderText('you@example.com'), 'not-an-email');
    await user.type(screen.getByPlaceholderText('비밀번호 입력'), 'password123');
    await user.click(screen.getByRole('button', { name: '로그인' }));

    expect(screen.getByText('올바른 이메일 주소를 입력해 주세요.')).toBeTruthy();
  });

  it('advances signup to the verify step and displays the demo code', async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.click(screen.getByText('가입하기'));
    await user.type(screen.getByPlaceholderText('you@example.com'), 'demo@example.com');
    await user.type(screen.getByPlaceholderText('비밀번호 입력'), 'password123');
    await user.type(screen.getByPlaceholderText('비밀번호 재입력'), 'password123');
    await user.click(screen.getByRole('button', { name: '가입하기' }));

    expect(screen.getByText('이메일 인증')).toBeTruthy();
    expect(screen.getByText(/데모 코드:/)).toBeTruthy();
    expect(screen.getByPlaceholderText('인증 코드 입력')).toBeTruthy();
  });

  it('supabase mode: the verify step hides the demo code and opens with the resend countdown locked', async () => {
    const user = userEvent.setup();
    const auth = new VerifyAuth();
    renderSupa(auth);

    await user.click(screen.getByText('가입하기'));
    await user.type(screen.getByPlaceholderText('you@example.com'), 'real@example.com');
    await user.type(screen.getByPlaceholderText('비밀번호 입력'), 'password123');
    await user.type(screen.getByPlaceholderText('비밀번호 재입력'), 'password123');
    await user.click(screen.getByRole('button', { name: '가입하기' }));

    // reached the verify step, but with NO demo-code hint (real email has the code)
    expect(await screen.findByPlaceholderText('인증 코드 입력')).toBeTruthy();
    expect(screen.queryByText(/데모 코드:/)).toBeNull();
    // the resend countdown is showing and "다시 보내기" is locked (not yet a link)
    expect(screen.getByText(/초 후 다시 보내기/)).toBeTruthy();
    expect(screen.queryByText('다시 보내기')).toBeNull();
  });

  it('shows a live resend countdown that re-enables 다시 보내기, then re-sends (rate limit → localized)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const auth = new VerifyAuth();
      const resendSpy = vi.spyOn(auth, 'resendSignup').mockResolvedValue({ error: 'For security purposes, you can only request this after 21 seconds.' });
      renderSupa(auth);

      await user.click(screen.getByText('가입하기'));
      await user.type(screen.getByPlaceholderText('you@example.com'), 'cd@example.com');
      await user.type(screen.getByPlaceholderText('비밀번호 입력'), 'password123');
      await user.type(screen.getByPlaceholderText('비밀번호 재입력'), 'password123');
      await user.click(screen.getByRole('button', { name: '가입하기' }));

      // countdown visible + resend locked
      expect(await screen.findByText(/초 후 다시 보내기/)).toBeTruthy();
      expect(screen.queryByText('다시 보내기')).toBeNull();

      // let the 60s cooldown elapse → "다시 보내기" becomes an active link
      await act(async () => {
        vi.advanceTimersByTime(60_000);
      });
      await waitFor(() => expect(screen.getByText('다시 보내기')).toBeTruthy());

      // clicking re-sends for real; a rate-limit reply is localized + syncs the countdown to 21s
      await user.click(screen.getByText('다시 보내기'));
      await waitFor(() => expect(resendSpy).toHaveBeenCalledWith('cd@example.com'));
      await waitFor(() => expect(screen.getByText(/약 21초 후에 다시 시도해 주세요/)).toBeTruthy());
      expect(screen.getByText(/21초 후 다시 보내기/)).toBeTruthy();
      expect(screen.queryByText(/For security purposes/)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('supabase mode: accepts an 8-digit OTP (input not capped at 6) and verifies with the full code', async () => {
    // Repro: Supabase can be configured to send an 8-digit email OTP, but the
    // input used to slice() to 6 so the code could never be entered in full.
    const user = userEvent.setup();
    const auth = new VerifyAuth();
    const verifySpy = vi.spyOn(auth, 'verifyOtp'); // LocalAuth base yields a session for any input
    const backend: Backend = { auth, docStore: stubDocStore, spaceStore: new LocalSpaceStore(), mode: 'supabase' };
    render(
      <MemoryRouter>
        <BackendProvider backend={backend}>
          <Login />
        </BackendProvider>
      </MemoryRouter>,
    );

    await user.click(screen.getByText('가입하기'));
    await user.type(screen.getByPlaceholderText('you@example.com'), 'eight@example.com');
    await user.type(screen.getByPlaceholderText('비밀번호 입력'), 'password123');
    await user.type(screen.getByPlaceholderText('비밀번호 재입력'), 'password123');
    await user.click(screen.getByRole('button', { name: '가입하기' }));

    const codeInput = (await screen.findByPlaceholderText('인증 코드 입력')) as HTMLInputElement;
    await user.type(codeInput, '12345678'); // 8 digits
    expect(codeInput.value).toBe('12345678'); // not truncated to 6

    await user.click(screen.getByRole('button', { name: '인증하고 시작하기' }));
    await waitFor(() => expect(verifySpy).toHaveBeenCalledWith('eight@example.com', '12345678', 'signup'));
  });

  it('supabase mode: password reset runs the REAL recovery flow (verifyOtp recovery → updatePassword) and hides the demo code', async () => {
    const user = userEvent.setup();
    const { auth, verifySpy, updateSpy, resetSpy } = makeRecoveryAuth();
    const backend: Backend = { auth, docStore: stubDocStore, spaceStore: new LocalSpaceStore(), mode: 'supabase' };
    render(
      <MemoryRouter>
        <BackendProvider backend={backend}>
          <Login />
        </BackendProvider>
      </MemoryRouter>,
    );

    // form → 비밀번호 찾기 → enter email → 재설정 코드 보내기
    await user.click(screen.getByText('비밀번호 찾기'));
    await user.type(screen.getByPlaceholderText('you@example.com'), 'reset@example.com');
    await user.click(screen.getByRole('button', { name: '재설정 코드 보내기' }));
    await waitFor(() => expect(resetSpy).toHaveBeenCalledWith('reset@example.com'));

    // reset-verify step: NO demo code in production mode
    expect(await screen.findByPlaceholderText('인증 코드 입력')).toBeTruthy();
    expect(screen.queryByText(/데모 코드:/)).toBeNull();

    // enter the emailed 6-digit code + a new password → real recovery
    await user.type(screen.getByPlaceholderText('인증 코드 입력'), '123456');
    await user.type(screen.getByPlaceholderText('새 비밀번호 입력'), 'newpass123');
    await user.type(screen.getByPlaceholderText('새 비밀번호 재입력'), 'newpass123');
    await user.click(screen.getByRole('button', { name: '비밀번호 재설정' }));

    // verifyOtp('recovery') was called with the code, then updatePassword with the new pw
    await waitFor(() => expect(verifySpy).toHaveBeenCalledWith('reset@example.com', '123456', 'recovery'));
    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith('newpass123'));
  });

  it('supabase mode: a wrong reset code surfaces an error and never updates the password', async () => {
    const user = userEvent.setup();
    const { auth, updateSpy } = makeRecoveryAuth();
    const backend: Backend = { auth, docStore: stubDocStore, spaceStore: new LocalSpaceStore(), mode: 'supabase' };
    render(
      <MemoryRouter>
        <BackendProvider backend={backend}>
          <Login />
        </BackendProvider>
      </MemoryRouter>,
    );

    await user.click(screen.getByText('비밀번호 찾기'));
    await user.type(screen.getByPlaceholderText('you@example.com'), 'reset@example.com');
    await user.click(screen.getByRole('button', { name: '재설정 코드 보내기' }));
    await screen.findByPlaceholderText('인증 코드 입력');

    await user.type(screen.getByPlaceholderText('인증 코드 입력'), '000000'); // rejected by RecoveryAuth
    await user.type(screen.getByPlaceholderText('새 비밀번호 입력'), 'newpass123');
    await user.type(screen.getByPlaceholderText('새 비밀번호 재입력'), 'newpass123');
    await user.click(screen.getByRole('button', { name: '비밀번호 재설정' }));

    await waitFor(() => expect(screen.getByText(/인증 코드가 올바르지 않아요/)).toBeTruthy());
    expect(updateSpy).not.toHaveBeenCalled(); // password never changed on a bad code
  });

  it('localizes a wrong-password login error to Korean (no English leak)', async () => {
    const user = userEvent.setup();
    const auth = new LocalAuth();
    vi.spyOn(auth, 'signInWithPassword').mockResolvedValue({ session: null, error: 'Invalid login credentials' });
    renderSupa(auth);

    await user.type(screen.getByPlaceholderText('you@example.com'), 'a@b.com');
    await user.type(screen.getByPlaceholderText('비밀번호 입력'), 'wrongpass');
    await user.click(screen.getByRole('button', { name: '로그인' }));

    await waitFor(() => expect(screen.getByText('이메일 또는 비밀번호가 올바르지 않아요.')).toBeTruthy());
    expect(screen.queryByText(/Invalid login credentials/)).toBeNull();
  });

  it('localizes the Supabase password-policy error to a concise Korean message', async () => {
    const user = userEvent.setup();
    const auth = new LocalAuth();
    vi.spyOn(auth, 'signUp').mockResolvedValue({
      session: null,
      error:
        "Password should be at least 8 characters. Password should contain at least one character of each: abcdefghijklmnopqrstuvwxyz, ABCDEFGHIJKLMNOPQRSTUVWXYZ, 0123456789, !@#$%^&*()_+-=[]{};'\\:\"|<>?,./`~.",
    });
    renderSupa(auth);

    await user.click(screen.getByText('가입하기'));
    await user.type(screen.getByPlaceholderText('you@example.com'), 'new@example.com');
    await user.type(screen.getByPlaceholderText('비밀번호 입력'), 'abcd12'); // passes client 4-char gate
    await user.type(screen.getByPlaceholderText('비밀번호 재입력'), 'abcd12');
    await user.click(screen.getByRole('button', { name: '가입하기' }));

    await waitFor(() => expect(screen.getByText(/비밀번호는 8자 이상.*소문자·대문자·숫자·특수문자/)).toBeTruthy());
    expect(screen.queryByText(/Password should/)).toBeNull();
  });

  it('signup shows NO full-screen loader (no 로그인하고 있어요) while creating the account — just advances to verify', async () => {
    const user = userEvent.setup();
    let resolveSignup!: (v: AuthResult) => void;
    const gate = new Promise<AuthResult>((r) => {
      resolveSignup = r;
    });
    const auth = new LocalAuth();
    vi.spyOn(auth, 'signUp').mockImplementation(() => gate);
    renderSupa(auth);

    await user.click(screen.getByText('가입하기'));
    await user.type(screen.getByPlaceholderText('you@example.com'), 'nl@example.com');
    await user.type(screen.getByPlaceholderText('비밀번호 입력'), 'password123');
    await user.type(screen.getByPlaceholderText('비밀번호 재입력'), 'password123');
    await user.click(screen.getByRole('button', { name: '가입하기' }));

    // While signUp is in flight: no full-screen overlay (that message is only for
    // the finish→navigate transition), just the inline button spinner.
    expect(screen.queryByText('로그인하고 있어요')).toBeNull();
    expect(screen.queryByText('계정을 만들고 있어요')).toBeNull();

    await act(async () => {
      resolveSignup({ session: null, needsVerification: true });
      await gate;
    });
    expect(await screen.findByPlaceholderText('인증 코드 입력')).toBeTruthy();
  });

  it('hides "비밀번호 찾기" in signup mode (login-only)', async () => {
    const user = userEvent.setup();
    renderLogin();
    expect(screen.getByText('비밀번호 찾기')).toBeTruthy(); // login mode
    await user.click(screen.getByText('가입하기'));
    expect(screen.queryByText('비밀번호 찾기')).toBeNull(); // signup mode
  });

  it('supabase mode: a rate-limited reset stays on the email step with a Korean message (does not advance)', async () => {
    const user = userEvent.setup();
    const auth = new LocalAuth();
    vi.spyOn(auth, 'sendPasswordReset').mockResolvedValue({ error: 'For security purposes, you can only request this after 30 seconds.' });
    renderSupa(auth);

    await user.click(screen.getByText('비밀번호 찾기'));
    await user.type(screen.getByPlaceholderText('you@example.com'), 'reset@example.com');
    await user.click(screen.getByRole('button', { name: '재설정 코드 보내기' }));

    await waitFor(() => expect(screen.getByText(/약 30초 후에 다시 시도해 주세요/)).toBeTruthy());
    expect(screen.queryByPlaceholderText('인증 코드 입력')).toBeNull(); // did NOT advance to the code step
  });

  it('supabase mode: a successful reset advances to the code step with a Korean notice', async () => {
    const user = userEvent.setup();
    const auth = new LocalAuth();
    const resetSpy = vi.spyOn(auth, 'sendPasswordReset').mockResolvedValue({});
    renderSupa(auth);

    await user.click(screen.getByText('비밀번호 찾기'));
    await user.type(screen.getByPlaceholderText('you@example.com'), 'reset@example.com');
    await user.click(screen.getByRole('button', { name: '재설정 코드 보내기' }));

    expect(await screen.findByPlaceholderText('인증 코드 입력')).toBeTruthy();
    expect(screen.getByText(/이메일로 인증 코드를 보냈어요/)).toBeTruthy();
    expect(resetSpy).toHaveBeenCalledWith('reset@example.com');
  });

  it('shows a plain "Google 계정으로 로그인" button (no GIS personalization) on both login and signup', async () => {
    const user = userEvent.setup();
    renderLogin();
    // login mode
    expect(screen.getByRole('button', { name: /Google 계정으로 로그인/ })).toBeTruthy();
    // signup mode too
    await user.click(screen.getByText('가입하기'));
    expect(screen.getByRole('button', { name: /Google 계정으로 로그인/ })).toBeTruthy();
  });

  it('links the legal docs from the form footer, opening in a new tab', () => {
    renderLogin();
    const privacy = screen.getByRole('link', { name: '개인정보처리방침' });
    const terms = screen.getByRole('link', { name: '이용약관' });
    expect(privacy.getAttribute('href')).toBe('/privacy');
    expect(terms.getAttribute('href')).toBe('/terms');
    // same-tab navigation would discard whatever the user already typed
    expect(privacy.getAttribute('target')).toBe('_blank');
    expect(terms.getAttribute('target')).toBe('_blank');
  });

  it('renders the desktop brand panel by default (matchMedia unavailable in jsdom → desktop)', () => {
    renderLogin();
    expect(screen.getByText('© 2026 Geurio')).toBeTruthy();
  });

  describe('mobile (M6)', () => {
    it('hides the brand panel and still renders the form full-width, crash-free', () => {
      const restore = mockMatchMedia(true);
      try {
        renderLogin();
        expect(screen.queryByText('© 2026 Geurio')).toBeNull();
        expect(screen.getByText('Geurio에 오신 것을 환영해요')).toBeTruthy();
        expect(screen.getByRole('button', { name: '로그인' })).toBeTruthy();
      } finally {
        restore();
      }
    });
  });
});

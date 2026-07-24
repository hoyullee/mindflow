import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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

    expect(screen.getByText('계정 만들기')).toBeTruthy();
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
    expect(screen.getByPlaceholderText('6자리 숫자')).toBeTruthy();
  });

  it('supabase mode: the verify step hides the demo code and "다시 보내기" actually re-sends the OTP email', async () => {
    const user = userEvent.setup();
    const auth = new VerifyAuth();
    const resendSpy = vi.spyOn(auth, 'resendSignup');
    const backend: Backend = { auth, docStore: stubDocStore, spaceStore: new LocalSpaceStore(), mode: 'supabase' };
    render(
      <MemoryRouter>
        <BackendProvider backend={backend}>
          <Login />
        </BackendProvider>
      </MemoryRouter>,
    );

    await user.click(screen.getByText('가입하기'));
    await user.type(screen.getByPlaceholderText('you@example.com'), 'real@example.com');
    await user.type(screen.getByPlaceholderText('비밀번호 입력'), 'password123');
    await user.type(screen.getByPlaceholderText('비밀번호 재입력'), 'password123');
    await user.click(screen.getByRole('button', { name: '가입하기' }));

    // reached the verify step, but with NO demo-code hint (real email has the 6-digit code)
    expect(await screen.findByPlaceholderText('6자리 숫자')).toBeTruthy();
    expect(screen.queryByText(/데모 코드:/)).toBeNull();

    // "다시 보내기" hits the real resend API (with the signup email) and confirms with a notice
    await user.click(screen.getByText('다시 보내기'));
    await waitFor(() => expect(resendSpy).toHaveBeenCalledWith('real@example.com'));
    expect(screen.getByText(/다시 보냈어요/)).toBeTruthy();
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
    expect(await screen.findByPlaceholderText('6자리 숫자')).toBeTruthy();
    expect(screen.queryByText(/데모 코드:/)).toBeNull();

    // enter the emailed 6-digit code + a new password → real recovery
    await user.type(screen.getByPlaceholderText('6자리 숫자'), '123456');
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
    await screen.findByPlaceholderText('6자리 숫자');

    await user.type(screen.getByPlaceholderText('6자리 숫자'), '000000'); // rejected by RecoveryAuth
    await user.type(screen.getByPlaceholderText('새 비밀번호 입력'), 'newpass123');
    await user.type(screen.getByPlaceholderText('새 비밀번호 재입력'), 'newpass123');
    await user.click(screen.getByRole('button', { name: '비밀번호 재설정' }));

    await waitFor(() => expect(screen.getByText(/인증 코드가 올바르지 않아요/)).toBeTruthy());
    expect(updateSpy).not.toHaveBeenCalled(); // password never changed on a bad code
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

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Login } from './Login';
import { mockMatchMedia } from '../../test/matchMedia';
import { BackendProvider } from '../../adapters/BackendContext';
import { LocalAuth } from '../../adapters/local/localAuth';
import { LocalSpaceStore } from '../../adapters/local/localSpaceStore';
import { LocalShareStore } from '../../adapters/local/localShareStore';
import { LocalFeedbackStore } from '../../adapters/local/localFeedbackStore';
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
  const backend: Backend = { auth, docStore: stubDocStore, spaceStore: new LocalSpaceStore(), shareStore: new LocalShareStore(), feedbackStore: new LocalFeedbackStore(), mode: 'supabase' };
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
    const backend: Backend = { auth, docStore: stubDocStore, spaceStore: new LocalSpaceStore(), shareStore: new LocalShareStore(), feedbackStore: new LocalFeedbackStore(), mode: 'supabase' };
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
    const backend: Backend = { auth, docStore: stubDocStore, spaceStore: new LocalSpaceStore(), shareStore: new LocalShareStore(), feedbackStore: new LocalFeedbackStore(), mode: 'supabase' };
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
    const backend: Backend = { auth, docStore: stubDocStore, spaceStore: new LocalSpaceStore(), shareStore: new LocalShareStore(), feedbackStore: new LocalFeedbackStore(), mode: 'supabase' };
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

  it('reset flow: 뒤로 → 재설정 코드 보내기 재실행 시 재전송 카운트다운이 60으로 초기화되지 않고 이어진다(재전송 없음)', async () => {
    // 제보 재현: 비밀번호 찾기에서 코드 전송(쿨다운 시작) → "← 뒤로" → 다시
    // "재설정 코드 보내기"를 누르면 남은 시간이 60초로 리셋되던 버그.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const { auth, resetSpy } = makeRecoveryAuth();
      const backend: Backend = { auth, docStore: stubDocStore, spaceStore: new LocalSpaceStore(), shareStore: new LocalShareStore(), feedbackStore: new LocalFeedbackStore(), mode: 'supabase' };
      render(
        <MemoryRouter>
          <BackendProvider backend={backend}>
            <Login />
          </BackendProvider>
        </MemoryRouter>,
      );

      const readCountdown = () => {
        const m = screen.getByText(/초 후 다시 보내기/).textContent?.match(/(\d+)초/);
        return m && m[1] ? parseInt(m[1], 10) : NaN;
      };

      // 1) 코드 전송 → 쿨다운(60) 시작, forgotVerify 진입
      await user.click(screen.getByText('비밀번호 찾기'));
      await user.type(screen.getByPlaceholderText('you@example.com'), 'reset@example.com');
      await user.click(screen.getByRole('button', { name: '재설정 코드 보내기' }));
      await waitFor(() => expect(resetSpy).toHaveBeenCalledTimes(1));
      expect(await screen.findByText(/초 후 다시 보내기/)).toBeTruthy();

      // 2) ~10초 경과 → 60 미만으로 내려감
      await act(async () => {
        vi.advanceTimersByTime(10_000);
      });
      await waitFor(() => expect(readCountdown()).toBeLessThan(60));

      // 3) "← 뒤로"로 이메일 단계 복귀
      await user.click(screen.getByText('← 뒤로'));
      expect(await screen.findByRole('button', { name: '재설정 코드 보내기' })).toBeTruthy();

      // 4) 재실행 — 서버 재전송 없이 남은 카운트다운 유지(60으로 초기화 X)
      await user.click(screen.getByRole('button', { name: '재설정 코드 보내기' }));
      expect(await screen.findByPlaceholderText('인증 코드 입력')).toBeTruthy();
      expect(resetSpy).toHaveBeenCalledTimes(1); // 두 번째 전송 없음
      expect(screen.queryByText(/60초 후 다시 보내기/)).toBeNull(); // 초기화되지 않음
      expect(readCountdown()).toBeLessThan(60); // 계속 진행 중
    } finally {
      vi.useRealTimers();
    }
  });

  it('reset flow: 미가입 이메일이면 코드를 보내지 않고 "가입되지 않은 이메일" 안내를 띄운다(이메일 수정 시 해제)', async () => {
    const user = userEvent.setup();
    const auth = new LocalAuth();
    vi.spyOn(auth, 'isEmailRegistered').mockResolvedValue(false); // 미가입
    const resetSpy = vi.spyOn(auth, 'sendPasswordReset');
    const backend: Backend = { auth, docStore: stubDocStore, spaceStore: new LocalSpaceStore(), shareStore: new LocalShareStore(), feedbackStore: new LocalFeedbackStore(), mode: 'supabase' };
    render(
      <MemoryRouter>
        <BackendProvider backend={backend}>
          <Login />
        </BackendProvider>
      </MemoryRouter>,
    );

    await user.click(screen.getByText('비밀번호 찾기'));
    await user.type(screen.getByPlaceholderText('you@example.com'), 'ghost@example.com');
    await user.click(screen.getByRole('button', { name: '재설정 코드 보내기' }));

    // 안내 노출 + 실제 전송 없음 + 코드 단계로 넘어가지 않음
    await waitFor(() => expect(screen.getByText(/가입되지 않은 이메일/)).toBeTruthy());
    expect(resetSpy).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText('인증 코드 입력')).toBeNull();

    // 이메일을 수정하면 안내가 사라진다
    await user.type(screen.getByPlaceholderText('you@example.com'), 'x');
    await waitFor(() => expect(screen.queryByText(/가입되지 않은 이메일/)).toBeNull());
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

  it('로그인: 이메일 미인증 계정(가입 미완료)은 막다른 안내 대신 인증 단계로 보내 가입을 마치게 한다', async () => {
    // 제보: 회원가입 인증 단계를 취소한 계정으로 로그인하면 "이메일 인증이 아직…"만
    // 떠 진행이 막혔다. 미인증 = 아직 회원 아님 → 인증 코드 재발송 후 verify 단계로.
    const user = userEvent.setup();
    const auth = new LocalAuth();
    vi.spyOn(auth, 'signInWithPassword').mockResolvedValue({ session: null, error: 'Email not confirmed' });
    const resendSpy = vi.spyOn(auth, 'resendSignup').mockResolvedValue({});
    renderSupa(auth);

    await user.type(screen.getByPlaceholderText('you@example.com'), 'pending@example.com');
    await user.type(screen.getByPlaceholderText('비밀번호 입력'), 'password123');
    await user.click(screen.getByRole('button', { name: '로그인' }));

    // verify 단계로 이동 + 인증 코드 재발송 + 안내 노출, 막다른 문구는 안 뜬다
    expect(await screen.findByPlaceholderText('인증 코드 입력')).toBeTruthy();
    await waitFor(() => expect(resendSpy).toHaveBeenCalledWith('pending@example.com'));
    expect(screen.getByText(/아직 가입이 완료되지 않았어요/)).toBeTruthy();
    expect(screen.queryByText(/이메일 인증이 아직 완료되지 않았어요/)).toBeNull();
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

// 제보: Google로 가입된 계정의 이메일로 이메일 회원가입을 시도하면 가입이
// 진행되어 인증번호 발송 화면까지 넘어가는데, 인증번호는 오지 않는다.
// (Supabase `signUp`이 이메일 열거 방지로 이미 가입된 주소에도 성공을 돌려주고
//  메일은 보내지 않기 때문.) 가입 전에 로그인 수단을 확인해 막는다.
describe('이미 가입된 이메일로 회원가입 시도 — 차단 + 안내', () => {
  async function gotoSignup(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByText('가입하기'));
  }

  it('Google로 가입된 이메일이면 SNS 계정이라고 알려주고 가입을 막는다', async () => {
    const user = userEvent.setup();
    const auth = new LocalAuth();
    vi.spyOn(auth, 'emailSignInProviders').mockResolvedValue(['google']);
    const signUpSpy = vi.spyOn(auth, 'signUp');
    renderSupa(auth);

    await gotoSignup(user);
    await user.type(screen.getByPlaceholderText('you@example.com'), 'g@example.com');
    await user.type(screen.getByPlaceholderText('비밀번호 입력'), 'pw1234');
    await user.type(screen.getByPlaceholderText('비밀번호 재입력'), 'pw1234');
    await user.click(screen.getByRole('button', { name: /가입하기/ }));

    await waitFor(() => expect(screen.getByText(/Google 계정으로 가입한 이메일/)).toBeTruthy());
    expect(signUpSpy).not.toHaveBeenCalled(); // 실제 가입 시도 없음
    expect(screen.queryByPlaceholderText('인증 코드 입력')).toBeNull(); // 인증 화면으로 넘어가지 않음
  });

  it('이미 이메일로 가입된 주소면 로그인으로 유도한다', async () => {
    const user = userEvent.setup();
    const auth = new LocalAuth();
    vi.spyOn(auth, 'emailSignInProviders').mockResolvedValue(['email']);
    const signUpSpy = vi.spyOn(auth, 'signUp');
    renderSupa(auth);

    await gotoSignup(user);
    await user.type(screen.getByPlaceholderText('you@example.com'), 'dup@example.com');
    await user.type(screen.getByPlaceholderText('비밀번호 입력'), 'pw1234');
    await user.type(screen.getByPlaceholderText('비밀번호 재입력'), 'pw1234');
    await user.click(screen.getByRole('button', { name: /가입하기/ }));

    await waitFor(() => expect(screen.getByText(/이미 가입된 이메일/)).toBeTruthy());
    expect(signUpSpy).not.toHaveBeenCalled();
    expect(screen.getByText(/로그인하러 가기/)).toBeTruthy();
  });

  it('이메일을 고치면 안내가 사라진다', async () => {
    const user = userEvent.setup();
    const auth = new LocalAuth();
    vi.spyOn(auth, 'emailSignInProviders').mockResolvedValue(['google']);
    renderSupa(auth);

    await gotoSignup(user);
    await user.type(screen.getByPlaceholderText('you@example.com'), 'g@example.com');
    await user.type(screen.getByPlaceholderText('비밀번호 입력'), 'pw1234');
    await user.type(screen.getByPlaceholderText('비밀번호 재입력'), 'pw1234');
    await user.click(screen.getByRole('button', { name: /가입하기/ }));
    await waitFor(() => expect(screen.getByText(/Google 계정으로 가입한 이메일/)).toBeTruthy());

    await user.type(screen.getByPlaceholderText('you@example.com'), 'x');
    expect(screen.queryByText(/Google 계정으로 가입한 이메일/)).toBeNull();
  });

  it('미가입 이메일은 평소대로 가입이 진행된다 (무회귀)', async () => {
    const user = userEvent.setup();
    const auth = new VerifyAuth();
    vi.spyOn(auth, 'emailSignInProviders').mockResolvedValue([]); // 미가입
    renderSupa(auth);

    await gotoSignup(user);
    await user.type(screen.getByPlaceholderText('you@example.com'), 'new@example.com');
    await user.type(screen.getByPlaceholderText('비밀번호 입력'), 'pw1234');
    await user.type(screen.getByPlaceholderText('비밀번호 재입력'), 'pw1234');
    await user.click(screen.getByRole('button', { name: /가입하기/ }));

    expect(await screen.findByPlaceholderText('인증 코드 입력')).toBeTruthy();
  });

  it('공급자 확인이 불가해도(RPC 미배포) 어댑터의 "이미 가입됨" 오류를 안내로 바꿔 막는다', async () => {
    const user = userEvent.setup();
    const auth = new LocalAuth();
    vi.spyOn(auth, 'emailSignInProviders').mockResolvedValue(null); // 확인 불가
    vi.spyOn(auth, 'signUp').mockResolvedValue({ session: null, error: 'User already registered' });
    renderSupa(auth);

    await gotoSignup(user);
    await user.type(screen.getByPlaceholderText('you@example.com'), 'dup@example.com');
    await user.type(screen.getByPlaceholderText('비밀번호 입력'), 'pw1234');
    await user.type(screen.getByPlaceholderText('비밀번호 재입력'), 'pw1234');
    await user.click(screen.getByRole('button', { name: /가입하기/ }));

    await waitFor(() => expect(screen.getByText(/이미 가입된 이메일/)).toBeTruthy());
    expect(screen.queryByPlaceholderText('인증 코드 입력')).toBeNull();
  });
});

// 제보: 가입 차단 안내가 뜬 화면에서 'Google 계정으로 로그인'을 누르면 문구만
// 공백이 되고 빈 콜아웃(아이콘만)이 남는다. 콜아웃 본문이 `error`인데 그 흐름이
// 에러만 비우고 `signupBlocked` 플래그는 남겼기 때문.
describe('가입 차단 안내는 문구 없이 남지 않는다', () => {
  async function blockSignup(user: ReturnType<typeof userEvent.setup>, auth: LocalAuth) {
    vi.spyOn(auth, 'emailSignInProviders').mockResolvedValue(['google']);
    renderSupa(auth);
    await user.click(screen.getByText('가입하기'));
    await user.type(screen.getByPlaceholderText('you@example.com'), 'g@example.com');
    await user.type(screen.getByPlaceholderText('비밀번호 입력'), 'pw1234');
    await user.type(screen.getByPlaceholderText('비밀번호 재입력'), 'pw1234');
    await user.click(screen.getByRole('button', { name: /가입하기/ }));
    await waitFor(() => expect(screen.getByText(/Google 계정으로 가입한 이메일/)).toBeTruthy());
  }

  /** 화면에 떠 있는 안내 콜아웃(있으면) — 빈 상자가 남았는지 확인용. */
  const calloutOf = () => document.querySelector('[role="alert"]');

  it("'Google 계정으로 로그인'을 누르면 콜아웃이 통째로 사라진다 (빈 상자 없음)", async () => {
    const user = userEvent.setup();
    const auth = new LocalAuth();
    vi.spyOn(auth, 'signInWithOAuth').mockResolvedValue({});
    await blockSignup(user, auth);
    expect(calloutOf()).toBeTruthy();

    await user.click(screen.getByText(/Google 계정으로 로그인/));

    await waitFor(() => expect(calloutOf()).toBeNull());
  });

  it('로그인 탭으로 전환해도 빈 콜아웃이 남지 않는다', async () => {
    const user = userEvent.setup();
    const auth = new LocalAuth();
    await blockSignup(user, auth);

    await user.click(screen.getByText('로그인')); // 하단 전환 링크
    expect(calloutOf()).toBeNull();
  });

  it('비밀번호를 고쳐도 빈 콜아웃이 남지 않는다', async () => {
    const user = userEvent.setup();
    const auth = new LocalAuth();
    await blockSignup(user, auth);

    await user.type(screen.getByPlaceholderText('비밀번호 입력'), 'x');
    expect(calloutOf()).toBeNull();
  });
});

import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBackend } from '../../adapters/BackendContext';
import { initialLoginState, type LoginState } from './types';

/** Login.dc.html `genCode()` — demo 6-digit verification code. Still used verbatim
 * when running against the Local backend (no env configured); also used as the
 * placeholder step UI while a real Supabase signup's email-confirmation link is
 * pending (the code itself isn't checked in that path — `verifyCode()`/`resetPw()`
 * below call `auth.verifyOtp` instead once Supabase is configured). */
function genCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/** Login.dc.html `validEmail(e)`. */
function validEmail(email: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

/**
 * Ports the imperative `class Component extends DCLogic` controller from
 * Login.dc.html into a React hook. Every method below corresponds 1:1 to a
 * method on the original controller; `patch()` stands in for `this.setState`.
 *
 * M4: wired to `AuthProvider` (`adapters/ports.ts`) via `useBackend()`. In
 * Local mode (no `VITE_SUPABASE_*` env — the default) `LocalAuth` resolves
 * every call instantly with no validation of its own, so behavior is
 * byte-for-byte the same demo flow this hook always had (this is also why
 * the existing `Login.test.tsx` needs no changes). In Supabase mode, the
 * same UI steps drive real `signInWithPassword`/`signUp`/`signInWithOAuth`/
 * `verifyOtp` calls.
 */
export function useLoginController() {
  const [state, setState] = useState<LoginState>(initialLoginState);
  const navigate = useNavigate();
  const { auth, mode } = useBackend();
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    // Back/forward bfcache restore: the browser can restore /login with the
    // full-screen "로그인하고 있어요" loader (`busy`) frozen. On a persisted
    // `pageshow`, cancel the pending navigate and clear the loader so the
    // restored page shows instead of the stuck animation.
    const onPageShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      clearTimeout(timerRef.current);
      setState((prev) => (prev.busy ? { ...prev, busy: false } : prev));
    };
    window.addEventListener('pageshow', onPageShow);
    return () => {
      window.removeEventListener('pageshow', onPageShow);
      clearTimeout(timerRef.current);
    };
  }, []);

  const patch = (partial: Partial<LoginState>) => {
    setState((prev) => ({ ...prev, ...partial }));
  };

  /** Shows the full-screen loader (Login.dc.html `finish()`'s UI half) then
   * navigates — called once the actual auth call (if any) already succeeded. */
  const finishWithLoader = (signup: boolean) => {
    patch({ busy: true, error: '', loaderMsg: signup ? '계정을 만들고 있어요' : '로그인하고 있어요' });
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      // `replace` so a post-login Back can't return to the login screen and
      // replay its loader/animation.
      navigate('/home', { replace: true });
    }, 1100);
  };

  const onEmail = (v: string) => patch({ email: v, error: '' });
  const onPassword = (v: string) => patch({ password: v, error: '' });
  const onPassword2 = (v: string) => patch({ password2: v, error: '' });
  const onNewPw = (v: string) => patch({ newPw: v, error: '' });
  const onNewPw2 = (v: string) => patch({ newPw2: v, error: '' });
  const onCode = (v: string) => patch({ code: (v ?? '').replace(/\D/g, '').slice(0, 6), error: '' });

  const emailLogin = () => {
    if (state.busy) return;
    if (!validEmail(state.email)) {
      patch({ error: '올바른 이메일 주소를 입력해 주세요.' });
      return;
    }
    if ((state.password || '').length < 4) {
      patch({ error: '비밀번호는 4자 이상 입력해 주세요.' });
      return;
    }
    if (state.mode === 'signup') {
      if (state.password !== state.password2) {
        patch({ error: '비밀번호가 일치하지 않습니다.' });
        return;
      }
      if (mode === 'local') {
        patch({ step: 'verify', error: '', code: '', demoCode: genCode() });
        return;
      }
      // Supabase: create the account for real. Default project config
      // requires email confirmation, so `data.session` comes back null —
      // land on the same "verify" step UI, but `verifyCode()` below now
      // calls `auth.verifyOtp` instead of comparing against a client-side code.
      patch({ busy: true, error: '' });
      void auth.signUp(state.email, state.password).then((res) => {
        if (res.error) {
          patch({ busy: false, error: res.error });
          return;
        }
        if (res.needsVerification) {
          patch({ busy: false, step: 'verify', error: '', code: '', demoCode: '' });
          return;
        }
        finishWithLoader(true);
      });
      return;
    }
    if (mode === 'local') {
      finishWithLoader(false);
      return;
    }
    patch({ busy: true, error: '' });
    void auth.signInWithPassword(state.email, state.password).then((res) => {
      if (res.error) {
        patch({ busy: false, error: res.error });
        return;
      }
      finishWithLoader(false);
    });
  };

  const verifyCode = () => {
    if (state.busy) return;
    if (state.code.length !== 6) {
      patch({ error: '6자리 인증 코드를 입력해 주세요.' });
      return;
    }
    if (mode === 'local') {
      if (state.code !== state.demoCode) {
        patch({ error: '인증 코드가 일치하지 않습니다.' });
        return;
      }
      finishWithLoader(true);
      return;
    }
    patch({ busy: true, error: '' });
    void auth.verifyOtp(state.email, state.code, 'signup').then((res) => {
      if (res.error) {
        patch({ busy: false, error: res.error });
        return;
      }
      finishWithLoader(true);
    });
  };

  const resendCode = () => patch({ demoCode: genCode(), code: '', error: '' });
  const backToForm = () => patch({ step: 'form', error: '', code: '', busy: false });
  const startForgot = () => patch({ step: 'forgot', error: '', code: '', notice: '', busy: false });

  const sendReset = () => {
    if (!validEmail(state.email)) {
      patch({ error: '올바른 이메일 주소를 입력해 주세요.' });
      return;
    }
    if (mode === 'supabase') {
      // Fire the real reset email in the background; the step transition below
      // still shows the same demo-code UI regardless of the network result so
      // this never blocks the flow (matches the rest of this file's non-fatal
      // storage/timer try/catch conventions).
      void auth.sendPasswordReset(state.email);
    }
    patch({ step: 'forgotVerify', demoCode: genCode(), code: '', newPw: '', newPw2: '', error: '' });
  };

  /** Password reset stays a client-side simulation even in Supabase mode: a
   * real recovery flow needs the OTP `verifyOtp('recovery')` call to first
   * establish a recovery session before `auth.updatePassword` is callable,
   * which in turn needs the token Supabase actually emailed (not the demo
   * code generated here) — out of scope for this env-gated port (no live
   * Supabase project to verify the real flow against; see `docs/backend.md`). */
  const resetPw = () => {
    if (state.code.length !== 6) {
      patch({ error: '6자리 인증 코드를 입력해 주세요.' });
      return;
    }
    if (state.code !== state.demoCode) {
      patch({ error: '인증 코드가 일치하지 않습니다.' });
      return;
    }
    if ((state.newPw || '').length < 4) {
      patch({ error: '비밀번호는 4자 이상 입력해 주세요.' });
      return;
    }
    if (state.newPw !== state.newPw2) {
      patch({ error: '비밀번호가 일치하지 않습니다.' });
      return;
    }
    patch({
      step: 'form',
      mode: 'login',
      password: '',
      code: '',
      error: '',
      notice: '비밀번호가 재설정되었어요. 새 비밀번호로 로그인해 주세요.',
    });
  };

  const googleLogin = () => {
    if (state.busy) return;
    if (mode === 'local') {
      finishWithLoader(state.mode === 'signup');
      return;
    }
    patch({ busy: true, error: '' });
    void auth.signInWithOAuth('google').then((res) => {
      // On success the browser navigates away to Google's consent screen —
      // this only resolves (with an error) when that redirect couldn't start.
      if (res.error) patch({ busy: false, error: res.error });
    });
  };

  const toggleMode = () => {
    patch({
      mode: state.mode === 'login' ? 'signup' : 'login',
      step: 'form',
      error: '',
      password2: '',
      code: '',
      busy: false,
    });
  };

  const onPwKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') emailLogin();
  };
  const onCodeKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') verifyCode();
  };
  const onForgotKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') sendReset();
  };
  const onResetKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') resetPw();
  };

  return {
    state,
    onEmail,
    onPassword,
    onPassword2,
    onNewPw,
    onNewPw2,
    onCode,
    onPwKey,
    onCodeKey,
    onForgotKey,
    onResetKey,
    toggleMode,
    emailLogin,
    verifyCode,
    resendCode,
    backToForm,
    startForgot,
    sendReset,
    resetPw,
    googleLogin,
  };
}

export type LoginController = ReturnType<typeof useLoginController>;

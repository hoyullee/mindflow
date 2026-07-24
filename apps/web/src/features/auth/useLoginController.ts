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

// Supabase 이메일 OTP는 프로젝트 설정에 따라 6~10자리다(기본 6, 대시보드에서
// 변경 가능). 입력을 특정 길이로 고정하면 8자리 코드를 다 못 넣어 인증이 막힌다
// (제보 케이스). 6~10자리 숫자를 받고 최종 검증은 서버(`verifyOtp`)에 맡긴다.
// 로컬/데모 모드는 genCode()가 6자리를 만들고 정확히 대조한다.
const OTP_MIN = 6;
const OTP_MAX = 10;

/**
 * Supabase Auth의 영문 에러 메시지를 사용자용 한글로 매핑한다. Supabase는 항상
 * 영문 메시지를 주는데(예: "Invalid login credentials", 비밀번호 정책 나열, 레이트
 * 리밋 안내), 그대로 노출하면 영문·과도한 길이가 그대로 보인다. 인식 못 한 영문은
 * 원문 노출 대신 일반 안내로 폴백한다. 이미 한글인 메시지(클라이언트 자체 메시지)는
 * 그대로 통과시킨다.
 */
function localizeAuthError(raw: string | undefined | null): string {
  const msg = (raw || '').trim();
  if (!msg) return '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.';
  if (/[가-힣]/.test(msg)) return msg; // 이미 한글 → 그대로
  const low = msg.toLowerCase();

  // 로그인/가입
  if (low.includes('invalid login credentials')) return '이메일 또는 비밀번호가 올바르지 않아요.';
  if (low.includes('email not confirmed')) return '이메일 인증이 아직 완료되지 않았어요. 메일함에서 인증을 완료해 주세요.';
  if (low.includes('already registered') || low.includes('already been registered') || low.includes('user already exists')) return '이미 가입된 이메일이에요. 로그인해 주세요.';

  // 레이트 리밋: "For security purposes, you can only request this after N seconds."
  const after = msg.match(/after (\d+)\s*seconds?/i);
  if (after) return `요청이 너무 잦아요. 약 ${after[1]}초 후에 다시 시도해 주세요.`;
  if (low.includes('rate limit') || low.includes('too many requests') || low.includes('for security purposes')) return '요청이 너무 잦아요. 잠시 후 다시 시도해 주세요.';

  // 비밀번호 정책: "Password should be at least N characters. Password should contain at least one character of each: <목록>"
  if (low.includes('password should') || (low.includes('password') && low.includes('at least'))) {
    const minLen = msg.match(/at least (\d+) characters?/i);
    const cls: string[] = [];
    if (msg.includes('abcdefghijklmnopqrstuvwxyz')) cls.push('소문자');
    if (msg.includes('ABCDEFGHIJKLMNOPQRSTUVWXYZ')) cls.push('대문자');
    if (msg.includes('0123456789')) cls.push('숫자');
    if (msg.includes('!@#$')) cls.push('특수문자');
    const parts: string[] = [];
    if (minLen) parts.push(`${minLen[1]}자 이상`);
    if (cls.length) parts.push(`${cls.join('·')}를 각각 하나 이상 포함`);
    return parts.length ? `비밀번호는 ${parts.join(', ')}이어야 해요.` : '비밀번호가 보안 조건을 충족하지 않아요.';
  }

  // OTP/토큰 검증 실패·만료
  if (low.includes('otp') || low.includes('expired') || (low.includes('invalid') && (low.includes('code') || low.includes('token')))) {
    return '인증 코드가 올바르지 않거나 만료되었어요. 다시 시도해 주세요.';
  }
  if (low.includes('unable to validate email') || low.includes('invalid email')) return '올바른 이메일 주소를 입력해 주세요.';

  // 그 외: 영문 노출 방지용 일반 안내
  return '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.';
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
  const onCode = (v: string) => patch({ code: (v ?? '').replace(/\D/g, '').slice(0, OTP_MAX), error: '' });

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
          patch({ busy: false, error: localizeAuthError(res.error) });
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
        patch({ busy: false, error: localizeAuthError(res.error) });
        return;
      }
      finishWithLoader(false);
    });
  };

  const verifyCode = () => {
    if (state.busy) return;
    if (state.code.length < OTP_MIN) {
      patch({ error: '인증 코드를 정확히 입력해 주세요.' });
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
        patch({ busy: false, error: localizeAuthError(res.error) });
        return;
      }
      finishWithLoader(true);
    });
  };

  const resendCode = () => {
    // Both verify steps re-send for real in Supabase mode so "다시 보내기" isn't a
    // dead button: signup → `auth.resend({type:'signup'})`, recovery →
    // `sendPasswordReset` (re-issues the reset OTP). Local/demo mode has no server,
    // so it just regenerates the on-screen demo code, as before.
    if (mode === 'supabase' && (state.step === 'verify' || state.step === 'forgotVerify')) {
      if (state.busy) return;
      patch({ busy: true, error: '', notice: '' });
      const send = state.step === 'forgotVerify' ? auth.sendPasswordReset(state.email) : auth.resendSignup(state.email);
      void send.then((res) => {
        patch({ busy: false, code: '', error: res.error ? localizeAuthError(res.error) : '', notice: res.error ? '' : '인증 코드를 다시 보냈어요. 메일함을 확인해 주세요.' });
      });
      return;
    }
    patch({ demoCode: genCode(), code: '', error: '', notice: '' });
  };
  const backToForm = () => patch({ step: 'form', error: '', code: '', busy: false });
  const startForgot = () => patch({ step: 'forgot', error: '', code: '', notice: '', busy: false });

  const sendReset = () => {
    if (state.busy) return;
    if (!validEmail(state.email)) {
      patch({ error: '올바른 이메일 주소를 입력해 주세요.' });
      return;
    }
    if (mode === 'local') {
      // No server — jump to the sim step with an on-screen demo code.
      patch({ step: 'forgotVerify', demoCode: genCode(), code: '', newPw: '', newPw2: '', error: '', notice: '' });
      return;
    }
    // Supabase: actually send the reset email and ONLY advance on success. On a
    // failure (rate limit / SMTP) surface a localized error and stay on this step
    // instead of dropping the user onto a code screen where nothing will arrive.
    patch({ busy: true, error: '', notice: '' });
    void auth.sendPasswordReset(state.email).then((res) => {
      if (res.error) {
        patch({ busy: false, error: localizeAuthError(res.error) });
        return;
      }
      // demoCode '' so ForgotVerifyStep hides the demo box (real email has the code).
      patch({ busy: false, step: 'forgotVerify', demoCode: '', code: '', newPw: '', newPw2: '', error: '', notice: '이메일로 인증 코드를 보냈어요. 메일함을 확인해 주세요.' });
    });
  };

  const resetPw = () => {
    if (state.busy) return;
    if (state.code.length < OTP_MIN) {
      patch({ error: '인증 코드를 정확히 입력해 주세요.' });
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
    if (mode === 'supabase') {
      // Real recovery: the emailed 6-digit token establishes a recovery session
      // (`verifyOtp('recovery')`), which is what makes `updatePassword` callable.
      // On success the user is already signed in via that session, so land them
      // straight in the app (no second login) — mirrors a normal sign-in.
      patch({ busy: true, error: '', notice: '' });
      void auth.verifyOtp(state.email, state.code, 'recovery').then((res) => {
        if (res.error || !res.session) {
          patch({ busy: false, error: res.error ? localizeAuthError(res.error) : '인증 코드가 올바르지 않거나 만료되었어요. 다시 시도해 주세요.' });
          return;
        }
        void auth.updatePassword(state.newPw).then((up) => {
          if (up.error) {
            patch({ busy: false, error: localizeAuthError(up.error) });
            return;
          }
          finishWithLoader(false);
        });
      });
      return;
    }
    // local/demo simulation: compare against the on-screen demo code.
    if (state.code !== state.demoCode) {
      patch({ error: '인증 코드가 일치하지 않습니다.' });
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

  /** GIS path (Supabase mode only): the Google popup already produced an ID
   * token on our origin — exchange it for a session. Unlike `googleLogin`
   * there's no redirect: success/failure both land right here. */
  const googleTokenLogin = (token: string, nonce?: string) => {
    if (state.busy) return;
    patch({ busy: true, error: '', loaderMsg: '로그인하고 있어요' });
    void auth.signInWithIdToken('google', token, nonce).then((res) => {
      if (res.error) {
        patch({ busy: false, error: res.error });
        return;
      }
      finishWithLoader(false);
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
    googleTokenLogin,
  };
}

export type LoginController = ReturnType<typeof useLoginController>;

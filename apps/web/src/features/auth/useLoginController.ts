import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { initialLoginState, type LoginState } from './types';

/** Login.dc.html `genCode()` — demo 6-digit verification code. */
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
 */
export function useLoginController() {
  const [state, setState] = useState<LoginState>(initialLoginState);
  const navigate = useNavigate();
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  const patch = (partial: Partial<LoginState>) => {
    setState((prev) => ({ ...prev, ...partial }));
  };

  /** Login.dc.html `finish()` — original navigates via window.location.href. */
  const finish = () => {
    const signup = state.mode === 'signup';
    patch({
      busy: true,
      error: '',
      loaderMsg: signup ? '계정을 만들고 있어요' : '로그인하고 있어요',
    });
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      navigate('/home');
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
      patch({ step: 'verify', error: '', code: '', demoCode: genCode() });
      return;
    }
    finish();
  };

  const verifyCode = () => {
    if (state.busy) return;
    if (state.code.length !== 6) {
      patch({ error: '6자리 인증 코드를 입력해 주세요.' });
      return;
    }
    if (state.code !== state.demoCode) {
      patch({ error: '인증 코드가 일치하지 않습니다.' });
      return;
    }
    finish();
  };

  const resendCode = () => patch({ demoCode: genCode(), code: '', error: '' });
  const backToForm = () => patch({ step: 'form', error: '', code: '', busy: false });
  const startForgot = () => patch({ step: 'forgot', error: '', code: '', notice: '', busy: false });

  const sendReset = () => {
    if (!validEmail(state.email)) {
      patch({ error: '올바른 이메일 주소를 입력해 주세요.' });
      return;
    }
    patch({ step: 'forgotVerify', demoCode: genCode(), code: '', newPw: '', newPw2: '', error: '' });
  };

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
    if (!state.busy) finish();
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

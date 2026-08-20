import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { safeNextPath, takeLoginNotice } from './sessionNotice';
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
// 인증 코드 재전송 쿨다운(초). Supabase 기본 이메일 OTP 레이트리밋이 ~60초라
// 그에 맞춘다 — 이보다 빨리 재전송하면 어차피 서버가 거부한다.
const RESEND_COOLDOWN = 60;

/** Supabase 레이트리밋 메시지("...after N seconds")에서 남은 초를 뽑는다. */
function parseRetrySeconds(msg: string | undefined | null): number | null {
  const m = (msg || '').match(/after (\d+)\s*seconds?/i);
  return m && m[1] ? parseInt(m[1], 10) : null;
}

/**
 * Supabase가 미인증(이메일 확인 전) 계정 로그인 시 주는 "Email not confirmed".
 * 이 앱에선 이메일 인증까지 마쳐야 "회원"이므로, 이 상태는 로그인 실패가 아니라
 * "가입 미완료"로 취급해 인증 단계로 되돌린다(아래 emailLogin 참고).
 */
function isEmailNotConfirmed(msg: string | undefined | null): boolean {
  return /email not confirmed/i.test(msg || '');
}

/** Supabase가 "이미 가입된 이메일"에 주는 메시지(어댑터가 `identities: []`를
 * 감지해 만든 것 포함) — 가입 차단 안내로 갈아 끼우기 위한 판정. */
function isAlreadyRegistered(msg: string | undefined | null): boolean {
  const low = (msg || '').toLowerCase();
  return low.includes('already registered') || low.includes('already been registered') || low.includes('user already exists');
}

/** 로그인 수단 이름 — 안내 문구용. 현재 소셜 로그인은 Google 하나뿐이지만
 * 나중에 늘어도 문구가 깨지지 않게 표를 둔다. */
function providerLabel(provider: string): string {
  const table: Record<string, string> = { google: 'Google', apple: 'Apple', kakao: '카카오', github: 'GitHub' };
  return table[provider] ?? provider;
}

/**
 * Supabase Auth의 영문 에러 메시지를 사용자용 한글로 매핑한다. Supabase는 항상
 * 영문 메시지를 주는데(예: "Invalid login credentials", 비밀번호 정책 나열, 레이트
 * 리밋 안내), 그대로 노출하면 영문·과도한 길이가 그대로 보인다. 인식 못 한 영문은
 * 원문 노출 대신 일반 안내로 폴백한다. 이미 한글인 메시지(클라이언트 자체 메시지)는
 * 그대로 통과시킨다.
 */
export function localizeAuthError(raw: string | undefined | null): string {
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
  const location = useLocation();
  // 세션 만료로 튕겨 온 경우 그 사실과 **돌아갈 자리**를 들고 온다(세션 정책 ②).
  // `next`는 튕길 때 `RequireAuth`가 실어 보낸 우리 앱 안의 경로다.
  const nextPath = useRef<string | null>(null);
  useEffect(() => {
    nextPath.current = safeNextPath(new URLSearchParams(location.search).get('next'));
    // 안내는 **한 번만** — 꺼내 오면 표시가 지워진다(같은 문구가 계속 붙어 있지 않게).
    // 세션 만료 등 로그인 화면이 한 번 보여 줄 안내는 모두 이 채널을 쓴다.
    const notice = takeLoginNotice();
    if (notice) setState((prev) => ({ ...prev, notice }));
    // `takeLoginNotice()`가 한 번만 돌려주므로 효과가 다시 돌아도 중복되지 않는다.
  }, [location.search]);
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

  // 재전송 쿨다운 카운트다운: cooldown>0인 동안 1초마다 1씩 줄인다. 의존성을
  // "cooldown>0" 불리언으로 둬서 매초 재구독 없이 인터벌 하나만 유지하고,
  // 0에 닿으면 정리(불리언이 false로 바뀌며 cleanup).
  const counting = state.cooldown > 0;
  useEffect(() => {
    if (!counting) return;
    const id = setInterval(() => {
      setState((prev) => (prev.cooldown > 0 ? { ...prev, cooldown: prev.cooldown - 1 } : prev));
    }, 1000);
    return () => clearInterval(id);
  }, [counting]);

  const patch = (partial: Partial<LoginState>) => {
    setState((prev) => {
      const next = { ...prev, ...partial };
      // `signupBlocked` 콜아웃의 **본문은 `error`** 다. 그래서 에러를 비우는 흐름
      // (Google 로그인 시작·모드 전환·다른 단계로 이동 등)이 플래그를 함께 지우지
      // 않으면 아이콘만 있는 **빈 콜아웃**이 남는다(제보: 안내가 뜬 화면에서
      // 'Google 계정으로 로그인'을 누르면 문구가 공백이 됨). 두 값이 따로 놀 수
      // 없게 여기서 한 번에 묶는다 — 호출부마다 챙기지 않아도 불변식이 유지된다.
      if (!next.error) next.signupBlocked = null;
      return next;
    });
  };

  /** Shows the full-screen loader (Login.dc.html `finish()`'s UI half) then
   * navigates — called once the actual auth call (if any) already succeeded. */
  const finishWithLoader = (signup: boolean) => {
    patch({ busy: true, error: '', loaderMsg: signup ? '계정을 만들고 있어요' : '로그인하고 있어요' });
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      // `replace` so a post-login Back can't return to the login screen and
      // replay its loader/animation. 만료로 튕겨 왔다면 **원래 보던 화면**으로
      // 돌아간다(편집 중이던 맵 주소를 다시 찾지 않게 — 세션 정책 ②).
      navigate(nextPath.current || '/home', { replace: true });
    }, 1100);
  };

  const onEmail = (v: string) => patch({ email: v, error: '', emailUnregistered: false, signupBlocked: null });
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
        patch({ step: 'verify', error: '', code: '', demoCode: genCode(), cooldown: RESEND_COOLDOWN });
        return;
      }
      // Supabase: create the account for real. Default project config
      // requires email confirmation, so `data.session` comes back null —
      // land on the same "verify" step UI, but `verifyCode()` below now
      // calls `auth.verifyOtp` instead of comparing against a client-side code.
      patch({ busy: true, error: '', signupBlocked: null });
      void (async () => {
        // 이미 가입된 이메일이면 여기서 막는다. `signUp`은 이메일 열거 방지로
        // 이미 가입된 주소에도 성공을 돌려주므로(메일은 안 감), 그대로 두면
        // 인증 코드 화면에서 오지 않는 코드를 기다리게 된다(제보: Google로
        // 가입한 계정). 확인 불가(null: RPC 미배포·네트워크)면 기존대로 진행
        // 하되, 어댑터의 `identities: []` 가드가 한 번 더 걸러 준다.
        const providers = await auth.emailSignInProviders(state.email);
        if (providers && providers.length) {
          const social = providers.find((p) => p !== 'email');
          patch({
            busy: false,
            signupBlocked: social ? 'google' : 'email',
            error: social
              ? `이미 ${providerLabel(social)} 계정으로 가입한 이메일이에요. 아래 '${providerLabel(social)}로 계속하기'로 로그인해 주세요.`
              : '이미 가입된 이메일이에요. 로그인 탭에서 비밀번호로 로그인해 주세요.',
          });
          return;
        }
        const res = await auth.signUp(state.email, state.password);
        if (res.error) {
          // 어댑터가 걸러 낸 "이미 가입됨"도 같은 안내로 — 공급자를 모를 땐
          // (RPC 미배포) 로그인 탭으로 유도한다.
          if (isAlreadyRegistered(res.error)) {
            patch({ busy: false, signupBlocked: 'email', error: '이미 가입된 이메일이에요. 로그인 탭에서 로그인하거나, SNS로 가입했다면 아래 소셜 로그인을 이용해 주세요.' });
            return;
          }
          patch({ busy: false, error: localizeAuthError(res.error) });
          return;
        }
        if (res.needsVerification) {
          patch({ busy: false, step: 'verify', error: '', code: '', demoCode: '', cooldown: RESEND_COOLDOWN });
          return;
        }
        finishWithLoader(true);
      })();
      return;
    }
    if (mode === 'local') {
      finishWithLoader(false);
      return;
    }
    patch({ busy: true, error: '' });
    void auth.signInWithPassword(state.email, state.password).then((res) => {
      if (res.error) {
        // 이메일 인증을 마치지 않은 계정 = 아직 회원이 아님. "이메일 인증이 아직…"
        // 같은 막다른 안내 대신, 인증 코드를 다시 보내고 인증 단계로 이동시켜
        // 가입을 마칠 수 있게 한다(동일 계정 재가입과 같은 흐름). 비밀번호가
        // 틀리면 'Invalid login credentials'라 이 분기에 들어오지 않으므로,
        // 여기 도달했다는 건 자격 증명은 맞고 이메일만 미인증이라는 뜻이다.
        if (isEmailNotConfirmed(res.error)) {
          void auth.resendSignup(state.email).then((r) => {
            const cd = r.error ? (parseRetrySeconds(r.error) ?? RESEND_COOLDOWN) : RESEND_COOLDOWN;
            patch({
              busy: false,
              mode: 'signup',
              step: 'verify',
              code: '',
              demoCode: '',
              error: '',
              notice: '아직 가입이 완료되지 않았어요. 이메일로 보낸 인증 코드를 입력해 가입을 마쳐 주세요.',
              cooldown: cd,
            });
          });
          return;
        }
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
    if (state.busy || state.cooldown > 0) return; // 쿨다운 중엔 잠금(버튼도 비활성)
    // Both verify steps re-send for real in Supabase mode so "다시 보내기" isn't a
    // dead button: signup → `auth.resend({type:'signup'})`, recovery →
    // `sendPasswordReset` (re-issues the reset OTP). Local/demo mode has no server,
    // so it just regenerates the on-screen demo code, as before.
    if (mode === 'supabase' && (state.step === 'verify' || state.step === 'forgotVerify')) {
      patch({ busy: true, error: '', notice: '' });
      const send = state.step === 'forgotVerify' ? auth.sendPasswordReset(state.email) : auth.resendSignup(state.email);
      void send.then((res) => {
        if (res.error) {
          // 레이트리밋이면 서버가 알려준 남은 초로 카운트다운을 맞춘다.
          patch({ busy: false, code: '', error: localizeAuthError(res.error), cooldown: parseRetrySeconds(res.error) ?? RESEND_COOLDOWN });
          return;
        }
        patch({ busy: false, code: '', error: '', notice: '인증 코드를 다시 보냈어요. 메일함을 확인해 주세요.', cooldown: RESEND_COOLDOWN });
      });
      return;
    }
    patch({ demoCode: genCode(), code: '', error: '', notice: '', cooldown: RESEND_COOLDOWN });
  };
  const backToForm = () => patch({ step: 'form', error: '', code: '', busy: false });
  const startForgot = () => patch({ step: 'forgot', error: '', code: '', notice: '', busy: false });

  const sendReset = () => {
    if (state.busy) return;
    if (!validEmail(state.email)) {
      patch({ error: '올바른 이메일 주소를 입력해 주세요.' });
      return;
    }
    // 재전송 쿨다운이 이미 진행 중이면(직전에 코드를 보낸 뒤 "← 뒤로"로 돌아와
    // 다시 "재설정 코드 보내기"를 누른 경우) 서버에 재요청하지 않고 남은 시간을
    // 그대로 유지한 채 코드 입력 단계로 되돌아간다. 재요청은 어차피 레이트리밋에
    // 걸리고, 무엇보다 타이머가 60초로 초기화되던 문제(제보)를 막는다.
    if (state.cooldown > 0) {
      patch({ step: 'forgotVerify', error: '', notice: '' });
      return;
    }
    if (mode === 'local') {
      // No server — jump to the sim step with an on-screen demo code.
      patch({ step: 'forgotVerify', demoCode: genCode(), code: '', newPw: '', newPw2: '', error: '', notice: '', cooldown: RESEND_COOLDOWN });
      return;
    }
    // Supabase: actually send the reset email and ONLY advance on success. On a
    // failure (rate limit / SMTP) surface a localized error and stay on this step
    // instead of dropping the user onto a code screen where nothing will arrive.
    patch({ busy: true, error: '', notice: '' });
    void (async () => {
      // `resetPasswordForEmail`은 이메일 열거 방지로 가입 여부와 무관하게 성공을
      // 돌려준다 → 가입 안 된 주소에도 "보냈어요"가 뜨고 메일은 안 온다(제보).
      // 전송 전에 가입 여부를 확인해, 미가입이면 코드 단계로 넘어가지 않고 안내
      // 툴팁을 띄운다. 확인 불가(null: RPC 미배포/네트워크)면 기존대로 전송한다.
      const registered = await auth.isEmailRegistered(state.email);
      if (registered === false) {
        patch({ busy: false, emailUnregistered: true, error: '가입되지 않은 이메일이에요. 이메일 주소를 확인하거나 먼저 회원가입을 진행해 주세요.' });
        return;
      }
      const res = await auth.sendPasswordReset(state.email);
      if (res.error) {
        patch({ busy: false, error: localizeAuthError(res.error), cooldown: parseRetrySeconds(res.error) ?? state.cooldown });
        return;
      }
      // demoCode '' so ForgotVerifyStep hides the demo box (real email has the code).
      // Start the resend countdown so the code step opens with the timer running.
      patch({ busy: false, step: 'forgotVerify', demoCode: '', code: '', newPw: '', newPw2: '', error: '', notice: '이메일로 인증 코드를 보냈어요. 메일함을 확인해 주세요.', cooldown: RESEND_COOLDOWN });
    })();
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
    void (async () => {
      const res = await auth.signInWithIdToken('google', token, nonce);
      if (res.error) {
        patch({ busy: false, error: res.error });
        return;
      }
      finishWithLoader(false);
    })();
  };

  const toggleMode = () => {
    patch({
      mode: state.mode === 'login' ? 'signup' : 'login',
      step: 'form',
      error: '',
      password2: '',
      code: '',
      busy: false,
      // 로그인↔가입 전환은 깨끗한 문맥 전환 — 진행 중이던 인증 재전송 카운트다운은
      // 초기화해, 이후 다른 흐름(예: 비밀번호 찾기)의 첫 전송에 잔여 쿨다운이
      // 새어들어가지 않게 한다.
      cooldown: 0,
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

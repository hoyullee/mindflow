import type { LoginState } from './types';

/**
 * Mirrors the derived (non-handler) fields of Login.dc.html `renderVals()`.
 * Visibility flags here replace the original's `display:'none'|'block'`
 * style objects — React idiomatically expresses `<sc-if>` via conditional
 * rendering rather than toggling CSS display.
 */
export interface LoginViewModel {
  heading: string;
  subheading: string;
  formVisible: boolean;
  verifyVisible: boolean;
  forgotVisible: boolean;
  forgotVerifyVisible: boolean;
  confirmVisible: boolean;
  submitLabel: string;
  switchPrompt: string;
  switchAction: string;
}

export function deriveLoginView(state: LoginState): LoginViewModel {
  const login = state.mode === 'login';
  const verify = state.step === 'verify';
  const forgot = state.step === 'forgot';
  const forgotVerify = state.step === 'forgotVerify';
  const busy = state.busy;

  return {
    heading:
      forgot || forgotVerify
        ? '비밀번호 찾기'
        : verify
          ? '이메일 인증'
          : login
            ? 'MindFlow에 오신 것을 환영해요'
            : '계정 만들기',
    subheading: forgot
      ? '이메일로 재설정 코드를 보내드릴게요.'
      : forgotVerify
        ? '코드 확인 후 새 비밀번호를 설정해 주세요.'
        : verify
          ? '거의 다 왔어요! 인증만 마치면 시작할 수 있어요.'
          : login
            ? '로그인하고 마인드맵을 이어서 그려보세요.'
            : '몇 초면 시작할 수 있어요.',
    formVisible: !(verify || forgot || forgotVerify),
    verifyVisible: verify,
    forgotVisible: forgot,
    forgotVerifyVisible: forgotVerify,
    confirmVisible: !login,
    submitLabel: verify
      ? busy
        ? '인증 중…'
        : '인증하고 시작하기'
      : busy
        ? login
          ? '로그인 중…'
          : '가입 중…'
        : login
          ? '로그인'
          : '가입하기',
    switchPrompt: login ? '아직 계정이 없으신가요?' : '이미 계정이 있으신가요?',
    switchAction: login ? '가입하기' : '로그인',
  };
}

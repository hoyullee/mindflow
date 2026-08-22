import type { LoginState } from './types';

/**
 * 화면에 그대로 쓰이는 파생값 — 단계별 문구와 표시 여부. 디자인 원본
 * (`Geurio 로그인 리디자인.dc.html`)의 `renderVals()` 중 핸들러가 아닌 부분에
 * 대응하고, 문구는 더 자연스럽게 다듬었다.
 */
export interface LoginViewModel {
  /** 등폭 대문자 라벨(Sign in / Verify …) — 지금 어느 단계인지 한눈에. */
  eyebrow: string;
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
  /** 제출 버튼을 누를 수 있는가 — **필수 칸이 채워졌는가**만 본다(styles.ts 주석 참고). */
  submitReady: boolean;
}

/** 단계별 필수 입력이 채워졌는지 — 형식 검사는 하지 않는다(누른 뒤 문장으로 알린다). */
export function submitReady(state: LoginState): boolean {
  const has = (v: string) => (v || '').trim().length > 0;
  if (state.step === 'verify') return has(state.code);
  if (state.step === 'forgot') return has(state.email);
  if (state.step === 'forgotVerify') return has(state.code) && has(state.newPw) && has(state.newPw2);
  if (state.mode === 'signup') return has(state.email) && has(state.password) && has(state.password2);
  return has(state.email) && has(state.password);
}

export function deriveLoginView(state: LoginState): LoginViewModel {
  const login = state.mode === 'login';
  const verify = state.step === 'verify';
  const forgot = state.step === 'forgot';
  const forgotVerify = state.step === 'forgotVerify';
  const busy = state.busy;

  return {
    eyebrow: forgot ? 'Reset' : forgotVerify ? 'New password' : verify ? 'Verify' : login ? 'Sign in' : 'Sign up',
    heading: forgot
      ? '비밀번호를 잊으셨나요?'
      : forgotVerify
        ? '새 비밀번호를 정해 주세요.'
        : verify
          ? '거의 다 왔어요!'
          : login
            ? '다시 만나서 반가워요.'
            : '몇 초면 시작해요.',
    subheading: forgot
      ? '가입할 때 쓴 이메일로 재설정 코드를 보내드릴게요.'
      : forgotVerify
        ? '메일로 받은 코드를 넣고, 앞으로 쓸 비밀번호를 적어 주세요.'
        : verify
          ? '메일로 보낸 코드만 넣으면 바로 시작할 수 있어요.'
          : login
            ? '마인드맵과 화이트보드, 칸반 보드가 그대로 기다리고 있어요.'
            : '이메일만 있으면 첫 보드를 바로 열 수 있어요.',
    formVisible: !(verify || forgot || forgotVerify),
    verifyVisible: verify,
    forgotVisible: forgot,
    forgotVerifyVisible: forgotVerify,
    confirmVisible: !login,
    submitLabel: verify
      ? busy
        ? '확인하는 중'
        : '인증하고 시작하기'
      : forgot
        ? busy
          ? '보내는 중'
          : '재설정 코드 보내기'
        : forgotVerify
          ? busy
            ? '바꾸는 중'
            : '비밀번호 바꾸기'
          : busy
            ? login
              ? '들어가는 중'
              : '만드는 중'
            : login
              ? '로그인'
              : '가입하기',
    switchPrompt: login ? '아직 계정이 없으신가요?' : '이미 계정이 있으신가요?',
    switchAction: login ? '가입하기' : '로그인',
    submitReady: submitReady(state),
  };
}

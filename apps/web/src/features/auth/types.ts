export type LoginMode = 'login' | 'signup';
export type LoginStep = 'form' | 'verify' | 'forgot' | 'forgotVerify';

/**
 * Mirrors `this.state` in Login.dc.html's `class Component extends DCLogic`.
 */
export interface LoginState {
  mode: LoginMode;
  step: LoginStep;
  email: string;
  password: string;
  password2: string;
  code: string;
  busy: boolean;
  error: string;
  demoCode: string;
  newPw: string;
  newPw2: string;
  notice: string;
  loaderMsg: string;
  /** 인증 코드 재전송까지 남은 초. >0이면 "N초 후 다시 보내기"로 카운트다운을
   * 항상 보여주고 "다시 보내기"를 잠근다(Supabase 레이트리밋 ~60초와 동기). */
  cooldown: number;
  /** 비밀번호 찾기에서 입력한 이메일이 미가입으로 확인된 상태. true면 이메일
   * 입력칸 아래에 안내 툴팁을 띄운다(이메일 수정 시 해제). */
  emailUnregistered: boolean;
}

export const initialLoginState: LoginState = {
  mode: 'login',
  step: 'form',
  email: '',
  password: '',
  password2: '',
  code: '',
  busy: false,
  error: '',
  demoCode: '',
  newPw: '',
  newPw2: '',
  notice: '',
  loaderMsg: '',
  cooldown: 0,
  emailUnregistered: false,
};

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
};

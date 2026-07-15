import type { ChangeEvent } from 'react';
import { GoogleIcon } from './GoogleIcon';
import type { LoginController } from './useLoginController';
import type { LoginViewModel } from './viewModel';
import {
  errorMsgStyle,
  fieldLabelStyle,
  noticeMsgStyle,
  spinnerStyle,
  submitButtonStyle,
  textInputStyle,
} from './styles';

interface FormStepProps {
  controller: LoginController;
  view: LoginViewModel;
}

/** Ports the `formStepStyle` block (Google + email/password + submit) from Login.dc.html. */
export function FormStep({ controller, view }: FormStepProps) {
  const { state } = controller;

  return (
    <div>
      <button
        type="button"
        className="btn"
        onClick={controller.googleLogin}
        style={{
          width: '100%',
          height: 50,
          border: '1px solid #ecdfd5',
          borderRadius: 12,
          background: '#fff',
          fontFamily: 'inherit',
          fontSize: 14.5,
          fontWeight: 600,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          color: '#33281f',
          transition: 'filter .12s, transform .06s',
        }}
      >
        <GoogleIcon />
        Google 계정으로 계속하기
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '22px 0' }}>
        <div style={{ flex: 1, height: 1, background: '#ecdfd5' }} />
        <div style={{ fontSize: 12, color: '#b6a596' }}>또는 이메일로</div>
        <div style={{ flex: 1, height: 1, background: '#ecdfd5' }} />
      </div>

      <div style={fieldLabelStyle}>이메일</div>
      <input
        className="lg-input"
        type="email"
        value={state.email}
        onChange={(e: ChangeEvent<HTMLInputElement>) => controller.onEmail(e.target.value)}
        placeholder="you@example.com"
        style={textInputStyle(16)}
      />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
        <div style={fieldLabelStyle}>비밀번호</div>
        <div className="link-tab" onClick={controller.startForgot} style={{ fontSize: 12, color: '#9c8b7e' }}>
          비밀번호 찾기
        </div>
      </div>
      <input
        className="lg-input"
        type="password"
        value={state.password}
        onChange={(e: ChangeEvent<HTMLInputElement>) => controller.onPassword(e.target.value)}
        onKeyDown={controller.onPwKey}
        placeholder="비밀번호 입력"
        style={textInputStyle(16)}
      />

      {view.confirmVisible && (
        <div>
          <div style={fieldLabelStyle}>비밀번호 확인</div>
          <input
            className="lg-input"
            type="password"
            value={state.password2}
            onChange={(e: ChangeEvent<HTMLInputElement>) => controller.onPassword2(e.target.value)}
            onKeyDown={controller.onPwKey}
            placeholder="비밀번호 재입력"
            style={textInputStyle(8)}
          />
        </div>
      )}

      {state.notice && <div style={noticeMsgStyle}>{state.notice}</div>}
      {state.error && <div style={errorMsgStyle}>{state.error}</div>}

      <button type="button" className="btn" onClick={controller.emailLogin} style={submitButtonStyle(state.busy)}>
        <span style={spinnerStyle(state.busy)} />
        <span>{view.submitLabel}</span>
      </button>

      <div style={{ textAlign: 'center', fontSize: 13, color: '#9c8b7e', marginTop: 22 }}>
        {view.switchPrompt}{' '}
        <span className="link-tab" onClick={controller.toggleMode} style={{ color: '#f0663f', fontWeight: 700 }}>
          {view.switchAction}
        </span>
      </div>
    </div>
  );
}

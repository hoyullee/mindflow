import type { ChangeEvent } from 'react';
import type { LoginController } from './useLoginController';
import { errorMsgStyle, fieldLabelStyle, submitButtonStyle, textInputStyle } from './styles';

interface ForgotStepProps {
  controller: LoginController;
}

/** Ports the `forgotStepStyle` block (email-for-reset step) from Login.dc.html. */
export function ForgotStep({ controller }: ForgotStepProps) {
  const { state } = controller;

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 56,
          height: 56,
          borderRadius: 16,
          background: '#fdeee7',
          fontSize: 26,
          marginBottom: 20,
        }}
      >
        🔑
      </div>
      <div style={{ fontSize: 13.5, color: '#33281f', lineHeight: 1.65, marginBottom: 20 }}>
        가입한 이메일 주소를 입력하면
        <br />
        비밀번호 재설정 코드를 보내드려요.
      </div>
      <div style={fieldLabelStyle}>이메일</div>
      <input
        className="lg-input"
        type="email"
        value={state.email}
        onChange={(e: ChangeEvent<HTMLInputElement>) => controller.onEmail(e.target.value)}
        onKeyDown={controller.onForgotKey}
        placeholder="you@example.com"
        style={textInputStyle(8)}
      />
      {state.error && <div style={errorMsgStyle}>{state.error}</div>}
      <button type="button" className="btn" onClick={controller.sendReset} style={submitButtonStyle(state.busy)}>
        <span>재설정 코드 보내기</span>
      </button>
      <div style={{ marginTop: 20, fontSize: 13, color: '#9c8b7e' }}>
        <span className="link-tab" onClick={controller.backToForm} style={{ fontWeight: 600 }}>
          ← 로그인으로 돌아가기
        </span>
      </div>
    </div>
  );
}

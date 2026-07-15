import type { ChangeEvent } from 'react';
import type { LoginController } from './useLoginController';
import type { LoginViewModel } from './viewModel';
import { codeInputStyle, errorMsgStyle, fieldLabelStyle, spinnerStyle, submitButtonStyle } from './styles';

interface VerifyStepProps {
  controller: LoginController;
  view: LoginViewModel;
}

/** Ports the `verifyStepStyle` block (6-digit demo code entry) from Login.dc.html. */
export function VerifyStep({ controller, view }: VerifyStepProps) {
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
        ✉️
      </div>
      <div style={{ fontSize: 13.5, color: '#33281f', lineHeight: 1.65, marginBottom: 6 }}>
        <b style={{ fontWeight: 700 }}>{state.email}</b> 로 인증 코드를 보냈어요.
      </div>
      <div style={{ fontSize: 12.5, color: '#9c8b7e', marginBottom: 20 }}>
        메일함에서 6자리 코드를 확인해 입력해 주세요.
      </div>

      <div
        style={{
          fontSize: 12,
          color: '#b6a596',
          background: '#faf3ee',
          border: '1px dashed #e4d2c5',
          borderRadius: 9,
          padding: '9px 12px',
          marginBottom: 18,
        }}
      >
        데모 코드: <b style={{ color: '#d9542f', letterSpacing: 2 }}>{state.demoCode}</b>
      </div>

      <div style={fieldLabelStyle}>인증 코드</div>
      <input
        className="lg-input"
        inputMode="numeric"
        maxLength={6}
        value={state.code}
        onChange={(e: ChangeEvent<HTMLInputElement>) => controller.onCode(e.target.value)}
        onKeyDown={controller.onCodeKey}
        placeholder="6자리 숫자"
        style={codeInputStyle(8)}
      />

      {state.error && <div style={errorMsgStyle}>{state.error}</div>}

      <button type="button" className="btn" onClick={controller.verifyCode} style={submitButtonStyle(state.busy)}>
        <span style={spinnerStyle(state.busy)} />
        <span>{view.submitLabel}</span>
      </button>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 20, fontSize: 13, color: '#9c8b7e' }}>
        <span className="link-tab" onClick={controller.backToForm} style={{ fontWeight: 600 }}>
          ← 뒤로
        </span>
        <span>
          코드가 안 왔나요?{' '}
          <span className="link-tab" onClick={controller.resendCode} style={{ color: '#f0663f', fontWeight: 700 }}>
            다시 보내기
          </span>
        </span>
      </div>
    </div>
  );
}

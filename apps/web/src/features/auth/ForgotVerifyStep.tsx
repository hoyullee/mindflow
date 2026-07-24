import type { ChangeEvent } from 'react';
import type { LoginController } from './useLoginController';
import { codeInputStyle, errorMsgStyle, fieldLabelStyle, noticeMsgStyle, spinnerStyle, submitButtonStyle, textInputStyle } from './styles';

interface ForgotVerifyStepProps {
  controller: LoginController;
}

/** Ports the `forgotVerifyStepStyle` block (reset code + new password) from Login.dc.html. */
export function ForgotVerifyStep({ controller }: ForgotVerifyStepProps) {
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
        <b style={{ fontWeight: 700 }}>{state.email}</b> 로 재설정 코드를 보냈어요.
      </div>
      <div style={{ fontSize: 12.5, color: '#9c8b7e', margin: '0 0 18px' }}>메일함에서 6자리 코드를 확인해 입력해 주세요.</div>
      {/* 데모 코드 힌트는 로컬/데모 모드에서만 — 실제 Supabase 복구에선 비어 있어
          이 박스가 노출되지 않는다(메일의 6자리 코드를 입력). */}
      {state.demoCode && (
        <div
          style={{
            fontSize: 12,
            color: '#b6a596',
            background: '#faf3ee',
            border: '1px dashed #e4d2c5',
            borderRadius: 9,
            padding: '9px 12px',
            margin: '0 0 18px',
          }}
        >
          데모 코드: <b style={{ color: '#d9542f', letterSpacing: 2 }}>{state.demoCode}</b>
        </div>
      )}
      <div style={fieldLabelStyle}>인증 코드</div>
      <input
        className="lg-input"
        inputMode="numeric"
        maxLength={6}
        value={state.code}
        onChange={(e: ChangeEvent<HTMLInputElement>) => controller.onCode(e.target.value)}
        placeholder="6자리 숫자"
        style={codeInputStyle(16)}
      />
      <div style={fieldLabelStyle}>새 비밀번호</div>
      <input
        className="lg-input"
        type="password"
        value={state.newPw}
        onChange={(e: ChangeEvent<HTMLInputElement>) => controller.onNewPw(e.target.value)}
        placeholder="새 비밀번호 입력"
        style={textInputStyle(16)}
      />
      <div style={fieldLabelStyle}>새 비밀번호 확인</div>
      <input
        className="lg-input"
        type="password"
        value={state.newPw2}
        onChange={(e: ChangeEvent<HTMLInputElement>) => controller.onNewPw2(e.target.value)}
        onKeyDown={controller.onResetKey}
        placeholder="새 비밀번호 재입력"
        style={textInputStyle(8)}
      />
      {state.notice && <div style={noticeMsgStyle}>{state.notice}</div>}
      {state.error && <div style={errorMsgStyle}>{state.error}</div>}
      <button type="button" className="btn" onClick={controller.resetPw} style={submitButtonStyle(state.busy)}>
        <span style={spinnerStyle(state.busy)} />
        <span>비밀번호 재설정</span>
      </button>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 20,
          fontSize: 13,
          color: '#9c8b7e',
        }}
      >
        <span className="link-tab" onClick={controller.startForgot} style={{ fontWeight: 600 }}>
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

import type { ChangeEvent } from 'react';
import type { LoginController } from './useLoginController';
import { errorMsgStyle, fieldLabelStyle, submitButtonStyle, textInputStyle } from './styles';
import { KeyIcon } from './AuthIcons';

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
          marginBottom: 20,
        }}
      >
        <KeyIcon />
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
        style={textInputStyle(state.emailUnregistered ? 0 : 8)}
      />
      {/* 미가입 이메일 안내 툴팁 — 입력칸 바로 아래에 위쪽 화살표로 붙는 콜아웃.
          resetPasswordForEmail이 가입 여부를 숨겨 "보냈어요"만 뜨던 문제를,
          전송 전 가입 확인(email_is_registered) 결과로 명시적으로 안내한다. */}
      {state.emailUnregistered ? (
        <div role="alert" style={{ position: 'relative', margin: '9px 0 14px' }}>
          <div
            aria-hidden
            style={{
              position: 'absolute',
              top: -5,
              left: 18,
              width: 10,
              height: 10,
              background: '#fff3ec',
              borderLeft: '1px solid #f0c4ad',
              borderTop: '1px solid #f0c4ad',
              transform: 'rotate(45deg)',
            }}
          />
          <div
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'flex-start',
              background: '#fff3ec',
              border: '1px solid #f0c4ad',
              borderRadius: 10,
              padding: '10px 12px',
              fontSize: 12.5,
              lineHeight: 1.55,
              color: '#b4462a',
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#d9542f" strokeWidth={2} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 11.5v5" strokeLinecap="round" />
              <circle cx="12" cy="7.6" r="0.6" fill="#d9542f" />
            </svg>
            <span>{state.error}</span>
          </div>
        </div>
      ) : (
        state.error && <div style={errorMsgStyle}>{state.error}</div>
      )}
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

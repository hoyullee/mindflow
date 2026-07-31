import type { ChangeEvent } from 'react';
import { GoogleIcon } from './GoogleIcon';
import type { LoginController } from './useLoginController';
import type { LoginViewModel } from './viewModel';
import {
  errorMsgStyle,
  signupBlockedCalloutStyle,
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
      {/* 일반 커스텀 Google 버튼(리다이렉트 방식). GIS 공식 버튼은 세션이 있으면
          계정명을 개인화("OO으로 계속")하고 로딩 시 깜빡여서, 사용자 선택에 따라
          고정 문구 버튼으로 둔다. 브랜드 인증 완료로 동의화면은 'Geurio'로 표시된다.
          (GIS 인프라 GoogleSignInButton/googleIdentity/googleTokenLogin는 되돌리기
          쉽도록 그대로 남겨둠.) */}
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
        Google 계정으로 로그인
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
        {/* "비밀번호 찾기"는 로그인 모드에서만 — 가입 모드(confirmVisible)엔 의미 없다. */}
        {!view.confirmVisible && (
          <div className="link-tab" onClick={controller.startForgot} style={{ fontSize: 12, color: '#9c8b7e' }}>
            비밀번호 찾기
          </div>
        )}
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
      {/* 이미 가입된 이메일로 가입을 시도한 경우 — 단순 에러 줄 대신 눈에 띄는
          콜아웃으로 안내한다. SNS(Google)로 가입한 계정이라면 위 소셜 버튼을
          쓰라고, 이메일 계정이면 로그인 탭으로 가라고 알려 준다(제보: 인증
          코드 화면까지 갔는데 코드가 오지 않던 흐름을 여기서 끊는다). */}
      {state.signupBlocked && state.error ? (
        <div role="alert" style={signupBlockedCalloutStyle}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#d9542f" strokeWidth={2} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11.5v5" strokeLinecap="round" />
            <circle cx="12" cy="7.6" r="0.6" fill="#d9542f" />
          </svg>
          <div>
            <div>{state.error}</div>
            {state.signupBlocked === 'email' && (
              <span className="link-tab" onClick={controller.toggleMode} style={{ display: 'inline-block', marginTop: 6, color: '#b4462a', fontWeight: 700 }}>
                로그인하러 가기 →
              </span>
            )}
          </div>
        </div>
      ) : (
        state.error && <div style={errorMsgStyle}>{state.error}</div>
      )}

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

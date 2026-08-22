import { useState } from 'react';
import { GoogleIcon } from './GoogleIcon';
import { AUTH } from './tokens';
import { Callout, EmailInput, ErrorLine, Field, InfoLine, PasswordInput } from './AuthFields';
import type { LoginController } from './useLoginController';
import type { LoginViewModel } from './viewModel';
import { rememberSession, setRememberSession } from './rememberSession';
import { spinnerStyle, submitButtonStyle } from './styles';

interface FormStepProps {
  controller: LoginController;
  view: LoginViewModel;
}

/** 로그인·가입 단계 — Google 버튼 + 이메일/비밀번호 + 제출. */
export function FormStep({ controller, view }: FormStepProps) {
  const { state } = controller;
  // "이 브라우저에서 로그인 유지" — 끄면 세션이 탭 저장소로 가서 창을 닫는 순간
  // 사라진다(공용 PC). 값은 이 기기에 남으므로 다음에 와도 고른 대로다.
  const [remember, setRemember] = useState(rememberSession);
  const mismatch = view.confirmVisible && state.password2.length > 0 && state.password !== state.password2;

  return (
    <>
      {/* 일반 커스텀 Google 버튼(리다이렉트 방식). GIS 공식 버튼은 세션이 있으면
          계정명을 개인화("OO으로 계속")하고 로딩 시 깜빡여서, 사용자 선택에 따라
          고정 문구 버튼으로 둔다. 브랜드 인증 완료로 동의화면은 'Geurio'로 표시된다.
          (GIS 인프라 GoogleSignInButton/googleIdentity/googleTokenLogin는 되돌리기
          쉽도록 그대로 남겨둠.) */}
      <button
        type="button"
        className="lg-oauth"
        onClick={controller.googleLogin}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          height: 50,
          borderRadius: 14,
          border: `1px solid ${AUTH.border}`,
          background: AUTH.field,
          fontFamily: 'inherit',
          fontSize: 14.5,
          fontWeight: 700,
          letterSpacing: '-.015em',
          color: AUTH.ink2,
          cursor: 'pointer',
          transition: 'background .16s ease, border-color .16s ease, transform .12s ease',
        }}
      >
        <GoogleIcon />
        Google 계정으로 계속하기
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ flex: 1, height: 1, background: AUTH.borderSoft, display: 'block' }} />
        <span style={{ fontSize: 11.5, color: AUTH.faint2, whiteSpace: 'nowrap' }}>또는 이메일로</span>
        <span style={{ flex: 1, height: 1, background: AUTH.borderSoft, display: 'block' }} />
      </div>

      <Field label="이메일">{(id) => <EmailInput id={id} value={state.email} onChange={controller.onEmail} onKeyDown={controller.onPwKey} />}</Field>

      <Field
        label="비밀번호"
        aside={
          // "비밀번호 찾기"는 로그인 모드에서만 — 가입 모드엔 의미 없다.
          view.confirmVisible ? undefined : (
            <button
              type="button"
              className="link-tab"
              onClick={controller.startForgot}
              style={{ flex: '0 0 auto', border: 0, background: 'transparent', padding: 0, font: 'inherit', fontSize: 11.5, fontWeight: 600, color: AUTH.faint, cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              비밀번호 찾기
            </button>
          )
        }
      >
        {(id) => (
          <PasswordInput
            id={id}
            value={state.password}
            onChange={controller.onPassword}
            onKeyDown={controller.onPwKey}
            placeholder="비밀번호"
            autoComplete={view.confirmVisible ? 'new-password' : 'current-password'}
          />
        )}
      </Field>

      {view.confirmVisible && (
        <Field label="비밀번호 확인">
          {(id) => (
            <>
              <PasswordInput
                id={id}
                value={state.password2}
                onChange={controller.onPassword2}
                onKeyDown={controller.onPwKey}
                placeholder="한 번 더 입력"
                autoComplete="new-password"
                invalid={mismatch}
              />
              {mismatch && <span style={{ fontSize: 11.5, color: AUTH.accentDeep, marginTop: 7 }}>비밀번호가 서로 달라요.</span>}
            </>
          )}
        </Field>
      )}

      {/* 로그인 모드에서만 — 가입은 어차피 이 브라우저에서 이어서 시작한다. */}
      {!view.confirmVisible && (
        <button
          type="button"
          role="switch"
          aria-checked={remember}
          onClick={() => {
            const next = !remember;
            setRemember(next);
            setRememberSession(next);
          }}
          style={{ display: 'flex', alignItems: 'center', gap: 9, border: 0, background: 'transparent', padding: 0, font: 'inherit', cursor: 'pointer', userSelect: 'none', marginTop: -2 }}
        >
          <span
            style={{
              width: 18,
              height: 18,
              flex: '0 0 auto',
              borderRadius: 6,
              border: `1.5px solid ${remember ? AUTH.accent : '#D8CBBD'}`,
              background: remember ? AUTH.accent : AUTH.field,
              color: '#fff',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background .15s ease, border-color .15s ease',
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round" style={{ opacity: remember ? 1 : 0 }} aria-hidden="true">
              <path d="m5 13 4.5 4.5L19 7" />
            </svg>
          </span>
          <span style={{ fontSize: 13, color: '#6E675F' }}>이 브라우저에서 로그인 유지</span>
        </button>
      )}

      {state.notice && <InfoLine>{state.notice}</InfoLine>}
      {/* 이미 가입된 이메일로 가입을 시도한 경우 — 단순 에러 줄 대신 눈에 띄는
          콜아웃으로 안내한다. SNS(Google)로 가입한 계정이라면 위 소셜 버튼을
          쓰라고, 이메일 계정이면 로그인 탭으로 가라고 알려 준다(제보: 인증
          코드 화면까지 갔는데 코드가 오지 않던 흐름을 여기서 끊는다). */}
      {state.signupBlocked && state.error ? (
        <Callout>
          <div>{state.error}</div>
          {state.signupBlocked === 'email' && (
            <button
              type="button"
              className="link-tab"
              onClick={controller.toggleMode}
              style={{ display: 'inline-block', marginTop: 6, border: 0, background: 'transparent', padding: 0, font: 'inherit', color: '#B4462A', fontWeight: 700, cursor: 'pointer' }}
            >
              로그인하러 가기 →
            </button>
          )}
        </Callout>
      ) : (
        state.error && <ErrorLine>{state.error}</ErrorLine>
      )}

      <button type="button" className="lg-submit" onClick={controller.emailLogin} disabled={!view.submitReady && !state.busy} style={submitButtonStyle(state.busy, view.submitReady)}>
        <span style={spinnerStyle(state.busy)} />
        {view.submitLabel}
      </button>

      <p style={{ margin: 0, textAlign: 'center', fontSize: 13, color: AUTH.sub }}>
        {view.switchPrompt}{' '}
        <button
          type="button"
          className="link-tab"
          onClick={controller.toggleMode}
          style={{ border: 0, background: 'transparent', padding: 0, font: 'inherit', fontWeight: 700, color: AUTH.accentDeep, cursor: 'pointer' }}
        >
          {view.switchAction}
        </button>
      </p>
    </>
  );
}

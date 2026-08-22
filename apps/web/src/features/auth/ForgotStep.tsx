import { Callout, EmailInput, ErrorLine, Field, IntroBlock } from './AuthFields';
import { spinnerStyle, submitButtonStyle } from './styles';
import type { LoginController } from './useLoginController';
import type { LoginViewModel } from './viewModel';

interface ForgotStepProps {
  controller: LoginController;
  view: LoginViewModel;
}

/** 비밀번호 찾기 — 가입한 이메일을 받아 재설정 코드를 보낸다. */
export function ForgotStep({ controller, view }: ForgotStepProps) {
  const { state } = controller;

  return (
    <>
      <IntroBlock kind="key">가입할 때 쓴 이메일 주소를 넣어 주세요. 그 주소로 재설정 코드를 보내드려요.</IntroBlock>

      <Field label="이메일">
        {(id) => <EmailInput id={id} value={state.email} onChange={controller.onEmail} onKeyDown={controller.onForgotKey} invalid={state.emailUnregistered} />}
      </Field>

      {/* 미가입 이메일 안내 — resetPasswordForEmail이 가입 여부를 숨겨 "보냈어요"만
          뜨던 문제를, 전송 전 가입 확인(isEmailRegistered) 결과로 명시적으로 알린다. */}
      {state.emailUnregistered && state.error ? <Callout>{state.error}</Callout> : state.error && <ErrorLine>{state.error}</ErrorLine>}

      <button type="button" className="lg-submit" onClick={controller.sendReset} disabled={!view.submitReady && !state.busy} style={submitButtonStyle(state.busy, view.submitReady)}>
        <span style={spinnerStyle(state.busy)} />
        {view.submitLabel}
      </button>

      <div style={{ display: 'flex' }}>
        <button
          type="button"
          className="link-tab"
          onClick={controller.backToForm}
          style={{ border: 0, background: 'transparent', padding: 0, font: 'inherit', fontSize: 12.5, fontWeight: 600, color: '#8A8078', cursor: 'pointer' }}
        >
          ← 로그인으로 돌아가기
        </button>
      </div>
    </>
  );
}

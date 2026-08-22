import { AUTH } from './tokens';
import { BackRow, CodeInput, ErrorLine, Field, IntroBlock, NoticeLine, PasswordInput } from './AuthFields';
import { demoHintStyle, spinnerStyle, submitButtonStyle } from './styles';
import type { LoginController } from './useLoginController';
import type { LoginViewModel } from './viewModel';

interface ForgotVerifyStepProps {
  controller: LoginController;
  view: LoginViewModel;
}

/** 비밀번호 재설정 — 메일로 받은 코드 + 새 비밀번호. */
export function ForgotVerifyStep({ controller, view }: ForgotVerifyStepProps) {
  const { state } = controller;
  const mismatch = state.newPw2.length > 0 && state.newPw !== state.newPw2;

  return (
    <>
      <IntroBlock kind="mail">
        <b style={{ fontWeight: 700, color: AUTH.ink }}>{state.email}</b> 로 재설정 코드를 보냈어요. 메일함에서 코드를 확인해 주세요.
      </IntroBlock>

      {/* 데모 코드 힌트는 로컬/데모 모드에서만 — 실제 복구에선 비어 있다. */}
      {state.demoCode && (
        <div style={demoHintStyle}>
          데모 코드: <b style={{ color: AUTH.accentIcon, letterSpacing: 2, fontFamily: AUTH.mono }}>{state.demoCode}</b>
        </div>
      )}

      <Field label="인증 코드">{(id) => <CodeInput id={id} value={state.code} onChange={controller.onCode} />}</Field>

      <Field label="새 비밀번호">
        {(id) => <PasswordInput id={id} value={state.newPw} onChange={controller.onNewPw} placeholder="새 비밀번호" autoComplete="new-password" />}
      </Field>

      <Field label="새 비밀번호 확인">
        {(id) => (
          <>
            <PasswordInput
              id={id}
              value={state.newPw2}
              onChange={controller.onNewPw2}
              onKeyDown={controller.onResetKey}
              placeholder="한 번 더 입력"
              autoComplete="new-password"
              invalid={mismatch}
            />
            {mismatch && <span style={{ fontSize: 11.5, color: AUTH.accentDeep, marginTop: 7 }}>비밀번호가 서로 달라요.</span>}
          </>
        )}
      </Field>

      {state.notice ? <NoticeLine>{state.notice}</NoticeLine> : <NoticeLine>메일함으로 코드를 보냈어요. 스팸함도 한 번 확인해 주세요.</NoticeLine>}
      {state.error && <ErrorLine>{state.error}</ErrorLine>}

      <button type="button" className="lg-submit" onClick={controller.resetPw} disabled={!view.submitReady && !state.busy} style={submitButtonStyle(state.busy, view.submitReady)}>
        <span style={spinnerStyle(state.busy)} />
        {view.submitLabel}
      </button>

      <BackRow backLabel="이메일 다시 입력" onBack={controller.startForgot} resend={{ cooldown: state.cooldown, onResend: controller.resendCode }} />
    </>
  );
}

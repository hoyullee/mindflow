import { AUTH } from './tokens';
import { BackRow, CodeInput, ErrorLine, Field, IntroBlock, NoticeLine } from './AuthFields';
import { demoHintStyle, spinnerStyle, submitButtonStyle } from './styles';
import type { LoginController } from './useLoginController';
import type { LoginViewModel } from './viewModel';

interface VerifyStepProps {
  controller: LoginController;
  view: LoginViewModel;
}

/** 이메일 인증 단계 — 메일로 받은 코드를 넣는다. */
export function VerifyStep({ controller, view }: VerifyStepProps) {
  const { state } = controller;

  return (
    <>
      <IntroBlock kind="mail">
        <b style={{ fontWeight: 700, color: AUTH.ink }}>{state.email}</b> 로 인증 코드를 보냈어요. 메일함에서 코드를 확인해 주세요.
      </IntroBlock>

      {/* 데모 코드 힌트는 로컬/데모 모드에서만 — 실제 Supabase 인증에선
          `demoCode`가 비어 있어 이 박스가 노출되지 않는다(메일의 코드 사용). */}
      {state.demoCode && (
        <div style={demoHintStyle}>
          데모 코드: <b style={{ color: AUTH.accentIcon, letterSpacing: 2, fontFamily: AUTH.mono }}>{state.demoCode}</b>
        </div>
      )}

      <Field label="인증 코드">{(id) => <CodeInput id={id} value={state.code} onChange={controller.onCode} onKeyDown={controller.onCodeKey} />}</Field>

      {state.notice ? <NoticeLine>{state.notice}</NoticeLine> : <NoticeLine>메일함으로 코드를 보냈어요. 스팸함도 한 번 확인해 주세요.</NoticeLine>}
      {state.error && <ErrorLine>{state.error}</ErrorLine>}

      <button type="button" className="lg-submit" onClick={controller.verifyCode} disabled={!view.submitReady && !state.busy} style={submitButtonStyle(state.busy, view.submitReady)}>
        <span style={spinnerStyle(state.busy)} />
        {view.submitLabel}
      </button>

      <BackRow backLabel="뒤로" onBack={controller.backToForm} resend={{ cooldown: state.cooldown, onResend: controller.resendCode }} />
    </>
  );
}

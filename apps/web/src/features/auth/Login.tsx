import './login.css';
import { BrandPanel } from './BrandPanel';
import { LoadingOverlay } from './LoadingOverlay';
import { FormStep } from './FormStep';
import { VerifyStep } from './VerifyStep';
import { ForgotStep } from './ForgotStep';
import { ForgotVerifyStep } from './ForgotVerifyStep';
import { useLoginController } from './useLoginController';
import { deriveLoginView } from './viewModel';
import { useIsMobile } from '../../hooks/useMediaQuery';

/**
 * React port of Login.dc.html. State machine: `mode` ('login' | 'signup') ×
 * `step` ('form' | 'verify' | 'forgot' | 'forgotVerify'), driven by
 * {@link useLoginController}. Layout/styling mirrors the original inline
 * styles; behavior (validation, demo verification codes, timers) is ported
 * 1:1 from the original `class Component extends DCLogic` controller.
 *
 * M6 (mobile web): below the 768px breakpoint the left brand panel is
 * dropped entirely (it's decorative, and the form is the task) and the form
 * column switches from a fixed 520px side panel to a full-width, single
 * column layout with mobile-appropriate padding.
 */
export function Login() {
  const controller = useLoginController();
  const view = deriveLoginView(controller.state);
  const isMobile = useIsMobile();

  return (
    <div
      className="mf-login"
      style={{
        minHeight: '100vh',
        width: '100%',
        display: 'flex',
        background: '#fbf6f2',
        fontFamily: 'Pretendard, system-ui, sans-serif',
        color: '#33281f',
      }}
    >
      {/* 전체화면 로더는 "완료 후 홈으로 이동"(finishWithLoader)일 때만 — 즉
          `loaderMsg`가 설정된 경우에만 띄운다. 폼 내 비동기 처리(가입 요청·로그인
          확인·인증 등)의 `busy`는 버튼 인라인 스피너로만 표시(가입 중에 엉뚱한
          "로그인하고 있어요" 오버레이가 뜨던 문제 해결). */}
      {controller.state.busy && controller.state.loaderMsg && <LoadingOverlay message={controller.state.loaderMsg} />}

      {!isMobile && <BrandPanel />}

      <div
        style={
          isMobile
            ? { flex: '1 1 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 20px' }
            : { width: 520, flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }
        }
      >
        <div style={{ width: '100%', maxWidth: 360, animation: 'mf-fade .3s ease' }}>
          <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-.02em', marginBottom: 6 }}>{view.heading}</div>
          <div style={{ fontSize: 14, color: '#9c8b7e', marginBottom: 30 }}>{view.subheading}</div>

          {view.formVisible && <FormStep controller={controller} view={view} />}
          {view.verifyVisible && <VerifyStep controller={controller} view={view} />}
          {view.forgotVisible && <ForgotStep controller={controller} />}
          {view.forgotVerifyVisible && <ForgotVerifyStep controller={controller} />}

          {/* Legal links — visible pre-login (Google brand verification checks
              that the privacy policy is reachable from the app's entry page).
              New tab so typed-in credentials / the current step aren't lost. */}
          <div style={{ marginTop: 28, textAlign: 'center', fontSize: 12, color: '#b6a596', display: 'flex', justifyContent: 'center', gap: 14 }}>
            <a href="/privacy" target="_blank" rel="noreferrer" style={{ color: '#b6a596' }}>
              개인정보처리방침
            </a>
            <a href="/terms" target="_blank" rel="noreferrer" style={{ color: '#b6a596' }}>
              이용약관
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

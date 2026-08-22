import './login.css';
import { AuthPeek } from './AuthPeek';
import { LoadingOverlay } from './LoadingOverlay';
import { FormStep } from './FormStep';
import { VerifyStep } from './VerifyStep';
import { ForgotStep } from './ForgotStep';
import { ForgotVerifyStep } from './ForgotVerifyStep';
import { AUTH } from './tokens';
import { useLoginController } from './useLoginController';
import { deriveLoginView } from './viewModel';
import { loginUpdateRisk } from './updateRisk';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useUpdateGuard } from '../../pwa/updateGate';

/**
 * 로그인 화면 — 디자인 원본(`Geurio 로그인 리디자인.dc.html`) 이식.
 *
 * 왼쪽은 한 열짜리 폼(단계: 로그인·가입 / 이메일 인증 / 비밀번호 찾기 / 재설정),
 * 오른쪽은 세 보기를 번갈아 보여 주는 미리보기다. 상태 기계와 실제 인증 호출은
 * {@link useLoginController}가 그대로 담당한다(디자인 이식은 화면만 바꿨다).
 *
 * 미리보기는 **880px 미만에서 그리지 않는다** — 좁은 화면에서 이 화면의 일은
 * 폼이고 미리보기는 곁다리다(디자인 원본의 `wide` 판정과 같은 폭).
 */
export function Login() {
  const controller = useLoginController();
  const view = deriveLoginView(controller.state);
  // max-width로 묻는 이유: jsdom은 matchMedia가 없어 false를 돌려주므로
  // 테스트·SSR 기본값이 "넓은 화면"이 된다(앱의 다른 브레이크포인트와 같은 규칙).
  const narrow = useMediaQuery('(max-width: 879px)');
  // 새 배포 자동 적용 게이트: 빈 폼이면 조용히 갈아끼워도 되지만, 입력을 시작했거나
  // 인증 코드 단계면 리로드가 그 상태를 통째로 날린다 — updateRisk.ts 참고.
  useUpdateGuard(loginUpdateRisk(controller.state));

  return (
    <div className="mf-login">
      {/* 전체화면 로더는 "완료 후 홈으로 이동"(finishWithLoader)일 때만 — 즉
          `loaderMsg`가 설정된 경우에만 띄운다. 폼 내 비동기 처리(가입 요청·로그인
          확인·인증 등)의 `busy`는 버튼 인라인 스피너로만 표시. */}
      {controller.state.busy && controller.state.loaderMsg && <LoadingOverlay message={controller.state.loaderMsg} />}

      <a className="mf-login-brand" href="https://geurio.com/">
        <img src="/brand/geurio-logo-120.png" alt="" width={26} height={26} style={{ borderRadius: 8, display: 'block' }} />
        <span style={{ fontSize: 16.5, fontWeight: 800, letterSpacing: '-.025em' }}>Geurio</span>
      </a>

      <div className="mf-login-row">
        <div className="mf-login-col">
          <div className="mf-login-head">
            <span style={{ fontFamily: AUTH.mono, fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: AUTH.eyebrow }}>{view.eyebrow}</span>
            <h1 style={{ margin: 0, fontSize: 'clamp(27px, 3.2vw, 33px)', lineHeight: 1.2, fontWeight: 800, letterSpacing: '-.038em' }}>{view.heading}</h1>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.65, color: AUTH.sub }}>{view.subheading}</p>
          </div>

          <div className="mf-login-form">
            {view.formVisible && <FormStep controller={controller} view={view} />}
            {view.verifyVisible && <VerifyStep controller={controller} view={view} />}
            {view.forgotVisible && <ForgotStep controller={controller} view={view} />}
            {view.forgotVerifyVisible && <ForgotVerifyStep controller={controller} view={view} />}
          </div>

          {/* 법적 링크는 로그인 전에도 보여야 한다(Google 브랜드 인증이 진입
              화면에서 개인정보처리방침에 닿는지 확인한다). 새 탭으로 여는 이유는
              입력하던 값·진행 중인 단계를 잃지 않기 위해서다. */}
          <div className="mf-login-foot">
            <span style={{ fontFamily: AUTH.mono, fontSize: 10.5, color: AUTH.faint3 }}>© 2026 Geurio</span>
            <a href="/privacy" target="_blank" rel="noreferrer" style={{ fontSize: 11.5, color: AUTH.faint }}>
              개인정보처리방침
            </a>
            <a href="/terms" target="_blank" rel="noreferrer" style={{ fontSize: 11.5, color: AUTH.faint }}>
              이용약관
            </a>
          </div>
        </div>

        {!narrow && <AuthPeek />}
      </div>
    </div>
  );
}

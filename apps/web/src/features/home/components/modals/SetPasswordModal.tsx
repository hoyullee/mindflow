import type { HomeState } from '../../types';
import type { HomeController } from '../../useHomeController';

interface Props {
  state: HomeState;
  controller: HomeController;
}

const inputStyle = {
  width: '100%',
  height: 44,
  border: '1px solid var(--mf-border)',
  borderRadius: 11,
  background: 'var(--mf-panel2)',
  color: 'var(--mf-text)',
  fontFamily: 'inherit',
  fontSize: 14,
  padding: '0 13px',
  outline: 'none',
  boxSizing: 'border-box' as const,
};

/**
 * 설정 → 로그인 수단 → **비밀번호 설정**(Google로 가입한 계정).
 *
 * `ChangePasswordModal`과 다른 점은 **본인 확인 방법**이다: 확인할 현재 비밀번호가
 * 없으므로 계정 이메일로 코드를 보내 "이 메일함의 주인인가"로 확인한다(Supabase
 * `reauthenticate()` → `updateUser({ password, nonce })`, backend.md §16).
 *
 * 세션만 있으면 비밀번호를 걸 수 있게 두면 공용 PC에 남은 로그인으로 남이 두 번째
 * 출입구를 만들 수 있다 — 그래서 코드 단계를 뺄 수 없다.
 *
 * 모달을 열면 코드를 **곧바로 보낸다**(따로 누르게 하면 한 단계가 늘 뿐이다).
 */
export function SetPasswordModal({ state, controller }: Props) {
  const busy = state.setPwBusy;
  const done = state.setPwDone;
  // 세 칸이 채워지면 누를 수 있다 — 4자 미만·불일치는 누른 뒤 그 자리에서 말한다
  // (비밀번호 변경 모달과 같은 규칙).
  const canSubmit = !busy && !!state.setPwCode && !!state.setPwNew && !!state.setPwNew2;
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      controller.submitSetPassword();
    } else if (e.key === 'Escape') {
      controller.closeSetPassword();
    }
  };
  return (
    <div
      // 배경 클릭으로 닫지 않는다 — 입력하던 값이 사라지면 안 된다(입력 모달 공통).
      style={{ position: 'fixed', inset: 0, background: 'rgba(30,20,14,.42)', backdropFilter: 'blur(2px)', display: state.setPwOpen ? 'flex' : 'none', alignItems: 'center', justifyContent: 'center', zIndex: 170 }}
    >
      <div role="dialog" aria-label="비밀번호 설정" onClick={(e) => e.stopPropagation()} style={{ width: 400, maxWidth: 'calc(100vw - 32px)', background: 'var(--mf-panel)', borderRadius: 16, boxShadow: '0 24px 60px rgba(0,0,0,.28)', padding: 26, animation: 'mf-fade .2s ease' }}>
        {done ? (
          <>
            <div data-set-pw-done style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <span style={{ width: 40, height: 40, borderRadius: 999, background: 'var(--mf-success-soft)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--mf-success)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m5 13 4 4L19 7" />
                </svg>
              </span>
              <div style={{ fontSize: 17, fontWeight: 800 }}>비밀번호를 설정했어요</div>
            </div>
            <div style={{ fontSize: 13, color: 'var(--mf-muted)', lineHeight: 1.6, marginBottom: 22 }}>
              이제 <b style={{ color: 'var(--mf-text)', fontWeight: 700 }}>이메일과 비밀번호</b>로도 로그인할 수 있어요. Google 로그인도 그대로 쓸 수 있고, 안전을 위해 다른 기기의 로그인은 해제했어요.
            </div>
            <button className="btn" onClick={controller.closeSetPassword} style={{ width: '100%', height: 44, border: 'none', borderRadius: 11, background: 'var(--mf-accent)', color: 'var(--mf-accent-ink)', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
              확인
            </button>
          </>
        ) : (
          <>
            <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>비밀번호 설정</div>
            <div style={{ fontSize: 13, color: 'var(--mf-muted)', lineHeight: 1.6, marginBottom: 20 }}>
              본인 확인을 위해 <b style={{ color: 'var(--mf-text)', fontWeight: 700 }}>{state.userEmail || '계정 이메일'}</b>로 코드를 보냈어요. 메일의 코드를 입력하고 새 비밀번호를 정해 주세요.
            </div>

            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>메일로 받은 코드</div>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              value={state.setPwCode}
              onInput={(e) => controller.onSetPwCode((e.target as HTMLInputElement).value)}
              onKeyDown={onKey}
              aria-label="메일로 받은 코드"
              placeholder="6자리 코드"
              ref={(el) => {
                if (el && state.setPwOpen && !done && document.activeElement !== el && !state.setPwCode) el.focus();
              }}
              style={{ ...inputStyle, marginBottom: 8 }}
            />
            <button
              className="btn"
              data-set-pw-resend
              onClick={controller.resendSetupCode}
              disabled={busy}
              style={{ border: 'none', background: 'transparent', color: 'var(--mf-accent)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, cursor: busy ? 'default' : 'pointer', padding: 0, marginBottom: 14 }}
            >
              코드 다시 보내기
            </button>

            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>새 비밀번호</div>
            <input
              type="password"
              autoComplete="new-password"
              value={state.setPwNew}
              onInput={(e) => controller.onSetPwNew((e.target as HTMLInputElement).value)}
              onKeyDown={onKey}
              aria-label="새 비밀번호"
              placeholder="새 비밀번호 (4자 이상)"
              style={{ ...inputStyle, marginBottom: 14 }}
            />

            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>새 비밀번호 확인</div>
            <input
              type="password"
              autoComplete="new-password"
              value={state.setPwNew2}
              onInput={(e) => controller.onSetPwNew2((e.target as HTMLInputElement).value)}
              onKeyDown={onKey}
              aria-label="새 비밀번호 확인"
              placeholder="새 비밀번호 재입력"
              style={inputStyle}
            />

            {!!state.setPwError && (
              <div data-set-pw-error style={{ marginTop: 12, fontSize: 12.5, color: 'var(--mf-danger)', lineHeight: 1.55 }}>
                {state.setPwError}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
              <button className="btn" onClick={controller.closeSetPassword} style={{ flex: 1, height: 44, border: '1px solid var(--mf-border)', borderRadius: 11, background: 'var(--mf-panel)', color: 'var(--mf-text)', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                취소
              </button>
              <button
                className="btn"
                onClick={controller.submitSetPassword}
                disabled={!canSubmit}
                style={{ flex: 1.4, height: 44, border: 'none', borderRadius: 11, background: canSubmit ? 'var(--mf-accent)' : 'var(--mf-accent-mute)', color: 'var(--mf-accent-ink)', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, cursor: canSubmit ? 'pointer' : 'default' }}
              >
                {busy ? '설정 중…' : '비밀번호 설정'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

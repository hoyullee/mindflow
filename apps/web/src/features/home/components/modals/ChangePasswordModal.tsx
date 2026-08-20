import { useEffect, useRef } from 'react';
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
 * 설정 → 계정 관리 → **비밀번호 변경**.
 *
 * 예전에는 이 화면이 없어서 비밀번호를 바꾸려면 **로그아웃하고** 로그인 화면의
 * '비밀번호 찾기'로 돌아가 메일 코드를 받아야 했다(제보).
 *
 * 현재 비밀번호를 함께 묻는 이유: Supabase는 세션만 있으면 비밀번호를 바꿔 주므로,
 * 공용 PC에 남은 로그인으로 남이 비밀번호를 갈아 계정을 가져가는 것을 막으려면 본인
 * 확인이 필요하다(업계 관례 — `AuthProvider.changePassword`, backend.md §15).
 *
 * 성공하면 완료 화면으로 바뀌며 **다른 기기의 로그인이 해제됐다는 사실**까지 알린다
 * — 어댑터가 실제로 하는 일(`signOut({ scope: 'others' })`)을 사용자가 알아야 한다.
 */
export function ChangePasswordModal({ state, controller }: Props) {
  const busy = state.changePwBusy;
  const done = state.changePwDone;
  // 열릴 때 한 번만 첫 칸에 포커스를 준다 — 인라인 `ref` 콜백은 렌더마다 돌아
  // 다른 칸을 타이핑할 때 포커스를 되가져간다(비밀번호 설정 모달의 제보와 같은 함정).
  const firstFieldRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (state.changePwOpen && !done) firstFieldRef.current?.focus();
  }, [state.changePwOpen, done]);
  // 세 칸이 채워지면 **누를 수 있다** — 4자 미만·불일치 같은 이유는 누른 뒤
  // 컨트롤러가 그 자리에서 말한다(이유를 모르는 채 비활성인 버튼을 두지 않는다).
  const canSubmit = !busy && !!state.changePwCur && !!state.changePwNew && !!state.changePwNew2;
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      controller.submitChangePassword();
    } else if (e.key === 'Escape') {
      controller.closeChangePassword();
    }
  };
  return (
    <div
      // 배경 클릭으로 닫지 않는다 — 입력하던 값이 사라지면 안 된다(다른 입력 모달과 같은 규칙).
      style={{ position: 'fixed', inset: 0, background: 'rgba(30,20,14,.42)', backdropFilter: 'blur(2px)', display: state.changePwOpen ? 'flex' : 'none', alignItems: 'center', justifyContent: 'center', zIndex: 170 }}
    >
      <div role="dialog" aria-label="비밀번호 변경" onClick={(e) => e.stopPropagation()} style={{ width: 400, maxWidth: 'calc(100vw - 32px)', background: 'var(--mf-panel)', borderRadius: 16, boxShadow: '0 24px 60px rgba(0,0,0,.28)', padding: 26, animation: 'mf-fade .2s ease' }}>
        {done ? (
          <>
            <div data-change-pw-done style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <span style={{ width: 40, height: 40, borderRadius: 999, background: 'var(--mf-success-soft)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--mf-success)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m5 13 4 4L19 7" />
                </svg>
              </span>
              <div style={{ fontSize: 17, fontWeight: 800 }}>비밀번호를 변경했어요</div>
            </div>
            <div style={{ fontSize: 13, color: 'var(--mf-muted)', lineHeight: 1.6, marginBottom: 22 }}>
              다음 로그인부터 새 비밀번호를 쓰세요. 안전을 위해 <b style={{ color: 'var(--mf-text)', fontWeight: 700 }}>다른 기기의 로그인은 해제</b>했어요 — 이 기기는 그대로 쓸 수 있어요.
            </div>
            <button className="btn" onClick={controller.closeChangePassword} style={{ width: '100%', height: 44, border: 'none', borderRadius: 11, background: 'var(--mf-accent)', color: 'var(--mf-accent-ink)', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
              확인
            </button>
          </>
        ) : (
          <>
            <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>비밀번호 변경</div>
            <div style={{ fontSize: 13, color: 'var(--mf-muted)', lineHeight: 1.6, marginBottom: 20 }}>본인 확인을 위해 현재 비밀번호를 함께 입력해 주세요.</div>

            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>현재 비밀번호</div>
            <input
              type="password"
              autoComplete="current-password"
              value={state.changePwCur}
              onInput={(e) => controller.onChangePwCur((e.target as HTMLInputElement).value)}
              onKeyDown={onKey}
              aria-label="현재 비밀번호"
              placeholder="현재 비밀번호"
              ref={firstFieldRef}
              style={{ ...inputStyle, marginBottom: 14 }}
            />

            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>새 비밀번호</div>
            <input
              type="password"
              autoComplete="new-password"
              value={state.changePwNew}
              onInput={(e) => controller.onChangePwNew((e.target as HTMLInputElement).value)}
              onKeyDown={onKey}
              aria-label="새 비밀번호"
              placeholder="새 비밀번호 (4자 이상)"
              style={{ ...inputStyle, marginBottom: 14 }}
            />

            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>새 비밀번호 확인</div>
            <input
              type="password"
              autoComplete="new-password"
              value={state.changePwNew2}
              onInput={(e) => controller.onChangePwNew2((e.target as HTMLInputElement).value)}
              onKeyDown={onKey}
              aria-label="새 비밀번호 확인"
              placeholder="새 비밀번호 재입력"
              style={inputStyle}
            />

            {!!state.changePwError && (
              <div data-change-pw-error style={{ marginTop: 12, fontSize: 12.5, color: 'var(--mf-danger)', lineHeight: 1.55 }}>
                {state.changePwError}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
              <button className="btn" onClick={controller.closeChangePassword} style={{ flex: 1, height: 44, border: '1px solid var(--mf-border)', borderRadius: 11, background: 'var(--mf-panel)', color: 'var(--mf-text)', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                취소
              </button>
              <button
                className="btn"
                onClick={controller.submitChangePassword}
                disabled={!canSubmit}
                style={{ flex: 1.4, height: 44, border: 'none', borderRadius: 11, background: canSubmit ? 'var(--mf-accent)' : 'var(--mf-accent-mute)', color: 'var(--mf-accent-ink)', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, cursor: canSubmit ? 'pointer' : 'default' }}
              >
                {busy ? '변경 중…' : '비밀번호 변경'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

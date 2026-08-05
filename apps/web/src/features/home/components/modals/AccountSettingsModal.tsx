import type { HomeController } from '../../useHomeController';
import { ProfileAvatar } from '../ProfileAvatar';
import type { HomeState } from '../../types';
import { HOME_THEMES, HOME_THEME_KEYS } from '../../theme';

interface Props {
  state: HomeState;
  controller: HomeController;
}

/** 설정 (account settings) modal — opened from the profile popover's "설정" row.
 * Shows the signed-in account and hosts the destructive "회원 탈퇴" entry, kept
 * in its own bottom "계정 관리" section so it never sits next to routine actions. */
export function AccountSettingsModal({ state, controller }: Props) {
  const visible = state.accountSettingsOpen;
  const initial = (state.userName || 'M').trim().charAt(0).toUpperCase() || 'M';

  return (
    <div
      onClick={controller.closeAccountSettings}
      style={{ position: 'fixed', inset: 0, background: 'rgba(30,20,14,.42)', backdropFilter: 'blur(2px)', display: visible ? 'flex' : 'none', alignItems: 'center', justifyContent: 'center', zIndex: 150 }}
    >
      <div
        role="dialog"
        aria-label="설정"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 420, maxWidth: 'calc(100vw - 32px)', background: 'var(--mf-panel)', borderRadius: 18, boxShadow: '0 24px 60px rgba(0,0,0,.28)', overflow: 'hidden', animation: 'mf-fade .2s ease' }}
      >
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '18px 20px', borderBottom: '1px solid var(--mf-hairline)' }}>
          <div style={{ fontSize: 17, fontWeight: 800 }}>설정</div>
          <button
            className="btn"
            aria-label="닫기"
            onClick={controller.closeAccountSettings}
            style={{ marginLeft: 'auto', width: 32, height: 32, border: 'none', borderRadius: 9, background: 'var(--mf-panel2)', color: 'var(--mf-subtext)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div style={{ padding: 20 }}>
          {/* account */}
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--mf-faint)', letterSpacing: '.02em', marginBottom: 10 }}>계정</div>
          {/* Read-only account summary — profile-name editing lives in the profile
              popover's "프로필명 변경" button, not here. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, borderRadius: 13, background: 'var(--mf-panel2)', marginBottom: 22 }}>
            <ProfileAvatar initial={initial} avatarUrl={state.userAvatar} size={44} radius={13} fontSize={20} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{state.userName}</div>
              {state.userEmail && <div style={{ fontSize: 12, color: 'var(--mf-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>{state.userEmail}</div>}
            </div>
          </div>

          {/* 색상 테마 — LNB 최하단에 있다가 사용자 요청으로 이리 왔다(설정에 모으는 게
              자연스럽다). 적용 버튼 없이 **누르는 즉시** 뒤 화면까지 색이 바뀐다 —
              모달이 열린 채로 고르므로 고르는 것이 곧 미리보기다. */}
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--mf-faint)', letterSpacing: '.02em', marginBottom: 10 }}>색상 테마</div>
          <div role="radiogroup" aria-label="색상 테마 선택" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 22 }}>
            {HOME_THEME_KEYS.map((key) => {
              const t = HOME_THEMES[key];
              const on = state.theme === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={`${t.label} 테마`}
                  onClick={() => controller.setTheme(key)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 9,
                    minHeight: 44,
                    padding: '0 10px',
                    borderRadius: 11,
                    // 선택된 칸만 강조색 테두리 — 다른 칸은 평범한 경계.
                    border: `1.5px solid ${on ? t.accent : 'var(--mf-border)'}`,
                    background: on ? 'var(--mf-accent-soft)' : 'var(--mf-panel)',
                    color: on ? 'var(--mf-accent-strong)' : 'var(--mf-subtext)',
                    fontFamily: 'inherit',
                    fontSize: 13,
                    fontWeight: on ? 700 : 500,
                    cursor: 'pointer',
                  }}
                >
                  {/* 미리보기 칩 — 그 테마의 면 위에 강조색 점. 이름만으로는
                      "모노"·"다크"가 얼마나 다른지 알 수 없다. */}
                  <span style={{ width: 20, height: 20, borderRadius: 7, flexShrink: 0, background: t.bg, border: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ width: 11, height: 11, borderRadius: '50%', background: t.accent, display: 'block' }} />
                  </span>
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* account management (account deletion lives here) */}
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--mf-faint)', letterSpacing: '.02em', marginBottom: 10 }}>계정 관리</div>
          <div
            className="menu-row"
            role="button"
            tabIndex={0}
            onClick={controller.askDeleteAccount}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                controller.askDeleteAccount();
              }
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, borderRadius: 13, border: '1px solid var(--mf-danger-line)', background: 'var(--mf-danger-bg)', cursor: 'pointer' }}
          >
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--mf-danger-soft)', color: 'var(--mf-danger)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--mf-danger)' }}>회원 탈퇴</div>
              <div style={{ fontSize: 12, color: 'var(--mf-muted)' }}>계정과 모든 맵·스페이스가 영구 삭제돼요</div>
            </div>
            <div style={{ marginLeft: 'auto', color: 'var(--mf-faint)', fontSize: 16, flexShrink: 0 }}>›</div>
          </div>

          {/* legal docs — the only logged-in entry point (the other lives on the
              login page footer). New tab so the modal/home state isn't lost. */}
          <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--mf-hairline)', display: 'flex', justifyContent: 'center', gap: 14, fontSize: 12 }}>
            <a href="/privacy" target="_blank" rel="noreferrer" style={{ color: 'var(--mf-faint)' }}>
              개인정보처리방침
            </a>
            <a href="/terms" target="_blank" rel="noreferrer" style={{ color: 'var(--mf-faint)' }}>
              이용약관
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

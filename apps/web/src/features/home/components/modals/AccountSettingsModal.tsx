import type { HomeController } from '../../useHomeController';
import { ProfileAvatar, avatarLabel } from '../ProfileAvatar';
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
  const initial = avatarLabel(state.userName);

  return (
    <div
      onClick={controller.closeAccountSettings}
      style={{ position: 'fixed', inset: 0, background: 'rgba(30,20,14,.42)', backdropFilter: 'blur(2px)', display: visible ? 'flex' : 'none', alignItems: 'center', justifyContent: 'center', zIndex: 150 }}
    >
      <div
        role="dialog"
        aria-label="설정"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 560, maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100dvh - 32px)', overflowY: 'auto', background: 'var(--mf-card)', borderRadius: 22, boxShadow: '0 32px 70px -28px rgba(46,42,38,.5)', animation: 'mf-fade .2s ease' }}
      >
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '20px 24px', borderBottom: '1px solid var(--mf-hairline)' }}>
          <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-.02em' }}>설정</div>
          <button
            className="btn mf-ctl"
            aria-label="닫기"
            onClick={controller.closeAccountSettings}
            style={{ marginLeft: 'auto', width: 36, height: 36, border: '1px solid var(--mf-border)', borderRadius: 999, background: 'var(--mf-panel2)', color: 'var(--mf-subtext)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, flexShrink: 0 }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div style={{ padding: 24 }}>
          {/* account */}
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--mf-faint)', letterSpacing: '.02em', marginBottom: 10 }}>계정</div>
          {/* Read-only account summary — profile-name editing lives in the profile
              popover's "프로필명 변경" button, not here. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: 16, borderRadius: 16, background: 'var(--mf-accent-soft)', marginBottom: 24 }}>
            <ProfileAvatar initial={initial} avatarUrl={state.userAvatar} size={56} radius={16} fontSize={17} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 800, fontSize: 16.5, letterSpacing: '-.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{state.userName}</div>
              {state.userEmail && <div style={{ fontSize: 13, color: 'var(--mf-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 3 }}>{state.userEmail}</div>}
            </div>
          </div>

          {/* 색상 테마 — LNB 최하단에 있다가 사용자 요청으로 이리 왔다(설정에 모으는 게
              자연스럽다). 적용 버튼 없이 **누르는 즉시** 뒤 화면까지 색이 바뀐다 —
              모달이 열린 채로 고르므로 고르는 것이 곧 미리보기다. */}
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--mf-faint)', letterSpacing: '.02em', marginBottom: 10 }}>색상 테마</div>
          <div role="radiogroup" aria-label="색상 테마 선택" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 24 }}>
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
                    gap: 10,
                    minHeight: 52,
                    padding: '0 14px',
                    borderRadius: 13,
                    // 선택된 칸만 강조색 테두리 + 옅은 강조 면(첨부 이미지의 코랄 칸).
                    border: `1.5px solid ${on ? t.accent : 'var(--mf-border)'}`,
                    background: on ? 'var(--mf-accent-soft)' : 'var(--mf-card)',
                    color: on ? 'var(--mf-text)' : 'var(--mf-subtext)',
                    fontFamily: 'inherit',
                    fontSize: 13.5,
                    fontWeight: on ? 700 : 600,
                    cursor: 'pointer',
                  }}
                >
                  {/* 미리보기 스와치 — 그 테마의 **면 원** 안에 강조색 점(첨부 이미지).
                      이름만으로는 "모노"·"다크"가 얼마나 다른지 알 수 없다. */}
                  <span style={{ width: 24, height: 24, borderRadius: '50%', flexShrink: 0, background: t.bg, border: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ width: 11, height: 11, borderRadius: '50%', background: t.accent, display: 'block' }} />
                  </span>
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* account management (session revoke + account deletion live here) */}
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--mf-faint)', letterSpacing: '.02em', marginBottom: 10 }}>계정 관리</div>
          {/* 모든 기기에서 로그아웃(세션 정책 ①) — 이 앱의 세션은 기기 수 제한 없이
              오래 유지되므로(backend.md §15), 기기를 잃거나 공용 PC에 남겨 뒀을 때
              **회수할 수단**이 필요하다. 되돌릴 수 있는 동작이라 제목은 잉크색이고
              위험 신호(빨강)는 아래 회원 탈퇴만 쓴다. */}
          <div
            className="menu-row"
            role="button"
            tabIndex={0}
            onClick={controller.logoutAllDevices}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                controller.logoutAllDevices();
              }
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '15px 16px', borderRadius: 14, cursor: 'pointer' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--mf-subtext)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14.5 }}>모든 기기에서 로그아웃</div>
              <div style={{ fontSize: 12.5, color: 'var(--mf-muted)', marginTop: 2 }}>다른 기기·브라우저의 로그인도 모두 해제돼요</div>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--mf-faint)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ marginLeft: 'auto', flexShrink: 0 }}>
              <path d="m9 6 6 6-6 6" />
            </svg>
          </div>
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
            style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '15px 16px', borderRadius: 14, cursor: 'pointer' }}
          >
            {/* 첨부 이미지: 배경 없는 맨 행(요청 — hover의 옅은 면만, `.menu-row`) —
                아이콘 상자 없이 휴지통 아이콘이 바로 서고, 제목은 빨강이 아니라
                잉크. 위험 신호는 아이콘과 부제가 말한다. */}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--mf-danger)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14.5 }}>회원 탈퇴</div>
              <div style={{ fontSize: 12.5, color: 'var(--mf-muted)', marginTop: 2 }}>계정과 모든 보드·스페이스가 영구 삭제돼요</div>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--mf-faint)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ marginLeft: 'auto', flexShrink: 0 }}>
              <path d="m9 6 6 6-6 6" />
            </svg>
          </div>

          {/* legal docs — the only logged-in entry point (the other lives on the
              login page footer). New tab so the modal/home state isn't lost. */}
          <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--mf-hairline)', display: 'flex', justifyContent: 'center', gap: 18, fontSize: 12.5 }}>
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

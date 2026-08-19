import type { HomeController } from '../useHomeController';
import type { HomeState } from '../types';
import { ProfileAvatar } from './ProfileAvatar';

interface Props {
  state: HomeState;
  controller: HomeController;
  userInitial: string;
}

/** Home.dc.html:71-99 — account avatar/name button + its dropdown (rename, logout). */
export function SettingsPopover({ state, controller, userInitial }: Props) {
  // 세션이 아직 안 풀렸으면 프로필 블록은 스켈레톤 — 'mine'/'M' 플레이스홀더가
  // 실제 이름/아바타로 바뀌며 깜빡이던 것을 막는다(맵 그리드·스페이스 목록의
  // 스켈레톤과 같은 패턴). 같은 크기(아바타 30 + 이름 줄, padding 8)로 그려
  // 레이아웃 이동도 없다.
  if (!state.profileLoaded) {
    return (
      <div style={{ position: 'relative', marginBottom: 10 }} aria-busy="true" aria-label="프로필을 불러오는 중">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 8 }}>
          <span className="mf-skel" style={{ width: 32, height: 32, borderRadius: 11, flexShrink: 0 }} />
          <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span className="mf-skel" style={{ height: 12, width: 78, borderRadius: 6 }} />
            <span className="mf-skel" style={{ height: 9, width: 104, borderRadius: 5 }} />
          </span>
        </div>
      </div>
    );
  }
  return (
    <div style={{ position: 'relative', marginBottom: 10 }}>
      <div
        className="nav-item settings-btn"
        role="button"
        tabIndex={0}
        aria-label="계정 메뉴"
        onClick={controller.toggleSettings}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            controller.toggleSettings();
          }
        }}
        // 디자인 원본: 32px 아바타 + [이름 / 부제] 두 줄 + 셰브론. 테두리는 투명이지만
        // hover에서 옅은 면이 깔린다(`.nav-item:hover`).
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 8, borderRadius: 13, border: '1px solid transparent', cursor: 'pointer', width: '100%', textAlign: 'left' }}
      >
        <ProfileAvatar initial={userInitial} avatarUrl={state.userAvatar} size={32} radius={11} fontSize={12} />
        <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: 1 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, letterSpacing: '-.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{state.userName}</span>
          {/* 부제 — 디자인 원본의 "개인 워크스페이스" 자리에 **로그인한 계정**을 적는다.
              우리에겐 워크스페이스 개념이 없고(스페이스가 그 층이다), 이 자리에서
              가장 알고 싶은 것은 "지금 어떤 계정으로 들어와 있는가"다. */}
          <span style={{ fontSize: 11, color: 'var(--mf-faint)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{state.userEmail || '내 워크스페이스'}</span>
        </span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--mf-faint)" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true" style={{ flexShrink: 0 }}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </div>

      <div
        className="settings-pop"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          top: 'calc(100% + 6px)',
          left: 0,
          width: 236,
          background: 'var(--mf-panel)',
          border: '1px solid var(--mf-border)',
          borderRadius: 14,
          boxShadow: '0 12px 32px rgba(0,0,0,.16)',
          padding: 0,
          zIndex: 40,
          overflow: 'hidden',
          display: state.settingsOpen ? 'block' : 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 16px 14px', background: 'linear-gradient(135deg,var(--mf-accent-soft),var(--mf-panel2))', borderRadius: '14px 14px 0 0' }}>
          <ProfileAvatar initial={userInitial} avatarUrl={state.userAvatar} size={44} radius={13} fontSize={20} boxShadow="0 4px 10px rgba(var(--mf-accent-rgb),.25)" />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--mf-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{state.userName}</div>
            {state.userEmail && <div style={{ fontSize: 12, color: 'var(--mf-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{state.userEmail}</div>}
          </div>
        </div>
        <div style={{ padding: 6 }}>
          {/* profile-name rename — opens the "프로필명 변경" popup (like 스페이스 이름 변경) */}
          <div
            className="menu-row"
            role="button"
            tabIndex={0}
            aria-label="프로필명 변경"
            onClick={controller.openProfileNameEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                controller.openProfileNameEdit();
              }
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 12px', borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: 'var(--mf-text)' }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
            </svg>{' '}
            프로필명 변경
          </div>
          <div
            className="menu-row"
            role="button"
            tabIndex={0}
            onClick={controller.openAccountSettings}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                controller.openAccountSettings();
              }
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 12px', borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: 'var(--mf-text)' }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>{' '}
            설정
          </div>
          <div
            className="menu-row"
            role="button"
            tabIndex={0}
            onClick={controller.logout}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                controller.logout();
              }
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 12px', borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: 'var(--mf-danger)' }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>{' '}
            로그아웃
          </div>
        </div>
      </div>
    </div>
  );
}

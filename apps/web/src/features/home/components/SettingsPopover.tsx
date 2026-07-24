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
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: 8 }}>
          <span className="mf-skel" style={{ width: 30, height: 30, borderRadius: 9, flexShrink: 0 }} />
          <span className="mf-skel" style={{ height: 13, width: 88, borderRadius: 6 }} />
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
        style={{ display: 'flex', alignItems: 'center', gap: 9, padding: 8, borderRadius: 10, cursor: 'pointer' }}
      >
        <ProfileAvatar initial={userInitial} avatarUrl={state.userAvatar} size={30} radius={9} fontSize={16} />
        <div style={{ fontWeight: 700, fontSize: 15 }}>{state.userName}</div>
        <div style={{ marginLeft: 'auto', color: '#9c8b7e', fontSize: 12 }}>▾</div>
      </div>

      <div
        className="settings-pop"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          top: 'calc(100% + 6px)',
          left: 0,
          width: 236,
          background: '#fff',
          border: '1px solid #ecdfd5',
          borderRadius: 14,
          boxShadow: '0 12px 32px rgba(0,0,0,.16)',
          padding: 0,
          zIndex: 40,
          overflow: 'hidden',
          display: state.settingsOpen ? 'block' : 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 16px 14px', background: 'linear-gradient(135deg,#fdeee7,#faf3ee)', borderRadius: '14px 14px 0 0' }}>
          <ProfileAvatar initial={userInitial} avatarUrl={state.userAvatar} size={44} radius={13} fontSize={20} boxShadow="0 4px 10px rgba(240,102,63,.25)" />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#33281f', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{state.userName}</div>
            {state.userEmail && <div style={{ fontSize: 12, color: '#9c8b7e', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{state.userEmail}</div>}
          </div>
        </div>
        <div style={{ padding: 6 }}>
          {/* profile-name rename — opens the "프로필명 변경" popup (like 공간 이름 변경) */}
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
            style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 12px', borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#33281f' }}
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
            style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 12px', borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#33281f' }}
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
            style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 12px', borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#d64545' }}
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

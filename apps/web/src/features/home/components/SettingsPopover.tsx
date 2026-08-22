import type { HomeController } from '../useHomeController';
import type { HomeState } from '../types';
import { Popover, TRIGGER_WIDTH } from '../../../components/Popover';
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
  // 트리거는 **진짜 버튼**이다 — 예전에는 `div role="button"`에 tabIndex와
  // Enter/Space 핸들러를 손으로 달았다(초점·키보드는 버튼이 공짜로 준다).
  const trigger = (
    <button
      type="button"
      className="nav-item settings-btn"
      aria-label="계정 메뉴"
      data-account-trigger
      // 디자인 개정(첨부 이미지): 36px 잉크색 아바타 + 열림에 따라 도는 셰브론.
      // 테두리·면 없음(요청) — hover의 옅은 면(`.nav-item:hover`)만 반응한다.
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 8, borderRadius: 14, cursor: 'pointer', width: '100%', textAlign: 'left', border: 'none', background: 'none', font: 'inherit', color: 'inherit' }}
    >
        <ProfileAvatar initial={userInitial} avatarUrl={state.userAvatar} size={36} radius={12} fontSize={13} />
        <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: 1 }}>
          <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: '-.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{state.userName}</span>
          {/* 부제 — 디자인 원본의 "개인 워크스페이스" 자리에 **로그인한 계정**을 적는다.
              우리에겐 워크스페이스 개념이 없고(스페이스가 그 층이다), 이 자리에서
              가장 알고 싶은 것은 "지금 어떤 계정으로 들어와 있는가"다. */}
          <span style={{ fontSize: 11.5, color: 'var(--mf-faint)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{state.userEmail || '내 워크스페이스'}</span>
        </span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--mf-faint)" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true" style={{ flexShrink: 0, transform: state.settingsOpen ? 'rotate(180deg)' : 'none', transition: 'transform .16s ease' }}>
          <path d="m6 9 6 6 6-6" />
        </svg>
    </button>
  );

  return (
    <div style={{ marginBottom: 10 }}>
      <Popover
        open={state.settingsOpen}
        onOpenChange={(next) => {
          if (next !== state.settingsOpen) controller.toggleSettings();
        }}
        trigger={trigger}
        panelClass="settings-pop mf-pop-anim"
        panel={{
          // 폭은 트리거(프로필 행)에 맞춘다 — 예전에는 `left:0; right:0`으로
          // 부모에 맞췄다(부모가 곧 트리거일 때만 성립하던 방식).
          width: TRIGGER_WIDTH,
          boxSizing: 'border-box',
          background: 'var(--mf-card)',
          border: '1px solid var(--mf-border)',
          borderRadius: 16,
          boxShadow: '0 22px 48px -20px rgba(46,42,38,.4), 0 2px 6px rgba(46,42,38,.06)',
          padding: 0,
          zIndex: 40,
          overflow: 'hidden',
          transformOrigin: 'top center',
        }}
      >
        {/* 머리 — 팝업 가장자리에서 띄운 **인셋 블록**(accent-soft, 첨부 이미지). */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: 8, padding: 12, background: 'var(--mf-accent-soft)', borderRadius: 12 }}>
          <ProfileAvatar initial={userInitial} avatarUrl={state.userAvatar} size={44} radius={13} fontSize={16} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--mf-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{state.userName}</div>
            {state.userEmail && <div style={{ fontSize: 12, color: 'var(--mf-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{state.userEmail}</div>}
          </div>
        </div>
        <div style={{ padding: '2px 6px 6px' }}>
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
          <div aria-hidden="true" style={{ height: 1, background: 'var(--mf-hairline)', margin: '6px 8px' }} />
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
      </Popover>
    </div>
  );
}

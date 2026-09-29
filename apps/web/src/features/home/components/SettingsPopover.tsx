import type { ReactNode } from 'react';
import type { HomeController } from '../useHomeController';
import type { HomeState } from '../types';
import { Popover, TRIGGER_WIDTH } from '../../../components/Popover';
import { ProfileAvatar } from './ProfileAvatar';

interface Props {
  state: HomeState;
  controller: HomeController;
  userInitial: string;
}

/**
 * LNB **맨 아래 고정**의 프로필 카드 + 위로 열리는 계정 메뉴(스펙: 홈·LNB 변경 4·5).
 *
 * 예전에는 LNB 맨 위에 섰다. 자리를 옮긴 이유: 위는 **매일 보는 것**(알림·일정)의 자리이고,
 * 계정은 가끔 여는 것이다 — Slack·Linear·Notion이 프로필을 바닥에 두는 것과 같은 판단.
 * 바닥에 서므로 메뉴는 **위로** 열린다(아래로 열면 화면 밖이다).
 */
export function SettingsPopover({ state, controller, userInitial }: Props) {
  // 세션이 아직 안 풀렸으면 프로필 블록은 스켈레톤 — 'mine'/'M' 플레이스홀더가
  // 실제 이름/아바타로 바뀌며 깜빡이던 것을 막는다(맵 그리드·스페이스 목록의
  // 스켈레톤과 같은 패턴). 같은 크기(아바타 30 + 이름 줄, padding 6/8)로 그려
  // 레이아웃 이동도 없다.
  if (!state.profileLoaded) {
    return (
      <div aria-busy="true" aria-label="프로필을 불러오는 중" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', border: '1px solid transparent' }}>
        <span className="mf-skel" style={{ width: 30, height: 30, borderRadius: 10, flexShrink: 0 }} />
        <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span className="mf-skel" style={{ height: 12, width: 72, borderRadius: 6 }} />
          <span className="mf-skel" style={{ height: 9, width: 104, borderRadius: 5 }} />
        </span>
      </div>
    );
  }
  const open = state.settingsOpen;
  // 트리거는 **진짜 버튼**이다 — 초점·키보드(Enter/Space)를 버튼이 공짜로 준다.
  const trigger = (
    <button
      type="button"
      className="nav-item settings-btn"
      aria-label="계정 메뉴"
      data-account-trigger
      data-open={open ? '1' : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        padding: '6px 8px',
        borderRadius: 13,
        // 열린 동안만 테두리 + 옅은 면 — 메뉴가 어디서 나왔는지 짚어 준다(스펙).
        // 닫혀 있을 때도 1px을 **투명으로** 두는 이유: 열고 닫을 때 글자가 1px씩 움직이지 않게.
        border: `1px solid ${open ? 'var(--mf-border-soft)' : 'transparent'}`,
        background: open ? 'var(--mf-panel2)' : 'none',
        cursor: 'pointer',
        textAlign: 'left',
        font: 'inherit',
        color: 'inherit',
        boxSizing: 'border-box',
      }}
    >
      <ProfileAvatar initial={userInitial} avatarUrl={state.userAvatar} size={30} radius={10} fontSize={11.5} gradient />
      <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: 1 }}>
        <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '-.01em', color: 'var(--mf-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{state.userName}</span>
        {/* 부제 — **로그인한 계정**. 우리에겐 워크스페이스 개념이 없고(스페이스가 그 층이다),
            이 자리에서 가장 알고 싶은 것은 "지금 어떤 계정으로 들어와 있는가"다. */}
        <span style={{ fontSize: 10.5, color: 'var(--mf-faint)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{state.userEmail || '내 워크스페이스'}</span>
      </span>
      {/* **위를 가리키는** 캐럿 — 메뉴가 위로 열린다는 약속. 열리면 뒤집힌다. */}
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--mf-muted)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .16s ease' }}>
        <path d="M6 15l6-6 6 6" />
      </svg>
    </button>
  );

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next !== open) controller.toggleSettings();
      }}
      trigger={trigger}
      side="top"
      sideOffset={6}
      panelClass="settings-pop mf-pop-anim"
      panelAttrs={{ 'data-account-menu': '' }}
      label="계정 메뉴"
      panel={{
        // 폭은 트리거(프로필 카드)에 맞춘다.
        width: TRIGGER_WIDTH,
        boxSizing: 'border-box',
        background: 'var(--mf-card)',
        border: '1px solid var(--mf-border)',
        borderRadius: 16,
        boxShadow: '0 26px 52px -26px rgba(46,42,38,.5)',
        padding: 0,
        zIndex: 40,
        overflow: 'hidden',
        transformOrigin: 'bottom center',
      }}
    >
      {/* 머리 — **면 없이** 이름·이메일 한 줄 + 플랜 알약(스펙). 아바타는 두지 않는다 —
          바로 아래 카드에 이미 있다(같은 얼굴을 두 번 그리면 무엇이 무엇인지 흐려진다). */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px 11px', borderBottom: '1px solid var(--mf-border-soft)' }}>
        <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--mf-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{state.userName}</div>
          {state.userEmail && <div style={{ fontSize: 11, color: 'var(--mf-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{state.userEmail}</div>}
        </div>
        {/* 유료 플랜이 없으니 **모든 계정이 무료 플랜**이다 — 사실을 적은 정적 알약. */}
        <span data-plan-pill style={{ flexShrink: 0, height: 22, padding: '0 9px', display: 'inline-flex', alignItems: 'center', borderRadius: 99, border: '1px solid var(--mf-border)', fontSize: 10.5, fontWeight: 800, color: 'var(--mf-muted)', boxSizing: 'border-box' }}>
          무료 플랜
        </span>
      </div>
      <div style={{ padding: 6, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <MenuItem
          onSelect={controller.openProfileNameFromMenu}
          icon={
            <>
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </>
          }
        >
          프로필명 변경
        </MenuItem>
        <MenuItem
          onSelect={controller.openAccountSettings}
          icon={
            <>
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </>
          }
        >
          설정
        </MenuItem>
        <div aria-hidden="true" style={{ height: 1, background: 'var(--mf-border-soft)', margin: '5px 3px' }} />
        {/* 로그아웃 — 글자·아이콘만 경고 톤, **빨간 면은 없다**(스펙). 되돌릴 수 있는 일이라
            확인 팝업이 한 번 더 묻는다. 스펙의 `⇧⌘Q` 표기는 두지 않는다: 브라우저가 그 키를
            **창 닫기**로 먼저 가져가서(크롬) 웹 페이지에는 오지 않는다 — 누를 수 없는
            단축키를 적어 두면 거짓말이 된다. */}
        <MenuItem
          onSelect={controller.logout}
          danger
          icon={
            <>
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </>
          }
        >
          로그아웃
        </MenuItem>
      </div>
    </Popover>
  );
}

/** 계정 메뉴의 한 줄 — 셋이 같은 값을 쓴다(각자 적으면 곧 갈린다). */
function MenuItem({ icon, children, onSelect, danger = false }: { icon: ReactNode; children: ReactNode; onSelect: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      className="menu-row mf-acct-item"
      onClick={onSelect}
      data-account-item={danger ? 'danger' : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        padding: 9,
        border: 'none',
        borderRadius: 10,
        background: 'transparent',
        font: 'inherit',
        fontSize: 12.5,
        fontWeight: 600,
        textAlign: 'left',
        cursor: 'pointer',
        color: danger ? 'var(--mf-accent-strong)' : 'var(--mf-text)',
      }}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={danger ? 'currentColor' : 'var(--mf-muted)'} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
        {icon}
      </svg>
      {children}
    </button>
  );
}

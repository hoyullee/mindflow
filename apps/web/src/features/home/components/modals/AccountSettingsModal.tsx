import { useLayoutEffect, useRef, useState } from 'react';
import type { HomeController } from '../../useHomeController';
import { ProfileAvatar, avatarLabel } from '../ProfileAvatar';
import type { HomeState } from '../../types';
import { HOME_THEMES, HOME_THEME_KEYS } from '../../theme';
import { RadioCards } from '../../../../components/Segmented';
import { GoogleIcon } from '../../../auth/GoogleIcon';
import { Modal, MODAL_DIM } from '../../../../components/Modal';

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
  // 로그인 수단 — `null`은 확인 불가(RPC 미배포·네트워크·데모 초기). 그때는
  // 비밀번호가 **있다고 보고** 변경 흐름을 내준다(잠그지 않는다).
  // 같은 모달의 세 화면(요청) — 첫 화면은 계정 요약 + 두 진입 행 + 색상 테마이고,
  // 손보는 일은 한 겹 안이다: '프로필 설정'(사진·이름) / '계정 설정'(로그인 수단·
  // 기기 로그아웃·탈퇴). 뒤로 가기는 하나뿐이라 두 화면 모두 첫 화면으로 돌아온다.
  const view = state.settingsView;
  const detail = view !== 'main'; // 뒤로 가기·전환 애니메이션은 "첫 화면인가"만 본다
  // 화면 전환 — 좌우로 밀지 않고 **제자리에서 드러난다**(제보: 글자가 가로로
  // 지나가는데 상자는 세로로 줄어 두 움직임이 어긋나 보였다). 그래서 방향을
  // 기억할 이유가 없어졌다 — "바뀌었는가"만 알면 된다. **처음 열 때는 걸지
  // 않는다**(카드 자체가 이미 페이드로 뜬다).
  const bodyRef = useRef<HTMLDivElement | null>(null);
  /** 숨은 파일 입력 — 아바타 버튼과 '프로필 이미지 변경' 행이 같은 것을 쓴다. */
  const fileRef = useRef<HTMLInputElement | null>(null);
  const fromH = useRef<number | null>(null);
  const prevDetail = useRef(view);
  const [swapped, setSwapped] = useState(false);
  if (prevDetail.current !== view) {
    prevDetail.current = view;
    // 아직 커밋 전 — 여기서 잰 높이가 '바뀌기 전' 높이다(아래 layout effect가 쓴다).
    const box = bodyRef.current?.getBoundingClientRect();
    fromH.current = box ? Math.round(box.height) : null;
    setSwapped(true);
  }
  const viewClass = `mf-settings-view${swapped ? ' is-swap' : ''}`;
  // 높이 잇기 — 바뀌기 **전** 높이는 렌더 단계에서 잡는다(그때 DOM은 아직 이전
  // 화면이다). 커밋 뒤에 재면 이미 새 화면이라 시작값이 목표값과 같아져 아무 일도
  // 일어나지 않는다(뒤로 갈 때 높이가 툭 튀던 원인). 진행 중 반전도 자연스럽게
  // 이어지도록 콘텐츠 높이가 아니라 **지금 보이는 상자 높이**를 잡는다.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    const from = fromH.current;
    fromH.current = null;
    if (!el || !visible || from === null) return;
    const next = el.scrollHeight;
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (from === next || reduce) return;
    el.style.overflow = 'hidden';
    el.style.height = `${from}px`;
    void el.offsetHeight; // 강제 리플로우 — 시작 값을 확정한 뒤 목표로 보낸다
    el.style.transition = 'height .24s cubic-bezier(.4,0,.2,1)';
    el.style.height = `${next}px`;
    const release = () => {
      el.style.height = '';
      el.style.transition = '';
      el.style.overflow = '';
    };
    const timer = setTimeout(release, 280);
    return () => {
      clearTimeout(timer);
      release();
    };
  }, [view, visible]);
  const unknown = state.signin === null;
  const hasPassword = state.signin ? state.signin.hasPassword : true;
  const providers = state.signin?.providers ?? [];
  const googleLinked = providers.includes('google');
  // 해제를 막는 이유는 **둘이고 서로 다르다**(제보: 한 문장에 두 이유가 섞여 어느
  // 쪽인지 알 수 없었다).
  //  ① 서버 규칙 — Supabase는 신원(identity)을 최소 하나 요구한다. Google이 유일한
  //     신원이면 `single_identity_not_deletable`로 거절한다. **비밀번호를 설정해도
  //     신원은 늘지 않는다**(비밀번호는 신원이 아니다) → 그때는 해제 자체가 불가.
  //  ② 우리 규칙 — 다른 신원은 있지만 비밀번호가 없다면 해제해도 들어올 길이 없다
  //     (이 앱에는 메일 코드 로그인이 없다) → 비밀번호를 먼저 설정하게 한다.
  const otherIdentity = providers.some((p) => p !== 'google');
  const unlinkBlock: 'lastIdentity' | 'noPassword' | null = !googleLinked ? null : !otherIdentity ? 'lastIdentity' : !hasPassword ? 'noPassword' : null;

  return (
    <Modal
      open={visible}
      onClose={controller.closeAccountSettings}
      label="설정"
      // 이 모달은 프로필 팝오버의 '설정' 행으로 열리고, 그 팝오버는 모달이 열리면
      // 닫힌다 — 돌아갈 자리가 사라지므로 팝오버의 트리거(계정 메뉴)로 되돌린다.
      restoreFocusSelector="[data-account-trigger]"
      dim={{ ...MODAL_DIM, zIndex: 150 }}
      card={{ width: 560, maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100dvh - 32px)', overflowY: 'auto', background: 'var(--mf-card)', borderRadius: 22, boxShadow: '0 32px 70px -28px rgba(46,42,38,.5)', animation: 'mf-fade .2s ease' }}
    >
      <>
        {/* header — 제목은 언제나 '설정'이고(요청), 상세 화면에서는 뒤로 가기가 붙는다.
            지금 어느 화면인지는 본문 첫 줄의 부 제목('계정 설정')이 말한다. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '20px 24px', borderBottom: '1px solid var(--mf-hairline)' }}>
          {detail && (
            <button
              className="btn mf-ctl"
              aria-label="뒤로"
              onClick={controller.closeSettingsDetail}
              style={{ width: 32, height: 32, border: '1px solid var(--mf-border)', borderRadius: 999, background: 'var(--mf-panel2)', color: 'var(--mf-subtext)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, flexShrink: 0, marginLeft: -4 }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m15 6-6 6 6 6" />
              </svg>
            </button>
          )}
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

        {/* 본문 — 두 화면의 높이가 크게 달라서(첫 화면엔 테마 격자까지) 전환 때
            카드가 툭 줄었다 늘었다 한다. 그 높이도 부드럽게 잇는다(요청):
            바뀌기 전 높이로 고정 → 새 높이로 트랜지션 → 끝나면 auto로 되돌린다
            (`auto`는 전이되지 않으므로 실제 값을 재서 잇는 수밖에 없고, 끝나고
            풀어 줘야 안쪽에서 오류 문구가 늘어나는 것 같은 변화가 다시 살아난다). */}
        <div ref={bodyRef} data-settings-body style={{ padding: 24 }}>
          {view === 'account' ? (
            <div key="detail" className={viewClass}>
          {/* 이 화면의 부 제목(요청) — 헤더는 '설정'을 지키고 여기서 어느 화면인지 말한다.
              아래 앞쪽 두 줄은 이 계정에 들어오는 **문 목록**이다(한 계정에 수단이 여럿
              붙을 수 있고, 같은 이메일의 Google 신원은 Supabase가 자동 연결한다 — §16.
              비밀번호 유무는 신원 목록으로 알 수 없어 서버가 따로 알려 준다 — 0029). */}
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--mf-faint)', letterSpacing: '.02em', marginBottom: 10 }}>계정 설정</div>
          {/* 이메일·비밀번호 — 비밀번호가 걸려 있으면 '변경'(현재 비밀번호로 본인
              확인), 없으면 '설정'(계정 이메일로 코드를 받아 확인). 확인 불가면
              **변경 쪽**으로 둔다: 진짜 게이트는 확인 단계이므로 모르는 채로 항목을
              잠그는 쪽이 더 나쁘다. */}
          <div
            className="menu-row"
            data-change-pw-row
            role="button"
            tabIndex={0}
            onClick={hasPassword ? controller.openChangePassword : controller.openSetPassword}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                (hasPassword ? controller.openChangePassword : controller.openSetPassword)();
              }
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '15px 16px', borderRadius: 14, cursor: 'pointer' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--mf-subtext)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
              <rect x="3.5" y="10.5" width="17" height="10.5" rx="2.5" />
              <path d="M7.5 10.5V7a4.5 4.5 0 0 1 9 0v3.5" />
            </svg>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14.5 }}>{hasPassword ? '비밀번호 변경' : '비밀번호 설정'}</div>
              <div style={{ fontSize: 12.5, color: 'var(--mf-muted)', marginTop: 2 }}>
                {unknown ? '로그인 수단을 확인할 수 없어요 — 현재 비밀번호로 바꿀 수 있어요' : hasPassword ? '현재 비밀번호를 확인한 뒤 새 비밀번호로 바꿔요' : '계정 이메일로 인증번호를 받아 비밀번호를 설정해요'}
              </div>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--mf-faint)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ marginLeft: 'auto', flexShrink: 0 }}>
              <path d="m9 6 6 6-6 6" />
            </svg>
          </div>
          {/* Google — 연결/해제. 해제가 막히는 두 이유(`unlinkBlock`)를 부제가
              **각각** 말한다 — 무엇을 해야 풀리는지가 이유마다 다르다. */}
          <div
            data-google-link-row
            style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '15px 16px', borderRadius: 14 }}
          >
            <span style={{ display: 'flex', flexShrink: 0, width: 18, justifyContent: 'center' }}>
              <GoogleIcon />
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14.5 }}>Google 연동</div>
              <div style={{ fontSize: 12.5, color: 'var(--mf-muted)', marginTop: 2 }}>
                {unknown
                  ? '연결 상태를 확인할 수 없어요'
                  : !googleLinked
                    ? '연결하면 Google 계정으로도 로그인할 수 있어요'
                    : unlinkBlock === 'lastIdentity'
                      ? 'Google이 이 계정의 유일한 로그인 수단이라 해제할 수 없어요'
                      : unlinkBlock === 'noPassword'
                        ? '비밀번호를 먼저 설정해 주세요'
                        : 'Google 계정으로도 로그인할 수 있어요'}
              </div>
            </div>
            <button
              type="button"
              className="btn mf-ctl"
              data-google-link-action
              disabled={unknown || state.signinBusy || unlinkBlock !== null}
              onClick={googleLinked ? controller.askUnlinkGoogle : controller.linkGoogleAccount}
              style={{
                marginLeft: 'auto',
                flexShrink: 0,
                height: 34,
                padding: '0 14px',
                border: '1px solid var(--mf-border)',
                borderRadius: 999,
                background: 'var(--mf-panel2)',
                color: 'var(--mf-text)',
                fontFamily: 'inherit',
                fontSize: 13,
                fontWeight: 700,
                cursor: unknown || state.signinBusy || unlinkBlock !== null ? 'default' : 'pointer',
                opacity: unknown || state.signinBusy || unlinkBlock !== null ? 0.5 : 1,
              }}
            >
              {googleLinked ? '연결 해제' : '연결'}
            </button>
          </div>
          {!!state.signinError && (
            <div data-signin-error style={{ fontSize: 12.5, color: 'var(--mf-danger)', padding: '0 16px 8px' }}>
              {state.signinError}
            </div>
          )}

          {/* 세션·탈퇴 — 제목 없이 이어진다(요청). 성격이 다른 묶음이라 사이만 띄운다. */}
          <div style={{ height: 10 }} />
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

            </div>
          ) : view === 'profile' ? (
            <div key="profile" className={viewClass}>
          {/* 이 화면의 부 제목 — 헤더는 '설정'을 지킨다(계정 설정과 같은 문법). */}
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--mf-faint)', letterSpacing: '.02em', marginBottom: 10 }}>프로필 설정</div>
          {/* 아바타를 누르면 곧바로 파일을 고른다 — 아래 행과 같은 입력을 쓴다. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: 16, borderRadius: 16, background: 'var(--mf-accent-soft)', marginBottom: 14 }}>
            <button
              type="button"
              data-avatar-pick
              aria-label="프로필 이미지 변경"
              title="프로필 이미지 변경"
              disabled={state.avatarBusy}
              onClick={() => fileRef.current?.click()}
              style={{ position: 'relative', border: 0, background: 'transparent', padding: 0, cursor: state.avatarBusy ? 'default' : 'pointer', lineHeight: 0, borderRadius: 16, flexShrink: 0 }}
            >
              <ProfileAvatar initial={initial} avatarUrl={state.userAvatar} size={56} radius={16} fontSize={17} />
              {/* 카메라 배지 — 아바타 자체가 버튼이라는 것을 알려 준다(관례). */}
              <span
                aria-hidden="true"
                style={{ position: 'absolute', right: -3, bottom: -3, width: 22, height: 22, borderRadius: 999, background: 'var(--mf-card)', border: '1px solid var(--mf-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 6px rgba(46,42,38,.18)' }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--mf-subtext)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 8.5A2 2 0 0 1 6 6.5h1.6l1-1.6h4.8l1 1.6H18a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
                  <circle cx="12" cy="12.6" r="3" />
                </svg>
              </span>
            </button>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 800, fontSize: 16.5, letterSpacing: '-.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{state.userName}</div>
              {state.userEmail && <div style={{ fontSize: 13, color: 'var(--mf-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 3 }}>{state.userEmail}</div>}
            </div>
          </div>

          {/* 파일 고르기는 숨은 input 하나로 — 아바타 버튼과 아래 행이 같은 것을 쓴다. */}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            data-avatar-input
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              e.target.value = ''; // 같은 파일을 다시 골라도 change가 오게
              void controller.changeAvatar(f);
            }}
          />

          <div
            className="menu-row"
            data-avatar-row
            role="button"
            tabIndex={0}
            aria-disabled={state.avatarBusy}
            onClick={() => !state.avatarBusy && fileRef.current?.click()}
            onKeyDown={(e) => {
              if ((e.key === 'Enter' || e.key === ' ') && !state.avatarBusy) {
                e.preventDefault();
                fileRef.current?.click();
              }
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '15px 16px', borderRadius: 14, cursor: state.avatarBusy ? 'default' : 'pointer' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--mf-subtext)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
              <rect x="3" y="5" width="18" height="14" rx="2.5" />
              <circle cx="8.5" cy="10" r="1.4" />
              <path d="m5 17 5-4.5 4 3.5 3-2.5 3 3" />
            </svg>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14.5 }}>프로필 이미지 변경</div>
              <div data-avatar-hint style={{ fontSize: 12.5, color: state.avatarError ? 'var(--mf-danger)' : 'var(--mf-muted)', marginTop: 2 }}>
                {state.avatarBusy ? '올리는 중이에요…' : (state.avatarError ?? '정사각형으로 잘려 함께 쓰는 화면에도 보여요')}
              </div>
            </div>
            {/* 지우기는 사진이 있을 때만 — 없으면 눌러도 아무 일이 없다. */}
            {state.userAvatar && !state.avatarBusy && (
              <button
                type="button"
                data-avatar-remove
                onClick={(e) => {
                  e.stopPropagation();
                  void controller.removeAvatar();
                }}
                style={{ marginLeft: 'auto', flexShrink: 0, height: 32, padding: '0 12px', borderRadius: 9, border: '1px solid var(--mf-border)', background: 'var(--mf-card)', color: 'var(--mf-subtext)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}
              >
                기본으로
              </button>
            )}
          </div>

          <div
            className="menu-row"
            data-profile-name-row
            role="button"
            tabIndex={0}
            onClick={controller.openProfileNameEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                controller.openProfileNameEdit();
              }
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '15px 16px', borderRadius: 14, cursor: 'pointer', marginBottom: 10 }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--mf-subtext)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
            </svg>
            <div style={{ minWidth: 0, fontWeight: 700, fontSize: 14.5 }}>프로필명 변경</div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--mf-faint)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ marginLeft: 'auto', flexShrink: 0 }}>
              <path d="m9 6 6 6-6 6" />
            </svg>
          </div>
            </div>
          ) : (
            <div key="main" className={viewClass}>
          {/* 계정 요약 — 여기서는 **보여 주기만** 한다. 사진·이름을 손보는 일은
              한 겹 안의 '프로필 설정'으로 모았다(요청) — 같은 동작의 진입점이
              한 화면에 둘 있으면 어느 쪽이 진짜인지 흐려진다. */}
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--mf-faint)', letterSpacing: '.02em', marginBottom: 10 }}>계정</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: 16, borderRadius: 16, background: 'var(--mf-accent-soft)', marginBottom: 14 }}>
            <ProfileAvatar initial={initial} avatarUrl={state.userAvatar} size={56} radius={16} fontSize={17} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 800, fontSize: 16.5, letterSpacing: '-.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{state.userName}</div>
              {state.userEmail && <div style={{ fontSize: 13, color: 'var(--mf-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 3 }}>{state.userEmail}</div>}
            </div>
          </div>

          {/* 손보는 일은 두 줄 뒤에 — 첫 화면은 "무엇이 있는지"만 말한다. 이 묶음에는
              구획 라벨을 두지 않는다: 모달 제목이 이미 '설정'이라 한 번 더 쓰면
              '설정 > 설정'으로 읽힌다. 행 이름이 스스로를 말한다. */}
          <div
            className="menu-row"
            data-profile-detail-row
            role="button"
            tabIndex={0}
            onClick={controller.openProfileDetail}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                controller.openProfileDetail();
              }
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '15px 16px', borderRadius: 14, cursor: 'pointer' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--mf-subtext)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
              <rect x="3" y="5" width="18" height="14" rx="2.5" />
              <circle cx="8.5" cy="10" r="1.4" />
              <path d="m5 17 5-4.5 4 3.5 3-2.5 3 3" />
            </svg>
            <div style={{ minWidth: 0, fontWeight: 700, fontSize: 14.5 }}>프로필 설정</div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--mf-faint)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ marginLeft: 'auto', flexShrink: 0 }}>
              <path d="m9 6 6 6-6 6" />
            </svg>
          </div>

          {/* '계정 설정' 한 줄 — 누르면 같은 모달이 상세 화면으로 바뀐다(요청).
              로그인 수단·세션·탈퇴는 자주 쓰는 것이 아니라 한 겹 안에 두는 편이
              첫 화면을 가볍게 한다(iOS 설정과 같은 문법: 행 → 뒤로 가기 있는 화면). */}
          <div
            className="menu-row"
            data-account-detail-row
            role="button"
            tabIndex={0}
            onClick={controller.openAccountDetail}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                controller.openAccountDetail();
              }
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '15px 16px', borderRadius: 14, cursor: 'pointer' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--mf-subtext)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
              <circle cx="12" cy="8" r="3.4" />
              <path d="M5.5 20.5a6.5 6.5 0 0 1 13 0" />
            </svg>
            {/* 부제 없이 이름만 — 무엇이 들어 있는지는 들어가면 바로 보인다(요청). */}
            <div style={{ minWidth: 0, fontWeight: 700, fontSize: 14.5 }}>계정 설정</div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--mf-faint)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ marginLeft: 'auto', flexShrink: 0 }}>
              <path d="m9 6 6 6-6 6" />
            </svg>
          </div>

          {/* 색상 테마 — LNB 최하단에 있다가 사용자 요청으로 이리 왔다(설정에 모으는 게
              자연스럽다). 적용 버튼 없이 **누르는 즉시** 뒤 화면까지 색이 바뀐다 —
              모달이 열린 채로 고르므로 고르는 것이 곧 미리보기다. */}
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--mf-faint)', letterSpacing: '.02em', marginTop: 18, marginBottom: 10 }}>색상 테마</div>
          {/* 카드 격자로 고르는 라디오 — 손으로 짠 `role="radio"`까지는 있었지만
              **화살표 이동이 없었다**(Tab이 칸 여섯 개마다 멈췄다). `RadioCards`
              (Radix RadioGroup)가 로빙 tabindex와 ←/→/↑/↓를 준다. */}
          <RadioCards
            value={state.theme}
            onChange={controller.setTheme}
            label="색상 테마 선택"
            grid={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 24 }}
            items={HOME_THEME_KEYS.map((key) => {
              const t = HOME_THEMES[key];
              return {
                value: key,
                label: t.label,
                ariaLabel: `${t.label} 테마`,
                style: (on: boolean) => ({
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
                }),
                children: (
                  <>
                    {/* 미리보기 스와치 — 그 테마의 **면 원** 안에 강조색 점(첨부 이미지).
                        이름만으로는 "모노"·"다크"가 얼마나 다른지 알 수 없다. */}
                    <span style={{ width: 24, height: 24, borderRadius: '50%', flexShrink: 0, background: t.bg, border: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ width: 11, height: 11, borderRadius: '50%', background: t.accent, display: 'block' }} />
                    </span>
                    {t.label}
                  </>
                ),
              };
            })}
          />
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
          )}
        </div>
      </>
    </Modal>
  );
}
